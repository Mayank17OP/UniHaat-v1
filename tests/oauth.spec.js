// UniHaat — Google sign-in regression suite.
//
// The sandbox cannot reach Supabase or Google, so GoTrue is mocked at the
// network layer and the *real* vendored Supabase client drives the flow.
// That still exercises the code that matters: the authorize URL, the PKCE
// exchange, the landing, and everything the app does afterwards.

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

// A Google student: the OAuth path never collects a college.
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
 * Mock GoTrue and drive the browser through a complete Google sign-in.
 * @param {import('@playwright/test').Page} page
 * @param {{ deny?: boolean, profile?: object }} opts
 */
async function mockGoogle(page, opts = {}) {
  const calls = { authorize: null, token: null, rest: [] };

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (url.hostname.endsWith("supabase.co")) {
      if (p === "/auth/v1/authorize") {
        calls.authorize = Object.fromEntries(url.searchParams);
        const target = opts.deny
          ? `${BASE}/?error=access_denied&error_code=access_denied&error_description=The+user+denied+the+request.`
          : `${SB}/auth/v1/callback`;
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><script>location.replace(${JSON.stringify(target)})</script>`,
        });
        return;
      }
      if (p === "/auth/v1/callback") {
        const back = new URL(calls.authorize?.redirect_to || BASE);
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
        calls.rest.push({ path: p, method: route.request().method() });
        let body = "[]";
        if (p.startsWith("/rest/v1/profiles")) {
          // A write echoes the row back, so the mock has to apply it.
          if (route.request().method() !== "GET") {
            const raw = route.request().postData();
            if (raw) Object.assign(opts.profile || googleProfile, JSON.parse(raw));
          }
          body = JSON.stringify([opts.profile || googleProfile]);
        } else if (p.startsWith("/rest/v1/colleges"))
          body = JSON.stringify([
            { id: COLLEGE_ID, short_name: "DTU", name: "Delhi Technological University" },
            { id: "bbbb2222-0000-0000-0000-000000000002", short_name: "DU", name: "University of Delhi" },
          ]);
        else if (p.startsWith("/rest/v1/rpc/")) body = JSON.stringify(opts.profile || googleProfile);
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

async function startGoogleSignIn(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.click("#signInBtn");
  await page.waitForTimeout(300);
  await page.click("#googleBtn");
}

test("Google sign-in builds a PKCE authorize URL for this origin", async ({ page }) => {
  const calls = await mockGoogle(page);
  await startGoogleSignIn(page);
  await page.waitForTimeout(2500);

  expect(calls.authorize).toBeTruthy();
  expect(calls.authorize.provider).toBe("google");
  expect(calls.authorize.redirect_to).toBe(`${BASE}/`);
  // PKCE: a challenge is sent, and the token exchange carries the verifier.
  expect(calls.authorize.code_challenge_method).toBe("s256");
  expect(calls.authorize.code_challenge).toBeTruthy();
  expect(calls.token?.query?.grant_type).toBe("pkce");
  expect(calls.token?.body).toContain("code_verifier");
});

test("Google sign-in does not force the consent screen on every return", async ({ page }) => {
  const calls = await mockGoogle(page);
  await startGoogleSignIn(page);
  await page.waitForTimeout(2000);
  // `prompt=consent` makes Google show the consent screen on every sign-in.
  expect(calls.authorize.prompt).toBeUndefined();
});

test("Google sign-in lands signed in and syncs the dataset exactly once", async ({ page }) => {
  const calls = await mockGoogle(page);
  await startGoogleSignIn(page);
  await page.waitForTimeout(3000);

  await expect(page.locator("#signInBtn")).toBeHidden();
  await expect(page.locator("#avatarBtn")).toBeVisible();
  await expect(page.locator("#avatarBtn")).toHaveText("AS");
  await expect(page.locator("#syncPill")).toHaveAttribute("data-state", "live");
  await expect(page.locator("#syncText")).toHaveText("Synced");

  // Supabase fires INITIAL_SESSION, SIGNED_IN and INIT in quick succession.
  // The app must not re-fetch the profile or the whole dataset each time.
  const count = (frag) => calls.rest.filter((r) => r.path.startsWith(frag)).length;
  expect(count("/rest/v1/profiles")).toBe(1);
  expect(count("/rest/v1/listings")).toBe(1);
  expect(count("/rest/v1/wishlists")).toBe(1);
  expect(count("/rest/v1/demands")).toBe(1);
});

test("a Google student's campus comes from their address", async ({ page }) => {
  await mockGoogle(page);
  await startGoogleSignIn(page);
  await page.waitForTimeout(3000);
  await dismissLocationPrompt(page);

  // The address decides the campus. A Google account on a college domain
  // lands on that campus — there is no picker to answer, because there is
  // no question: the server already knows.
  await expect(page.locator("#collegeOverlay")).toBeHidden();
  await expect(page.locator("#menuCollege")).toHaveText("DTU · Signed in");

  // The profile menu says the same thing where the student sees it.
  await page.click("#avatarBtn");
  await expect(page.locator("#menuCollegeBtn")).toBeVisible();
  await expect(page.locator("#menuCollegeBtn")).toHaveText("Campus: DTU");
});

test("the campus cannot be set by hand", async ({ page }) => {
  const calls = await mockGoogle(page);
  await startGoogleSignIn(page);
  await page.waitForTimeout(3000);
  await dismissLocationPrompt(page);

  await page.click("#avatarBtn");
  await page.click("#menuCollegeBtn");
  await expect(page.locator("#collegeOverlay")).toBeVisible();

  // The picker is populated from the database and shows the campus the
  // address resolves to — and it is not editable.
  await expect(page.locator("#collegePick option")).toHaveCount(3);
  await expect(page.locator("#collegePick")).toHaveValue("DTU");
  await expect(page.locator("#collegePick")).toBeDisabled();

  await page.click("#collegeForm button[type=submit]");
  await page.waitForTimeout(1200);

  // And the app never tries to write a campus to the profile.
  const write = calls.rest.find((r) => r.method === "PATCH" && r.path.startsWith("/rest/v1/profiles"));
  expect(write, "the campus is not written by the client").toBeFalsy();
  await expect(page.locator("#collegeOverlay")).toBeHidden();
});

test("a denied Google sign-in tells the student what happened", async ({ page }) => {
  await mockGoogle(page, { deny: true });
  await startGoogleSignIn(page);
  await page.waitForTimeout(2500);

  // The failure used to be silent — the app landed on the homepage with
  // nothing to show for it.
  await expect(page.locator("#authOverlay")).toBeVisible();
  await expect(page.locator("#authError")).toContainText("cancelled");
  // The error params are cleaned out of the address bar.
  expect(page.url()).not.toContain("error_code");
});

test("the profile menu opens where the student can see it", async ({ page }) => {
  await mockGoogle(page);
  await startGoogleSignIn(page);
  await page.waitForTimeout(3000);
  await dismissLocationPrompt(page);

  await page.click("#avatarBtn");
  const menu = page.locator("#profileMenu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Aarav Sharma");

  // The menu used to be a body child, so `top: calc(100% + 10px)` resolved
  // against the page and rendered it below the fold.
  const box = await menu.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeLessThan(300);
  expect(box.y + box.height).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerHeight)) + 1
  );
});
