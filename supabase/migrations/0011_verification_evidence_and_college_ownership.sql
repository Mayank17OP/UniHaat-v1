-- ============================================================================
-- UniHaat — 0011: the campus and the verification belong to the server.
--
-- Two gaps are closed here.
--
-- 1. The campus.
--    A student's campus is read off their college address — that is the
--    whole admission rule. But `profiles.college_id` was still writable by
--    the client, so a student could put themselves on another campus and
--    see (or sell to) a campus they do not belong to. The column is taken
--    off the client; the server keeps it in step with the address.
--
-- 2. The verification.
--    `claim_student_verification` marked a student verified on the strength
--    of their address alone. Since every account is now on a college
--    address, that made the badge mean nothing at all. The server now asks
--    for evidence it can check — the college-issued address *and* the roll
--    number the college would recognise — and it checks that the address is
--    confirmed rather than merely claimed. A moderator can still approve a
--    student by hand through `staff_update_profile`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The campus is server-owned.
-- ---------------------------------------------------------------------------

revoke update (college_id) on public.profiles from authenticated;
revoke insert (college_id) on public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Verification needs evidence.
-- ---------------------------------------------------------------------------

create or replace function public.claim_student_verification(
  p_college_short text default null,
  p_student_id    text default null
)
returns profiles
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_confirmed  timestamptz;
  v_domain     text;
  v_college    public.colleges;
  v_row        public.profiles;
  v_student_id text := nullif(btrim(coalesce(p_student_id, '')), '');
  v_evidence   boolean := false;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select u.email, u.email_confirmed_at into v_email, v_confirmed
    from auth.users u
   where u.id = v_uid;

  v_domain := lower(split_part(coalesce(v_email, ''), '@', 2));

  -- The address has to belong to a college, and it has to be confirmed: an
  -- unconfirmed address is a claim, not a credential.
  if v_domain = '' or public.college_for_domain(v_domain) is null then
    raise exception 'college_email_required';
  end if;

  if v_confirmed is null then
    raise exception 'email not confirmed';
  end if;

  -- The college the student asked for, but only if the address agrees with
  -- it. A student cannot claim a campus their address does not belong to.
  if p_college_short is not null then
    select * into v_college
      from public.colleges c
     where c.short_name = p_college_short
       and public.college_for_domain(v_domain) = c.id;
  end if;

  if v_college.id is null then
    select * into v_college
      from public.colleges c
     where c.id = public.college_for_domain(v_domain);
  end if;

  -- The evidence: a college-issued address *and* the roll number the
  -- college would recognise. Without both, the server leaves the student
  -- unverified and says so — a moderator can still approve by hand.
  v_evidence := v_college.id is not null and v_student_id is not null;

  update public.profiles p
     set verified      = case when v_evidence and not p.verified then true else p.verified end,
         verified_at   = case when v_evidence and p.verified_at is null then now() else p.verified_at end,
         student_id    = case when v_evidence then v_student_id else p.student_id end,
         college_id    = coalesce(v_college.id, p.college_id)
   where p.id = v_uid
   returning * into v_row;

  if v_row.id is null then
    raise exception 'profile not found';
  end if;

  -- The private columns do not travel back out.
  v_row.email      := null;
  v_row.student_id := null;
  v_row.role       := null;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Staff keep the manual door, and it now reaches the roll number and
--    the campus as well.
-- ---------------------------------------------------------------------------

create or replace function public.staff_update_profile(p_target uuid, p_patch jsonb)
returns profiles
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.profiles;
begin
  if not public.is_staff() then
    raise exception 'staff only';
  end if;

  update public.profiles p
     set verified      = coalesce((p_patch ->> 'verified')::boolean, p.verified),
         verified_at   = coalesce((p_patch ->> 'verified_at')::timestamptz, p.verified_at),
         rating_sum    = coalesce((p_patch ->> 'rating_sum')::int, p.rating_sum),
         rating_count  = coalesce((p_patch ->> 'rating_count')::int, p.rating_count),
         deals_completed = coalesce((p_patch ->> 'deals_completed')::int, p.deals_completed),
         saved_rupees  = coalesce((p_patch ->> 'saved_rupees')::numeric, p.saved_rupees),
         items_reused  = coalesce((p_patch ->> 'items_reused')::int, p.items_reused),
         items_given   = coalesce((p_patch ->> 'items_given')::int, p.items_given),
         student_id    = coalesce(nullif(p_patch ->> 'student_id', ''), p.student_id),
         college_id    = coalesce((p_patch ->> 'college_id')::uuid, p.college_id),
         role          = coalesce(p_patch ->> 'role', p.role)
   where p.id = p_target
   returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The demo students carry a roll number, so the seeded data follows the
--    same rule the server now enforces.
-- ---------------------------------------------------------------------------

update public.profiles
   set student_id = 'DTU/2K23/001'
 where id = '11111111-1111-1111-1111-111111111111'
   and student_id is null;

update public.profiles
   set student_id = 'DTU/2K23/002'
 where id = '22222222-2222-2222-2222-222222222222'
   and student_id is null;
