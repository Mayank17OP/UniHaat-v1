// UniHaat — college email addresses only.
//
// UniHaat is a campus marketplace, so an account may only exist on an
// address that belongs to one of the colleges. The database enforces that
// (a BEFORE INSERT trigger on `auth.users`); this suite covers the half the
// browser is responsible for:
//
//   1. the form must not offer to open an account on a personal address,
//      and must not put that address on the wire;
//   2. the college has to follow the address, including a campus
//      sub-domain such as `gn.amity.edu`;
//   3. a lookalike domain (`notdtu.ac.in`) is nobody's.
//
// GoTrue and PostgREST are mocked at the network layer, as in the other
// suites: the sandbox cannot reach Supabase, and the point here is what the
// app does before and after the request.

import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const SB = "https://gzbmqwvybcmxlsgouhyh.supabase.co";
const COLLEGE_ID = "0f1c5491-12cf-44ed-b0c2-12f79809ed74";

// The college list the server would return. It carries the mail domain,
// which is the list the sign-up form checks against.
const colleges = [
  {
    id: COLLEGE_ID,
    short_name: "DTU",
    name: "Delhi Technological University",
    email_domain: "dtu.ac.in",
  },
  {
    id: "7f3dfe31-d8ce-4868-9ec5-9c9a41df1e3e",
    short_name: "DU",
    name: "University of Delhi",
    email_domain: "du.ac.in",
  },
  {
    id: "79b41a82-1897-48b4-8b85-4ef2a029ab1c",
    short_name: "Amity",
    name: "Amity University",
    email_domain: "amity.edu",
  },
];

/**
 * Mock the auth and REST layers, recording what the app asked for.
 * @param {import('@playwright/test').Page} page
 */
async function mockSupabase(page) {
  const calls = { signup: null, token: null, colleges: null };

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.hostname.endsWith("supabase.co")) return route.fallback();

    const p = url.pathname;

    if (p === "/auth/v1/settings") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ disable_signup: false, external: { google: true } }),
      });
    }
    if (p === "/auth/v1/signup") {
      calls.signup = { url: url.search, body: route.request().postData() };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "new-student", email: "aarav.sharma@dtu.ac.in" }),
      });
    }
    if (p === "/auth/v1/token") {
      calls.token = { url: url.search, body: route.request().postData() };
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        }),
      });
    }
    if (p.startsWith("/rest/v1/colleges")) {
      calls.colleges = { select: url.searchParams.get("select"), search: url.search };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(colleges),
      });
    }
    if (p.startsWith("/rest/v1/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  return calls;
}

/** Open the auth modal on the given tab and wait for the college list. */
async function openAuth(page, mode) {
  await page.goto(BASE);
  await page.waitForTimeout(900);
  await page.click("#signInBtn");
  await page.waitForTimeout(200);
  if (mode === "signup") {
    await page.click('[data-authtab="signup"]');
    await page.waitForTimeout(200);
  }
}

test("the sign-up form refuses a personal address and never puts it on the wire", async ({ page }) => {
  const calls = await mockSupabase(page);
  await openAuth(page, "signup");

  await page.fill("#authForm [name=email]", "student@gmail.com");
  await page.fill("#authForm [name=fullName]", "Aarav Sharma");
  await page.fill("#authForm [name=password]", "campus-life-1");
  await page.click("#authSubmit");

  const error = page.locator("#authError");
  await expect(error).toBeVisible();
  await expect(error).toContainText(/college/i);
  // The address never leaves the browser.
  expect(calls.signup, "no sign-up request was made").toBeNull();
});

test("the sign-in form refuses a personal address", async ({ page }) => {
  const calls = await mockSupabase(page);
  await openAuth(page, "signin");

  await page.fill("#authForm [name=email]", "student@yahoo.com");
  await page.fill("#authForm [name=password]", "campus-life-1");
  await page.click("#authSubmit");

  const error = page.locator("#authError");
  await expect(error).toBeVisible();
  await expect(error).toContainText(/college/i);
  expect(calls.token, "no sign-in request was made").toBeNull();
});

test("a lookalike domain is nobody's", async ({ page }) => {
  const calls = await mockSupabase(page);
  await openAuth(page, "signup");

  await page.fill("#authForm [name=email]", "student@notdtu.ac.in");
  await page.fill("#authForm [name=fullName]", "Aarav Sharma");
  await page.fill("#authForm [name=password]", "campus-life-1");
  await page.click("#authSubmit");

  await expect(page.locator("#authError")).toContainText(/college/i);
  expect(calls.signup, "no sign-up request was made").toBeNull();
});

test("a college address reaches the server", async ({ page }) => {
  const calls = await mockSupabase(page);
  await openAuth(page, "signup");

  await page.fill("#authForm [name=email]", "aarav.sharma@dtu.ac.in");
  await page.fill("#authForm [name=fullName]", "Aarav Sharma");
  await page.fill("#authForm [name=password]", "campus-life-1");
  await page.click("#authSubmit");

  await page.waitForTimeout(600);
  expect(calls.signup, "the sign-up request was made").toBeTruthy();
  expect(calls.signup.body || calls.signup.url).toContain("aarav.sharma@dtu.ac.in");
});

test("the college follows the address", async ({ page }) => {
  await mockSupabase(page);
  await openAuth(page, "signup");

  await page.fill("#authForm [name=email]", "aarav.sharma@dtu.ac.in");
  await expect(page.locator("#authCollege")).toHaveValue("DTU");

  await page.fill("#authForm [name=email]", "aarav.sharma@du.ac.in");
  await expect(page.locator("#authCollege")).toHaveValue("DU");

  // A campus sub-domain is the same college as its parent domain.
  await page.fill("#authForm [name=email]", "aarav.sharma@gn.amity.edu");
  await expect(page.locator("#authCollege")).toHaveValue("Amity");
});

test("the app asks the server which addresses it accepts", async ({ page }) => {
  const calls = await mockSupabase(page);
  await page.goto(BASE);
  await page.waitForTimeout(1200);

  expect(calls.colleges, "the college list was fetched").toBeTruthy();
  // The domain is the part that matters, so it has to be on the way in.
  expect(calls.colleges.select).toContain("email_domain");
});

test("a Google account that is not a college account is told why", async ({ page }) => {
  await mockSupabase(page);
  // The server refuses to open the account, so the round trip comes back
  // with its error in the address bar.
  await page.goto(`${BASE}/?error=server_error&error_code=unexpected_failure&error_description=Database+error+creating+new+user`);
  await page.waitForTimeout(1200);

  const error = page.locator("#authError");
  await expect(error).toBeVisible();
  await expect(error).toContainText(/college/i);
});
