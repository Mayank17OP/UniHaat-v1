// UniHaat — persistence bridge.
//
// Maps Supabase rows onto the shape the UI already renders, and keeps local
// state in sync when a student signs in or out. Every call is best-effort:
// if the network is unavailable the app keeps working from local state.

import * as SB from "./supabase.js";
import { getProfileData } from "./auth.js";

/* ------------------------------------------------------------- row → model */

export function listingFromRow(row) {
  const seller = row.profiles || {};
  // A seller with no reviews has no star rating. Writing "5.0" for them
  // would claim a perfect score nobody gave — so the rating stays null and
  // the card says the seller is new.
  const rating = seller.rating_count
    ? Number((seller.rating_sum / seller.rating_count).toFixed(1))
    : null;
  const images = (row.listing_images || [])
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return {
    id: row.id,
    title: row.title,
    price: Number(row.price),
    original: Number(row.original_price ?? row.price),
    type: row.listing_type,
    category: row.category_slug,
    condition: row.condition,
    ageMonths: row.age_months,
    distance: Number(row.distance_km ?? 0.5),
    // Coordinates, when the listing has them. Without them there is no
    // honest distance to measure, and discovery sorts the listing last.
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    college: seller.colleges?.short_name ?? "Campus",
    scope: "same",
    seller: seller.full_name ?? "Student",
    rating,
    deals: seller.deals_completed ?? 0,
    img: images[0]?.url ?? "./assets/table-chair.svg",
    desc: row.description ?? "",
    accessories: row.accessories ?? "As described",
    repairs: row.repair_history ?? "None",
    battery: row.battery_health ? `${row.battery_health}%` : null,
    clearance: row.is_clearance,
    created: 0,
    live: true,
  };
}

export function demandFromRow(row) {
  const matches = (row.demand_matches || []).map((m) => ({
    listing_id: m.listing_id,
    score: Number(m.score),
    reasons: m.reasons || [],
  }));
  return {
    id: row.id,
    title: row.title,
    category: row.category_slug,
    budget: Number(row.budget_max ?? 0),
    college: row.colleges?.short_name ?? "Campus",
    neededBy: row.needed_by,
    user: row.profiles?.full_name ?? "Student",
    notes: row.notes ?? "",
    matches,
    live: true,
  };
}

/* ------------------------------------------------------------------- sync */

/** Pull the signed-in student's wishlist from Supabase. Returns the id list. */
export async function syncWishlist() {
  if (!SB.isSignedIn()) return null;
  try {
    const ids = await SB.fetchWishlist();
    return ids || [];
  } catch (err) {
    console.warn("[UniHaat] wishlist sync failed", err?.message);
    return null;
  }
}

/** Pull live listings and merge them over the local catalogue. */
export async function syncListings() {
  try {
    const rows = await SB.fetchListings();
    if (!rows) return null;
    return rows.map(listingFromRow);
  } catch (err) {
    console.warn("[UniHaat] listing sync failed", err?.message);
    return null;
  }
}

/** Pull open demands (with their UniMatch results). */
export async function syncDemands() {
  try {
    const rows = await SB.fetchDemands();
    if (!rows) return null;
    return rows.map(demandFromRow);
  } catch (err) {
    console.warn("[UniHaat] demand sync failed", err?.message);
    return null;
  }
}

/**
 * Pull the listings nearest to a point, nearest first.
 *
 * The server orders them; the browser measures the distance it shows
 * from the coordinates the rows carry. Falls back to the full catalogue
 * (sorted client-side) when the nearby query is unavailable, so a
 * network failure degrades to the old behaviour rather than an empty
 * marketplace.
 */
export async function syncNearbyListings(location, { radiusKm = null, limit = 50 } = {}) {
  if (!location) return null;
  try {
    const rows = await SB.fetchNearbyListings({
      lat: location.lat,
      lng: location.lng,
      radiusKm,
      limit,
    });
    if (!rows) return null;
    return rows.map(listingFromRow);
  } catch (err) {
    console.warn("[UniHaat] nearby listing sync failed", err?.message);
    return null;
  }
}

/** The signed-in student's saved location, or null. */
export async function syncMyLocation() {
  if (!SB.isSignedIn()) return null;
  try {
    return await SB.getMyLocation();
  } catch (err) {
    console.warn("[UniHaat] saved location sync failed", err?.message);
    return null;
  }
}

/** Persist the student's location to their profile (best-effort). */
export async function persistMyLocation(location) {
  if (!SB.isSignedIn() || !location) return null;
  try {
    return await SB.saveMyLocation({
      lat: location.lat,
      lng: location.lng,
      label: location.label || location.short || null,
    });
  } catch (err) {
    console.warn("[UniHaat] could not save location:", err?.message);
    return null;
  }
}

/** Clear the saved location from the profile (best-effort). */
export async function persistClearLocation() {
  if (!SB.isSignedIn()) return null;
  try {
    return await SB.clearMyLocation();
  } catch (err) {
    console.warn("[UniHaat] could not clear location:", err?.message);
    return null;
  }
}

/** Persist a newly published listing (and its image) to Supabase. */
export async function publishListing(listing) {
  if (!SB.isSignedIn()) return null;
  const profile = getProfileData();
  try {
    const row = await SB.createListing({
      seller_id: SB.getUser().id,
      title: listing.title,
      description: listing.desc,
      listing_type: listing.type,
      category_slug: listing.category,
      price: listing.type === "free" ? 0 : listing.price,
      original_price: listing.original,
      condition: listing.condition,
      age_months: listing.ageMonths,
      accessories: listing.accessories,
      repair_history: listing.repairs,
      college_id: profile?.college_id ?? null,
      distance_km: listing.distance,
      // Where the listing is picked up from. The seller's known location
      // at publish time, when there is one; the college gate otherwise.
      lat: listing.lat ?? null,
      lng: listing.lng ?? null,
      campus_area: profile?.colleges?.short_name ?? null,
      seller_attested: true,
      status: "active",
    });
    if (row) {
      await SB.addListingImage(row.id, listing.img, listing.title);
    }
    return row;
  } catch (err) {
    console.warn("[UniHaat] could not publish listing:", err?.message);
    return null;
  }
}

/** Persist a posted demand to Supabase. */
export async function publishDemand(demand) {
  if (!SB.isSignedIn()) return null;
  const profile = getProfileData();
  try {
    const row = await SB.createDemand({
      title: demand.title,
      notes: demand.notes,
      category_slug: demand.category,
      budget_max: demand.budget,
      college_id: profile?.college_id ?? null,
      needed_by: demand.neededBy || null,
    });
    return row;
  } catch (err) {
    console.warn("[UniHaat] could not post demand:", err?.message);
    return null;
  }
}

/** Add/remove a listing from the signed-in student's wishlist. */
export async function persistWishlist(listingId, saved) {
  if (!SB.isSignedIn()) return null;
  try {
    return saved ? await SB.addToWishlist(listingId) : await SB.removeFromWishlist(listingId);
  } catch (err) {
    console.warn("[UniHaat] wishlist write failed", err?.message);
    return null;
  }
}

/* ------------------------------------------------------------ UniReserve */

/**
 * A reservation row, as the interface wants it.
 *
 * The database keeps the matrices in their own tables; the browser wants
 * one object with the allocation, the need and the safe sequence already
 * worked out, so the interface never has to do arithmetic it should not.
 */
export function reservationFromRow(row) {
  const allocation = row.allocation ?? {};
  const need = row.need ?? {};
  return {
    id: row.id,
    status: row.status,
    decision: row.decision ?? null,
    reason: row.reason ?? null,
    durationDays: Number(row.duration_days ?? 0),
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    createdAt: row.created_at ?? null,
    listingId: row.listing_id ?? null,
    mine: Boolean(row.mine),
    allocation,
    need,
    safeSequence: Array.isArray(row.safe_sequence) ? row.safe_sequence : [],
    live: true,
  };
}

/**
 * The dashboard payload.
 *
 * The safe sequence comes back as a list of reservation ids; the interface
 * shows it as the order the campus can finish its reservations in, so the
 * ids are turned into short labels here.
 */
export function reserveDashboardFromRow(raw) {
  if (!raw) return null;
  const reservations = (raw.reservations ?? []).map(reservationFromRow);
  const mine = (raw.mine ?? []).map(reservationFromRow);
  const byId = new Map(reservations.map((r) => [r.id, r]));
  const label = (id) => {
    const r = byId.get(id);
    if (!r) return id.slice(0, 8);
    const held = Object.entries(r.allocation)
      .map(([slug, n]) => `${n} ${slug}`)
      .join(", ");
    return held || "waiting";
  };
  return {
    totals: raw.totals ?? { total: 0, allocated: 0, available: 0 },
    counts: raw.counts ?? { pending: 0, approved: 0, blocked: 0, finished: 0, total: 0 },
    types: raw.types ?? [],
    available: raw.available ?? {},
    safe: Boolean(raw.safe),
    safeSequence: (raw.safe_sequence ?? []).map((id) => ({ id, label: label(id) })),
    reservations,
    mine,
    logs: (raw.logs ?? []).map((l) => ({
      id: l.id,
      event: l.event,
      decision: l.decision,
      reason: l.reason,
      request: l.request ?? {},
      allocation: l.allocation ?? {},
      available: l.available ?? {},
      safeSequence: Array.isArray(l.safe_sequence) ? l.safe_sequence : [],
      createdAt: l.created_at,
    })),
    expired: Number(raw.expired ?? 0),
  };
}

/** The rentable catalogue, as the interface wants it. */
export function reserveCatalogueFromRow(raw) {
  if (!raw) return null;
  return {
    types: (raw.types ?? []).map((t) => ({
      slug: t.slug,
      label: t.label,
      unitLabel: t.unit_label ?? "unit",
      category: t.category ?? null,
      description: t.description ?? "",
      total: Number(t.total ?? 0),
      allocated: Number(t.allocated ?? 0),
      available: Number(t.available ?? 0),
    })),
    units: (raw.units ?? []).map((u) => ({
      id: u.id,
      label: u.label,
      type: u.type,
      typeLabel: u.type_label,
      monthlyRate: Number(u.monthly_rate ?? 0),
      status: u.status,
      listingId: u.listing_id ?? null,
    })),
  };
}
