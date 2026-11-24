-- ============================================================================
-- UniHaat v1 — fix: a student could mint their own reputation.
--
-- Two holes, both reachable with nothing but the publishable (anon) key and
-- a signed-in student session.
--
-- 1. Transactions were self-certifying.
--
--    "parties create transactions" let a student create a transaction naming
--    any other student as the seller, for a listing that had nothing to do
--    with that seller. "parties update transactions" then let that same
--    student set the status straight to 'completed', with no handover and no
--    involvement from the other party. The completion trigger credited both
--    sides, so the attacker could hand themselves:
--
--      deals_completed += 1, items_reused += 1, saved_rupees += amount
--
--    with amount being any number they liked (999999 was accepted). The
--    same UPDATE could then be replayed — completed -> agreed -> completed —
--    and the aggregate fired again, because the trigger only checked that
--    the status had changed, not that it had not already been completed.
--
--    The schema already had buyer_confirmed_at and seller_confirmed_at.
--    Nothing read them. A SafeSwap handover is a two-party event, so those
--    columns are now what actually gate completion.
--
-- 2. profiles could be inserted with counters.
--
--    "students insert own profile" checked verified and role, but not
--    rating_sum, rating_count, deals_completed, saved_rupees, items_reused
--    or items_given. Today the signup trigger creates the row first, so an
--    INSERT hits the primary key — but that is a coincidence, not a
--    control. The INSERT grant is now scoped to the columns a student owns,
--    and the policy pins the server-owned columns to their defaults.
--
-- The verification and moderation RPCs from migration 0005 are unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Transactions: a handover needs both students.
-- ---------------------------------------------------------------------------

create or replace function public.guard_transaction_state()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  v_listing    public.listings%rowtype;
  v_actor      uuid   := auth.uid();
  v_staff      boolean := public.is_staff();
  v_max_amount numeric;
begin
  -- ------------------------------ insert ------------------------------
  if tg_op = 'INSERT' then
    select * into v_listing from public.listings where id = new.listing_id;
    if v_listing.id is null then
      raise exception 'that listing no longer exists';
    end if;

    -- The other side has to be the student who actually owns the listing.
    if new.seller_id <> v_listing.seller_id then
      raise exception 'the seller must be the owner of the listing';
    end if;
    if new.buyer_id = new.seller_id then
      raise exception 'the buyer and the seller must be different students';
    end if;

    -- The amount is bounded by what the listing asks for, so saved_rupees
    -- can never be inflated past the value of the goods involved.
    v_max_amount := case when v_listing.listing_type = 'rent'
                         then coalesce(v_listing.rent_per_month, 0)
                         else coalesce(v_listing.price, 0) end;
    if new.amount < 0 or new.amount > v_max_amount then
      raise exception 'the amount must be between 0 and the listed price (%)',
        v_max_amount;
    end if;

    -- A transaction starts open. No back-dated confirmations.
    new.status := case when new.status = 'awaiting_handover'
                       then 'awaiting_handover' else 'agreed' end;
    new.buyer_confirmed_at  := null;
    new.seller_confirmed_at := null;
    new.completed_at        := null;
    return new;
  end if;

  -- ------------------------------ update ------------------------------
  -- The listing, the two parties and the price are fixed for good.
  if new.listing_id  is distinct from old.listing_id
     or new.buyer_id  is distinct from old.buyer_id
     or new.seller_id is distinct from old.seller_id
     or new.amount    is distinct from old.amount then
    raise exception 'the listing, the two students and the amount cannot be changed';
  end if;

  -- A finished transaction stays finished. This is what stops the
  -- completed -> agreed -> completed replay from crediting it twice.
  if old.status in ('completed', 'cancelled', 'disputed') then
    if new.status is distinct from old.status then
      raise exception 'this transaction is already %', old.status;
    end if;
    return new;
  end if;

  -- Only the student whose confirmation it is may stamp it.
  if new.buyer_confirmed_at is distinct from old.buyer_confirmed_at
     and not v_staff and v_actor is not null and v_actor is distinct from old.buyer_id then
    raise exception 'only the buyer can confirm the handover';
  end if;
  if new.seller_confirmed_at is distinct from old.seller_confirmed_at
     and not v_staff and v_actor is not null and v_actor is distinct from old.seller_id then
    raise exception 'only the seller can confirm the handover';
  end if;

  -- The SafeSwap code may only be reissued before anyone has confirmed.
  if new.swap_code is distinct from old.swap_code
     and (old.buyer_confirmed_at is not null or old.seller_confirmed_at is not null) then
    raise exception 'the swap code cannot change once a student has confirmed';
  end if;

  -- Completion needs both sides.
  if new.status = 'completed' then
    if new.buyer_confirmed_at is null or new.seller_confirmed_at is null then
      raise exception 'both students must confirm the handover before it completes';
    end if;
  elsif new.buyer_confirmed_at is not null and new.seller_confirmed_at is not null then
    -- The second confirmation is what completes the handover.
    new.status        := 'completed';
    new.completed_at  := coalesce(new.completed_at, now());
  elsif new.status not in ('agreed', 'awaiting_handover', 'cancelled', 'disputed') then
    raise exception 'unknown transaction status';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_transaction_state on public.transactions;
create trigger guard_transaction_state
  before insert or update on public.transactions
  for each row execute function public.guard_transaction_state();

-- The completion trigger now only ever sees a genuinely confirmed handover,
-- and it credits each side once.
create or replace function public.apply_transaction_completion()
returns trigger
language plpgsql security definer set search_path to public
as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    update public.listings set status = 'sold' where id = new.listing_id;

    update public.profiles
    set deals_completed = deals_completed + 1,
        items_reused    = items_reused + 1,
        saved_rupees    = saved_rupees + case when new.buyer_id = id then new.amount else 0 end
    where id in (new.buyer_id, new.seller_id);

    update public.profiles set items_given = items_given + 1 where id = new.seller_id and new.amount = 0;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. profiles: a student owns their own fields, the server owns the rest.
-- ---------------------------------------------------------------------------

-- Only these columns may be written when a profile row is created. The
-- counters, the verification flag and the role are not in the list, so they
-- take their defaults and cannot be supplied by the client.
revoke insert on public.profiles from anon, authenticated;
grant insert (id, full_name, avatar_url, bio, department, year_of_study, college_id, student_id)
  on public.profiles to authenticated;

-- A profile may not be deleted by the student. The row belongs to the
-- account, and auth.users owns its lifecycle (the FK cascades from there).
revoke delete on public.profiles from anon, authenticated;

drop policy if exists "students insert own profile" on public.profiles;
create policy "students insert own profile" on public.profiles
  for insert to authenticated
  with check (
    auth.uid() = id
    and verified = false
    and verified_at is null
    and role = 'student'
    and rating_sum = 0
    and rating_count = 0
    and deals_completed = 0
    and saved_rupees = 0
    and items_reused = 0
    and items_given = 0
  );

-- ---------------------------------------------------------------------------
-- 3. reviews: the score is part of the record, the prose is not.
-- ---------------------------------------------------------------------------

-- The rating and the parties are what the aggregate was computed from, so
-- they are fixed once the review exists. The body can still be edited.
revoke update on public.reviews from anon, authenticated;
grant update (body, condition_match) on public.reviews to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Privileges no client role needs.
-- ---------------------------------------------------------------------------

-- TRUNCATE is not covered by row level security, and no client role has
-- any business emptying a table.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reporting the totals a student is allowed to see about themselves.
-- ---------------------------------------------------------------------------

-- The profile menu reads deals_completed and items_reused. Both are now
-- written only by the server, so the read stays available; this is here to
-- document that no student-owned column can change them.
grant select on public.profiles to authenticated;
