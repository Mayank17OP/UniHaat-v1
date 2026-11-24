/**
 * Enables Google sign-in on the UniHaat Supabase project.
 *
 * Google OAuth needs a client ID and secret that only exist in the Google
 * Cloud Console (APIs & Services → Credentials → OAuth client ID → Web
 * application). This script pushes those into Supabase's auth config via the
 * Management API.
 *
 * Prerequisites:
 *   1. A Supabase personal access token:  https://supabase.com/dashboard/account/tokens
 *   2. A Google OAuth client ID + client secret with this authorised redirect URI:
 *        https://<project-ref>.supabase.co/auth/v1/callback
 *
 * Note: a Google account only opens a UniHaat account if its address belongs
 * to a college. The database enforces that (`guard_college_email()` on
 * `auth.users`), so a Google sign-in on a personal address is refused with
 * "Database error creating new user" — the app turns that into a message
 * telling the student to use their college account.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx \
 *   GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com \
 *   GOOGLE_CLIENT_SECRET=xxx \
 *   node scripts/configure-google-auth.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "gzbmqwvybcmxlsgouhyh";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const missing = [
  !TOKEN && "SUPABASE_ACCESS_TOKEN",
  !CLIENT_ID && "GOOGLE_CLIENT_ID",
  !CLIENT_SECRET && "GOOGLE_CLIENT_SECRET",
].filter(Boolean);

if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}\n`);
  console.error("Alternative (no token needed): open the Supabase dashboard →");
  console.error("  Authentication → Providers → Google → paste the client ID/secret");
  console.error("  and set the redirect URI to:");
  console.error(`    https://${PROJECT_REF}.supabase.co/auth/v1/callback`);
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    external_google_enabled: true,
    external_google_client_id: CLIENT_ID,
    external_google_secret: CLIENT_SECRET,
    external_google_skip_nonce_check: false,
  }),
});

if (!res.ok) {
  console.error(`Failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const config = await res.json();
console.log("✓ Google sign-in enabled");
console.log(`  client id: ${config.external_google_client_id}`);
console.log(`  enabled:   ${config.external_google_enabled}`);
console.log(`\n  Authorised redirect URI in Google Cloud Console:\n    https://${PROJECT_REF}.supabase.co/auth/v1/callback`);
