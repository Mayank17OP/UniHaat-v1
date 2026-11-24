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
| **Reputation** | `verified`, `role`, `student_id`, `college_id` and the rating aggregates are server-owned columns — students write only their own name, bio, department, year and avatar |
| **Auth** | Email + password, Google OAuth (PKCE), sessions persisted in the browser |
| **Admission** | An account may only exist on a college address — enforced by a `BEFORE INSERT` trigger on `auth.users`, for password sign-ups and Google alike |

The app boots from local seed data and **never waits on the network**. Sign in and it upgrades
to live Postgres data; if Supabase is unreachable it keeps running locally and the status pill
in the nav reads *Local*.

### College email only

UniHaat is a campus marketplace, so an account may only exist on an address that belongs to
one of the colleges. The rule is enforced **in the database**, not in the form:

| | |
|---|---|
| **Where** | `guard_college_email()` — a `BEFORE INSERT` trigger on `auth.users`, plus `BEFORE UPDATE OF email` so an account cannot be moved onto a personal address |
| **What it covers** | Password sign-up, Google sign-up, accounts created from the admin API, and a later email change |
| **The list** | `colleges.email_domain` — DTU `dtu.ac.in`, DU `du.ac.in`, Hansraj `hansrajcollege.ac.in`, IIT Delhi `iitd.ac.in`, Jamia `jmi.ac.in`, Amity `amity.edu`, IPU `ipu.ac.in`, NSUT `nsut.ac.in`, Delhi Technical Campus `delhitechnicalcampus.ac.in` |
| **Sub-domains** | A campus sub-domain counts as its parent college (`gn.amity.edu` is Amity). The dot is the boundary, so `notdtu.ac.in` is nobody's |
| **The campus** | `handle_new_user()` reads the college off the address, so a student cannot put themselves on another campus |

The browser checks the same list before it makes a request — `src/college-email.js` holds the
matcher, and the list itself is fetched from `colleges.email_domain` so the two cannot drift
apart. The frontend check is a courtesy; the trigger is the rule.

The list is **data**: a college joins it by giving `colleges` a row with its mail domain —
no migration, no redeploy. The sign-up picker is filled from that same list, so a campus
added to the database appears in the form. On **sign-in** the browser does not judge the
address at all: the server knows whether the account exists, and a list that is a copy
must never be able to lock a student out of it.

### Student verification

`profiles.verified` is a server-owned column — a client has no `UPDATE` grant on it, on
`student_id`, or on `college_id`. A student becomes verified through
`claim_student_verification()`, which asks for evidence the server can check:

- the address on the account belongs to a college, and is **confirmed** rather than claimed;
- the student supplies their **roll number**, which the college would recognise.

Without both, the server leaves the student unverified and says so. A moderator can still
approve a student by hand through `staff_update_profile`. The app follows the server's
answer — it never marks a student verified on its own.

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

A student who arrives through Google has no college step to answer, because the campus is
read from their address — and if that address is not a college one, the database refuses to
open the account and the app explains why.

## What's in the prototype

- **Marketplace** — 14 realistic Delhi-campus listings, search / category / type / scope
  filters, distance & deal sorting, SmartPrice verdict on every card.
- **Product Passport** — condition card (age, accessories, repairs, battery health).
- **SmartPrice** — live calculator (category depreciation × condition × age × accessories).
- **Demand Board + UniMatch** — post a demand, get matches with reasons. Irrelevant
  category-only matches are rejected.
- **Hostel Clearance**, **SafeSwap** (canvas QR → scan → complete), **in-app chat**.
- **UniReserve** — reserve campus cycles, calculators, study tables, hostel gear and
  instruments. The Banker's Algorithm runs on the server, so a request is approved,
  held in a queue, or blocked because it would leave the campus unable to finish
  what it has already promised. The dashboard shows the available vector, the
  allocation, the safe sequence and a log of every decision, and the four worked
  examples of the algorithm run live.
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
npm run test:dist # builds the site, then runs the same suite against the build
```

The deployed site is `dist/`, not the source tree: the build copies the sources, generates
`src/config.js`, and stamps a content hash onto every module reference. Each of those
steps can break the site while the source tree still works perfectly — a module left out
of the copy, an import rewritten to a file that was not copied, a stylesheet that never
got a stamp. So the suite runs twice: once against the source tree, and once against
what the build actually produced.

25 tests in `tests/unihaat.spec.js`: hero/grid, search, category & type filters, Passport +
SafeSwap modal, SmartPrice (incl. condition selector), Demand Board + UniMatch relevance,
SafeSwap completion, wishlist persistence, sell flow, chat, verification, UniImpact
counters/bars, auth modal (tabs, Google, validation), sync status, motion layer, Supabase
row mapping, the unrated-seller rating, mobile overflow, clipped-control detection and the
mobile menu.

7 tests in `tests/oauth.spec.js` drive the Google flow with GoTrue mocked at the network
layer: the PKCE authorize URL, the consent-screen behaviour, the landing, the campus that
follows the address, a campus that cannot be set by hand, a denied sign-in, and the profile
menu's position.

4 tests in `tests/counters.spec.js` cover the stat counters: they never paint a negative
number, they survive a frame timestamp that predates their start, they survive a clock
that jumps backwards mid-animation, and they settle on the exact target value.

4 tests in `tests/profile-privacy.spec.js` cover the profile read: the app names the
columns it renders instead of asking for the whole row, it never asks for the
private columns (`email`, `student_id`, `role`) that the database does not grant to a
client, and it never writes the campus — the server owns that column.

2 tests in `tests/live-sync.spec.js` cover the signed-in marketplace: the listing query
names the seller's foreign key (PostgREST cannot resolve it on its own, because
`wishlists` reaches `profiles` through the same two tables), and a live listing replaces
its offline twin instead of being shown next to it.

9 tests in `tests/college-email.spec.js` cover the admission rule on the browser side: a
personal address is refused on sign-up without reaching the network, a lookalike domain
(`notdtu.ac.in`) is nobody's, a college address does reach the server, the campus follows
the address (including a campus sub-domain), the app asks the server which addresses it
accepts, and a refused Google account is told why without blaming the student.

Sign-in is decided by the **server**, not by the browser's copy of the college list: the
list is a copy, it can be behind the database, and a campus added there yesterday would
be missing from it — so it must never be allowed to lock a student out of an account the
server would open. The browser still adds the rule on top, because when an address is not
one of ours no account can exist for it, and that is the more useful thing to say than
"wrong password".

9 tests in `tests/unireserve.spec.js` cover UniReserve: the section and its tagline,
the dashboard's six counters, a safe reservation being approved with its allocation
shown, a request beyond the free pool being held rather than approved, a finished
reservation giving its resources back, the safe sequence being shown and changing after
an allocation, the four worked examples running, the reservation log recording the
decision, and the catalogue listing every rentable kind of thing.

5 tests in `tests/reserve-engine.spec.js` cover which engine decided and what it decided:
when the RPCs answer the site says the server did it and shows the server's numbers, when
they cannot be reached it says the device did it and still works, the safe sequence the
database returned reaches the page, an idle campus does not claim to be unsafe, and a
campus that really cannot complete every reservation still says so.

15 tests in `tests/unicompress.spec.js` cover UniCompress: that the Huffman engine
returns the original bytes compared one by one, that a compressed listing photo is
decoded back into a picture the buyer can actually see, that the stored bytes are the
compressed ones, that the dashboard reports the right totals, and that the campus-wide
aggregate is read from the server.

19 tests in `tests/unimail.spec.js` cover UniMail's four tabs in the page. Most of them
are about what the page says when it cannot reach a mail server, because that is the
deployed situation: the site is static, so there is no `/api/unimail/*` behind it. A page
that cannot send mail must say so — it must not print a verification token it never
sent, and it must not print DNS records it never looked up. The suite also pins down
that a DNS record is shown as text rather than run: a TXT record is arbitrary text chosen
by whoever controls that zone.

That is 101 tests in total.

> `npm test` auto-provisions Chromium from the `@sparticuz/chromium` npm package, so it runs
> even where the Playwright browser CDN is unreachable.

There is a second, database-level suite that runs against a real Postgres rather than a
mocked one:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
     -f supabase/tests/security_regression.sql
```

It checks the privilege surface (column grants, function `EXECUTE`, the closed view,
forced row level security), the admission rule (a personal address, a lookalike domain
and a moved address are all refused by the `auth.users` trigger), the evidence rule (a
student with a college address but no roll number stays unverified, and a client cannot
write the student id, the campus or the verified flag), and then walks a handover from
opening to completion and verifies that a student's rating aggregate is rebuilt from the
review rows — after an insert, after an edit and after a removal. It runs inside a
transaction that is rolled back at the end, so it never leaves anything behind.

### Database suites (`npm run test:db`)

The database suites are in the repository, and one command runs all of them:

```bash
npm run test:db          # a local PostgreSQL on 127.0.0.1:55432
DATABASE_URL=postgres://... npm run test:db
```

It prepares a fresh database — the GoTrue stand-in, every migration, the demo data —
and then runs each suite:

| Suite | What it checks |
| --- | --- |
| `supabase/tests/security_regression.sql` | The privilege surface, the admission rule, the evidence rule, and the review aggregate |
| `supabase/tests/unireserve_regression.sql` | The UniReserve vectors, approval, hold, block, safety, safe sequence, release, the queue, ownership isolation, the grants and the four demonstrations |
| `supabase/tests/unireserve_backend.test.mjs` | 73 checks that drive the real functions over real data, including concurrent requests that must not over-allocate |
| `supabase/tests/migration_landing.test.mjs` | The UniReserve migration applied to a campus that already has data: the rentals that were already on the marketplace join the pool, and a re-run cannot double the stock |

`supabase/tests/local_harness.sql` stands in for Supabase. It matters that it
reproduces the way Supabase hands the `public` schema to the client roles — every
table, sequence and function goes to `anon`, `authenticated` and `service_role` by
default, and the migrations take back whatever a client must not have. A local
database that started with fewer privileges would let a migration pass that would
fail in production; that is how the first draft of `0012` was found to let a client
write the reservation tables and let an anonymous caller run the allocator's
internal functions.

`scripts/run-sql-suite.mjs` runs a psql-style suite without needing psql, so the
same file runs in CI, in a container or on a laptop. The suites use `:'name'`
variables and `\gset`, and the runner understands exactly that much.

### Migration probes (`npm run test:probes`)

The SQL suites check that the schema is right. The probes check a different thing: that
each migration is actually doing the work it claims to do. A migration that changes
nothing passes every suite, because the suites only look at the end state. A probe asks
a narrower question — "if this migration were not applied, would this behaviour be
gone?" — and checks the answer by applying the migrations without it and watching the
behaviour disappear.

```bash
npm run test:probes    # rebuilds the database, then probes it
```

The scripts that touch the schema put it back together before they exit. The landing
suite drops the schema to rehearse a migration landing on a populated database, and the
omission check rebuilds the schema with one migration missing; both restore the whole
schema afterwards. That matters because the alternative is that the next script to
connect finds an empty schema and reports that the migrations "do not exist" — which is
true of the wreckage and not of the migrations.

### UniMail service (`npm run test:unimail`)

The UniMail service is in `server/unimail.mjs` and is covered by `tests/unimail.test.mjs`
(10 checks): the domain rule, that a token is single-use and expires, that the templates
render, and that the DNS lookup distinguishes live results from a demonstration mode
without inventing records. The browser half of UniMail is in `tests/unimail.spec.js`.

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
