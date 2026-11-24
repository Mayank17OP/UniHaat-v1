/**
 * Vendors the Supabase browser client into vendor/ so the site keeps working
 * without a third-party CDN request (and stays usable offline).
 *
 * The UMD build is a single self-contained file that exposes `window.supabase`.
 *
 * Usage: node scripts/vendor-supabase.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js");
const out = path.join(root, "vendor");

if (!fs.existsSync(src)) {
  console.error("@supabase/supabase-js is missing. Run: npm install");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(src, path.join(out, "supabase.js"));
console.log(`✓ vendored supabase client → vendor/supabase.js`);
