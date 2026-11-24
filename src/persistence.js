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
  const rating = seller.rating_count
    ? (seller.rating_sum / seller.rating_count).toFixed(1)
    : "5.0";
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
    college: seller.colleges?.short_name ?? "Campus",
    scope: "same",
    seller: seller.full_name ?? "Student",
    rating: Number(rating),
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
