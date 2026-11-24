// UniHaat — a shared test helper.
//
// Signing in asks the student where they are. The prompt covers the
// page until it is answered, so a test that signs in and then clicks
// something has to dismiss it first — otherwise the click lands on the
// overlay instead of on the control it was aimed at.
//
// The student says no. That is a choice the app has to cope with, and
// it is the choice that keeps the test deterministic: the campus is
// then whatever the signed-in student's address resolves to.
//
//   await dismissLocationPrompt(page);

import { expect } from "@playwright/test";

/**
 * Dismiss the "where are you" prompt if it is showing.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<boolean>} whether the prompt was showing
 */
export async function dismissLocationPrompt(page, { timeout = 5000 } = {}) {
  const prompt = page.locator("#locationPrompt");

  // The prompt opens once the sign-in has settled, so it is waited for
  // rather than assumed to be there already.
  const appeared = await prompt
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);

  if (!appeared) return false;

  await page.locator("#locationSkipBtn").click();
  await expect(prompt).toBeHidden();
  return true;
}
