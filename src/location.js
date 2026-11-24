// UniHaat — location-based product discovery.
//
// The marketplace is hyperlocal, so "nearby" needs a real answer: how far
// is this listing from where the student actually is? This module is the
// whole of that answer —
//   · haversine distance between two coordinates,
//   · the device's location, when the browser offers it,
//   · a manual fallback for when it does not (permission denied, no GPS,
//     an old phone), and
//   · the stored location the app sorts and filters by.
//
// Privacy first: the device location is asked for, never taken. The
// student can refuse, and the refusal is a first-class path — the manual
// picker — not a dead end. The precise coordinates live in localStorage
// and, only when the student is signed in and has allowed it, on their
// own profile row through a server function. They are never shown to
// another student: a listing shows a distance, never a pin.

import { COLLEGES } from "./data.js";

const EARTH_KM = 6371;
const STORAGE_KEY = "uh-location";
/** Whether the "where are you" prompt has already been answered. */
const PROMPT_KEY = "uh-location-prompt";
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two {lat, lng} points. */
export function haversineKm(a, b) {
  if (!a || !b || !isFinite(a.lat) || !isFinite(a.lng) || !isFinite(b.lat) || !isFinite(b.lng)) {
    return null;
  }
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A distance the way a card shows it: "0.4 km", "2.1 km". */
export function formatDistance(km) {
  if (km == null || !isFinite(km)) return "—";
  if (km < 0.05) return "On campus";
  return `${km.toFixed(1)} km`;
}

/** True when the value looks like a usable coordinate pair. */
export function isValidCoords(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/* ------------------------------------------------------- manual locations */

/**
 * The places a student can pick by hand.
 *
 * The colleges come first — most students are standing on one of them —
 * then the Delhi areas students actually live in. Each entry carries the
 * coordinates the distance maths runs on, so picking "DTU" and granting
 * GPS at the DTU gate give the same answer.
 */
export const MANUAL_LOCATIONS = [
  ...COLLEGES.map((c) => ({
    id: `college:${c.short}`,
    label: `${c.short} · ${c.label}`,
    short: c.short,
    lat: c.lat,
    lng: c.lng,
    kind: "college",
  })),
  { id: "area:north-campus", label: "North Campus, DU", short: "North Campus", lat: 28.686, lng: 77.211, kind: "area" },
  { id: "area:south-campus", label: "South Campus, DU", short: "South Campus", lat: 28.556, lng: 77.166, kind: "area" },
  { id: "area:hauz-khas", label: "Hauz Khas Village", short: "Hauz Khas", lat: 28.553, lng: 77.195, kind: "area" },
  { id: "area:connaught-place", label: "Connaught Place", short: "Connaught Place", lat: 28.631, lng: 77.219, kind: "area" },
  { id: "area:dwarka", label: "Dwarka", short: "Dwarka", lat: 28.585, lng: 77.05, kind: "area" },
  { id: "area:rohini", label: "Rohini", short: "Rohini", lat: 28.749, lng: 77.056, kind: "area" },
  { id: "area:jamia-nagar", label: "Jamia Nagar", short: "Jamia Nagar", lat: 28.516, lng: 77.279, kind: "area" },
  { id: "area:noida-62", label: "Noida Sector 62", short: "Noida Sector 62", lat: 28.613, lng: 77.37, kind: "area" },
  { id: "area:mayur-vihar", label: "Mayur Vihar", short: "Mayur Vihar", lat: 28.608, lng: 77.287, kind: "area" },
  { id: "area:laxmi-nagar", label: "Laxmi Nagar", short: "Laxmi Nagar", lat: 28.63, lng: 77.277, kind: "area" },
];

export function manualLocationById(id) {
  return MANUAL_LOCATIONS.find((m) => m.id === id) || null;
}

/* --------------------------------------------------------- stored location */

/**
 * The location the app is currently discovering from, or null.
 *
 * Shape: { lat, lng, label, short, source, accuracy?, updatedAt }
 *   source: "device" (GPS) | "manual" (picked) | "server" (restored)
 */
export function getStoredLocation() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const loc = JSON.parse(raw);
    if (!isValidCoords(loc?.lat, loc?.lng)) return null;
    return loc;
  } catch {
    return null;
  }
}

export function setStoredLocation(loc) {
  if (!loc || !isValidCoords(loc.lat, loc.lng)) return null;
  const stored = {
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    label: loc.label || "Your location",
    short: loc.short || loc.label || "Your location",
    source: loc.source || "manual",
    accuracy: loc.accuracy ?? null,
    updatedAt: loc.updatedAt || Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* storage full or blocked — the in-memory copy still works */
  }
  return stored;
}

/**
 * Remember where the student is.
 *
 * The same act as `setStoredLocation`, under the name the rest of the
 * app uses. Both are exported so neither caller has to be changed.
 */
export function saveStoredLocation(loc) {
  return setStoredLocation(loc);
}

export function clearStoredLocation() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    // Clearing the location puts the student back where they started,
    // so the prompt is allowed to come round again.
    localStorage.removeItem(PROMPT_KEY);
  } catch {
    /* nothing to clear */
  }
}

/* ------------------------------------------------------- the location prompt */

/**
 * Whether the student has already been asked where they are.
 *
 * The prompt appears once. Asking again on every page load is the kind
 * of thing that makes a student close the tab, so the answer is kept
 * until they clear their location, which resets it.
 */
export function hasLocationPromptBeenHandled() {
  try {
    return localStorage.getItem(PROMPT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remember that the student has been asked. */
export function markLocationPromptHandled() {
  try {
    localStorage.setItem(PROMPT_KEY, "1");
  } catch {
    /* storage blocked — the prompt simply comes back next time */
  }
}

/* ------------------------------------------------------------ device GPS */

/** Whether the browser can offer a device location at all. */
export function isGeolocationSupported() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * Ask the device where the student is.
 *
 * Resolves with { lat, lng, accuracy }. Rejects with an Error whose
 * `code` is the GeolocationPositionError code (1 = denied, 2 =
 * unavailable, 3 = timed out), so the caller can tell "the student said
 * no" from "the phone could not tell".
 */
export function requestDeviceLocation({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      const err = new Error("This browser cannot share a location.");
      err.code = 2;
      err.name = "LocationUnavailableError";
      reject(err);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords || {};
        if (!isValidCoords(latitude, longitude)) {
          const err = new Error("The device returned an unusable location.");
          err.code = 2;
          reject(err);
          return;
        }
        resolve({ lat: latitude, lng: longitude, accuracy: accuracy ?? null });
      },
      (geoErr) => {
        const err = new Error(geoErr?.message || "Location unavailable.");
        err.code = geoErr?.code ?? 2;
        err.name = "LocationError";
        reject(err);
      },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    );
  });
}

/* ------------------------------------------------------- distance maths */

/**
 * The listing's coordinates, or null when the listing has none.
 *
 * A listing carries its own lat/lng when the seller's location was known
 * at publish time. Older listings only have a stored `distance` — a
 * number that was true for somebody, once — so without coordinates there
 * is no honest distance to show and the caller falls back to it.
 */
export function listingCoords(product) {
  if (!product) return null;
  if (isValidCoords(product.lat, product.lng)) {
    return { lat: Number(product.lat), lng: Number(product.lng) };
  }
  // A live listing may carry its college's gate coordinates instead.
  const college = COLLEGES.find((c) => c.short === product.college);
  if (college && isValidCoords(college.lat, college.lng)) {
    return { lat: college.lat, lng: college.lng };
  }
  return null;
}

/**
 * How far this listing is from `from`, in kilometres — or null when
 * either side has no coordinates to measure between.
 */
export function distanceForProduct(product, from) {
  if (!from) return null;
  const coords = listingCoords(product);
  if (!coords) return null;
  return haversineKm(from, coords);
}

/**
 * The distance a card should show for this listing.
 *
 * With a known location the measured distance wins. Without one, the
 * listing's stored distance is all there is — it is shown as before, so
 * browsing without a location looks exactly as it always did.
 */
export function displayDistance(product, from) {
  const measured = distanceForProduct(product, from);
  if (measured != null) return measured;
  return typeof product?.distance === "number" ? product.distance : null;
}

/**
 * A copy of the list with `distance` replaced by the measured one.
 *
 * The rest of the app reads `p.distance` everywhere (cards, the detail
 * modal, UniMatch), so the measured distance is written back onto the
 * product rather than carried alongside it.
 */
export function applyDistances(products, from) {
  if (!from) return products;
  return products.map((p) => {
    const measured = distanceForProduct(p, from);
    return measured == null ? p : { ...p, distance: measured };
  });
}

/** Nearest first. Listings with no measurable distance go last. */
export function sortByDistance(products, from) {
  return [...products].sort((a, b) => {
    const da = distanceForProduct(a, from);
    const db = distanceForProduct(b, from);
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });
}

/** Keep only listings within `radiusKm` of `from`. */
export function withinRadius(products, from, radiusKm) {
  if (!from || !radiusKm || radiusKm <= 0) return products;
  return products.filter((p) => {
    const d = distanceForProduct(p, from);
    return d != null && d <= radiusKm;
  });
}

/** A short label for a device fix — coordinates, rounded for display. */
export function deviceLabel(lat, lng) {
  return `Near ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}
