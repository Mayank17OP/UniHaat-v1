// UniHaat — which college an address belongs to.
//
// The rule the database enforces is simple: an account may only exist on an
// address that belongs to one of the colleges in the `colleges` table. The
// browser has to know the same list, or the sign-up form would happily
// accept an address the server is about to reject.
//
// The list is fetched from the database, which is the list the server
// enforces. The copy in `data.js` is the offline fallback, so the app still
// works with no network.

import { COLLEGES } from "./data.js";

const seed = COLLEGES
  .filter((c) => c.domain)
  .map((c) => ({ short: c.short, label: c.label, domain: c.domain.toLowerCase() }));

let live = null;

/** Record the domains the database knows about. */
export function setCollegeDomains(rows) {
  const list = (rows || [])
    .map((r) => ({
      short: r.short_name,
      label: r.name,
      domain: (r.email_domain || "").toLowerCase(),
    }))
    .filter((c) => c.domain);
  if (list.length) live = list;
}

/** The colleges an account may belong to. The database copy wins. */
export function collegeDomains() {
  return live?.length ? live : seed;
}

/** The part of an address after the @, lower-cased. */
export function emailDomain(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return "";
  return value.slice(at + 1);
}

/**
 * The college that owns an address, or null.
 *
 * The match is by domain suffix, so a campus sub-domain counts as the same
 * college: `gn.amity.edu` is Amity. The dot matters — `x.dtu.ac.in` is a
 * DTU address but `notdtu.ac.in` is nobody's.
 */
export function collegeForEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return null;
  return (
    collegeDomains().find(
      (c) => domain === c.domain || domain.endsWith(`.${c.domain}`)
    ) || null
  );
}

/** Is this an address we accept? */
export function isCollegeEmail(email) {
  return Boolean(collegeForEmail(email));
}

/** What a student is told when their address is not a college one. */
export function collegeEmailRequiredMessage(email) {
  const domain = emailDomain(email);
  if (domain && !isCollegeEmail(email)) {
    return `${domain} is not a college address. Use your college email — for example you@dtu.ac.in.`;
  }
  return "Use your college email address — for example you@dtu.ac.in.";
}
