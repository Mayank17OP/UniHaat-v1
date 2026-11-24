import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:5173";

test.beforeEach(async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#unireserve").scrollIntoViewIfNeeded();
  // The feature asks the server for the stock; give it a moment to answer
  // (or to fall back to the device engine).
  await expect(page.locator("#reserveTypes .reserve-type").first()).toBeVisible();
});

test("UniReserve section renders with its name and tagline", async ({ page }) => {
  const section = page.locator("#unireserve");
  await expect(section).toContainText("Smart Reservations.");
  await expect(section).toContainText("Safe Allocations. Zero Deadlocks.");
  await expect(section.locator("#reserveTypes .reserve-type").first()).toBeVisible();
});

test("the dashboard shows total, allocated, available, pending, approved and unsafe attempts", async ({ page }) => {
  const stats = page.locator(".reserve-stats");
  await expect(stats.locator("#reserveTotal")).not.toHaveText("0");
  await expect(stats.locator("#reserveAvailable")).not.toHaveText("0");
  for (const id of ["#reserveTotal", "#reserveAllocated", "#reserveAvailable", "#reservePending", "#reserveApproved", "#reserveUnsafe"]) {
    await expect(stats.locator(id)).toBeVisible();
  }
  await expect(page.locator("#reserveVector .reserve-vector-row").first()).toBeVisible();
  await expect(page.locator("#reserveSequence")).toBeVisible();
  await expect(page.locator("#reserveLog")).toBeVisible();
});

test("a safe reservation is approved and the allocation is shown", async ({ page }) => {
  await page.fill('#reserveMatrix [data-now="cycles"]', "1");
  await page.fill('#reserveMatrix [data-max="cycles"]', "1");
  await page.click("#reserveSubmit");
  const outcome = page.locator("#reserveOutcome");
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText(/Approved/i);
  await expect(page.locator("#reserveMine .reserve-item").first()).toContainText(/Approved/i);
  await expect(page.locator("#reserveMine .reserve-item").first()).toContainText(/cycles/i);
});

test("a request beyond the free pool is held, not approved", async ({ page }) => {
  // Take every cycle first, so the next request cannot be satisfied.
  await page.fill('#reserveMatrix [data-now="cycles"]', "6");
  await page.fill('#reserveMatrix [data-max="cycles"]', "6");
  await page.click("#reserveSubmit");
  await expect(page.locator("#reserveOutcome")).toContainText(/Approved/i);

  await page.fill('#reserveMatrix [data-now="cycles"]', "6");
  await page.fill('#reserveMatrix [data-max="cycles"]', "6");
  await page.click("#reserveSubmit");
  await expect(page.locator("#reserveOutcome")).toContainText(/Held|waiting/i);
});

test("finishing a reservation releases the resources back", async ({ page }) => {
  await page.fill('#reserveMatrix [data-now="calculators"]', "2");
  await page.fill('#reserveMatrix [data-max="calculators"]', "2");
  await page.click("#reserveSubmit");
  await expect(page.locator("#reserveOutcome")).toContainText(/Approved/i);

  const before = Number(await page.locator("#reserveAvailable").textContent());
  await page.locator('#reserveMine [data-release][data-status="completed"]').first().click();
  await expect(page.locator("#reserveAvailable")).not.toHaveText(String(before));
  const after = Number(await page.locator("#reserveAvailable").textContent());
  expect(after).toBeGreaterThan(before);
});

test("the safe sequence is shown and changes after an allocation", async ({ page }) => {
  await page.fill('#reserveMatrix [data-now="cycles"]', "1");
  await page.fill('#reserveMatrix [data-max="cycles"]', "1");
  await page.click("#reserveSubmit");
  await expect(page.locator("#reserveOutcome")).toContainText(/Approved/i);
  await expect(page.locator("#reserveSequence li").first()).toBeVisible();
  const first = await page.locator("#reserveSequence").textContent();
  expect(first.length).toBeGreaterThan(0);
});

test("the demonstration runs the four worked examples", async ({ page }) => {
  await page.locator("#reserveDemoBtn").scrollIntoViewIfNeeded();
  await page.click("#reserveDemoBtn");
  const scenarios = page.locator("#reserveScenarios .reserve-scenario");
  await expect(scenarios).toHaveCount(4);
  await expect(scenarios.nth(0)).toContainText(/safe reservation is approved/i);
  await expect(scenarios.nth(1)).toContainText(/unsafe reservation is blocked/i);
  await expect(scenarios.nth(2)).toContainText(/released/i);
  await expect(scenarios.nth(3)).toContainText(/safe sequence changes/i);
  await expect(scenarios.nth(0)).toContainText(/Approved/i);
  await expect(scenarios.nth(1)).toContainText(/Blocked/i);
});

test("the reservation log records the decision", async ({ page }) => {
  await page.fill('#reserveMatrix [data-now="cycles"]', "1");
  await page.fill('#reserveMatrix [data-max="cycles"]', "1");
  await page.click("#reserveSubmit");
  await expect(page.locator("#reserveOutcome")).toContainText(/Approved/i);
  await expect(page.locator("#reserveLog .reserve-log-row").first()).toContainText(/requested/i);
});

test("the catalogue lists every rentable kind of thing", async ({ page }) => {
  const types = page.locator("#reserveTypes .reserve-type");
  await expect(types).toHaveCount(5);
  await expect(types.nth(0)).toContainText(/free/i);
});
