// UniHaat — auth UI: sign in / sign up / Google, plus the profile menu.
// Presentation only; the data layer lives in src/supabase.js.

import {
  initAuth, signUp, signIn, signInWithGoogle, signOut,
  getUser, getProfile, getMode, isSignedIn, onAuthChange,
} from "./supabase.js";
import { COLLEGES } from "./data.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let authMode = "signin";
let profile = null;
let onSignedIn = () => {};

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
    const college = profile?.colleges?.short_name || profile?.college_id || "—";
    $("#menuCollege").textContent = `${college} · ${signedIn ? "Signed in" : ""}`;
    $("#menuDeals").textContent = profile?.deals_completed ?? 0;
    $("#menuSaved").textContent = profile?.items_reused ?? 0;
    $("#menuRating").textContent = profile?.rating_count
      ? (profile.rating_sum / profile.rating_count).toFixed(1)
      : "—";
    $("#menuVerify").textContent = profile?.verified ? "✓ Student verified" : "Verify as a student";
    $("#menuVerify").disabled = Boolean(profile?.verified);
  } else {
    $("#menuName").textContent = "Guest";
    $("#menuCollege").textContent = "Sign in to sync your listings";
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

  // Keep the tab ink aligned after fonts load / resize
  const repositionInk = () => setAuthMode(authMode);
  window.addEventListener("resize", repositionInk);
  if (document.fonts?.ready) document.fonts.ready.then(repositionInk);

  // React to Supabase auth events (including the OAuth redirect landing)
  onAuthChange(async (event) => {
    await refreshProfile();
    renderAuthState();
    if (event?.event === "SIGNED_IN") {
      closeAuth();
      onSignedIn({ event, profile });
    }
    if (event?.event === "SIGNED_OUT") {
      profile = null;
      renderAuthState();
      onSignedIn({ event, profile: null });
    }
  });

  return initAuth().then(async () => {
    await refreshProfile();
    renderAuthState();
    onSignedIn({ event: "INIT", profile });
  });
}

export async function refreshProfile() {
  const user = getUser();
  if (!user) { profile = null; return null; }
  try {
    profile = await getProfile(user.id);
  } catch (err) {
    console.warn("[UniHaat] profile fetch failed", err?.message);
    profile = null;
  }
  return profile;
}

export function getProfileData() { return profile; }
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
