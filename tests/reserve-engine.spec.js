// UniReserve — the site must say which engine decided.
//
// There are two engines. The server runs the Banker's Algorithm inside
// the database, under a lock, so two students can never take the last
// unit at the same moment. The device runs the same algorithm in the
// browser, as a safety net when the server cannot be reached.
//
// The site has to be honest about which one answered, because a reader
// looking at "Approved" has to know whether the database decided it.
//
// And what the server decided has to reach the page: the safe sequence
// the database computed is the answer to "in what order can these
// reservations be completed", and the panel that shows it must show it.

import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:5173";

/**
 * The catalogue and the dashboard exactly as the server returns them:
 * the shape comes from `reserve_catalogue()` and `reserve_dashboard()`
 * in supabase/migrations/0012_unireserve.sql.
 */
const CATALOGUE = {
  types: [
    {
      slug: "cycles",
      label: "Campus cycles",
      unit_label: "cycle",
      category: "sports",
      description: "Bicycles kept by the campus.",
      sort: 1,
      total: 6,
      allocated: 1,
      available: 5,
    },
    {
      slug: "calculators",
      label: "Scientific calculators",
      unit_label: "calculator",
      category: "books",
      description: "Exam-grade calculators.",
      sort: 2,
      total: 8,
      allocated: 0,
      available: 8,
    },
  ],
  units: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      label: "Cycle 01",
      type: "cycles",
      type_label: "Campus cycles",
      monthly_rate: 150,
      status: "available",
      listing_id: null,
    },
  ],
};

const RESERVATION = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "approved",
  decision: "approved",
  reason: "the campus can still complete every reservation after this one",
  duration_days: 7,
  starts_at: "2026-11-24T10:00:00Z",
  ends_at: "2026-12-01T10:00:00Z",
  created_at: "2026-11-24T10:00:00Z",
  listing_id: null,
  mine: false,
  allocation: { cycles: 1 },
  need: { cycles: 0 },
  safe_sequence: ["22222222-2222-4222-8222-222222222222"],
};

const DASHBOARD = {
  totals: { total: 14, allocated: 1, available: 13 },
  counts: { pending: 0, approved: 1, blocked: 0, finished: 0, total: 1 },
  types: CATALOGUE.types,
  available: { cycles: 5, calculators: 8 },
  safe: true,
  // The safe sequence is a list of reservation ids, in the order the
  // server says they can be completed.
  safe_sequence: ["22222222-2222-4222-8222-222222222222"],
  reservations: [RESERVATION],
  mine: [],
  logs: [],
};

/**
 * Answer the two UniReserve RPCs and fail every other Supabase call, so
 * the site cannot quietly succeed on a fallback.
 */
async function mockReserveServer(page, { fail = false, dashboard = DASHBOARD } = {}) {
  const calls = [];

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());

    if (!url.hostname.endsWith("supabase.co")) {
      await route.continue();
      return;
    }

    if (url.pathname === "/rest/v1/rpc/reserve_catalogue") {
      calls.push("reserve_catalogue");
      await route.fulfill({
        status: fail ? 500 : 200,
        contentType: "application/json",
        body: fail ? JSON.stringify({ message: "boom" }) : JSON.stringify(CATALOGUE),
      });
      return;
    }

    if (url.pathname === "/rest/v1/rpc/reserve_dashboard") {
      calls.push("reserve_dashboard");
      await route.fulfill({
        status: fail ? 500 : 200,
        contentType: "application/json",
        body: fail ? JSON.stringify({ message: "boom" }) : JSON.stringify(dashboard),
      });
      return;
    }

    // Anything else the app asks for is answered with an empty result,
    // so the marketplace still loads.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  return calls;
}

test("the site says the server decided when the RPCs answer", async ({ page }) => {
  const calls = await mockReserveServer(page);

  await page.goto(BASE);
  await page.locator("#unireserve").scrollIntoViewIfNeeded();
  await expect(page.locator("#reserveTypes .reserve-type").first()).toBeVisible();

  const engine = page.locator("#reserveEngine");
  await expect(engine).toHaveAttribute("data-engine", "server");
  await expect(engine).toContainText(/server/i);
  await expect(page.locator("#reserveEngineNote")).toContainText(/database/i);

  // It really did ask the server.
  expect(calls).toContain("reserve_catalogue");
  expect(calls).toContain("reserve_dashboard");

  // And the numbers on screen are the server's, not the device's.
  await expect(page.locator("#reserveTotal")).toHaveText("14");
  await expect(page.locator("#reserveAvailable")).toHaveText("13");
});

test("the site says the device decided when the server cannot be reached", async ({ page }) => {
  await mockReserveServer(page, { fail: true });

  await page.goto(BASE);
  await page.locator("#unireserve").scrollIntoViewIfNeeded();
  await expect(page.locator("#reserveTypes .reserve-type").first()).toBeVisible();

  const engine = page.locator("#reserveEngine");
  await expect(engine).toHaveAttribute("data-engine", "device");
  await expect(engine).toContainText(/device/i);
  await expect(page.locator("#reserveEngineNote")).toContainText(/no UniReserve server/i);

  // The feature still works — it is a safety net, not a blank screen.
  await expect(page.locator("#reserveTotal")).not.toHaveText("0");
});

test("the server engine shows the safe sequence the database returned", async ({ page }) => {
  await mockReserveServer(page);

  await page.goto(BASE);
  await page.locator("#unireserve").scrollIntoViewIfNeeded();
  await expect(page.locator("#reserveTypes .reserve-type").first()).toBeVisible();

  // The mock dashboard carries safe_sequence: ["22222222-..."] — one
  // reservation that can still finish — and a matching reservation that
  // holds one cycle. The panel must show it.
  const sequence = page.locator("#reserveSequence");
  await expect(sequence.locator("li").first()).toBeVisible();
  await expect(sequence).toContainText("1");
  await expect(sequence).toContainText(/cycles/);
  await expect(sequence).not.toContainText(/cannot complete every reservation/i);
});

test("an idle campus does not claim to be unsafe", async ({ page }) => {
  await mockReserveServer(page, {
    dashboard: {
      ...DASHBOARD,
      safe: true,
      safe_sequence: [],
      reservations: [],
      counts: { pending: 0, approved: 0, blocked: 0, finished: 0, total: 0 },
      totals: { total: 14, allocated: 0, available: 14 },
    },
  });

  await page.goto(BASE);
  await page.locator("#unireserve").scrollIntoViewIfNeeded();
  await expect(page.locator("#reserveTypes .reserve-type").first()).toBeVisible();

  const sequence = page.locator("#reserveSequence");
  await expect(sequence).toBeVisible();
  await expect(sequence).not.toContainText(/cannot complete every reservation/i);
});

test("a genuinely unsafe campus still says so", async ({ page }) => {
  await mockReserveServer(page, {
    dashboard: { ...DASHBOARD, safe: false, safe_sequence: [] },
  });

  await page.goto(BASE);
  await page.locator("#unireserve").scrollIntoViewIfNeeded();
  await expect(page.locator("#reserveTypes .reserve-type").first()).toBeVisible();

  await expect(page.locator("#reserveSequence")).toContainText(
    /cannot complete every reservation/i
  );
});
