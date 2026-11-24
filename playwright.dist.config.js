// UniHaat — run the browser suite against the built site.
//
// The deployed site is `dist/`, not the source tree: the build copies
// the sources, generates `src/config.js`, and stamps a content hash
// onto every module reference. Every one of those steps can break the
// site while the source tree still works perfectly — a module left out
// of the copy, an import rewritten to a file that was not copied, a
// stylesheet that never got a stamp.
//
// So the suite is run twice: once against the source tree, and once
// against what the build actually produced.
//
//   npm run test:dist
//
// The build runs first, because testing a stale dist/ proves nothing.

import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const localChromium = path.resolve(".browser/chromium");
const useLocal = fs.existsSync(localChromium);

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:5175",
    trace: "retain-on-failure",
    launchOptions: useLocal
      ? {
          executablePath: localChromium,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
          env: { ...process.env, LD_LIBRARY_PATH: path.resolve(".browser/lib") },
        }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The built site, not the source tree.
    command: "cd dist && python3 -m http.server 5175 --bind 0.0.0.0",
    url: "http://localhost:5175",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
