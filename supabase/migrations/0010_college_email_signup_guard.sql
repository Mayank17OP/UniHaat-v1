-- ===========================================================================
-- College email addresses only.
--
-- UniHaat is a campus marketplace. "Verified students only" is the promise
-- the whole product is built on, and until now nothing checked it: any
-- address could open an account, and any address could then ask to be
-- marked as a student.
--
-- The rule is simple, and it is enforced by the database rather than by
-- the form:
--
--     An account may only exist on an address that belongs to one of the
--     colleges in the `colleges` table.
--
-- Two layers:
--
--   1. A BEFORE INSERT trigger on `auth.users`. Every path that creates an
--      account passes through that table -- the email sign-up form, the
--      Google round trip, the admin API, raw SQL -- so a single trigger
--      covers all of them and no account can exist without a college
--      address. A companion trigger on UPDATE OF email stops an account
--      being moved onto a personal address later.
--
--   2. `handle_new_user` reads the college off the address instead of
--      taking it from the dropdown. The college used to be whatever the
--      student picked, which is a claim; now it is derived from the domain
--      the server has already checked.
--
-- Sign-in follows from sign-up: an account cannot exist without a college
-- address, so there is nothing left to log in with.
--
-- The domain list is data, not code. A college is added by inserting a
-- row into `colleges` with its domain -- no migration, no redeploy.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The domain list.
--
--    0009 seeded these from the colleges' official mail domains. Two are
--    corrected here: Hansraj College issues addresses on its own domain
--    (`hansrajcollege.ac.in`) rather than the university's, and Amity's
--    campuses all sit under `amity.edu` -- `gn.amity.edu`,
--    `jpr.amity.edu`, `amity.edu` itself -- which is why the lookup below
--    matches sub-domains too.
-- --------------------------------------------------------------------------

update public.colleges set email_domain = 'hansrajcollege.ac.in' where short_name = 'Hansraj';
update public.colleges set email_domain = 'amity.edu' where short_name = 'Amity';

-- --------------------------------------------------------------------------
-- 2. One place that answers "which college owns this address".
--
--    Matching is by domain suffix, so a campus sub-domain counts as the
--    same college. The dot matters: `x.dtu.ac.in` is a DTU address, but
--    `notdtu.ac.in` is nobody's.
-- --------------------------------------------------------------------------

create or replace function public.college_for_domain(p_domain text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id
    from public.colleges c
   where c.email_domain is not null
     and (
          lower(p_domain) = lower(c.email_domain)
       or lower(p_domain) like '%.' || lower(c.email_domain)
     )
   order by c.short_name
   limit 1
$$;

revoke execute on function public.college_for_domain(text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. The guard.
--
--    This one lives on `auth.users` rather than on `public.profiles`
--    because that is where an account is created, and every way in --
--    sign-up, Google, the admin API -- ends up here.
-- --------------------------------------------------------------------------

create or replace function public.guard_college_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_domain text;
begin
  v_domain := lower(split_part(coalesce(new.email, ''), '@', 2));

  if v_domain = '' or public.college_for_domain(v_domain) is null then
    raise exception 'college_email_required';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_auth_user_college_email on auth.users;
create trigger guard_auth_user_college_email
  before insert on auth.users
  for each row execute function public.guard_college_email();

drop trigger if exists guard_auth_user_college_email_update on auth.users;
create trigger guard_auth_user_college_email_update
  before update of email on auth.users
  for each row execute function public.guard_college_email();

-- --------------------------------------------------------------------------
-- 4. The college comes from the address.
--
--    The sign-up form used to send a college short name in the user
--    metadata and the trigger believed it. Now the college is read off the
--    domain -- the same rule the guard just applied -- so the two can
--    never disagree.
-- --------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  requested_name  text;
  v_college_id    uuid;
begin
  requested_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');

  -- `student_id` is not taken from the sign-up metadata: the client can
  -- send anything it likes there, and a student id nobody checked is a
  -- claim, not evidence.
  insert into public.profiles (id, email, full_name, avatar_url, verified)
  values (new.id, new.email, requested_name, new.raw_user_meta_data ->> 'avatar_url', false)
  on conflict (id) do nothing;

  -- The college comes from the address, not from the form.
  v_college_id := public.college_for_domain(lower(split_part(coalesce(new.email, ''), '@', 2)));

  if v_college_id is not null then
    update public.profiles p set college_id = v_college_id
     where p.id = new.id;
  end if;

  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 5. Verification asks the same question the guard asked.
--
--    0009 matched the domain exactly. Amity's campuses sit on
--    sub-domains, so a student who signed up as `gn.amity.edu` could open
--    an account but could not be verified. One lookup, one rule.
-- --------------------------------------------------------------------------

create or replace function public.claim_student_verification(
  p_college_short text default null,
  p_student_id    text default null
)
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_domain  text;
  v_college public.colleges;
  v_row     public.profiles;
  v_matched boolean := false;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  v_domain := lower(split_part(coalesce(v_email, ''), '@', 2));

  -- The college the student named, but only when the address agrees.
  if p_college_short is not null and v_domain <> '' then
    select * into v_college
      from public.colleges c
     where c.short_name = p_college_short
       and public.college_for_domain(v_domain) = c.id;
  end if;

  -- Otherwise, whichever college owns the domain.
  if v_college.id is null and v_domain <> '' then
    select * into v_college
      from public.colleges c
     where c.id = public.college_for_domain(v_domain);
  end if;

  v_matched := v_college.id is not null;

  update public.profiles p
     set verified    = case when v_matched and not p.verified then true else p.verified end,
         verified_at = case when v_matched and p.verified_at is null then now() else p.verified_at end,
         student_id  = case when v_matched then coalesce(nullif(p_student_id, ''), p.student_id) else p.student_id end,
         college_id  = coalesce(v_college.id, p.college_id)
   where p.id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'profile not found';
  end if;

  -- The client may not read these columns, so the row it gets back must
  -- not carry them either.
  v_row.email      := null;
  v_row.student_id := null;
  v_row.role       := null;

  return v_row;
end;
$$;

revoke execute on function public.claim_student_verification(text, text) from public, anon;
grant execute on function public.claim_student_verification(text, text) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 6. The seeded accounts move onto college addresses.
--
--    The demo profiles were created with a placeholder address
--    (`demo.seller@unihaat.app`) while their `profiles.email` already
--    carried the real one. The placeholder is not a college address, so
--    under the rule above it could not sign in. This moves the accounts
--    onto the addresses the profiles already claim.
-- --------------------------------------------------------------------------

update auth.users
   set email = 'aarav.sharma@dtu.ac.in'
 where id = '11111111-1111-1111-1111-111111111111'
   and email = 'demo.seller@unihaat.app';

update auth.users
   set email = 'sana.kapoor@dtu.ac.in'
 where id = '22222222-2222-2222-2222-222222222222'
   and email = 'demo.seller2@unihaat.app';

update public.profiles
   set email = 'aarav.sharma@dtu.ac.in'
 where id = '11111111-1111-1111-1111-111111111111'
   and email = 'demo.seller@unihaat.app';

update public.profiles
   set email = 'sana.kapoor@dtu.ac.in'
 where id = '22222222-2222-2222-2222-222222222222'
   and email = 'demo.seller2@unihaat.app';

-- --------------------------------------------------------------------------
-- 7. Accounts that are not on a college address are removed.
--
--    The guard stops a new one being created, but the rule has to hold of
--    the accounts that already exist too -- otherwise "college email only"
--    would be true of sign-ups and false of sign-ins. This removes every
--    account whose address does not belong to a college, together with the
--    session, the identity and the profile that hang off it.
-- --------------------------------------------------------------------------

delete from auth.users u
 where u.email is null
    or public.college_for_domain(lower(split_part(coalesce(u.email, ''), '@', 2))) is null;
