-- ============================================================================
-- UniHaat v1 — UniReserve database regression suite.
--
-- Run it against a scratch database:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/unireserve_regression.sql
--
-- or, without psql:
--
--   DATABASE_URL=postgres://... node scripts/run-sql-suite.mjs \
--        supabase/tests/unireserve_regression.sql
--
-- Every check either passes silently or raises, and the whole script runs
-- inside one transaction that is rolled back at the end, so it never leaves
-- anything behind — the demo data is exactly as it was.
--
-- The checks are the ones that matter for the feature:
--
--   1. the vectors and the matrices agree with the stock
--   2. a safe request is approved
--   3. a request the campus cannot satisfy is held
--   4. an unsafe request is blocked and the pool is left untouched
--   5. the safety algorithm reports an unsafe state as unsafe
--   6. the safe sequence is a real order
--   7. finishing a reservation gives the resources back
--   8. the queue moves on when a unit comes back
--   9. a client cannot write a reservation, an allocation or a log
--  10. a student cannot release somebody else's reservation
--  11. the demonstration runs the four worked examples
--
-- Note on the plumbing: psql does not substitute its variables inside a
-- dollar quoted block, so the values are handed to the anonymous blocks
-- through session settings instead.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- The suite works on its own stock — two kinds of thing of its own — so
-- that the campus the students share is untouched while the checks run.
delete from public.reserve_reservations r
  using public.reserve_reservation_demands d,
        public.reserve_resource_types rt
 where d.reservation_id = r.id
   and d.resource_type_id = rt.id
   and rt.slug in ('regression-alpha', 'regression-beta');

delete from public.reserve_resource_units u
  using public.reserve_resource_types rt
 where u.resource_type_id = rt.id
   and rt.slug in ('regression-alpha', 'regression-beta');

delete from public.reserve_resource_types
 where slug in ('regression-alpha', 'regression-beta');

insert into public.reserve_resource_types (slug, label, unit_label, sort)
values
  ('regression-alpha', 'Regression alpha', 'unit', 9001),
  ('regression-beta',  'Regression beta',  'unit', 9002);

-- One of each: with a single unit of each kind, two students who each
-- need the other's kind are a genuine circular wait.
insert into public.reserve_resource_units (resource_type_id, label)
select rt.id, rt.slug || ' 1'
  from public.reserve_resource_types rt
 where rt.slug in ('regression-alpha', 'regression-beta');

-- Every check starts from the same place: the scratch stock is emptied
-- and the scratch reservations go. The helper lives in the session's
-- temporary schema, so it leaves with the transaction.
create function pg_temp.regression_reset() returns void
language plpgsql
as $$
begin
  delete from public.reserve_reservations r
    using public.reserve_reservation_demands d,
          public.reserve_resource_types rt
   where d.reservation_id = r.id
     and d.resource_type_id = rt.id
     and rt.slug in ('regression-alpha', 'regression-beta');

  update public.reserve_resource_units u
     set status = 'available', reservation_id = null
    from public.reserve_resource_types rt
   where u.resource_type_id = rt.id
     and rt.slug in ('regression-alpha', 'regression-beta');
end $$;

-- Two students to work with.
select id::text as student_a
  from public.profiles
 order by created_at, id
 limit 1 \gset

select id::text as student_b
  from public.profiles
 where id <> :'student_a'::uuid
 order by created_at, id
 limit 1 \gset

-- ---------------------------------------------------------------------------
-- 1. The vectors and the matrices agree with the stock.
-- ---------------------------------------------------------------------------

do $$
declare
  v_available jsonb;
  v_total     int;
begin
  v_available := public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null);

  select count(*)::int into v_total
    from public.reserve_resource_units u
    join public.reserve_resource_types rt on rt.id = u.resource_type_id
   where rt.slug = 'regression-alpha';

  if (v_available ->> 'regression-alpha')::int <> v_total then
    raise exception 'the available vector does not match the stock: % vs %', v_available, v_total;
  end if;

  if (v_available ->> 'regression-beta')::int <> 1 then
    raise exception 'the available vector does not match the stock: %', v_available;
  end if;

  if v_total <> 1 then
    raise exception 'the scratch stock is not one unit of each kind: %', v_total;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A safe request is approved.
-- ---------------------------------------------------------------------------

select pg_temp.regression_reset();

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_result jsonb;
begin
  v_result := public.reserve_request(
    7,
    '[{"type":"regression-alpha","units":1,"max":1},{"type":"regression-beta","units":1,"max":1}]'::jsonb,
    null
  );

  if v_result ->> 'decision' <> 'approved' then
    raise exception 'a safe request was not approved: %', v_result;
  end if;

  if not (v_result ->> 'safe')::boolean then
    raise exception 'a safe request left the campus unsafe: %', v_result;
  end if;

  if (v_result -> 'allocation' ->> 'regression-alpha')::int <> 1 then
    raise exception 'the allocation matrix does not match the decision: %', v_result;
  end if;

  -- The need matrix is the maximum demand minus the allocation.
  if (v_result -> 'need' ->> 'regression-alpha')::int <> 0 then
    raise exception 'the need matrix is wrong: %', v_result;
  end if;

  -- The units are actually taken.
  if exists (
    select 1 from public.reserve_resource_units u
     where u.reservation_id = (v_result ->> 'reservation_id')::uuid
       and u.status <> 'reserved'
  ) then
    raise exception 'the allocation and the pool disagree';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 3. A request the campus cannot satisfy is held, not approved.
-- ---------------------------------------------------------------------------

select pg_temp.regression_reset();

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

-- Student A takes one alpha, so only one is left.
do $$
begin
  perform public.reserve_request(
    7,
    '[{"type":"regression-alpha","units":1,"max":1}]'::jsonb,
    null
  );
end $$;

reset role;

select set_config('request.jwt.claim.sub', :'student_b', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_b' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_result jsonb;
  v_before jsonb;
begin
  v_before := public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null);

  -- The one alpha is out, so it cannot be given out again.
  v_result := public.reserve_request(
    7,
    '[{"type":"regression-alpha","units":1,"max":1}]'::jsonb,
    null
  );

  if v_result ->> 'decision' <> 'held' then
    raise exception 'a request beyond the free pool was not held: %', v_result;
  end if;

  if v_result ->> 'status' <> 'pending' then
    raise exception 'a held request is not pending: %', v_result;
  end if;

  if (select count(*) from jsonb_object_keys(v_result -> 'allocation')) <> 0 then
    raise exception 'a held request allocated something: %', v_result;
  end if;

  if public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null) <> v_before then
    raise exception 'a held request changed the pool';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 4. An unsafe request is blocked, and the pool is left exactly as it was.
--
--    Student A holds the only alpha and still needs the beta. Student B
--    wants the beta, and declares that an alpha is the most it could ever
--    need. Granting the beta would leave the two of them waiting for each
--    other forever.
-- ---------------------------------------------------------------------------

select pg_temp.regression_reset();

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);

-- The setup is done with the owner's rights: a client may not write a
-- reservation directly, which is exactly what this suite checks later.
do $$
declare
  v_alpha uuid;
begin
  -- A reservation that holds an alpha and still needs the beta.
  insert into public.reserve_reservations (user_id, status, duration_days)
  values (auth.uid(), 'approved', 7)
  returning id into v_alpha;

  insert into public.reserve_reservation_demands
    (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
  select v_alpha, id, 1, 1, 1
    from public.reserve_resource_types
   where slug = 'regression-alpha';

  insert into public.reserve_reservation_demands
    (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
  select v_alpha, id, 1, 1, 0
    from public.reserve_resource_types
   where slug = 'regression-beta';

  update public.reserve_resource_units u
     set status = 'reserved', reservation_id = v_alpha
    from public.reserve_resource_types rt
   where u.resource_type_id = rt.id
     and rt.slug = 'regression-alpha'
     and u.status = 'available';
end $$;

reset role;

select set_config('request.jwt.claim.sub', :'student_b', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_b' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_result jsonb;
  v_before jsonb;
  v_after  jsonb;
begin
  v_before := public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null);

  v_result := public.reserve_request(
    7,
    '[{"type":"regression-beta","units":1,"max":1},{"type":"regression-alpha","units":0,"max":1}]'::jsonb,
    null
  );

  if v_result ->> 'decision' <> 'blocked' then
    raise exception 'an unsafe request was not blocked: %', v_result;
  end if;

  if (select count(*) from jsonb_object_keys(v_result -> 'allocation')) <> 0 then
    raise exception 'a blocked request allocated something: %', v_result;
  end if;

  -- The tentative allocation was undone: the pool is exactly as it was.
  v_after := public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null);
  if v_after <> v_before then
    raise exception 'a blocked request changed the pool: % vs %', v_before, v_after;
  end if;

  if exists (
    select 1 from public.reserve_resource_units u
     where u.reservation_id = (v_result ->> 'reservation_id')::uuid
  ) then
    raise exception 'a blocked request kept a unit';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The safety algorithm reports an unsafe state as unsafe.
--
--    Two students, each holding what the other needs. Neither can finish,
--    so the state is not safe and there is no safe sequence.
-- ---------------------------------------------------------------------------

reset role;

select pg_temp.regression_reset();

do $$
declare
  v_first  uuid;
  v_second uuid;
begin
  insert into public.reserve_reservations (user_id, status, duration_days, created_at)
  values (:'student_a'::uuid, 'approved', 7, now())
  returning id into v_first;

  insert into public.reserve_reservation_demands
    (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
  select v_first, id, 1, 1, 1
    from public.reserve_resource_types
   where slug = 'regression-alpha';

  insert into public.reserve_reservation_demands
    (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
  select v_first, id, 1, 1, 0
    from public.reserve_resource_types
   where slug = 'regression-beta';

  insert into public.reserve_reservations (user_id, status, duration_days, created_at)
  values (:'student_b'::uuid, 'approved', 7, now() + interval '1 second')
  returning id into v_second;

  insert into public.reserve_reservation_demands
    (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
  select v_second, id, 1, 1, 0
    from public.reserve_resource_types
   where slug = 'regression-alpha';

  insert into public.reserve_reservation_demands
    (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
  select v_second, id, 1, 1, 1
    from public.reserve_resource_types
   where slug = 'regression-beta';

  update public.reserve_resource_units u
     set status = 'reserved', reservation_id = v_first
    from public.reserve_resource_types rt
   where u.resource_type_id = rt.id
     and rt.slug = 'regression-alpha'
     and u.status = 'available';

  update public.reserve_resource_units u
     set status = 'reserved', reservation_id = v_second
    from public.reserve_resource_types rt
   where u.resource_type_id = rt.id
     and rt.slug = 'regression-beta'
     and u.status = 'available';
end $$;

do $$
declare
  v_safe jsonb;
begin
  v_safe := public.reserve_safe_sequence(
    public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null),
    null
  );

  if (v_safe ->> 'safe')::boolean then
    raise exception 'a deadlocked state was reported as safe: %', v_safe;
  end if;

  if jsonb_array_length(v_safe -> 'sequence') <> 0 then
    raise exception 'an unsafe state produced a safe sequence: %', v_safe;
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 6. The safe sequence is a real order.
-- ---------------------------------------------------------------------------

reset role;

do $$
declare
  v_sequence jsonb;
  v_ids      text[];
  v_first    uuid;
  v_second   uuid;
begin
  -- Clear the deadlocked pair and start again from a clean state.
  perform pg_temp.regression_reset();

  -- Two students who each need one thing and are holding nothing.
  insert into public.reserve_reservations (user_id, status, duration_days, created_at)
  values (:'student_a'::uuid, 'approved', 7, now())
  returning id into v_first;

  insert into public.reserve_reservation_demands
    (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
  select v_first, id, 1, 0, 0
    from public.reserve_resource_types
   where slug = 'regression-alpha';

  insert into public.reserve_reservations (user_id, status, duration_days, created_at)
  values (:'student_b'::uuid, 'approved', 7, now() + interval '1 second')
  returning id into v_second;

  insert into public.reserve_reservation_demands
    (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
  select v_second, id, 1, 0, 0
    from public.reserve_resource_types
   where slug = 'regression-beta';

  v_sequence := public.reserve_safe_sequence(
    public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null),
    array[v_first, v_second]
  );

  if not (v_sequence ->> 'safe')::boolean then
    raise exception 'a clean state was reported as unsafe: %', v_sequence;
  end if;

  select array_agg(x) into v_ids
    from jsonb_array_elements_text(v_sequence -> 'sequence') x;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'the safe sequence is empty: %', v_sequence;
  end if;

  if array_length(v_ids, 1) <> 2 then
    raise exception 'the safe sequence does not hold both reservations: %', v_sequence;
  end if;

  if array_length(v_ids, 1) <> cardinality(array(select distinct unnest(v_ids))) then
    raise exception 'the safe sequence repeats a reservation: %', v_sequence;
  end if;

  -- The student who asked first finishes first.
  if v_ids[1] <> v_first::text or v_ids[2] <> v_second::text then
    raise exception 'the safe sequence is in the wrong order: %', v_sequence;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Finishing a reservation gives the resources back.
-- ---------------------------------------------------------------------------

select pg_temp.regression_reset();

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_result jsonb;
  v_before jsonb;
  v_after  jsonb;
begin
  v_before := public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null);

  v_result := public.reserve_request(
    7,
    '[{"type":"regression-alpha","units":1,"max":1}]'::jsonb,
    null
  );

  if v_result ->> 'decision' <> 'approved' then
    raise exception 'the request was not approved: %', v_result;
  end if;

  -- The unit is out of the pool while it is held.
  v_before := public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null);

  v_result := public.reserve_release((v_result ->> 'reservation_id')::uuid, 'completed');

  if not (v_result ->> 'released')::boolean then
    raise exception 'the reservation was not released: %', v_result;
  end if;

  if v_result ->> 'status' <> 'completed' then
    raise exception 'the reservation is not completed: %', v_result;
  end if;

  v_after := public.reserve_available_vector(array['regression-alpha', 'regression-beta'], null);
  if (v_after ->> 'regression-alpha')::int <> (v_before ->> 'regression-alpha')::int + 1 then
    raise exception 'the released unit did not go back into the pool: % vs %', v_before, v_after;
  end if;

  if exists (
    select 1 from public.reserve_resource_units u
     where u.reservation_id = (v_result ->> 'reservation_id')::uuid
       and u.status <> 'available'
  ) then
    raise exception 'a released unit is still held';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. The queue moves on when a unit comes back.
--
--    A student waits for an alpha that is out. Another student finishes and
--    gives the alpha back — and the waiter is granted it without asking
--    again.
-- ---------------------------------------------------------------------------

reset role;

select pg_temp.regression_reset();

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_waiting  uuid;
  v_holder   uuid;
  v_result   jsonb;
  v_status   text;
  v_allocated int;
begin
  -- The holder takes an alpha.
  v_result := public.reserve_request(
    7,
    '[{"type":"regression-alpha","units":1,"max":1}]'::jsonb,
    null
  );
  v_holder := (v_result ->> 'reservation_id')::uuid;

  -- Somebody else waits for one that is not free.
  v_result := public.reserve_request(
    7,
    '[{"type":"regression-alpha","units":1,"max":1}]'::jsonb,
    null
  );
  v_waiting := (v_result ->> 'reservation_id')::uuid;

  if v_result ->> 'decision' <> 'held' then
    raise exception 'the waiting request was not held: %', v_result;
  end if;

  -- The holder finishes, and the unit goes back to the queue.
  perform public.reserve_release(v_holder, 'completed');

  select r.status::text, d.allocated_units into v_status, v_allocated
    from public.reserve_reservations r
    join public.reserve_reservation_demands d on d.reservation_id = r.id
   where r.id = v_waiting
     and d.resource_type_id = (select id from public.reserve_resource_types where slug = 'regression-alpha');

  if v_status <> 'approved' then
    raise exception 'the waiting reservation was not granted: % / %', v_status, v_allocated;
  end if;

  if v_allocated <> 1 then
    raise exception 'the waiting reservation does not hold the unit: %', v_allocated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. A student cannot release somebody else's reservation.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'student_b', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_b' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_other   uuid;
  v_refused boolean := false;
begin
  select id into v_other
    from public.reserve_reservations
   where user_id <> auth.uid()
     and status in ('pending', 'approved', 'active')
   order by created_at desc
   limit 1;

  if v_other is null then
    raise exception 'there is no reservation owned by another student';
  end if;

  begin
    perform public.reserve_release(v_other, 'cancelled');
  exception when others then
    v_refused := true;
  end;

  if not v_refused then
    raise exception 'a student released somebody else''s reservation';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 10. A client cannot write a reservation, an allocation or a log.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.reserve_reservations',
    'public.reserve_reservation_demands',
    'public.reserve_resource_units',
    'public.reserve_resource_types',
    'public.reserve_reservation_logs'
  ] loop
    if has_table_privilege('authenticated', v_table, 'INSERT')
       or has_table_privilege('authenticated', v_table, 'UPDATE')
       or has_table_privilege('authenticated', v_table, 'DELETE') then
      raise exception 'a client can still write %', v_table;
    end if;
  end loop;

  -- The catalogue is public, like the marketplace.
  if not has_table_privilege('anon', 'public.reserve_resource_units', 'SELECT')
     or not has_table_privilege('anon', 'public.reserve_resource_types', 'SELECT') then
    raise exception 'the rentable catalogue is no longer readable';
  end if;

  -- The request and the release are the only ways in, and only a signed-in
  -- student may use them.
  if has_function_privilege('anon', 'public.reserve_request(int, jsonb, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reserve_release(uuid, text, uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.reserve_demo_scenarios()', 'EXECUTE') then
    raise exception 'an anonymous caller can still drive the allocator';
  end if;

  if not has_function_privilege('authenticated', 'public.reserve_request(int, jsonb, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.reserve_release(uuid, text, uuid[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.reserve_demo_scenarios()', 'EXECUTE') then
    raise exception 'a signed-in student can no longer drive the allocator';
  end if;

  -- The dashboard is open, like the marketplace it sits inside.
  if not has_function_privilege('anon', 'public.reserve_catalogue()', 'EXECUTE')
     or not has_function_privilege('anon', 'public.reserve_dashboard()', 'EXECUTE') then
    raise exception 'the UniReserve dashboard is no longer readable';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11. The demonstration runs the four worked examples.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_demo      jsonb;
  v_scenarios jsonb;
begin
  v_demo := public.reserve_demo_scenarios();

  if jsonb_array_length(v_demo -> 'scenarios') <> 4 then
    raise exception 'the demonstration did not run four examples: %', v_demo;
  end if;

  v_scenarios := v_demo -> 'scenarios';

  if (v_scenarios -> 0 ->> 'decision') <> 'approved' then
    raise exception 'the safe example was not approved: %', v_scenarios -> 0;
  end if;

  if (v_scenarios -> 1 ->> 'decision') <> 'blocked' then
    raise exception 'the unsafe example was not blocked: %', v_scenarios -> 1;
  end if;

  if (v_scenarios -> 2 ->> 'decision') <> 'released' then
    raise exception 'the release example did not release: %', v_scenarios -> 2;
  end if;

  if (v_scenarios -> 3 -> 'safe_sequence_before') = (v_scenarios -> 3 -> 'safe_sequence_after') then
    raise exception 'the safe sequence did not change: %', v_scenarios -> 3;
  end if;
end $$;

reset role;

rollback;

\echo 'UniHaat UniReserve regression suite: all checks passed.'
