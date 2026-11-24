/**
 * Copies the font files we use out of node_modules into assets/fonts so the
 * site renders identically offline (Google Fonts CDN is unreachable in many
 * sandboxes and adds a render-blocking third-party request).
 *
 * Usage: node scripts/make-fonts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "assets", "fonts");
fs.mkdirSync(out, { recursive: true });

const FILES = [
  ["@fontsource/fraunces", "fraunces-latin-400-normal.woff2", "fraunces-400.woff2"],
  ["@fontsource/fraunces", "fraunces-latin-600-normal.woff2", "fraunces-600.woff2"],
  ["@fontsource/fraunces", "fraunces-latin-700-normal.woff2", "fraunces-700.woff2"],
  ["@fontsource/fraunces", "fraunces-latin-900-normal.woff2", "fraunces-900.woff2"],
  ["@fontsource/inter", "inter-latin-400-normal.woff2", "inter-400.woff2"],
  ["@fontsource/inter", "inter-latin-600-normal.woff2", "inter-600.woff2"],
  ["@fontsource/inter", "inter-latin-700-normal.woff2", "inter-700.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2", "jetbrains-mono-400.woff2"],
  ["@fontsource/jetbrains-mono", "jetbrains-mono-latin-700-normal.woff2", "jetbrains-mono-700.woff2"],
];

let copied = 0;
for (const [pkg, file, dest] of FILES) {
  const src = path.join(root, "node_modules", pkg, "files", file);
  if (!fs.existsSync(src)) {
    console.error(`✗ missing ${src}`);
    continue;
  }
  fs.copyFileSync(src, path.join(out, dest));
  copied++;
}
console.log(`✓ copied ${copied} font files to assets/fonts`);
