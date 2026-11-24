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

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

const html = await readFile(path.join(root, "index.html"), "utf8");
await writeFile(path.join(out, "index.html"), html);

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

console.log(`✓ built ${path.relative(root, out)}/ (${COPY.join(", ")}, index.html)`);
