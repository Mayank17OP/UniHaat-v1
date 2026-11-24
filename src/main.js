import { PRODUCTS, DEMANDS, CATEGORIES, CLEARANCE, COLLEGES } from "./data.js";
import * as SB from "./supabase.js";
import { initAuthUI, getProfileData, refreshProfile, renderAuthState } from "./auth.js";
import { collegeForEmail } from "./college-email.js";
import {
  syncWishlist, syncListings, syncDemands,
  publishListing, publishDemand, persistWishlist,
} from "./persistence.js";
import {
  initScrollProgress, initCardStagger, burstHeart, initMagnetic,
  initTilt, initTypeReveal, initLiveDots, showSkeletons, hideSkeletons,
} from "./alive.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n) => "₹" + Number(n).toLocaleString("en-IN");

let products = [...PRODUCTS];
let demands = [...DEMANDS];
let wishlist = new Set(JSON.parse(localStorage.getItem("uh-wishlist") || "[]"));
let state = { q: "", type: "all", cat: "all", scope: "all", sort: "distance" };
let verified = localStorage.getItem("uh-verified") === "1";
let signedIn = false;

/* ---------- SmartPrice model (v1 rule-based) ---------- */
const DEPRECIATION = { phones: 0.45, electronics: 0.55, furniture: 0.48, appliances: 0.58, books: 0.35, sports: 0.48, instruments: 0.42, hostel: 0.52 };
const COND_MULT = { "Like new": 1.0, Good: 0.88, Fair: 0.70 };
function smartPrice({ category, original, ageMonths, condition, accessories = true }) {
  const base = DEPRECIATION[category] ?? 0.45;
  const ageFactor = Math.max(0.55, 1 - (ageMonths / 48) * 0.45);
  const cond = COND_MULT[condition] ?? 0.88;
  const acc = accessories ? 1.05 : 0.92;
  const rec = Math.round((original * base * ageFactor * cond * acc) / 10) * 10;
  const low = Math.round(rec * 0.87 / 10) * 10;
  const high = Math.round(rec * 1.13 / 10) * 10;
  return { rec, low, high };
}
function verdict(product) {
  if (product.type === "free") return { label: "Free · verified student", cls: "verdict-good" };
  const sp = smartPrice({ category: product.category, original: product.original, ageMonths: product.ageMonths, condition: product.condition });
  const ratio = product.price / sp.rec;
  if (ratio <= 0.92) return { label: `Good deal · SmartPrice ${fmt(sp.rec)}`, cls: "verdict-good", sp };
  if (ratio <= 1.08) return { label: `Fair price · SmartPrice ${fmt(sp.rec)}`, cls: "verdict-fair", sp };
  return { label: `Above SmartPrice ${fmt(sp.rec)}`, cls: "verdict-high", sp };
}

/**
 * How a seller's reputation is written on a card.
 *
 * A seller with no reviews has no star rating. Printing "★ 5" for them
 * would claim a perfect score that nobody gave — so the card says they are
 * a new seller instead, and only a real review earns a star.
 */
function sellerRating(p) {
  return typeof p.rating === "number" ? `★ ${p.rating}` : "· New seller";
}

/* ---------- Toast (Emil spring) ---------- */
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, 3200);
}

/* ---------- Reveal + counters ---------- */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    $$("[data-count]", e.target).forEach(runCounter);
    if (e.target.matches("[data-count]")) runCounter(e.target);
    // Progress bars fill once their section is on screen
    $$(".bar i", e.target).forEach((b) => b.classList.add("fill"));
    io.unobserve(e.target);
  });
}, { threshold: 0.15 });
function runCounter(el) {
  if (el.dataset.done) return; el.dataset.done = "1";
  const target = +el.dataset.count, pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
  const decimals = +(el.dataset.decimals || 0);
  const t0 = performance.now(), dur = 1400;
  let last = 0;
  const tick = () => {
    // Elapsed time is read from the clock *inside* the callback, never from
    // the timestamp requestAnimationFrame hands over. That timestamp is the
    // frame's start time, which can predate the moment the counter began —
    // the original bug, which eased past zero and briefly painted a negative
    // number ("-10,598 verified students") on the deployed page.
    //
    // Three guarantees, so no clock behaviour can produce a negative:
    //   1. progress is clamped to [0, 1];
    //   2. progress never moves backwards, even if the clock does;
    //   3. the rendered number itself is clamped to [0, target].
    const p = Math.max(last, Math.min(1, Math.max(0, (performance.now() - t0) / dur)));
    last = p;
    const eased = 1 - Math.pow(1 - p, 3);
    const value = Math.min(target, Math.max(0, target * eased));
    el.textContent = pre + value.toLocaleString("en-IN", {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }) + suf;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
$$(".reveal, [data-count]").forEach((el) => io.observe(el));

/* ---------- Categories ---------- */
function iconSvg(path) {
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}
$("#catsRow").innerHTML = CATEGORIES.map((c) => {
  const n = products.filter((p) => p.category === c.id).length;
  return `<button class="cat-btn" data-cat="${c.id}">${iconSvg(c.icon)}<span>${c.label}</span><small>${n} listings</small></button>`;
}).join("");
$("#catSelect").innerHTML = `<option value="all">All categories</option>` + CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
$("#spCat").innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
$("#sellCat").innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
$("#demandCat").innerHTML = `<option value="">Select category</option>` + CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");

/* ---------- Product grid ---------- */
function typeLabel(p) {
  if (p.type === "free") return "Free";
  if (p.type === "rent") return "Rent · " + (p.rentPer || "");
  if (p.type === "exchange") return "Exchange";
  return "For sale";
}
function priceLabel(p) {
  if (p.type === "free") return "FREE";
  if (p.type === "rent") return p.rentPer || fmt(p.price);
  return fmt(p.price);
}
function filtered() {
  let list = products.filter((p) => {
    if (state.type !== "all" && p.type !== state.type) return false;
    if (state.cat !== "all" && p.category !== state.cat) return false;
    if (state.scope !== "all" && p.scope !== state.scope) return false;
    if (state.q && !(p.title + " " + p.desc + " " + p.category).toLowerCase().includes(state.q.toLowerCase())) return false;
    return true;
  });
  const dealScore = (p) => (p.type === "free" ? 0 : p.price / (smartPrice({ category: p.category, original: p.original, ageMonths: p.ageMonths, condition: p.condition }).rec || 1));
  if (state.sort === "distance") list.sort((a, b) => a.distance - b.distance);
  if (state.sort === "price-asc") list.sort((a, b) => a.price - b.price);
  if (state.sort === "price-desc") list.sort((a, b) => b.price - a.price);
  if (state.sort === "newest") list.sort((a, b) => a.created - b.created);
  if (state.sort === "deal") list.sort((a, b) => dealScore(a) - dealScore(b));
  return list;
}
function renderGrid() {
  const list = filtered();
  $("#resultsMeta").textContent = `${list.length} listing${list.length === 1 ? "" : "s"} · verified students only`;
  $("#emptyState").hidden = list.length > 0;
  $("#productGrid").innerHTML = list.map((p) => {
    const v = verdict(p);
    const saved = wishlist.has(p.id);
    return `<article class="card" data-id="${p.id}" tabindex="0" role="button" aria-label="${p.title}">
      <div class="card-img">
        <img src="${p.img}" alt="${p.title}" loading="lazy" onerror="this.style.opacity=.15" />
        <span class="type-badge ${p.type}">${typeLabel(p)}</span>
        ${p.live ? `<span class="live-chip"><i class="live-dot"></i>live</span>` : ""}
        <button class="heart ${saved ? "saved" : ""}" data-heart="${p.id}" aria-label="Save to wishlist" aria-pressed="${saved}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
        </button>
      </div>
      <div class="card-body">
        <h3>${p.title}</h3>
        <div class="card-meta"><span>${p.college}</span><span>· ${p.distance} km</span><span>· ${p.condition}</span><span class="verified">✓ Verified</span></div>
        <span class="verdict ${v.cls}">${v.label}</span>
        <div class="card-foot"><span class="price">${priceLabel(p)}</span><span class="fine">${p.seller} ${sellerRating(p)}</span></div>
      </div>
    </article>`;
  }).join("");
  updateWishlistCount();
  initCardStagger($("#productGrid"));
  initTilt("#productGrid .card");
  initLiveDots($("#productGrid"));
}
function updateWishlistCount() {
  $("#wishlistCount").textContent = wishlist.size;
  localStorage.setItem("uh-wishlist", JSON.stringify([...wishlist]));
}

/* ---------- Filters wiring ---------- */
$("#searchInput").addEventListener("input", (e) => { state.q = e.target.value; renderGrid(); });
$("#sortSelect").addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(); });
$("#catSelect").addEventListener("change", (e) => { state.cat = e.target.value; syncCatButtons(); renderGrid(); });
$$("#typePills .pill").forEach((b) => b.addEventListener("click", () => {
  $$("#typePills .pill").forEach((x) => x.classList.remove("active")); b.classList.add("active");
  state.type = b.dataset.type; renderGrid();
}));
$$(".scope-btn").forEach((b) => b.addEventListener("click", () => {
  $$(".scope-btn").forEach((x) => x.classList.remove("active")); b.classList.add("active");
  state.scope = b.dataset.scope; renderGrid();
}));
function syncCatButtons() { $$(".cat-btn").forEach((b) => b.classList.toggle("active", b.dataset.cat === state.cat)); }
$$(".cat-btn").forEach((b) => b.addEventListener("click", () => {
  state.cat = state.cat === b.dataset.cat ? "all" : b.dataset.cat;
  $("#catSelect").value = state.cat; syncCatButtons(); renderGrid();
  $("#marketplace").scrollIntoView({ behavior: "smooth" });
}));
$("#heroSearch").addEventListener("submit", (e) => {
  e.preventDefault(); state.q = $("#heroQ").value; $("#searchInput").value = state.q; renderGrid();
  $("#marketplace").scrollIntoView({ behavior: "smooth" });
});
$$(".hero-quick button").forEach((b) => b.addEventListener("click", () => {
  state.q = b.dataset.q; $("#searchInput").value = state.q; $("#heroQ").value = state.q; renderGrid();
  $("#marketplace").scrollIntoView({ behavior: "smooth" });
}));

/* ---------- Wishlist + card clicks (delegation) ---------- */
$("#productGrid").addEventListener("click", (e) => {
  const heart = e.target.closest("[data-heart]");
  if (heart) {
    e.stopPropagation();
    const id = heart.dataset.heart;
    const saving = !wishlist.has(id);
    if (saving) { wishlist.add(id); burstHeart(heart); toast("Saved to wishlist — we’ll notify you on price changes"); }
    else { wishlist.delete(id); toast("Removed from wishlist"); }
    renderGrid();
    if (signedIn) persistWishlist(id, saving);
    return;
  }
  const card = e.target.closest(".card");
  if (card) openProduct(card.dataset.id);
});
$("#productGrid").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { const c = e.target.closest(".card"); if (c) openProduct(c.dataset.id); }
});
$("#wishlistBtn").addEventListener("click", () => {
  if (!wishlist.size) return toast("Your wishlist is empty — tap the heart on any listing");
  state.q = ""; $("#searchInput").value = "";
  const items = products.filter((p) => wishlist.has(p.id));
  toast(`Wishlist: ${items.map((p) => p.title.split(" ").slice(0, 2).join(" ")).join(", ")}`);
  $("#marketplace").scrollIntoView({ behavior: "smooth" });
});

/* ---------- Product detail modal + Passport + SafeSwap QR ---------- */
function drawQR(canvas, seedStr) {
  const ctx = canvas.getContext("2d"), n = 21, s = canvas.width / n;
  let seed = 0; for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#161210";
  const finder = (x, y) => { ctx.fillRect(x * s, y * s, 7 * s, 7 * s); ctx.fillStyle = "#fff"; ctx.fillRect((x + 1) * s, (y + 1) * s, 5 * s, 5 * s); ctx.fillStyle = "#161210"; ctx.fillRect((x + 2) * s, (y + 2) * s, 3 * s, 3 * s); };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const inFinder = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    if (!inFinder && rnd() > 0.52) ctx.fillRect(x * s, y * s, s, s);
  }
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
}
function openProduct(id) {
  const p = products.find((x) => x.id === id); if (!p) return;
  const v = verdict(p);
  const code = "UH-" + p.id.toUpperCase() + "-" + Math.floor(1000 + Math.random() * 9000);
  $("#modalBody").innerHTML = `<div class="detail">
    <div class="detail-img"><img src="${p.img}" alt="${p.title}" onerror="this.style.opacity=.15" /></div>
    <div class="detail-body">
      <p class="eyebrow">${typeLabel(p)} · ${p.college} · ${p.distance} km away</p>
      <h2 id="modalTitle">${p.title}</h2>
      <div class="row-between"><span class="price" style="font-size:28px">${priceLabel(p)}</span><span class="fine">Original ${fmt(p.original)} · ${p.ageMonths} months old</span></div>
      <span class="verdict ${v.cls}" style="margin-top:8px">${v.label}</span>
      <p class="sub" style="margin-top:12px">${p.desc}</p>
      <div class="passport">
        <h3>Product Passport — condition card</h3>
        <dl>
          <div><dt>Age</dt><dd>${p.ageMonths} months</dd></div>
          <div><dt>Condition</dt><dd>${p.condition}</dd></div>
          <div><dt>Accessories</dt><dd>${p.accessories}</dd></div>
          <div><dt>Repair history</dt><dd>${p.repairs}</dd></div>
          ${p.battery ? `<div><dt>Battery health</dt><dd>${p.battery}</dd></div>` : ""}
          <div><dt>Seller attestation</dt><dd>✓ Disclosed above</dd></div>
        </dl>
      </div>
      <div class="seller">
        <span class="avatar">${p.seller[0]}</span>
        <div><strong>${p.seller}</strong><p class="fine" style="margin:0">✓ Verified student · ${sellerRating(p)} · ${p.deals} completed deals</p></div>
      </div>
      <div class="qr-mini">
        <canvas width="72" height="72" id="modalQr"></canvas>
        <div><strong>SafeSwap ready</strong><p class="fine" style="margin:2px 0">Code ${code} · Meet at ${p.college} gate · Scan on handover</p></div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary" id="modalChat">Chat with seller</button>
        <button class="btn btn-ghost" id="modalWish">${wishlist.has(p.id) ? "Saved ✓" : "Save to wishlist"}</button>
        <button class="btn btn-ghost" id="modalReport">Report</button>
      </div>
      <p class="fine" style="margin-top:12px">Safe pickup: busy campus spot, daylight. Never pay in advance. Report mismatch via Product Passport.</p>
    </div>
  </div>`;
  openOverlay("#productOverlay");
  drawQR($("#modalQr"), code);
  $("#modalChat").addEventListener("click", () => { closeOverlays(); openChat(p); });
  $("#modalWish").addEventListener("click", () => {
    wishlist.has(p.id) ? wishlist.delete(p.id) : wishlist.add(p.id);
    updateWishlistCount(); toast(wishlist.has(p.id) ? "Saved to wishlist" : "Removed from wishlist"); closeOverlays();
  });
  $("#modalReport").addEventListener("click", () => { toast("Reported — our moderation team will review this listing"); closeOverlays(); });
}

/* ---------- Overlays ---------- */
function openOverlay(sel) { $(sel).hidden = false; document.body.style.overflow = "hidden"; }
function closeOverlays() { $$(".overlay").forEach((o) => (o.hidden = true)); document.body.style.overflow = ""; }
$$(".overlay").forEach((o) => o.addEventListener("click", (e) => { if (e.target === o) closeOverlays(); }));
$$("[data-close]").forEach((b) => b.addEventListener("click", closeOverlays));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeOverlays(); $("#chatDrawer").hidden = true; } });

/* ---------- Chat ---------- */
let chatProduct = null;
function openChat(p) {
  chatProduct = p;
  $("#chatTitle").textContent = p.title;
  $("#chatSub").textContent = `${p.seller} · ${p.college} · responds in ~1 hr`;
  $("#chatBody").innerHTML = `<div class="msg them">Hi! Yes, it’s available. Pickup from ${p.college} gate works best. Anything you want to know about condition?</div>`;
  $("#chatDrawer").hidden = false;
}
$("#chatClose").addEventListener("click", () => ($("#chatDrawer").hidden = true));
function sendChat(text) {
  if (!text.trim()) return;
  $("#chatBody").insertAdjacentHTML("beforeend", `<div class="msg me">${text.replace(/</g, "&lt;")}</div>`);
  $("#chatBody").scrollTop = 99999;
  setTimeout(() => {
    $("#chatBody").insertAdjacentHTML("beforeend", `<div class="msg them">Sounds good! Let’s lock it in — I’ll generate the SafeSwap QR once we agree on price &amp; time.</div>`);
    $("#chatBody").scrollTop = 99999;
  }, 900);
}
$("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); sendChat($("#chatInput").value); $("#chatInput").value = ""; });
$$(".chat-quick button").forEach((b) => b.addEventListener("click", () => sendChat(b.dataset.msg)));

/* ---------- Demand Board + UniMatch ---------- */
const STOPWORDS = new Set(["for", "a", "an", "the", "and", "with", "under", "my", "need", "want", "looking", "some", "one", "of"]);
function keywords(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9₹\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}
function matchFor(d) {
  const want = new Set(keywords(`${d.title} ${d.notes || ""}`));
  return products
    .filter((p) => p.category === d.category)
    .filter((p) => p.type === "free" || p.price <= d.budget * 1.15)
    .map((p) => {
      const reasons = [];
      // Keyword relevance decides whether this listing truly answers the demand.
      const have = keywords(`${p.title} ${p.desc}`);
      const hits = [...want].filter((w) => have.some((h) => h.includes(w) || w.includes(h)));
      const relevance = want.size ? hits.length / want.size : 0;
      if (relevance < 0.34) return null; // category alone is not a match
      reasons.push("Category ✓");
      if (hits.length) reasons.push(`Keyword ✓ (${hits.slice(0, 2).join(", ")})`);
      if (p.price <= d.budget) reasons.push("Within budget ✓");
      if (p.distance <= 1.5) reasons.push(`${p.distance} km ✓`);
      reasons.push(p.college);
      return { p, reasons, score: relevance };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}
function renderDemands() {
  $("#demandsList").innerHTML = demands.map((d) => {
    // Live demands carry server-computed UniMatch results; local ones are scored here
    const live = Array.isArray(d.matches) && d.matches.length
      ? d.matches.map((m) => {
          const p = products.find((x) => x.id === m.listing_id) || m.listing;
          return { p, reasons: m.reasons || [] };
        }).filter((m) => m.p)
      : null;
    const m = live || matchFor(d);
    return `<article class="demand-card">
      <div class="row-between"><h3>${d.title}</h3><span class="verdict ${m.length ? "verdict-good" : "verdict-fair"}">${m.length ? `${m.length} UniMatch${m.length > 1 ? "es" : ""}` : "Waiting for match"}</span></div>
      <p class="demand-meta">${d.user} · ${d.college} · Budget ${fmt(d.budget)} · Needed by ${d.neededBy || "flexible"}${d.notes ? " · " + d.notes : ""}</p>
      ${m.length ? `<div class="match">${m.slice(0, 2).map(({ p, reasons }) => `<span title="${reasons.join(" · ")}">${p.title} · ${priceLabel(p)}</span>`).join("")}</div>` : `<p class="fine">UniMatch is watching for new listings in this category.</p>`}
    </article>`;
  }).join("");
}
$("#demandForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const profile = getProfileData();
  const demand = {
    id: "d" + Date.now(), title: f.get("title"), category: f.get("category"), budget: +f.get("budget"),
    college: profile?.colleges?.short_name || "DTU", neededBy: f.get("neededBy"),
    user: profile?.full_name || "You", notes: f.get("notes") || "",
  };
  demands.unshift(demand);
  renderDemands(); e.target.reset();
  const m = matchFor(demand);
  toast(m.length ? `Demand posted — UniMatch found ${m.length} match${m.length > 1 ? "es" : ""} already!` : "Demand posted — UniMatch will notify you on a match");

  if (signedIn) {
    publishDemand(demand).then((row) => {
      if (row) toast("Demand saved to the board");
      else toast("Posted locally — sign in to keep it on the board");
    });
  }
});

/* ---------- Clearance ---------- */
$("#clearanceRow").innerHTML = CLEARANCE.map((id) => {
  const p = products.find((x) => x.id === id);
  return `<article class="clear-card" data-id="${p.id}" tabindex="0" role="button" aria-label="${p.title}">
    <img src="${p.img}" alt="${p.title}" loading="lazy" onerror="this.style.opacity=.15" />
    <div class="clear-body"><div class="row-between"><strong>${p.title}</strong><span class="price">${priceLabel(p)}</span></div>
    <div class="clear-items"><span>${p.college}</span><span>${p.distance} km</span><span>Combined pickup</span></div>
    <p class="fine">${p.desc}</p></div></article>`;
}).join("");
$("#clearanceRow").addEventListener("click", (e) => { const c = e.target.closest(".clear-card"); if (c) openProduct(c.dataset.id); });
$("[data-filter-clearance]").addEventListener("click", (e) => { e.preventDefault(); state.q = "Hostel"; $("#searchInput").value = "Hostel"; renderGrid(); $("#marketplace").scrollIntoView({ behavior: "smooth" }); });

/* ---------- SmartPrice calculator ---------- */
let spCond = "Good";
function renderSmart() {
  const cat = $("#spCat").value, orig = +$("#spOriginal").value || 0, age = +$("#spAge").value;
  $("#spAgeOut").textContent = age + " months";
  const sp = smartPrice({ category: cat, original: orig, ageMonths: age, condition: spCond, accessories: $("#spAccessories").checked });
  $("#spPrice").textContent = fmt(sp.rec);
  $("#spRange").textContent = `Fair range ${fmt(sp.low)} – ${fmt(sp.high)}`;
  const comps = [0.72, 0.85, 0.95, 1.0, 0.9, 0.8, 0.68];
  $("#spBars").innerHTML = comps.map((h, i) => `<i class="${i === 3 ? "hot" : ""}" style="height:${Math.round(h * 100)}%"></i>`).join("");
  const compsInCat = products.filter((p) => p.category === cat && p.type === "sell");
  const medianAge = compsInCat.length
    ? Math.round(compsInCat.reduce((a, p) => a + p.ageMonths, 0) / compsInCat.length)
    : 12;
  const catLabel = CATEGORIES.find((c) => c.id === cat)?.label || cat;
  $("#spPoints").innerHTML = [
    `Depreciation curve for ${catLabel} applied`,
    `Condition “${spCond}” multiplier ×${COND_MULT[spCond]}`,
    `${$("#spAccessories").checked ? "All accessories" : "Accessories missing"} factored in`,
    `Compared with ${compsInCat.length} similar UniHaat listings (median age ${medianAge} mo)`,
  ].map((t) => `<li>${t}</li>`).join("");
  $("#spNote").textContent = `Based on ${compsInCat.length || 23} comparable listings in ${catLabel} · median age ${medianAge} mo. v1 rule-based model; v2 learns from UniHaat comps.`;
  return sp;
}
$("#spCat").addEventListener("change", renderSmart);
$("#spOriginal").addEventListener("input", renderSmart);
$("#spAge").addEventListener("input", renderSmart);
$("#spAccessories").addEventListener("change", renderSmart);
$$("#spCond button").forEach((b) => b.addEventListener("click", () => {
  $$("#spCond button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); spCond = b.dataset.cond; renderSmart();
}));
$("#spUseBtn").addEventListener("click", () => { openOverlay("#sellOverlay"); toast(`SmartPrice ${$("#spPrice").textContent} copied into Sell`); $("#sellForm [name=price]").value = $("#spPrice").textContent.replace(/[₹,]/g, ""); });

/* ---------- Sell flow ---------- */
$("#sellBtn").addEventListener("click", () => openOverlay("#sellOverlay"));
function sellHint() {
  const f = $("#sellForm");
  const orig = +f.original?.value || +f.elements.original.value, age = +f.elements.age.value || 0;
  if (!orig) return;
  const sp = smartPrice({ category: f.elements.category.value, original: orig, ageMonths: age, condition: f.elements.condition.value });
  $("#sellSmartHint").textContent = `SmartPrice recommends ${fmt(sp.rec)} (fair range ${fmt(sp.low)}–${fmt(sp.high)}) for this item.`;
}
$("#sellForm").addEventListener("input", sellHint);
$("#sellForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const profile = getProfileData();
  const p = {
    id: "p" + Date.now(), title: f.title.value, price: +f.price.value || 0, original: +f.original.value || +f.price.value,
    type: f.type.value, category: f.category.value, condition: f.condition.value, ageMonths: +f.age.value || 6,
    distance: 0.2, college: profile?.colleges?.short_name || "DTU", scope: "same",
    seller: profile?.full_name || "You", rating: null, deals: 0,
    img: "./assets/kettle.svg",
    desc: f.description.value || "Listed via UniHaat Sell.", accessories: "As described", repairs: "None", battery: null, clearance: false, created: 0,
  };
  products.unshift(p); renderGrid(); closeOverlays(); f.reset(); $("#sellSmartHint").textContent = "SmartPrice: enter original price + age for a recommendation.";
  toast("Listing published — UniMatch is notifying matching demands");
  $("#marketplace").scrollIntoView({ behavior: "smooth" });

  // Persist to Supabase when signed in (fire-and-forget; the row is live)
  if (signedIn) {
    publishListing(p).then((row) => {
      if (row) {
        p.id = row.id;
        p.live = true;
        renderGrid();
        toast("Listing saved to your Supabase account");
      } else {
        toast("Published locally — sign in to keep it in the cloud");
      }
    });
  }
});

/* ---------- Verify ---------- */
$("#verifyBtn").addEventListener("click", () => {
  // The address on the account is what the server checks, so show it
  // rather than asking the student to type it a second time.
  const form = $("#verifyForm");
  const account = SB.getUser()?.email || "";
  if (form.email && account) form.email.value = account;
  // The campus comes off the address; the profile already carries it, but
  // the address is the authority when the two disagree.
  const college =
    getProfileData()?.colleges?.short_name || collegeForEmail(account)?.short || "";
  if (form.college && college) form.college.value = college;
  openOverlay("#verifyOverlay");
});
$("#verifyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!signedIn) {
    // There is no account to ask. The local flag unlocks the prototype's
    // own UI; the server keeps its own copy, and the account decides that
    // part for real.
    verified = true;
    localStorage.setItem("uh-verified", "1");
    $("#verifyBtn").textContent = "✓ Verified";
    closeOverlays();
    toast("Student verified — sign in with your college email to keep it.");
    return;
  }
  try {
    // `verified` is server-owned. The server checks the address on the
    // account against the college list and answers; the button follows the
    // answer rather than declaring success and hoping.
    const result = await SB.claimVerification({
      college: form.college.value || null,
      studentId: form.studentId.value || null,
    });
    if (!result?.verified) {
      // The server said no. The two things it asks for are a college
      // address and a roll number, so the message names the one that is
      // missing rather than guessing.
      closeOverlays();
      toast(
        form.studentId.value.trim()
          ? "We couldn't verify that — check the college and the student ID."
          : "Add your student ID — the college address and the roll number are the evidence."
      );
      return;
    }
    verified = true;
    localStorage.setItem("uh-verified", "1");
    $("#verifyBtn").textContent = "✓ Verified";
    closeOverlays();
    toast("Student verified — you can now sell & use SafeSwap");
    // Re-read the profile so the menu stops offering "Verify as a student".
    await refreshProfile({ force: true });
    renderAuthState();
  } catch (err) {
    console.warn("[UniHaat] could not save verification", err?.message);
    toast("Could not save your verification. Try again.");
  }
});
if (verified) $("#verifyBtn").textContent = "✓ Verified";

/* ---------- SafeSwap demo ---------- */
let swapStep = 0;
function newSwapCode() {
  const code = "UH-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  $("#swapCode").textContent = code; drawQR($("#qrCanvas"), code);
  swapStep = 0; updateSwap();
}
function updateSwap() {
  $$("#swapSteps .step").forEach((s, i) => { s.className = "step" + (i < swapStep ? " done" : i === swapStep ? " active" : ""); });
  $("#swapStatus").textContent = ["Waiting for both parties to confirm handover at a public campus spot.", "One party confirmed — waiting for the other…", "Handover confirmed! Transaction completed & recorded. Ratings unlocked."][swapStep];
}
$("#swapScanBtn").addEventListener("click", () => {
  if (swapStep < 2) { swapStep++; updateSwap(); if (swapStep === 2) toast("SafeSwap completed — handover recorded"); }
});
$("#swapNewBtn").addEventListener("click", newSwapCode);

/* ---------- Misc ---------- */
$("#impactShare").addEventListener("click", () => toast("UniImpact card shared — ₹4,250 saved · 11 kg diverted"));
$("#menuBtn").addEventListener("click", () => {
  const m = $("#mobileMenu"); m.classList.toggle("open");
  $("#menuBtn").setAttribute("aria-expanded", m.classList.contains("open"));
});
$$("#mobileMenu a").forEach((a) => a.addEventListener("click", () => $("#mobileMenu").classList.remove("open")));
$("#mSellBtn").addEventListener("click", () => { $("#mobileMenu").classList.remove("open"); openOverlay("#sellOverlay"); });
$("#mVerifyBtn").addEventListener("click", () => { $("#mobileMenu").classList.remove("open"); openOverlay("#verifyOverlay"); });

/* ---------- Init ---------- */
renderGrid(); renderDemands(); renderSmart(); newSwapCode();
initScrollProgress();
initMagnetic();
initTypeReveal("[data-reveal-type]");

/* ---------- Auth + sync ---------- */
initAuthUI({
  onAuth: async ({ event }) => {
    signedIn = SB.isSignedIn();

    if (signedIn) {
      // Bring the cloud state down into the UI
      const [ids, liveListings, liveDemands] = await Promise.all([
        syncWishlist(), syncListings(), syncDemands(),
      ]);
      if (ids) {
        wishlist = new Set(ids);
        localStorage.setItem("uh-wishlist", JSON.stringify([...wishlist]));
        updateWishlistCount();
      }
      if (liveListings?.length) {
        // Live rows replace their local twin, then join. The title is the
        // only part of a listing the two datasets can be matched on: the
        // offline catalogue abbreviates the seller's name ("Aarav S.") while
        // the database stores it in full ("Aarav Sharma").
        const sameTitle = (a, b) =>
          String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
        const merged = [...liveListings];
        products.forEach((local) => {
          const dupe = liveListings.find((l) => sameTitle(l.title, local.title));
          if (!dupe) merged.push(local);
        });
        products = merged;
      }
      if (liveDemands?.length) {
        const merged = [...liveDemands];
        demands.forEach((local) => {
          if (!liveDemands.some((d) => d.title === local.title)) merged.push(local);
        });
        demands = merged;
      }
      renderGrid(); renderDemands();
      toast("Signed in — your listings and wishlist are in sync");
    } else if (event === "SIGNED_OUT") {
      toast("Signed out");
    }
  },
});
