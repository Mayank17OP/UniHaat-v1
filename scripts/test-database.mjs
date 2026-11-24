// UniHaat — run the database regression suites.
//
// It prepares a database, applies every migration, seeds the demo data and
// then runs each SQL suite in `supabase/tests`. Everything the suites check
// is a property of the schema and the functions, so a green run here means
// the migrations are sound.
//
//   DATABASE_URL=postgres://... node scripts/test-database.mjs
//
// Without DATABASE_URL the script expects a local PostgreSQL on
// 127.0.0.1:55432 and prepares it from scratch.
//
// The suites roll back after themselves, so the seeded data is the same
// before and after a run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const TESTS = path.join(ROOT, "supabase", "tests");

const url =
  process.env.DATABASE_URL ||
  "postgres://postgres@127.0.0.1:55432/postgres";

const SUITES = ["security_regression.sql", "unireserve_regression.sql"];

// The backend suite is a Node program rather than a SQL file: it drives the
// real functions over the real data, including the concurrency checks.
const BACKEND_SUITE = "unireserve_backend.test.mjs";

async function prepare(client) {
  // A fresh database: the schema, the GoTrue stand-in and the migrations.
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.query("drop schema if exists auth cascade; create schema auth;");
  await client.query(fs.readFileSync(path.join(TESTS, "local_harness.sql"), "utf8"));

  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    try {
      await client.query(sql);
      console.log(`  ✓ ${file}`);
    } catch (err) {
      console.error(`  ✘ ${file}\n     ${err.message}`);
      if (err.position) {
        const at = Number(err.position);
        console.error(
          "     near: " +
            sql.slice(Math.max(0, at - 120), at + 120).replace(/\n/g, " ")
        );
      }
      throw err;
    }
  }

  await client.query(fs.readFileSync(path.join(TESTS, "local_seed.sql"), "utf8"));
  console.log("  ✓ seeded the demo data");
}

/** Run one suite in its own process. */
async function runSuite(name) {
  const { spawn } = await import("node:child_process");
  const script = name.endsWith(".sql")
    ? path.join(ROOT, "scripts", "run-sql-suite.mjs")
    : null;
  const args = script
    ? [script, path.join(TESTS, name)]
    : [path.join(TESTS, name)];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    });
    child.on("close", (code) => resolve(code === 0));
  });
}

const client = new Client({ connectionString: url });
await client.connect();

console.log("preparing the database");
try {
  await prepare(client);
} catch {
  await client.end();
  process.exit(1);
}
await client.end();

const ALL = [...SUITES, BACKEND_SUITE];

let failed = 0;
for (const suite of ALL) {
  console.log(`\nrunning ${suite}`);
  const ok = await runSuite(suite);
  if (!ok) failed += 1;
}

if (failed) {
  console.error(`\n✘ ${failed} of ${ALL.length} suites failed.`);
  process.exit(1);
}
console.log(`\n✓ all ${ALL.length} database suites passed.`);
