// UniHaat — auth UI: sign in / sign up / Google, plus the profile menu.
// Presentation only; the data layer lives in src/supabase.js.

import {
  initAuth, signUp, signIn, signInWithGoogle, signOut,
  getUser, getSession, getProfile, updateProfile, fetchColleges,
  getMode, isSignedIn, onAuthChange,
} from "./supabase.js";
import { COLLEGES } from "./data.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let authMode = "signin";
let profile = null;
let onSignedIn = () => {};
// The session that has already been handed to the app, so a page that fires
// INITIAL_SESSION + SIGNED_IN + INIT does not sync three times.
let announcedSessionKey = null;
let profileLoadedFor = null;
let profilePromise = null;

/* -------------------------------------------------------------- oauth errors */

/**
 * Supabase sends a failed OAuth round-trip back as query (or hash) params.
 * Read them, clean the address bar and turn them into something a student
 * can act on — otherwise a denied consent screen fails silently.
 */
function readOAuthError() {
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const code = params.get("error_code") || params.get("error") || hash.get("error_code") || hash.get("error");
  if (!code) return null;
  const raw = params.get("error_description") || hash.get("error_description") || code;
  // Strip the URL so a refresh does not re-report the same failure.
  const clean = location.pathname + location.hash.replace(/[#&].*$/, "");
  history.replaceState(null, "", clean);
  return { code, message: describeOAuthError(code, raw) };
}

function describeOAuthError(code, raw) {
  const c = String(code).toLowerCase();
  if (c.includes("access_denied")) return "Google sign-in was cancelled — you weren't signed in.";
  if (c.includes("not_allowed") || c.includes("invalid_request"))
    return "That sign-in was blocked. Check the redirect URI in your Google OAuth settings.";
  if (c.includes("session_not_found") || c.includes("invalid_code"))
    return "That sign-in link has expired. Try Google sign-in again.";
  if (c.includes("server_error") || c.includes("temporarily_unavailable"))
    return "Google had a problem signing you in. Try again in a moment.";
  return raw ? `Google sign-in failed: ${raw}` : "Google sign-in failed. Try again.";
}

/** A stable identity for the current session, or null when signed out. */
function sessionKey() {
  const s = getSession();
  if (!s?.user?.id) return null;
  return `${s.user.id}:${s.access_token || ""}`;
}

/* ------------------------------------------------------------------ helpers */

function showError(message) {
  const el = $("#authError");
  el.textContent = message;
  el.hidden = !message;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label || "Working…";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function initials(name) {
  if (!name) return "A";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/* ------------------------------------------------------------ college picker */

const COLLEGE_PROMPTED = "uh-college-prompted";

/**
 * Google sign-up has no college step, so a Google student's profile is born
 * without one and campus-only discovery silently does nothing. Offer the
 * picker once, right after they land.
 */
function maybeAskForCollege() {
  if (!isSignedIn()) return;
  if (profile?.college_id) return;
  if (localStorage.getItem(COLLEGE_PROMPTED) === "1") return;
  localStorage.setItem(COLLEGE_PROMPTED, "1");
  openCollegePicker();
}

/** Fill the college select from the database, falling back to the seed list. */
async function populateColleges() {
  const select = $("#collegePick");
  if (!select) return;
  let rows = null;
  try {
    rows = await fetchColleges();
  } catch (err) {
    console.warn("[UniHaat] college lookup failed", err?.message);
  }
  if (rows?.length) {
    select.innerHTML =
      `<option value="">Select your college</option>` +
      rows.map((c) => `<option value="${c.id}" data-short="${c.short_name}">${c.name}</option>`).join("");
  } else {
    // Offline: the short name still identifies the college in the seed data.
    select.innerHTML =
      `<option value="">Select your college</option>` +
      COLLEGES.map((c) => `<option value="${c.short}" data-short="${c.short}">${c.label}</option>`).join("");
  }
}

export function openCollegePicker() {
  const overlay = $("#collegeOverlay");
  if (!overlay) return;
  populateColleges();
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#collegePick")?.focus(), 120);
}

function closeCollegePicker() {
  const overlay = $("#collegeOverlay");
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = "";
}

/* -------------------------------------------------------------------- modal */

function openAuth(mode = "signin") {
  setAuthMode(mode);
  showError("");
  $("#authOverlay").hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#authForm [name=email]")?.focus(), 120);
}

function closeAuth() {
  $("#authOverlay").hidden = true;
  document.body.style.overflow = "";
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $$(".auth-tab").forEach((t) => {
    const on = t.dataset.authtab === mode;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  // Slide the ink under the active tab
  const active = $(`.auth-tab[data-authtab="${mode}"]`);
  const ink = $("#authTabInk");
  if (active && ink) {
    ink.style.width = active.offsetWidth + "px";
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
  }
  $("#nameField").hidden = !signup;
  $("#collegeField").hidden = !signup;
  $("#authSubmit").textContent = signup ? "Create account" : "Sign in";
  $("#authForm [name=password]").setAttribute("autocomplete", signup ? "new-password" : "current-password");
  $("#authNote").textContent = signup
    ? "Your college is stored on your profile and powers campus-only discovery."
    : "Use the same college email you verified with.";
  showError("");
}

/* ------------------------------------------------------------------- render */

function renderAuthState() {
  const user = getUser();
  const signedIn = isSignedIn();

  $("#signInBtn").hidden = signedIn;
  $("#mSignInBtn").hidden = signedIn;
  $("#avatarBtn").hidden = !signedIn;

  renderSyncPill(signedIn);

  if (signedIn) {
    const name = profile?.full_name || user?.user_metadata?.full_name || user?.user_metadata?.name || "Student";
    const letter = initials(name);
    $("#avatarBtn").textContent = letter;
    $("#menuAvatar").textContent = letter;
    $("#menuName").textContent = name;
    const college = profile?.colleges?.short_name || profile?.college_id;
    $("#menuCollege").textContent = college ? `${college} · Signed in` : "No college set yet";
    $("#menuDeals").textContent = profile?.deals_completed ?? 0;
    $("#menuSaved").textContent = profile?.items_reused ?? 0;
    $("#menuRating").textContent = profile?.rating_count
      ? (profile.rating_sum / profile.rating_count).toFixed(1)
      : "—";
    $("#menuVerify").textContent = profile?.verified ? "✓ Student verified" : "Verify as a student";
    $("#menuVerify").disabled = Boolean(profile?.verified);
    // Google sign-in has no college step, so offer one until it is set.
    const needsCollege = !profile?.college_id;
    $("#menuCollegeBtn").hidden = !needsCollege;
    $("#menuCollegeBtn").textContent = profile?.colleges?.short_name
      ? `College: ${profile.colleges.short_name}`
      : "Choose your college";
  } else {
    $("#menuName").textContent = "Guest";
    $("#menuCollege").textContent = "Sign in to sync your listings";
    $("#menuCollegeBtn").hidden = true;
  }
}

/** Show whether the app is talking to Supabase or running on local state. */
export function renderSyncPill(signedIn) {
  const pill = $("#syncPill");
  const text = $("#syncText");
  if (!pill || !text) return;
  const live = getMode() === "live";
  pill.dataset.state = live ? "live" : "local";
  text.textContent = live ? (signedIn ? "Synced" : "Live") : "Local";
  pill.title = live
    ? "Connected to Supabase — your listings and wishlist are saved to the cloud"
    : "Local mode — sign in to save listings and wishlist to the cloud";
}

/** Briefly surface a transient state (e.g. "connecting") on the pill. */
export function setSyncState(state) {
  const pill = $("#syncPill");
  const text = $("#syncText");
  if (!pill || !text) return;
  pill.dataset.state = state;
  text.textContent = state === "connecting" ? "Connecting" : state === "live" ? "Live" : "Local";
}

/* ------------------------------------------------------------------- events */

export function initAuthUI({ onAuth } = {}) {
  onSignedIn = onAuth || (() => {});

  $("#authCollege").innerHTML =
    `<option value="">Select your college</option>` +
    COLLEGES.map((c) => `<option value="${c.short}">${c.label}</option>`).join("");

  $$(".auth-tab").forEach((t) => t.addEventListener("click", () => setAuthMode(t.dataset.authtab)));
  $("#authOverlay").addEventListener("click", (e) => { if (e.target.id === "authOverlay") closeAuth(); });

  $("#signInBtn").addEventListener("click", () => openAuth("signin"));
  $("#mSignInBtn").addEventListener("click", () => openAuth("signin"));

  // Google
  $("#googleBtn").addEventListener("click", async () => {
    showError("");
    const btn = $("#googleBtn");
    setBusy(btn, true, "Opening Google…");
    try {
      await signInWithGoogle();
      // On success the browser is redirected; this only runs on failure.
    } catch (err) {
      setBusy(btn, false);
      showError(describeError(err));
    }
  });

  // Email + password
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const form = e.target;
    const btn = $("#authSubmit");
    const payload = {
      email: form.email.value.trim(),
      password: form.password.value,
    };
    if (authMode === "signup") {
      payload.fullName = form.fullName.value.trim();
      payload.college = form.college.value;
      if (!payload.fullName) return showError("Please enter your name.");
      if (!payload.college) return showError("Please pick your college.");
      if (payload.password.length < 6) return showError("Password needs at least 6 characters.");
    }

    setBusy(btn, true, authMode === "signup" ? "Creating account…" : "Signing in…");
    setSyncState("connecting");
    try {
      if (authMode === "signup") await signUp(payload);
      else await signIn(payload);
      setBusy(btn, false);
      setSyncState("live");
      closeAuth();
      form.reset();
    } catch (err) {
      setBusy(btn, false);
      setSyncState("local");
      showError(describeError(err));
    }
  });

  // Profile menu
  const menu = $("#profileMenu");
  $("#avatarBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    $("#avatarBtn").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== $("#avatarBtn")) {
      menu.hidden = true;
      $("#avatarBtn").setAttribute("aria-expanded", "false");
    }
  });
  $("#signOutBtn").addEventListener("click", async () => {
    menu.hidden = true;
    try {
      await signOut();
    } catch (err) {
      console.warn("[UniHaat] sign out failed", err?.message);
    }
  });
  // Verification lives in the main app; the profile menu just opens it
  $("#menuVerify").addEventListener("click", () => {
    menu.hidden = true;
    $("#avatarBtn").setAttribute("aria-expanded", "false");
    document.getElementById("verifyBtn")?.click();
  });
  $("#menuCollegeBtn").addEventListener("click", () => {
    menu.hidden = true;
    $("#avatarBtn").setAttribute("aria-expanded", "false");
    openCollegePicker();
  });

  // College picker (the backdrop and the × button are wired globally in main.js)
  $("#collegeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = $("#collegePick").value;
    if (!value) return;
    const btn = $("#collegeForm button[type=submit]");
    btn.disabled = true;
    try {
      // The seed list yields a short name; the database yields a uuid.
      const patch = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)
        ? { college_id: value }
        : { college_short: value };
      if (patch.college_short) {
        // Resolve the short name to the college row the profile expects.
        const rows = await fetchColleges().catch(() => null);
        const match = rows?.find((c) => c.short_name === value);
        if (!match) throw new Error("college not found");
        patch.college_id = match.id;
        delete patch.college_short;
      }
      await updateProfile(patch);
      await refreshProfile({ force: true });
      renderAuthState();
      closeCollegePicker();
    } catch (err) {
      console.warn("[UniHaat] could not save college", err?.message);
      btn.disabled = false;
    }
  });

  // Keep the tab ink aligned after fonts load / resize
  const repositionInk = () => setAuthMode(authMode);
  window.addEventListener("resize", repositionInk);
  if (document.fonts?.ready) document.fonts.ready.then(repositionInk);

  // React to Supabase auth events (including the OAuth redirect landing)
  onAuthChange(async (event) => {
    await refreshProfile();
    renderAuthState();
    if (event?.event === "SIGNED_IN") closeAuth();
    if (event?.event === "SIGNED_OUT") {
      profile = null;
      profileLoadedFor = null;
      announcedSessionKey = null;
      renderAuthState();
      onSignedIn({ event, profile: null });
      return;
    }
    announceSession(event);
  });

  return initAuth().then(async () => {
    await refreshProfile();
    renderAuthState();
    announceSession("INIT");
    // A failed OAuth round-trip lands back here with an error in the URL.
    const oauthError = readOAuthError();
    if (oauthError) {
      openAuth("signin");
      showError(oauthError.message);
      return;
    }
    // Google sign-up has no college step — ask for one, once.
    maybeAskForCollege();
  });
}

/**
 * Hand the session to the app exactly once. Supabase fires INITIAL_SESSION
 * on subscribe and SIGNED_IN after the OAuth code exchange, so without this
 * guard the whole dataset is fetched twice on every Google sign-in.
 */
function announceSession(event) {
  const key = sessionKey();
  if (!key || key === announcedSessionKey) return;
  announcedSessionKey = key;
  onSignedIn({ event, profile });
}

export async function refreshProfile({ force = false } = {}) {
  const user = getUser();
  if (!user) { profile = null; profileLoadedFor = null; profilePromise = null; return null; }
  // Reuse the in-flight request — INITIAL_SESSION, SIGNED_IN and INIT can
  // all land within the same tick and would otherwise fetch three times.
  if (!force && profilePromise && profileLoadedFor === user.id) return profilePromise;
  profileLoadedFor = user.id;
  profilePromise = (async () => {
    try {
      profile = await getProfile(user.id);
    } catch (err) {
      console.warn("[UniHaat] profile fetch failed", err?.message);
      profile = null;
    }
    return profile;
  })();
  return profilePromise;
}

export function getProfileData() { return profile; }
export { renderAuthState };
export const authModeLabel = () => (getMode() === "live" ? "Synced with Supabase" : "Local mode — sign in to sync");

/** Turn Supabase errors into something a student can act on. */
function describeError(err) {
  const msg = err?.message || String(err);
  if (/invalid login credentials/i.test(msg)) return "That email and password combination doesn't match.";
  if (/already registered/i.test(msg)) return "That email already has an account — try signing in.";
  if (/password should be at least/i.test(msg)) return "Password needs at least 6 characters.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first — check your inbox.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Wait a moment and try again.";
  if (/fetch|network|Failed to fetch/i.test(msg)) return "Can't reach the server. Check your connection and retry.";
  if (/provider is not enabled/i.test(msg)) return "Google sign-in isn't enabled on this project yet.";
  return msg;
}

export { openAuth, closeAuth };
