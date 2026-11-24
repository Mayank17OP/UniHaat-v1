-- ============================================================================
-- UniHaat v1 — fix: a demand that is already "matched" must still accept
-- new listings.
--
-- refresh_demand_matches() only scanned demands with status = 'open'. The
-- moment a demand found its first match its status flipped to 'matched',
-- which permanently excluded it from every later scan. A better listing
-- published afterwards could never surface on a demand board that already
-- had one hit.
--
-- The fix scans both 'open' and 'matched' demands. The status transition is
-- still guarded, so an already-matched demand keeps its status.
-- ============================================================================

create or replace function public.refresh_demand_matches(target_listing uuid)
returns void
language plpgsql
security definer
set search_path to public
as $$
declare
  l record;
  d record;
  kw text;
  hit_count int;
  want_count int;
  relevance numeric;
  reasons text[];
  score numeric;
begin
  select * into l from public.listings where id = target_listing;
  if l is null or l.status <> 'active' then
    delete from public.demand_matches where listing_id = target_listing;
    return;
  end if;

  for d in
    select * from public.demands
    where status in ('open', 'matched')
      and (category_slug is null or category_slug = l.category_slug)
      and (budget_max is null or l.price <= budget_max * 1.15)
  loop
    want_count := 0;
    hit_count  := 0;
    for kw in
      select distinct w
      from unnest(regexp_split_to_array(lower(coalesce(d.title,'') || ' ' || coalesce(d.notes,'')), '[^a-z0-9]+')) w
      where length(w) > 2
        and w not in ('for','and','the','with','under','some','one','need','want','looking','my','from')
    loop
      want_count := want_count + 1;
      if lower(l.title || ' ' || coalesce(l.description,'') || ' ' || coalesce(l.accessories,'')) like '%' || kw || '%' then
        hit_count := hit_count + 1;
      end if;
    end loop;

    relevance := case when want_count = 0 then 0 else hit_count::numeric / want_count end;

    -- A category-only overlap is not a match: the demand must actually be
    -- about what this listing is.
    if want_count > 0 and relevance < 0.34 then
      continue;
    end if;

    reasons := array['Category ✓'];
    if hit_count > 0 then reasons := array_append(reasons, 'Keyword ✓'); end if;
    if d.budget_max is not null and l.price <= d.budget_max then
      reasons := array_append(reasons, 'Within budget ✓');
    end if;
    if l.distance_km is not null and l.distance_km <= 1.5 then
      reasons := array_append(reasons, l.distance_km::text || ' km ✓');
    end if;

    score := least(1.0,
      (case when want_count = 0 then 0.5 else relevance end) * 0.6
      + (case when d.budget_max is not null and l.price <= d.budget_max then 0.25 else 0 end)
      + (case when l.distance_km is not null and l.distance_km <= 1.5 then 0.15 else 0 end));

    insert into public.demand_matches (demand_id, listing_id, score, reasons)
    values (d.id, l.id, score, reasons)
    on conflict (demand_id, listing_id) do update set score = excluded.score, reasons = excluded.reasons;

    update public.demands set status = 'matched' where id = d.id and status = 'open';
  end loop;
end;
$$;
