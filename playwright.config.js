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
    baseURL: process.env.BASE_URL || "http://localhost:5173",
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
    command: "python3 -m http.server 5173 --bind 0.0.0.0",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
