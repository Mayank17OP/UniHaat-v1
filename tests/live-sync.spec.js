// UniHaat — live sync regression suite.
//
// The signed-in marketplace is supposed to show the database's listings.
// Two things used to stop that:
//
//   1. The seller was embedded as `profiles(...)`, and PostgREST could not
//      pick the relationship on its own — `wishlists` reaches `profiles`
//      through the same two tables — so the whole query failed with
//      PGRST201 and the app silently kept its offline catalogue.
//   2. The live rows were matched against their offline twin by title AND
//      seller, but the offline catalogue abbreviates the seller's name
//      ("Aarav S.") while the database stores it in full ("Aarav Sharma"),
//      so the twin was never found and the listing appeared twice.
//
// The REST layer is mocked at the network boundary and the real vendored
// Supabase client drives the request.

import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const SB = "https://gzbmqwvybcmxlsgouhyh.supabase.co";
const USER_ID = "cccccccc-1111-2222-3333-444444444444";
const COLLEGE_ID = "0f1c5491-12cf-44ed-b0c2-12f79809ed74";

// The live twin of the offline catalogue's first listing. The seller is
// spelled out in full here and abbreviated offline, which is exactly the
// mismatch that used to break the merge.
const liveListing = {
  id: "aaaa1111-0000-0000-0000-000000000001",
  title: "Study Table + Chair Combo",
  description: "Solid wood study table with drawer plus a cushioned chair.",
  listing_type: "sell",
  status: "active",
  category_slug: "furniture",
  price: 2499,
  original_price: 5200,
  condition: "Like new",
  age_months: 8,
  distance_km: 0.4,
  accessories: "Table, chair, keys",
  repair_history: "None",
  is_clearance: false,
  listing_images: [{ url: "./assets/table-chair.svg", alt: "Study Table + Chair Combo", sort: 0 }],
  profiles: {
    id: "11111111-1111-1111-1111-111111111111",
    full_name: "Aarav Sharma",
    verified: true,
    rating_sum: 24,
    rating_count: 5,
    deals_completed: 12,
    colleges: { short_name: "DTU" },
  },
};

const session = {
  access_token: "mock-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "mock-refresh-token",
  user: {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "aarav.sharma@dtu.ac.in",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { name: "Aarav Sharma", full_name: "Aarav Sharma" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
};

const googleProfile = {
  id: USER_ID,
  email: "aarav.sharma@dtu.ac.in",
  full_name: "Aarav Sharma",
  avatar_url: null,
  college_id: COLLEGE_ID,
  verified: true,
  role: "student",
  rating_sum: 0,
  rating_count: 0,
  deals_completed: 0,
  saved_rupees: "0",
  items_reused: 0,
  items_given: 0,
  colleges: { id: COLLEGE_ID, short_name: "DTU", name: "Delhi Technological University" },
};

async function mockGoogle(page, opts = {}) {
  const calls = { authorize: null, token: null, rest: [] };
  const listing = opts.listing || liveListing;

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (url.hostname.endsWith("supabase.co")) {
      if (p === "/auth/v1/authorize") {
        calls.authorize = Object.fromEntries(url.searchParams);
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><script>location.replace(${JSON.stringify(`${SB}/auth/v1/callback`)})</script>`,
        });
        return;
      }
      if (p === "/auth/v1/callback") {
        const back = new URL(calls.authorize?.redirect_to || `${BASE}/`);
        back.searchParams.set("code", "mock-pkce-code");
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><script>location.replace(${JSON.stringify(back.toString())})</script>`,
        });
        return;
      }
      if (p === "/auth/v1/token") {
        calls.token = { query: Object.fromEntries(url.searchParams), body: route.request().postData() };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
        return;
      }
      if (p === "/auth/v1/user") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) });
        return;
      }
      if (p === "/auth/v1/settings") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ disable_signup: false, external: { google: true } }),
        });
        return;
      }
      if (p.startsWith("/rest/v1/")) {
        calls.rest.push({
          path: p,
          method: route.request().method(),
          select: url.searchParams.get("select"),
        });
        let body = "[]";
        if (p.startsWith("/rest/v1/profiles")) {
          body = JSON.stringify([googleProfile]);
        } else if (p.startsWith("/rest/v1/listings")) {
          body = JSON.stringify([listing]);
        } else if (p.startsWith("/rest/v1/colleges")) {
          body = JSON.stringify([{ id: COLLEGE_ID, short_name: "DTU", name: "Delhi Technological University" }]);
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": "0-0/*" },
          body,
        });
        return;
      }
    }

    await route.fallback();
  });

  return calls;
}

async function signIn(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.click("#signInBtn");
  await page.waitForTimeout(300);
  await page.click("#googleBtn");
  await page.waitForTimeout(3000);
}

test("the listing query names the seller relationship explicitly", async ({ page }) => {
  const calls = await mockGoogle(page);
  await signIn(page);

  const read = calls.rest.find((r) => r.path.startsWith("/rest/v1/listings") && r.method === "GET");
  expect(read, "the app reads the listings").toBeTruthy();
  // PostgREST cannot resolve `profiles(...)` on its own here, so the
  // foreign key has to be named or the query fails outright.
  expect(read.select, "the seller embedding names its foreign key").toContain(
    "profiles!listings_seller_id_fkey(",
  );
});

test("a live listing replaces its offline twin instead of joining it", async ({ page }) => {
  await mockGoogle(page);
  await signIn(page);

  const cards = page.locator("#productGrid .card");
  await expect(cards.first()).toBeVisible();

  // The offline catalogue has fourteen listings and the live row is the
  // twin of one of them. It has to take that card's place, not add one.
  const twins = page.locator("#productGrid .card", { hasText: "Study Table + Chair" });
  expect(await twins.count(), "the listing appears exactly once").toBe(1);

  // And the card shows the live row, which spells the seller out in full.
  await expect(twins.first()).toContainText("Aarav Sharma");
  await expect(page.locator("#productGrid .card")).toHaveCount(14);
});

test("a live listing from a seller with no reviews says so, it does not print a perfect score", async ({ page }) => {
  // The same listing, but the seller has never been reviewed.
  const unrated = {
    ...liveListing,
    profiles: { ...liveListing.profiles, rating_sum: 0, rating_count: 0 },
  };
  await mockGoogle(page, { listing: unrated });
  await signIn(page);

  const card = page.locator("#productGrid .card", { hasText: "Study Table + Chair" });
  await expect(card.first()).toBeVisible();

  // Nobody has reviewed this seller, so there is no star to print.
  await expect(card.first()).toContainText("New seller");
  await expect(card.first()).not.toContainText("★");
});
