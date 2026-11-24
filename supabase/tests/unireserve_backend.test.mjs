// A test run for the UniReserve backend.
//
// It drives the real migrations in a real PostgreSQL: the same functions
// the app calls, over the same data, with the same locking. The only
// thing faked is the sign-in, which is the one thing Supabase owns.
//
//   DATABASE_URL=postgres://... node supabase/tests/unireserve_backend.test.mjs
//
// It expects the migrations to be applied and the demo data seeded —
// `node scripts/test-database.mjs` does both.
import { Client } from "pg";

const url =
  process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:55432/postgres";
const PG = new URL(url);

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

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function connect() {
  return new Client({
    host: PG.hostname,
    port: Number(PG.port || 5432),
    user: decodeURIComponent(PG.username || "postgres"),
    password: decodeURIComponent(PG.password || ""),
    database: PG.pathname.replace(/^\//, "") || "postgres",
  });
}

async function raw(sql, params = []) {
  const c = connect();
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

async function call(fnName, args, userId) {
  const c = connect();
  await c.connect();
  await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  try {
    const r = await c.query(`select public.${fnName}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as result`, args);
    return r.rows[0].result;
  } finally {
    await c.end();
  }
}

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

async function seedUsers() {
  await raw(
    `insert into auth.users (id, email, raw_user_meta_data, created_at)
     values ($1, 'alpha@dtu.ac.in', '{"full_name":"Alpha"}'::jsonb, now()),
            ($2, 'beta@dtu.ac.in',  '{"full_name":"Beta"}'::jsonb, now() + interval '1 second'),
            ($3, 'gamma@dtu.ac.in', '{"full_name":"Gamma"}'::jsonb, now() + interval '2 seconds')
     on conflict (id) do nothing`,
    [A, B, C]
  );
  await raw(
    `insert into public.profiles (id, email, full_name, role, student_id, verified, created_at)
     values ($1, 'alpha@dtu.ac.in', 'Alpha', 'student', 'DTU/2K23/101', true, now()),
            ($2, 'beta@dtu.ac.in',  'Beta',  'student', 'DTU/2K23/102', true, now() + interval '1 second'),
            ($3, 'gamma@dtu.ac.in', 'Gamma', 'student', 'DTU/2K23/103', true, now() + interval '2 seconds')
     on conflict (id) do nothing`,
    [A, B, C]
  );
}

// A fresh campus: three cycles, two calculators, and nothing booked.
async function reset(cycles = 3, calculators = 2) {
  await raw(`delete from public.reserve_reservations`);
  await raw(`delete from public.reserve_resource_units`);
  await raw(`delete from public.reserve_resource_types`);
  await raw(`delete from public.reserve_reservation_logs`);
  await raw(
    `insert into public.reserve_resource_types (slug, label, unit_label, category_slug, sort)
     values ('cycles','Cycles','cycle','sports',1), ('calculators','Calculators','calculator','electronics',2)`
  );
  await raw(
    `insert into public.reserve_resource_units (resource_type_id, label)
     select rt.id, rt.slug || ' ' || n from public.reserve_resource_types rt,
          generate_series(1, (case rt.slug when 'cycles' then $1::int else $2::int end)) n
      where rt.slug in ('cycles','calculators')`,
    [cycles, calculators]
  );
}

// A reservation that is already holding something, set up by hand — the
// kind of position the algorithm has to reason about.
async function seat(owner, slug, allocated, need, offsetSeconds = 0) {
  const id = (
    await raw(
      `insert into public.reserve_reservations (user_id, status, duration_days, created_at)
       values ($1, 'approved', 7, now() + ($2 || ' seconds')::interval) returning id`,
      [owner, String(offsetSeconds)]
    )
  ).rows[0].id;
  await raw(
    `insert into public.reserve_reservation_demands (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
     select $1, id, 1, 1, $3 from public.reserve_resource_types where slug = $2`,
    [id, slug, allocated]
  );
  if (need) {
    await raw(
      `insert into public.reserve_reservation_demands (reservation_id, resource_type_id, max_units, requested_units, allocated_units)
       select $1, id, 1, 1, 0 from public.reserve_resource_types where slug = $2`,
      [id, need]
    );
  }
  if (allocated > 0) {
    await raw(
      `update public.reserve_resource_units set status = 'reserved', reservation_id = $1
        where resource_type_id = (select id from public.reserve_resource_types where slug = $2)
          and status = 'available'`,
      [id, slug]
    );
  }
  return id;
}

console.log("\nUniReserve backend checks\n");

await seedUsers();

// ---------------------------------------------------------------------------
console.log("\n· the vectors");
{
  await reset();
  const available = await call("reserve_available_vector", [], A);
  eq("the available vector starts at the total", available, { cycles: 3, calculators: 2 });

  const need = await call("reserve_need_vector", ["00000000-0000-4000-8000-000000000000"], A);
  eq("the need vector of an unknown reservation is empty", need, {});
}

// ---------------------------------------------------------------------------
console.log("\n· a safe request is approved");
{
  await reset();
  const r = await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 1, max: 1 }])], A);
  eq("the decision is approved", r.decision, "approved");
  eq("the status is approved", r.status, "approved");
  eq("the allocation holds one cycle", r.allocation, { cycles: 1 });
  eq("the available vector drops by one", r.available, { cycles: 2, calculators: 2 });
  eq("the state stays safe", r.safe, true);
  ok("a safe sequence comes back", Array.isArray(r.safe_sequence) && r.safe_sequence.length >= 1);

  const need = await call("reserve_need_vector", [r.reservation_id], A);
  eq("need = maximum - allocation", need, { cycles: 0 });
}

// ---------------------------------------------------------------------------
console.log("\n· a malformed request is refused");
{
  await reset();
  let threw = null;
  try {
    await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 9, max: 9 }])], B);
  } catch (e) {
    threw = e.message;
  }
  ok("a request larger than the pool is refused", threw !== null, String(threw));

  let threw2 = null;
  try {
    await call("reserve_request", [7, JSON.stringify([{ type: "nonsense", units: 1, max: 1 }])], B);
  } catch (e) {
    threw2 = e.message;
  }
  ok("an unknown resource is refused", threw2 !== null, String(threw2));

  const rows = await raw(`select count(*)::int as n from public.reserve_reservations`);
  eq("a refused request leaves no reservation behind", rows.rows[0].n, 0);
}

// ---------------------------------------------------------------------------
console.log("\n· a request beyond the free pool is held");
{
  await reset();
  const a = await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 1, max: 1 }])], A);
  eq("the first request is approved", a.decision, "approved");

  const b = await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 3, max: 3 }])], B);
  eq("the second request is held", b.decision, "held");
  eq("a held request keeps its pending status", b.status, "pending");
  eq("nothing is allocated for a held request", b.allocation, {});
  eq("the free pool is unchanged", b.available, { cycles: 2, calculators: 2 });

  const avail = await call("reserve_available_vector", [], A);
  eq("the pool reflects only the approved request", avail, { cycles: 2, calculators: 2 });
}

// ---------------------------------------------------------------------------
console.log("\n· release puts the resources back");
{
  await reset();
  const a = await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 1, max: 1 }])], A);
  await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 3, max: 3 }])], B);

  const mineA = await call("reserve_dashboard", [], A);
  const mineB = await call("reserve_dashboard", [], B);
  const approved = mineA.mine.find((m) => m.status === "approved");
  const held = mineB.mine.find((m) => m.status === "pending");
  ok("the dashboard shows the approved reservation", Boolean(approved));
  ok("the dashboard shows the waiting reservation", Boolean(held));

  const before = await call("reserve_available_vector", [], A);
  const rel = await call("reserve_release", [approved.id, "completed"], A);
  eq("the release happened", rel.released, true);
  eq("the reservation is completed", rel.status, "completed");

  // The released unit went straight to the student who was waiting.
  const after = await call("reserve_dashboard", [], B);
  const granted = after.mine.find((m) => m.id === held.id);
  eq("the waiting student was granted the unit", granted.status, "approved");
  eq("and holds what they asked for", granted.allocation, { cycles: 3 });
  const pool = await call("reserve_available_vector", [], A);
  eq("the pool is empty again", pool.cycles, 0);
}

// ---------------------------------------------------------------------------
console.log("\n· cancelling a reservation gives nothing back, because nothing was allocated");
{
  await reset();
  await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 1, max: 1 }])], A);
  const b = await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 3, max: 3 }])], B);
  eq("the request is held", b.decision, "held");
  const rel = await call("reserve_release", [b.reservation_id, "cancelled"], B);
  eq("the cancellation is recorded", rel.released, true);
  eq("the reservation is cancelled", rel.status, "cancelled");

  const rows = await raw(`select status from public.reserve_reservations where id = $1`, [b.reservation_id]);
  eq("the row says cancelled", rows.rows[0].status, "cancelled");
}

// ---------------------------------------------------------------------------
console.log("\n· a reservation cannot be released by somebody else");
{
  await reset();
  const a = await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 1, max: 1 }])], A);
  let threw = null;
  try {
    await call("reserve_release", [a.reservation_id, "completed"], B);
  } catch (e) {
    threw = e.message;
  }
  ok("another student cannot release somebody else's reservation", threw !== null, String(threw));
}

// ---------------------------------------------------------------------------
console.log("\n· an unsafe request is blocked");
{
  await reset(1, 1);
  // Alpha holds the only cycle and still needs the calculator to finish.
  await seat(A, "cycles", 1, "calculators", 0);
  // Gamma wants the calculator, and declares that a cycle is the most it
  // could ever need. Granting the calculator would leave Alpha unable to
  // finish while Gamma waits for the cycle.
  const before = await call("reserve_available_vector", [], A);
  const r = await call("reserve_request", [7, JSON.stringify([{ type: "calculators", units: 1, max: 1 }, { type: "cycles", units: 0, max: 1 }])], C);
  eq("the unsafe request is blocked", r.decision, "blocked");
  eq("the pool is untouched", r.available, before);
  eq("nothing was allocated", r.allocation, {});
  ok("the reason mentions safety", /unable to complete/i.test(r.reason || ""), r.reason);

  const unit = await raw(
    `select status, reservation_id from public.reserve_resource_units
      where resource_type_id = (select id from public.reserve_resource_types where slug = 'calculators')`
  );
  eq("the calculator is free again", unit.rows[0].status, "available");
  eq("and is not held by anybody", unit.rows[0].reservation_id, null);
}

// ---------------------------------------------------------------------------
console.log("\n· the unsafe state is reported as unsafe");
{
  await reset(1, 1);
  await seat(A, "cycles", 1, "calculators", 0);
  await seat(B, "calculators", 1, "cycles", 60);
  const safe = await call("reserve_safe_sequence", [null, null], A);
  eq("the state is not safe", safe.safe, false);
  eq("there is no safe sequence", safe.sequence, []);
}

// ---------------------------------------------------------------------------
console.log("\n· concurrent requests do not over-allocate");
{
  await reset(1, 2);
  const results = await Promise.all(
    [A, B, C, A, B].map((u) =>
      call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 1, max: 1 }])], u).catch((e) => ({ decision: `error: ${e.message}` }))
    )
  );
  const approvals = results.filter((r) => r.decision === "approved").length;
  eq("exactly one student is approved", approvals, 1);

  const units = await raw(
    `select count(*)::int as n from public.reserve_resource_units
      where resource_type_id = (select id from public.reserve_resource_types where slug = 'cycles')
        and status = 'reserved'`
  );
  eq("exactly one unit is held", units.rows[0].n, 1);

  const pending = await raw(
    `select count(*)::int as n from public.reserve_reservations where status = 'pending'`
  );
  eq("the rest are waiting", pending.rows[0].n, 4);
}

// ---------------------------------------------------------------------------
console.log("\n· the log records every decision");
{
  await reset();
  await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 1, max: 1 }])], A);
  const rows = await raw(`select event, decision from public.reserve_reservation_logs order by id desc limit 5`);
  ok("the log has entries", rows.rows.length > 0);
  ok("the log names the events", rows.rows.every((r) => Boolean(r.event)));
  eq("the first entry is the request", rows.rows[0].event, "requested");

  const dash = await call("reserve_dashboard", [], A);
  ok("the dashboard carries the log", Array.isArray(dash.logs));
  ok("the dashboard carries the counts", typeof dash.counts.pending === "number");
  ok("the dashboard carries the safe sequence", Array.isArray(dash.safe_sequence));
}

// ---------------------------------------------------------------------------
console.log("\n· the demonstration scenarios");
{
  const demo = await call("reserve_demo_scenarios", [], A);
  const names = demo.scenarios.map((s) => s.scenario);
  eq("four scenarios ran", names.length, 4);
  eq("the safe request is approved", demo.scenarios[0].decision, "approved");
  eq("the unsafe request is blocked", demo.scenarios[1].decision, "blocked");
  const beforeSum = Object.values(demo.scenarios[2].available_before).reduce((a, b) => a + b, 0);
  const afterSum = Object.values(demo.scenarios[2].available_after).reduce((a, b) => a + b, 0);
  eq("the release gives the unit back", afterSum, beforeSum + 1);
  ok(
    "the safe sequence changed",
    JSON.stringify(demo.scenarios[3].safe_sequence_before) !== JSON.stringify(demo.scenarios[3].safe_sequence_after),
    JSON.stringify(demo.scenarios[3])
  );

  const leftovers = await raw(`select count(*)::int as n from public.reserve_resource_types where is_demo`);
  eq("the sandbox is cleaned up", leftovers.rows[0].n, 0);
  const leftovers2 = await raw(`select count(*)::int as n from public.reserve_reservation_logs where is_demo`);
  eq("the demo run is logged once", leftovers2.rows[0].n, 1);
}

// ---------------------------------------------------------------------------
console.log("\n· the catalogue and the marketplace");
{
  await reset();
  const cat = await call("reserve_catalogue", [], A);
  ok("the catalogue has units", cat.units.length > 0);
  ok("the catalogue names the types", cat.units.every((u) => Boolean(u.type && u.label)));
  ok("the catalogue has types", cat.types.length > 0);
  ok("the catalogue counts what is free", cat.types.every((t) => typeof t.available === "number"));

  const listingId = (
    await raw(
      `insert into public.listings (seller_id, title, description, category_slug, listing_type, price, rent_per_month, status, condition, campus_area, created_at)
       values ($1, 'Campus cycle for rent', 'A good cycle', 'sports', 'rent', 0, 350, 'active', 'Good', 'North campus', now())
       returning id`, [B]
    )
  ).rows[0].id;
  const units = await raw(`select count(*)::int as n from public.reserve_resource_units where listing_id = $1`, [listingId]);
  eq("the rent listing joined the pool", units.rows[0].n, 1);

  // And when it comes down, it leaves the pool again.
  await raw(`update public.listings set status = 'sold' where id = $1`, [listingId]);
  const after = await raw(`select count(*)::int as n from public.reserve_resource_units where listing_id = $1`, [listingId]);
  eq("the withdrawn listing left the pool", after.rows[0].n, 0);
}

// ---------------------------------------------------------------------------
console.log("\n· the dashboard totals");
{
  await reset();
  await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 2, max: 2 }])], A);
  const dash = await call("reserve_dashboard", [], A);
  eq("the total is counted", dash.totals.total, 5);
  eq("the allocation is counted", dash.totals.allocated, 2);
  eq("the free pool is counted", dash.totals.available, 3);
  eq("one reservation is approved", dash.counts.approved, 1);
  eq("the type breakdown is right", dash.types.find((t) => t.slug === "cycles"), { slug: "cycles", total: 3, allocated: 2, available: 1 });
}

// ---------------------------------------------------------------------------
console.log("\n· the queue moves on when a unit comes back");
{
  await reset();
  const a = await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 2, max: 2 }])], A);
  eq("the first student is approved", a.decision, "approved");

  const b = await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 3, max: 3 }])], B);
  eq("the second student is held", b.decision, "held");

  await call("reserve_release", [a.reservation_id, "completed"], A);

  const after = await call("reserve_dashboard", [], B);
  const mine = after.mine.find((m) => m.id === b.reservation_id);
  eq("the waiting student now holds the pool", mine.status, "approved");
  eq("and holds what they asked for", mine.allocation, { cycles: 3 });
}

// ---------------------------------------------------------------------------
console.log("\n· a request without a sign-in is refused");
{
  await reset();
  let threw = null;
  try {
    await call("reserve_request", [7, JSON.stringify([{ type: "cycles", units: 1, max: 1 }])], null);
  } catch (e) {
    threw = e.message;
  }
  ok("an anonymous request is refused", threw !== null, String(threw));
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed ? 1 : 0);
