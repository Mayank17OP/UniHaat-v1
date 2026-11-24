# UniHaat — Product Requirements Document (PRD)

**Version:** 1.0 · **Date:** 24 Nov 2026 · **Status:** v1 Prototype (this repo)
**Tagline:** *Your Campus. Your Marketplace.*
**Branch:** `arena/79e6584b-unihaat-v1`

---

## 1. Executive Summary

UniHaat is a verified, hyperlocal, student-to-student marketplace for buying, selling, renting, exchanging and giving away everyday student essentials within the same university and nearby colleges.

Students today rely on fragmented WhatsApp groups, OLX-style listings with strangers, and hostel notice boards. UniHaat replaces that with one trusted campus haat (market): verified students only, nearby pickup, fair pricing intelligence, and a secure handover ritual.

**Central USP:** A verified, hyperlocal student marketplace that combines buying, selling, renting, exchanging, intelligent product matching and secure campus handovers in one unified platform.

**16 major features · 6 categories**

| Category | Features |
|---|---|
| Core marketplace | Buy & Sell, Rent & Exchange, Free Giveaways |
| Smart discovery | Nearby Marketplace, Demand Board, UniMatch |
| Intelligent assistance | SmartPrice, Product Passport |
| Trust & transactions | Student Verification, SafeSwap, In-App Chat, Ratings & Reporting |
| Student convenience | Hostel Clearance, Wishlist |
| Social impact | UniImpact |

---

## 2. Problem & Opportunity

| Problem | Evidence | UniHaat Answer |
|---|---|---|
| Students overpay for new items they need for 1 semester | Calculator ₹1,100 new vs ₹650 used; fridge, mattress, cycle | Pre-owned campus supply at student prices |
| Trust deficit with strangers online | No college verification on generic marketplaces | College-email / student-ID verification, ratings, SafeSwap QR |
| Supply and demand never meet | "Anyone selling a cycle?" lost in group chats | Demand Board + UniMatch auto-matching |
| Sellers price blindly | Under-price or over-price, no reference | SmartPrice AI recommendation + comparable listings |
| Hostel move-out waste | Usable furniture/appliances dumped or sold for scrap | Hostel Clearance bundles + Free Giveaways |
| No record of reuse impact | Sustainability invisible | UniImpact savings & reuse tracker |

**Market:** Indian higher-ed: 43M+ enrolled students, dense campus clusters (Delhi: DU, DTU, IIT Delhi, Jamia, Amity, IP University). Launch cluster: one university + 3 nearby colleges within 3 km.

---

## 3. Goals & Non-Goals

### Goals (v1)
1. 10,000 verified students in launch cluster in 90 days.
2. 5,000 live listings, 40% sell-through in 30 days.
3. Median time-to-first-match (Demand → UniMatch notification) < 24h.
4. SafeSwap completion rate > 85% of agreed transactions.
5. ₹50L+ estimated student savings tracked in UniImpact in semester 1.

### Non-goals (v1)
- Online payments / escrow (cash/UPI on pickup; SafeSwap records handover).
- Delivery logistics (pickup-first; nearby pickup points).
- Non-student sellers / commercial resellers.
- Mobile native apps (responsive web first; PWA-ready).

---

## 4. Personas

**Aarav, 19 — First-year, DTU.** Needs calculator, cycle, books cheap. Budget ₹3,000. Wants verified seller nearby, same hostel pickup.

**Priya, 21 — Final-year, Hansraj (DU).** Moving out of hostel. Has mattress, table, kettle, lamp, fridge. Wants one combined pickup, fair prices, no strangers.

**Kabir, 20 — IIT Delhi.** Has iPhone 12 + laptop stand to sell. Wants SmartPrice so he doesn't under-price, and SafeSwap so handover is recorded.

**Sana, 22 — Jamia.** Needs a guitar for a semester, can't buy. Wants rent/exchange, not purchase.

---

## 5. User Stories (selected)

- As a verified student, I can list a product with photos, price, condition and type (Sell/Rent/Exchange/Free) so buyers can discover it.
- As a buyer, I can filter by same college / nearby colleges / distance so pickup is convenient.
- As a seller, I get a SmartPrice recommendation before publishing so my price is competitive and fair.
- As a buyer, I see a Product Passport (age, condition, accessories, repairs, battery health) so I buy informed.
- As a student, I post a demand (item, budget, category, location) and UniMatch notifies me when a matching listing appears.
- As a buyer/seller, we generate a SafeSwap QR, scan/confirm handover, and the transaction is marked complete.
- As a student moving out, I create a Hostel Clearance bundle so buyers can pick up multiple items together.
- As a student, I save to Wishlist and get notified on price drop / unavailable.
- As a community member, I see UniImpact savings and reuse stats so I understand my impact.

---

## 6. Feature Specification (16)

### A. Student Community & Verification

**F1. Student Verification**
- Register via college email (`.edu` / college domain allowlist) or student-ID upload + OTP.
- Onboarding: college/university selection, course, hostel/area, pickup preference.
- Verified badge on profile & listings. Unverified = browse-only.
- Discovery: same-college, same-university, nearby-colleges scopes.

**F2. Student Profiles**
- Public card: name, college, verified badge, rating, completed deals, response time.
- Tabs: Active listings, Transaction history, Wishlist, Demands posted.
- Preferences: default distance, categories, notification toggles.

### B. Marketplace & Product Discovery

**F3. Buy & Sell Marketplace**
- CRUD listings: title, photos (min 1), description, price, category, condition, original price, age, accessories.
- Categories: Furniture, Electronics, Phones, Books & Academic, Appliances, Sports & Cycle, Instruments, Hostel Essentials, Other.
- Browse, search (title/keywords), filter, sort (price, distance, newest), compare via SmartPrice verdict (Fair / Good deal / High).

**F4. Rent & Exchange**
- Listing types: Sell, Rent (₹/day or ₹/week + duration + deposit), Exchange (wanted item/terms), Free.
- Rental availability calendar (simple: available dates), exchange terms field.
- Request-to-rent flow reuses chat + SafeSwap.

**F5. Nearby Marketplace**
- Location: college + hostel/area pin (no precise GPS required; area-level).
- Filters: Same college / Same university / Nearby colleges; distance buckets (<1 km, <3 km, <5 km).
- "Nearby pickup" suggestion: common campus spots (gate, library, hostel mess).

**F6. Wishlist**
- Save/unsave from card & detail. Persisted per user.
- Notifications: price drop, sold/unavailable, back-in-stock (rent).
- Wishlist view with SmartPrice verdict per item.

**F7. Free Giveaways**
- Price = ₹0, type = Free. "Request item" flow (first-come + seller approval).
- Highlighted in Hostel Clearance & move-out season.

### C. Student-Specific Marketplace

**F8. Student Demand Board**
- Post: item wanted, category, budget range, location/college, needed-by date, notes.
- List view: open / matched / closed. Others can "I have this" respond with a listing link.
- Expiry: auto-close after 30 days, bump option.

**F9. Hostel Clearance**
- Dedicated section + bundle listings (multi-item from one seller, combined pickup).
- Move-out checklist template (mattress, table, chair, lamp, kettle, fridge, books).
- Bundle pricing: sum vs bundle discount shown.

### D. Smart & Intelligent Features

**F10. SmartPrice — AI-Based Price Recommendation**
- Inputs: category, original price, age (months), condition (Like new / Good / Fair), accessories completeness.
- Model (v1 rule-based, v2 ML on UniHaat comps): depreciation curve per category × condition multiplier.
- Output: recommended price, fair range (P25–P75), confidence, comparable listings (same category, similar age/condition).
- Surfaces: Sell form (live), product card verdict, detail page.

**F11. UniMatch — Automated Demand Matching**
- Match score: category (must), keyword overlap, budget overlap, distance/college scope.
- Triggers: new listing created, new demand posted, price drop.
- Notification: in-app + (v2) push/email. "Match found" card links demand ↔ listing.
- Explainability: show why matched (category ✓, budget ✓, 0.8 km ✓).

**F12. Product Passport — Digital Condition Card**
- Structured fields: age, condition grade, accessories included, repair history, seller notes.
- Electronics extra: battery health %, device condition, warranty left.
- Seller attestation checkbox + buyer "report mismatch" path.
- Rendered as a card on detail page; printable/shareable.

### E. Trust, Safety & Transactions

**F13. SafeSwap — Secure Campus Handover**
- On agreement, generate unique transaction ID + QR (buyer & seller codes).
- Both parties confirm handover (scan or code entry); status: Agreed → Handed over → Completed.
- Immutable-ish record: timestamp, parties, item, price. Dispute flag if one party no-shows.
- Public pickup recommendation: campus spots, daylight, busy area.

**F14. In-App Chat & Negotiation**
- Per-listing thread (buyer ↔ seller). Quick actions: Offer price, Ask availability, Confirm pickup spot/time.
- Templates: "Is this available?", "Can you do ₹X?", "Gate at 5 pm?"
- Safety: no external contact leak in v1; report/block.

**F15. Ratings, Reviews & Reporting**
- Post-transaction rating (1–5) + review for seller (and buyer optional).
- Reputation: average rating, completed deals, response rate, verified-since.
- Report listing/user (spam, scam, mismatch, inappropriate) → moderation queue.
- Condition disclosure + safe pickup tips on every detail page.

### F. Sustainability & Community Impact

**F16. UniImpact — Savings & Sustainability Tracker**
- Per-user: items bought pre-owned, money saved vs new price, items given away, waste diverted (kg estimate).
- Community: total reused items, total saved ₹, CO₂/waste estimate, per-college leaderboard.
- Visual: animated counters, progress to semester goal, shareable impact card.

---

## 7. Information Architecture & Key Flows

**Nav:** Marketplace · Demand Board · Hostel Clearance · SmartPrice · SafeSwap · UniImpact · Sell (CTA) · Wishlist · Profile

**Core flows**
1. **Onboard → Verify → Browse:** College email → select college → verified badge → nearby feed.
2. **Sell:** Sell → form → SmartPrice live → Passport fields → publish → UniMatch notifies demand posters.
3. **Buy:** Search/filter → detail (Passport + SmartPrice verdict) → chat/negotiate → SafeSwap QR → confirm handover → rate.
4. **Demand:** Post demand → UniMatch matches existing listings instantly → notify on new matches → respond → SafeSwap.
5. **Move-out:** Hostel Clearance bundle → multi-item pickup → SafeSwap per bundle.

---

## 8. Data Model (v1, logical)

```
User(id, name, email, college_id, course, hostel_area, verified, rating_avg, deals_count, created_at)
College(id, name, university, city, lat, lng)
Listing(id, seller_id, title, description, price, type[sell|rent|exchange|free], category,
        condition, original_price, age_months, accessories, repair_history, battery_health,
        distance_km, college_id, status[active|sold|rented|closed], photos[], created_at)
Demand(id, user_id, title, category, budget_min, budget_max, college_id, needed_by, status)
Match(id, demand_id, listing_id, score, reasons[], notified_at)
Wishlist(user_id, listing_id, created_at)
ChatThread(id, listing_id, buyer_id, seller_id)
Message(id, thread_id, sender_id, body, created_at)
Transaction(id, listing_id, buyer_id, seller_id, price, safeswap_code, status, handover_at)
Review(id, transaction_id, reviewer_id, rating, text)
Report(id, target_type, target_id, reporter_id, reason)
ImpactEvent(id, user_id, type[reused|given|exchanged], saved_inr, kg_diverted)
```

---

## 9. API Sketch (v1)

```
POST /auth/verify-email        POST /listings
GET  /listings?category=&type=&college_scope=&max_distance=&q=&sort=
GET  /listings/:id             POST /listings/:id/wishlist
POST /demands                  GET  /demands
GET  /matches?demand_id=       POST /transactions/:id/safeswap
POST /threads/:id/messages     POST /transactions/:id/confirm
POST /reviews                  POST /reports
GET  /impact/me  GET /impact/community
GET  /smartprice?category=&original_price=&age_months=&condition=
```

---

## 10. Design System & Motion (applied in this prototype)

**Taste / Impeccable principles**
- Editorial, warm-paper aesthetic — no purple/blue gradients, no glassmorphism, no emoji icons.
- Type: **Fraunces** (display serif) + **Inter** (UI) + **JetBrains Mono** (prices/labels). Tight display leading, generous whitespace, asymmetric hero.
- Palette: paper `#FFF9F0`, ink `#161210`, vermilion `#FF4D1C`, campus green `#0E4D2E`, mustard `#FFB81C`.
- Real Indian campus content: ₹ pricing, DU/DTU/IIT Delhi/Jamia/Amity, hostel language, km distances.
- Every card has a verdict, distance, college and condition — no lorem ipsum.

**Emil Kowalski motion principles**
- Animate `transform` + `opacity` only (60 fps). No layout thrash.
- Springs, not linear: `cubic-bezier(0.34,1.56,0.64,1)` for pops, `cubic-bezier(0.22,1,0.36,1)` for entrances.
- Micro-interactions: press `scale(0.97)`, card hover lift + image zoom, wishlist heart pop, toast spring-in.
- Staggered reveals via IntersectionObserver; animated counters; marquee ticker.
- `prefers-reduced-motion` respected.

**Playwright**
- Smoke + interaction tests in `tests/unihaat.spec.js` (see repo). Run: `npx playwright test`.

---

## 11. Non-Functional Requirements

- **Performance:** LCP < 2.5s on 4G, grid render < 100ms for 100 items (virtualise later).
- **Security:** Verified-only write actions, rate-limited chat, report/block, no PII leak in QR.
- **Privacy:** Area-level location only; precise GPS opt-in (v2).
- **Accessibility:** WCAG 2.1 AA target — focus states, aria labels, keyboard modal trap, contrast ≥ 4.5:1.
- **Reliability:** Offline wishlist (localStorage in prototype), graceful image fallback.

---

## 12. Metrics & Experimentation

North-star: **Weekly completed SafeSwap transactions per 1,000 verified students.**
Supporting: listings/week, demand match rate, median time-to-sell, wishlist→buy conversion, SmartPrice acceptance rate, repeat seller rate, UniImpact ₹ saved.

---

## 13. Roadmap

| Phase | Scope | Timeline |
|---|---|---|
| **v1 Prototype (this repo)** | Full interactive frontend: marketplace, filters, Passport, SmartPrice calculator, Demand+UniMatch, SafeSwap QR demo, Wishlist, Sell flow, UniImpact counters, chat mock | Now |
| v1.1 | Auth (college email), real backend (Postgres + S3), push notifications, moderation | 4–6 wks |
| v1.2 | Payments (UPI intent), rental calendar, bundle checkout, college leaderboard | 6–10 wks |
| v2 | ML SmartPrice on UniHaat comps, image moderation, PWA, multi-city launch | Semester 2 |

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Cold start (no listings) | Seed with Hostel Clearance + Free Giveaways; college ambassador program |
| Scams / fake listings | Verification, SafeSwap record, report queue, no advance payment warning |
| Price disputes | SmartPrice range + Passport attestation as shared reference |
| Low response rate | Response-time badge, nudge notifications, demand expiry |

---

## 15. Acceptance Criteria (v1 Prototype)

All criteria below are implemented and covered by the Playwright suite in `tests/unihaat.spec.js`,
`tests/oauth.spec.js` and `tests/counters.spec.js` (36 tests, all passing). See §16 for the
verification record.

- [x] Browse/search/filter/sort 14 realistic listings; wishlist persists across reload.
- [x] Product detail shows Passport, SmartPrice verdict, seller, chat entry, SafeSwap QR.
- [x] SmartPrice calculator returns recommendation + range from inputs, and the condition
      selector (Like new / Good / Fair) measurably changes the price.
- [x] Demand Board posts a demand and shows UniMatch matches with reasons (category, keyword,
      budget, distance); category-only matches are rejected as irrelevant.
- [x] Sell form uses live SmartPrice and adds the listing to the grid.
- [x] SafeSwap flow: generate → simulate scan → completed.
- [x] UniImpact counters animate to final values; progress bars fill on reveal.
- [x] Playwright suite passes; reduced-motion respected; no horizontal overflow from 320–1440px.
- [x] Zero third-party runtime requests — fonts, illustrations and the Supabase client are all
      vendored, so the prototype renders identically offline.
- [x] **Sign in / sign up with email + password**, persisted through Supabase Auth; the
      session survives a reload and the profile is created by a database trigger.
- [x] **Google sign-in** is wired end to end (`signInWithOAuth` → PKCE redirect → session →
      profile) and covered by its own Playwright suite.
- [x] **Wishlist, listings and demands persist to Postgres** when signed in, and fall back to
      local state when signed out or offline.
- [x] **Row Level Security** is enabled on every table and verified to block anonymous reads
      of private data and anonymous writes.
- [x] **A student cannot rewrite their own reputation** — `verified`, `role` and the rating
      aggregates are server-owned columns; only the fields a student owns are writable.
- [x] **A student cannot mint their own reputation** — a SafeSwap handover completes only
      when both students confirm, the seller must own the listing, the amount is bounded by
      the listed price, and a finished transaction is frozen so the aggregate cannot be
      replayed.
- [x] **A failed Google sign-in says so** — a denied consent screen reopens the auth modal
      with an explanation instead of landing silently on the homepage.

---

## 15A. Backend — Supabase

**Project:** `UniHaat` · ref `gzbmqwvybcmxlsgouhyh` · region `ap-south-1` · Postgres 17.

### Schema (13 tables)

| Table | Purpose | Key columns |
|---|---|---|
| `profiles` | 1:1 with `auth.users`; identity + reputation | `college_id`, `verified`, `rating_sum/count`, `deals_completed`, `saved_rupees`, `items_reused`, `items_given` |
| `colleges` | Campus reference data | `short_name`, `scope` (same / university / nearby) |
| `categories` | Listing categories | `slug`, `label`, `sort` |
| `listings` | The marketplace inventory | `listing_type`, `status`, `price`, `original_price`, `condition`, `age_months`, `accessories`, `repair_history`, `battery_health`, `seller_attested`, `is_clearance`, `distance_km`, `negotiable` |
| `listing_images` | Images per listing | `listing_id`, `url`, `sort` |
| `wishlists` | Saved listings (private) | PK `(user_id, listing_id)` |
| `demands` | Demand Board posts | `budget_max`, `needed_by`, `status`, `expires_at` |
| `demand_matches` | UniMatch results | `score`, `reasons[]`, `notified` |
| `conversations` | Chat threads | `buyer_id`, `seller_id`, `listing_id` |
| `messages` | Chat messages | `body`, `read_at` |
| `transactions` | SafeSwap handovers | `swap_code`, `status`, `buyer/seller_confirmed_at`, `completed_at` |
| `reviews` | Ratings after a completed deal | `rating`, `body`, `condition_match` |
| `reports` | Moderation queue | `reason`, `status`, `details` |

Plus a `impact_summary` view aggregating the UniImpact counters.

### Automation (triggers + functions)

| Trigger | Effect |
|---|---|
| `on_auth_user_created` | Creates a `profiles` row on signup and links the college chosen at signup. |
| `on_listing_published` | Runs UniMatch for the listing against every open demand. |
| `on_demand_created` | Re-scores open demands against existing inventory. |
| `on_transaction_completed` | Marks the listing `sold`, increments both students' deal counts, reuse and savings. |
| `on_review_created` | Updates the seller's rating aggregate; rejects reviews without a completed transaction. |
| `set_updated_at` | Maintains `updated_at` on profiles, listings and conversations. |

`refresh_demand_matches()` scores candidates on **keyword relevance first**, then budget and
distance, and records the human-readable reasons shown in the UI. A category-only overlap is
discarded — so a "calculator" demand never surfaces a lab coat.

It scans demands in both `open` and `matched` state. The original version only scanned `open`,
which meant that the moment a demand found its first match it flipped to `matched` and was
permanently excluded from every later scan — a better listing published afterwards could
never surface on a demand board that already had one hit.

### Security model
RLS is enabled on all 13 tables with 36 policies. Verified against the live database:
an anonymous role can read only public reference data, active listings and open demands; it
sees **0** wishlist, message and transaction rows; and an insert of a listing is rejected with
*new row violates row-level security policy*. Private tables are reachable only through
`auth.uid()` matching or the `is_staff()` helper.

**Column-scoped profile writes.** The "students update own profile" policy is row-scoped, but
RLS alone says nothing about *which columns* a row-scoped update may touch. A student could
therefore `PATCH` any column of their own profile — including `verified`, `rating_sum` and
`role`. That last one escalates: `is_staff()` reads `profiles.role`, so a student who sets
`role = 'admin'` passes the staff check and can then edit every other student's verification
and ratings. Both were reproduced against the live database before the fix.

The fix (`0005_profile_column_grants.sql`) is a column-scoped grant:

| Column group | Who may write it |
|---|---|
| `full_name`, `avatar_url`, `bio`, `department`, `year_of_study`, `college_id`, `student_id` | the student, on their own row |
| `verified`, `verified_at` | the server only, via `claim_student_verification()` |
| `role` | staff only, via `staff_update_profile()` |
| `rating_sum`, `rating_count`, `deals_completed`, `saved_rupees`, `items_reused`, `items_given` | the server only, via `staff_update_profile()` |

A profile also cannot be created pre-verified or pre-promoted: the insert policy now requires
`verified = false and role = 'student'`. Both `claim_student_verification()` and
`staff_update_profile()` are `SECURITY DEFINER`, so the browser never writes a
server-owned column itself.

**Two-party handovers.** The column-scoped grant above closed the *direct* writes, but the
reputation counters had a second door: `transactions`. The policies let a student create a
transaction naming any other student as the seller — for a listing that had nothing to do
with that seller — and then set the status straight to `completed`. The completion trigger
credited both sides, so the attacker handed themselves `deals_completed + 1`,
`items_reused + 1` and `saved_rupees += amount` for an amount of their choosing (999999
was accepted). The same UPDATE could then be replayed — `completed → agreed → completed` —
and the aggregate fired a second time, because the trigger only checked that the status had
changed, not that it had not already been completed.

This was reproduced against the live database before the fix: a student's `saved_rupees`
went from 0 to 999,999 and `deals_completed` from 12 to 13, with no counterparty involved.

The schema already had `buyer_confirmed_at` and `seller_confirmed_at`. Nothing read them.
A SafeSwap handover is a two-party event, so they are now what gate completion
(`0006_transaction_and_reputation_guards.sql`, `0007_transaction_terminal_state.sql`):

| Rule | Enforced by |
|---|---|
| The seller must be the student who owns the listing | `guard_transaction_state()` |
| The amount is bounded by the listed price | `guard_transaction_state()` |
| The listing, both students and the amount cannot change after creation | `guard_transaction_state()` |
| Only the buyer may stamp `buyer_confirmed_at`, only the seller `seller_confirmed_at` | `guard_transaction_state()` |
| Completion requires **both** confirmations | `guard_transaction_state()` |
| A finished transaction is frozen — no status, confirmation or swap-code edits | `guard_transaction_state()` |
| Each side is credited exactly once | `apply_transaction_completion()` |

**Profile creation.** `students insert own profile` checked `verified` and `role` but not
the counters, so the row a client inserts could carry `rating_sum = 5000`. The signup
trigger creates the row first, so the insert hit the primary key — a coincidence rather than
a control. The INSERT grant is now scoped to the columns a student owns
(`id`, `full_name`, `avatar_url`, `bio`, `department`, `year_of_study`, `college_id`,
`student_id`), and the policy pins every server-owned column to its default. Students also
cannot delete their own profile: the row belongs to the account, and `auth.users` owns its
lifecycle.

**Review scores.** The rating and the parties are what the aggregate was computed from, so
they are fixed once a review exists; only `body` and `condition_match` remain editable.

**Privileges no client role needs.** `TRUNCATE` is not covered by row-level security, so it
is revoked from `anon` and `authenticated` along with `TRIGGER` and `REFERENCES`.

### Auth configuration
Email/password enabled, `mailer_autoconfirm` on for demo friction, site URL and redirect
allow-list set for `localhost:5173` and the preview host. Google OAuth is enabled with a
Google Cloud web-application client; `scripts/configure-google-auth.mjs` applies the same
configuration from the Management API.

The Google flow uses **PKCE**: the client sends a `code_challenge` (S256) and exchanges the
returned code for the session with a `code_verifier`. `prompt=consent` is deliberately *not*
passed — GoTrue already requests an offline token for Google, and forcing the consent screen
made every returning sign-in show it again.

---

## 16. Build Record (this prototype)

### Stack
Zero-framework vanilla HTML/CSS/JS (ES modules) + Supabase + Playwright. No build step, no
bundler. Rationale: the prototype should be readable and editable in a browser, and runnable
with a single static server.

```
index.html          App shell — all sections, modals, drawer, auth modal, profile menu
src/style.css       Design system (tokens, components, motion)
src/data.js         Seed listings, demands, categories, colleges
src/main.js         Marketplace, SmartPrice, UniMatch, SafeSwap, wishlist, chat
src/supabase.js     Supabase client + data layer (auth, listings, wishlist, demands)
src/persistence.js  Row ↔ UI model mapping and sync helpers
src/auth.js         Sign in / sign up / Google UI and profile menu
src/alive.js        The motion layer — stagger, tilt, magnetic, particles, type reveal
src/config.js       Project URL + publishable key (public by design)
assets/*.svg        14 product illustrations, generated by scripts/make-assets.mjs
assets/fonts/*.woff2  Self-hosted Fraunces / Inter / JetBrains Mono
vendor/supabase.js  Vendored Supabase browser client (no CDN request)
supabase/migrations/  SQL migrations, applied to the live project
scripts/make-assets.mjs      Regenerates the illustrations
scripts/make-fonts.mjs       Re-copies font files out of node_modules
scripts/vendor-supabase.mjs  Re-vendors the Supabase browser client
scripts/setup-browser.mjs    Provisions a headless Chromium for Playwright
scripts/configure-google-auth.mjs  Enables Google OAuth via the Management API
scripts/build.mjs         Static build for deployment — emits dist/ and generates src/config.js
vercel.json               Build command, output directory, cache and security headers
```

### Running
```bash
npm install
npm run dev        # static server on :5173
npm test           # provisions the browser, then runs the Playwright suite
npm run setup:assets   # regenerate illustrations, fonts and the vendored client
node scripts/build.mjs   # build dist/ for deployment
```

### Deployment
The frontend is deployed to Vercel from `main`, connected to the GitHub repository. The
project builds with `node scripts/build.mjs` and serves `dist/`. `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are set as encrypted environment variables on the Vercel project for
both production and preview, so the build generates a `src/config.js` pointing at the live
Supabase project without the key ever being written into the source. The publishable key is
public by design — Row Level Security is what actually protects the data — and the
service-role key never leaves the server.

The backend is the Supabase project above. Migrations `0001`–`0007` are applied to it.

### Implementation notes
- **SmartPrice v1** is a transparent rule-based model — category depreciation curve × condition
  multiplier × age decay × accessories factor — not a black box. It is deterministic and
  explainable, and each listing carries a verdict (Good deal / Fair price / Above SmartPrice)
  derived by comparing the asking price to the computed recommendation.
- **UniMatch** runs in the database (`refresh_demand_matches`) and is mirrored by a client-side
  scorer for instant feedback. Both score keyword relevance first, then budget and distance, and
  discard category-only overlaps.
- **SafeSwap QR** is drawn to a `<canvas>` from a seeded PRNG (deterministic per transaction code)
  with finder patterns, so it looks like a real scannable code without an external QR library.
- **Offline-first**: the app boots from local seed data and never waits on the network. When a
  session exists it upgrades to live data; if Supabase is unreachable it keeps running locally
  and the status pill reads *Local* rather than breaking.
- **Illustrations** are hand-authored line art in the brand palette rather than stock photos,
  which keeps the prototype offline-capable and visually consistent with the type system.
- **Stat counters read the clock inside the callback.** The count-up used to derive its
  progress from the timestamp `requestAnimationFrame` hands over. That timestamp is the
  *frame's start time*, and it can predate the moment the counter began — so the eased
  progress went negative and the page briefly painted "-10,598 verified students". The
  counter now reads `performance.now()` inside the callback, and three independent guards
  make a negative impossible: progress is clamped to `[0, 1]`, progress can never move
  backwards, and the rendered number itself is clamped to `[0, target]`.
  `tests/counters.spec.js` reproduces both failure modes deliberately (a frame timestamp
  that predates the start, and a clock that jumps backwards mid-animation) and fails
  against the old implementation.

  **Deploys could not reach the fix.** The counter was fixed and deployed, yet the live
  page kept rendering the old behaviour — the browser was still running the previous
  build's `main.js`, because the module URL had not changed and the old copy was still
  in the HTTP cache. The build now stamps a content hash onto every module reference
  (`./src/main.js?v=<hash>`) *and* onto every relative import inside the module graph,
  so a new build can never be shadowed by a cached one. The same fix was applied to
  `rollNumber()` in `src/alive.js`, which had the identical flaw.

### The motion layer (`src/alive.js`)
Motion is treated as a response to input rather than decoration. Every primitive animates
`transform` and `opacity` only, and every one is disabled under `prefers-reduced-motion`.

| Primitive | Behaviour |
|---|---|
| `initCardStagger` | Grid cards rise in with an incremental delay, so the grid reads as one object arriving. |
| `initTilt` | A ~4° tilt plus a cursor-following glow on hover — a card being lifted, not a gimmick. |
| `burstHeart` | The heart springs and throws six particles when a listing is saved. |
| `initMagnetic` | Primary buttons lean toward the cursor by up to 5px. |
| `initTypeReveal` | Headline words rise in sequence, preserving `<br>` and accent spans. |
| `initScrollProgress` | A hairline progress bar tracks scroll depth. |
| `showSkeletons` | Shimmering placeholders while a remote fetch is in flight. |
| `copyWithFeedback` | Clipboard writes flash a confirmation on the button. |

### Known limitations (deliberate for v1)
- Chat is a scripted mock; realtime messaging and push notifications are v1.2.
- The app-level student verification (college email + OTP) is still a stub; Supabase Auth
  handles identity, but the college-ownership check is not yet wired to a mail provider.
- Google OAuth needs a client ID and secret from Google Cloud Console — see
  `scripts/configure-google-auth.mjs`.
- SmartPrice does not yet learn from real comparable listings — that is v2.
- Email autoconfirm is enabled for demo friction and should be turned off in production.

---

*UniHaat — Your Campus. Your Marketplace. Built for students, by students.*
