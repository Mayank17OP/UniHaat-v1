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

All criteria below are implemented and covered by the Playwright suite in `tests/unihaat.spec.js`
(16 tests, all passing). See §16 for the verification record.

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
- [x] Zero third-party runtime requests — fonts and illustrations are self-hosted, so the
      prototype renders identically offline.

---

## 16. Build Record (this prototype)

### Stack
Zero-framework vanilla HTML/CSS/JS (ES modules) + Playwright. No build step, no bundler.
Rationale: the prototype should be readable and editable in a browser, and runnable with a
single static server.

```
index.html          App shell — all sections, modals, drawer
src/style.css       Design system (tokens, components, motion)
src/data.js         Seed listings, demands, categories
src/main.js         Marketplace, SmartPrice, UniMatch, SafeSwap, wishlist, chat
assets/*.svg        14 product illustrations, generated by scripts/make-assets.mjs
assets/fonts/*.woff2  Self-hosted Fraunces / Inter / JetBrains Mono
scripts/make-assets.mjs  Regenerates the illustrations
scripts/make-fonts.mjs   Re-copies font files out of node_modules
scripts/setup-browser.mjs Provisions a headless Chromium for Playwright
```

### Running
```bash
npm install
npm run dev        # static server on :5173
npm test           # provisions the browser, then runs the Playwright suite
```

### Implementation notes
- **SmartPrice v1** is a transparent rule-based model — category depreciation curve × condition
  multiplier × age decay × accessories factor — not a black box. It is deterministic and
  explainable, and each listing carries a verdict (Good deal / Fair price / Above SmartPrice)
  derived by comparing the asking price to the computed recommendation.
- **UniMatch** scores candidates on category **and** keyword relevance, then budget and distance.
  A category-only match is discarded, so a "calculator" demand never surfaces a lab coat.
- **SafeSwap QR** is drawn to a `<canvas>` from a seeded PRNG (deterministic per transaction code)
  with finder patterns, so it looks like a real scannable code without an external QR library.
- **Wishlist** and **verification state** persist in `localStorage`; the rest is in-memory.
- **Illustrations** are hand-authored line art in the brand palette rather than stock photos,
  which keeps the prototype offline-capable and visually consistent with the type system.

### Known limitations (deliberate for v1)
- No backend: listings, demands and chat are seeded and reset on reload.
- Chat is a scripted mock, not real-time messaging.
- Verification accepts any college email (no OTP round-trip).
- SmartPrice does not yet learn from real comparable listings — that is v2.

---

*UniHaat — Your Campus. Your Marketplace. Built for students, by students.*
