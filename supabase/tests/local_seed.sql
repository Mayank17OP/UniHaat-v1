-- ============================================================================
-- UniHaat v1 — local seed.
--
-- The demo data the SQL regression suites need: three students and one
-- active marketplace listing. The suites walk a handover from end to end,
-- so they need two students and something to buy.
--
-- The addresses are college addresses, so the signup guard lets them
-- through, and they are confirmed, so the verification check sees a
-- credential rather than a claim.
-- ============================================================================

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'alpha@dtu.ac.in', now(), '{"full_name":"Alpha"}'::jsonb, now()),
       ('bbbbbbbb-0000-4000-8000-000000000002', 'beta@dtu.ac.in',  now(), '{"full_name":"Beta"}'::jsonb,  now() + interval '1 second'),
       ('cccccccc-0000-4000-8000-000000000003', 'gamma@dtu.ac.in', now(), '{"full_name":"Gamma"}'::jsonb, now() + interval '2 seconds')
on conflict (id) do update set email_confirmed_at = now();

insert into public.profiles (id, email, full_name, role, student_id, verified, created_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'alpha@dtu.ac.in', 'Alpha', 'student', 'DTU/2K23/101', true, now()),
       ('bbbbbbbb-0000-4000-8000-000000000002', 'beta@dtu.ac.in',  'Beta',  'student', 'DTU/2K23/102', true, now() + interval '1 second'),
       ('cccccccc-0000-4000-8000-000000000003', 'gamma@dtu.ac.in', 'Gamma', 'student', 'DTU/2K23/103', true, now() + interval '2 seconds')
on conflict (id) do nothing;

insert into public.listings
  (seller_id, title, description, category_slug, listing_type, price, status, condition, campus_area, created_at)
values ('aaaaaaaa-0000-4000-8000-000000000001',
        'Hero Cycles', 'A dependable cycle for the ride home.',
        'sports', 'sell', 4500, 'active', 'Good', 'North Campus', now())
on conflict (id) do update set status = 'active';
