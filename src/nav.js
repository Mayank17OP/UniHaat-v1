// UniHaat — the navigation bar.
//
// The header is two tiers: the brand and the account actions on top, the
// nine destinations in a row underneath. Nothing here hides a section
// behind the hamburger on a desktop — the drawer is the phone fallback
// and nothing else.
//
// Emil's rules apply throughout: transform and opacity only, motion that
// answers an input instead of decorating it, and prefers-reduced-motion
// always wins.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

/* --------------------------------------------------------------- the drawer */

/**
 * Close the drawer.
 *
 * Leaving is a dismissal, so it is quicker than entering — 200ms against
 * 250ms. The class is only dropped once the exit animation has actually
 * run, otherwise the drawer would vanish mid-flight.
 */
export function closeMobileMenu() {
  const menu = $("#mobileMenu");
  const btn = $("#menuBtn");
  if (!menu || !btn) return;
  if (!menu.classList.contains("open")) return;

  btn.setAttribute("aria-expanded", "false");
  menu.classList.remove("open");
  if (reduced.matches) {
    menu.classList.remove("closing");
    return;
  }

  menu.classList.add("closing");
  const done = (e) => {
    if (e.target !== menu) return;
    menu.removeEventListener("animationend", done);
    menu.classList.remove("closing");
  };
  menu.addEventListener("animationend", done);
  // If the animation never runs — a hidden tab, a throttled frame — the
  // class must not be left behind to swallow the next open.
  setTimeout(() => menu.classList.remove("closing"), 400);
}

function openMobileMenu() {
  const menu = $("#mobileMenu");
  const btn = $("#menuBtn");
  if (!menu || !btn) return;
  menu.classList.remove("closing");
  menu.classList.add("open");
  btn.setAttribute("aria-expanded", "true");
}

/* ---------------------------------------------------------- the active section */

/**
 * Mark the section the reader is actually in.
 *
 * The marker is the underline on the destination row. It is driven by
 * scroll position rather than by an observer, because the sticky header
 * moves the line that decides "which section am I in" and only a
 * measurement knows where that line is right now.
 */
function initActiveSection(nav) {
  const links = $$(".nav-links-in a, #mobileMenu a");
  if (!links.length) return;

  const seen = new Set();
  const sections = [];
  for (const link of links) {
    const id = link.getAttribute("href")?.slice(1);
    const section = id ? document.getElementById(id) : null;
    if (!section || seen.has(section.id)) continue;
    seen.add(section.id);
    sections.push(section);
  }
  if (!sections.length) return;

  let ticking = false;
  const update = () => {
    ticking = false;
    const offset = nav.getBoundingClientRect().height + 12;
    let active = null;
    for (const section of sections) {
      if (section.getBoundingClientRect().top - offset <= 0) active = section;
      else break;
    }
    // A short final section may never reach the offset, so the bottom of
    // the page hands the marker to the last destination.
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atEnd) active = sections[sections.length - 1];

    for (const link of links) {
      const isActive = Boolean(active) && link.getAttribute("href") === `#${active.id}`;
      if (isActive) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };

  const schedule = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  update();
}

/* ------------------------------------------------------- the scrolled header */

/**
 * The header only grows a shadow once the page has moved. A bar that is
 * always shadowed claims to be floating above content it is not above.
 */
function initScrolledState(nav) {
  let ticking = false;
  const update = () => {
    ticking = false;
    nav.classList.toggle("is-scrolled", window.scrollY > 6);
  };
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

/* ------------------------------------------------------------------ set-up */

export function initNav() {
  const nav = $("#nav");
  if (!nav) return;

  const btn = $("#menuBtn");
  const menu = $("#mobileMenu");
  if (btn && menu) {
    btn.addEventListener("click", () => {
      if (menu.classList.contains("open")) closeMobileMenu();
      else openMobileMenu();
    });
    // Choosing a destination dismisses the drawer before it navigates.
    $$("#mobileMenu a").forEach((a) => a.addEventListener("click", () => closeMobileMenu()));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !menu.classList.contains("open")) return;
      closeMobileMenu();
      btn.focus();
    });
  }

  initActiveSection(nav);
  initScrolledState(nav);
}
