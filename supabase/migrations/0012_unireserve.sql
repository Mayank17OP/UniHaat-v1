-- ============================================================================
-- UniReserve — smart reservations, safe allocations, zero deadlocks.
--
-- A campus owns a finite number of rentable things: cycles, calculators,
-- study tables, mattresses. Two students can want the same cycle at the
-- same time, and a student who takes more than the campus has leaves
-- somebody else with nothing. The answer to that is the Banker's Algorithm
-- — the deadlock-avoidance scheme from operating systems — and this
-- migration is that scheme applied to UniHaat's rentals.
--
-- The mapping:
--
--   resource type    → a kind of rentable product (cycles, calculators)
--   resource unit    → one physical thing of that kind
--   reservation      → a process: a student's request for resources
--   maximum demand   → the most of each type the reservation may hold
--   allocation       → what it holds right now
--   need             → maximum demand − allocation
--   available vector → total units of each type, less what is held
--
-- Everything below runs on the server. The browser asks for a decision and
-- is told one; it never decides for itself.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The model
-- ---------------------------------------------------------------------------

-- The migration is written so it can be applied again safely: a retry
-- after a failure must not leave the campus with two of everything.
do $$
begin
  create type public.reserve_reservation_status as enum (
    'pending',    -- asked for, waiting for a decision or for a unit
    'approved',   -- resources allocated, the student has them
    'active',     -- the rental is under way
    'completed',  -- the rental finished, the resources are back
    'cancelled',  -- the student gave it up, the resources are back
    'blocked',    -- the safety algorithm refused it
    'expired'     -- the duration ran out, the resources are back
  );
exception when duplicate_object then null;
end $$;

-- The kinds of thing that can be reserved.
create table if not exists public.reserve_resource_types (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  label         text not null,
  unit_label    text not null default 'unit',
  -- The marketplace category this kind of thing is sold under. A rental
  -- listing in that category feeds this pool.
  category_slug text references public.categories(slug) on update cascade on delete set null,
  description   text,
  sort          int not null default 0,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now()
);

-- A reservation. One row is one process in the algorithm.
create table if not exists public.reserve_reservations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  -- The marketplace listing the student reserved, when they reserved one.
  listing_id    uuid references public.listings(id) on delete set null,
  college_id    uuid references public.colleges(id) on delete set null,
  status        public.reserve_reservation_status not null default 'pending',
  -- The algorithm's answer: approved, held, or blocked.
  decision      text check (decision in ('approved', 'held', 'blocked')),
  reason        text,
  duration_days int not null check (duration_days between 1 and 365),
  starts_at     timestamptz,
  ends_at       timestamptz,
  -- The safe sequence at the moment of the decision. It is kept so the
  -- dashboard can show how the system looked when the answer was given.
  safe_sequence jsonb,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  decided_at    timestamptz,
  released_at   timestamptz
);

create index if not exists reserve_reservations_user_idx   on public.reserve_reservations (user_id, created_at desc);
create index if not exists reserve_reservations_status_idx on public.reserve_reservations (status);
create index if not exists reserve_reservations_ends_idx   on public.reserve_reservations (ends_at)
  where status in ('approved', 'active');

-- The matrix, one row per (reservation, resource type).
--
--   max_units       → the Maximum Demand Matrix
--   requested_units → what the student asked for right now
--   allocated_units → the Allocation Matrix
--   need            → max_units − allocated_units
create table if not exists public.reserve_reservation_demands (
  reservation_id   uuid not null references public.reserve_reservations(id) on delete cascade,
  resource_type_id uuid not null references public.reserve_resource_types(id) on delete cascade,
  max_units        int not null default 0 check (max_units >= 0),
  requested_units  int not null default 0 check (requested_units >= 0),
  allocated_units  int not null default 0 check (allocated_units >= 0),
  primary key (reservation_id, resource_type_id),
  constraint reserve_demand_within_maximum check (requested_units <= max_units),
  constraint reserve_allocation_within_maximum check (allocated_units <= max_units)
);

-- The physical things.
create table if not exists public.reserve_resource_units (
  id               uuid primary key default gen_random_uuid(),
  resource_type_id uuid not null references public.reserve_resource_types(id) on delete cascade,
  -- The marketplace listing this unit is, when it is one.
  listing_id       uuid references public.listings(id) on delete cascade,
  label            text not null,
  monthly_rate     numeric(10,2) not null default 0 check (monthly_rate >= 0),
  status           text not null default 'available' check (status in ('available', 'reserved')),
  -- The reservation holding it, if any.
  reservation_id   uuid references public.reserve_reservations(id) on delete set null,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  -- A unit is either free or held — never both, never neither.
  constraint reserve_unit_holder check ((status = 'available') = (reservation_id is null))
);

create index if not exists reserve_units_type_idx        on public.reserve_resource_units (resource_type_id, status);
create index if not exists reserve_units_reservation_idx on public.reserve_resource_units (reservation_id);

-- The audit trail. Every decision is written down: what was asked, what was
-- available, what was allocated, what the safe sequence was.
create table if not exists public.reserve_reservation_logs (
  id             bigint generated always as identity primary key,
  reservation_id uuid references public.reserve_reservations(id) on delete set null,
  user_id        uuid references public.profiles(id) on delete set null,
  event          text not null,
  decision       text,
  reason         text,
  request        jsonb,
  allocation     jsonb,
  available      jsonb,
  safe_sequence  jsonb,
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists reserve_logs_created_idx     on public.reserve_reservation_logs (created_at desc);
create index if not exists reserve_logs_reservation_idx on public.reserve_reservation_logs (reservation_id);

-- ---------------------------------------------------------------------------
-- 2. The vectors
-- ---------------------------------------------------------------------------

-- The Allocation Matrix row of one reservation.
create or replace function public.reserve_allocation_vector(p_reservation uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
           jsonb_object_agg(rt.slug, d.allocated_units),
           '{}'::jsonb)
    from public.reserve_reservation_demands d
    join public.reserve_resource_types rt on rt.id = d.resource_type_id
   where d.reservation_id = p_reservation
     and d.allocated_units > 0;
$$;

-- The Need Matrix row of one reservation: maximum demand − allocation.
create or replace function public.reserve_need_vector(p_reservation uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
           jsonb_object_agg(rt.slug, d.max_units - d.allocated_units),
           '{}'::jsonb)
    from public.reserve_reservation_demands d
    join public.reserve_resource_types rt on rt.id = d.resource_type_id
   where d.reservation_id = p_reservation;
$$;

-- The types a set of reservations touches. The demonstration mode uses it
-- to run the algorithm against its own sandbox, so the examples come out
-- the same whatever else is happening on the campus.
create or replace function public.reserve_scope_slugs(p_scope uuid[])
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when p_scope is null then null else array(
           select distinct rt.slug
             from public.reserve_reservation_demands d
             join public.reserve_resource_types rt on rt.id = d.resource_type_id
             join public.reserve_reservations r on r.id = d.reservation_id
            where r.id = any (p_scope)
            order by rt.slug)
         end;
$$;

-- The Available Resource Vector.
--
--   Available[i] = total units of type i − units of type i that are held.
--
-- Only reservations that are still in play count: pending, approved and
-- active. A finished, cancelled or expired reservation holds nothing.
--
--   p_slugs  restricts the vector to certain kinds of thing.
--   p_scope  restricts the held count to certain reservations.
create or replace function public.reserve_available_vector(
  p_slugs text[] default null,
  p_scope uuid[] default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with totals as (
    select rt.id, rt.slug, count(u.id)::int as total_units
      from public.reserve_resource_types rt
      left join public.reserve_resource_units u on u.resource_type_id = rt.id
     where (p_slugs is null and not rt.is_demo)
        or (p_slugs is not null and rt.slug = any (p_slugs))
     group by rt.id, rt.slug
  ),
  held as (
    select d.resource_type_id, sum(d.allocated_units)::int as allocated_units
      from public.reserve_reservation_demands d
      join public.reserve_reservations r on r.id = d.reservation_id
     where r.status in ('pending', 'approved', 'active')
       and (p_scope is null or r.id = any (p_scope))
     group by d.resource_type_id
  )
  select coalesce(
           jsonb_object_agg(t.slug, greatest(t.total_units - coalesce(h.allocated_units, 0), 0)),
           '{}'::jsonb)
    from totals t
    left join held h on h.resource_type_id = t.id;
$$;

-- The available vector for a scope, or the whole campus when there is
-- no scope.
create or replace function public.reserve_scope_available(p_scope uuid[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.reserve_available_vector(public.reserve_scope_slugs(p_scope), p_scope);
$$;

-- ---------------------------------------------------------------------------
-- 3. The Safety Algorithm
--
--    Work := Available
--    repeat
--      find a reservation whose Need is covered by Work
--      Work := Work + that reservation's Allocation
--      mark it finished and put it on the sequence
--    until no reservation can finish
--
--    If every reservation finished, the state is safe and the order they
--    finished in is the safe sequence. If some reservation could not
--    finish, the state is unsafe: granting the request would leave
--    somebody unable to complete.
--
--    The process set is every reservation still in play. A reservation
--    that holds nothing cannot deadlock anybody — it is waiting its turn,
--    and the available vector decides when it may start — but it still has
--    to be in the check, because it has declared a maximum it will
--    eventually need.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_safe_sequence(
  p_available jsonb default null,
  p_scope     uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_available   jsonb := coalesce(p_available, public.reserve_scope_available(p_scope));
  v_work        jsonb := v_available;
  v_sequence    jsonb := '[]'::jsonb;
  v_done        jsonb := '{}'::jsonb;
  v_candidate   record;
  v_kv          record;
  v_covered     boolean;
  v_progress    boolean := true;
  v_outstanding int;
begin
  loop
    v_progress := false;

    for v_candidate in
      select r.id,
             jsonb_object_agg(rt.slug, d.max_units - d.allocated_units) as need,
             jsonb_object_agg(rt.slug, d.allocated_units)              as alloc
        from public.reserve_reservations r
        join public.reserve_reservation_demands d on d.reservation_id = r.id
        join public.reserve_resource_types rt on rt.id = d.resource_type_id
       where r.status in ('pending', 'approved', 'active')
         and (case when p_scope is null then not r.is_demo else r.id = any (p_scope) end)
         and not (v_done ? r.id::text)
       group by r.id
       order by min(r.created_at), r.id
    loop
      -- Can this reservation finish with what is left?
      v_covered := true;
      for v_kv in select key, value from jsonb_each_text(v_candidate.need) loop
        if coalesce((v_work ->> v_kv.key)::int, 0) < v_kv.value::int then
          v_covered := false;
          exit;
        end if;
      end loop;

      if v_covered then
        -- It finishes, and what it was holding goes back into the pool.
        for v_kv in select key, value from jsonb_each_text(v_candidate.alloc) loop
          v_work := jsonb_set(
            v_work, array[v_kv.key],
            to_jsonb(coalesce((v_work ->> v_kv.key)::int, 0) + v_kv.value::int),
            true);
        end loop;

        v_done := v_done || jsonb_build_object(v_candidate.id::text, true);
        v_sequence := v_sequence || jsonb_build_array(v_candidate.id);
        v_progress := true;
      end if;
    end loop;

    exit when not v_progress;
  end loop;

  -- Anything left over could not finish.
  select count(*) into v_outstanding
    from public.reserve_reservations r
    join public.reserve_reservation_demands d on d.reservation_id = r.id
   where r.status in ('pending', 'approved', 'active')
     and (case when p_scope is null then not r.is_demo else r.id = any (p_scope) end)
     and not (v_done ? r.id::text);

  if v_outstanding > 0 then
    return jsonb_build_object('safe', false, 'sequence', '[]'::jsonb, 'outstanding', v_outstanding);
  end if;

  return jsonb_build_object('safe', true, 'sequence', v_sequence, 'outstanding', 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The Resource Request Algorithm
--
--    This is the function the app calls. It is the whole of Banker's
--    Algorithm on the server:
--
--      Request_i ≤ Need_i          — the student may not ask for more than
--                                    the maximum they declared
--      Request_i ≤ Available_i     — there has to be something to give
--      the resulting state is safe  — and giving it must not leave anybody
--                                    unable to finish
--
--    The tentative allocation is written first and undone if the state
--    turns out to be unsafe, which is what the textbook algorithm does.
-- ---------------------------------------------------------------------------

-- Take the resources a reservation asked for, if the campus can spare them
-- and the campus stays safe afterwards.
create or replace function public.reserve_try_grant(
  p_reservation uuid,
  p_scope      uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row       public.reserve_reservations;
  v_available jsonb;
  v_after     jsonb;
  v_safe      jsonb;
  v_demand    record;
  v_have      int;
  v_shortage  boolean := false;
  v_short_slug text;
  v_short_want int;
  v_short_have int;
  v_picked    jsonb := '[]'::jsonb;
  v_unit      record;
begin
  select * into v_row from public.reserve_reservations r where r.id = p_reservation;

  if v_row.id is null then
    raise exception 'no such reservation';
  end if;

  -- One lock for every allocation on the campus. Two students asking for
  -- the last cycle at the same moment must not both be told yes.
  perform pg_advisory_xact_lock(7418123001);

  v_available := public.reserve_scope_available(p_scope);

  -- ---- Request_i ≤ Available_i -------------------------------------------
  for v_demand in
    select d.*, rt.slug
      from public.reserve_reservation_demands d
      join public.reserve_resource_types rt on rt.id = d.resource_type_id
     where d.reservation_id = p_reservation
       and d.requested_units > 0
  loop
    v_have := coalesce((v_available ->> v_demand.slug)::int, 0);

    if v_demand.requested_units > v_have then
      -- There is nothing to give. The request is held: it stays in the
      -- queue and is granted when a unit comes back.
      v_shortage   := true;
      v_short_slug := v_demand.slug;
      v_short_want := v_demand.requested_units;
      v_short_have := v_have;
      exit;
    end if;
  end loop;

  if v_shortage then
    v_after := v_available;
    v_safe  := public.reserve_safe_sequence(v_after, p_scope);
    return jsonb_build_object(
      'decision', 'held',
      'reason', format('%s: %s wanted, %s free', v_short_slug, v_short_want, v_short_have),
      'available_before', v_available,
      'available', v_after,
      'safe', coalesce((v_safe ->> 'safe')::boolean, false),
      'safe_sequence', coalesce(v_safe -> 'sequence', '[]'::jsonb),
      'units', '[]'::jsonb
    );
  end if;

  -- ---- The tentative allocation ------------------------------------------
  for v_demand in
    select d.*, rt.slug
      from public.reserve_reservation_demands d
      join public.reserve_resource_types rt on rt.id = d.resource_type_id
     where d.reservation_id = p_reservation
       and d.requested_units > 0
  loop
    update public.reserve_reservation_demands d
       set allocated_units = d.allocated_units + v_demand.requested_units
     where d.reservation_id = p_reservation
       and d.resource_type_id = v_demand.resource_type_id;
  end loop;

  -- Take the units, so the allocation and the pool agree.
  for v_demand in
    select d.*, rt.slug
      from public.reserve_reservation_demands d
      join public.reserve_resource_types rt on rt.id = d.resource_type_id
     where d.reservation_id = p_reservation
       and d.requested_units > 0
  loop
    for v_unit in
      select u.id from public.reserve_resource_units u
       where u.resource_type_id = v_demand.resource_type_id
         and u.status = 'available'
       order by u.id
       limit v_demand.requested_units
       for update
    loop
      update public.reserve_resource_units
         set status = 'reserved', reservation_id = p_reservation
       where id = v_unit.id;
      v_picked := v_picked || jsonb_build_array(v_unit.id);
    end loop;
  end loop;

  v_after := public.reserve_scope_available(p_scope);
  v_safe  := public.reserve_safe_sequence(v_after, p_scope);

  -- ---- Is the resulting state safe? --------------------------------------
  if not coalesce((v_safe ->> 'safe')::boolean, false) then
    -- Unsafe. Undo the tentative allocation — this is the step the
    -- textbook algorithm takes — and refuse the request.
    for v_demand in
      select d.*, rt.slug
        from public.reserve_reservation_demands d
        join public.reserve_resource_types rt on rt.id = d.resource_type_id
       where d.reservation_id = p_reservation
         and d.requested_units > 0
    loop
      update public.reserve_reservation_demands d
         set allocated_units = greatest(d.allocated_units - v_demand.requested_units, 0)
       where d.reservation_id = p_reservation
         and d.resource_type_id = v_demand.resource_type_id;
    end loop;

    update public.reserve_resource_units
       set status = 'available', reservation_id = null
     where reservation_id = p_reservation;

    -- The pool is exactly as it was before the attempt.
    v_after := public.reserve_scope_available(p_scope);

    return jsonb_build_object(
      'decision', 'blocked',
      'reason', 'the allocation would leave the campus unable to complete an existing reservation',
      'available_before', v_available,
      'available', v_after,
      'safe', false,
      'safe_sequence', '[]'::jsonb,
      'units', '[]'::jsonb
    );
  end if;

  -- ---- Safe: commit ------------------------------------------------------
  return jsonb_build_object(
    'decision', 'approved',
    'reason', 'the campus can still complete every reservation after this one',
    'available_before', v_available,
    'available', v_after,
    'safe', true,
    'safe_sequence', coalesce(v_safe -> 'sequence', '[]'::jsonb),
    'units', v_picked
  );
end;
$$;

create or replace function public.reserve_request(
  p_duration_days int,
  p_requests      jsonb,
  p_listing_id    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid          uuid := auth.uid();
  v_reservation  uuid;
  v_outcome      jsonb;
  v_item         jsonb;
  v_slug         text;
  v_units        int;
  v_max          int;
  v_type_id      uuid;
  v_pool         int;
  v_wanted       int := 0;
  v_request      jsonb := '{}'::jsonb;
  v_maximum      jsonb := '{}'::jsonb;
  v_alloc        jsonb := '{}'::jsonb;
  v_user_college uuid;
  v_duration     int := greatest(1, least(coalesce(p_duration_days, 7), 365));
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  if p_requests is null or jsonb_typeof(p_requests) <> 'array'
     or jsonb_array_length(p_requests) = 0 then
    raise exception 'a reservation needs at least one resource';
  end if;

  -- Read the request, and check the shape of it.
  for v_item in select * from jsonb_array_elements(p_requests) loop
    v_slug  := v_item ->> 'type';
    v_units := coalesce((v_item ->> 'units')::int, 0);
    v_max   := coalesce((v_item ->> 'max')::int, v_units);

    if v_slug is null or v_units < 0 or v_max < 0 then
      raise exception 'a reservation needs a resource and a count';
    end if;

    select rt.id into v_type_id
      from public.reserve_resource_types rt
     where rt.slug = v_slug and not rt.is_demo;

    if v_type_id is null then
      raise exception 'unknown resource: %', v_slug;
    end if;

    if v_max < v_units then
      raise exception 'the maximum cannot be less than the request';
    end if;

    -- A maximum larger than the campus owns would put the reservation
    -- beyond reach, and the system could never be safe again while it
    -- waited.
    select count(*)::int into v_pool
      from public.reserve_resource_units u
     where u.resource_type_id = v_type_id;

    if v_max > v_pool then
      raise exception 'the campus has % % — that maximum is more than there is', v_pool, v_slug;
    end if;

    v_request := v_request || jsonb_build_object(v_slug, v_units);
    v_maximum := v_maximum || jsonb_build_object(v_slug, v_max);
    v_wanted  := v_wanted + v_units;
  end loop;

  if v_wanted = 0 then
    raise exception 'a reservation needs at least one resource';
  end if;

  select p.college_id into v_user_college from public.profiles p where p.id = v_uid;

  -- The reservation itself. It is written first, because the algorithm
  -- needs the process to exist before it can ask whether the state is safe.
  insert into public.reserve_reservations
    (user_id, listing_id, college_id, status, duration_days, starts_at, ends_at)
  values
    (v_uid, p_listing_id, v_user_college, 'pending', v_duration, now(), now() + make_interval(days => v_duration))
  returning id into v_reservation;

  insert into public.reserve_reservation_demands
    (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
  select v_reservation, rt.id, (v_maximum ->> rt.slug)::int, (v_request ->> rt.slug)::int, 0
    from public.reserve_resource_types rt
   where rt.slug = any (select jsonb_object_keys(v_request));

  -- Now the algorithm decides.
  v_outcome := public.reserve_try_grant(v_reservation);

  v_alloc := public.reserve_allocation_vector(v_reservation);

  if (v_outcome ->> 'decision') = 'approved' then
    update public.reserve_reservations
       set status = 'approved',
           decision = 'approved',
           reason = v_outcome ->> 'reason',
           starts_at = now(),
           ends_at = now() + make_interval(days => v_duration),
           decided_at = now(),
           safe_sequence = v_outcome -> 'safe_sequence'
     where id = v_reservation;
  elsif (v_outcome ->> 'decision') = 'held' then
    update public.reserve_reservations
       set status = 'pending',
           decision = 'held',
           reason = v_outcome ->> 'reason',
           decided_at = now(),
           safe_sequence = v_outcome -> 'safe_sequence'
     where id = v_reservation;
  else
    update public.reserve_reservations
       set status = 'blocked',
           decision = 'blocked',
           reason = v_outcome ->> 'reason',
           decided_at = now(),
           safe_sequence = v_outcome -> 'safe_sequence'
     where id = v_reservation;
  end if;

  insert into public.reserve_reservation_logs
    (reservation_id, user_id, event, decision, reason, request, allocation, available, safe_sequence)
  values
    (v_reservation, v_uid, 'requested', v_outcome ->> 'decision', v_outcome ->> 'reason',
     v_request, v_alloc, v_outcome -> 'available', v_outcome -> 'safe_sequence');

  return jsonb_build_object(
    'decision', v_outcome ->> 'decision',
    'status', (select r.status from public.reserve_reservations r where r.id = v_reservation),
    'reservation_id', v_reservation,
    'reason', v_outcome ->> 'reason',
    'request', v_request,
    'maximum', v_maximum,
    'allocation', v_alloc,
    'available', v_outcome -> 'available',
    'safe', coalesce((v_outcome ->> 'safe')::boolean, false),
    'safe_sequence', coalesce(v_outcome -> 'safe_sequence', '[]'::jsonb),
    'units', coalesce(v_outcome -> 'units', '[]'::jsonb)
  );
end;
$$;

-- The queue. When a unit comes back, the reservations that were waiting
-- get another turn, in the order they asked.
create or replace function public.reserve_process_pending()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row      record;
  v_outcome  jsonb;
  v_granted  jsonb := '[]'::jsonb;
  v_still    jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(7418123001);

  for v_row in
    select r.id from public.reserve_reservations r
     where r.status = 'pending' and not r.is_demo
     order by r.created_at, r.id
  loop
    v_outcome := public.reserve_try_grant(v_row.id);

    if (v_outcome ->> 'decision') = 'approved' then
      update public.reserve_reservations
         set status = 'approved',
             decision = 'approved',
             reason = v_outcome ->> 'reason',
             starts_at = now(),
             ends_at = now() + make_interval(days => duration_days),
             decided_at = now(),
             safe_sequence = v_outcome -> 'safe_sequence'
       where id = v_row.id;

      insert into public.reserve_reservation_logs
        (reservation_id, user_id, event, decision, reason, allocation, available, safe_sequence)
      select r.id, r.user_id, 'requested', 'approved', v_outcome ->> 'reason',
             public.reserve_allocation_vector(r.id), v_outcome -> 'available', v_outcome -> 'safe_sequence'
        from public.reserve_reservations r where r.id = v_row.id;

      v_granted := v_granted || jsonb_build_array(v_row.id);
    else
      v_still := v_still || jsonb_build_array(v_row.id);
    end if;
  end loop;

  return jsonb_build_object('granted', v_granted, 'waiting', v_still);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Releasing resources
--
--    A rental that ends, is cancelled, or runs out of time gives its units
--    back. The units go into the pool, the allocation goes to zero, and
--    the safe sequence is recomputed — which is how a waiter's turn comes
--    round.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_release(
  p_reservation uuid,
  p_status      text default 'completed',
  p_scope       uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid        uuid := auth.uid();
  v_row        public.reserve_reservations;
  v_scope      uuid[] := p_scope;
  v_before     jsonb;
  v_after      jsonb;
  v_safe       jsonb;
  v_new_status public.reserve_reservation_status;
  v_alloc      jsonb;
begin
  select * into v_row from public.reserve_reservations r where r.id = p_reservation;

  if v_row.id is null then
    raise exception 'no such reservation';
  end if;

  if v_uid is not null and v_row.user_id <> v_uid and not public.is_staff() then
    raise exception 'that reservation belongs to somebody else';
  end if;

  if v_row.status not in ('pending', 'approved', 'active') then
    -- Already finished. Nothing to give back.
    return jsonb_build_object('released', false, 'status', v_row.status);
  end if;

  if v_scope is null and v_row.is_demo then
    v_scope := array[p_reservation];
  end if;

  v_new_status := case p_status
    when 'cancelled' then 'cancelled'::public.reserve_reservation_status
    when 'expired'   then 'expired'::public.reserve_reservation_status
    else 'completed'::public.reserve_reservation_status
  end;

  perform pg_advisory_xact_lock(7418123001);

  v_before := public.reserve_scope_available(v_scope);
  v_alloc  := public.reserve_allocation_vector(p_reservation);

  -- The units go back.
  update public.reserve_resource_units
     set status = 'available', reservation_id = null
   where reservation_id = p_reservation;

  -- And so does the allocation.
  update public.reserve_reservation_demands
     set allocated_units = 0
   where reservation_id = p_reservation;

  update public.reserve_reservations
     set status = v_new_status,
         released_at = now(),
         updated_at = now()
   where id = p_reservation;

  v_after := public.reserve_scope_available(v_scope);
  v_safe  := public.reserve_safe_sequence(v_after, v_scope);

  insert into public.reserve_reservation_logs
    (reservation_id, user_id, event, decision, reason, allocation, available, safe_sequence)
  values
    (p_reservation, v_row.user_id, 'released', 'released', v_new_status::text, v_alloc, v_after, v_safe -> 'sequence');

  -- A unit came back. Whoever was waiting for one gets another turn —
  -- but only on the live campus; the demonstration sandbox keeps to itself.
  if v_scope is null then
    perform public.reserve_process_pending();
  end if;

  return jsonb_build_object(
    'released', true,
    'status', v_new_status,
    'reservation_id', p_reservation,
    'allocation', v_alloc,
    'available_before', v_before,
    'available', v_after,
    'safe', coalesce((v_safe ->> 'safe')::boolean, false),
    'safe_sequence', coalesce(v_safe -> 'sequence', '[]'::jsonb)
  );
end;
$$;

-- Reservations whose time is up give their resources back.
create or replace function public.reserve_expire_due()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row   record;
  v_count int := 0;
begin
  for v_row in
    select r.id from public.reserve_reservations r
     where r.status in ('approved', 'active')
       and not r.is_demo
       and r.ends_at is not null
       and r.ends_at <= now()
  loop
    perform public.reserve_release(v_row.id, 'expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The dashboard
--
--    Everything the UniReserve dashboard shows, in one call: the totals,
--    the counts, the safe sequence and the log.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_dashboard()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_available jsonb;
  v_safe      jsonb;
  v_types     jsonb;
  v_totals    jsonb;
  v_counts    jsonb;
  v_mine      jsonb;
  v_reserve   jsonb;
  v_logs      jsonb;
  v_expired   int;
begin
  -- Give back anything whose time is up, first.
  v_expired := public.reserve_expire_due();

  v_available := public.reserve_available_vector();
  v_safe      := public.reserve_safe_sequence(v_available);

  with totals as (
    select rt.id, rt.slug, count(u.id)::int as total_units
      from public.reserve_resource_types rt
      left join public.reserve_resource_units u on u.resource_type_id = rt.id
     where not rt.is_demo
     group by rt.id, rt.slug
  ),
  held as (
    select d.resource_type_id, sum(d.allocated_units)::int as allocated_units
      from public.reserve_reservation_demands d
      join public.reserve_reservations r on r.id = d.reservation_id
     where r.status in ('pending', 'approved', 'active') and not r.is_demo
     group by d.resource_type_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', t.slug,
           'total', t.total_units,
           'allocated', coalesce(h.allocated_units, 0),
           'available', greatest(t.total_units - coalesce(h.allocated_units, 0), 0)
         ) order by t.slug), '[]'::jsonb)
    into v_types
    from totals t
    left join held h on h.resource_type_id = t.id;

  select jsonb_build_object(
           'total',     coalesce(sum((t ->> 'total')::int), 0),
           'allocated', coalesce(sum((t ->> 'allocated')::int), 0),
           'available', coalesce(sum((t ->> 'available')::int), 0))
    into v_totals
    from jsonb_array_elements(v_types) t;

  select jsonb_build_object(
           'pending',  count(*) filter (where status = 'pending'),
           'approved', count(*) filter (where status in ('approved', 'active')),
           'blocked',  count(*) filter (where status = 'blocked'),
           'finished', count(*) filter (where status in ('completed', 'cancelled', 'expired')),
           'total',    count(*))
    into v_counts
    from public.reserve_reservations r
   where not r.is_demo;

  select coalesce(jsonb_agg(x.obj), '[]'::jsonb)
    into v_reserve
    from (
      select jsonb_build_object(
               'id', r.id,
               'status', r.status,
               'decision', r.decision,
               'reason', r.reason,
               'duration_days', r.duration_days,
               'starts_at', r.starts_at,
               'ends_at', r.ends_at,
               'created_at', r.created_at,
               'listing_id', r.listing_id,
               'mine', r.user_id = auth.uid(),
               'allocation', public.reserve_allocation_vector(r.id),
               'need', public.reserve_need_vector(r.id),
               'safe_sequence', r.safe_sequence
             ) as obj
        from public.reserve_reservations r
       where not r.is_demo
       order by r.created_at desc
       limit 40
    ) x;

  select coalesce(jsonb_agg(x.obj), '[]'::jsonb)
    into v_logs
    from (
      select jsonb_build_object(
               'id', l.id,
               'event', l.event,
               'decision', l.decision,
               'reason', l.reason,
               'request', l.request,
               'allocation', l.allocation,
               'available', l.available,
               'safe_sequence', l.safe_sequence,
               'created_at', l.created_at
             ) as obj
        from public.reserve_reservation_logs l
       where not l.is_demo
       order by l.created_at desc
       limit 30
    ) x;

  select coalesce(jsonb_agg(x.obj), '[]'::jsonb)
    into v_mine
    from (
      select jsonb_build_object(
               'id', r.id,
               'status', r.status,
               'decision', r.decision,
               'reason', r.reason,
               'duration_days', r.duration_days,
               'ends_at', r.ends_at,
               'allocation', public.reserve_allocation_vector(r.id),
               'need', public.reserve_need_vector(r.id)
             ) as obj
        from public.reserve_reservations r
       where auth.uid() is not null and r.user_id = auth.uid() and not r.is_demo
       order by r.created_at desc
       limit 20
    ) x;

  return jsonb_build_object(
    'totals', v_totals,
    'counts', v_counts,
    'types', v_types,
    'available', v_available,
    'safe', coalesce((v_safe ->> 'safe')::boolean, false),
    'safe_sequence', coalesce(v_safe -> 'sequence', '[]'::jsonb),
    'reservations', v_reserve,
    'mine', v_mine,
    'logs', v_logs,
    'expired', v_expired
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The catalogue of rentable things
-- ---------------------------------------------------------------------------

create or replace function public.reserve_catalogue()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_types jsonb;
begin
  with totals as (
    select rt.id, rt.slug, count(u.id)::int as total_units
      from public.reserve_resource_types rt
      left join public.reserve_resource_units u on u.resource_type_id = rt.id
     where not rt.is_demo
     group by rt.id, rt.slug
  ),
  held as (
    select d.resource_type_id, sum(d.allocated_units)::int as allocated_units
      from public.reserve_reservation_demands d
      join public.reserve_reservations r on r.id = d.reservation_id
     where r.status in ('pending', 'approved', 'active') and not r.is_demo
     group by d.resource_type_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', t.slug,
           'label', rt.label,
           'unit_label', rt.unit_label,
           'category', rt.category_slug,
           'description', rt.description,
           'sort', rt.sort,
           'total', t.total_units,
           'allocated', coalesce(h.allocated_units, 0),
           'available', greatest(t.total_units - coalesce(h.allocated_units, 0), 0)
         ) order by rt.sort, rt.slug), '[]'::jsonb)
    into v_types
    from public.reserve_resource_types rt
    join totals t on t.id = rt.id
    left join held h on h.resource_type_id = rt.id
   where not rt.is_demo;

  return jsonb_build_object(
    'types', v_types,
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id,
               'label', u.label,
               'type', rt.slug,
               'type_label', rt.label,
               'monthly_rate', u.monthly_rate,
               'status', u.status,
               'listing_id', u.listing_id
             ) order by rt.sort, u.label)
        from public.reserve_resource_units u
        join public.reserve_resource_types rt on rt.id = u.resource_type_id
       where not rt.is_demo and not u.is_demo), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The campus inventory
--
--    These are the kinds of thing a campus can lend out and how many of
--    each there are. The units are the physical things: one row each.
--
--    A rental listing in the marketplace joins the pool automatically — see
--    the trigger below — so UniReserve and the Marketplace are two views
--    of the same stock rather than two separate inventories.
-- ---------------------------------------------------------------------------

insert into public.reserve_resource_types (slug, label, unit_label, category_slug, description, sort)
values
  ('cycles',       'Cycles',       'cycle',      'sports',      'Campus cycles for the semester — the ones everybody wants in October.', 1),
  ('calculators',  'Calculators',  'calculator', 'electronics', 'Scientific calculators for the exam season. Borrow, do the paper, bring it back.', 2),
  ('furniture',    'Furniture',    'set',        'furniture',   'Study tables, chairs and shelves — the things a hostel room is missing.', 3),
  ('hostel-gear',  'Hostel gear',  'kit',        'hostel',      'Mattresses, lamps, kettles and the rest of a room.', 4),
  ('instruments',  'Instruments',  'instrument', 'instruments', 'Guitars, keyboards and the practice room gear.', 5)
on conflict (slug) do nothing;

-- The units themselves.
--
-- The seed is written so it can run twice without doubling the stock: a
-- migration that is retried must leave the campus with the same number of
-- cycles, not twice as many.
insert into public.reserve_resource_units (resource_type_id, label, monthly_rate)
select rt.id, u.label, u.monthly_rate
  from (values
    ('cycles',       'Campus cycle 1',             400),
    ('cycles',       'Campus cycle 2',             400),
    ('cycles',       'Campus cycle 3',             400),
    ('cycles',       'Campus cycle 4',             400),
    ('cycles',       'Campus cycle 5',             400),
    ('cycles',       'Campus cycle 6',             400),
    ('calculators',  'Scientific calculator 1',    250),
    ('calculators',  'Scientific calculator 2',    250),
    ('calculators',  'Scientific calculator 3',    250),
    ('calculators',  'Scientific calculator 4',    250),
    ('calculators',  'Scientific calculator 5',    250),
    ('calculators',  'Scientific calculator 6',    250),
    ('calculators',  'Scientific calculator 7',    250),
    ('calculators',  'Scientific calculator 8',    250),
    ('furniture',    'Study table and chair 1',   900),
    ('furniture',    'Study table and chair 2',   900),
    ('furniture',    'Study table and chair 3',   900),
    ('furniture',    'Study table and chair 4',   900),
    ('hostel-gear',  'Hostel kit 1',               300),
    ('hostel-gear',  'Hostel kit 2',               300),
    ('hostel-gear',  'Hostel kit 3',               300),
    ('hostel-gear',  'Hostel kit 4',               300),
    ('hostel-gear',  'Hostel kit 5',               300),
    ('hostel-gear',  'Hostel kit 6',               300),
    ('hostel-gear',  'Hostel kit 7',               300),
    ('hostel-gear',  'Hostel kit 8',               300),
    ('hostel-gear',  'Hostel kit 9',               300),
    ('hostel-gear',  'Hostel kit 10',              300),
    ('instruments',  'Guitar 1',                   700),
    ('instruments',  'Guitar 2',                   700),
    ('instruments',  'Guitar 3',                   700)
  ) as u(slug, label, monthly_rate)
  join public.reserve_resource_types rt on rt.slug = u.slug
 where not exists (
   select 1
     from public.reserve_resource_units x
    where x.resource_type_id = rt.id
      and x.label = u.label
      and x.listing_id is null
 );

-- ---------------------------------------------------------------------------
-- 9. The Marketplace feeds the pool
--
--    A listing the seller put up for rent is a thing somebody can borrow,
--    so it joins the pool for its category. When the listing comes down,
--    the unit goes with it — and if somebody was holding it, their
--    allocation is corrected first.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_sync_listing_unit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_type_id uuid;
  v_unit    record;
begin
  if new.listing_type = 'rent' and new.status in ('active', 'reserved') then
    select rt.id into v_type_id
      from public.reserve_resource_types rt
     where rt.category_slug = new.category_slug and not rt.is_demo
     limit 1;

    if v_type_id is not null then
      insert into public.reserve_resource_units (resource_type_id, listing_id, label, monthly_rate)
      values (v_type_id, new.id, new.title, coalesce(new.rent_per_month, 0))
      on conflict (listing_id) do update
        set label = excluded.label,
            monthly_rate = excluded.monthly_rate,
            resource_type_id = excluded.resource_type_id;
    end if;
  else
    -- It is not a rental any more. Give back anything somebody was
    -- holding through it, then take the unit out of the pool.
    for v_unit in
      select u.id, u.resource_type_id, u.reservation_id
        from public.reserve_resource_units u
       where u.listing_id = new.id
    loop
      if v_unit.reservation_id is not null then
        update public.reserve_reservation_demands d
           set allocated_units = greatest(d.allocated_units - 1, 0)
         where d.reservation_id = v_unit.reservation_id
           and d.resource_type_id = v_unit.resource_type_id;
      end if;
    end loop;

    delete from public.reserve_resource_units where listing_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists reserve_listing_unit_sync on public.listings;
create trigger reserve_listing_unit_sync
  after insert or update of listing_type, category_slug, title, rent_per_month, status or delete
  on public.listings
  for each row execute function public.reserve_sync_listing_unit();

-- One unit per listing, at most. A unit with no listing is a campus
-- resource, and there can be any number of those.
create unique index if not exists reserve_units_listing_idx on public.reserve_resource_units (listing_id);

-- The trigger only sees what happens from here on. The rentals that are
-- already on the marketplace have to be brought into the pool by hand,
-- or a student would find a listing they could borrow and no unit behind
-- it.
insert into public.reserve_resource_units (resource_type_id, listing_id, label, monthly_rate)
select rt.id, l.id, l.title, coalesce(l.rent_per_month, 0)
  from public.listings l
  join public.reserve_resource_types rt
    on rt.category_slug = l.category_slug
   and not rt.is_demo
 where l.listing_type = 'rent'
   and l.status in ('active', 'reserved')
   and not exists (
     select 1 from public.reserve_resource_units u where u.listing_id = l.id
   )
on conflict (listing_id) do nothing;

-- If a reservation row ever goes away, the units it was holding go back
-- into the pool and its allocation goes with it. The ordinary path does
-- this through reserve_release(); this is the backstop that keeps the
-- pool and the allocation matrix agreeing whatever happens.
create or replace function public.reserve_free_units_of_deleted_reservation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.reserve_resource_units
     set status = 'available', reservation_id = null
   where reservation_id = old.id;

  update public.reserve_reservation_demands
     set allocated_units = 0
   where reservation_id = old.id;

  return old;
end;
$$;

drop trigger if exists reserve_reservation_frees_units on public.reserve_reservations;
create trigger reserve_reservation_frees_units
  before delete on public.reserve_reservations
  for each row execute function public.reserve_free_units_of_deleted_reservation();

-- ---------------------------------------------------------------------------
-- 10. Demonstration mode
--
--     Four worked examples, run against the real algorithm:
--
--       1. a safe reservation is approved
--       2. an unsafe reservation is blocked
--       3. resources are released when a rental finishes
--       4. the safe sequence changes after an allocation
--
--     They run in a sandbox of their own — three demonstration resource
--     types, created and destroyed by this function — so the examples come
--     out the same whatever else is happening on the campus. The algorithm
--     that decides them is the one the live feature uses.
-- ---------------------------------------------------------------------------

-- Put a unit in a student's hand. The demonstration mode needs to set up
-- a starting position, which the ordinary request path cannot do.
create or replace function public.reserve_demo_allocate(
  p_reservation uuid,
  p_type        text,
  p_units       int
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_type_id uuid;
  v_unit    record;
begin
  select rt.id into v_type_id
    from public.reserve_resource_types rt where rt.slug = p_type;

  if v_type_id is null then
    raise exception 'unknown resource: %', p_type;
  end if;

  for v_unit in
    select u.id from public.reserve_resource_units u
     where u.resource_type_id = v_type_id and u.status = 'available'
     order by u.id
     limit p_units
     for update
  loop
    update public.reserve_resource_units
       set status = 'reserved', reservation_id = p_reservation
     where id = v_unit.id;
  end loop;

  update public.reserve_reservation_demands d
     set allocated_units = d.allocated_units + p_units
   where d.reservation_id = p_reservation
     and d.resource_type_id = v_type_id;
end;
$$;

revoke all on function public.reserve_demo_allocate(uuid, text, int) from public;

-- Build a fresh sandbox: the given resource types, with the given number
-- of units each, and nothing else.
create or replace function public.reserve_demo_sandbox(p_spec jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item    jsonb;
  v_slug    text;
  v_units   int;
  v_type_id uuid;
  v_n       int;
begin
  -- Clear whatever the last scenario left.
  delete from public.reserve_reservations where is_demo;
  delete from public.reserve_resource_units where is_demo;
  delete from public.reserve_resource_types where is_demo;

  for v_item in select * from jsonb_array_elements(p_spec) loop
    v_slug  := v_item ->> 'type';
    v_units := (v_item ->> 'units')::int;

    insert into public.reserve_resource_types (slug, label, unit_label, is_demo)
    values (v_slug, v_slug, 'unit', true);

    select rt.id into v_type_id
      from public.reserve_resource_types rt where rt.slug = v_slug;

    for v_n in 1..v_units loop
      insert into public.reserve_resource_units (resource_type_id, label, is_demo)
      values (v_type_id, v_slug || ' ' || v_n, true);
    end loop;
  end loop;
end;
$$;

revoke all on function public.reserve_demo_sandbox(jsonb) from public;

-- A demonstration reservation with a declared maximum and a request.
create or replace function public.reserve_demo_reservation(
  p_owner   uuid,
  p_demands jsonb,
  p_offset  int default 0
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reservation uuid;
  v_item        jsonb;
  v_type_id     uuid;
begin
  -- The offset keeps the order of the demonstrations fixed, so the safe
  -- sequence is always the same order every time they are run.
  insert into public.reserve_reservations
    (user_id, status, duration_days, is_demo, created_at)
  values
    (p_owner, 'pending', 7, true, now() + make_interval(secs => p_offset))
  returning id into v_reservation;

  for v_item in select * from jsonb_array_elements(p_demands) loop
    select rt.id into v_type_id
      from public.reserve_resource_types rt where rt.slug = v_item ->> 'type';

    insert into public.reserve_reservation_demands
      (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
    values
      (v_reservation, v_type_id,
       coalesce((v_item ->> 'max')::int, (v_item ->> 'units')::int),
       coalesce((v_item ->> 'units')::int, 0),
       coalesce((v_item ->> 'allocated')::int, 0));
  end loop;

  return v_reservation;
end;
$$;

revoke all on function public.reserve_demo_reservation(uuid, jsonb, int) from public;

create or replace function public.reserve_demo_scenarios()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid        uuid := auth.uid();
  v_other      uuid;
  v_r1         uuid;
  v_r2         uuid;
  v_scope      uuid[];
  v_outcome    jsonb;
  v_before     jsonb;
  v_after      jsonb;
  v_seq        jsonb;
  v_results    jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- A second student, for the examples that need two people.
  select p.id into v_other
    from public.profiles p
   where p.id <> v_uid
   order by p.created_at, p.id
   limit 1;

  if v_other is null then
    v_other := v_uid;
  end if;

  -- ---------------------------------------------------------------------
  -- 1. A safe reservation is approved.
  -- ---------------------------------------------------------------------
  perform public.reserve_demo_sandbox('[{"type":"demo-alpha","units":2},{"type":"demo-beta","units":2}]'::jsonb);

  v_r1 := public.reserve_demo_reservation(v_uid, '[{"type":"demo-alpha","units":1,"max":1},{"type":"demo-beta","units":1,"max":1}]'::jsonb, 0);
  v_scope := array[v_r1];

  v_before := public.reserve_scope_available(v_scope);
  v_outcome := public.reserve_try_grant(v_r1, v_scope);

  update public.reserve_reservations set status = 'approved' where id = v_r1;

  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'scenario', 'safe_approved',
    'title', 'A safe reservation is approved',
    'story', 'Two alpha and two beta are free. A student asks for one of each. The campus can still complete every other reservation afterwards, so the request goes through.',
    'available_before', v_before,
    'available_after', v_outcome -> 'available',
    'decision', v_outcome ->> 'decision',
    'reason', v_outcome ->> 'reason',
    'safe', v_outcome -> 'safe',
    'safe_sequence', v_outcome -> 'safe_sequence',
    'allocation', public.reserve_allocation_vector(v_r1),
    'need', public.reserve_need_vector(v_r1)
  ));

  -- ---------------------------------------------------------------------
  -- 2. An unsafe reservation is blocked.
  --
  --    One student holds the only alpha and still needs a beta. Another
  --    asks for that beta — and would then be holding the alpha the first
  --    one needs. The two would wait for each other forever, so the
  --    safety algorithm refuses the request and the tentative allocation
  --    is undone.
  -- ---------------------------------------------------------------------
  perform public.reserve_demo_sandbox('[{"type":"demo-alpha","units":1},{"type":"demo-beta","units":1}]'::jsonb);

  v_r1 := public.reserve_demo_reservation(v_uid, '[{"type":"demo-alpha","units":1,"max":1},{"type":"demo-beta","units":0,"max":1}]'::jsonb, 0);
  v_scope := array[v_r1];
  v_outcome := public.reserve_try_grant(v_r1, v_scope);
  update public.reserve_reservations set status = 'approved' where id = v_r1;

  v_r2 := public.reserve_demo_reservation(v_other, '[{"type":"demo-alpha","units":0,"max":1},{"type":"demo-beta","units":1,"max":1}]'::jsonb, 1);
  v_scope := array[v_r1, v_r2];

  v_before := public.reserve_scope_available(v_scope);
  v_outcome := public.reserve_try_grant(v_r2, v_scope);

  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'scenario', 'unsafe_blocked',
    'title', 'An unsafe reservation is blocked',
    'story', 'One alpha is held and its holder still needs a beta. Granting the waiting student that beta would leave the two of them waiting for each other forever, so the request is refused and the pool is left exactly as it was.',
    'available_before', v_before,
    'available_after', v_outcome -> 'available',
    'decision', v_outcome ->> 'decision',
    'reason', v_outcome ->> 'reason',
    'safe', v_outcome -> 'safe',
    'safe_sequence', v_outcome -> 'safe_sequence',
    'allocation', public.reserve_allocation_vector(v_r2),
    'need', public.reserve_need_vector(v_r2)
  ));

  -- ---------------------------------------------------------------------
  -- 3. Resources are released when the rental finishes.
  -- ---------------------------------------------------------------------
  perform public.reserve_demo_sandbox('[{"type":"demo-alpha","units":1},{"type":"demo-beta","units":1}]'::jsonb);

  v_r1 := public.reserve_demo_reservation(v_uid, '[{"type":"demo-alpha","units":1,"max":1}]'::jsonb, 0);
  v_scope := array[v_r1];
  v_outcome := public.reserve_try_grant(v_r1, v_scope);
  update public.reserve_reservations set status = 'approved' where id = v_r1;

  v_before := public.reserve_scope_available(v_scope);
  perform public.reserve_release(v_r1, 'completed', v_scope);
  v_after := public.reserve_scope_available(v_scope);

  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'scenario', 'released',
    'title', 'Resources are released when the rental finishes',
    'story', 'The rental ends, so the alpha goes back into the pool and the available vector grows again. That is how the next student in the queue gets their turn.',
    'available_before', v_before,
    'available_after', v_after,
    'decision', 'released',
    'reason', 'the reservation was completed and its resources returned',
    'safe', true,
    'safe_sequence', public.reserve_safe_sequence(v_after, v_scope) -> 'sequence',
    'allocation', public.reserve_allocation_vector(v_r1),
    'need', public.reserve_need_vector(v_r1)
  ));

  -- ---------------------------------------------------------------------
  -- 4. The safe sequence changes after an allocation.
  -- ---------------------------------------------------------------------
  perform public.reserve_demo_sandbox('[{"type":"demo-beta","units":2}]'::jsonb);

  v_r1 := public.reserve_demo_reservation(v_uid, '[{"type":"demo-beta","units":1,"max":2}]'::jsonb, 0);
  v_scope := array[v_r1];
  v_outcome := public.reserve_try_grant(v_r1, v_scope);
  update public.reserve_reservations set status = 'approved' where id = v_r1;

  v_r2 := public.reserve_demo_reservation(v_other, '[{"type":"demo-beta","units":1,"max":1}]'::jsonb, 1);
  v_scope := array[v_r1, v_r2];

  v_seq := public.reserve_safe_sequence(public.reserve_scope_available(v_scope), v_scope) -> 'sequence';

  v_outcome := public.reserve_try_grant(v_r2, v_scope);
  update public.reserve_reservations set status = 'approved' where id = v_r2;

  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'scenario', 'sequence_changed',
    'title', 'The safe sequence changes after an allocation',
    'story', 'Before the second student was granted anything, the safe order finished the holder first. After the allocation the order changes, because the student who now holds a unit can finish first.',
    'safe_sequence_before', v_seq,
    'safe_sequence_after', v_outcome -> 'safe_sequence',
    'available_before', v_outcome -> 'available_before',
    'available_after', v_outcome -> 'available',
    'decision', v_outcome ->> 'decision',
    'reason', v_outcome ->> 'reason',
    'safe', v_outcome -> 'safe',
    'allocation', public.reserve_allocation_vector(v_r2),
    'need', public.reserve_need_vector(v_r2)
  ));

  -- Leave the campus as it was.
  delete from public.reserve_reservations where is_demo;
  delete from public.reserve_resource_units where is_demo;
  delete from public.reserve_resource_types where is_demo;

  insert into public.reserve_reservation_logs
    (user_id, event, decision, reason, safe_sequence, is_demo)
  values
    (v_uid, 'demo', 'ran', 'the four worked examples of the Banker''s Algorithm were run', v_results -> 0 -> 'safe_sequence', true);

  return jsonb_build_object(
    'scenarios', v_results,
    'ran_at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Who can see and do what
--
--     The catalogue is public, like the marketplace. The reservations are
--     campus business: everybody can see that six cycles are out and two
--     are free, and everybody can see the log. Only the owner of a
--     reservation can release it, and nobody can write a reservation
--     directly — they ask the algorithm.
-- ---------------------------------------------------------------------------

alter table public.reserve_resource_types enable row level security;
alter table public.reserve_resource_units enable row level security;
alter table public.reserve_reservations enable row level security;
alter table public.reserve_reservation_demands enable row level security;
alter table public.reserve_reservation_logs enable row level security;

-- The owner is `postgres`, which carries the BYPASSRLS attribute, so the
-- server side functions and the admin key are unaffected. This only
-- removes the table owner's inherited exemption.
do $$
declare
  t text;
begin
  foreach t in array array[
    'reserve_reservation_demands', 'reserve_reservation_logs',
    'reserve_reservations', 'reserve_resource_types',
    'reserve_resource_units'
  ] loop
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

drop policy if exists "anyone reads the resource catalogue" on public.reserve_resource_types;
create policy "anyone reads the resource catalogue"
  on public.reserve_resource_types for select
  using (not is_demo);

drop policy if exists "anyone reads the units" on public.reserve_resource_units;
create policy "anyone reads the units"
  on public.reserve_resource_units for select
  using (not is_demo);

drop policy if exists "anyone reads the reservations" on public.reserve_reservations;
create policy "anyone reads the reservations"
  on public.reserve_reservations for select
  using (not is_demo);

drop policy if exists "anyone reads the reservation demands" on public.reserve_reservation_demands;
create policy "anyone reads the reservation demands"
  on public.reserve_reservation_demands for select
  using (exists (select 1 from public.reserve_reservations r
                  where r.id = reserve_reservation_demands.reservation_id and not r.is_demo));

drop policy if exists "anyone reads the reservation log" on public.reserve_reservation_logs;
create policy "anyone reads the reservation log"
  on public.reserve_reservation_logs for select
  using (not is_demo);

-- The service role owns the tables; the client reads them.
grant select on public.reserve_resource_types to anon, authenticated;
grant select on public.reserve_resource_units to anon, authenticated;
grant select on public.reserve_reservations to authenticated;
grant select on public.reserve_reservation_demands to authenticated;
grant select on public.reserve_reservation_logs to authenticated;

-- The public schema hands new tables to the client roles with every
-- privilege, so the writes have to be taken back explicitly. A student
-- reads the catalogue and the dashboard; the server writes the rest.
revoke insert, update, delete, truncate, references, trigger
  on public.reserve_resource_types, public.reserve_resource_units,
     public.reserve_reservations, public.reserve_reservation_demands,
     public.reserve_reservation_logs
  from anon, authenticated;

revoke all on sequence public.reserve_reservation_logs_id_seq from anon;
grant usage, select on sequence public.reserve_reservation_logs_id_seq to authenticated;

-- The functions are the only way in. They are SECURITY DEFINER, so they
-- run with the owner's rights, and they check who is asking.
--
-- The public schema hands new functions to the client roles with EXECUTE
-- by default, so the privilege has to be taken away from every role
-- before it is given back to the handful of entry points that need it.
-- The helper functions below — the grant, the queue, the sweeper, the
-- demonstration's scaffolding — stay server side.
revoke all on function public.reserve_request(int, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.reserve_release(uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.reserve_dashboard() from public, anon, authenticated;
revoke all on function public.reserve_catalogue() from public, anon, authenticated;
revoke all on function public.reserve_demo_scenarios() from public, anon, authenticated;
revoke all on function public.reserve_available_vector(text[], uuid[]) from public, anon, authenticated;
revoke all on function public.reserve_safe_sequence(jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.reserve_allocation_vector(uuid) from public, anon, authenticated;
revoke all on function public.reserve_need_vector(uuid) from public, anon, authenticated;

revoke all on function public.reserve_scope_slugs(uuid[]) from public, anon, authenticated;
revoke all on function public.reserve_scope_available(uuid[]) from public, anon, authenticated;
revoke all on function public.reserve_try_grant(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.reserve_process_pending() from public, anon, authenticated;
revoke all on function public.reserve_expire_due() from public, anon, authenticated;
revoke all on function public.reserve_sync_listing_unit() from public, anon, authenticated;
revoke all on function public.reserve_free_units_of_deleted_reservation() from public, anon, authenticated;
revoke all on function public.reserve_demo_allocate(uuid, text, int) from public, anon, authenticated;
revoke all on function public.reserve_demo_sandbox(jsonb) from public, anon, authenticated;
revoke all on function public.reserve_demo_reservation(uuid, jsonb, int) from public, anon, authenticated;

grant execute on function public.reserve_request(int, jsonb, uuid) to authenticated;
grant execute on function public.reserve_release(uuid, text, uuid[]) to authenticated;
grant execute on function public.reserve_dashboard() to anon, authenticated;
grant execute on function public.reserve_catalogue() to anon, authenticated;
grant execute on function public.reserve_demo_scenarios() to authenticated;
grant execute on function public.reserve_available_vector(text[], uuid[]) to anon, authenticated;
grant execute on function public.reserve_safe_sequence(jsonb, uuid[]) to anon, authenticated;
grant execute on function public.reserve_allocation_vector(uuid) to authenticated;
grant execute on function public.reserve_need_vector(uuid) to authenticated;
