-- ============================================================================
-- UniHaat v1 — location-based product discovery.
--
-- "Nearby" needs a real answer: how far is this listing from where the
-- student actually is? This migration gives the marketplace the
-- coordinates to answer with, and the functions to ask.
--
--   listings.lat / listings.lng   — where the listing is picked up from.
--                                   Written at publish time from the
--                                   seller's known location, or backfilled
--                                   from the college gate. A listing with
--                                   no coordinates has no honest distance,
--                                   so discovery sorts it last rather than
--                                   guessing.
--   colleges.lat / colleges.lng   — the campus gate. Already existed; this
--                                   migration seeds the Delhi cluster.
--   profiles.last_lat / last_lng  — the student's own last known location,
--                                   so discovery survives a reload and a
--                                   new device. PRIVATE: no client grant
--                                   at all. The student reads and writes it
--                                   only through the functions below, and
--                                   only for themselves.
--
-- The distance maths is haversine on the server, so `nearby_listings`
-- can order by it and the browser never has to page through the whole
-- catalogue to find what is close. No PostGIS: the campus is small, the
-- formula is exact enough, and the migration stays portable to a plain
-- PostgreSQL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Coordinates on listings and profiles.
-- ---------------------------------------------------------------------------

alter table public.listings
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table public.listings
  drop constraint if exists listings_lat_check;
alter table public.listings
  add constraint listings_lat_check
  check (lat is null or (lat >= -90 and lat <= 90));

alter table public.listings
  drop constraint if exists listings_lng_check;
alter table public.listings
  add constraint listings_lng_check
  check (lng is null or (lng >= -180 and lng <= 180));

-- The pair is either both present or both absent: half a coordinate is
-- not a location.
alter table public.listings
  drop constraint if exists listings_coords_pair_check;
alter table public.listings
  add constraint listings_coords_pair_check
  check ((lat is null) = (lng is null));

create index if not exists listings_coords_idx
  on public.listings (lat, lng)
  where status = 'active' and lat is not null;

alter table public.profiles
  add column if not exists last_lat double precision,
  add column if not exists last_lng double precision,
  add column if not exists location_label text,
  add column if not exists location_updated_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_last_lat_check;
alter table public.profiles
  add constraint profiles_last_lat_check
  check (last_lat is null or (last_lat >= -90 and last_lat <= 90));

alter table public.profiles
  drop constraint if exists profiles_last_lng_check;
alter table public.profiles
  add constraint profiles_last_lng_check
  check (last_lng is null or (last_lng >= -180 and last_lng <= 180));

alter table public.profiles
  drop constraint if exists profiles_location_pair_check;
alter table public.profiles
  add constraint profiles_location_pair_check
  check ((last_lat is null) = (last_lng is null));

-- ---------------------------------------------------------------------------
-- 2. Campus gates for the Delhi cluster.
-- ---------------------------------------------------------------------------

update public.colleges set lat = 28.75,  lng = 77.1177 where short_name = 'DTU';
update public.colleges set lat = 28.686, lng = 77.211  where short_name = 'DU';
update public.colleges set lat = 28.677, lng = 77.206  where short_name = 'Hansraj';
update public.colleges set lat = 28.545, lng = 77.192  where short_name = 'IIT Delhi';
update public.colleges set lat = 28.516, lng = 77.279  where short_name = 'Jamia';
update public.colleges set lat = 28.546, lng = 77.232  where short_name = 'Amity';
update public.colleges set lat = 28.585, lng = 77.05   where short_name = 'IPU';
update public.colleges set lat = 28.61,  lng = 77.037  where short_name = 'NSUT';

-- A listing that knows its college but no coordinates is picked up from
-- the college gate. That is the honest default: the distance shown is
-- the distance to the gate, and the seller can publish a tighter point
-- later.
update public.listings l
   set lat = c.lat,
       lng = c.lng
  from public.colleges c
 where l.college_id = c.id
   and l.lat is null
   and c.lat is not null
   and c.lng is not null;

-- ---------------------------------------------------------------------------
-- 3. Haversine distance.
-- ---------------------------------------------------------------------------

create or replace function public.haversine_km(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = public
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null
      then null
    else
      2 * 6371 * asin(least(1, sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      )))
  end
$$;

-- ---------------------------------------------------------------------------
-- 4. Nearby listings, nearest first.
--
-- Security invoker on purpose: the row policies of `listings` apply, so
-- only active listings (or the caller's own) come back, exactly as a
-- direct select would return. The radius is optional; when it is given,
-- listings with no coordinates are excluded — a radius the listing
-- cannot be measured against is not a radius it is inside.
-- ---------------------------------------------------------------------------

create or replace function public.nearby_listings(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default null,
  p_limit int default 50
)
returns setof public.listings
language sql
stable
set search_path = public
as $$
  select l.*
    from public.listings l
   where l.status = 'active'
     and p_lat is not null
     and p_lng is not null
     and (p_radius_km is null or p_radius_km <= 0
          or public.haversine_km(p_lat, p_lng, l.lat, l.lng) <= p_radius_km)
   order by public.haversine_km(p_lat, p_lng, l.lat, l.lng) nulls last,
            l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

-- ---------------------------------------------------------------------------
-- 5. The student's own location, behind functions.
--
-- The columns carry no client grant, so the only way in or out is here.
-- The functions are SECURITY DEFINER because they touch a row the
-- caller may not read directly — and each one names the caller
-- explicitly, so a student can only ever save, read or clear their own
-- location.
-- ---------------------------------------------------------------------------

create or replace function public.save_my_location(
  p_lat double precision,
  p_lng double precision,
  p_label text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid coordinates';
  end if;

  update public.profiles
     set last_lat = p_lat,
         last_lng = p_lng,
         location_label = nullif(trim(coalesce(p_label, '')), ''),
         location_updated_at = now()
   where id = v_uid;

  if not found then
    raise exception 'profile not found';
  end if;
end;
$$;

create or replace function public.get_my_location()
returns table (
  lat double precision,
  lng double precision,
  label text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.last_lat, p.last_lng, p.location_label, p.location_updated_at
    from public.profiles p
   where p.id = auth.uid()
$$;

create or replace function public.clear_my_location()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  update public.profiles
     set last_lat = null,
         last_lng = null,
         location_label = null,
         location_updated_at = null
   where id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Function surface: only the discovery functions stay callable.
-- ---------------------------------------------------------------------------

revoke execute on function public.haversine_km(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.haversine_km(double precision, double precision, double precision, double precision)
  to service_role;

revoke execute on function public.nearby_listings(double precision, double precision, double precision, int)
  from public, anon;
grant execute on function public.nearby_listings(double precision, double precision, double precision, int)
  to anon, authenticated, service_role;

revoke execute on function public.save_my_location(double precision, double precision, text)
  from public, anon;
grant execute on function public.save_my_location(double precision, double precision, text)
  to authenticated, service_role;

revoke execute on function public.get_my_location()
  from public, anon;
grant execute on function public.get_my_location()
  to authenticated, service_role;

revoke execute on function public.clear_my_location()
  from public, anon;
grant execute on function public.clear_my_location()
  to authenticated, service_role;
