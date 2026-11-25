// Checks the things a screenshot cannot: that every destination is on
// screen in one row, that the drawer still works when the motion is
// switched off, and that the bar never pushes the page sideways.
//
//   node scripts/nav-check.mjs

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173/";
const WIDTHS = [320, 360, 390, 480, 640, 768, 899, 900, 1024, 1280, 1440, 1600, 1920, 2560];

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
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);

  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const links = [...document.querySelectorAll(".nav-links-in a")];
    const visible = links.filter((a) => a.getBoundingClientRect().width > 0);
    const desktop = vw >= 900;
    const rects = visible.map((a) => a.getBoundingClientRect());
    return {
      vw,
      desktop,
      links: links.length,
      shown: visible.length,
      oneRow: new Set(rects.map((r) => Math.round(r.top))).size === 1,
      inside: rects.every((r) => r.right <= vw + 1 && r.left >= -1),
      burger: getComputedStyle(document.querySelector("#menuBtn")).display,
      overflow: document.documentElement.scrollWidth > vw + 1,
    };
  });

  const problems = [];
  if (report.overflow) problems.push(`page overflows (${report.vw})`);
  if (report.desktop && (report.shown !== 9 || !report.oneRow || !report.inside)) {
    problems.push(`destinations not in one row (${report.shown}/9, row=${report.oneRow})`);
  }
  if (report.desktop && report.burger !== "none") problems.push("the menu button is on a desktop");
  if (!report.desktop && report.burger === "none") problems.push("the menu button is missing on a phone");

  if (problems.length) {
    bad += 1;
    console.log(`✗ ${width}px — ${problems.join("; ")}`);
  } else {
    console.log(`✓ ${width}px — ${report.shown} destination(s) in one row, no overflow`);
  }
  await page.close();
}

/* Reduced motion: the drawer must still open and close. */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.click("#menuBtn");
  const opened = await page.locator("#mobileMenu").evaluate((e) => e.classList.contains("open"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const closed = await page.locator("#mobileMenu").evaluate((e) => !e.classList.contains("open"));
  const expanded = await page.locator("#menuBtn").getAttribute("aria-expanded");
  if (opened && closed && expanded === "false") console.log("✓ reduced motion — the drawer still opens and closes");
  else {
    bad += 1;
    console.log(`✗ reduced motion — opened=${opened} closed=${closed} aria-expanded=${expanded}`);
  }
  await page.close();
}

await browser.close();
if (bad) {
  console.log(`\n✗ ${bad} problem(s).`);
  process.exit(1);
}
console.log("\n✓ the navigation holds at every width.");
