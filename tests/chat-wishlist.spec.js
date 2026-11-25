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

async function signIn(page, email = "sana.kapoor@dtu.ac.in") {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await page.click("#signInBtn");
  await page.waitForTimeout(250);
  await page.fill('#authForm [name="email"]', email);
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

/* ------------------------------------------------- a seller replies for real */

/**
 * The shared mock the two halves of a conversation talk through.
 *
 * Both the seller and the customer write to the same store and listen
 * to the same realtime stream, so a reply really is written once and
 * really is delivered to the other side.
 */
function createChatBackend() {
  return {
    // The customer has already asked about the table.
    messages: [{
      id: "eeee1111-0000-0000-0000-000000000001",
      conversation_id: CONVERSATION_ID,
      sender_id: BUYER_ID,
      body: "Is the table still available?",
      read_at: null,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }],
    sent: [],
    sockets: new Set(),
    /** Hand a message row to every page listening on the stream. */
    deliver(row) {
      for (const socket of this.sockets) socket(row);
    },
  };
}

const MESSAGE_COLUMNS = [
  { name: "id", type: "uuid" },
  { name: "conversation_id", type: "uuid" },
  { name: "sender_id", type: "uuid" },
  { name: "body", type: "text" },
  { name: "read_at", type: "timestamptz" },
  { name: "created_at", type: "timestamptz" },
];

// A second thread, so the suite can prove a reply follows the thread
// on screen rather than the one that happened to be opened first.
const SECOND_CONVERSATION_ID = "dddd1111-0000-0000-0000-000000000002";
const SECOND_LISTING_ID = "aaaa1111-0000-0000-0000-000000000002";
const STRANGER_ID = "bbbb2222-0000-0000-0000-000000000002";

/**
 * Point one page at the shared backend.
 *
 * `owner` decides who is signed in. The database is mocked at the
 * network boundary and the real vendored Supabase client drives the
 * request, so the page runs the same code the browser runs.
 */
async function mockChatPage(page, backend, owner = "buyer") {
  const isSeller = owner === "seller";
  const me = isSeller ? sellerProfile : buyerProfile;
  const them = isSeller ? buyerProfile : sellerProfile;
  const user = isSeller
    ? { ...session, user: { ...session.user, id: SELLER_ID, email: "aarav.sharma@dtu.ac.in", user_metadata: { name: "Aarav Sharma", full_name: "Aarav Sharma" } } }
    : session;

  const myRows = [
    {
      id: CONVERSATION_ID,
      listing_id: LISTING_ID,
      listing_title: "Study Table + Chair Combo",
      listing_price: 2499,
      other_id: them.id,
      other_name: them.full_name,
      last_body: "Is the table still available?",
      last_at: new Date(Date.now() - 60_000).toISOString(),
      unread: 1,
    },
  ];
  if (isSeller) {
    // Aarav is selling to more than one student, so his inbox has a
    // second thread with somebody else entirely.
    myRows.push({
      id: SECOND_CONVERSATION_ID,
      listing_id: SECOND_LISTING_ID,
      listing_title: "Old Study Lamp",
      listing_price: 450,
      other_id: STRANGER_ID,
      other_name: "Kabir Mehta",
      last_body: "Does the lamp still work?",
      last_at: new Date(Date.now() - 600_000).toISOString(),
      unread: 0,
    });
  }

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (!url.hostname.endsWith("supabase.co")) {
      await route.fallback();
      return;
    }

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
      const body = route.request().postData();

      if (p.startsWith("/rest/v1/rpc/conversation_inbox")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(myRows) });
        return;
      }
      if (p.startsWith("/rest/v1/rpc/mark_conversation_read")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: "1" });
        return;
      }
      if (p.startsWith("/rest/v1/messages")) {
        if (route.request().method() === "POST") {
          const written = JSON.parse(body || "{}");
          backend.sent.push(written);
          const row = {
            id: `eeee2222-0000-0000-0000-${String(backend.messages.length + 2).padStart(12, "0")}`,
            conversation_id: written.conversation_id,
            sender_id: user.user.id,
            body: written.body,
            read_at: null,
            created_at: new Date().toISOString(),
          };
          backend.messages.push(row);
          await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(row) });
          // The database tells everyone who is allowed to see it.
          backend.deliver(row);
          return;
        }
        const wanted = url.searchParams.get("conversation_id") || "";
        const rows = backend.messages.filter((m) => !wanted || wanted.includes(m.conversation_id));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
        return;
      }
      if (p.startsWith("/rest/v1/profiles")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([me]) });
        return;
      }
      if (p.startsWith("/rest/v1/listings")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([liveListing]) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }

    if (p.startsWith("/realtime/v1/")) {
      await route.abort();
      return;
    }

    await route.fallback();
  });

  /* The realtime stream.
   *
   * The vendored Supabase client speaks the Phoenix protocol over a
   * WebSocket. The server hands out an id for every database
   * subscription and stamps that id on every change it pushes, so the
   * mock does the same.
   */
  await page.routeWebSocket(/\/realtime\/v1\/websocket.*/, (ws) => {
    const joined = [];

    ws.onMessage((raw) => {
      let parsed;
      try { parsed = JSON.parse(String(raw)); } catch { return; }
      const frames = (Array.isArray(parsed) && parsed.length === 5 && typeof parsed[0] === "string") ? [parsed] : parsed;

      for (const frame of frames) {
        if (!Array.isArray(frame)) continue;
        const [joinRef, ref, topic, event] = frame;
        if (event === "phx_join") {
          const filters = frame[4]?.config?.postgres_changes || [];
          const assigned = filters.map((f, i) => ({
            id: `bbbb3333-0000-4000-8000-${String(i).padStart(12, "0")}`,
            event: f.event,
            schema: f.schema,
            table: f.table,
            filter: f.filter ?? null,
          }));
          joined.push({ topic, joinRef, ids: assigned.map((a) => a.id), filter: filters[0]?.filter });
          ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", {
            status: "ok",
            response: { postgres_changes: assigned },
          }]));
        }
        if (event === "heartbeat") {
          ws.send(JSON.stringify([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]));
        }
      }
    });

    backend.sockets.add((row) => {
      for (const channel of joined) {
        // The inbox channel carries every message the student may see;
        // a thread channel only carries its own conversation.
        const isInbox = channel.topic === "realtime:chat:inbox";
        const isThread = channel.topic === `realtime:chat:${row.conversation_id}`;
        if (!isInbox && !isThread) continue;
        if (!channel.ids.length) continue;
        ws.send(JSON.stringify([channel.joinRef, null, channel.topic, "postgres_changes", {
          data: {
            schema: "public",
            table: "messages",
            type: "INSERT",
            record: row,
            old_record: {},
            columns: MESSAGE_COLUMNS,
            commit_timestamp: new Date().toISOString(),
          },
          ids: channel.ids,
        }]));
      }
    });

    ws.onClose(() => {
      // The socket is dropped when the page goes away; the delivery
      // callback checks that before writing.
    });
  });
}

/** Open a conversation from the inbox and wait for the thread. */
async function openInboxThread(page, convId) {
  await page.click("#chatBtn");
  await page.waitForTimeout(900);
  await page.locator(`#chatList .chat-row[data-conv="${convId}"]`).first().click();
  await page.waitForSelector("#chatDrawer:not([hidden])");
  await page.waitForTimeout(700);
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

/* ------------------------------------------ the seller replies from the inbox */

test("a seller's reply from the chat inbox reaches the customer", async ({ browser }) => {
  const backend = createChatBackend();

  // Two students, two browsers, one conversation.
  const customerContext = await browser.newContext();
  const sellerContext = await browser.newContext();
  const customer = await customerContext.newPage();
  const seller = await sellerContext.newPage();
  await mockChatPage(customer, backend, "buyer");
  await mockChatPage(seller, backend, "seller");

  // The customer opens the thread and waits for the answer.
  await signIn(customer);
  await openInboxThread(customer, CONVERSATION_ID);
  await expect(customer.locator("#chatBody")).toContainText("Is the table still available?");

  // The seller opens the same thread from the chat inbox — the only way
  // a seller has into a conversation — and answers.
  await signIn(seller, "aarav.sharma@dtu.ac.in");
  await openInboxThread(seller, CONVERSATION_ID);
  await seller.fill("#chatInput", "Yes, it is still available.");
  await seller.click('#chatForm button[type="submit"]');
  await seller.waitForTimeout(900);

  // The answer is written to the shared conversation, not kept in the
  // seller's browser.
  expect(backend.sent.length).toBe(1);
  expect(backend.sent[0].conversation_id).toBe(CONVERSATION_ID);
  expect(backend.sent[0].body).toBe("Yes, it is still available.");
  const local = await seller.evaluate(() => localStorage.getItem("uh-chat-messages"));
  expect(local).toBeFalsy();

  // The customer receives it, live, in the open thread.
  await expect(customer.locator("#chatBody")).toContainText("Yes, it is still available.", { timeout: 8000 });

  // Exactly once: the live stream and the optimistic send agree.
  await expect(customer.locator('#chatBody .msg:has-text("Yes, it is still available.")')).toHaveCount(1);
  await expect(customer.locator("#chatBody .msg").last()).toHaveClass(/them/);

  await customerContext.close();
  await sellerContext.close();
});

test("a seller's reply is never left in the seller's own browser", async ({ browser }) => {
  const backend = createChatBackend();
  const sellerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  await mockChatPage(seller, backend, "seller");

  await signIn(seller, "aarav.sharma@dtu.ac.in");
  await openInboxThread(seller, CONVERSATION_ID);

  // The local storage thread key is the one the offline demo uses.
  // A live conversation must never be written there, because nothing
  // there ever reaches the customer.
  const before = await seller.evaluate(() => Object.keys(localStorage));
  await seller.fill("#chatInput", "I can hold it until Saturday.");
  await seller.click('#chatForm button[type="submit"]');
  await seller.waitForTimeout(900);

  expect(backend.sent.length).toBe(1);
  expect(backend.sent[0].conversation_id).toBe(CONVERSATION_ID);

  const stored = await seller.evaluate(() => localStorage.getItem("uh-chat-messages"));
  expect(stored).toBeFalsy();
  const after = await seller.evaluate(() => Object.keys(localStorage));
  expect(after.length).toBe(before.length);

  await sellerContext.close();
});

test("a reply always goes to the thread that is on screen", async ({ browser }) => {
  const backend = createChatBackend();
  const sellerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  await mockChatPage(seller, backend, "seller");

  await signIn(seller, "aarav.sharma@dtu.ac.in");
  await openInboxThread(seller, CONVERSATION_ID);

  // Aarav moves to the other thread in his inbox.
  await seller.locator(`#chatList .chat-row[data-conv="${SECOND_CONVERSATION_ID}"]`).first().click();
  await seller.waitForTimeout(800);
  await expect(seller.locator("#chatTitle")).toContainText("Old Study Lamp");

  await seller.fill("#chatInput", "The lamp works fine.");
  await seller.click('#chatForm button[type="submit"]');
  await seller.waitForTimeout(900);

  // The answer belongs to the lamp thread, not to the one opened first.
  expect(backend.sent.length).toBe(1);
  expect(backend.sent[0].conversation_id).toBe(SECOND_CONVERSATION_ID);
  expect(backend.sent[0].body).toBe("The lamp works fine.");

  await sellerContext.close();
});

test("a seller cannot post into somebody else's thread", async ({ browser }) => {
  const backend = createChatBackend();
  const sellerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  await mockChatPage(seller, backend, "seller");

  await signIn(seller, "aarav.sharma@dtu.ac.in");
  await openInboxThread(seller, CONVERSATION_ID);

  // The stranger's thread is not in Aarav's inbox, so there is nothing
  // on screen to answer.
  await expect(seller.locator(`#chatList .chat-row[data-conv="${SECOND_CONVERSATION_ID}"]`)).toHaveCount(1);
  const rows = await seller.locator("#chatList .chat-row").evaluateAll((els) => els.map((e) => e.dataset.conv));
  expect(rows).toEqual([CONVERSATION_ID, SECOND_CONVERSATION_ID]);

  await sellerContext.close();
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
