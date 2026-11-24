-- ===========================================================================
-- Profile privilege and student verification on evidence.
--
-- Two gaps are closed here.
--
-- 1. `student_id` was writable by the student it belonged to. The column is
--    a claim about who somebody is, and a claim the claimant can edit is
--    not evidence. It is now written by the server, and only after the
--    server has checked something it can trust.
--
-- 2. `claim_student_verification` set `verified = true` for anybody who
--    called it. `verified` is what the product calls "student", and the
--    marketplace is campus-only, so it needs evidence too.
--
-- The evidence is the signer's own account address: a student proves they
-- study where they say they do by signing up with that college's email
-- domain. The college list carries the domain (`colleges.email_domain`),
-- and the domain decides the college -- not what the student typed into
-- the form.
--
-- Nothing here takes a right away. A student whose college has no domain
-- on file, or who signed up with a personal address, is simply not
-- verified. Staff can still confirm them by hand with
-- `staff_update_profile`, which stays the escape hatch.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The college list learns an email domain.
-- --------------------------------------------------------------------------

alter table public.colleges
  add column if not exists email_domain text;

alter table public.colleges
  drop constraint if exists colleges_email_domain_check;

alter table public.colleges
  add constraint colleges_email_domain_check
  check (email_domain is null
         or (email_domain = lower(email_domain) and email_domain not like '%@%'));

update public.colleges set email_domain = 'dtu.ac.in' where short_name = 'DTU';
update public.colleges set email_domain = 'du.ac.in'  where short_name = 'DU';
update public.colleges set email_domain = 'du.ac.in'  where short_name = 'Hansraj';
update public.colleges set email_domain = 'iitd.ac.in' where short_name = 'IIT Delhi';
update public.colleges set email_domain = 'jmi.ac.in'  where short_name = 'Jamia';
update public.colleges set email_domain = 'ipu.ac.in'  where short_name = 'IPU';
update public.colleges set email_domain = 'nsut.ac.in' where short_name = 'NSUT';
-- Amity is deliberately left blank. It runs many campuses on many domains,
-- and a wrong domain would lock real students out; staff can still confirm
-- those by hand.

create index if not exists colleges_email_domain_idx
  on public.colleges (email_domain) where email_domain is not null;

-- --------------------------------------------------------------------------
-- 2. The reference tables are read-only to clients.
--
-- They carried table level write grants that no policy ever allowed, so
-- they were inert -- but `colleges.email_domain` is now load bearing, and
-- a client that could edit the college list could point a domain at
-- itself and verify itself. The grants go, the read policy stays.
-- --------------------------------------------------------------------------

revoke insert, update, delete on public.colleges from anon, authenticated;
revoke insert, update, delete on public.categories from anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. `student_id` is no longer the student's to write.
-- --------------------------------------------------------------------------

revoke update (student_id) on public.profiles from authenticated;
revoke insert (student_id) on public.profiles from authenticated;

-- The sign-up trigger used to copy `student_id` out of the sign-up
-- metadata, which is exactly as trustworthy as the browser that sent it.
-- It is not taken from the form any more; the verification RPC writes it
-- once there is evidence.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  requested_college text;
  requested_name    text;
begin
  requested_college := coalesce(new.raw_user_meta_data ->> 'college', new.raw_user_meta_data ->> 'college_short');
  requested_name    := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');

  -- `student_id` is not taken from the sign-up metadata: the client can
  -- send anything it likes there, and a student id nobody checked is a
  -- claim, not evidence.
  insert into public.profiles (id, email, full_name, avatar_url, verified)
  values (new.id, new.email, requested_name, new.raw_user_meta_data ->> 'avatar_url', false)
  on conflict (id) do nothing;

  if requested_college is not null then
    update public.profiles p set college_id = c.id
      from public.colleges c
     where p.id = new.id and c.short_name = requested_college;
  end if;

  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 4. Verification needs evidence.
--
-- The college comes from the address on the account, not from the form.
-- The student's own claim is honoured when the domain agrees with it, and
-- ignored when it does not. `student_id` is written only on the same
-- condition, so the two always agree.
--
-- A profile that is already verified is left verified: this adds evidence,
-- it never removes a right.
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
       and lower(c.email_domain) = v_domain;
  end if;

  -- Otherwise, whichever college owns the domain.
  if v_college.id is null and v_domain <> '' then
    select * into v_college
      from public.colleges c
     where lower(c.email_domain) = v_domain
     order by c.short_name
     limit 1;
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
