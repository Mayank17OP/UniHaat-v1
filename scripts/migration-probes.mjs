// UniHaat — migration probes.
//
// The SQL suites check that the schema is right. These probes check a
// different thing: that each migration is actually doing the work it
// claims to do.
//
// A migration that changes nothing passes every suite, because the
// suites only look at the end state. A probe asks a narrower question
// — "if this migration were not applied, would this behaviour be
// gone?" — and the answer is checked by applying the migrations
// without it and watching the behaviour disappear.
//
//   node scripts/migration-probes.mjs              # probe the database as it is
//   node scripts/migration-probes.mjs --prepare    # rebuild it first, then probe
//
// Without --prepare the script probes whatever is already in the
// database, which is how it is run against a campus that already has
// data. With --prepare it starts from an empty schema, so the result
// does not depend on what a previous suite left behind.
//
// The script exits non-zero if any probe fails.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const TESTS = path.join(ROOT, "supabase", "tests");

const url =
  process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:55432/postgres";

const prepare = process.argv.includes("--prepare");

/* ------------------------------------------------------------ the harness */

/** Build the database from nothing: the harness, the migrations, the seed. */
async function build(omit = null) {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.query("drop schema if exists auth cascade; create schema auth;");
  await client.query(fs.readFileSync(path.join(TESTS, "local_harness.sql"), "utf8"));

  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f !== omit);

  for (const file of files) {
    await client.query(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  await client.query(fs.readFileSync(path.join(TESTS, "local_seed.sql"), "utf8"));
  return client;
}

/* --------------------------------------------------------------- the probes */

/**
 * Each probe is a name and a check. The check returns a list of
 * failures — empty when the behaviour is there.
 */
const probes = [
  {
    migration: "0005",
    name: "the private profile columns are not readable by an anonymous client",
    async check(client) {
      const failures = [];
      for (const column of ["email", "student_id", "role"]) {
        const { rows } = await client.query(`
          select count(*)::int as n
            from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'profiles'
             and grantee = 'anon' and column_name = $1
        `, [column]);
        if (rows[0].n > 0) failures.push(`anon can read profiles.${column}`);
      }
      return failures;
    },
  },
  {
    migration: "0009",
    name: "claiming verification is server-side only",
    async check(client) {
      const { rows } = await client.query(`
        select has_function_privilege(
          'anon', 'public.claim_student_verification(text, text)', 'execute'
        ) as allowed
      `);
      return rows[0].allowed ? ["anon can call claim_student_verification"] : [];
    },
  },
  {
    migration: "0010",
    name: "a personal address cannot open an account",
    async check(client) {
      // The guard lives on `auth.users`, because that is where an
      // account is created and every way in ends up there.
      try {
        await client.query(
          "insert into auth.users (id, email) values ($1, $2)",
          ["dddddddd-0000-4000-8000-00000000000f", "someone@gmail.com"]
        );
        return ["a personal address opened an account"];
      } catch {
        return [];
      }
    },
  },
  {
    migration: "0010",
    name: "a college address can open an account",
    async check(client) {
      try {
        await client.query(
          "insert into auth.users (id, email) values ($1, $2)",
          ["dddddddd-0000-4000-8000-00000000000e", "someone@delhitechnicalcampus.ac.in"]
        );
        return [];
      } catch (err) {
        return [`a college address was refused: ${err.message}`];
      }
    },
  },
  {
    migration: "0006",
    name: "a completed transaction cannot be reopened",
    async check(client) {
      const failures = [];
      const txn = await makeCompletedTransaction(client);
      if (!txn) return ["the fixture transaction could not be made"];
      await client.query("begin");
      try {
        await client.query(
          "update public.transactions set status = 'agreed' where id = $1",
          [txn.id]
        );
        failures.push("a completed transaction was reopened");
      } catch {
        // Refused, which is what should happen.
      }
      await client.query("rollback");
      return failures;
    },
  },
  {
    migration: "0007",
    name: "a completed transaction cannot have its confirmations cleared",
    async check(client) {
      const failures = [];
      const txn = await makeCompletedTransaction(client);
      if (!txn) return ["the fixture transaction could not be made"];
      await client.query("begin");
      try {
        await client.query(
          "update public.transactions set buyer_confirmed_at = null where id = $1",
          [txn.id]
        );
        failures.push("a completed transaction's confirmation was cleared");
      } catch {
        // Refused, which is what should happen.
      }
      await client.query("rollback");
      return failures;
    },
  },
  {
    migration: "0007",
    name: "a completed transaction cannot have its swap code reissued",
    async check(client) {
      const failures = [];
      const txn = await makeCompletedTransaction(client);
      if (!txn) return ["the fixture transaction could not be made"];
      await client.query("begin");
      try {
        await client.query(
          "update public.transactions set swap_code = 'PROBE-OTHER' where id = $1",
          [txn.id]
        );
        failures.push("a completed transaction's swap code was reissued");
      } catch {
        // Refused, which is what should happen.
      }
      await client.query("rollback");
      return failures;
    },
  },
  {
    migration: "0012",
    name: "the rental stock has its own tables",
    async check(client) {
      const { rows } = await client.query(`
        select count(*)::int as n
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname in ('reserve_resource_types', 'reserve_reservations',
                             'reserve_reservation_demands', 'reserve_resource_units')
      `);
      return rows[0].n === 4 ? [] : [`only ${rows[0].n} of the four rental tables exist`];
    },
  },
  {
    migration: "0012",
    name: "the rental catalogue is a function of the stock",
    async check(client) {
      const { rows } = await client.query("select public.reserve_catalogue() as catalogue");
      const types = rows[0]?.catalogue?.types ?? [];
      return types.length ? [] : ["the rental catalogue is empty"];
    },
  },
  {
    migration: "0013_location",
    name: "the nearby-listing query is there and orders by distance",
    async check(client) {
      const { rows } = await client.query(`
        select p.proname
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('nearby_listings', 'save_my_location', 'get_my_location')
      `);
      const names = rows.map((r) => r.proname);
      const missing = ["nearby_listings", "save_my_location", "get_my_location"].filter(
        (n) => !names.includes(n)
      );
      return missing.length ? [`these location functions are missing: ${missing.join(", ")}`] : [];
    },
  },
  {
    migration: "0013_college",
    name: "Delhi Technical Campus is on the list of campuses",
    async check(client) {
      const { rows } = await client.query(`
        select email_domain from public.colleges where short_name = 'DTC'
      `);
      if (!rows.length) return ["DTC is not in the colleges table"];
      if (rows[0].email_domain !== "delhitechnicalcampus.ac.in") {
        return [`DTC's domain is ${rows[0].email_domain}`];
      }
      return [];
    },
  },
  {
    migration: "0016",
    name: "the UniCompress tables exist and force row level security",
    async check(client) {
      const { rows } = await client.query(`
        select c.relname, c.relrowsecurity, c.relforcerowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname in ('listing_image_blobs', 'compression_history')
      `);
      const failures = [];
      for (const name of ["listing_image_blobs", "compression_history"]) {
        const row = rows.find((r) => r.relname === name);
        if (!row) failures.push(`${name} does not exist`);
        else if (!row.relrowsecurity) failures.push(`${name} does not enable row level security`);
        else if (!row.relforcerowsecurity) failures.push(`${name} does not force row level security`);
      }
      return failures;
    },
  },
  {
    migration: "0016",
    name: "the UniCompress functions are server-side only",
    async check(client) {
      const { rows } = await client.query(`
        select p.proname,
               has_function_privilege('anon', p.oid, 'execute') as anon_allowed
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('put_listing_image_blob', 'get_listing_image_blob',
                             'record_compression', 'fetch_compression_history')
      `);
      const failures = [];
      for (const row of rows) {
        if (row.anon_allowed) failures.push(`anon can call ${row.proname}`);
      }
      if (rows.length < 4) failures.push("a UniCompress function is missing");
      return failures;
    },
  },
];

/**
 * A finished transaction to try to tamper with.
 *
 * A transaction cannot be inserted as finished — the guard rewrites the
 * status on the way in, because a handover has to be confirmed by both
 * students before it is complete. So it is made the way a real one is:
 * inserted as agreed, then confirmed by the buyer, then by the seller.
 * The second confirmation is what completes it.
 *
 * It is left in place: a database that is being probed has no reason to
 * be tidy.
 */
async function makeCompletedTransaction(client) {
  // A finished transaction that is already there will do: there is one
  // handover per listing, so a second attempt on the same listing would
  // be refused.
  const { rows: existing } = await client.query(`
    select id from public.transactions
     where status = 'completed'
     order by created_at desc, id
     limit 1
  `);
  if (existing.length) return { id: existing[0].id };

  const { rows } = await client.query(`
    select l.id as listing_id, l.seller_id
      from public.listings l
     where l.listing_type = 'sell'
       and not exists (
         select 1 from public.transactions t where t.listing_id = l.id
       )
     order by l.created_at, l.id
     limit 1
  `);
  if (!rows.length) return null;
  const listing = rows[0];

  const { rows: sellers } = await client.query(
    "select id from public.profiles where id <> $1 order by created_at limit 1",
    [listing.seller_id]
  );
  if (!sellers.length) return null;
  const buyer = sellers[0].id;

  const { rows: made } = await client.query(
    `insert into public.transactions
       (listing_id, seller_id, buyer_id, amount, status, swap_code)
     values ($1, $2, $3, 100, 'agreed', 'PROBE-CODE')
     returning id`,
    [listing.listing_id, listing.seller_id, buyer]
  ).catch(() => ({ rows: [] }));
  if (!made.length) return null;

  const id = made[0].id;
  await client
    .query("update public.transactions set buyer_confirmed_at = now() where id = $1", [id])
    .catch(() => {});
  await client
    .query("update public.transactions set seller_confirmed_at = now() where id = $1", [id])
    .catch(() => {});

  const { rows: check } = await client.query(
    "select status from public.transactions where id = $1",
    [id]
  );
  if (check[0]?.status !== "completed") return null;
  return { id };
}

/* -------------------------------------------------------------------- run */

async function runProbes(client, label) {
  let failed = 0;
  console.log(`\n${label}`);
  for (const probe of probes) {
    let failures = [];
    try {
      failures = await probe.check(client);
    } catch (err) {
      failures = [`the probe itself failed: ${err.message}`];
    }
    if (failures.length) {
      failed += 1;
      console.log(`  ✗ ${probe.name}`);
      for (const failure of failures) console.log(`      ${failure}`);
    } else {
      console.log(`  ✓ ${probe.name}`);
    }
  }
  return failed;
}

/* ------------------------------------------------------- the point of it */

/**
 * The last check: each migration earns its place.
 *
 * The migrations are applied without one of them, and the probes that
 * belong to it are expected to fail. A migration that changes nothing
 * would leave its probes passing, which is the whole thing this is
 * here to catch.
 */
async function checkMigrationEarnsItsPlace() {
  const omissions = [
    "0007_transaction_terminal_state.sql",
    "0012_unireserve.sql",
    "0016_unicompress.sql",
  ];

  console.log("\neach migration earns its place");
  let failed = 0;
  for (const file of omissions) {
    // The probes that belong to the migration being left out. They are
    // the ones that have to stop working without it.
    //
    // The tag is matched against the file's whole name, not the first
    // four characters: two migrations can share a number — there is a
    // `0013_college_...` and a `0013_location_...` — and a short tag
    // would pick up the wrong one's probes.
    const stem = file.replace(/\.sql$/, "");
    const belonging = probes.filter((probe) => stem.startsWith(probe.migration));
    if (!belonging.length) continue;

    const client = await build(file);
    try {
      let stillWorking = 0;
      for (const probe of belonging) {
        let failures = [];
        try {
          failures = await probe.check(client);
        } catch {
          failures = ["the probe failed outright"];
        }
        if (!failures.length) stillWorking += 1;
      }
      if (stillWorking) {
        failed += 1;
        console.log(`  ✗ without ${file}, ${stillWorking} of its ${belonging.length} probes still pass`);
      } else {
        console.log(`  ✓ without ${file}, its ${belonging.length} probes fail as they should`);
      }
    } finally {
      await client.end();
    }
  }
  return failed;
}

/* ------------------------------------------------------------------ main */

let client;
if (prepare) {
  console.log("preparing the database");
  client = await build();
} else {
  client = new Client({ connectionString: url });
  await client.connect();
}

let failed = 0;
try {
  failed += await runProbes(client, "probing the migrations");
} finally {
  await client.end();
}

// The omission check needs a database of its own, so it runs last and
// rebuilds from scratch. It is skipped when the caller only wanted a
// probe of what is already there.
if (prepare) {
  failed += await checkMigrationEarnsItsPlace();
}

if (failed) {
  console.error(`\n✗ ${failed} probe(s) failed.`);
  process.exit(1);
}
console.log("\n✓ every probe passed.");
