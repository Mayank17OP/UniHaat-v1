// UniHaat — Supabase data layer.
//
// Every helper degrades gracefully: if Supabase is unreachable or not
// configured, the app falls back to the local in-memory/localStorage store so
// the prototype always renders. `mode` tells the UI which path it is on.

import { CONFIG, isSupabaseConfigured } from "./config.js";
import { isCollegeEmail, collegeEmailRequiredMessage, setCollegeDomains } from "./college-email.js";

const listeners = new Set();
let client = null;
let session = null;
let mode = "local"; // "local" | "live"

const HINT = "uh-hint";

/* ------------------------------------------------------------------ client */

function getClient() {
  if (client) return client;
  if (!isSupabaseConfigured()) return null;
  if (typeof window === "undefined" || !window.supabase) return null;
  client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  return client;
}

/* ------------------------------------------------------------------- state */

export const getMode = () => mode;
export const getSession = () => session;
export const getUser = () => session?.user ?? null;
export const isSignedIn = () => Boolean(session?.user);

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(event) {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch (err) {
      console.error("[UniHaat] auth listener failed", err);
    }
  });
}

/* -------------------------------------------------------------------- auth */

export async function initAuth() {
  const supa = getClient();
  if (!supa) {
    mode = "local";
    return null;
  }
  try {
    // Never let a slow or unreachable auth server hold up the first paint.
    const { data, error } = await withTimeout(
      supa.auth.getSession(),
      4000,
      "auth session timed out"
    );
    if (error) throw error;
    session = data.session;
    mode = session ? "live" : "local";

    supa.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession;
      mode = nextSession ? "live" : "local";
      emit({ event, session: nextSession });
    });
    return session;
  } catch (err) {
    console.warn("[UniHaat] Supabase unreachable, running in local mode:", err?.message);
    mode = "local";
    return null;
  }
}

/** Reject a promise that takes longer than `ms`. */
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/**
 * The colleges whose addresses may open an account.
 *
 * The database is the list the server enforces, so it is the list the
 * browser checks against too. The check happens here rather than in the
 * form because a student should not have to fill in a form only to be
 * told the address is wrong.
 */
function assertCollegeEmail(email) {
  if (!isCollegeEmail(email)) throw new Error(collegeEmailRequiredMessage(email));
}

export async function signUp({ email, password, fullName, college }) {
  const supa = getClient();
  if (!supa) throw new Error("Supabase is not configured for this deployment.");
  assertCollegeEmail(email);
  const { data, error } = await supa.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        college,
        // The signup trigger links the college by short name.
        college_short: college,
        avatar_url: null,
      },
    },
  });
  if (error) throw error;
  session = data.session;
  mode = session ? "live" : "local";
  return data;
}

export async function signIn({ email, password }) {
  const supa = getClient();
  if (!supa) throw new Error("Supabase is not configured for this deployment.");
  assertCollegeEmail(email);
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  session = data.session;
  mode = session ? "live" : "local";
  return data;
}

export async function signInWithGoogle() {
  const supa = getClient();
  if (!supa) throw new Error("Supabase is not configured for this deployment.");
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { data, error } = await supa.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      // GoTrue already requests an offline token for Google. Forcing
      // `prompt=consent` on top of that makes Google show the consent
      // screen on *every* sign-in, which returning students notice
      // immediately — so only the offline flag is passed through.
      queryParams: { access_type: "offline" },
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supa = getClient();
  if (!supa) return;
  const { error } = await supa.auth.signOut();
  if (error) throw error;
  session = null;
  mode = "local";
}

/* ---------------------------------------------------------------- profiles */

/**
 * The columns a client may read from `profiles`.
 *
 * The database grants the profile read column by column, and `email`,
 * `student_id` and `role` are deliberately not on that list — they are the
 * private and the privileged parts of a profile. Asking for `*` would ask
 * for those columns too and the server would reject the whole query, so
 * the app names the fields it renders instead.
 */
const PROFILE_FIELDS = [
  "id",
  "full_name",
  "avatar_url",
  "college_id",
  "department",
  "year_of_study",
  "bio",
  "verified",
  "verified_at",
  "rating_sum",
  "rating_count",
  "deals_completed",
  "saved_rupees",
  "items_reused",
  "items_given",
  "created_at",
  "updated_at",
].join(", ");

export async function getProfile(userId) {
  const supa = getClient();
  if (!supa || !userId) return null;
  const { data, error } = await supa
    .from("profiles")
    .select(`${PROFILE_FIELDS}, colleges(id, short_name, name)`)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(patch) {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa
    .from("profiles")
    .update(patch)
    .eq("id", getUser()?.id)
    .select(PROFILE_FIELDS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * The college reference data — short name ↔ id, needed to set a college.
 *
 * `email_domain` comes along because it is the list of addresses the
 * server will accept, and the sign-up form has to check against the same
 * one.
 */
export async function fetchColleges() {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa
    .from("colleges")
    .select("id, short_name, name, email_domain")
    .order("name");
  if (error) throw error;
  setCollegeDomains(data);
  return data ?? [];
}

/**
 * Ask the server to verify this student.
 *
 * `verified` is a server-owned column — students may not write it directly
 * (that would let anyone claim "verified student" and inflate their own
 * rating), so the request goes through a SECURITY DEFINER function.
 */
export async function claimVerification({ college, studentId } = {}) {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("claim_student_verification", {
    p_college_short: college || null,
    p_student_id: studentId || null,
  });
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------------------- listings */

export async function fetchListings({ category, type, search } = {}) {
  const supa = getClient();
  if (!supa) return null;
  let query = supa
    .from("listings")
    // The seller is named through the listing's own foreign key. PostgREST
    // cannot pick that relationship on its own — `wishlists` reaches
    // `profiles` through the same pair of tables — so it has to be spelled
    // out, or the whole query fails with PGRST201.
    .select("*, listing_images(url, alt, sort), profiles!listings_seller_id_fkey(id, full_name, avatar_url, rating_sum, rating_count, deals_completed, verified, colleges(short_name))")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (category && category !== "all") query = query.eq("category_slug", category);
  if (type && type !== "all") query = query.eq("listing_type", type);
  if (search) query = query.ilike("title", `%${search}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createListing(listing) {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa
    .from("listings")
    .insert(listing)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function addListingImage(listingId, url, alt) {
  const supa = getClient();
  if (!supa || !listingId || !url) return null;
  const { data, error } = await supa
    .from("listing_images")
    .insert({ listing_id: listingId, url, alt: alt || null, sort: 0 })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------------------- wishlist */

export async function fetchWishlist() {
  const supa = getClient();
  const userId = getUser()?.id;
  if (!supa || !userId) return null;
  const { data, error } = await supa
    .from("wishlists")
    .select("listing_id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.listing_id);
}

export async function addToWishlist(listingId) {
  const supa = getClient();
  const userId = getUser()?.id;
  if (!supa || !userId) return null;
  const { error } = await supa.from("wishlists").insert({ user_id: userId, listing_id: listingId });
  if (error && error.code !== "23505") throw error; // already saved is fine
  return listingId;
}

export async function removeFromWishlist(listingId) {
  const supa = getClient();
  const userId = getUser()?.id;
  if (!supa || !userId) return null;
  const { error } = await supa.from("wishlists").delete().eq("user_id", userId).eq("listing_id", listingId);
  if (error) throw error;
  return listingId;
}

/* ----------------------------------------------------------------- demands */

export async function fetchDemands() {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa
    .from("demands")
    .select("*, colleges(short_name), profiles(id, full_name), demand_matches(listing_id, score, reasons)")
    // 'matched' demands still belong on the board — that is the good news.
    .in("status", ["open", "matched"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createDemand(demand) {
  const supa = getClient();
  const userId = getUser()?.id;
  if (!supa || !userId) return null;
  const { data, error } = await supa
    .from("demands")
    .insert({ ...demand, user_id: userId })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------- transactions */

export async function createTransaction(txn) {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa
    .from("transactions")
    .insert(txn)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateTransaction(id, patch) {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------------- misc */

export const hint = (text) => {
  const el = document.querySelector(`[data-hint="${HINT}"]`);
  if (el) el.textContent = text;
};
