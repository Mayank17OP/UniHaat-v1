// UniHaat — check that a migration lands on a database that already has
// data.
//
//   node supabase/tests/migration_landing.test.mjs
//
// The migration that introduces UniReserve has to work on the live
// database, not only on an empty one: the campus already has listings,
// students and a marketplace, and the new feature has to meet them where
// they are.
//
// The script applies the migrations one at a time, puts a rental listing
// on the marketplace *before* UniReserve exists, and then applies the
// UniReserve migration. The listing has to come into the rentable pool
// on its own — the trigger that watches for new listings never saw it,
// so the migration has to bring it in.
//
// It then checks the migration is safe to leave in place: applying it a
// second time must not fail, and the stock must not double.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const TESTS = path.join(ROOT, "supabase", "tests");

const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:55432/postgres";

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const files = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const unireserve = files.find((f) => f.includes("unireserve"));
if (!unireserve) {
  console.error("there is no UniReserve migration to land");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

async function apply(file) {
  await client.query(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
}

async function reset() {
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.query("drop schema if exists auth cascade; create schema auth;");
  await client.query(fs.readFileSync(path.join(TESTS, "local_harness.sql"), "utf8"));
  await client.query("grant usage on schema public to anon, authenticated, service_role;");
}

/**
 * Put the database back the way it was found: every migration applied, with
 * the demo data in place.
 *
 * This suite is destructive by nature — it drops the schema to rehearse a
 * migration landing on a populated database. Leaving that behind means the
 * next script to connect finds an empty schema and reports that the
 * migrations "do not exist", which is true of the wreckage and not of the
 * migrations. So the schema is rebuilt before the suite exits.
 */
async function rebuild() {
  await reset();
  for (const file of files) {
    await apply(file);
  }
  await client.query(fs.readFileSync(path.join(TESTS, "local_seed.sql"), "utf8"));
}

console.log("\n· the migration lands on a campus that already has data\n");

await reset();

// Everything up to, but not including, UniReserve.
for (const file of files) {
  if (file === unireserve) break;
  await apply(file);
}

// A student signs up and puts a cycle up for rent.
await client.query(
  `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
   values ('aaaaaaaa-0000-4000-8000-000000000001', 'alpha@dtu.ac.in', now(),
           '{"full_name":"Alpha"}'::jsonb, now())`
);
await client.query(
  `update public.profiles
      set verified = true, student_id = 'DTU/2K23/101'
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'`
);
await client.query(
  `insert into public.listings
     (seller_id, title, description, category_slug, listing_type, price,
      rent_per_month, status, condition, campus_area, created_at)
   values ('aaaaaaaa-0000-4000-8000-000000000001',
           'Preexisting rental cycle', 'A good cycle', 'sports', 'rent', 0, 350,
           'active', 'Good', 'North Campus', now())`
);

// Now UniReserve arrives.
await apply(unireserve);
ok("the migration applies to a campus that already has data", true);

const units = await client.query(
  `select count(*)::int as n
     from public.reserve_resource_units u
     join public.listings l on l.id = u.listing_id
    where l.title = 'Preexisting rental cycle'`
);
ok(
  "the rental that was already on the marketplace joined the pool",
  units.rows[0].n === 1,
  `got ${units.rows[0].n} units`
);

const catalogue = await client.query(`select public.reserve_catalogue() as cat`);
const cat = catalogue.rows[0].cat;
ok(
  "the catalogue counts the campus stock",
  Array.isArray(cat.units) && cat.units.length > 0,
  JSON.stringify(cat.units?.length)
);

const before = await client.query(`select count(*)::int as n from public.reserve_resource_units`);
const types = await client.query(`select count(*)::int as n from public.reserve_resource_types`);

// The migration is recorded once and applied once. Running it again must
// not double the stock or fail outright.
let reapplied = true;
try {
  await apply(unireserve);
} catch (err) {
  reapplied = false;
  console.log(`     ${err.message}`);
}
ok("the migration can be applied again without failing", reapplied);

const after = await client.query(`select count(*)::int as n from public.reserve_resource_units`);
ok(
  "applying it again did not double the stock",
  after.rows[0].n === before.rows[0].n,
  `before ${before.rows[0].n}, after ${after.rows[0].n}`
);

const typesAfter = await client.query(`select count(*)::int as n from public.reserve_resource_types`);
ok(
  "applying it again did not double the catalogue",
  typesAfter.rows[0].n === types.rows[0].n,
  `before ${types.rows[0].n}, after ${typesAfter.rows[0].n}`
);

await rebuild();
await client.end();

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed ? 1 : 0);
