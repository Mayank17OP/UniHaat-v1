// UniHaat — static build.
//
// The app is a plain HTML/CSS/JS site, so the build is a copy plus one
// generated file: `src/config.js`, which points the browser at the right
// Supabase project. The publishable key is public by design (Row Level
// Security is what actually protects the data), but keeping it in the
// environment means a deployment can be pointed at a different project
// without touching the source.
//
//   SUPABASE_URL      https://<ref>.supabase.co
//   SUPABASE_ANON_KEY sb_publishable_...
//
// With neither set, the build falls back to the values already in
// src/config.js, which is what local development uses.
//
// The build also stamps a content hash onto every module reference. A
// browser or CDN that already holds the previous build would otherwise keep
// serving the old JavaScript — which is how a fixed counter bug stayed live
// on the deployed site after the fix had been merged and deployed.

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "dist");

// Only what the browser needs — no tests, scripts or migrations.
const COPY = ["src", "assets", "vendor"];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const dir of COPY) {
  await cp(path.join(root, dir), path.join(out, dir), { recursive: true });
}

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_ANON_KEY?.trim();

if (url && key) {
  const config = `// UniHaat runtime configuration — generated at build time.
// Do not edit by hand; set SUPABASE_URL and SUPABASE_ANON_KEY instead.
const DEFAULTS = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseKey: ${JSON.stringify(key)},
};

const runtime = (typeof window !== "undefined" && window.UNIHAAT_CONFIG) || {};

export const CONFIG = { ...DEFAULTS, ...runtime };

export const isSupabaseConfigured = () =>
  Boolean(CONFIG.supabaseUrl && CONFIG.supabaseKey);
`;
  await writeFile(path.join(out, "src", "config.js"), config);
  console.log("✓ generated src/config.js from the deployment environment");
} else {
  console.log("✓ src/config.js — no SUPABASE_URL/SUPABASE_ANON_KEY set, using the committed defaults");
}

/* ---- cache-busting -----------------------------------------------------
 *
 * Every module reference gets a `?v=<hash>` query so that a browser or CDN
 * holding the previous build can never keep serving the old JavaScript.
 * The hash covers the whole built src/ tree, so any change busts it.
 *
 * The import specifiers have to be rewritten too, not just the entry
 * <script> tag: the module graph is fetched by URL, so an unchanged
 * "./data.js" would still be served from the old build's cache.
 */
const srcDir = path.join(out, "src");
const srcFiles = (await readdir(srcDir)).filter((f) => f.endsWith(".js")).sort();
const hash = createHash("sha256");
for (const file of srcFiles) {
  hash.update(file);
  hash.update(await readFile(path.join(srcDir, file)));
}
const version = hash.digest("hex").slice(0, 12);

for (const file of srcFiles) {
  const filePath = path.join(srcDir, file);
  const source = await readFile(filePath, "utf8");
  // Rewrite relative imports of sibling modules to carry the version.
  const stamped = source.replace(
    /(from\s+["'])(\.\/[\w.-]+\.js)(["'])/g,
    (_m, pre, spec, post) => `${pre}${spec}?v=${version}${post}`
  );
  if (stamped !== source) await writeFile(filePath, stamped);
}

const html = await readFile(path.join(root, "index.html"), "utf8");
const stampedHtml = html
  .replace(/(src=["'])\.\/src\/(main\.js)(["'])/g, (_m, pre, spec, post) => `${pre}./src/${spec}?v=${version}${post}`)
  .replace(/(href=["'])\.\/src\/(style\.css)(["'])/g, (_m, pre, spec, post) => `${pre}./src/${spec}?v=${version}${post}`)
  .replace(/(src=["'])\.\/vendor\/(supabase\.js)(["'])/g, (_m, pre, spec, post) => `${pre}./vendor/${spec}?v=${version}${post}`);
await writeFile(path.join(out, "index.html"), stampedHtml);
console.log(`✓ stamped index.html and ${srcFiles.length} modules with ?v=${version}`);

console.log(`✓ built ${path.relative(root, out)}/ (${COPY.join(", ")}, index.html)`);
