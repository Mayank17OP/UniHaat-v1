// UniHaat — auth UI: sign in / sign up / Google, plus the profile menu.
// Presentation only; the data layer lives in src/supabase.js.

import {
  initAuth, signUp, signIn, signInWithGoogle, signOut,
  getUser, getSession, getProfile, fetchColleges,
  getMode, isSignedIn, onAuthChange,
} from "./supabase.js";
import { COLLEGES } from "./data.js";
import { collegeForEmail, collegeEmailRequiredMessage, isCollegeEmail } from "./college-email.js";

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
  // The server refuses to open an account that is not on a college
  // address. It says so as a database error — the trigger on `auth.users`
  // raises, and GoTrue reports the failure without the reason — so the
  // wording is checked for.
  //
  // The message does not blame the student: a campus that is missing from
  // our list is our gap, not theirs.
  if (/college|database error/i.test(String(raw || "")))
    return "We couldn't open an account for that Google account. UniHaat only takes college email addresses — if your college isn't on our list yet, tell us and we'll add it.";
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

/* ------------------------------------------------------------ college campus */

/**
 * The campus a student belongs to.
 *
 * The address decides it — the database reads the college off the domain
 * when the account is created and keeps it there — so the picker is no
 * longer a choice. It shows what the address says, and it says why it
 * cannot be changed from here.
 */
async function populateColleges() {
  const select = $("#collegePick");
  if (!select) return;
  const rows = await fetchColleges().catch((err) => {
    console.warn("[UniHaat] college lookup failed", err?.message);
    return null;
  });
  const list = rows?.length
    ? rows.map((c) => ({ short: c.short_name, label: c.name }))
    : COLLEGES.map((c) => ({ short: c.short, label: c.label }));

  // The campus the account's own address resolves to.
  const mine = collegeForEmail(getUser()?.email);
  select.innerHTML =
    `<option value="">Select your college</option>` +
    list.map((c) => `<option value="${c.short}" data-short="${c.short}">${c.label}</option>`).join("");
  if (mine) select.value = mine.short;
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
  positionTabInk();
  $("#nameField").hidden = !signup;
  $("#collegeField").hidden = !signup;
  $("#authSubmit").textContent = signup ? "Create account" : "Sign in";
  $("#authForm [name=password]").setAttribute("autocomplete", signup ? "new-password" : "current-password");
  $("#authNote").textContent = signup
    ? "UniHaat only opens accounts on a college address — it powers campus-only discovery."
    : "Use the same college email you signed up with.";
  showError("");
}

/**
 * Slide the ink under the active tab.
 *
 * This is only the ink — it must not touch the error message. The ink is
 * positioned again when the web fonts finish loading, and a refused Google
 * sign-in must not have its message wiped by that.
 *
 * The ink is a transform, not a width: it spans the tab bar and is scaled
 * down to the active tab, so moving between tabs animates on the
 * compositor and costs no layout.
 */
function positionTabInk() {
  const active = $(`.auth-tab[data-authtab="${authMode}"]`);
  const ink = $("#authTabInk");
  if (!active || !ink) return;
  const bar = ink.parentElement;
  const barWidth = bar?.offsetWidth || 0;
  const scale = barWidth ? active.offsetWidth / barWidth : 0;
  ink.style.transform = `translateX(${active.offsetLeft}px) scaleX(${scale})`;
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
    const college =
      profile?.colleges?.short_name || profile?.college_id || collegeForEmail(user?.email)?.short;
    $("#menuCollege").textContent = college ? `${college} · Signed in` : "No college set yet";
    $("#menuDeals").textContent = profile?.deals_completed ?? 0;
    $("#menuSaved").textContent = profile?.items_reused ?? 0;
    $("#menuRating").textContent = profile?.rating_count
      ? (profile.rating_sum / profile.rating_count).toFixed(1)
      : "—";
    $("#menuVerify").textContent = profile?.verified ? "✓ Student verified" : "Verify as a student";
    $("#menuVerify").disabled = Boolean(profile?.verified);
    // The campus follows the address, so there is nothing to choose — the
    // button just says which one the address resolves to.
    const campus = profile?.colleges?.short_name || collegeForEmail(user?.email)?.short;
    $("#menuCollegeBtn").hidden = false;
    $("#menuCollegeBtn").textContent = campus ? `Campus: ${campus}` : "Campus: from your email";
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

/**
 * Point the college dropdown at the college the address belongs to.
 *
 * The server reads the college off the domain in any case, so this only
 * saves the student a click — and shows them the form understood them.
 */
function syncCollegeToEmail() {
  const form = $("#authForm");
  const select = $("#authCollege");
  if (!form || !select) return;
  const college = collegeForEmail(form.email.value);
  if (college) select.value = college.short;
}

/**
 * Fill the college picker.
 *
 * The list comes from the database, because the database is the list the
 * server enforces: a college added there has to be offered here too, or
 * the student cannot pick it and the sign-up form cannot be completed.
 * The copy in `data.js` is only the offline fallback.
 */
function renderCollegePicker(list) {
  const select = $("#authCollege");
  if (!select || !list?.length) return;
  select.innerHTML =
    `<option value="">Select your college</option>` +
    list.map((c) => `<option value="${c.short}">${c.label}</option>`).join("");
  // The address may already have named a college.
  syncCollegeToEmail();
}

export function initAuthUI({ onAuth } = {}) {
  onSignedIn = onAuth || (() => {});

  // A failed OAuth round-trip lands back here with an error in the URL.
  // It is read and shown straight away: the student should not have to
  // wait for the session and profile round-trips to learn that the
  // sign-in was refused.
  const oauthError = readOAuthError();

  renderCollegePicker(COLLEGES.map((c) => ({ short: c.short, label: c.label })));

  $("#authForm [name=email]").addEventListener("input", syncCollegeToEmail);

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
    // The campus comes from the address. There is nothing to save — a
    // student cannot put themselves on another campus by asking.
    closeCollegePicker();
  });

  // The refused sign-in is announced before the network round-trips, so
  // the student sees what happened straight away.
  if (oauthError) {
    openAuth("signin");
    showError(oauthError.message);
  }

  // Keep the tab ink aligned after fonts load / resize
  const repositionInk = () => positionTabInk();
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
    // The college list carries the mail domains the sign-up form checks
    // against, and it is the list the server enforces. The seed copy in
    // `data.js` is only the fallback; the database is the truth, so the
    // picker is refilled from it as soon as it arrives. A college added
    // to the database then appears without a redeploy.
    fetchColleges()
      .then((rows) => {
        if (!rows?.length) return;
        renderCollegePicker(rows.map((c) => ({ short: c.short_name, label: c.name })));
      })
      .catch(() => null);
    await refreshProfile();
    renderAuthState();
    announceSession("INIT");
    // The error was shown the moment the page booted. If a session did
    // come back after all, the modal has no business staying open.
    if (oauthError && isSignedIn()) closeAuth();
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
  // The server refuses to open an account that is not on a college address.
  // It says so as a database error, so the wording is checked for.
  if (/college_email_required|college.*address|college.*email/i.test(msg))
    return "UniHaat only takes college email addresses — sign up with the address your college gave you.";
  // The same refusal, said the way GoTrue says it. The trigger on
  // `auth.users` raises and the server reports the failure without the
  // reason, so the message is what the student is left with.
  if (/database error (saving|creating) new user/i.test(msg))
    return "We couldn't open an account for that address. UniHaat only takes college email addresses — if your college isn't on our list yet, tell us and we'll add it.";
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
