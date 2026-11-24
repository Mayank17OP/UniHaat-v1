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
| **Security** | RLS forced on every table (36 policies), column-scoped grants, a server-only function surface, verified against the live database |
| **Reputation** | `verified`, `role` and the rating aggregates are server-owned columns — students write only their own name, college, bio and avatar |
| **Auth** | Email + password, Google OAuth (PKCE), sessions persisted in the browser |

The app boots from local seed data and **never waits on the network**. Sign in and it upgrades
to live Postgres data; if Supabase is unreachable it keeps running locally and the status pill
in the nav reads *Local*.

### Google sign-in

Google OAuth is **enabled** on the project with a Google Cloud web-application client.
The flow uses PKCE: the browser sends a `code_challenge`, and the returned code is exchanged
for the session with a `code_verifier`.

To re-apply the provider configuration:

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

A student who arrives through Google has no college (the email sign-up path asks for one,
the OAuth path cannot), so the app opens a college picker once and saves it to their profile.

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
25 tests in `tests/unihaat.spec.js`: hero/grid, search, category & type filters, Passport +
SafeSwap modal, SmartPrice (incl. condition selector), Demand Board + UniMatch relevance,
SafeSwap completion, wishlist persistence, sell flow, chat, verification, UniImpact
counters/bars, auth modal (tabs, Google, validation), sync status, motion layer, Supabase
row mapping, mobile overflow, clipped-control detection and the mobile menu.

7 tests in `tests/oauth.spec.js` drive the Google flow with GoTrue mocked at the network
layer: the PKCE authorize URL, the consent-screen behaviour, the landing, the college
picker, a denied sign-in, and the profile menu's position.

4 tests in `tests/counters.spec.js` cover the stat counters: they never paint a negative
number, they survive a frame timestamp that predates their start, they survive a clock
that jumps backwards mid-animation, and they settle on the exact target value.

4 tests in `tests/profile-privacy.spec.js` cover the profile read: the app names the
columns it renders instead of asking for the whole row, and it never asks for the
private columns (`email`, `student_id`, `role`) that the database does not grant to a
client.

That is 40 tests in total.

> `npm test` auto-provisions Chromium from the `@sparticuz/chromium` npm package, so it runs
> even where the Playwright browser CDN is unreachable.

There is a second, database-level suite that runs against a real Postgres rather than a
mocked one:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
     -f supabase/tests/security_regression.sql
```

It checks the privilege surface (column grants, function `EXECUTE`, the closed view,
forced row level security) and then walks a handover from opening to completion and
verifies that a student's rating aggregate is rebuilt from the review rows — after an
insert, after an edit and after a removal. It runs inside a transaction that is rolled
back at the end, so it never leaves anything behind.

## Deployment

The frontend is a static site. `scripts/build.mjs` copies it into `dist/` and generates
`src/config.js` from `SUPABASE_URL` and `SUPABASE_ANON_KEY`, so a deployment can be pointed
at a different Supabase project without touching the source. `vercel.json` pins the build
command, the output directory and the cache/security headers.

The build also stamps a content hash onto every module reference — the `<script>` tag in
`index.html` and every relative import inside the module graph — so a new build can never
be shadowed by a browser or CDN that still holds the previous copy. Without this, a fixed
bug can stay live on the deployed site after the fix has been merged and deployed.

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=sb_publishable_... \
node scripts/build.mjs
```

Both variables are set on the Vercel project for production and preview. The publishable
key is public by design — Row Level Security is what actually protects the data — and the
service-role key never leaves the server.
