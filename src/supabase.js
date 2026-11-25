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
/**
 * The signed-in student's id, or null when nobody is signed in.
 *
 * The chat needs it to tell "my message" from "the other student's",
 * and the database needs it to write a message with a real sender.
 */
export const currentUserId = () => session?.user?.id ?? null;

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
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) {
    // The server has the last word on sign-in: it knows whether the
    // account exists. The browser's list of college domains is only a
    // hint — it is a copy, it can be behind the database, and a college
    // added there yesterday would be missing from it — so it must never
    // be allowed to lock a student out of an account the server would
    // open without complaint.
    //
    // When the address is not one of ours, though, no account can exist
    // for it: the sign-up guard refuses those. So that is the more
    // useful thing to say than "wrong password".
    if (!isCollegeEmail(email)) throw new Error(collegeEmailRequiredMessage(email));
    throw error;
  }
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

export async function fetchListings({ category, type, search, includeArchived = false } = {}) {
  const supa = getClient();
  if (!supa) return null;
  let query = supa
    .from("listings")
    // The seller is named through the listing's own foreign key. PostgREST
    // cannot pick that relationship on its own — `wishlists` reaches
    // `profiles` through the same pair of tables — so it has to be spelled
    // out, or the whole query fails with PGRST201.
    .select("*, listing_images(url, alt, sort, codec), profiles!listings_seller_id_fkey(id, full_name, avatar_url, rating_sum, rating_count, deals_completed, verified, colleges(short_name))")
    .order("created_at", { ascending: false });

  // Row level security already hides other people's taken-down listings,
  // so asking for them as well costs nothing and saves a second trip.
  query = includeArchived
    ? query.in("status", ["active", "archived"])
    : query.eq("status", "active");

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

/**
 * Attach a picture to a listing.
 *
 * `codec` says how the picture is stored. A 'url' picture is fetched
 * straight from the address. A 'huffman' picture is not a URL at all:
 * the address is a marker, and the browser fetches the compressed blob
 * and puts it back together before it can be shown.
 */
export async function addListingImage(listingId, url, alt, codec = "url") {
  const supa = getClient();
  if (!supa || !listingId || !url) return null;
  const { data, error } = await supa
    .from("listing_images")
    .insert({ listing_id: listingId, url, alt: alt || null, sort: 0, codec })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------ UniCompress */

/**
 * Store a listing image as a Huffman-compressed blob.
 *
 * The bytes go to the database as base64 in a JSON argument. PostgREST
 * takes `bytea` as a hex string, and base64 is what the browser can
 * produce without a second library — the server turns it into bytes.
 *
 * @param {{listingId: string, payload: string, tree: object, codeLengths: object,
 *          originalBytes: number, compressedBytes: number, mimeType: string,
 *          fileName: string, encodingMs: number, verified: boolean}} blob
 */
export async function putListingImageBlob(blob) {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("put_listing_image_blob", {
    p_listing_id: blob.listingId,
    // The argument is named for what it carries. The bytes travel as
    // base64 because PostgREST puts two hex characters on the wire
    // for every byte of a `bytea`, which is the opposite of the point.
    p_payload_base64: blob.payload,
    p_tree: blob.tree,
    p_code_lengths: blob.codeLengths,
    p_original_bytes: blob.originalBytes,
    p_compressed_bytes: blob.compressedBytes,
    p_mime_type: blob.mimeType,
    p_file_name: blob.fileName,
    p_encoding_ms: blob.encodingMs,
    p_verified: blob.verified,
  });
  if (error) throw error;
  return data;
}

/** Read a listing's compressed image back, tree and all. */
export async function getListingImageBlob(listingId) {
  const supa = getClient();
  if (!supa || !listingId) return null;
  const { data, error } = await supa.rpc("get_listing_image_blob", {
    p_listing_id: listingId,
  });
  if (error) throw error;
  return data;
}

/** Record a compression in the student's history. */
export async function recordCompression(entry) {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("record_compression", {
    p_file_name: entry.fileName,
    p_mime_type: entry.mimeType,
    p_original_bytes: entry.originalBytes,
    p_compressed_bytes: entry.compressedBytes,
    p_encoding_ms: entry.encodingMs,
    p_decoding_ms: entry.decodingMs,
    p_codec: entry.codec,
  });
  if (error) throw error;
  return data;
}

/** The student's own compression history, newest first. */
export async function fetchCompressionHistory(limit = 20) {
  const supa = getClient();
  if (!supa || !isSignedIn()) return [];
  const { data, error } = await supa.rpc("fetch_compression_history", {
    p_limit: limit,
  });
  if (error) throw error;
  return data ?? [];
}

/** What the campus has saved in total. */
export async function fetchCompressionTotals() {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.from("compression_totals").select("*").maybeSingle();
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

/* ----------------------------------------------------------- UniReserve */

/**
 * The rentable stock: what kinds of thing there are, how many of each,
 * and how many are free right now.
 *
 * The catalogue is a function rather than a table read because the counts
 * have to be the ones the server holds, not the ones the browser remembers.
 */
export async function fetchReserveCatalogue() {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("reserve_catalogue");
  if (error) throw error;
  return data;
}

/**
 * Everything the UniReserve dashboard shows: the totals, the counts, the
 * safe sequence and the reservation log.
 */
export async function fetchReserveDashboard() {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("reserve_dashboard");
  if (error) throw error;
  return data;
}

/**
 * Ask for a reservation.
 *
 * The decision is the server's: it runs the Banker's Algorithm, holds a
 * request it cannot satisfy and refuses one that would leave the campus
 * unable to finish. The browser never decides.
 */
export async function requestReservation({ durationDays = 7, requests = [], listingId = null } = {}) {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("reserve_request", {
    p_duration_days: durationDays,
    p_requests: requests,
    p_listing_id: listingId,
  });
  if (error) throw error;
  return data;
}

/** Give a reservation's resources back — the rental ended or was cancelled. */
export async function releaseReservation(reservationId, status = "completed") {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("reserve_release", {
    p_reservation: reservationId,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

/** Run the four worked examples of the Banker's Algorithm. */
export async function runReserveDemo() {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("reserve_demo_scenarios");
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- location discovery */

/**
 * Active listings nearest to a point, nearest first.
 *
 * The ordering is the server's: it measures the haversine against every
 * listing's coordinates, so the browser never has to page through the
 * whole catalogue to find what is close. `radiusKm` narrows the answer;
 * listings with no coordinates cannot be measured, so a radius excludes
 * them rather than guessing.
 */
export async function fetchNearbyListings({ lat, lng, radiusKm = null, limit = 50 } = {}) {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("nearby_listings", {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radiusKm,
    p_limit: limit,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Remember where this student is, so discovery survives a reload.
 *
 * The coordinates live on the student's own profile row, behind a
 * server function — the client has no direct grant on those columns,
 * and no other student can read them.
 */
export async function saveMyLocation({ lat, lng, label = null } = {}) {
  const supa = getClient();
  if (!supa) return null;
  const { error } = await supa.rpc("save_my_location", {
    p_lat: lat,
    p_lng: lng,
    p_label: label,
  });
  if (error) throw error;
  return true;
}

/** The student's saved location, or null when they have none. */
export async function getMyLocation() {
  const supa = getClient();
  if (!supa) return null;
  const { data, error } = await supa.rpc("get_my_location");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.lat == null || row.lng == null) return null;
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    label: row.label || "Your location",
    updatedAt: row.updated_at || null,
  };
}

/** Forget the saved location — the student asked not to be located. */
export async function clearMyLocation() {
  const supa = getClient();
  if (!supa) return null;
  const { error } = await supa.rpc("clear_my_location");
  if (error) throw error;
  return true;
}

/* ---------------------------------------------------- real-time chat */

export async function getOrCreateConversation({ listingId = null, buyerId, sellerId }) {
  const supa = getClient();
  if (!supa || !buyerId || !sellerId) return null;
  let q = supa
    .from("conversations")
    .select("*")
    .eq("buyer_id", buyerId)
    .eq("seller_id", sellerId);
  if (listingId) q = q.eq("listing_id", listingId);
  else q = q.is("listing_id", null);
  const { data: existing, error: selErr } = await q.maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing;

  const { data, error } = await supa
    .from("conversations")
    .insert({ listing_id: listingId, buyer_id: buyerId, seller_id: sellerId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function fetchConversations() {
  const supa = getClient();
  const uid = currentUserId();
  if (!supa || !uid) return [];
  const { data, error } = await supa
    .from("conversations")
    .select(`
      *,
      listings:listing_id (id, title, price),
      buyer:buyer_id (id, full_name),
      seller:seller_id (id, full_name)
    `)
    .or(`buyer_id.eq.${uid},seller_id.eq.${uid}`)
    .order("last_message_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMessages(conversationId) {
  const supa = getClient();
  if (!supa || !conversationId) return [];
  const { data, error } = await supa
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage({ conversationId, body }) {
  const supa = getClient();
  const uid = currentUserId();
  if (!supa || !uid || !conversationId) return null;
  const { data, error } = await supa
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: uid, body })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export function subscribeToMessages(conversationId, onMessage) {
  const supa = getClient();
  if (!supa || !conversationId) return () => {};
  const channel = supa
    .channel(`chat:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        if (payload?.new) onMessage(payload.new);
      },
    )
    .subscribe();
  return () => {
    supa.removeChannel(channel);
  };
}

/**
 * Watch every message the student is allowed to see.
 *
 * Row level security does the filtering: the stream only carries
 * messages from conversations the student is part of, so subscribing
 * to the whole table leaks nothing.
 */
export function subscribeToNewMessages(onMessage) {
  const supa = getClient();
  if (!supa) return () => {};
  const channel = supa
    .channel("chat:inbox")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        if (payload?.new) onMessage(payload.new);
      },
    )
    .subscribe();
  return () => {
    supa.removeChannel(channel);
  };
}

/**
 * The inbox: every conversation the student is part of.
 *
 * The database does the joining — the other party, the item, the last
 * message and the unread count come back in one row per conversation,
 * so the browser never has to stitch three tables together.
 */
export async function fetchConversationInbox() {
  const supa = getClient();
  if (!supa || !isSignedIn()) return [];
  const { data, error } = await supa.rpc("conversation_inbox");
  if (error) throw error;
  return data ?? [];
}

/** Mark the other side's messages as read. Returns how many were marked. */
export async function markConversationRead(conversationId) {
  const supa = getClient();
  if (!supa || !conversationId) return 0;
  const { data, error } = await supa.rpc("mark_conversation_read", {
    p_conversation: conversationId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * Withdraw a listing.
 *
 * The listing is archived rather than deleted: a completed SafeSwap
 * handover still points at it, and a row that vanishes takes its
 * history with it. Row level security only lets a student archive their
 * own listing, so this cannot be used on anybody else's.
 */
export async function archiveListing(listingId) {
  const supa = getClient();
  if (!supa || !listingId) return null;
  const { data, error } = await supa
    .from("listings")
    .update({ status: "archived" })
    .eq("id", listingId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Bring an archived listing back to the marketplace.
 *
 * The seller owns the row, and only the seller may do this — the policy
 * on the table allows an update only when the row belongs to the
 * student making it.
 */
export async function restoreListing(listingId) {
  const supa = getClient();
  if (!supa || !listingId) return null;
  const { data, error } = await supa
    .from("listings")
    .update({ status: "active" })
    .eq("id", listingId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * The seller's archived listings, taken from a listing fetch that
 * already asked for them.
 *
 * Asking the database twice for the same rows is a waste of a round
 * trip, and the marketplace sync is already fetching the rows.
 */
export function archivedFromRows(rows) {
  return (rows || [])
    .filter((row) => row.status === "archived")
    .map((row) => ({ id: row.id, title: row.title, price: Number(row.price ?? 0) }));
}

/** Mark a listing as sold, so it leaves the marketplace as a deal. */
export async function markListingSold(listingId) {
  const supa = getClient();
  if (!supa || !listingId) return null;
  const { data, error } = await supa
    .from("listings")
    .update({ status: "sold" })
    .eq("id", listingId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}
