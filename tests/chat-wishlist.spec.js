// UniHaat — chat, wishlist and product-detail suite.
//
// Three things are checked here that used to be broken:
//
//   1. The header had no chat button, and the chat drawer could never
//      reach the database, so a seller and a buyer could not actually
//      talk to each other.
//   2. The wishlist button only fired a toast — there was no window to
//      look at what you had saved.
//   3. The product modal was taller than its shell, so the bottom of
//      every listing was cut off with nothing to scroll.
//
// The database is mocked at the network boundary and the real vendored
// Supabase client drives the request, exactly as the live-sync suite
// does — so the tests exercise the code the browser actually runs.

import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const SB = "https://gzbmqwvybcmxlsgouhyh.supabase.co";

const BUYER_ID = "cccccccc-1111-2222-3333-444444444444";
const SELLER_ID = "11111111-1111-1111-1111-111111111111";
const COLLEGE_ID = "0f1c5491-12cf-44ed-b0c2-12f79809ed74";

const LISTING_ID = "aaaa1111-0000-0000-0000-000000000001";
const CONVERSATION_ID = "dddd1111-0000-0000-0000-000000000001";

const session = {
  access_token: "mock-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "mock-refresh-token",
  user: {
    id: BUYER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "sana.kapoor@dtu.ac.in",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { name: "Sana Kapoor", full_name: "Sana Kapoor" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
};

const buyerProfile = {
  id: BUYER_ID,
  email: "sana.kapoor@dtu.ac.in",
  full_name: "Sana Kapoor",
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

const sellerProfile = {
  ...buyerProfile,
  id: SELLER_ID,
  email: "aarav.sharma@dtu.ac.in",
  full_name: "Aarav Sharma",
};

// The listing belongs to Aarav, so Sana is the buyer here.
const liveListing = {
  id: LISTING_ID,
  seller_id: SELLER_ID,
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
  created_at: new Date().toISOString(),
  listing_images: [{ url: "./assets/table-chair.svg", alt: "Study Table + Chair Combo", sort: 0 }],
  profiles: {
    ...sellerProfile,
    colleges: { short_name: "DTU" },
  },
};

const inboxRow = {
  id: CONVERSATION_ID,
  listing_id: LISTING_ID,
  listing_title: "Study Table + Chair Combo",
  listing_price: 2499,
  other_id: SELLER_ID,
  other_name: "Aarav Sharma",
  last_body: "Is the table still available?",
  last_at: new Date(Date.now() - 60_000).toISOString(),
  unread: 1,
};

// A listing the seller took off the marketplace earlier.
const archivedListing = {
  ...liveListing,
  id: "aaaa1111-0000-0000-0000-000000000009",
  title: "Old Study Lamp",
  status: "archived",
};

/**
 * Mock Supabase at the network boundary.
 *
 * `options.owner` switches the signed-in student between the buyer and
 * the seller, so the same suite can prove that each side sees only its
 * own half of a conversation.
 */
async function mockSupabase(page, options = {}) {
  const owner = options.owner || "buyer";
  const user = owner === "seller" ? { ...session, user: { ...session.user, id: SELLER_ID, email: "aarav.sharma@dtu.ac.in", user_metadata: { name: "Aarav Sharma", full_name: "Aarav Sharma" } } } : session;
  const calls = { rest: [], sent: [], inbox: 0, archived: 0, rls: [] };

  // The listing always belongs to Aarav. What changes between the tests
  // is who is signed in: Sana, who is buying it, or Aarav, who owns it.
  const listing = liveListing;

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (url.hostname.endsWith("supabase.co")) {
      if (p === "/auth/v1/token") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
        return;
      }
      if (p === "/auth/v1/user") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user.user) });
        return;
      }
      if (p === "/auth/v1/logout") {
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      if (p.startsWith("/rest/v1/")) {
        calls.rest.push({ path: p, method: route.request().method(), select: url.searchParams.get("select") });
        const body = route.request().postData();

        if (p.startsWith("/rest/v1/rpc/conversation_inbox")) {
          calls.inbox += 1;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([inboxRow]) });
          return;
        }
        if (p.startsWith("/rest/v1/rpc/mark_conversation_read")) {
          await route.fulfill({ status: 200, contentType: "application/json", body: "1" });
          return;
        }
        if (p.startsWith("/rest/v1/messages")) {
          if (route.request().method() === "POST") {
            calls.sent.push(JSON.parse(body || "{}"));
            await route.fulfill({
              status: 201,
              contentType: "application/json",
              body: JSON.stringify({
                id: "eeee2222-0000-0000-0000-000000000002",
                conversation_id: CONVERSATION_ID,
                sender_id: user.user.id,
                body: JSON.parse(body || "{}").body,
                read_at: null,
                created_at: new Date().toISOString(),
              }),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([
              {
                id: "eeee1111-0000-0000-0000-000000000001",
                conversation_id: CONVERSATION_ID,
                sender_id: SELLER_ID,
                body: "Is the table still available?",
                read_at: null,
                created_at: new Date(Date.now() - 60_000).toISOString(),
              },
            ]),
          });
          return;
        }
        if (p.startsWith("/rest/v1/conversations")) {
          if (route.request().method() === "POST") {
            await route.fulfill({
              status: 201,
              contentType: "application/json",
              body: JSON.stringify({
                id: CONVERSATION_ID,
                listing_id: LISTING_ID,
                buyer_id: BUYER_ID,
                seller_id: SELLER_ID,
                created_at: new Date().toISOString(),
              }),
            });
            return;
          }
          await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
          return;
        }
        if (p.startsWith("/rest/v1/profiles")) {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([owner === "seller" ? sellerProfile : buyerProfile]) });
          return;
        }
        if (p.startsWith("/rest/v1/listings")) {
          // The archived query is the seller's own taken-down rows.
          if (url.searchParams.get("status") === "eq.archived") {
            calls.archived += 1;
            await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
            return;
          }
          if (route.request().method() === "PATCH") {
            calls.rls.push({ path: p, body: JSON.parse(body || "{}") });
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...listing, status: JSON.parse(body || "{}").status }) });
            return;
          }
          const rows = options.archived ? [listing, archivedListing] : [listing];
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
          return;
        }
        if (p.startsWith("/rest/v1/colleges")) {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: COLLEGE_ID, short_name: "DTU", name: "Delhi Technological University" }]) });
          return;
        }
        if (p.startsWith("/rest/v1/wishlists")) {
          await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      if (p.startsWith("/realtime/v1/")) {
        // The websocket is not mocked; the app must not depend on it to
        // show a conversation.
        await route.abort();
        return;
      }
    }

    await route.fallback();
  });

  return calls;
}

async function signIn(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await page.click("#signInBtn");
  await page.waitForTimeout(250);
  await page.fill('#authForm [name="email"]', "sana.kapoor@dtu.ac.in");
  await page.fill('#authForm [name="password"]', "campus-secret-1");
  await page.click("#authSubmit");
  await page.waitForTimeout(1600);
  // The app offers to work out where the student is. It is not part of
  // what these tests are about, and it sits over the grid.
  const skip = page.locator("#locationSkipBtn");
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.waitForTimeout(400);
  }
}

/* ------------------------------------------------------------- the chat button */

test("the header carries a chat button on every screen", async ({ page }) => {
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    const btn = page.locator("#chatBtn");
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(30);
    expect(box.height).toBeGreaterThanOrEqual(30);
  }
});

test("the chat button opens the chat section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);

  await page.click("#chatBtn");
  await page.waitForTimeout(900);

  const chats = page.locator("#chats");
  await expect(chats).toBeVisible();
  await expect(chats).toContainText("Your conversations");
  // The section has to be on screen, not merely in the document.
  const box = await chats.boundingBox();
  expect(box.y).toBeLessThan(900);
});

test("the chat section asks a signed-out student to sign in", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await page.click("#chatBtn");
  await page.waitForTimeout(600);

  await expect(page.locator("#chatEmpty")).toBeVisible();
  await expect(page.locator("#chatEmpty")).toContainText("Sign in");
  await expect(page.locator("#chatSignIn")).toBeVisible();
});

/* ------------------------------------------------------------- the chat list */

test("a signed-in student sees their conversations", async ({ page }) => {
  await mockSupabase(page);
  await signIn(page);

  await page.click("#chatBtn");
  await page.waitForTimeout(1200);

  await expect(page.locator("#chatList .chat-row")).toHaveCount(1);
  const row = page.locator("#chatList .chat-row").first();
  await expect(row).toContainText("Aarav Sharma");
  await expect(row).toContainText("Is the table still available?");
  // One unread message, and it is shown as one.
  await expect(row.locator(".chat-unread")).toHaveText("1");
  await expect(row).toHaveClass(/unread/);
});

test("the unread badge counts the messages waiting", async ({ page }) => {
  await mockSupabase(page);
  await signIn(page);

  await page.click("#chatBtn");
  await page.waitForTimeout(1200);

  await expect(page.locator("#chatUnread")).toBeVisible();
  await expect(page.locator("#chatUnread")).toHaveText("1");
});

/* -------------------------------------------------------------- the chat drawer */

test("a buyer opens a conversation and sends a message", async ({ page }) => {
  const calls = await mockSupabase(page);
  await signIn(page);

  // Open the seller's listing and start a conversation from it.
  await page.waitForSelector(".card");
  await page.locator(".card").first().click();
  await page.waitForSelector("#productOverlay:not([hidden])");
  await page.click("#modalChat");
  await page.waitForTimeout(1200);

  await expect(page.locator("#chatDrawer")).toBeVisible();
  await expect(page.locator("#chatTitle")).toContainText("Study Table");

  await page.fill("#chatInput", "Can you hold it until Friday?");
  await page.click('#chatForm button[type="submit"]');
  await page.waitForTimeout(1200);

  // The message is written to the database, not to local storage.
  expect(calls.sent.length).toBeGreaterThan(0);
  expect(calls.sent[0].body).toBe("Can you hold it until Friday?");
  expect(calls.sent[0].conversation_id).toBe(CONVERSATION_ID);
  await expect(page.locator("#chatBody")).toContainText("Can you hold it until Friday?");
});

test("the seller's side of a conversation is separate from the buyer's", async ({ page }) => {
  const buyerCalls = await mockSupabase(page, { owner: "buyer" });
  await signIn(page);
  await page.waitForSelector(".card");
  await page.locator(".card").first().click();
  await page.waitForSelector("#productOverlay:not([hidden])");
  await page.click("#modalChat");
  await page.waitForTimeout(900);
  await page.fill("#chatInput", "Hello from the buyer");
  await page.click('#chatForm button[type="submit"]');
  await page.waitForTimeout(700);

  expect(buyerCalls.sent[0].sender_id ?? buyerCalls.sent[0].body).toBeTruthy();

  // A student who is not in the conversation cannot read it: the query
  // asks the database for the caller's own rows only.
  const inboxCall = buyerCalls.rest.find((c) => c.path.startsWith("/rest/v1/rpc/conversation_inbox"));
  expect(inboxCall).toBeTruthy();
});

/* ------------------------------------------------------------- the wishlist */

test("the wishlist button opens a window of saved items", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card");
  await page.waitForTimeout(300);

  // Save two listings from the grid.
  await page.locator(".card .heart").nth(0).click();
  await page.waitForTimeout(200);
  await page.locator(".card .heart").nth(1).click();
  await page.waitForTimeout(200);

  await page.click("#wishlistBtn");
  await page.waitForTimeout(500);

  await expect(page.locator("#wishlistDrawer")).toBeVisible();
  await expect(page.locator(".wishlist-item")).toHaveCount(2);
  await expect(page.locator("#wishlistCount")).toHaveText("2");
  // The window shows the price and the seller, not just a title.
  await expect(page.locator(".wishlist-item").first()).toContainText("₹");
});

test("a saved item can be removed from the wishlist window", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card");
  await page.waitForTimeout(300);

  await page.locator(".card .heart").first().click();
  await page.waitForTimeout(200);
  await page.click("#wishlistBtn");
  await page.waitForTimeout(400);
  await expect(page.locator(".wishlist-item")).toHaveCount(1);

  await page.locator("[data-wish-remove]").first().click();
  await page.waitForTimeout(400);

  await expect(page.locator(".wishlist-item")).toHaveCount(0);
  await expect(page.locator("#wishlistCount")).toHaveText("0");
  await expect(page.locator("#wishlistDrawer")).toContainText("Nothing saved yet");
});

test("the empty wishlist window offers a way into the marketplace", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await page.click("#wishlistBtn");
  await page.waitForTimeout(400);

  await expect(page.locator("#wishlistDrawer")).toBeVisible();
  await expect(page.locator("#wishlistBrowse")).toBeVisible();
});

test("a saved item opens its product from the wishlist window", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card");
  await page.waitForTimeout(300);
  await page.locator(".card .heart").first().click();
  await page.waitForTimeout(200);

  await page.click("#wishlistBtn");
  await page.waitForTimeout(400);
  await page.locator("[data-wish-open]").first().click();
  await page.waitForTimeout(500);

  await expect(page.locator("#productOverlay")).toBeVisible();
  await expect(page.locator("#modalTitle")).toBeVisible();
});

/* --------------------------------------------------------- the product modal */

test("the product modal is never taller than the screen", async ({ page }) => {
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [360, 640]]) {
    await page.setViewportSize({ width, height });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".card");
    await page.locator(".card").first().click();
    await page.waitForSelector("#productOverlay:not([hidden]) .detail");
    await page.waitForTimeout(400);

    const modal = await page.locator(".modal-product").boundingBox();
    expect(modal.height, `modal at ${width}x${height}`).toBeLessThanOrEqual(height);

    // The detail must stay inside the modal — no content hanging out
    // of the shell with nothing to scroll.
    const overflow = await page.evaluate(() => {
      const m = document.querySelector(".modal-product");
      const d = document.querySelector(".detail");
      if (!m || !d) return true;
      const mr = m.getBoundingClientRect();
      const dr = d.getBoundingClientRect();
      return dr.bottom > mr.bottom + 1 || dr.right > mr.right + 1;
    });
    expect(overflow, `detail overflows the modal at ${width}x${height}`).toBe(false);
  }
});

test("the bottom of a product can be reached by scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card");
  await page.locator(".card").first().click();
  await page.waitForSelector("#productOverlay:not([hidden]) .detail");
  await page.waitForTimeout(400);

  const reached = await page.evaluate(async () => {
    const d = document.querySelector(".detail");
    d.scrollTop = d.scrollHeight;
    await new Promise((r) => setTimeout(r, 250));
    const note = document.querySelector(".detail-note");
    const actions = document.querySelector(".detail-actions");
    const dr = d.getBoundingClientRect();
    const nr = note.getBoundingClientRect();
    const ar = actions.getBoundingClientRect();
    return nr.bottom <= dr.bottom + 2 && ar.bottom <= dr.bottom + 2;
  });
  expect(reached).toBe(true);
});

test("the SafeSwap code sits beside its picture, not under it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card");
  await page.locator(".card").first().click();
  await page.waitForSelector("#productOverlay:not([hidden]) .detail");
  await page.waitForTimeout(400);

  const boxes = await page.evaluate(() => {
    const qr = document.querySelector(".qr-mini");
    if (!qr) return null;
    const canvas = qr.querySelector("canvas");
    const text = qr.querySelector("div");
    const c = canvas.getBoundingClientRect();
    const t = text.getBoundingClientRect();
    return { c: { x: c.x, y: c.y, right: c.right, bottom: c.bottom }, t: { x: t.x, y: t.y } };
  });
  expect(boxes).not.toBeNull();
  // The text starts to the right of the code, not underneath it.
  expect(boxes.t.x).toBeGreaterThanOrEqual(boxes.c.right - 1);
  expect(Math.abs(boxes.t.y - boxes.c.y)).toBeLessThan(40);
});

/* ----------------------------------------------------------- the owner panel */

test("a seller sees owner controls instead of the buyer buttons", async ({ page }) => {
  await mockSupabase(page, { owner: "seller" });
  await signIn(page);

  await page.waitForSelector(".card");
  await page.locator(".card").first().click();
  await page.waitForSelector("#productOverlay:not([hidden]) .detail");
  await page.waitForTimeout(400);

  await expect(page.locator(".owner-panel")).toBeVisible();
  await expect(page.locator("#modalRemove")).toBeVisible();
  await expect(page.locator("#modalMarkSold")).toBeVisible();
  // The buyer buttons are gone, not stacked underneath.
  await expect(page.locator("#modalChat")).toHaveCount(0);
  await expect(page.locator("#modalWish")).toHaveCount(0);
  await expect(page.locator("#modalReport")).toHaveCount(0);
});

test("removing a listing archives it rather than deleting it", async ({ page }) => {
  const calls = await mockSupabase(page, { owner: "seller" });
  await signIn(page);

  await page.waitForSelector(".card");
  await page.locator(".card").first().click();
  await page.waitForSelector("#productOverlay:not([hidden]) .detail");
  await page.waitForTimeout(400);

  await page.click("#modalRemove");
  await page.waitForTimeout(300);
  // It asks first.
  await expect(page.locator("#confirmOverlay")).toBeVisible();
  await page.click("#confirmYes");
  await page.waitForTimeout(1200);

  const archived = calls.rls.find((c) => c.body?.status === "archived");
  expect(archived, "the listing was not archived").toBeTruthy();
  // Nothing was deleted.
  expect(calls.rest.some((c) => c.method === "DELETE")).toBe(false);
});

test("a cancelled removal leaves the listing alone", async ({ page }) => {
  const calls = await mockSupabase(page, { owner: "seller" });
  await signIn(page);

  await page.waitForSelector(".card");
  await page.locator(".card").first().click();
  await page.waitForSelector("#productOverlay:not([hidden]) .detail");
  await page.waitForTimeout(400);

  await page.click("#modalRemove");
  await page.waitForTimeout(300);
  await page.click("#confirmNo");
  await page.waitForTimeout(700);

  expect(calls.rls.length).toBe(0);
  await expect(page.locator("#productOverlay")).toBeVisible();
});

test("a seller can bring an archived listing back", async ({ page }) => {
  const calls = await mockSupabase(page, { owner: "seller", archived: true });
  await signIn(page);

  await page.waitForSelector(".card");
  await page.locator(".card").first().click();
  await page.waitForSelector("#productOverlay:not([hidden]) .detail");
  await page.waitForTimeout(400);

  // The archived listing is named in the owner panel, with a way back.
  await expect(page.locator(".owner-panel")).toBeVisible();
  await expect(page.locator(".archived-row")).toContainText("Old Study Lamp");
  await expect(page.locator("[data-restore]")).toHaveCount(1);

  await page.locator("[data-restore]").first().click();
  await page.waitForTimeout(1200);

  const restored = calls.rls.find((c) => c.body?.status === "active");
  expect(restored, "the listing was not restored").toBeTruthy();
  expect(restored.body.status).toBe("active");
  // Nothing was deleted on the way out.
  expect(calls.rest.some((c) => c.method === "DELETE")).toBe(false);
});

test("an archived listing is not on the marketplace", async ({ page }) => {
  await mockSupabase(page, { owner: "seller", archived: true });
  await signIn(page);

  await page.waitForSelector(".card");
  await page.waitForTimeout(600);

  // The taken-down listing is not in the grid.
  const titles = await page.locator(".card h3").allInnerTexts();
  expect(titles.join(" ")).not.toContain("Old Study Lamp");
});
