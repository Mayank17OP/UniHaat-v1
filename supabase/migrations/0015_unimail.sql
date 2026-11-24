-- ============================================================================
-- UniHaat v1 — UniMail: University Email & DNS Infrastructure
--
-- Tables:
--   unimail_universities  — approved universities
--   unimail_domains       — approved institutional email domains (explicit allowlist;
--                           arbitrary .edu / .ac.in domains are NOT trusted)
--   unimail_tokens        — SHA-256 hashed verification tokens with expiry
--   unimail_logs          — outbound email audit log (sent/delivered/failed/pending)
--   unimail_templates     — notification templates per marketplace event
-- ============================================================================

create table if not exists public.unimail_universities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.unimail_domains (
  id uuid primary key default gen_random_uuid(),
  university_id uuid references public.unimail_universities(id) on delete cascade,
  college_id uuid references public.colleges(id) on delete set null,
  domain text not null unique,
  enabled boolean not null default true,
  verified_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.unimail_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists unimail_tokens_email_idx on public.unimail_tokens (lower(email));

create table if not exists public.unimail_logs (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  event_type text not null,
  subject text not null,
  status text not null check (status in ('sent', 'delivered', 'failed', 'pending')),
  message_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists unimail_logs_created_idx on public.unimail_logs (created_at desc);

create table if not exists public.unimail_templates (
  id uuid primary key default gen_random_uuid(),
  event_type text not null unique,
  subject text not null,
  body_preview text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Seed universities & approved domains
insert into public.unimail_universities (short_name, name) values
  ('DTU', 'Delhi Technological University'),
  ('DU', 'University of Delhi'),
  ('IITD', 'Indian Institute of Technology Delhi'),
  ('JMI', 'Jamia Millia Islamia'),
  ('AMITY', 'Amity University'),
  ('IPU', 'Guru Gobind Singh Indraprastha University'),
  ('NSUT', 'Netaji Subhas University of Technology'),
  ('DTC', 'Delhi Technical Campus')
on conflict (short_name) do nothing;

insert into public.unimail_domains (university_id, domain, enabled)
select u.id, d.domain, true
from (values
  ('DTU', 'dtu.ac.in'),
  ('DU', 'du.ac.in'),
  ('DU', 'hansrajcollege.ac.in'),
  ('IITD', 'iitd.ac.in'),
  ('JMI', 'jmi.ac.in'),
  ('AMITY', 'amity.edu'),
  ('IPU', 'ipu.ac.in'),
  ('NSUT', 'nsut.ac.in'),
  ('DTC', 'delhitechnicalcampus.ac.in')
) as d(uni_short, domain)
join public.unimail_universities u on u.short_name = d.uni_short
on conflict (domain) do nothing;

-- Seed notification templates
insert into public.unimail_templates (event_type, subject, body_preview) values
  ('student_registration', 'Welcome to UniHaat — Verify your campus email', 'Your UniHaat account was created. Verify your institutional email to unlock selling and SafeSwap.'),
  ('email_verification', 'UniMail Verification Code for {{college}}', 'Click the verification link or enter your token. Expires in 15 minutes.'),
  ('product_enquiry', 'New enquiry on "{{item}}"', 'A verified student sent you a message about your listing.'),
  ('purchase_confirmation', 'Order confirmed: {{item}} ({{price}})', 'Your purchase is confirmed. Use SafeSwap QR at pickup.'),
  ('rental_request', 'New UniReserve rental request for {{item}}', 'A student requested to rent your item. Review and approve or decline.'),
  ('rental_approved', 'Rental approved: {{item}}', 'Your UniReserve rental request was approved. Pickup details inside.'),
  ('rental_rejected', 'Rental request declined: {{item}}', 'Your rental request was declined by the owner.'),
  ('exchange_update', 'Exchange update for {{item}}', 'There is a new update on your campus item exchange.'),
  ('wishlist_alert', 'Wishlist alert: {{item}} price or availability changed', 'An item on your UniHaat wishlist has been updated.'),
  ('safeswap_handover', 'SafeSwap handover confirmed for {{item}}', 'Both parties confirmed the campus handover. Receipt attached.'),
  ('security_alert', 'UniHaat security alert', 'Password reset or security event detected on your account.')
on conflict (event_type) do nothing;

-- RLS: public read on universities, domains, templates; server-only write on tokens/logs
alter table public.unimail_universities enable row level security;
alter table public.unimail_domains enable row level security;
alter table public.unimail_tokens enable row level security;
alter table public.unimail_logs enable row level security;
alter table public.unimail_templates enable row level security;

drop policy if exists unimail_universities_read on public.unimail_universities;
create policy unimail_universities_read on public.unimail_universities for select to anon, authenticated using (true);

drop policy if exists unimail_domains_read on public.unimail_domains;
create policy unimail_domains_read on public.unimail_domains for select to anon, authenticated using (true);

drop policy if exists unimail_templates_read on public.unimail_templates;
create policy unimail_templates_read on public.unimail_templates for select to anon, authenticated using (true);

-- Tokens and logs are managed by service_role (UniMail backend)
revoke all on public.unimail_tokens from anon, authenticated;
revoke all on public.unimail_logs from anon, authenticated;
