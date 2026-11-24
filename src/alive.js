// UniHaat — the "alive" layer.
//
// Emil Kowalski's principles, applied as reusable primitives:
//   • animate transform and opacity only — never layout properties
//   • springs for anything the finger touches, ease-out for anything ambient
//   • motion is a response to input, not decoration
//
// Everything here respects prefers-reduced-motion.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const canAnimate = () => !reduced.matches;

/* ------------------------------------------------------------- scroll bar */

export function initScrollProgress() {
  const bar = $("#scrollProgress");
  if (!bar) return;
  const fill = bar.firstElementChild;
  let ticking = false;
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    fill.style.transform = `scaleX(${p})`;
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
}

/* ------------------------------------------------------------ card reveal */

/**
 * Stagger the marketplace grid as it scrolls into view.
 * Cards fade + rise together but with an incremental delay, so the grid
 * reads as one object arriving rather than a pile of independent animations.
 */
export function initCardStagger(container, itemSelector = ".card") {
  if (!container) return;
  const items = $$(itemSelector, container);
  if (!items.length) return;

  if (!canAnimate()) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const index = Number(entry.target.dataset.staggerIndex ?? 0);
      entry.target.style.transitionDelay = `${Math.min(index, 11) * 45}ms`;
      entry.target.classList.add("in");
      io.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

  items.forEach((el, i) => {
    el.dataset.staggerIndex = i;
    el.classList.add("stagger");
    io.observe(el);
  });
}

/* ---------------------------------------------------------------- hearts */

/** Spring-pop the heart and throw a few particles when a listing is saved. */
export function burstHeart(button) {
  if (!button || !canAnimate()) return;
  button.classList.remove("pop");
  void button.offsetWidth; // restart the animation
  button.classList.add("pop");

  const colors = ["#FF4D1C", "#FFB81C", "#0E4D2E"];
  const rect = button.getBoundingClientRect();
  for (let i = 0; i < 6; i++) {
    const spark = document.createElement("i");
    spark.className = "heart-spark";
    spark.style.left = rect.left + rect.width / 2 + "px";
    spark.style.top = rect.top + rect.height / 2 + "px";
    spark.style.background = colors[i % colors.length];
    const angle = (Math.PI * 2 * i) / 6 + Math.random();
    const dist = 16 + Math.random() * 14;
    spark.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    spark.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    document.body.appendChild(spark);
    setTimeout(() => spark.remove(), 620);
  }
}

/* -------------------------------------------------------------- magnetic */

/** Primary buttons lean toward the cursor — a small, physical invitation. */
export function initMagnetic(selector = ".btn-primary, .btn-ghost") {
  if (!canAnimate()) return;
  const items = $$(selector);
  items.forEach((el) => {
    let raf = null;
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate(${dx * 5}px, ${dy * 3}px)`;
      });
    });
    el.addEventListener("pointerleave", () => {
      if (raf) cancelAnimationFrame(raf);
      el.style.transform = "";
    });
  });
}

/* -------------------------------------------------------------- tilt */

/**
 * A whisper of depth on listing cards. The tilt is tiny (max ~4°) so the grid
 * stays flat and calm — it should read as a card being lifted, not a gimmick.
 */
export function initTilt(selector = ".card") {
  if (!canAnimate()) return;
  if (window.matchMedia("(hover: none)").matches) return;

  $$(selector).forEach((card) => {
    let raf = null;
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        card.style.setProperty("--tilt-x", `${(-py * 4).toFixed(2)}deg`);
        card.style.setProperty("--tilt-y", `${(px * 4).toFixed(2)}deg`);
        card.style.setProperty("--glow-x", `${((px + 0.5) * 100).toFixed(1)}%`);
        card.style.setProperty("--glow-y", `${((py + 0.5) * 100).toFixed(1)}%`);
      });
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
    });
  });
}

/* ------------------------------------------------------- number roll */

/**
 * Roll a number up to its value. Used for prices so the eye is drawn to the
 * number that matters on a listing.
 */
export function rollNumber(el, to, { prefix = "", suffix = "", duration = 700 } = {}) {
  if (!el) return;
  const from = 0;
  if (!canAnimate()) {
    el.textContent = prefix + Number(to).toLocaleString("en-IN") + suffix;
    return;
  }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = prefix + Math.round(from + (to - from) * eased).toLocaleString("en-IN") + suffix;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* --------------------------------------------------------- type reveal */

/**
 * Reveal a headline word by word. Each word rises into place with a slight
 * spring, which gives editorial headlines their snap without a library.
 *
 * Walks the existing DOM rather than flattening to text, so <br>, accent
 * spans and other inline markup survive intact.
 */
export function initTypeReveal(selector = "[data-reveal-type]") {
  if (!canAnimate()) return;
  let counter = 0;

  const walk = (node) => {
    const kids = [...node.childNodes];
    kids.forEach((kid) => {
      if (kid.nodeType === Node.TEXT_NODE) {
        const text = kid.textContent;
        if (!text.trim()) return;
        const frag = document.createDocumentFragment();
        text.split(/(\s+)/).forEach((token) => {
          if (!token) return;
          if (!token.trim()) { frag.appendChild(document.createTextNode(" ")); return; }
          const span = document.createElement("span");
          span.className = "word";
          span.textContent = token;
          span.style.transitionDelay = `${counter++ * 55}ms`;
          frag.appendChild(span);
        });
        node.replaceChild(frag, kid);
      } else if (kid.nodeType === Node.ELEMENT_NODE) {
        walk(kid);
      }
    });
  };

  $$(selector).forEach((el) => {
    el.setAttribute("aria-label", el.textContent.trim());
    walk(el);
    requestAnimationFrame(() => el.classList.add("in"));
  });
}

/* ------------------------------------------------------------- live dot */

/** A soft pulsing dot for "someone is online right now" affordances. */
export function initLiveDots(root = document) {
  if (!canAnimate()) return;
  $$(".live-dot", root).forEach((dot) => {
    dot.style.animationDelay = `${Math.random() * 1.2}s`;
  });
}

/* ------------------------------------------------------- skeleton load */

/** Show shimmering skeletons while a remote fetch is in flight. */
export function showSkeletons(container, count = 6) {
  if (!container) return;
  container.classList.add("loading");
  container.innerHTML = Array.from({ length: count })
    .map(() => `<div class="card skeleton" aria-hidden="true"><div class="sk-img"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`)
    .join("");
}
export function hideSkeletons(container) {
  if (!container) return;
  container.classList.remove("loading");
}

/* ------------------------------------------------------------ copy */

/** Copy text and flash a confirmation on the button that triggered it. */
export async function copyWithFeedback(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.textContent;
      button.textContent = "Copied ✓";
      button.classList.add("copied");
      setTimeout(() => { button.textContent = original; button.classList.remove("copied"); }, 1600);
    }
    return true;
  } catch {
    return false;
  }
}

export { canAnimate };
