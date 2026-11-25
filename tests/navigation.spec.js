import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:5173";

/* The nine destinations, in the order the header lists them. */
const SECTIONS = [
  ["#marketplace", "Marketplace"],
  ["#demand", "Demand Board"],
  ["#clearance", "Hostel Clearance"],
  ["#smartprice", "SmartPrice"],
  ["#safeswap", "SafeSwap"],
  ["#unireserve", "UniReserve"],
  ["#unicompress", "UniCompress"],
  ["#unimail", "UniMail"],
  ["#impact", "UniImpact"],
];

test.describe("the navigation bar", () => {
  test("every destination is on screen in a row on a desktop", async ({ page }) => {
    // The complaint this replaces: the links were hidden behind the
    // three-line menu button, so the site structure was invisible.
    for (const width of [1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(BASE);
      await page.waitForTimeout(300);

      const links = page.locator(".nav-links-in a");
      await expect(links).toHaveCount(9);

      // All nine are visible...
      for (const [, name] of SECTIONS) {
        await expect(page.locator(".nav-links-in a", { hasText: name })).toBeVisible();
      }
      // ...in a single row...
      const boxes = await links.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) };
        }),
      );
      const tops = new Set(boxes.map((b) => b.top));
      expect(tops.size, `the row splits at ${width}px`).toBe(1);
      // ...left to right, in order...
      const lefts = boxes.map((b) => b.left);
      expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
      // ...and inside the viewport.
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(-1);
        expect(b.right).toBeLessThanOrEqual(width + 1);
      }
    }
  });

  test("the destinations point at the sections they name", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    const hrefs = await page.locator(".nav-links-in a").evaluateAll((els) =>
      els.map((e) => e.getAttribute("href")),
    );
    expect(hrefs).toEqual(SECTIONS.map(([href]) => href));
    // Every destination exists on the page.
    for (const [href] of SECTIONS) {
      await expect(page.locator(href)).toHaveCount(1);
    }
  });

  test("a desktop has no menu button at all", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await expect(page.locator("#menuBtn")).toBeHidden();
    // The drawer is a phone fallback, so it stays shut.
    await expect(page.locator("#mobileMenu")).toBeHidden();
  });

  test("the account actions stay on the bar beside the brand", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    for (const id of ["wishlistBtn", "verifyBtn", "sellBtn", "signInBtn", "syncPill", "headerLocationBtn"]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
  });

  test("choosing a destination lands the section clear of the sticky header", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await page.waitForTimeout(300);

    await page.locator('.nav-links-in a[href="#safeswap"]').click();
    await page.waitForTimeout(1200);

    const header = await page.locator("#nav").boundingBox();
    const section = await page.locator("#safeswap").boundingBox();
    // The section starts below the header, not under it.
    expect(section.y).toBeGreaterThanOrEqual(header.height - 2);
  });

  test("the destination being read is the one marked", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await page.waitForTimeout(300);

    await page.locator('.nav-links-in a[href="#unimail"]').click();
    await page.waitForTimeout(1200);

    const current = page.locator('.nav-links-in a[aria-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("href", "#unimail");
  });

  test("a phone keeps the destinations in the drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);
    await page.waitForTimeout(300);

    await expect(page.locator(".nav-links-in")).toBeHidden();
    await expect(page.locator("#menuBtn")).toBeVisible();

    await page.click("#menuBtn");
    await expect(page.locator("#mobileMenu")).toHaveClass(/open/);
    await expect(page.locator("#menuBtn")).toHaveAttribute("aria-expanded", "true");

    // All nine are in the drawer, and they are the same destinations.
    const hrefs = await page.locator("#mobileMenu a").evaluateAll((els) =>
      els.map((e) => e.getAttribute("href")),
    );
    expect(hrefs).toEqual(SECTIONS.map(([href]) => href));

    // Nothing in the drawer is clipped by the screen.
    const clipped = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll("#mobileMenu a, #mobileMenu button")]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.right > vw + 1 || r.left < -1))
        .map((r) => `${Math.round(r.left)}→${Math.round(r.right)}`);
    });
    expect(clipped).toEqual([]);
  });

  test("Escape closes the drawer and hands the focus back", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);
    await page.click("#menuBtn");
    await expect(page.locator("#mobileMenu")).toHaveClass(/open/);

    await page.keyboard.press("Escape");
    await expect(page.locator("#mobileMenu")).not.toHaveClass(/open/);
    await expect(page.locator("#menuBtn")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#menuBtn")).toBeFocused();
  });

  test("the destinations are reachable with the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await page.waitForTimeout(300);

    const first = page.locator(".nav-links-in a").first();
    await first.focus();
    await expect(first).toBeFocused();
    // A focused destination shows a visible ring.
    const outline = await first.evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("the bar lifts its edge once the page scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await expect(page.locator("#nav")).not.toHaveClass(/is-scrolled/);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);
    await expect(page.locator("#nav")).toHaveClass(/is-scrolled/);
  });
});
