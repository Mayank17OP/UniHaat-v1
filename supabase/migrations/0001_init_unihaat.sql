-- ============================================================================
-- UniHaat v1 — marketplace schema
-- Verified hyperlocal student-to-student marketplace (buy/sell/rent/exchange/
-- give away) with demand matching, product passports, secure handovers and
-- impact tracking.
--
-- Applied via: supabase create_migration (see scripts/README for the CLI path)
-- ============================================================================

-- pgcrypto is worth having, but it is not worth failing over: the only
-- thing the schema needs from it is gen_random_uuid(), and PostgreSQL
-- 13 and later carry that in the core. A server without the contrib
-- package still gets a working schema.
do $$
begin
  create extension if not exists pgcrypto;
exception when others then
  raise notice 'pgcrypto is not installed here — using the built-in gen_random_uuid()';
end $$;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.listing_type    as enum ('sell', 'rent', 'exchange', 'free');
create type public.listing_status  as enum ('active', 'reserved', 'sold', 'archived');
create type public.condition_grade as enum ('Like new', 'Good', 'Fair');
create type public.demand_status   as enum ('open', 'matched', 'fulfilled', 'expired', 'closed');
create type public.txn_status      as enum ('agreed', 'awaiting_handover', 'completed', 'cancelled', 'disputed');
create type public.report_reason   as enum ('spam', 'misleading', 'unsafe', 'price_fraud', 'inappropriate', 'other');
create type public.report_status   as enum ('open', 'reviewing', 'resolved', 'dismissed');

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.colleges (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  short_name text not null unique,
  city       text not null default 'Delhi',
  -- scope defines how listings from this college are grouped for discovery
  scope      text not null default 'same' check (scope in ('same', 'university', 'nearby')),
  lat        numeric(9,6),
  lng        numeric(9,6),
  created_at timestamptz not null default now()
);

create table public.categories (
  id       uuid primary key default gen_random_uuid(),
  slug     text not null unique,
  label    text not null,
  sort     int  not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles — 1:1 with auth.users, carries the student identity + reputation
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  full_name       text,
  avatar_url      text,
  college_id      uuid references public.colleges(id) on delete set null,
  student_id      text,
  department      text,
  year_of_study   int,
  bio             text,
  verified        boolean not null default false,
  verified_at     timestamptz,
  role            text not null default 'student' check (role in ('student', 'moderator', 'admin')),
  rating_sum      int not null default 0,
  rating_count    int not null default 0,
  deals_completed int not null default 0,
  saved_rupees    numeric(12,2) not null default 0,
  items_reused    int not null default 0,
  items_given     int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index profiles_college_idx on public.profiles (college_id);
create index profiles_verified_idx on public.profiles (verified) where verified;

-- ---------------------------------------------------------------------------
-- Listings — the marketplace inventory
-- Product Passport fields (accessories / repairs / battery) live here so the
-- condition card is a first-class part of the record, not free-text.
-- ---------------------------------------------------------------------------
create table public.listings (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references public.profiles(id) on delete cascade,
  title           text not null,
  description     text,
  listing_type    public.listing_type not null default 'sell',
  status          public.listing_status not null default 'active',
  category_slug   text not null references public.categories(slug) on update cascade,
  price           numeric(12,2) not null default 0 check (price >= 0),
  original_price  numeric(12,2),
  rent_per_month  numeric(10,2),
  exchange_for    text,
  -- Product Passport
  condition       public.condition_grade not null default 'Good',
  age_months      int not null default 0 check (age_months >= 0),
  accessories     text,
  repair_history  text,
  battery_health  int check (battery_health between 0 and 100),
  seller_attested boolean not null default false,
  -- Hostel clearance
  is_clearance    boolean not null default false,
  bundle_items    text,
  -- Location / pickup
  college_id      uuid references public.colleges(id) on delete set null,
  campus_area     text,
  distance_km     numeric(4,2),
  pickup_note     text,
  -- Commercials
  negotiable      boolean not null default true,
  views           int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint free_is_free check (listing_type <> 'free' or price = 0),
  constraint rent_has_rate check (listing_type <> 'rent' or rent_per_month is not null)
);

create index listings_status_idx   on public.listings (status) where status = 'active';
create index listings_category_idx on public.listings (category_slug);
create index listings_seller_idx   on public.listings (seller_id);
create index listings_college_idx  on public.listings (college_id);
create index listings_created_idx  on public.listings (created_at desc);

create table public.listing_images (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  url        text not null,
  alt        text,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create index listing_images_listing_idx on public.listing_images (listing_id);

-- ---------------------------------------------------------------------------
-- Wishlist — private per student
-- ---------------------------------------------------------------------------
create table public.wishlists (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ---------------------------------------------------------------------------
-- Demand Board — what students are looking for
-- ---------------------------------------------------------------------------
create table public.demands (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  notes         text,
  category_slug text references public.categories(slug) on update cascade,
  budget_max    numeric(12,2),
  college_id    uuid references public.colleges(id) on delete set null,
  needed_by     date,
  status        public.demand_status not null default 'open',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '30 days')
);

create index demands_open_idx on public.demands (status, category_slug) where status = 'open';
create index demands_user_idx on public.demands (user_id);

-- ---------------------------------------------------------------------------
-- UniMatch — demand <-> listing matches, with the reasons shown to the user
-- ---------------------------------------------------------------------------
create table public.demand_matches (
  id         uuid primary key default gen_random_uuid(),
  demand_id  uuid not null references public.demands(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  score      numeric(4,3) not null default 0 check (score >= 0),
  reasons    text[] not null default '{}',
  notified   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (demand_id, listing_id)
);

create index demand_matches_demand_idx on public.demand_matches (demand_id, score desc);

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  buyer_id   uuid not null references public.profiles(id) on delete cascade,
  seller_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, buyer_id, seller_id),
  constraint conversation_two_parties check (buyer_id <> seller_id)
);

create index conversations_buyer_idx  on public.conversations (buyer_id);
create index conversations_seller_idx on public.conversations (seller_id);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null check (length(body) between 1 and 4000),
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- SafeSwap — secure campus handover record
-- ---------------------------------------------------------------------------
create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  listing_id          uuid not null references public.listings(id) on delete cascade,
  buyer_id            uuid not null references public.profiles(id) on delete cascade,
  seller_id           uuid not null references public.profiles(id) on delete cascade,
  amount              numeric(12,2) not null default 0,
  swap_code           text not null unique,
  status              public.txn_status not null default 'agreed',
  pickup_spot         text,
  agreed_at           timestamptz default now(),
  buyer_confirmed_at  timestamptz,
  seller_confirmed_at timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  constraint txn_two_parties check (buyer_id <> seller_id)
);

create index transactions_buyer_idx  on public.transactions (buyer_id, status);
create index transactions_seller_idx on public.transactions (seller_id, status);

-- ---------------------------------------------------------------------------
-- Reviews & reports
-- ---------------------------------------------------------------------------
create table public.reviews (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  reviewer_id    uuid not null references public.profiles(id) on delete cascade,
  reviewee_id    uuid not null references public.profiles(id) on delete cascade,
  rating         int not null check (rating between 1 and 5),
  body           text,
  condition_match boolean,
  created_at     timestamptz not null default now(),
  unique (transaction_id, reviewer_id)
);

create index reviews_reviewee_idx on public.reviews (reviewee_id, created_at desc);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  listing_id  uuid references public.listings(id) on delete cascade,
  target_id   uuid references public.profiles(id) on delete cascade,
  reason      public.report_reason not null,
  details     text,
  status      public.report_status not null default 'open',
  created_at  timestamptz not null default now(),
  constraint report_has_target check (listing_id is not null or target_id is not null)
);

create index reports_status_idx on public.reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- UniImpact — community reuse + savings aggregates
-- ---------------------------------------------------------------------------
create view public.impact_summary as
select
  (select count(*) from public.profiles)::int                                  as students,
  (select count(*) from public.listings where status = 'active')::int           as active_listings,
  (select count(*) from public.transactions where status = 'completed')::int    as items_reused,
  (select coalesce(sum(t.amount), 0) from public.transactions t where t.status = 'completed')::numeric(12,2) as savings_rupees,
  (select count(*) from public.listings where listing_type = 'free')::int       as free_giveaways,
  (select count(*) from public.transactions where status = 'completed' and amount = 0)::int as free_handoffs;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('moderator', 'admin')
  );
$$;

create or replace function public.is_conversation_participant(conv_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.conversations
    where id = conv_id and (buyer_id = auth.uid() or seller_id = auth.uid())
  );
$$;

create or replace function public.is_transaction_party(txn_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.transactions
    where id = txn_id and (buyer_id = auth.uid() or seller_id = auth.uid())
  );
$$;

-- Create a profile the moment a student signs up (email, magic link or Google)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  requested_college text;
  requested_name    text;
begin
  requested_college := coalesce(new.raw_user_meta_data ->> 'college', new.raw_user_meta_data ->> 'college_short');
  requested_name    := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');

  insert into public.profiles (id, email, full_name, avatar_url, student_id, verified)
  values (
    new.id,
    new.email,
    requested_name,
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'student_id',
    false
  )
  on conflict (id) do nothing;

  -- Link the college by short name when one was chosen at signup
  if requested_college is not null then
    update public.profiles p
    set college_id = c.id
    from public.colleges c
    where p.id = new.id and c.short_name = requested_college;
  end if;

  return new;
end;
$$;

-- Keep rating aggregates on the profile in sync with reviews
create or replace function public.apply_review_aggregates()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
  set rating_sum   = rating_sum + new.rating,
      rating_count = rating_count + 1
  where id = new.reviewee_id;

  -- A review may only be left for a counterpart we actually transacted with
  if not exists (
    select 1 from public.transactions t
    where t.id = new.transaction_id
      and t.status = 'completed'
      and t.buyer_id = new.reviewer_id
      and t.seller_id = new.reviewee_id
  ) then
    raise exception 'reviews require a completed transaction with this seller';
  end if;

  return new;
end;
$$;

-- On a completed SafeSwap handover: close the listing and credit both students
create or replace function public.apply_transaction_completion()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    new.completed_at = coalesce(new.completed_at, now());

    update public.listings set status = 'sold' where id = new.listing_id;

    update public.profiles
    set deals_completed = deals_completed + 1,
        items_reused    = items_reused + 1,
        saved_rupees    = saved_rupees + case when new.buyer_id = id then new.amount else 0 end
    where id in (new.buyer_id, new.seller_id);

    update public.profiles
    set items_given = items_given + 1
    where id = new.seller_id and new.amount = 0;
  end if;

  return new;
end;
$$;

-- UniMatch: score open demands against a new/updated listing.
-- Category + keyword relevance first, then budget and distance.
create or replace function public.refresh_demand_matches(target_listing uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  l record;
  d record;
  kw text;
  hit_count int;
  want_count int;
  relevance numeric;
  reasons text[];
  score numeric;
begin
  select * into l from public.listings where id = target_listing;
  if l is null or l.status <> 'active' then
    delete from public.demand_matches where listing_id = target_listing;
    return;
  end if;

  for d in
    select * from public.demands
    where status = 'open'
      and (category_slug is null or category_slug = l.category_slug)
      and (budget_max is null or l.price <= budget_max * 1.15)
  loop
    -- keyword relevance between the demand title/notes and the listing
    want_count := 0;
    hit_count  := 0;
    for kw in
      select distinct w
      from unnest(regexp_split_to_array(lower(coalesce(d.title,'') || ' ' || coalesce(d.notes,'')), '[^a-z0-9]+')) w
      where length(w) > 2
        and w not in ('for','and','the','with','under','some','one','need','want','looking','my','from')
    loop
      want_count := want_count + 1;
      if lower(l.title || ' ' || coalesce(l.description,'') || ' ' || coalesce(l.accessories,'')) like '%' || kw || '%' then
        hit_count := hit_count + 1;
      end if;
    end loop;

    relevance := case when want_count = 0 then 0 else hit_count::numeric / want_count end;

    -- A category-only hit is not a match: demand real keyword overlap.
    if want_count > 0 and relevance < 0.34 then
      continue;
    end if;

    reasons := array['Category ✓'];
    if hit_count > 0 then reasons := array_append(reasons, 'Keyword ✓'); end if;
    if d.budget_max is not null and l.price <= d.budget_max then
      reasons := array_append(reasons, 'Within budget ✓');
    end if;
    if l.distance_km is not null and l.distance_km <= 1.5 then
      reasons := array_append(reasons, l.distance_km::text || ' km ✓');
    end if;

    score := least(1.0,
      (case when want_count = 0 then 0.5 else relevance end) * 0.6
      + (case when d.budget_max is not null and l.price <= d.budget_max then 0.25 else 0 end)
      + (case when l.distance_km is not null and l.distance_km <= 1.5 then 0.15 else 0 end));

    insert into public.demand_matches (demand_id, listing_id, score, reasons)
    values (d.id, l.id, score, reasons)
    on conflict (demand_id, listing_id)
    do update set score = excluded.score, reasons = excluded.reasons;

    update public.demands set status = 'matched' where id = d.id and status = 'open';
  end loop;
end;
$$;

create or replace function public.on_listing_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.refresh_demand_matches(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger listings_updated_at before update on public.listings
  for each row execute function public.set_updated_at();
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();
create trigger conversations_touch before update on public.conversations
  for each row execute function public.set_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger on_review_created
  after insert on public.reviews
  for each row execute function public.apply_review_aggregates();

create trigger on_transaction_completed
  after update on public.transactions
  for each row execute function public.apply_transaction_completion();

create trigger on_listing_published
  after insert or update on public.listings
  for each row execute function public.on_listing_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.colleges       enable row level security;
alter table public.categories     enable row level security;
alter table public.profiles       enable row level security;
alter table public.listings       enable row level security;
alter table public.listing_images enable row level security;
alter table public.wishlists      enable row level security;
alter table public.demands        enable row level security;
alter table public.demand_matches enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.transactions   enable row level security;
alter table public.reviews        enable row level security;
alter table public.reports        enable row level security;

-- Reference data: world-readable
create policy "colleges are public"   on public.colleges   for select using (true);
create policy "categories are public" on public.categories for select using (true);

-- Profiles: directory is readable by everyone; writes are self-only
create policy "profiles are readable" on public.profiles for select using (true);
create policy "students insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "students update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "staff update any profile" on public.profiles for update using (public.is_staff());

-- Listings: active ones are browsable, everything else is owner/staff only
create policy "active listings are public" on public.listings for select
  using (status = 'active' or seller_id = auth.uid() or public.is_staff());
create policy "students create own listings" on public.listings for insert
  with check (auth.uid() = seller_id);
create policy "students update own listings" on public.listings for update
  using (auth.uid() = seller_id) with check (auth.uid() = seller_id);
create policy "students delete own listings" on public.listings for delete
  using (auth.uid() = seller_id);
create policy "staff manage listings" on public.listings for all using (public.is_staff()) with check (public.is_staff());

-- Listing images follow the visibility of their listing
create policy "listing images follow listing" on public.listing_images for select
  using (exists (
    select 1 from public.listings l
    where l.id = listing_id
      and (l.status = 'active' or l.seller_id = auth.uid() or public.is_staff())
  ));
create policy "sellers manage own listing images" on public.listing_images for all
  using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()));

-- Wishlist is strictly private
create policy "students read own wishlist" on public.wishlists for select using (auth.uid() = user_id);
create policy "students add to own wishlist" on public.wishlists for insert with check (auth.uid() = user_id);
create policy "students remove from own wishlist" on public.wishlists for delete using (auth.uid() = user_id);

-- Demands: open ones are visible so sellers can find them
create policy "open demands are public" on public.demands for select
  using (status = 'open' or user_id = auth.uid() or public.is_staff());
create policy "students create own demands" on public.demands for insert with check (auth.uid() = user_id);
create policy "students update own demands" on public.demands for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "students delete own demands" on public.demands for delete using (auth.uid() = user_id);

-- Matches: visible to the demand owner and the listing owner
create policy "matches visible to participants" on public.demand_matches for select
  using (
    public.is_staff()
    or exists (select 1 from public.demands d where d.id = demand_id and d.user_id = auth.uid())
    or exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
  );
create policy "staff manage matches" on public.demand_matches for all using (public.is_staff()) with check (public.is_staff());

-- Chat: participants only
create policy "participants read conversations" on public.conversations for select
  using (auth.uid() = buyer_id or auth.uid() = seller_id or public.is_staff());
create policy "participants create conversations" on public.conversations for insert
  with check (auth.uid() = buyer_id or auth.uid() = seller_id);
create policy "participants read messages" on public.messages for select
  using (public.is_conversation_participant(conversation_id) or public.is_staff());
create policy "participants send messages" on public.messages for insert
  with check (
    auth.uid() = sender_id
    and public.is_conversation_participant(conversation_id)
  );
create policy "participants mark read" on public.messages for update
  using (public.is_conversation_participant(conversation_id))
  with check (public.is_conversation_participant(conversation_id));

-- Transactions: the two parties only
create policy "parties read transactions" on public.transactions for select
  using (auth.uid() = buyer_id or auth.uid() = seller_id or public.is_staff());
create policy "parties create transactions" on public.transactions for insert
  with check (auth.uid() = buyer_id or auth.uid() = seller_id);
create policy "parties update transactions" on public.transactions for update
  using (auth.uid() = buyer_id or auth.uid() = seller_id or public.is_staff())
  with check (auth.uid() = buyer_id or auth.uid() = seller_id or public.is_staff());

-- Reviews: public once written, but only for completed counterpart transactions
create policy "reviews are public" on public.reviews for select using (true);
create policy "students review completed transactions" on public.reviews for insert
  with check (auth.uid() = reviewer_id);
create policy "students edit own review" on public.reviews for update
  using (auth.uid() = reviewer_id) with check (auth.uid() = reviewer_id);

-- Reports: private to the reporter, visible to staff
create policy "reporters read own reports" on public.reports for select
  using (auth.uid() = reporter_id or public.is_staff());
create policy "students file reports" on public.reports for insert
  with check (auth.uid() = reporter_id);
create policy "staff manage reports" on public.reports for update
  using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Reference data seed
-- ---------------------------------------------------------------------------
insert into public.colleges (name, short_name, city, scope) values
  ('Delhi Technological University',      'DTU',       'Delhi', 'same'),
  ('University of Delhi',                'DU',        'Delhi', 'university'),
  ('Hansraj College, University of Delhi','Hansraj',   'Delhi', 'same'),
  ('Indian Institute of Technology Delhi','IIT Delhi', 'Delhi', 'nearby'),
  ('Jamia Millia Islamia',               'Jamia',     'Delhi', 'nearby'),
  ('Amity University',                   'Amity',     'Delhi', 'nearby'),
  ('Indraprastha University',            'IPU',       'Delhi', 'nearby'),
  ('Netaji Subhas University of Technology','NSUT',   'Delhi', 'nearby')
on conflict (short_name) do nothing;

insert into public.categories (slug, label, sort) values
  ('furniture',   'Furniture',           1),
  ('electronics', 'Electronics',         2),
  ('phones',      'Phones',              3),
  ('books',       'Books & Academic',   4),
  ('appliances',  'Appliances',          5),
  ('sports',      'Sports & Cycle',      6),
  ('instruments', 'Instruments',         7),
  ('hostel',      'Hostel Essentials',   8)
on conflict (slug) do nothing;
