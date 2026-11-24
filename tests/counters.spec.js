// UniHaat — stat counter regression.
//
// The counters ease from 0 to their target. The first animation frame's
// timestamp can predate the moment the counter was started (a rAF callback
// is handed the frame's start time, which may predate the request), which
// used to ease past 0 and briefly paint a negative number — "-10,598
// verified students" showed up on the deployed page. The progress is now
// clamped at both ends.

import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:5173";

test("stat counters never render a negative number", async ({ page }) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // Sample every animation frame from the first paint, so a transient
  // negative is caught rather than the settled value.
  const samples = await page.evaluate(async () => {
    const seen = new Set();
    const out = [];
    const grab = () => {
      for (const el of document.querySelectorAll("[data-count]")) {
        const text = el.textContent.trim();
        if (!seen.has(text)) {
          seen.add(text);
          out.push(text);
        }
      }
    };
    const t0 = performance.now();
    while (performance.now() - t0 < 3500) {
      grab();
      await new Promise((r) => requestAnimationFrame(r));
    }
    grab();
    return out;
  });

  expect(samples.length).toBeGreaterThan(0);
  for (const text of samples) {
    const value = parseFloat(text.replace(/[^0-9.\-]/g, ""));
    expect(value, `counter rendered "${text}"`).toBeGreaterThanOrEqual(0);
  }
});

test("stat counters survive a frame timestamp that predates their start", async ({ page }) => {
  // Reproduce the real-world cause deterministically. A rAF callback is
  // handed the frame's start timestamp, which can be earlier than the
  // performance.now() the counter captured as its start. Skewing
  // performance.now() forward recreates exactly that ordering.
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    const skew = 3000;
    const restoreAt = realNow() + 800;
    performance.now = () => (realNow() < restoreAt ? realNow() + skew : realNow());
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  const samples = await page.evaluate(async () => {
    const seen = new Set();
    const out = [];
    const grab = () => {
      for (const el of document.querySelectorAll("[data-count]")) {
        const text = el.textContent.trim();
        if (!seen.has(text)) {
          seen.add(text);
          out.push(text);
        }
      }
    };
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      grab();
      await new Promise((r) => requestAnimationFrame(r));
    }
    grab();
    return out;
  });

  expect(samples.length).toBeGreaterThan(0);
  for (const text of samples) {
    const value = parseFloat(text.replace(/[^0-9.\-]/g, ""));
    expect(value, `counter rendered "${text}"`).toBeGreaterThanOrEqual(0);
  }
});

test("stat counters settle on their target value", async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator("[data-count='12480']").first()).toHaveText("12,480", {
    timeout: 10_000,
  });
  await expect(page.locator("[data-count='48210']").first()).toHaveText("48,210", {
    timeout: 10_000,
  });
  await expect(page.locator("[data-count='16.9']").first()).toHaveText("₹16.9 Cr+", {
    timeout: 10_000,
  });
});

test("stat counters stay non-negative when the clock jumps backwards", async ({ page }) => {
  // A clock that jumps backwards mid-animation is the other way the old code
  // produced a negative: the progress was derived from a timestamp that could
  // land before the counter started, and nothing stopped the value from
  // dipping below zero. Freeze the clock mid-count and assert nothing goes
  // negative and the counter still reaches its target.
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    let calls = 0;
    performance.now = () => {
      calls += 1;
      // Jump backwards after the counter has started, then recover.
      if (calls > 4 && calls < 40) return realNow() - 5000;
      return realNow();
    };
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  const samples = await page.evaluate(async () => {
    const seen = new Set();
    const out = [];
    const grab = () => {
      for (const el of document.querySelectorAll("[data-count]")) {
        const text = el.textContent.trim();
        if (!seen.has(text)) {
          seen.add(text);
          out.push(text);
        }
      }
    };
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      grab();
      await new Promise((r) => requestAnimationFrame(r));
    }
    grab();
    return out;
  });

  expect(samples.length).toBeGreaterThan(0);
  for (const text of samples) {
    const value = parseFloat(text.replace(/[^0-9.\-]/g, ""));
    expect(value, `counter rendered "${text}"`).toBeGreaterThanOrEqual(0);
  }

  // The counter must still land on its target once the clock recovers.
  await expect(page.locator("[data-count='12480']").first()).toHaveText("12,480", {
    timeout: 10_000,
  });
});
