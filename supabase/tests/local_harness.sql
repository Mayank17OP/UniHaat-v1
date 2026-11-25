-- ============================================================================
-- UniHaat v1 — local harness.
--
-- The parts of Supabase that the UniHaat migrations depend on. It lets the
-- real migrations run against a plain PostgreSQL so the SQL can be developed
-- and tested without a Supabase project.
--
-- It also reproduces the one thing that matters most for the tests: how
-- Supabase hands the `public` schema to the client roles. Supabase grants
-- every table, sequence and function to `anon`, `authenticated` and
-- `service_role` by default, and the migrations narrow that down where they
-- need to. A local database that started with fewer privileges would let a
-- migration pass that would fail in production.
-- ============================================================================

-- pgcrypto is not always installed. The schema only needs
-- gen_random_uuid() from it, and PostgreSQL 13 and later carry that in
-- the core, so a server without the contrib package still works. The
-- security suite is the only thing that needs the rest of it.
do $$
begin
  create extension if not exists pgcrypto;
exception when others then
  raise notice 'pgcrypto is not installed here — using the built-in gen_random_uuid()';
end $$;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create schema if not exists extensions;

grant usage on schema public to anon, authenticated, service_role;

-- The table GoTrue creates. Only the columns the migrations touch.
create table if not exists auth.users (
  id                 uuid primary key,
  instance_id        uuid,
  aud                text,
  role               text,
  email              text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text,
  provider text
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '')
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- The Supabase defaults for the `public` schema: every table, sequence and
-- function is handed to the client roles, and the migrations take back
-- whatever a client must not have.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
