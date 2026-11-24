-- ============================================================================
-- Delhi Technical Campus joins the college list.
--
-- A student with an address on `delhitechnicalcampus.ac.in` could not open
-- an account: the sign-up guard on `auth.users` refuses any address the
-- `colleges` table does not know, so Google sign-in came back as a
-- database error and the app reported it as "that is not a college
-- account".
--
-- The domain list is data, not code — a college is added by giving the
-- table a row with its mail domain. This is that row.
--
-- The write is written so it can be run twice: the insert only happens
-- when neither the short name nor the domain is there yet, and the update
-- only touches a row that is not already carrying the domain.
-- ============================================================================

insert into public.colleges (name, short_name, city, scope, email_domain)
select 'Delhi Technical Campus', 'DTC', 'Delhi', 'nearby', 'delhitechnicalcampus.ac.in'
 where not exists (select 1 from public.colleges where short_name = 'DTC')
   and not exists (select 1 from public.colleges where name = 'Delhi Technical Campus')
   and not exists (
     select 1 from public.colleges where email_domain = 'delhitechnicalcampus.ac.in'
   );

-- The row may already be there under the name, without the domain. Give
-- it the domain — unless another row already carries it.
update public.colleges
   set email_domain = 'delhitechnicalcampus.ac.in'
 where short_name = 'DTC'
   and email_domain is distinct from 'delhitechnicalcampus.ac.in'
   and not exists (
     select 1
       from public.colleges x
      where x.email_domain = 'delhitechnicalcampus.ac.in'
        and x.short_name <> colleges.short_name
   );

-- The guard reads the domain, so the list the browser asks for has to
-- carry it too. The index that finds it is a partial index over the
-- non-null domains; this row is inside it.
create index if not exists colleges_email_domain_idx
  on public.colleges (email_domain) where email_domain is not null;

-- The college list is public, so a student can read its own campus.
-- The row is inserted by the migration, so the client never writes here.
revoke insert, update, delete on public.colleges from anon, authenticated;
