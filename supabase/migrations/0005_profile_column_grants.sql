-- ============================================================================
-- UniHaat v1 — fix: students could rewrite their own reputation, and promote
-- themselves to staff.
--
-- The RLS policy "students update own profile" is row-scoped but not
-- column-scoped, so a student could PATCH any column of their own row:
--
--   UPDATE profiles SET verified = true, rating_sum = 500 WHERE id = <me>
--   UPDATE profiles SET role = 'admin'          WHERE id = <me>
--
-- The second one escalates: is_staff() reads profiles.role, so once a
-- student is 'admin' the "staff update any profile" policy lets them edit
-- every other student's verification and ratings.
--
-- The fix is a column-scoped grant. Students keep the fields they are
-- supposed to own (name, avatar, bio, college, ...) and lose everything the
-- server owns (verified, role, rating_*, deals_completed, saved_rupees,
-- items_reused, items_given). The legitimate verification path moves behind
-- a SECURITY DEFINER function so the client never writes `verified` itself.
-- ============================================================================

-- 1. Students may only write the columns they own.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, bio, department, year_of_study, college_id, student_id)
  on public.profiles to authenticated;

-- 2. A profile can never be created pre-verified or pre-promoted.
drop policy if exists "students insert own profile" on public.profiles;
create policy "students insert own profile" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id and verified = false and role = 'student');

drop policy if exists "students update own profile" on public.profiles;
create policy "students update own profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 3. The legitimate verification path, owned by the server.
--    Matches the prototype's "any college email verifies instantly" rule,
--    but the student can only ever verify *themselves*.
create or replace function public.claim_student_verification(
  p_college_short text default null,
  p_student_id    text default null
)
returns public.profiles
language plpgsql
security definer
set search_path to public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  update public.profiles p
     set verified = true,
         verified_at = now(),
         student_id = coalesce(nullif(p_student_id, ''), p.student_id)
   where p.id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'profile not found';
  end if;

  if p_college_short is not null then
    update public.profiles p
       set college_id = c.id
      from public.colleges c
     where p.id = v_uid and c.short_name = p_college_short
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.claim_student_verification(text, text) to authenticated;

-- 4. Moderation stays server-side too, so staff never needs a table grant.
create or replace function public.staff_update_profile(
  p_target uuid,
  p_patch  jsonb
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if not public.is_staff() then
    raise exception 'staff only';
  end if;

  -- Only the server-owned columns may be moderated.
  update public.profiles p
     set verified      = coalesce((p_patch ->> 'verified')::boolean, p.verified),
         verified_at   = coalesce((p_patch ->> 'verified_at')::timestamptz, p.verified_at),
         rating_sum    = coalesce((p_patch ->> 'rating_sum')::int, p.rating_sum),
         rating_count  = coalesce((p_patch ->> 'rating_count')::int, p.rating_count),
         deals_completed = coalesce((p_patch ->> 'deals_completed')::int, p.deals_completed),
         saved_rupees  = coalesce((p_patch ->> 'saved_rupees')::numeric, p.saved_rupees),
         items_reused  = coalesce((p_patch ->> 'items_reused')::int, p.items_reused),
         items_given   = coalesce((p_patch ->> 'items_given')::int, p.items_given),
         role          = coalesce(p_patch ->> 'role', p.role)
   where p.id = p_target
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.staff_update_profile(uuid, jsonb) to authenticated;
