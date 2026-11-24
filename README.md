# UniHaat — Your Campus. Your Marketplace.

Verified, hyperlocal student-to-student marketplace: buy, sell, rent, exchange and give away within your campus and nearby colleges.

**PRD:** see [PRD.md](./PRD.md) — 16 features, 6 categories, data model, API sketch, roadmap, and the build record.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Zero build step — plain HTML/CSS/JS (`index.html` + `src/`). Fonts, illustrations and the
Supabase client are all vendored, so the site makes **no third-party requests** and renders
identically offline.

## Backend — Supabase

Live project `UniHaat` · ref `gzbmqwvybcmxlsgouhyh` · region `ap-south-1`.

| | |
|---|---|
| **Schema** | 13 tables + an `impact_summary` view — `supabase/migrations/` |
| **Automation** | Signup→profile trigger, UniMatch scoring, SafeSwap completion, rating aggregates |
| **Security** | RLS on every table (36 policies), verified to block anonymous reads and writes |
| **Auth** | Email + password, Google OAuth, sessions persisted in the browser |

The app boots from local seed data and **never waits on the network**. Sign in and it upgrades
to live Postgres data; if Supabase is unreachable it keeps running locally and the status pill
in the nav reads *Local*.

### Google sign-in

Google OAuth needs a client ID and secret that only exist in Google Cloud Console:

1. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**
2. Add the authorised redirect URI:
   ```
   https://gzbmqwvybcmxlsgouhyh.supabase.co/auth/v1/callback
   ```
3. Push it into Supabase — either with the script:
   ```bash
   SUPABASE_ACCESS_TOKEN=sbp_xxx \
   GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com \
   GOOGLE_CLIENT_SECRET=xxx \
   npm run setup:google
   ```
   …or in the dashboard: **Authentication → Providers → Google**.

The button and the full OAuth round-trip are already implemented — only the provider
credentials are missing.

## What's in the prototype

- **Marketplace** — 14 realistic Delhi-campus listings, search / category / type / scope
  filters, distance & deal sorting, SmartPrice verdict on every card.
- **Product Passport** — condition card (age, accessories, repairs, battery health).
- **SmartPrice** — live calculator (category depreciation × condition × age × accessories).
- **Demand Board + UniMatch** — post a demand, get matches with reasons. Irrelevant
  category-only matches are rejected.
- **Hostel Clearance**, **SafeSwap** (canvas QR → scan → complete), **in-app chat**.
- **Auth** — sign in / sign up with email + password, Google sign-in, profile menu, and a
  session that survives a reload. Listings, wishlist and demands persist to Postgres.
- **UniImpact** — animated counters and progress bars.

## Design & motion

Warm paper palette, Fraunces / Inter / JetBrains Mono, no gradients, glassmorphism or emoji
icons. Motion follows Emil Kowalski's principles — transform and opacity only, spring easing,
press physics, staggered reveals — and every animation is disabled under
`prefers-reduced-motion`.

The motion primitives live in `src/alive.js`: card stagger, cursor tilt + glow, heart burst
particles, magnetic buttons, word-by-word headline reveal, scroll progress, skeletons.

## Tests (Playwright)

```bash
npm test          # provisions a headless Chromium, then runs the suite
```

21 tests in `tests/unihaat.spec.js`: hero/grid, search, category & type filters, Passport +
SafeSwap modal, SmartPrice (incl. condition selector), Demand Board + UniMatch relevance,
SafeSwap completion, wishlist persistence, sell flow, chat, verification, UniImpact
counters/bars, auth modal (tabs, Google, validation), sync status, motion layer, mobile
overflow and the mobile menu.

> `npm test` auto-provisions Chromium from the `@sparticuz/chromium` npm package, so it runs
> even where the Playwright browser CDN is unreachable.
