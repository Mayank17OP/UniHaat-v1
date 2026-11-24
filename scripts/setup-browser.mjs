/**
 * Provisions a headless Chromium binary for Playwright without needing the
 * playwright.azureedge.net CDN (blocked in some sandboxes).
 *
 * Source: @sparticuz/chromium on npm — Chromium binary plus the shared libs
 * (libnss3 etc.), SwiftShader GL and fonts it needs on bare Linux.
 * Output: .browser/chromium, with .browser/lib on LD_LIBRARY_PATH.
 *
 * Usage: node scripts/setup-browser.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".browser");
const binDir = path.join(root, "node_modules", "@sparticuz", "chromium", "bin");

if (!fs.existsSync(binDir)) {
  console.error("@sparticuz/chromium is missing. Run: npm install");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const decompress = (file) =>
  zlib.brotliDecompressSync(fs.readFileSync(path.join(binDir, file)));

/* chromium.br is a raw executable; the others are tar archives. */
const chromiumPath = path.join(out, "chromium");
if (!fs.existsSync(chromiumPath)) {
  fs.writeFileSync(chromiumPath, decompress("chromium.br"));
  fs.chmodSync(chromiumPath, 0o755);
  console.log("✓ chromium extracted");
}

const tarballs = { "al2023.tar.br": "lib", "swiftshader.tar.br": "libEGL.so", "fonts.tar.br": "fonts.conf" };
for (const [file, marker] of Object.entries(tarballs)) {
  if (fs.existsSync(path.join(out, marker))) continue;
  const tar = path.join(out, file.replace(/\.br$/, ""));
  fs.writeFileSync(tar, decompress(file));
  execFileSync("tar", ["-xf", tar, "-C", out]);
  fs.unlinkSync(tar);
  console.log(`✓ ${file.replace(/\.tar\.br$/, "")} extracted`);
}

console.log(`✓ browser ready at ${chromiumPath}`);
