-- ============================================================================
-- UniHaat v1 — fix: a finished transaction was not actually frozen.
--
-- Migration 0006 made a SafeSwap handover require both students to confirm.
-- But the guard returned early for a transaction that was already
-- 'completed', 'cancelled' or 'disputed', and that early return skipped the
-- checks on the confirmation columns. A party could therefore still stamp
-- or clear a confirmation on a finished transaction.
--
-- Nothing was credited by that on its own — the aggregate only fires when
-- the status changes, and the status can no longer change — but a finished
-- record could still be edited, which is not what "completed" should mean.
--
-- The guard now rejects any change to the confirmations or the swap code
-- once a transaction has reached a final state.
-- ============================================================================

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

  -- A finished transaction stays finished. Nothing about it may change:
  -- not the status, not the confirmations, not the swap code. This is what
  -- stops the completed -> agreed -> completed replay from crediting it
  -- twice.
  if old.status in ('completed', 'cancelled', 'disputed') then
    if new.status            is distinct from old.status
       or new.buyer_confirmed_at  is distinct from old.buyer_confirmed_at
       or new.seller_confirmed_at is distinct from old.seller_confirmed_at
       or new.swap_code       is distinct from old.swap_code then
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
    new.status := 'completed';
  elsif new.status not in ('agreed', 'awaiting_handover', 'cancelled', 'disputed') then
    raise exception 'unknown transaction status';
  end if;

  -- completed_at belongs to the moment the handover finished.
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;
