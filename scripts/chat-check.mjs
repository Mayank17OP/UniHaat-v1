// UniHaat — a quick look at the chat button, the wishlist window and the
// product modal, at desktop and phone widths.
//
//   node scripts/chat-check.mjs
//
// Writes screenshots to shots/ and prints what it measured, so a broken
// layout shows up as a number rather than as a feeling.

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const localChromium = path.resolve(".browser/chromium");
const useLocal = fs.existsSync(localChromium);

const OUT = path.resolve("shots");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: useLocal ? localChromium : undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  env: { ...process.env, LD_LIBRARY_PATH: path.resolve(".browser/lib") },
});

const problems = [];

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

async function openFirstListing(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card", { timeout: 15000 });
  await page.locator(".card").first().click();
  await page.waitForSelector("#productOverlay:not([hidden]) .detail", { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const d = document.querySelector(".detail"); if (d) d.scrollTop = 0; });
  await page.waitForTimeout(200);
}

for (const [label, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => problems.push(`${label} page error: ${e.message}`));
  page.on("console", (m) => {
    // The sandbox has no route to the Supabase CDN, so every auth call
    // fails to connect. That is the environment, not the interface.
    if (m.type() !== "error") return;
    const text = m.text();
    if (/ERR_CONNECTION_CLOSED|Failed to load resource/.test(text)) return;
    problems.push(`${label} console: ${text}`);
  });

  /* ---------------------------------------------------------- the chat button */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const chatBtn = page.locator("#chatBtn");
  if (!(await chatBtn.isVisible())) problems.push(`${label}: the chat button is not visible`);
  const chatBox = await chatBtn.boundingBox();
  if (chatBox && (chatBox.width < 30 || chatBox.height < 30)) {
    problems.push(`${label}: the chat button is ${chatBox.width}x${chatBox.height}`);
  }

  await chatBtn.click();
  await page.waitForTimeout(900);
  const chatsVisible = await page.locator("#chats").isVisible();
  if (!chatsVisible) problems.push(`${label}: the chat section did not come into view`);
  await shot(page, `${label}-chats`);

  /* -------------------------------------------------------- the wishlist window */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".card", { timeout: 15000 });
  await page.locator(".card .heart").first().click();
  await page.waitForTimeout(300);
  await page.locator("#wishlistBtn").click();
  await page.waitForTimeout(400);
  const drawerOpen = await page.locator("#wishlistDrawer").isVisible();
  if (!drawerOpen) problems.push(`${label}: the wishlist window did not open`);
  const savedCount = await page.locator(".wishlist-item").count();
  if (savedCount !== 1) problems.push(`${label}: the wishlist window shows ${savedCount} items, expected 1`);
  await shot(page, `${label}-wishlist`);

  /* ------------------------------------------------------- the product modal */
  await openFirstListing(page);
  const modal = await page.locator(".modal-product").boundingBox();
  const detail = await page.locator(".detail").boundingBox();
  const body = await page.locator(".detail-body").boundingBox();
  console.log(`\n[${label}] viewport ${width}x${height}`);
  console.log(`[${label}] modal   top ${Math.round(modal.y)} bottom ${Math.round(modal.y + modal.height)} (${Math.round(modal.width)}x${Math.round(modal.height)})`);
  console.log(`[${label}] detail  top ${Math.round(detail.y)} bottom ${Math.round(detail.y + detail.height)} (${Math.round(detail.width)}x${Math.round(detail.height)}) scroll ${await page.evaluate(() => document.querySelector(".detail")?.scrollHeight)}`);
  console.log(`[${label}] body    top ${Math.round(body.y)} bottom ${Math.round(body.y + body.height)} (${Math.round(body.width)}x${Math.round(body.height)})`);

  // Nothing may be cut off: the modal has to fit the screen, and the last
  // action on the detail has to be reachable by scrolling.
  if (modal.height > height + 2) problems.push(`${label}: the modal is taller than the screen (${Math.round(modal.height)} > ${height})`);
  const clipped = await page.evaluate(() => {
    const m = document.querySelector(".modal-product");
    const d = document.querySelector(".detail");
    const out = [];
    if (m && d) {
      const mr = m.getBoundingClientRect();
      const dr = d.getBoundingClientRect();
      if (dr.bottom > mr.bottom + 1) out.push("detail overflows the modal");
    }
    return out;
  });
  clipped.forEach((c) => problems.push(`${label}: ${c}`));

  // The last element in the detail must be scrollable into view.
  const reachable = await page.evaluate(async () => {
    const d = document.querySelector(".detail");
    if (!d) return { ok: false, why: "no scroll area" };
    d.scrollTop = d.scrollHeight;
    await new Promise((r) => setTimeout(r, 250));
    const note = document.querySelector(".detail-note");
    const actions = document.querySelector(".detail-actions");
    if (!note) return { ok: false, why: "no closing note" };
    const dr = d.getBoundingClientRect();
    const nr = note.getBoundingClientRect();
    const ar = actions?.getBoundingClientRect();
    const ok = nr.bottom <= dr.bottom + 2 && nr.top >= dr.top - 2 &&
      (!ar || (ar.bottom <= dr.bottom + 2 && ar.top >= dr.top - 2));
    return { ok, why: ok ? "" : "the last line of the listing cannot be reached by scrolling" };
  });
  if (!reachable.ok) problems.push(`${label}: ${reachable.why}`);

  // Back to the top for the picture.
  await page.evaluate(() => { const d = document.querySelector(".detail"); if (d) d.scrollTop = 0; });
  await page.waitForTimeout(250);
  await shot(page, `${label}-product`);

  // The close button must be on top of everything.
  const closeOnTop = await page.evaluate(() => {
    const btn = document.querySelector(".modal-product .modal-close");
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && btn.contains(hit));
  });
  if (!closeOnTop) problems.push(`${label}: the close button is covered`);

  await page.close();
}

await browser.close();

if (problems.length) {
  console.log("\nProblems:");
  problems.forEach((p) => console.log(" -", p));
  process.exitCode = 1;
} else {
  console.log("\nAll checks passed.");
}
