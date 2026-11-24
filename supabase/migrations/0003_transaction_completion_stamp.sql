-- ============================================================================
-- UniHaat v1 — fix: completed_at was never persisted.
--
-- apply_transaction_completion() runs as an AFTER UPDATE trigger, where
-- assigning to NEW has no effect on the stored row. The timestamp is now
-- stamped by a BEFORE trigger; the AFTER trigger keeps doing the aggregates.
-- ============================================================================

create or replace function public.stamp_transaction_completion()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at = coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists on_transaction_completed_stamp on public.transactions;
create trigger on_transaction_completed_stamp
  before update on public.transactions
  for each row execute function public.stamp_transaction_completion();

-- The AFTER trigger no longer needs to touch NEW.
create or replace function public.apply_transaction_completion()
returns trigger
language plpgsql security definer set search_path = public
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
