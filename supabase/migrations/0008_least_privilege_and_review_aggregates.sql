-- ============================================================================
-- UniHaat v1 — least privilege, private columns, honest review aggregates.
--
-- The permission audit of the live database found four things that the
-- earlier migrations (0001-0007) left open.
--
-- 1. `profiles` was readable in full by anonymous callers. The table grant
--    covered all twenty columns, so `email` and `student_id` — two pieces
--    of personal information — could be harvested by anyone who asked, on
--    any profile, without signing in. The fix is a column-scoped grant:
--    the identity fields stay on the server, the reputation fields that
--    the marketplace actually renders stay public.
--
-- 2. Every function in `public` carried the default EXECUTE grant to
--    PUBLIC, so the client roles could call the trigger helpers and the
--    staff tools directly. `refresh_demand_matches()` was the sharpest
--    edge: it rewrites the match table and was reachable with no
--    authentication at all.
--
-- 3. The `impact_summary` view aggregated over `transactions` as its
--    owner, so it published the whole platform's turnover to anonymous
--    callers while the transaction table itself stayed locked to the two
--    students involved in each deal.
--
-- 4. `apply_review_aggregates()` only ran after an insert and only ever
--    added to the totals, so editing or removing a review left the
--    profile's rating permanently wrong. It now recomputes the totals
--    from the rows themselves, which is idempotent by construction.
--
-- `postgres` and `service_role` both carry the BYPASSRLS attribute, so
-- forcing row level security changes nothing for the server-side
-- functions, the trigger helpers or the admin key. It only closes the
-- door for anybody who would otherwise inherit the table owner's
-- privileges.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles: the private columns leave the client.
-- ---------------------------------------------------------------------------

-- The table level grant goes away first, otherwise it would keep the
-- whole row readable no matter which columns are named below.
revoke select on public.profiles from anon, authenticated, public;

-- These are the fields the marketplace actually shows: who somebody is,
-- where they study, and the reputation the server keeps for them.
-- `email`, `student_id` and `role` are deliberately absent.
grant select (
  id, full_name, avatar_url, college_id, department, year_of_study, bio,
  verified, verified_at,
  rating_sum, rating_count, deals_completed, saved_rupees,
  items_reused, items_given,
  created_at, updated_at
) on public.profiles to anon, authenticated;

-- The verification RPC hands a profile row back to the student. It has to
-- obey the same rule, so the private columns are cleared before it
-- returns.
create or replace function public.claim_student_verification(
  p_college_short text default null,
  p_student_id    text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  update public.profiles p
     set verified = true,
         verified_at = now(),
         student_id = coalesce(nullif(p_student_id, ''), p.student_id)
   where p.id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'profile not found';
  end if;

  if p_college_short is not null then
    update public.profiles p
       set college_id = c.id
      from public.colleges c
     where p.id = v_uid and c.short_name = p_college_short
    returning * into v_row;
  end if;

  -- The client may not read these columns, so the row it gets back must
  -- not carry them either.
  v_row.email      := null;
  v_row.student_id := null;
  v_row.role       := null;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Functions: only the ones a client is meant to call stay callable.
-- ---------------------------------------------------------------------------

-- The row policies themselves call these, and a policy expression is
-- evaluated with the caller's rights, so they have to stay reachable for
-- every role that owns a policy.
grant execute on function public.is_staff() to anon, authenticated, service_role;
grant execute on function public.is_conversation_participant(uuid) to anon, authenticated, service_role;
grant execute on function public.is_transaction_party(uuid) to anon, authenticated, service_role;

-- The verification RPC is the one function the app calls, and only a
-- signed-in student may call it.
revoke execute on function public.claim_student_verification(text, text) from public, anon;
grant execute on function public.claim_student_verification(text, text) to authenticated, service_role;

-- Everything else is server side: the trigger helpers and the staff tools.
-- Trigger functions are invoked by the trigger itself, not by the client,
-- so taking the privilege away does not affect them.
revoke execute on function public.apply_review_aggregates()      from public, anon, authenticated;
revoke execute on function public.apply_transaction_completion() from public, anon, authenticated;
revoke execute on function public.guard_transaction_state()      from public, anon, authenticated;
revoke execute on function public.handle_new_user()              from public, anon, authenticated;
revoke execute on function public.on_demand_change()             from public, anon, authenticated;
revoke execute on function public.on_listing_change()            from public, anon, authenticated;
revoke execute on function public.refresh_demand_matches(uuid)   from public, anon, authenticated;
revoke execute on function public.set_updated_at()               from public, anon, authenticated;
revoke execute on function public.stamp_transaction_completion() from public, anon, authenticated;
revoke execute on function public.staff_update_profile(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.apply_review_aggregates()      to service_role;
grant execute on function public.apply_transaction_completion() to service_role;
grant execute on function public.guard_transaction_state()      to service_role;
grant execute on function public.handle_new_user()              to service_role;
grant execute on function public.on_demand_change()             to service_role;
grant execute on function public.on_listing_change()            to service_role;
grant execute on function public.refresh_demand_matches(uuid)   to service_role;
grant execute on function public.set_updated_at()               to service_role;
grant execute on function public.stamp_transaction_completion() to service_role;
grant execute on function public.staff_update_profile(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Anonymous visitors may look, but they may not write.
-- ---------------------------------------------------------------------------

-- Every one of these writes was already blocked by a row policy. Taking
-- the privilege away as well means that a mistake in a policy cannot
-- turn into a write.
do $$
declare
  privs text := 'insert, update, delete';
begin
  -- `maintain` arrived in PostgreSQL 17. An older server has nothing to
  -- take away under that name, and naming it there would only fail.
  if current_setting('server_version_num')::int >= 170000 then
    privs := privs || ', maintain';
  end if;
  execute format(
    'revoke %s on public.categories, public.colleges, public.conversations,'
    ' public.demand_matches, public.demands, public.listing_images,'
    ' public.listings, public.messages, public.reports, public.reviews,'
    ' public.transactions, public.wishlists from anon',
    privs
  );
end $$;

-- The match table is written by the server's trigger alone.
revoke insert, update, delete on public.demand_matches from authenticated;

-- Reports are filed by a signed-in student and handled by staff.
revoke insert on public.reports from anon;
revoke update, delete on public.reports from authenticated;

-- A review belongs to the record of a completed handover. It may be
-- written by its author and its prose may be edited, but it is not
-- removed, and an anonymous caller may not write one at all.
revoke insert on public.reviews from anon;
revoke delete on public.reviews from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. impact_summary: a view that read the tables it should not have.
-- ---------------------------------------------------------------------------

revoke select, insert, update, delete on public.impact_summary from anon, authenticated;

-- Run the view with the caller's rights, so the policies of the tables
-- underneath it apply to it too.
alter view public.impact_summary set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 5. Force row level security.
-- ---------------------------------------------------------------------------

-- The owner is `postgres`, which carries the BYPASSRLS attribute, so the
-- server side functions and the admin key are unaffected. This only
-- removes the table owner's inherited exemption.
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'colleges', 'conversations', 'demand_matches',
    'demands', 'listing_images', 'listings', 'messages', 'profiles',
    'reports', 'reviews', 'transactions', 'wishlists'
  ] loop
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. The review totals are a function of the rows, so compute them.
-- ---------------------------------------------------------------------------

-- The old version added to the totals on insert and never looked at them
-- again, so an edited or removed review left the profile's rating wrong
-- for good. This version recomputes from the rows themselves, which is
-- idempotent: running it twice gives the same answer as running it once.
create or replace function public.apply_review_aggregates()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_reviewee uuid;
  v_recheck  boolean := false;
begin
  if tg_op = 'INSERT' then
    v_reviewee := new.reviewee_id;
    v_recheck  := true;
  elsif tg_op = 'UPDATE' then
    v_reviewee := new.reviewee_id;
    -- Clients may only edit the prose, so the parties behind the review
    -- can only change on a server side path. Re-check in that case.
    if new.transaction_id is distinct from old.transaction_id
       or new.reviewer_id    is distinct from old.reviewer_id
       or new.reviewee_id    is distinct from old.reviewee_id then
      v_recheck := true;
    end if;
  else
    v_reviewee := old.reviewee_id;
  end if;

  -- A review may only be left for a counterpart we actually transacted with.
  if v_recheck then
    if not exists (
      select 1 from public.transactions t
      where t.id = new.transaction_id
        and t.status = 'completed'
        and t.buyer_id = new.reviewer_id
        and t.seller_id = new.reviewee_id
    ) then
      raise exception 'reviews require a completed transaction with this seller';
    end if;
  end if;

  -- Rebuild the totals for the student who was reviewed.
  update public.profiles p
     set rating_sum   = coalesce(r.s, 0),
         rating_count = coalesce(r.c, 0)
    from (
      select coalesce(sum(rating), 0)::int as s, count(*)::int as c
        from public.reviews
       where reviewee_id = v_reviewee
    ) r
   where p.id = v_reviewee;

  -- If the review moved to a different student, their totals are stale now.
  if tg_op = 'UPDATE' and old.reviewee_id is distinct from new.reviewee_id then
    update public.profiles p
       set rating_sum   = coalesce(r.s, 0),
           rating_count = coalesce(r.c, 0)
      from (
        select coalesce(sum(rating), 0)::int as s, count(*)::int as c
          from public.reviews
         where reviewee_id = old.reviewee_id
      ) r
     where p.id = old.reviewee_id;
  end if;

  -- An AFTER row trigger ignores the return value.
  return null;
end;
$$;

drop trigger if exists on_review_created on public.reviews;
create trigger on_review_created
  after insert or update or delete on public.reviews
  for each row execute function public.apply_review_aggregates();
