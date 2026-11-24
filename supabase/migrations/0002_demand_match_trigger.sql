-- ============================================================================
-- UniHaat v1 — fix: a demand created after a listing must still match it.
--
-- The listing trigger (on_listing_published) only fires when a listing is
-- written, so a demand posted afterwards never saw the existing inventory.
-- This adds the mirror-image trigger on demands.
--
-- Note on PL/pgSQL: the loop must iterate over a set, not a scalar column.
-- `for l in select id from ...` is a record loop; the scalar form
-- `for l in select id from ... loop ... end loop` with a bare uuid variable is
-- a syntax error (42601). The fix below uses `perform ... from` over a query
-- so no scalar variable is required.
-- ============================================================================

create or replace function public.on_demand_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Re-score every candidate listing against this demand.
  perform public.refresh_demand_matches(l.id)
    from public.listings l
   where l.status = 'active'
     and (new.category_slug is null or l.category_slug = new.category_slug);
  return coalesce(new, old);
end;
$$;

drop trigger if exists on_demand_created on public.demands;
create trigger on_demand_created
  after insert or update on public.demands
  for each row execute function public.on_demand_change();
