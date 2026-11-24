// UniCompress — the browser suite.
//
// The feature has two halves that have to hold together:
//
//   1. The engine. A file is compressed with Huffman coding in the
//      browser, and the reconstruction has to be the original bytes —
//      compared one by one, not taken on trust.
//
//   2. The marketplace. A photo attached to a listing is compressed
//      before it is stored, and the bytes that are stored are what the
//      buyer eventually sees.
//
// The second half is the one that is easy to get wrong: a compressed
// blob is not a URL, so it cannot go straight into an `<img src>`. The
// browser has to fetch it, decode it, and hand the picture over as an
// object URL. These tests check that the picture really appears.
//
// The engine itself is imported from `src/huffman.js` rather than
// re-implemented here, so the server-side mock stores exactly the
// container the app would have produced — and the browser's own decoder
// is the one under test.

import { test, expect } from "@playwright/test";
import zlib from "node:zlib";
import { compress } from "../src/huffman.js";
import { dismissLocationPrompt } from "./support/location-prompt.js";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const SB = "https://gzbmqwvybcmxlsgouhyh.supabase.co";

const USER_ID = "cccccccc-1111-2222-3333-444444444444";
const COLLEGE_ID = "0f1c5491-12cf-44ed-b0c2-12f79809ed74";

/* --------------------------------------------------------------- fixtures */

/** A real PNG, built here so the test does not depend on a binary file. */
function makePng(width = 64, height = 48) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    raw[o] = 0; // the filter byte: none
    o += 1;
    for (let x = 0; x < width; x += 1) {
      raw[o] = (x * 4) & 0xff;
      raw[o + 1] = (y * 5) & 0xff;
      raw[o + 2] = ((x + y) * 3) & 0xff;
      o += 3;
    }
  }

  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
    return out;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits per sample
  ihdr[9] = 2; // truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Text with a lot of repetition — the case Huffman coding is good at. */
const REPEATED_TEXT = "the quick brown fox jumps over the lazy dog. ".repeat(120);

/** Every byte value exactly once — the case the metadata makes bigger. */
const EVERY_BYTE = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

const bytesToBase64 = (bytes) => Buffer.from(bytes).toString("base64");

/* ------------------------------------------------------------ the mocking */

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
    user_metadata: { name: "Aarav Sharma", full_name: "Aarav Sharma" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
};

const googleProfile = {
  id: USER_ID,
  email: "aarav.sharma@dtu.ac.in",
  full_name: "Aarav Sharma",
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

/**
 * Mock the server.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {object[]} [options.listings] — the live listings
 * @param {object} [options.blob] — what `get_listing_image_blob` returns
 * @param {object} [options.totals] — what the campus-wide totals come back as.
 *   May be a function, which is called with the calls made so far.
 */
async function mockServer(page, { listings = [], blob = null, totals = null } = {}) {
  const calls = { rpc: [], listings: [], images: [], rest: [], compressed: 0 };

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (!url.hostname.endsWith("supabase.co")) {
      await route.fallback();
      return;
    }

    if (p === "/auth/v1/authorize") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><script>location.replace(${JSON.stringify(`${SB}/auth/v1/callback`)})</script>`,
      });
      return;
    }
    if (p === "/auth/v1/callback") {
      const back = new URL(`${BASE}/`);
      back.searchParams.set("code", "mock-pkce-code");
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><script>location.replace(${JSON.stringify(back.toString())})</script>`,
      });
      return;
    }
    if (p === "/auth/v1/token") {
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

    if (p.startsWith("/rest/v1/rpc/")) {
      const name = p.slice("/rest/v1/rpc/".length);
      let body = [];
      if (name === "put_listing_image_blob") {
        calls.rpc.push({ name, body: JSON.parse(route.request().postData() || "{}") });
        body = { id: "blob-1", listing_id: "listing-1" };
      } else if (name === "get_listing_image_blob") {
        calls.rpc.push({ name, body: JSON.parse(route.request().postData() || "{}") });
        body = blob ?? [];
      } else if (name === "record_compression") {
        calls.rpc.push({ name, body: JSON.parse(route.request().postData() || "{}") });
        // The server counts it, so the campus total follows the file.
        calls.compressed += 1;
        body = { id: "history-1" };
      } else if (name === "fetch_compression_history") {
        calls.rpc.push({ name, body: JSON.parse(route.request().postData() || "{}") });
        body = [];
      } else {
        body = [];
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }

    if (p.startsWith("/rest/v1/")) {
      calls.rest.push({ path: p, method: route.request().method() });
      let body = "[]";

      if (p.startsWith("/rest/v1/profiles")) {
        body = JSON.stringify([googleProfile]);
      } else if (p.startsWith("/rest/v1/listings")) {
        if (route.request().method() === "POST") {
          calls.listings.push(JSON.parse(route.request().postData() || "{}"));
          body = JSON.stringify({
            id: "listing-1",
            seller_id: USER_ID,
            title: "Casio fx-991ES Plus calculator",
            listing_type: "sell",
            status: "active",
            category_slug: "electronics",
            price: 650,
            original_price: 1100,
            condition: "Good",
            age_months: 6,
            distance_km: 0.2,
            listing_images: [],
            profiles: googleProfile,
          });
        } else {
          body = JSON.stringify(listings);
        }
      } else if (p.startsWith("/rest/v1/listing_images")) {
        if (route.request().method() === "POST") {
          calls.images.push(JSON.parse(route.request().postData() || "{}"));
        }
        body = JSON.stringify(calls.images);
      } else if (p.startsWith("/rest/v1/colleges")) {
        body = JSON.stringify([{ id: COLLEGE_ID, short_name: "DTU", name: "Delhi Technological University" }]);
      } else if (p.startsWith("/rest/v1/compression_totals")) {
        const counted =
          typeof totals === "function"
            ? totals(calls)
            : totals ?? { files: 0, original_bytes: 0, compressed_bytes: 0, saved_bytes: 0, saved_percent: null };
        body = JSON.stringify(counted);
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/*" },
        body,
      });
      return;
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
  await page.waitForTimeout(2500);

  // Signing in asks the student where they are, and the prompt sits
  // over the page until it is answered.
  await dismissLocationPrompt(page);
}

/* ------------------------------------------------------- the engine itself */

test("a file is compressed and the reconstruction matches it byte for byte", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#unicompress").scrollIntoViewIfNeeded();

  await page.setInputFiles("#ucFile", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(REPEATED_TEXT, "utf8"),
  });

  await expect(page.locator("#ucStatus")).toHaveAttribute("data-state", "ok");
  await expect(page.locator("#ucStatus")).toContainText(/verified byte for byte/i);

  // The verdict is the claim, stated plainly.
  const verdict = page.locator("#ucVerdict");
  await expect(verdict).toHaveAttribute("data-ok", "yes");
  await expect(verdict).toContainText(/matches the original byte for byte/i);

  // The sizes are all there and none of them is a dash.
  await expect(page.locator("#ucOriginalSize")).not.toHaveText("—");
  await expect(page.locator("#ucCompressedSize")).not.toHaveText("—");
  await expect(page.locator("#ucSavedPercent")).toContainText("%");
  await expect(page.locator("#ucEncodingMs")).toContainText("ms");
  await expect(page.locator("#ucDecodingMs")).toContainText("ms");

  // The comparison is shown: the original beside the reconstruction.
  await expect(page.locator("#ucCompare")).toBeVisible();
  await expect(page.locator("#ucOriginalImage")).toBeVisible();
  await expect(page.locator("#ucRestoredImage")).toBeVisible();
});

test("the compression ratio and the savings agree with the file", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#unicompress").scrollIntoViewIfNeeded();

  const buffer = Buffer.from(REPEATED_TEXT, "utf8");
  await page.setInputFiles("#ucFile", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer,
  });

  // The same numbers the engine produces, worked out here from the same
  // bytes — so the page cannot flatter the result.
  const expected = compress(new Uint8Array(buffer));
  const savedPercent = ((buffer.length - expected.container.length) / buffer.length) * 100;

  await expect(page.locator("#ucSavedPercent")).toContainText(`${savedPercent.toFixed(1)}%`);

  // The Huffman step on its own is reported separately, and it is the
  // honest figure: the tree is part of what gets stored.
  const huffmanOnly = ((buffer.length - expected.container.length) / buffer.length) * 100;
  await expect(page.locator("#ucHuffmanSaving")).toContainText(`${huffmanOnly.toFixed(1)}%`);
});

test("a file that Huffman coding makes bigger is reported as a loss", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#unicompress").scrollIntoViewIfNeeded();

  // Every byte value exactly once. The tree costs more than the file
  // was worth, so the honest answer is that it grew.
  await page.setInputFiles("#ucFile", {
    name: "every-byte.bin",
    mimeType: "application/octet-stream",
    buffer: EVERY_BYTE,
  });

  await expect(page.locator("#ucStatus")).toHaveAttribute("data-state", "ok");

  // The ratio is above one and it is marked as such.
  const ratio = page.locator("#ucRatio");
  await expect(ratio).toHaveAttribute("data-grew", "yes");

  const expected = compress(new Uint8Array(EVERY_BYTE));
  expect(expected.container.length).toBeGreaterThan(EVERY_BYTE.length);
  await expect(ratio).toContainText(`${((expected.container.length / EVERY_BYTE.length) * 100).toFixed(1)}%`);

  // The saving is negative, with a minus sign in front of it.
  await expect(page.locator("#ucSaved")).toContainText("−");
  await expect(page.locator("#ucSavedPercent")).toContainText("-");

  // And it is said in words, not only in a colour.
  const note = page.locator("#ucGrewNote");
  await expect(note).toBeVisible();
  await expect(note).toContainText(/made this file bigger/i);

  // The Huffman step on its own is the one that grew.
  await expect(page.locator("#ucHuffmanSaving")).toHaveAttribute("data-grew", "yes");
});

test("a file with a large alphabet still comes back byte for byte", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#unicompress").scrollIntoViewIfNeeded();

  // Every byte value occurs, but not equally. The rare ones get the
  // long codes — nine bits or more — which is the shape that cannot be
  // decoded by looking the next byte up in a table. A decoder that
  // tries that half-way through a code produces a plausible-looking
  // file of the right length and the wrong contents.
  const bytes = new Uint8Array(64 * 1024);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = i % 4 === 0 ? 16 + Math.floor(i / 4) % 240 : i % 16;
  }

  await page.setInputFiles("#ucFile", {
    name: "wide-alphabet.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(bytes),
  });

  await expect(page.locator("#ucStatus")).toHaveAttribute("data-state", "ok");
  await expect(page.locator("#ucVerdict")).toHaveAttribute("data-ok", "yes");
  await expect(page.locator("#ucVerdict")).toContainText(/matches the original byte for byte/i);

  // The codes really do run past a single byte, which is the case that
  // has to work.
  const longest = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#ucCodes tr")];
    return Math.max(0, ...rows.map((r) => Number(r.lastElementChild?.textContent) || 0));
  });
  expect(longest, "the codes shown run past eight bits").toBeGreaterThan(8);
});

test("the algorithm is shown step by step", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#unicompress").scrollIntoViewIfNeeded();

  await page.setInputFiles("#ucFile", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(REPEATED_TEXT, "utf8"),
  });
  await expect(page.locator("#ucStatus")).toHaveAttribute("data-state", "ok");

  // 1 — the frequency table.
  await expect(page.locator("#ucFreqBody tr").first()).toBeVisible();
  expect(await page.locator("#ucFreqBody tr").count()).toBeGreaterThan(1);

  // 2 — the priority queue and the rounds the greedy step takes.
  await expect(page.locator("#ucQueue .uc-chip").first()).toBeVisible();
  expect(await page.locator("#ucRounds li").count()).toBeGreaterThan(0);

  // 3 — the tree.
  await expect(page.locator("#ucTree svg")).toBeVisible();
  expect(await page.locator("#ucTree .uc-leaf").count()).toBeGreaterThan(0);

  // 4 — the codes.
  expect(await page.locator("#ucCodes tr").count()).toBeGreaterThan(0);
  await expect(page.locator("#ucCodes tr").first()).toContainText(/[01]/);

  // 5 — the encoding.
  expect(await page.locator("#ucEncoding tr").count()).toBeGreaterThan(0);
  await expect(page.locator("#ucEncodingSummary")).toContainText(/bits/);

  // 6 — the decoding.
  expect(await page.locator("#ucDecoding tr").count()).toBeGreaterThan(0);
  await expect(page.locator("#ucDecodingSummary")).toContainText(/symbol/);
});

test("the complexity table states the costs the course gives", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#unicompress").scrollIntoViewIfNeeded();

  const body = page.locator("#ucComplexity");
  await expect(body).toContainText("O(N)");
  await expect(body).toContainText("O(K log K)");
  await expect(body).toContainText("O(K)");

  // Each of the six steps is named.
  for (const step of [
    "Frequency calculation",
    "Priority queue",
    "Tree construction",
    "Code generation",
    "Encoding",
    "Decoding",
  ]) {
    await expect(body).toContainText(step);
  }

  // And the section says plainly what Huffman coding is and is not.
  await expect(page.locator("#unicompress")).toContainText(/lossless/i);
  await expect(page.locator("#unicompress")).toContainText(/not a complete image format/i);
});

/* --------------------------------------------------------- the sell form */

test("the Sell form offers an optional photo", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.click("#sellBtn");
  await expect(page.locator("#sellOverlay")).toBeVisible();

  const input = page.locator("#sellPhotoInput");
  await expect(input).toBeVisible();

  // It is optional: the form submits without it.
  await expect(input).not.toHaveAttribute("required", "");

  // And the form says what happens to the photo.
  await expect(page.locator("#sellPhotoHint")).toContainText(/Huffman coding/i);
});

test("a photo on the Sell form is compressed and stored with the listing", async ({ page }) => {
  const calls = await mockServer(page, { listings: [] });
  await signIn(page);

  await page.click("#sellBtn");
  await expect(page.locator("#sellOverlay")).toBeVisible();

  const png = makePng();
  await page.setInputFiles("#sellPhotoInput", {
    name: "calculator.png",
    mimeType: "image/png",
    buffer: png,
  });

  // The form says what it did, in numbers.
  const result = page.locator("#sellPhotoResult");
  await expect(result).toBeVisible();
  await expect(result).toContainText(/compressed/i);
  await expect(result).toContainText(/byte for byte/i);

  await page.fill('#sellForm input[name="title"]', "Casio fx-991ES Plus calculator");
  await page.fill('#sellForm input[name="price"]', "650");
  await page.fill('#sellForm input[name="original"]', "1100");
  await page.click('#sellForm button[type="submit"]');

  await expect(page.locator("#sellOverlay")).toBeHidden();

  // The listing was published.
  expect(calls.listings.length).toBeGreaterThan(0);

  // The image row points at the compressed blob, not at a URL.
  expect(calls.images.length).toBeGreaterThan(0);
  expect(calls.images[0].codec).toBe("huffman");
  expect(calls.images[0].url).toMatch(/^uhuf:/);

  // And the blob was stored, with the argument the server expects.
  // The store happens after the listing is published, so the test waits
  // for the call rather than assuming it has already been made.
  await expect
    .poll(() => calls.rpc.find((c) => c.name === "put_listing_image_blob") ?? null, {
      timeout: 10_000,
    })
    .toBeTruthy();

  const put = calls.rpc.find((c) => c.name === "put_listing_image_blob");
  expect(put.body.p_payload_base64, "the payload travels as base64").toBeTruthy();
  expect(put.body.p_payload, "the old argument name is not used").toBeUndefined();
  expect(put.body.p_verified).toBe(true);
  expect(put.body.p_mime_type).toMatch(/^image\//);

  // The bytes that were stored are a real UniCompress container: the
  // magic bytes are the first thing in it.
  const stored = Buffer.from(put.body.p_payload_base64, "base64");
  expect([...stored.subarray(0, 4)]).toEqual([0x55, 0x48, 0x43, 0x31]);
  expect(put.body.p_compressed_bytes).toBe(stored.length);

  // And the tree that decodes it went with it.
  expect(Object.keys(put.body.p_tree).length).toBeGreaterThan(0);
  expect(Object.keys(put.body.p_code_lengths).length).toBe(Object.keys(put.body.p_tree).length);
});

test("a listing without a photo keeps the picture it always had", async ({ page }) => {
  const calls = await mockServer(page, { listings: [] });
  await signIn(page);

  await page.click("#sellBtn");
  await page.fill('#sellForm input[name="title"]', "Study lamp with USB cable");
  await page.fill('#sellForm input[name="price"]', "250");
  await page.fill('#sellForm input[name="original"]', "500");
  await page.click('#sellForm button[type="submit"]');

  await expect(page.locator("#sellOverlay")).toBeHidden();

  // Nothing was stored as a blob.
  expect(calls.rpc.find((c) => c.name === "put_listing_image_blob")).toBeUndefined();

  // And the listing carries the illustration the offline catalogue uses.
  expect(calls.images.length).toBeGreaterThan(0);
  expect(calls.images[0].codec ?? "url").toBe("url");
  expect(calls.images[0].url).toContain("./assets/");

  // The card shows it.
  const card = page.locator("#productGrid .card", { hasText: "Study lamp" });
  await expect(card.first()).toBeVisible();
  await expect(card.first().locator("img")).toHaveAttribute("src", /assets\/.*\.svg/);
});

/* ---------------------------------------------- the picture comes back */

test("a compressed photo is put back together when the listing is loaded", async ({ page }) => {
  const png = makePng();
  const container = compress(new Uint8Array(png));

  const liveListing = {
    id: "listing-9",
    title: "Desk lamp with a warm bulb",
    description: "A desk lamp, barely used.",
    listing_type: "sell",
    status: "active",
    category_slug: "furniture",
    price: 450,
    original_price: 900,
    condition: "Like new",
    age_months: 4,
    distance_km: 0.3,
    listing_images: [{ url: "uhuf:listing-9", alt: "Desk lamp", sort: 0, codec: "huffman" }],
    profiles: {
      id: "11111111-1111-1111-1111-111111111111",
      full_name: "Aarav Sharma",
      verified: true,
      rating_sum: 24,
      rating_count: 5,
      deals_completed: 12,
      colleges: { short_name: "DTU" },
    },
  };

  const blob = {
    id: "blob-9",
    listing_id: "listing-9",
    payload: bytesToBase64(container.container),
    tree: Object.fromEntries([...container.codes].map(([s, c]) => [String(s), c])),
    code_lengths: Object.fromEntries([...container.codes].map(([s, c]) => [String(s), c.length])),
    original_bytes: png.length,
    compressed_bytes: container.container.length,
    mime_type: "image/png",
    file_name: "lamp.png",
    encoding_ms: 1.5,
    verified: true,
    created_at: new Date().toISOString(),
  };

  const calls = await mockServer(page, { listings: [liveListing], blob });
  await signIn(page);

  const card = page.locator("#productGrid .card", { hasText: "Desk lamp" });
  await expect(card.first()).toBeVisible();

  // The blob was fetched.
  const get = calls.rpc.find((c) => c.name === "get_listing_image_blob");
  expect(get, "the compressed blob was fetched").toBeTruthy();
  expect(get.body.p_listing_id).toBe("listing-9");

  // The picture on the card is an object URL, not the marker.
  const img = card.first().locator("img");
  await expect(img).toHaveAttribute("src", /^blob:/);

  // The card images are lazy, so the picture is only fetched once the
  // card is on screen. Bring it there before asking about its size.
  await card.first().scrollIntoViewIfNeeded();

  // And it really is a picture: the browser decoded it and it has size.
  await expect
    .poll(
      async () =>
        img.evaluate((el) => ({
          width: el.naturalWidth,
          height: el.naturalHeight,
          complete: el.complete,
        })),
      { timeout: 10_000 }
    )
    .toMatchObject({ complete: true });

  const natural = await img.evaluate((el) => ({
    width: el.naturalWidth,
    height: el.naturalHeight,
  }));
  expect(natural.width).toBeGreaterThan(0);
  expect(natural.height).toBeGreaterThan(0);
});

test("a listing without a compressed photo still shows its picture", async ({ page }) => {
  const liveListing = {
    id: "listing-10",
    title: "Second hand textbook bundle",
    description: "Three engineering textbooks.",
    listing_type: "sell",
    status: "active",
    category_slug: "books",
    price: 300,
    original_price: 900,
    condition: "Good",
    age_months: 12,
    distance_km: 0.6,
    listing_images: [{ url: "./assets/table-chair.svg", alt: "Bundle", sort: 0, codec: "url" }],
    profiles: {
      id: "11111111-1111-1111-1111-111111111111",
      full_name: "Aarav Sharma",
      verified: true,
      rating_sum: 24,
      rating_count: 5,
      deals_completed: 12,
      colleges: { short_name: "DTU" },
    },
  };

  const calls = await mockServer(page, { listings: [liveListing] });
  await signIn(page);

  const card = page.locator("#productGrid .card", { hasText: "Second hand textbook" });
  await expect(card.first()).toBeVisible();
  await expect(card.first().locator("img")).toHaveAttribute("src", /assets\/.*\.svg/);

  // Nothing was fetched, because there was nothing compressed to fetch.
  expect(calls.rpc.find((c) => c.name === "get_listing_image_blob")).toBeUndefined();
});

test("a compressed photo that cannot be fetched leaves the card usable", async ({ page }) => {
  const liveListing = {
    id: "listing-11",
    title: "Broken lamp nobody can load",
    description: "Its blob is missing.",
    listing_type: "sell",
    status: "active",
    category_slug: "furniture",
    price: 100,
    original_price: 900,
    condition: "Fair",
    age_months: 24,
    distance_km: 0.6,
    listing_images: [{ url: "uhuf:listing-11", alt: "Broken", sort: 0, codec: "huffman" }],
    profiles: {
      id: "11111111-1111-1111-1111-111111111111",
      full_name: "Aarav Sharma",
      verified: true,
      rating_sum: 24,
      rating_count: 5,
      deals_completed: 12,
      colleges: { short_name: "DTU" },
    },
  };

  // The server answers the blob request with nothing.
  await mockServer(page, { listings: [liveListing], blob: [] });
  await signIn(page);

  const card = page.locator("#productGrid .card", { hasText: "Broken lamp" });
  await expect(card.first()).toBeVisible();

  // The card is still there, and the picture is not a broken marker.
  await expect(card.first()).toContainText("Broken lamp");
  await expect(card.first().locator("img")).not.toHaveAttribute("src", /^uhuf:/);
});

/* ------------------------------------------------- the campus-wide numbers */

test("the dashboard shows what the campus has saved", async ({ page }) => {
  await mockServer(page, {
    totals: {
      files: 137,
      original_bytes: 8_912_896,
      compressed_bytes: 4_194_304,
      saved_bytes: 4_718_592,
      saved_percent: 52.94,
    },
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#unicompress").scrollIntoViewIfNeeded();

  const panel = page.locator("#ucCampus");
  await expect(panel).toBeVisible();

  // The count is the count.
  await expect(page.locator("#ucCampusFiles")).toHaveText("137");

  // The sizes are readable, and the saving is stated both ways.
  await expect(page.locator("#ucCampusOriginal")).not.toHaveText("—");
  await expect(page.locator("#ucCampusStored")).not.toHaveText("—");
  await expect(page.locator("#ucCampusSaved")).not.toHaveText("—");
  await expect(page.locator("#ucCampusPercent")).toContainText("52.9%");

  // It says what it is: a count for everybody, not a list of files.
  await expect(panel).toContainText(/count for everyone, not a list/i);
});

test("the campus total is hidden until something has been compressed", async ({ page }) => {
  // The server has counted nothing yet.
  await mockServer(page, {
    totals: { files: 0, original_bytes: 0, compressed_bytes: 0, saved_bytes: 0, saved_percent: null },
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#unicompress").scrollIntoViewIfNeeded();

  // Zeroes are not shown as though they were a record.
  await expect(page.locator("#ucCampus")).toBeHidden();
});

test("the campus total is refreshed after a file is compressed", async ({ page }) => {
  // The server counts what it is told to count.
  const calls = await mockServer(page, {
    totals: (c) => ({
      files: c.compressed,
      original_bytes: c.compressed * 1000,
      compressed_bytes: c.compressed * 400,
      saved_bytes: c.compressed * 600,
      saved_percent: 60,
    }),
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#unicompress").scrollIntoViewIfNeeded();
  await signIn(page);
  await page.locator("#unicompress").scrollIntoViewIfNeeded();

  // Nothing has been compressed, so there is no total to show.
  await expect(page.locator("#ucCampus")).toBeHidden();

  await page.setInputFiles("#ucFile", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(REPEATED_TEXT, "utf8"),
  });
  await expect(page.locator("#ucStatus")).toHaveAttribute("data-state", "ok");

  // The compression really was recorded...
  expect(calls.rpc.some((c) => c.name === "record_compression")).toBe(true);

  // ...and the campus total followed it without being asked for.
  await expect(page.locator("#ucCampusFiles")).toHaveText("1");
  await expect(page.locator("#ucCampus")).toBeVisible();
  await expect(page.locator("#ucCampusPercent")).toContainText("60.0%");
});
