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

test("interactive controls stay inside the viewport", async ({ page }) => {
  // A clipped control still reports a full scrollWidth when an ancestor
  // hides the overflow, so check the controls themselves.
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE);
    await page.waitForTimeout(600);
    const clipped = await page.evaluate((vw) => {
      const ids = ["signInBtn", "menuBtn", "wishlistBtn", "sellBtn", "heroQ"];
      const bad = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el || el.hidden) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        if (b.right > vw + 1 || b.left < -1) bad.push(`${id} ${Math.round(b.left)}→${Math.round(b.right)}`);
      }
      // The hero search button lives inside the form
      const sb = document.querySelector(".hero-search button")?.getBoundingClientRect();
      if (sb && (sb.right > vw + 1 || sb.left < -1)) bad.push(`searchBtn ${Math.round(sb.left)}→${Math.round(sb.right)}`);
      return bad;
    }, width);
    expect(clipped, `clipped controls at ${width}px`).toEqual([]);
  }
});

test("the sign-in CTA collapses to an icon on small screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  const cta = page.locator("#signInBtn");
  await expect(cta).toBeVisible();
  // The label is gone, the person icon is shown and actually has width
  await expect(page.locator(".auth-cta-text")).toBeHidden();
  await expect(page.locator(".auth-cta-icon")).toBeVisible();
  const iconW = await page.evaluate(() => document.querySelector(".auth-cta-icon").getBoundingClientRect().width);
  expect(iconW).toBeGreaterThan(10);
  // It is still reachable — clicking it opens the auth modal
  await cta.click();
  await expect(page.locator("#authOverlay")).toBeVisible();
});

test("mobile menu opens and triggers sell flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  await page.click("#menuBtn");
  await expect(page.locator("#mobileMenu")).toHaveClass(/open/);
  await page.click("#mSellBtn");
  await expect(page.locator("#sellOverlay")).toBeVisible();
});

test("auth modal switches between sign in and sign up", async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator("#signInBtn")).toBeVisible();
  await page.click("#signInBtn");
  await expect(page.locator("#authOverlay")).toBeVisible();

  // Sign in mode: no signup fields
  await expect(page.locator("#nameField")).toBeHidden();
  await expect(page.locator("#collegeField")).toBeHidden();
  await expect(page.locator("#authSubmit")).toHaveText("Sign in");

  // Sign up mode: name + college appear
  await page.click('[data-authtab="signup"]');
  await expect(page.locator("#nameField")).toBeVisible();
  await expect(page.locator("#collegeField")).toBeVisible();
  await expect(page.locator("#authSubmit")).toHaveText("Create account");
  await expect(page.locator("#authCollege option")).toHaveCount(9);
});

test("auth modal offers Google sign-in", async ({ page }) => {
  await page.goto(BASE);
  await page.click("#signInBtn");
  const google = page.locator("#googleBtn");
  await expect(google).toBeVisible();
  await expect(google).toContainText("Continue with Google");
  // The real Google mark, not a generic icon
  await expect(google.locator("svg path")).toHaveCount(4);
});

test("signup form validates before hitting the network", async ({ page }) => {
  await page.goto(BASE);
  await page.click("#signInBtn");
  await page.click('[data-authtab="signup"]');
  await page.fill("#authForm [name=fullName]", "Test Student");
  await page.selectOption("#authForm [name=college]", "DTU");
  await page.fill("#authForm [name=email]", "test@dtu.ac.in");
  await page.fill("#authForm [name=password]", "short");
  await page.click("#authSubmit");
  await expect(page.locator("#authError")).toContainText("at least 6 characters");
});

test("sync status pill reports the connection state", async ({ page }) => {
  await page.goto(BASE);
  const pill = page.locator("#syncPill");
  await expect(pill).toBeVisible();
  // Offline / unreachable backend must degrade to local mode, not break the UI
  await expect(pill).toHaveAttribute("data-state", /local|live/);
  await expect(page.locator("#syncText")).not.toBeEmpty();
});

test("motion layer adds reveal classes and a scroll progress bar", async ({ page }) => {
  await page.goto(BASE);
  await page.waitForTimeout(1200);
  // Cards stagger in
  const card = page.locator("#productGrid .card").first();
  await expect(card).toHaveClass(/stagger/);
  // Headline words are wrapped but the markup survives
  await expect(page.locator("h1 .accent")).toHaveCount(1);
  await expect(page.locator("h1 .accent .word").first()).toBeVisible();
  // Scroll progress scales with the page
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const scale = await page.evaluate(() => {
    const bar = document.querySelector("#scrollProgress i");
    const m = new DOMMatrixReadOnly(getComputedStyle(bar).transform);
    return m.a;
  });
  expect(scale).toBeGreaterThan(0.9);
});

test("Supabase row mapping produces valid UI models", async ({ page }) => {
  await page.goto(BASE);
  // Map a row shaped exactly like the `listings` table returns
  const listing = await page.evaluate(async () => {
    const { listingFromRow } = await import("./src/persistence.js");
    return listingFromRow({
      id: "aaaa1111-0000-0000-0000-000000000001",
      title: "Study Table + Chair Combo",
      listing_type: "sell",
      category_slug: "furniture",
      price: "2499.00",
      original_price: "5200.00",
      condition: "Like new",
      age_months: 8,
      distance_km: "0.40",
      description: "Solid wood study table.",
      accessories: "Table, chair, keys",
      repair_history: "None",
      battery_health: null,
      is_clearance: false,
      listing_images: [{ url: "./assets/table-chair.svg", sort: 0 }],
      profiles: {
        id: "11111111-1111-1111-1111-111111111111",
        full_name: "Aarav Sharma",
        rating_sum: 24, rating_count: 5, deals_completed: 12, verified: true,
        colleges: { short_name: "DTU" },
      },
    });
  });
  expect(listing.type).toBe("sell");
  expect(listing.price).toBe(2499);
  expect(listing.original).toBe(5200);
  expect(listing.ageMonths).toBe(8);
  expect(listing.distance).toBe(0.4);
  expect(listing.college).toBe("DTU");
  expect(listing.seller).toBe("Aarav Sharma");
  expect(listing.rating).toBe(4.8);
  expect(listing.img).toBe("./assets/table-chair.svg");
  expect(listing.live).toBe(true);
});

test("a seller with no reviews gets no star rating", async ({ page }) => {
  await page.goto(BASE);
  const listing = await page.evaluate(async () => {
    const { listingFromRow } = await import("./src/persistence.js");
    return listingFromRow({
      id: "aaaa1111-0000-0000-0000-000000000009",
      title: "A Brand New Listing",
      listing_type: "sell",
      category_slug: "furniture",
      price: "500.00",
      original_price: "1000.00",
      condition: "Like new",
      age_months: 1,
      distance_km: "0.10",
      profiles: {
        id: "11111111-1111-1111-1111-111111111111",
        full_name: "Aarav Sharma",
        rating_sum: 0, rating_count: 0, deals_completed: 0, verified: true,
        colleges: { short_name: "DTU" },
      },
    });
  });
  // Nobody has reviewed this seller, so there is no score to print. The
  // old mapping wrote "5.0" here, which claimed a perfect score nobody
  // had given.
  expect(listing.rating).toBeNull();
});

test("Supabase demand row mapping carries UniMatch reasons", async ({ page }) => {
  await page.goto(BASE);
  const demand = await page.evaluate(async () => {
    const { demandFromRow } = await import("./src/persistence.js");
    return demandFromRow({
      id: "bbbb1111-0000-0000-0000-000000000001",
      title: "Scientific calculator fx-991",
      notes: "Urgent for end-sem exams",
      category_slug: "electronics",
      budget_max: "800.00",
      needed_by: null,
      status: "matched",
      profiles: { id: "11111111-1111-1111-1111-111111111111", full_name: "Aarav Sharma" },
      demand_matches: [{
        listing_id: "aaaa1111-0000-0000-0000-000000000002",
        score: "0.743",
        reasons: ["Category ✓", "Keyword ✓", "Within budget ✓"],
      }],
    });
  });
  expect(demand.budget).toBe(800);
  expect(demand.user).toBe("Aarav Sharma");
  expect(demand.matches).toHaveLength(1);
  expect(demand.matches[0].reasons).toContain("Keyword ✓");
});

test("student verification unlocks selling", async ({ page }) => {
  await page.goto(BASE);
  await page.click("#verifyBtn");
  await expect(page.locator("#verifyOverlay")).toBeVisible();
  // The address is read off the account, so it is not typed into.
  await expect(page.locator("#verifyForm [name=email]")).toHaveAttribute("readonly", "");
  await page.selectOption("#verifyForm [name=college]", { index: 1 });
  await page.fill("#verifyForm [name=studentId]", "DTU/2K23/042");
  await page.click("#verifyForm button[type='submit']");
  await expect(page.locator("#verifyBtn")).toContainText("Verified");
});
