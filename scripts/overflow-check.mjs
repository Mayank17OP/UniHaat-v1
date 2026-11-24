// A quick horizontal-overflow check across the widths that matter.
//
// The page is opened at each width and the document is asked whether
// anything sticks out past the right edge. The campus panel is shown
// first, because it is the newest grid on the page.
//
//   node scripts/overflow-check.mjs

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173/";
const WIDTHS = [320, 360, 390, 414, 480, 560, 640, 768, 900, 1024, 1200, 1320, 1321, 1400, 1420, 1421, 1440, 1500, 1501, 1526, 1600, 1601, 1700, 1920, 2560];

// The same browser the test suite uses: the local Chromium in
// `.browser/`, with the shared libraries it needs on the path.
const localChromium = path.resolve(".browser/chromium");
const launchOptions = fs.existsSync(localChromium)
  ? {
      executablePath: localChromium,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      env: { ...process.env, LD_LIBRARY_PATH: path.resolve(".browser/lib") },
    }
  : {};

const browser = await chromium.launch(launchOptions);
let bad = 0;

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);

  // Show the campus panel with real numbers in it, the way it looks
  // once something has been compressed.
  await page.evaluate(() => {
    const panel = document.querySelector("#ucCampus");
    if (!panel) return;
    panel.hidden = false;
    const set = (id, v) => {
      const el = document.querySelector(id);
      if (el) el.textContent = v;
    };
    set("#ucCampusFiles", "137");
    set("#ucCampusOriginal", "8.5 MB");
    set("#ucCampusStored", "4.0 MB");
    set("#ucCampusSaved", "4.5 MB");
    set("#ucCampusPercent", "52.9%");
  });

  const over = await page.evaluate(() => {
    const doc = document.documentElement;
    const limit = doc.clientWidth;
    const out = [];

    // An element only counts as overflowing if nothing between it and
    // the root clips it. The ticker is a marquee: its track is meant to
    // be wider than the page and is cut off on purpose, and the skip
    // link is meant to sit off-screen until it is focused.
    const isClipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.overflow !== "visible" || style.overflowX !== "visible") return true;
      }
      return false;
    };

    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= limit + 1 && r.left >= -1) continue;
      if (isClipped(el)) continue;
      // The skip link is parked off-screen on purpose and comes into
      // view when it is focused. It cannot make the page scroll.
      if (el.classList.contains("skip")) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        cls: (el.className || "").toString().slice(0, 40),
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: limit, out: out.slice(0, 6) };
  });

  const scrolls = over.scrollWidth > over.clientWidth + 1;
  if (scrolls || over.out.length) {
    bad += 1;
    console.log(`✗ ${width}px — scrollWidth ${over.scrollWidth} vs ${over.clientWidth}`);
    for (const o of over.out) console.log(`    ${o.tag}#${o.id}.${o.cls} [${o.left}…${o.right}]`);
  } else {
    console.log(`✓ ${width}px`);
  }
  await page.close();
}

await browser.close();
console.log(bad ? `\n✗ ${bad} width(s) overflow.` : "\n✓ nothing overflows at any width.");
process.exit(bad ? 1 : 0);
