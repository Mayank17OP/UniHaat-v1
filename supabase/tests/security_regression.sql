-- ============================================================================
-- UniHaat v1 — database security regression suite.
--
-- Run it against a scratch database:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/security_regression.sql
--
-- Every check either passes silently or raises, and the whole script runs
-- inside one transaction that is rolled back at the end, so it never leaves
-- anything behind — the demo data is exactly as it was.
--
-- The script picks its own two students and an active listing, so it needs
-- what the seeded demo database has.
--
-- Note on the plumbing: psql does not substitute its variables inside a
-- dollar quoted block, so the values are handed to the anonymous blocks
-- through session settings instead.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 1. The profile read is granted column by column.
-- ---------------------------------------------------------------------------

do $$
declare
  v_leaked text;
begin
  select string_agg(column_name, ', ' order by column_name) into v_leaked
    from information_schema.column_privileges
   where table_schema  = 'public'
     and table_name    = 'profiles'
     and privilege_type = 'SELECT'
     and grantee in ('anon', 'authenticated')
     and column_name in ('email', 'student_id', 'role');

  if v_leaked is not null then
    raise exception 'a client can still read the private profile columns: %', v_leaked;
  end if;

  -- The marketplace still has to render the seller card.
  if not has_column_privilege('anon', 'public.profiles', 'rating_sum', 'SELECT')
     or not has_column_privilege('anon', 'public.profiles', 'full_name', 'SELECT')
     or not has_column_privilege('authenticated', 'public.profiles', 'deals_completed', 'SELECT') then
    raise exception 'the public profile fields are no longer readable';
  end if;

  -- And the reputation fields stay server side.
  if has_column_privilege('authenticated', 'public.profiles', 'rating_sum', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'verified', 'UPDATE') then
    raise exception 'a client can still write a reputation field';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The server-side functions and the aggregate view are out of reach.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.apply_review_aggregates()',
    'public.apply_transaction_completion()',
    'public.guard_transaction_state()',
    'public.handle_new_user()',
    'public.on_demand_change()',
    'public.on_listing_change()',
    'public.refresh_demand_matches(uuid)',
    'public.set_updated_at()',
    'public.stamp_transaction_completion()',
    'public.staff_update_profile(uuid, jsonb)'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'a client can still call %', v_fn;
    end if;
  end loop;

  -- The verification RPC is the one function the app calls, and only a
  -- signed-in student may call it.
  if has_function_privilege('anon', 'public.claim_student_verification(text, text)', 'EXECUTE') then
    raise exception 'an anonymous caller can still claim a verification';
  end if;
  if not has_function_privilege('authenticated', 'public.claim_student_verification(text, text)', 'EXECUTE') then
    raise exception 'a signed-in student can no longer claim a verification';
  end if;

  -- The row policies themselves call these, so they must stay reachable.
  foreach v_fn in array array[
    'public.is_staff()',
    'public.is_conversation_participant(uuid)',
    'public.is_transaction_party(uuid)'
  ] loop
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'a row policy lost the helper %', v_fn;
    end if;
  end loop;

  -- The view aggregates over the transactions table as its owner, so it has
  -- to be closed to the client roles.
  if has_table_privilege('anon', 'public.impact_summary', 'SELECT')
     or has_table_privilege('authenticated', 'public.impact_summary', 'SELECT') then
    raise exception 'a client can still read impact_summary';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Every table forces row level security.
-- ---------------------------------------------------------------------------

do $$
declare
  v_open text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_open
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relforcerowsecurity;

  if v_open is not null then
    raise exception 'these tables do not force row level security: %', v_open;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The review aggregate is a function of the rows.
--
--    A review has to follow a completed handover, so the script walks one
--    through: the buyer opens it, both sides confirm, and the handover
--    completes. Only then is a review allowed at all.
-- ---------------------------------------------------------------------------

select l.seller_id::text as seller, l.id::text as listing
  from public.listings l
 where l.status = 'active'
 order by l.created_at
 limit 1 \gset

select id::text as buyer
  from public.profiles
 where id <> :'seller'
 order by created_at
 limit 1 \gset

select set_config('uni.regression.seller',  :'seller',  true),
       set_config('uni.regression.buyer',   :'buyer',   true),
       set_config('uni.regression.listing', :'listing', true);

do $$
begin
  if current_setting('uni.regression.buyer', true) is null
     or current_setting('uni.regression.buyer', true) = '' then
    raise exception 'this script needs two students and at least one active listing';
  end if;
end $$;

-- The handover, as the buyer.
select set_config('request.jwt.claim.sub', :'buyer', true);
select set_config('request.jwt.claims', '{"sub":"' || :'buyer' || '","role":"authenticated"}', true);
set local role authenticated;

insert into public.transactions (listing_id, buyer_id, seller_id, amount, swap_code)
values (:'listing', :'buyer', :'seller', 0,
        'UH-REGRESSION-' || substr(md5(random()::text), 1, 8));

select id::text as txn from public.transactions
 where buyer_id = :'buyer' and seller_id = :'seller'
 order by created_at desc
 limit 1 \gset

select set_config('uni.regression.txn', :'txn', true);

update public.transactions set buyer_confirmed_at = now() where id = :'txn';

reset role;

-- The handover, as the seller. The second confirmation completes it.
select set_config('request.jwt.claim.sub', :'seller', true);
select set_config('request.jwt.claims', '{"sub":"' || :'seller' || '","role":"authenticated"}', true);
set local role authenticated;

update public.transactions set seller_confirmed_at = now() where id = :'txn';

reset role;

do $$
declare
  v_status text;
begin
  select status::text into v_status
    from public.transactions where id = current_setting('uni.regression.txn')::uuid;
  if v_status <> 'completed' then
    raise exception 'the handover did not complete (status=%)', v_status;
  end if;
end $$;

-- The review. The aggregate must follow it.
select p.rating_sum::text as sum_before, p.rating_count::text as count_before
  from public.profiles p
 where p.id = :'seller' \gset

select set_config('uni.regression.sum_before',   :'sum_before',   true),
       set_config('uni.regression.count_before', :'count_before', true);

select set_config('request.jwt.claim.sub', :'buyer', true);
select set_config('request.jwt.claims', '{"sub":"' || :'buyer' || '","role":"authenticated"}', true);
set local role authenticated;

insert into public.reviews (transaction_id, reviewer_id, reviewee_id, rating, body)
values (:'txn', :'buyer', :'seller', 5, 'A regression review');

reset role;

select p.rating_sum::text as sum_after_insert, p.rating_count::text as count_after_insert
  from public.profiles p
 where p.id = :'seller' \gset

select set_config('uni.regression.sum_after_insert',   :'sum_after_insert',   true),
       set_config('uni.regression.count_after_insert', :'count_after_insert', true);

-- Editing the prose must not move the totals.
select set_config('request.jwt.claim.sub', :'buyer', true);
select set_config('request.jwt.claims', '{"sub":"' || :'buyer' || '","role":"authenticated"}', true);
set local role authenticated;

update public.reviews set body = 'An edited regression review'
 where transaction_id = :'txn' and reviewer_id = :'buyer';

reset role;

select p.rating_sum::text as sum_after_edit, p.rating_count::text as count_after_edit
  from public.profiles p
 where p.id = :'seller' \gset

select set_config('uni.regression.sum_after_edit',   :'sum_after_edit',   true),
       set_config('uni.regression.count_after_edit', :'count_after_edit', true);

-- Removing the review must rebuild the totals from the rows that are left.
delete from public.reviews where transaction_id = :'txn' and reviewer_id = :'buyer';

select p.rating_sum::text as sum_after_delete, p.rating_count::text as count_after_delete
  from public.profiles p
 where p.id = :'seller' \gset

select set_config('uni.regression.sum_after_delete',   :'sum_after_delete',   true),
       set_config('uni.regression.count_after_delete', :'count_after_delete', true);

do $$
declare
  v_sum_before    int;
  v_count_before  int;
  v_sum_insert    int;
  v_count_insert  int;
  v_sum_edit      int;
  v_count_edit    int;
  v_sum_delete    int;
  v_count_delete  int;
begin
  v_sum_before    := current_setting('uni.regression.sum_before')::int;
  v_count_before  := current_setting('uni.regression.count_before')::int;
  v_sum_insert    := current_setting('uni.regression.sum_after_insert')::int;
  v_count_insert  := current_setting('uni.regression.count_after_insert')::int;
  v_sum_edit      := current_setting('uni.regression.sum_after_edit')::int;
  v_count_edit    := current_setting('uni.regression.count_after_edit')::int;
  v_sum_delete    := current_setting('uni.regression.sum_after_delete')::int;
  v_count_delete  := current_setting('uni.regression.count_after_delete')::int;

  -- The new review lands.
  if v_sum_insert <> v_sum_before + 5 or v_count_insert <> v_count_before + 1 then
    raise exception 'the review did not reach the aggregate (%,% -> %,%)',
      v_sum_before, v_count_before, v_sum_insert, v_count_insert;
  end if;

  -- Editing the prose changes nothing.
  if v_sum_edit <> v_sum_insert or v_count_edit <> v_count_insert then
    raise exception 'editing a review moved the aggregate (%,% -> %,%)',
      v_sum_insert, v_count_insert, v_sum_edit, v_count_edit;
  end if;

  -- Removing it rebuilds the totals from the rows that are left.
  if v_sum_delete <> v_sum_before or v_count_delete <> v_count_before then
    raise exception 'removing a review left the aggregate stale (%,% -> %,%)',
      v_sum_before, v_count_before, v_sum_delete, v_count_delete;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. A review without a completed handover is refused.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'buyer', true);
select set_config('request.jwt.claims', '{"sub":"' || :'buyer' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_buyer  uuid := current_setting('uni.regression.buyer')::uuid;
  v_seller uuid := current_setting('uni.regression.seller')::uuid;
  v_txn    uuid;
begin
  -- A second handover that nobody confirms.
  insert into public.transactions (listing_id, buyer_id, seller_id, amount, swap_code)
  values (current_setting('uni.regression.listing')::uuid, v_buyer, v_seller, 0,
          'UH-UNCONFIRMED-' || substr(md5(random()::text), 1, 8));

  select id into v_txn from public.transactions
   where buyer_id = v_buyer and seller_id = v_seller and status <> 'completed'
   order by created_at desc
   limit 1;

  begin
    insert into public.reviews (transaction_id, reviewer_id, reviewee_id, rating)
    values (v_txn, v_buyer, v_seller, 5);
    raise exception 'a review was accepted without a completed handover';
  exception
    when others then
      if sqlerrm like 'a review was accepted%' then
        raise;
      end if;
  end;
end $$;

reset role;

rollback;

\echo 'UniHaat security regression suite: all checks passed.'
