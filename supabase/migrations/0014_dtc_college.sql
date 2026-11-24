-- ============================================================================
-- Delhi Technical Campus joins the campus map.
--
-- The college already has its mail domain — the sign-up guard migration
-- gave it that, so a student with a DTC address can open an account.
--
-- What it was missing was a position. A listing with no coordinates has
-- no honest distance from the student, so discovery sorts it last rather
-- than guessing. This gives DTC its gate on the map, and it gives the
-- listings that belong to it somewhere to be picked up from.
--
-- Two things are worth saying about the write:
--
--   * The column is `email_domain`. The colleges table has no `domain`
--     column, and an insert that names one fails outright.
--
--   * A coordinate that is already there is kept. This migration fills
--     in a missing position; it does not move a college that somebody
--     has already placed. It is written to be run twice.
-- ============================================================================

-- The row, if it is not there yet. It is not inserted when another
-- college already carries the domain — two colleges with the same mail
-- domain would make the sign-up guard ambiguous.
insert into public.colleges (short_name, name, email_domain, lat, lng)
select 'DTC', 'Delhi Technical Campus', 'delhitechnicalcampus.ac.in', 28.4744, 77.492
 where not exists (
   select 1 from public.colleges where email_domain = 'delhitechnicalcampus.ac.in'
 );

-- The position, for a row that is already there. The domain is only
-- given when no other college carries it.
update public.colleges c
   set email_domain = 'delhitechnicalcampus.ac.in',
       lat = coalesce(c.lat, 28.4744),
       lng = coalesce(c.lng, 77.492)
 where c.short_name = 'DTC'
   and not exists (
     select 1
       from public.colleges x
      where x.email_domain = 'delhitechnicalcampus.ac.in'
        and x.short_name <> c.short_name
   );

-- A listing from DTC with no coordinates of its own is picked up from
-- the college gate. That is the honest default: the distance shown is
-- the distance to the gate.
update public.listings l
   set lat = c.lat,
       lng = c.lng
  from public.colleges c
 where l.college_id = c.id
   and l.lat is null
   and c.lat is not null
   and c.lng is not null;
