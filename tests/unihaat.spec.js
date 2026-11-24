import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:5173";

test("hero renders and marketplace lists verified listings", async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByRole("heading", { name: /Your Campus/i })).toBeVisible();
  const cards = page.locator("#productGrid .card");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(10);
  await expect(cards.first()).toContainText("₹");
  await expect(cards.first()).toContainText("Verified");
});

test("search filters listings", async ({ page }) => {
  await page.goto(BASE);
  await page.fill("#searchInput", "calculator");
  await expect(page.locator("#productGrid .card")).toHaveCount(1);
  await expect(page.locator("#productGrid")).toContainText("Calculator");
});

test("category + type filters narrow the grid", async ({ page }) => {
  await page.goto(BASE);
  await page.locator('.pill[data-type="free"]').click();
  await expect(page.locator("#productGrid .card")).toHaveCount(1);
  await expect(page.locator("#productGrid .card").first()).toContainText("FREE");
  await page.locator('.pill[data-type="all"]').click();
  await page.selectOption("#catSelect", "phones");
  await expect(page.locator("#productGrid .card")).toHaveCount(1);
  await expect(page.locator("#productGrid .card").first()).toContainText("iPhone");
});

test("product detail shows Passport and SafeSwap QR", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#productGrid .card").first().click();
  const modal = page.locator("#productOverlay");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { name: /Product Passport/i })).toBeVisible();
  await expect(modal.getByText("SafeSwap ready")).toBeVisible();
  await expect(modal.locator("#modalQr")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("SmartPrice calculator updates live", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#smartprice").scrollIntoViewIfNeeded();
  const before = await page.locator("#spPrice").textContent();
  await page.fill("#spOriginal", "20000");
  await expect(page.locator("#spPrice")).not.toHaveText(before);
  await expect(page.locator("#spRange")).toContainText("Fair range");
});

test("demand board renders with UniMatch results", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#demand").scrollIntoViewIfNeeded();
  await expect(page.locator(".demand-card").first()).toBeVisible();
  await expect(page.locator(".demand-card").first()).toContainText("UniMatch");
  await page.fill('#demandForm [name="title"]', "Electric kettle");
  await page.selectOption('#demandForm [name="category"]', "appliances");
  await page.fill('#demandForm [name="budget"]', "600");
  await page.click('#demandForm button[type="submit"]');
  await expect(page.locator(".demand-card").first()).toContainText("Electric kettle");
});

test("SafeSwap moves from pending to completed", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#safeswap").scrollIntoViewIfNeeded();
  await expect(page.locator("#swapCode")).toContainText("UH-");
  await page.click("#swapScanBtn");
  await page.click("#swapScanBtn");
  await expect(page.locator("#swapStatus")).toContainText(/completed/i);
});

test("wishlist persists across reload", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("[data-heart]").first().click();
  await expect(page.locator("#wishlistCount")).toHaveText("1");
  await page.reload();
  await expect(page.locator("#wishlistCount")).toHaveText("1");
});

test("sell flow publishes a listing", async ({ page }) => {
  await page.goto(BASE);
  await page.click("#sellBtn");
  await expect(page.locator("#sellOverlay")).toBeVisible();
  await page.fill('#sellForm [name="title"]', "Mini Fan 3 Blade");
  await page.fill('#sellForm [name="price"]', "450");
  await page.fill('#sellForm [name="original"]', "1200");
  await page.selectOption('#sellForm [name="category"]', "appliances");
  await page.fill('#sellForm [name="age"]', "6");
  await expect(page.locator("#sellSmartHint")).toContainText("SmartPrice recommends");
  await page.click('#sellForm button[type="submit"]');
  await expect(page.locator("#productGrid .card").first()).toContainText("Mini Fan 3 Blade");
});

test("chat drawer opens and sends a message", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#productGrid .card").first().click();
  await page.click("#modalChat");
  await expect(page.locator("#chatDrawer")).toBeVisible();
  await page.fill("#chatInput", "Is it available this evening?");
  await page.press("#chatInput", "Enter");
  await expect(page.locator("#chatBody")).toContainText("Is it available this evening?");
});

test("SmartPrice condition selector changes the price", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#smartprice").scrollIntoViewIfNeeded();
  const good = await page.locator("#spPrice").textContent();
  await page.click('#spCond button[data-cond="Like new"]');
  await expect(page.locator("#spPrice")).not.toHaveText(good);
  await page.click('#spCond button[data-cond="Fair"]');
  const fair = await page.locator("#spPrice").textContent();
  expect(fair).not.toBe(good);
  // Fair must be cheaper than Like new
  const n = (t) => Number(t.replace(/[^0-9.]/g, ""));
  expect(n(fair)).toBeLessThan(n(good));
});

test("UniMatch only returns relevant listings", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#demand").scrollIntoViewIfNeeded();
  await expect(page.locator(".demand-card").first()).toContainText("Casio fx-991ES Plus Calculator");
  // A calculator demand must not match unrelated hostel/electronics goods
  const matchText = await page.locator(".demand-card").first().locator(".match").textContent();
  expect(matchText).not.toContain("Lab Coat");
});

test("UniImpact counters and bars render values", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#impact").scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  const counters = await page.locator(".impact-card strong").allTextContents();
  expect(counters[0]).toBe("48,210");
  expect(counters[1]).toContain("Cr");
  const widths = await page.evaluate(() =>
    [...document.querySelectorAll(".bar i")].map((e) => e.getBoundingClientRect().width)
  );
  expect(widths.every((w) => w > 0)).toBe(true);
});

test("no horizontal overflow on mobile", async ({ page }) => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE);
    await page.waitForTimeout(400);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollW, `overflow at ${width}px`).toBeLessThanOrEqual(vw + 1);
  }
});

test("mobile menu opens and triggers sell flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  await page.click("#menuBtn");
  await expect(page.locator("#mobileMenu")).toHaveClass(/open/);
  await page.click("#mSellBtn");
  await expect(page.locator("#sellOverlay")).toBeVisible();
});

test("student verification unlocks selling", async ({ page }) => {
  await page.goto(BASE);
  await page.click("#verifyBtn");
  await expect(page.locator("#verifyOverlay")).toBeVisible();
  await page.fill("#verifyForm [name=email]", "aarav@dtu.ac.in");
  await page.selectOption("#verifyForm [name=college]", { index: 1 });
  await page.fill("#verifyForm [name=studentId]", "DTU/2K23/042");
  await page.click("#verifyForm button[type='submit']");
  await expect(page.locator("#verifyBtn")).toContainText("Verified");
});
