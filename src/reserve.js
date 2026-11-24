// UniReserve — smart reservations, safe allocations, zero deadlocks.
//
// The feature has two halves that must agree:
//
//   * the server, which owns the stock and runs the Banker's Algorithm
//     (see `supabase/migrations/0012_unireserve.sql`), and
//   * this file, which draws the interface and — when there is no server
//     to talk to — runs the *same* algorithm on the device so the feature
//     is never a dead panel.
//
// Nothing here decides anything by itself. Every approval, every hold and
// every refusal comes out of the algorithm; the interface only reports it.
//
// The mapping from operating systems to a campus:
//
//   resource type    → a kind of rentable product (cycles, calculators)
//   resource unit    → one physical thing of that kind
//   reservation      → a process: a student's request for resources
//   maximum demand   → the most of each type the reservation may hold
//   allocation       → what it holds right now
//   need             → maximum demand − allocation
//   available vector → total units of each type, less what is held

import * as SB from "./supabase.js";
import {
  reserveCatalogueFromRow,
  reserveDashboardFromRow,
} from "./persistence.js";
import { RESERVE_TYPES, RESERVE_UNITS } from "./data.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const IN_PLAY = new Set(["pending", "approved", "active"]);
const DURATIONS = [1, 7, 14, 30, 90];

/* ------------------------------------------------------------------ state */

let engine = "device"; // "server" | "device"
let catalogue = { types: [], units: [] };
let dashboard = null;
let localTypes = [];
let localReservations = [];
let localLog = [];
let localSeq = 0;
let listings = [];
let onToast = () => {};
let bound = false;

/* ------------------------------------------------------- the local engine */

/**
 * The Available Resource Vector.
 *
 *   Available[i] = total units of type i − units of type i that are held.
 *
 * Only reservations still in play hold anything: pending, approved and
 * active. A finished, cancelled or expired reservation holds nothing.
 */
function localAvailableVector(scope = null) {
  const out = {};
  for (const t of localTypes) out[t.slug] = t.units.length;
  for (const r of localReservations) {
    if (!IN_PLAY.has(r.status)) continue;
    if (scope && !scope.includes(r.id)) continue;
    for (const [slug, d] of Object.entries(r.demands)) {
      if (!(slug in out)) continue;
      out[slug] = Math.max(0, out[slug] - d.allocated);
    }
  }
  return out;
}

/** The Need Matrix row: maximum demand − allocation. */
function localNeedVector(r) {
  const out = {};
  for (const [slug, d] of Object.entries(r.demands)) {
    out[slug] = Math.max(0, d.max - d.allocated);
  }
  return out;
}

/** The Allocation Matrix row. */
function localAllocationVector(r) {
  const out = {};
  for (const [slug, d] of Object.entries(r.demands)) {
    if (d.allocated > 0) out[slug] = d.allocated;
  }
  return out;
}

/**
 * The Safety Algorithm, and the safe sequence with it.
 *
 *   Work := Available
 *   repeat
 *     find a reservation whose Need is covered by Work
 *     Work := Work + that reservation's Allocation
 *     put it on the sequence
 *   until no reservation can finish
 *
 * If every reservation finished, the state is safe and the order they
 * finished in is the safe sequence. If some reservation could not finish,
 * the state is unsafe.
 */
function localSafeSequence(available, scope = null) {
  const work = { ...available };
  const done = new Set();
  const sequence = [];
  const candidates = localReservations
    .filter((r) => IN_PLAY.has(r.status) && (!scope || scope.includes(r.id)))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

  let progress = true;
  while (progress) {
    progress = false;
    for (const r of candidates) {
      if (done.has(r.id)) continue;
      const need = localNeedVector(r);
      const covered = Object.entries(need).every(([k, v]) => (work[k] ?? 0) >= v);
      if (!covered) continue;
      for (const [k, v] of Object.entries(localAllocationVector(r))) {
        work[k] = (work[k] ?? 0) + v;
      }
      done.add(r.id);
      sequence.push(r.id);
      progress = true;
    }
  }

  const outstanding = candidates.filter((r) => !done.has(r.id)).length;
  return { safe: outstanding === 0, sequence, outstanding };
}

/**
 * The Resource Request Algorithm.
 *
 *   Request_i ≤ Need_i        — the request may not exceed the maximum
 *   Request_i ≤ Available_i   — there has to be something to give
 *   the resulting state is safe — and giving it must not leave anybody
 *   unable to finish
 *
 * The tentative allocation is written first and undone if the state turns
 * out to be unsafe. That is the step the textbook algorithm takes, and it
 * is the step that keeps a refusal from taking the resource with it.
 */
function localTryGrant(reservation, scope = null) {
  const available = localAvailableVector(scope);

  // ---- Request_i ≤ Available_i -------------------------------------------
  for (const [slug, d] of Object.entries(reservation.demands)) {
    if (d.requested <= 0) continue;
    const have = available[slug] ?? 0;
    if (d.requested > have) {
      const safe = localSafeSequence(available, scope);
      return {
        decision: "held",
        reason: `${slug}: ${d.requested} wanted, ${have} free`,
        available_before: available,
        available,
        safe: safe.safe,
        safe_sequence: safe.sequence,
        units: [],
      };
    }
  }

  // ---- The tentative allocation ------------------------------------------
  for (const d of Object.values(reservation.demands)) {
    if (d.requested > 0) d.allocated += d.requested;
  }
  const picked = [];
  for (const [slug, d] of Object.entries(reservation.demands)) {
    if (d.requested <= 0) continue;
    const type = localTypes.find((t) => t.slug === slug);
    if (!type) continue;
    const free = type.units.filter((u) => u.status === "available").slice(0, d.requested);
    for (const u of free) {
      u.status = "reserved";
      u.reservation_id = reservation.id;
      picked.push(u.id);
    }
  }

  const after = localAvailableVector(scope);
  const safe = localSafeSequence(after, scope);

  // ---- Is the resulting state safe? --------------------------------------
  if (!safe.safe) {
    for (const d of Object.values(reservation.demands)) {
      if (d.requested > 0) d.allocated = Math.max(0, d.allocated - d.requested);
    }
    for (const t of localTypes) {
      for (const u of t.units) {
        if (u.reservation_id === reservation.id) {
          u.status = "available";
          u.reservation_id = null;
        }
      }
    }
    return {
      decision: "blocked",
      reason: "the allocation would leave the campus unable to complete an existing reservation",
      available_before: available,
      available: localAvailableVector(scope),
      safe: false,
      safe_sequence: [],
      units: [],
    };
  }

  return {
    decision: "approved",
    reason: "the campus can still complete every reservation after this one",
    available_before: available,
    available: after,
    safe: true,
    safe_sequence: safe.sequence,
    units: picked,
  };
}

function localRequest({ durationDays = 7, requests = [] }) {
  const wanted = requests.reduce((sum, r) => sum + (r.units || 0), 0);
  if (!wanted) return { error: "a reservation needs at least one resource" };

  const request = {};
  const maximum = {};
  for (const item of requests) {
    const type = localTypes.find((t) => t.slug === item.type);
    if (!type) return { error: `unknown resource: ${item.type}` };
    const max = Math.max(item.units || 0, item.max || 0);
    if (max > type.units.length) {
      return { error: `the campus has ${type.units.length} ${type.slug} — that maximum is more than there is` };
    }
    request[item.type] = item.units || 0;
    maximum[item.type] = max;
  }

  const reservation = {
    id: `local-${++localSeq}`,
    order: localSeq,
    user_id: "local",
    status: "pending",
    decision: null,
    reason: null,
    duration_days: durationDays,
    demands: {},
    created_at: new Date().toISOString(),
  };
  for (const [slug, units] of Object.entries(request)) {
    reservation.demands[slug] = { max: maximum[slug], requested: units, allocated: 0 };
  }
  localReservations.push(reservation);

  const outcome = localTryGrant(reservation);
  reservation.decision = outcome.decision;
  reservation.reason = outcome.reason;
  reservation.status =
    outcome.decision === "approved" ? "approved" : outcome.decision === "held" ? "pending" : "blocked";
  if (outcome.decision === "approved") {
    reservation.starts_at = new Date().toISOString();
    reservation.ends_at = new Date(Date.now() + durationDays * 864e5).toISOString();
  }
  reservation.safe_sequence = outcome.safe_sequence;

  localLog.unshift({
    id: localLog.length + 1,
    event: "requested",
    decision: outcome.decision,
    reason: outcome.reason,
    request,
    allocation: localAllocationVector(reservation),
    available: outcome.available,
    safe_sequence: outcome.safe_sequence,
    created_at: new Date().toISOString(),
  });

  return {
    decision: outcome.decision,
    status: reservation.status,
    reservation_id: reservation.id,
    reason: outcome.reason,
    request,
    maximum,
    allocation: localAllocationVector(reservation),
    available: outcome.available,
    safe: outcome.safe,
    safe_sequence: outcome.safe_sequence,
  };
}

function localRelease(reservationId, status = "completed") {
  const r = localReservations.find((x) => x.id === reservationId);
  if (!r) return { error: "no such reservation" };
  if (!IN_PLAY.has(r.status)) return { released: false, status: r.status };

  const allocation = localAllocationVector(r);
  for (const t of localTypes) {
    for (const u of t.units) {
      if (u.reservation_id === r.id) {
        u.status = "available";
        u.reservation_id = null;
      }
    }
  }
  for (const d of Object.values(r.demands)) d.allocated = 0;

  r.status = status === "cancelled" ? "cancelled" : status === "expired" ? "expired" : "completed";
  r.released_at = new Date().toISOString();

  const available = localAvailableVector();
  const safe = localSafeSequence(available);
  localLog.unshift({
    id: localLog.length + 1,
    event: "released",
    decision: "released",
    reason: r.status,
    allocation,
    available,
    safe_sequence: safe.sequence,
    created_at: new Date().toISOString(),
  });

  // A unit came back — whoever was waiting for one gets another turn.
  for (const waiting of localReservations.filter((x) => x.status === "pending")) {
    const outcome = localTryGrant(waiting);
    if (outcome.decision === "approved") {
      waiting.decision = "approved";
      waiting.status = "approved";
      waiting.reason = outcome.reason;
      waiting.safe_sequence = outcome.safe_sequence;
      waiting.starts_at = new Date().toISOString();
      waiting.ends_at = new Date(Date.now() + waiting.duration_days * 864e5).toISOString();
    }
  }

  return {
    released: true,
    status: r.status,
    reservation_id: r.id,
    allocation,
    available,
    safe: safe.safe,
    safe_sequence: safe.sequence,
  };
}

/**
 * The four worked examples, run against a sandbox of their own.
 *
 * The sandbox is created and destroyed by the run, so the examples come
 * out the same whatever else is happening on the campus. The algorithm
 * that decides them is the one the live feature uses.
 */
function localDemoScenarios() {
  const scenarios = [];

  const sandbox = (spec) => {
    localReservations = localReservations.filter((r) => !r.is_demo);
    localTypes = spec.map((s) => ({
      slug: s.type,
      label: s.type,
      unit_label: "unit",
      units: Array.from({ length: s.units }, (_, i) => ({
        id: `${s.type}-${i + 1}`,
        status: "available",
        reservation_id: null,
      })),
    }));
    localSeq = 0;
  };

  const demoReservation = (owner, demands, offset) => {
    const r = {
      id: `demo-${++localSeq}`,
      order: offset,
      user_id: owner,
      status: "pending",
      decision: null,
      reason: null,
      duration_days: 7,
      is_demo: true,
      demands: {},
      created_at: new Date().toISOString(),
    };
    for (const d of demands) {
      r.demands[d.type] = { max: d.max, requested: d.units, allocated: d.allocated || 0 };
    }
    localReservations.push(r);
    return r;
  };

  const hold = (r, slug, units) => {
    const type = localTypes.find((t) => t.slug === slug);
    const free = type.units.filter((u) => u.status === "available").slice(0, units);
    for (const u of free) {
      u.status = "reserved";
      u.reservation_id = r.id;
    }
    r.demands[slug].allocated += units;
  };

  // 1 — a safe reservation is approved
  sandbox([{ type: "demo-alpha", units: 2 }, { type: "demo-beta", units: 2 }]);
  let r1 = demoReservation("me", [
    { type: "demo-alpha", units: 1, max: 1 },
    { type: "demo-beta", units: 1, max: 1 },
  ], 0);
  let scope = [r1.id];
  let before = localAvailableVector(scope);
  let outcome = localTryGrant(r1, scope);
  r1.status = "approved";
  scenarios.push({
    scenario: "safe_approved",
    title: "A safe reservation is approved",
    story:
      "Two alpha and two beta are free. A student asks for one of each. The campus can still complete every other reservation afterwards, so the request goes through.",
    available_before: before,
    available_after: outcome.available,
    decision: outcome.decision,
    reason: outcome.reason,
    safe: outcome.safe,
    safe_sequence: outcome.safe_sequence,
    allocation: localAllocationVector(r1),
    need: localNeedVector(r1),
  });

  // 2 — an unsafe reservation is blocked
  sandbox([{ type: "demo-alpha", units: 1 }, { type: "demo-beta", units: 1 }]);
  r1 = demoReservation("me", [
    { type: "demo-alpha", units: 1, max: 1 },
    { type: "demo-beta", units: 0, max: 1 },
  ], 0);
  scope = [r1.id];
  localTryGrant(r1, scope);
  r1.status = "approved";
  let r2 = demoReservation("them", [
    { type: "demo-alpha", units: 0, max: 1 },
    { type: "demo-beta", units: 1, max: 1 },
  ], 1);
  scope = [r1.id, r2.id];
  before = localAvailableVector(scope);
  outcome = localTryGrant(r2, scope);
  scenarios.push({
    scenario: "unsafe_blocked",
    title: "An unsafe reservation is blocked",
    story:
      "One alpha is held and its holder still needs a beta. Granting the waiting student that beta would leave the two of them waiting for each other forever, so the request is refused and the pool is left exactly as it was.",
    available_before: before,
    available_after: outcome.available,
    decision: outcome.decision,
    reason: outcome.reason,
    safe: outcome.safe,
    safe_sequence: outcome.safe_sequence,
    allocation: localAllocationVector(r2),
    need: localNeedVector(r2),
  });

  // 3 — resources are released when the rental finishes
  sandbox([{ type: "demo-alpha", units: 1 }, { type: "demo-beta", units: 1 }]);
  r1 = demoReservation("me", [{ type: "demo-alpha", units: 1, max: 1 }], 0);
  scope = [r1.id];
  localTryGrant(r1, scope);
  r1.status = "approved";
  before = localAvailableVector(scope);
  localRelease(r1.id, "completed");
  const after = localAvailableVector(scope);
  scenarios.push({
    scenario: "released",
    title: "Resources are released when the rental finishes",
    story:
      "The rental ends, so the alpha goes back into the pool and the available vector grows again. That is how the next student in the queue gets their turn.",
    available_before: before,
    available_after: after,
    decision: "released",
    reason: "the reservation was completed and its resources returned",
    safe: true,
    safe_sequence: localSafeSequence(after, scope).sequence,
    allocation: {},
    need: {},
  });

  // 4 — the safe sequence changes after an allocation
  sandbox([{ type: "demo-beta", units: 2 }]);
  r1 = demoReservation("me", [{ type: "demo-beta", units: 1, max: 2 }], 0);
  scope = [r1.id];
  localTryGrant(r1, scope);
  r1.status = "approved";
  r2 = demoReservation("them", [{ type: "demo-beta", units: 1, max: 1 }], 1);
  scope = [r1.id, r2.id];
  const seqBefore = localSafeSequence(localAvailableVector(scope), scope).sequence;
  outcome = localTryGrant(r2, scope);
  r2.status = "approved";
  scenarios.push({
    scenario: "sequence_changed",
    title: "The safe sequence changes after an allocation",
    story:
      "Before the second student was granted anything, the safe order finished the holder first. After the allocation the order changes, because the student who now holds a unit can finish first.",
    safe_sequence_before: seqBefore,
    safe_sequence_after: outcome.safe_sequence,
    available_before: outcome.available_before,
    available_after: outcome.available,
    decision: outcome.decision,
    reason: outcome.reason,
    safe: outcome.safe,
    allocation: localAllocationVector(r2),
    need: localNeedVector(r2),
  });

  // Leave the campus as it was.
  localReservations = localReservations.filter((r) => !r.is_demo);
  localTypes = seedLocalTypes();

  return { scenarios };
}

/* --------------------------------------------------------- the local seed */

function seedLocalTypes() {
  return RESERVE_TYPES.map((t) => ({
    slug: t.slug,
    label: t.label,
    unit_label: t.unit_label,
    category: t.category,
    description: t.description,
    sort: t.sort,
    units: RESERVE_UNITS.filter((u) => u.type === t.slug).map((u, i) => ({
      id: u.id || `${t.slug}-${i + 1}`,
      label: u.label,
      monthly_rate: u.monthly_rate,
      status: "available",
      reservation_id: null,
    })),
  }));
}

function localDashboard() {
  const types = localTypes
    .map((t) => {
      const allocated = localReservations
        .filter((r) => IN_PLAY.has(r.status))
        .reduce((sum, r) => sum + (r.demands[t.slug]?.allocated || 0), 0);
      return {
        slug: t.slug,
        label: t.label,
        unit_label: t.unit_label,
        category: t.category,
        total: t.units.length,
        allocated,
        available: Math.max(0, t.units.length - allocated),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const totals = types.reduce(
    (acc, t) => ({
      total: acc.total + t.total,
      allocated: acc.allocated + t.allocated,
      available: acc.available + t.available,
    }),
    { total: 0, allocated: 0, available: 0 }
  );

  const count = (pred) => localReservations.filter(pred).length;
  const counts = {
    pending: count((r) => r.status === "pending"),
    approved: count((r) => r.status === "approved" || r.status === "active"),
    blocked: count((r) => r.status === "blocked"),
    finished: count((r) => ["completed", "cancelled", "expired"].includes(r.status)),
    total: localReservations.length,
  };

  const available = localAvailableVector();
  const safe = localSafeSequence(available);

  const map = (r) => ({
    id: r.id,
    status: r.status,
    decision: r.decision,
    reason: r.reason,
    duration_days: r.duration_days,
    starts_at: r.starts_at ?? null,
    ends_at: r.ends_at ?? null,
    created_at: r.created_at,
    listing_id: null,
    mine: r.user_id === "local",
    allocation: localAllocationVector(r),
    need: localNeedVector(r),
    safe_sequence: r.safe_sequence ?? [],
  });

  return {
    totals,
    counts,
    types,
    available,
    safe: safe.safe,
    safe_sequence: safe.sequence,
    reservations: localReservations.map(map).reverse(),
    mine: localReservations.filter((r) => r.user_id === "local").map(map).reverse(),
    logs: localLog,
    expired: 0,
  };
}

/* -------------------------------------------------------------- rendering */

const STATUS_LABEL = {
  pending: "Waiting",
  approved: "Approved",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  blocked: "Blocked",
  expired: "Expired",
};

const VERDICT = {
  approved: { cls: "verdict-good", label: "Approved" },
  held: { cls: "verdict-fair", label: "Held — waiting for a unit" },
  blocked: { cls: "verdict-high", label: "Blocked — unsafe" },
};

function renderStats() {
  const d = dashboard;
  if (!d) return;
  $("#reserveTotal").textContent = d.totals.total;
  $("#reserveAllocated").textContent = d.totals.allocated;
  $("#reserveAvailable").textContent = d.totals.available;
  $("#reservePending").textContent = d.counts.pending;
  $("#reserveApproved").textContent = d.counts.approved;
  $("#reserveUnsafe").textContent = d.counts.blocked;
}

function renderTypes() {
  const rows = catalogue.types
    .map((t) => {
      const pct = t.total ? Math.round((t.allocated / t.total) * 100) : 0;
      const rate = RESERVE_TYPES.find((x) => x.slug === t.slug)?.monthly_rate;
      return `<article class="reserve-type" data-slug="${esc(t.slug)}">
        <div class="row-between">
          <strong>${esc(t.label)}</strong>
          <span class="reserve-free">${t.available} free</span>
        </div>
        <p class="fine">${esc(t.description || "")}</p>
        <div class="reserve-bar"><i style="--w:${pct}%"></i></div>
        <div class="fine reserve-type-meta">
          <span>${t.allocated} allocated</span><span>·</span><span>${t.total} total</span>
          ${rate ? `<span>·</span><span>₹${rate}/mo</span>` : ""}
        </div>
      </article>`;
    })
    .join("");
  $("#reserveTypes").innerHTML = rows;
}

function renderMatrix() {
  const rows = catalogue.types
    .map((t) => {
      return `<div class="reserve-matrix-row" data-slug="${esc(t.slug)}">
        <div class="reserve-matrix-name">
          <strong>${esc(t.label)}</strong>
          <span class="fine">${t.available} of ${t.total} free</span>
        </div>
        <label class="reserve-num">
          <span class="fine">Now</span>
          <input type="number" min="0" max="${t.total}" value="0" data-now="${esc(t.slug)}" aria-label="${esc(t.label)} — how many you need now" />
        </label>
        <label class="reserve-num">
          <span class="fine">At most</span>
          <input type="number" min="0" max="${t.total}" value="0" data-max="${esc(t.slug)}" aria-label="${esc(t.label)} — the most you may need" />
        </label>
      </div>`;
    })
    .join("");
  $("#reserveMatrix").innerHTML =
    rows +
    `<p class="fine reserve-matrix-note">
       <strong>Now</strong> is what you are asking for today. <strong>At most</strong> is the most you could ever need —
       the campus holds that back for you, and it is what makes the allocation safe for everybody else.
     </p>`;

  $$("#reserveMatrix [data-now]").forEach((input) => {
    input.addEventListener("input", () => {
      const slug = input.dataset.now;
      const maxInput = $(`#reserveMatrix [data-max="${slug}"]`);
      if (!maxInput) return;
      const now = Math.max(0, Number(input.value) || 0);
      if (Number(maxInput.value) < now) maxInput.value = now;
      const type = catalogue.types.find((t) => t.slug === slug);
      if (type && now > type.available) {
        input.setCustomValidity(`Only ${type.available} ${type.slug} are free right now.`);
      } else {
        input.setCustomValidity("");
      }
    });
  });
  $$("#reserveMatrix [data-max]").forEach((input) => {
    input.addEventListener("input", () => {
      const slug = input.dataset.max;
      const nowInput = $(`#reserveMatrix [data-now="${slug}"]`);
      if (!nowInput) return;
      const max = Math.max(0, Number(input.value) || 0);
      if (Number(nowInput.value) > max) nowInput.value = max;
    });
  });
}

function renderMine() {
  const mine = dashboard?.mine ?? [];
  if (!mine.length) {
    $("#reserveMine").innerHTML = `<p class="fine reserve-empty">No reservations yet. Pick what you need above and ask for it — the algorithm will tell you yes, hold, or no.</p>`;
    return;
  }
  $("#reserveMine").innerHTML = mine
    .map((r) => {
      const held = Object.entries(r.allocation)
        .map(([slug, n]) => `${n} ${slug}`)
        .join(" · ");
      const want = Object.entries(r.need)
        .filter(([, n]) => n > 0)
        .map(([slug, n]) => `${n} ${slug}`)
        .join(" · ");
      const live = ["pending", "approved", "active"].includes(r.status);
      return `<article class="reserve-item reserve-${esc(r.status)}" data-reservation="${esc(r.id)}">
        <div class="row-between">
          <strong>${esc(STATUS_LABEL[r.status] || r.status)}</strong>
          <span class="fine">${r.durationDays} day${r.durationDays === 1 ? "" : "s"}</span>
        </div>
        <p class="fine">${held ? `Holding ${esc(held)}` : "Holding nothing yet"}${want ? ` · still needs ${esc(want)}` : ""}</p>
        ${r.reason ? `<p class="fine reserve-reason">${esc(r.reason)}</p>` : ""}
        ${live ? `<div class="row-gap">
          <button class="btn btn-ghost" data-release="${esc(r.id)}" data-status="completed" type="button">Finish &amp; release</button>
          <button class="btn btn-ghost" data-release="${esc(r.id)}" data-status="cancelled" type="button">Cancel</button>
        </div>` : ""}
      </article>`;
    })
    .join("");
}

function renderVector() {
  const available = dashboard?.available ?? {};
  const types = dashboard?.types ?? [];
  $("#reserveVector").innerHTML = types
    .map((t) => {
      const free = available[t.slug] ?? t.available;
      return `<div class="reserve-vector-row">
        <span class="mono">${esc(t.slug)}</span>
        <span class="reserve-vector-bar"><i style="--w:${t.total ? Math.round((t.allocated / t.total) * 100) : 0}%"></i></span>
        <span class="fine">${t.allocated} / ${t.total} · <strong>${free} free</strong></span>
      </div>`;
    })
    .join("");
}

function renderSequence() {
  const seq = dashboard?.safe_sequence ?? [];
  const el = $("#reserveSequence");
  if (!seq.length) {
    el.innerHTML = `<li class="fine reserve-empty">No safe sequence — the campus cannot complete every reservation right now.</li>`;
    return;
  }
  el.innerHTML = seq
    .map((s, i) => `<li><span class="mono reserve-seq-n">${i + 1}</span> ${esc(s.label)}</li>`)
    .join("");
}

function renderLog() {
  const logs = dashboard?.logs ?? [];
  if (!logs.length) {
    $("#reserveLog").innerHTML = `<p class="fine reserve-empty">Nothing logged yet. Every decision UniReserve makes is written here.</p>`;
    return;
  }
  $("#reserveLog").innerHTML = logs
    .map((l) => {
      const req = Object.entries(l.request || {})
        .map(([slug, n]) => `${n} ${slug}`)
        .join(" · ");
      const alloc = Object.entries(l.allocation || {})
        .map(([slug, n]) => `${n} ${slug}`)
        .join(" · ");
      return `<div class="reserve-log-row">
        <span class="reserve-log-dot reserve-dot-${esc(l.decision || l.event)}"></span>
        <div>
          <strong>${esc(l.event)}</strong> ${l.decision ? `· ${esc(l.decision)}` : ""}
          <p class="fine">${req ? `Asked ${esc(req)}` : ""}${alloc ? ` · holding ${esc(alloc)}` : ""}</p>
        </div>
      </div>`;
    })
    .join("");
}

function renderEngine() {
  const pill = $("#reserveEngine");
  const note = $("#reserveEngineNote");
  if (engine === "server") {
    pill.textContent = "Engine · the server";
    pill.dataset.engine = "server";
    note.textContent =
      "Every decision below was made by the Banker's Algorithm running in the database, under a lock, so two students can never take the last unit at the same moment.";
  } else {
    pill.textContent = "Engine · on this device";
    pill.dataset.engine = "device";
    note.textContent =
      "There is no UniReserve server to talk to, so the same algorithm runs here instead — same vectors, same safety check, same safe sequence. Sign in to have the database decide instead.";
  }
}

function renderAll() {
  renderEngine();
  renderStats();
  renderTypes();
  renderMatrix();
  renderMine();
  renderVector();
  renderSequence();
  renderLog();
}

/* ------------------------------------------------------------ the actions */

function showOutcome(outcome) {
  const el = $("#reserveOutcome");
  if (!el) return;
  if (!outcome) {
    el.hidden = true;
    return;
  }
  const verdict = VERDICT[outcome.decision] ?? VERDICT.held;
  el.hidden = false;
  el.dataset.decision = outcome.decision;
  el.innerHTML = `<strong>${esc(verdict.label)}</strong>
    <p>${esc(outcome.reason || "")}</p>
    ${outcome.safe_sequence?.length ? `<p class="fine">Safe sequence: ${outcome.safe_sequence.length} reservation${outcome.safe_sequence.length === 1 ? "" : "s"} can still finish.</p>` : ""}`;
}

async function refresh() {
  if (engine === "server") {
    try {
      const raw = await SB.fetchReserveDashboard();
      dashboard = reserveDashboardFromRow(raw);
      return;
    } catch (err) {
      console.warn("[UniReserve] dashboard unavailable, running on the device:", err?.message);
      engine = "device";
    }
  }
  dashboard = reserveDashboardFromRow(localDashboard());
}

async function submitReservation(event) {
  event.preventDefault();
  const requests = [];
  for (const t of catalogue.types) {
    const now = Number($(`#reserveMatrix [data-now="${t.slug}"]`)?.value || 0);
    const max = Number($(`#reserveMatrix [data-max="${t.slug}"]`)?.value || 0);
    if (now > 0 || max > 0) requests.push({ type: t.slug, units: now, max: Math.max(now, max) });
  }
  if (!requests.length) {
    showOutcome({ decision: "held", reason: "Choose at least one resource first." });
    return;
  }

  const durationDays = Number($("#reserveDuration").value) || 7;
  const listingId = $("#reserveListing")?.value || null;

  if (engine === "server") {
    if (!SB.isSignedIn()) {
      onToast("Sign in with your college email to reserve campus resources.");
      document.querySelector("#signInBtn")?.click();
      return;
    }
    try {
      const result = await SB.requestReservation({ durationDays, requests, listingId });
      showOutcome(result);
      onToast(
        result.decision === "approved"
          ? "Reservation approved — the resources are yours."
          : result.decision === "held"
            ? "Held — you are in the queue and will be granted when a unit comes back."
            : "Blocked — the allocation would have left the campus unable to finish."
      );
      await refresh();
      renderAll();
      return;
    } catch (err) {
      console.warn("[UniReserve] request failed:", err?.message);
      showOutcome({ decision: "blocked", reason: err?.message || "The reservation could not be made." });
      return;
    }
  }

  const result = localRequest({ durationDays, requests });
  if (result.error) {
    showOutcome({ decision: "blocked", reason: result.error });
    return;
  }
  showOutcome(result);
  onToast(
    result.decision === "approved"
      ? "Reservation approved — the resources are yours."
      : result.decision === "held"
        ? "Held — you are in the queue and will be granted when a unit comes back."
        : "Blocked — the allocation would have left the campus unable to finish."
  );
  dashboard = reserveDashboardFromRow(localDashboard());
  renderAll();
}

async function releaseReservation(id, status) {
  if (engine === "server") {
    try {
      const result = await SB.releaseReservation(id, status);
      onToast(
        result?.released
          ? status === "cancelled"
            ? "Cancelled — the resources are back in the pool."
            : "Finished — the resources are back in the pool."
          : "That reservation was already closed."
      );
      await refresh();
      renderAll();
      return;
    } catch (err) {
      console.warn("[UniReserve] release failed:", err?.message);
      onToast(err?.message || "Could not release that reservation.");
      return;
    }
  }
  const result = localRelease(id, status);
  onToast(
    result?.released
      ? status === "cancelled"
        ? "Cancelled — the resources are back in the pool."
        : "Finished — the resources are back in the pool."
      : "That reservation was already closed."
  );
  dashboard = reserveDashboardFromRow(localDashboard());
  renderAll();
}

async function runDemo() {
  const btn = $("#reserveDemoBtn");
  btn.disabled = true;
  btn.textContent = "Running…";
  try {
    let payload = null;
    if (engine === "server" && SB.isSignedIn()) {
      try {
        payload = await SB.runReserveDemo();
      } catch (err) {
        console.warn("[UniReserve] demo unavailable on the server:", err?.message);
        payload = null;
      }
    }
    if (!payload) payload = localDemoScenarios();
    renderScenarios(payload.scenarios || []);
    onToast("Four worked examples, run by the Banker's Algorithm.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Run the examples";
  }
}

function renderScenarios(scenarios) {
  $("#reserveScenarios").innerHTML = scenarios
    .map((s, i) => {
      const verdict = VERDICT[s.decision] ?? { cls: "verdict-fair", label: s.decision };
      const before = Object.entries(s.available_before || {})
        .map(([k, v]) => `${v} ${k}`)
        .join(" · ");
      const after = Object.entries(s.available_after || {})
        .map(([k, v]) => `${v} ${k}`)
        .join(" · ");
      const seqBefore = (s.safe_sequence_before || []).map(() => "▸").join(" ");
      const seqAfter = (s.safe_sequence_after || []).map(() => "▸").join(" ");
      return `<article class="reserve-scenario" data-scenario="${esc(s.scenario)}">
        <div class="row-between">
          <span class="mono reserve-scenario-n">${i + 1}</span>
          <span class="verdict ${verdict.cls}">${esc(verdict.label)}</span>
        </div>
        <h4>${esc(s.title)}</h4>
        <p class="fine">${esc(s.story)}</p>
        <dl class="reserve-scenario-facts">
          <div><dt>Available before</dt><dd class="mono">${esc(before || "—")}</dd></div>
          <div><dt>Available after</dt><dd class="mono">${esc(after || "—")}</dd></div>
          ${
            s.safe_sequence_before
              ? `<div><dt>Safe sequence before</dt><dd class="mono">${esc(seqBefore || "—")}</dd></div>
                 <div><dt>Safe sequence after</dt><dd class="mono">${esc(seqAfter || "—")}</dd></div>`
              : `<div><dt>Safe sequence</dt><dd class="mono">${esc((s.safe_sequence || []).map(() => "▸").join(" ") || "—")}</dd></div>`
          }
          <div><dt>Reason</dt><dd>${esc(s.reason || "")}</dd></div>
        </dl>
      </article>`;
    })
    .join("");
}

/* ------------------------------------------------------------------- init */

export function initReserve({ toast, listings: listingList = [] } = {}) {
  onToast = toast || (() => {});
  listings = listingList;

  if (!bound) {
    bound = true;
    localTypes = seedLocalTypes();
    $("#reserveForm")?.addEventListener("submit", submitReservation);
    $("#reserveMine")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-release]");
      if (!btn) return;
      releaseReservation(btn.dataset.release, btn.dataset.status);
    });
    $("#reserveRefresh")?.addEventListener("click", async () => {
      await refresh();
      renderAll();
      onToast("UniReserve dashboard refreshed.");
    });
    $("#reserveDemoBtn")?.addEventListener("click", runDemo);
  }

  // The catalogue and the dashboard come from the server when it has the
  // UniReserve tables; otherwise the device keeps its own copy.
  (async () => {
    try {
      const [cat, dash] = await Promise.all([
        SB.fetchReserveCatalogue(),
        SB.fetchReserveDashboard(),
      ]);
      catalogue = reserveCatalogueFromRow(cat) || catalogue;
      dashboard = reserveDashboardFromRow(dash);
      engine = "server";
    } catch (err) {
      console.warn("[UniReserve] server unavailable, running on the device:", err?.message);
      engine = "device";
      catalogue = {
        types: localTypes.map((t) => ({
          slug: t.slug,
          label: t.label,
          unitLabel: t.unit_label,
          category: t.category,
          description: t.description,
          total: t.units.length,
          allocated: 0,
          available: t.units.length,
        })),
        units: [],
      };
      dashboard = reserveDashboardFromRow(localDashboard());
    }

    // A reservation can be made for a listing the marketplace already has.
    const rentListings = listings.filter((l) => l.type === "rent");
    const pick = $("#reserveListing");
    if (pick) {
      pick.innerHTML =
        `<option value="">No particular listing</option>` +
        rentListings
          .map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`)
          .join("");
    }

    renderAll();
  })();
}

export { RESERVE_TYPES, DURATIONS };
