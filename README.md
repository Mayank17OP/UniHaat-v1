# UniHaat — Your Campus. Your Marketplace.

Verified, hyperlocal student-to-student marketplace: buy, sell, rent, exchange and give away within your campus and nearby colleges.

**PRD:** see [PRD.md](./PRD.md) — 16 features, 6 categories, data model, API sketch, roadmap, and the build record for this prototype.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Zero build step — plain HTML/CSS/JS (`index.html` + `src/`). Fonts and illustrations are self-hosted, so it renders identically offline with no third-party requests.

## What's in v1 prototype

- **Marketplace** — 14 realistic Delhi-campus listings, search / category / type / scope filters, distance & deal sorting, SmartPrice verdicts on every card.
- **Product Passport** — condition card (age, accessories, repairs, battery health) on every detail view.
- **SmartPrice** — live calculator (category depreciation × condition × age × accessories) + Sell-form recommendation.
- **Demand Board + UniMatch** — post a demand, get instant matches with reasons (category / keyword / budget / distance). Irrelevant category-only matches are rejected.
- **Hostel Clearance** — bundle listings with combined pickup.
- **SafeSwap** — generated QR (canvas), scan-to-confirm demo flow.
- **Wishlist** + **verification** (localStorage), **in-app chat mock**, **UniImpact** animated counters.
- **Motion** — Emil Kowalski principles: transform/opacity only, spring easing, press physics, staggered reveals, `prefers-reduced-motion` respected.
- **Design** — Fraunces + Inter + JetBrains Mono, warm paper palette, no gradients/glass/emoji.

## Tests (Playwright)

```bash
npm test          # provisions a headless Chromium, then runs the suite
```

16 tests in `tests/unihaat.spec.js`: hero/grid, search, category & type filters, Passport + SafeSwap modal, SmartPrice (incl. condition selector), Demand Board + UniMatch relevance, SafeSwap completion, wishlist persistence, sell flow, chat, verification, UniImpact counters/bars, mobile overflow, mobile menu.

> `npm test` auto-provisions Chromium from the `@sparticuz/chromium` npm package, so it works
> even where the Playwright browser CDN is unreachable.
