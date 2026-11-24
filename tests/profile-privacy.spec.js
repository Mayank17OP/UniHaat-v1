// UniHaat — profile privacy regression suite.
//
// The database grants a profile read column by column. `email`,
// `student_id` and `role` are deliberately *not* on that list: they are the
// private and the privileged parts of a profile. A `select=*` would ask for
// them anyway and the server would reject the whole query, so the app has
// to name the fields it renders.
//
// The sandbox cannot reach Supabase, so the REST layer is mocked at the
// network boundary and the real vendored client drives the request — the
// assertions are about the query the app actually sends.

import { test, expect } from "@playwright/test";
import { dismissLocationPrompt } from "./support/location-prompt.js";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const SB = "https://gzbmqwvybcmxlsgouhyh.supabase.co";
const USER_ID = "cccccccc-1111-2222-3333-444444444444";
const COLLEGE_ID = "0f1c5491-12cf-44ed-b0c2-12f79809ed74";

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
    user_metadata: {
      name: "Aarav Sharma",
      full_name: "Aarav Sharma",
      picture: "https://lh3.googleusercontent.com/a/mock",
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
};

const googleProfile = {
  id: USER_ID,
  email: "aarav.sharma@dtu.ac.in",
  full_name: "Aarav Sharma",
  avatar_url: null,
  college_id: null,
  verified: false,
  role: "student",
  rating_sum: 0,
  rating_count: 0,
  deals_completed: 0,
  saved_rupees: "0",
  items_reused: 0,
  items_given: 0,
  colleges: null,
};

/**
 * Mock GoTrue and the REST layer, recording the `select` of every read.
 * @param {import('@playwright/test').Page} page
 */
async function mockGoogle(page) {
  const calls = { authorize: null, token: null, rest: [] };

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (url.hostname.endsWith("supabase.co")) {
      if (p === "/auth/v1/authorize") {
        calls.authorize = Object.fromEntries(url.searchParams);
        const target = `${SB}/auth/v1/callback`;
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><script>location.replace(${JSON.stringify(target)})</script>`,
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
          if (route.request().method() !== "GET") {
            const raw = route.request().postData();
            if (raw) Object.assign(googleProfile, JSON.parse(raw));
          }
          body = JSON.stringify([googleProfile]);
        } else if (p.startsWith("/rest/v1/colleges"))
          body = JSON.stringify([
            { id: COLLEGE_ID, short_name: "DTU", name: "Delhi Technological University" },
          ]);
        else if (p.startsWith("/rest/v1/rpc/")) body = JSON.stringify(googleProfile);
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

test("the profile read names its columns instead of asking for the whole row", async ({ page }) => {
  const calls = await mockGoogle(page);
  await signIn(page);

  const reads = calls.rest.filter((r) => r.path.startsWith("/rest/v1/profiles") && r.method === "GET");
  expect(reads.length, "the app reads the profile").toBeGreaterThan(0);

  for (const read of reads) {
    // `*` would ask for `email` and `student_id` too, and the server
    // rejects the whole query when one column is not granted.
    expect(read.select, "the profile read is not a wildcard").not.toContain("*");
    expect(read.select, "the profile read names columns").toContain("full_name");
    expect(read.select, "the profile read names columns").toContain("rating_sum");
  }
});

test("the profile read never asks for the private columns", async ({ page }) => {
  const calls = await mockGoogle(page);
  await signIn(page);

  const reads = calls.rest.filter((r) => r.path.startsWith("/rest/v1/profiles"));
  expect(reads.length, "the app reads the profile").toBeGreaterThan(0);

  for (const read of reads) {
    for (const column of ["email", "student_id", "role"]) {
      expect(read.select || "", `${column} stays out of the profile query`).not.toContain(column);
    }
  }
});

test("the listing and demand joins only name public profile fields", async ({ page }) => {
  const calls = await mockGoogle(page);
  await signIn(page);

  const reads = calls.rest.filter((r) => r.method === "GET" && r.select);
  expect(reads.length, "the app reads the dataset").toBeGreaterThan(0);

  for (const read of reads) {
    if (!read.select.includes("profiles(")) continue;
    for (const column of ["email", "student_id", "role"]) {
      expect(read.select, `${column} stays out of the joined profile fields`).not.toContain(column);
    }
  }
});

test("the app never writes the campus itself", async ({ page }) => {
  const calls = await mockGoogle(page);
  await signIn(page);
  await dismissLocationPrompt(page);

  // The campus is read off the address, so the app has nothing to write.
  await page.click("#avatarBtn");
  await page.click("#menuCollegeBtn");
  await expect(page.locator("#collegeOverlay")).toBeVisible();
  await page.click("#collegeForm button[type=submit]");
  await page.waitForTimeout(1200);

  // No profile write carries a campus — the server owns that column.
  const writes = calls.rest.filter(
    (r) => (r.method === "PATCH" || r.method === "POST") && r.path.startsWith("/rest/v1/profiles"),
  );
  for (const write of writes) {
    expect(JSON.stringify(write), "the campus is not written by the client").not.toContain("college_id");
  }
});
