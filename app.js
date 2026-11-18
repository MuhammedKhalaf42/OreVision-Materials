/* ============ OreBridge Minerals — app logic ============ */
"use strict";

/* ---------- safe storage (private mode / blocked storage / corrupt values never break the page) ---------- */
const store = {
  str(key, fallback = "") {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch (_) { return fallback; }
  },
  setStr(key, val) { try { localStorage.setItem(key, val); } catch (_) { /* storage unavailable */ } },
  json(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
  },
  setJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* storage unavailable */ } },
};

/* ---------- state ---------- */
let currency = store.str("ov-currency") === "EGP" ? "EGP" : "USD";
let lang = store.str("ov-lang") === "ar" ? "ar" : "en";
let view = store.str("ov-view"); // "table" | "cards" | "" (decided at startup by screen width)
let countryFilter = ""; // "" = all countries
let sortKey = "name", sortDir = 1;
let cart = [];
let alerts = [];
let usdToEgp = Number(USD_TO_EGP) > 0 ? Number(USD_TO_EGP) : 1;
let TIERS = [];
let pageRoute = null; // { material, id } while a material page is open
let baseTitle = "OreBridge Minerals";

const $ = (sel) => document.querySelector(sel);
const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
const fill = (key, vars) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = (id) => PRODUCTS.find((p) => p.id === id);
const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const MATS = typeof MATERIALS === "object" && MATERIALS ? MATERIALS : {};
const SPEC_AR = typeof AR_SPEC_LABELS === "object" && AR_SPEC_LABELS ? AR_SPEC_LABELS : {};
const CTRY = Array.isArray(typeof COUNTRIES === "undefined" ? null : COUNTRIES) ? COUNTRIES : [];

function fmtDate(iso) {
  if (!isIsoDate(String(iso))) return String(iso || "");
  return new Date(iso + "T00:00:00Z").toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB",
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/* Chemical notation: escape, then subscript digits that follow an element or a bracket
   ("Fe2O3" → Fe₂O₃, "CaSO4·2H2O" keeps the leading 2). Values like "≥ 80%" are untouched. */
const chem = (s) => esc(s).replace(/([A-Za-z)])(\d+(?:\.\d+)?)/g, "$1<sub>$2</sub>");
/* Spec values always read left-to-right: in Arabic text the browser would otherwise mirror
   "≥ 85%" into "85% ≤", turning a minimum into a maximum. */
const val = (s) => `<bdi dir="ltr">${chem(s)}</bdi>`;

/* ---------- data validation: a typo in data.js degrades gracefully instead of breaking the site ---------- */
function normalizeData() {
  const seen = new Set();
  for (let i = PRODUCTS.length - 1; i >= 0; i--) {
    const p = PRODUCTS[i];
    if (!p || !p.id || !p.name) {
      console.warn("data.js: dropped a product without id/name at position", i);
      PRODUCTS.splice(i, 1);
    }
  }
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    if (seen.has(p.id)) {
      console.warn("data.js: duplicate product id dropped:", p.id);
      PRODUCTS.splice(i--, 1);
      continue;
    }
    seen.add(p.id);
    p.basePrice = Math.max(0, Number(p.basePrice) || 0);
    p.stock = Math.max(0, Math.floor(Number(p.stock) || 0));
    p.moq = Math.max(1, Math.floor(Number(p.moq) || 1));
    p.unit = p.unit || "t";
    p.category = p.category || "Other";
    p.grade = p.grade || "";
    p.origin = p.origin || "";
    p.uses = p.uses || "";
    p.icon = p.icon || "◆";
    p.country = String(p.country || "EG").toUpperCase();
    p.material = String(p.material || p.id);
    p.form = typeof p.form === "string" ? p.form : "";
    p.image = String(p.image || p.id);
    p.specs = (Array.isArray(p.specs) ? p.specs : [])
      .filter((s) => Array.isArray(s) && s.length >= 2 && String(s[0]).trim() && String(s[1]).trim())
      .map((s) => [String(s[0]), String(s[1])]);
    // real recorded prices only: valid dates, positive prices, oldest first, one entry per date
    const hist = (Array.isArray(p.history) ? p.history : [])
      .map((h) => ({ date: String((h && h.date) || ""), price: Number(h && h.price) }))
      .filter((h) => isIsoDate(h.date) && Number.isFinite(h.price) && h.price > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    p.history = hist.filter((h, j) => j === hist.length - 1 || hist[j + 1].date !== h.date);
    if (!p.history.length && p.basePrice > 0 && isIsoDate(LAST_UPDATED)) {
      p.history = [{ date: LAST_UPDATED, price: p.basePrice }];
    }
    delete p.trend; // older data.js files carried an invented trend line
  }
  for (let i = BENCHMARKS.length - 1; i >= 0; i--) {
    const b = BENCHMARKS[i];
    const hasPrice = b && Number.isFinite(Number(b.price)) && Number(b.price) > 0;
    if (!b || !b.name || (!hasPrice && !b.range)) {
      console.warn("data.js: dropped a benchmark without a name and price/range at position", i);
      BENCHMARKS.splice(i, 1);
      continue;
    }
    b.price = hasPrice ? Number(b.price) : null;
    b.unit = b.unit || "";
    b.asOf = b.asOf || "";
    b.source = b.source || "";
  }
  TIERS = (Array.isArray(SITE.DISCOUNT_TIERS) ? SITE.DISCOUNT_TIERS : [])
    .filter((x) => x && Number(x.mult) > 0 && Number(x.pct) > 0 && Number(x.pct) < 100)
    .map((x) => ({ mult: Number(x.mult), pct: Number(x.pct) }))
    .sort((a, b) => b.mult - a.mult);
  SITE.PACKAGING = Array.isArray(SITE.PACKAGING) ? SITE.PACKAGING : [];
  SITE.INCOTERMS = Array.isArray(SITE.INCOTERMS) ? SITE.INCOTERMS : [];
  SITE.FREIGHT = SITE.FREIGHT && typeof SITE.FREIGHT === "object" ? SITE.FREIGHT : {};
}

/* ---------- product helpers ---------- */
const arP = (p) => (lang === "ar" && typeof AR_PRODUCTS === "object" && AR_PRODUCTS[p.id]) || null;
const pname = (p) => (arP(p) && arP(p).name) || p.name;
const pform = (p) => (arP(p) && arP(p).form) || p.form;
const puses = (p) => (arP(p) && arP(p).uses) || p.uses;
const porigin = (p) => (arP(p) && arP(p).origin) || p.origin;
const pfull = (p) => (pform(p) ? `${pname(p)} — ${pform(p)}` : pname(p)); // name + condition
const pfullEn = (p) => (p.form ? `${p.name} — ${p.form}` : p.name);
const pcat = (c) => (lang === "ar" ? AR_CATEGORIES[c] || c : c);
const specLabel = (l) => (lang === "ar" && SPEC_AR[l] ? esc(SPEC_AR[l]) : chem(l));
const countryOf = (p) => CTRY.find((c) => c.code === p.country) || null;
const cname = (c) => (c ? (lang === "ar" ? c.nameAr || c.name : c.name) : "");
const flagName = (p) => { const c = countryOf(p); return c ? `${c.flag} ${cname(c)}` : esc(p.country); };
// origin without the trailing country name ("Zafarana, Egypt" → "Zafarana"); "" when it is only the country
const regionOnly = (p) => {
  const c = countryOf(p);
  let o = porigin(p);
  if (c) [c.name, c.nameAr].filter(Boolean).forEach((n) => { o = o.replace(new RegExp("[,،]\\s*" + n + "$"), ""); if (o === n) o = ""; });
  return o.trim();
};
const matInfo = (m) => MATS[m] || null;
const matText = (m) => { const x = matInfo(m); return x ? x[lang] || x.en || null : null; };
const gradesOf = (material) => PRODUCTS.filter((p) => p.material === material);
const pageHref = (p) => `#/m/${encodeURIComponent(p.material)}/${encodeURIComponent(p.id)}`;
const imgSrc = (p) => `images/${encodeURIComponent(p.image)}.jpg`;
const isOut = (p) => p.stock < p.moq; // cannot fill even one minimum order
const isCore = (p) => Array.isArray(SITE.CORE_MATERIALS) && SITE.CORE_MATERIALS.includes(p.material);
const unitName = (u) => (u === "t" ? t("unit.t") : u); // "t" reads "طن" in Arabic
/* A discount always reads "−7%": in Arabic text a bare "−7%" is mirrored to "7%−". */
const pctOff = (pct) => `<bdi dir="ltr">−${pct}%</bdi>`;

function clampQty(p, raw) {
  let n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < p.moq) n = p.moq;
  const capped = n > p.stock;
  if (capped) n = p.stock;
  return { qty: n, capped };
}

function fmtPrice(usd) {
  if (currency === "EGP") {
    return "E£" + Math.round(usd * usdToEgp).toLocaleString();
  }
  const v = Math.round(usd * 100) / 100;
  return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function stockBadge(p) {
  if (isOut(p)) return `<span class="badge out">${t("badge.out")}</span>`;
  if (p.stock < p.moq * 20) return `<span class="badge low">${t("badge.low")}</span>`;
  return `<span class="badge in">${t("badge.in")}</span>`;
}

function discountPct(p, qty) {
  for (const tier of TIERS) {
    if (qty >= tier.mult * p.moq) return tier.pct;
  }
  return 0;
}
// largest discount a buyer can actually reach with the stock on hand
const maxDiscountFor = (p) => (isOut(p) ? 0 : discountPct(p, p.stock));

// drawn only once a product has at least two real recorded prices
function sparkline(history) {
  if (!history || history.length < 2) return "";
  const prices = history.map((h) => h.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices
    .map((v, i) => `${((i / (prices.length - 1)) * 100).toFixed(1)},${(30 - ((v - min) / range) * 26 + 2).toFixed(1)}`)
    .join(" ");
  return `<svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

/* ---------- procedural card art (fallback when a photo is missing) ---------- */
const CAT_HUE = {
  "Industrial Minerals": 36,
  "Fertilizer Minerals": 95,
  "Construction Minerals": 18,
  "Metallic Ores": 210,
};

function seededRand(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function artSVG(p) {
  const hue = CAT_HUE[p.category] ?? 36;
  const rnd = seededRand(p.id);
  let layers = "";
  for (let i = 0; i < 4; i++) {
    const yBase = 20 + i * 16;
    let d = `M0 ${(yBase + rnd() * 8).toFixed(1)}`;
    for (let x = 20; x <= 200; x += 20) d += ` L${x} ${(yBase + rnd() * 14 - 4).toFixed(1)}`;
    d += ` L200 80 L0 80 Z`;
    const l = 26 - i * 4;
    layers += `<path d="${d}" fill="hsl(${hue} ${40 + i * 8}% ${l}%)"/>`;
  }
  return `<svg class="card-art" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">
    <rect width="200" height="80" fill="hsl(${hue} 30% 14%)"/>${layers}
    <text x="100" y="48" text-anchor="middle" font-size="30" fill="hsl(${hue} 80% 65%)" opacity=".9">${esc(p.icon)}</text>
  </svg>`;
}

/* ---------- market reference prices table ---------- */
const benchPrice = (b) =>
  b.range ? String(b.range) : b.price.toLocaleString(undefined, { maximumFractionDigits: 2 });

const benchRowHTML = (b) =>
  `<tr>
      <td>${esc(b.name)}${b.source ? `<span class="bench-source">${esc(b.source)}</span>` : ""}</td>
      <td class="num"><strong>${esc(benchPrice(b))}</strong></td>
      <td>${esc(b.unit)}</td>
      <td>${esc(b.asOf) || "—"}</td>
    </tr>`;

function renderMarket() {
  $("#marketTable tbody").innerHTML = BENCHMARKS.map(benchRowHTML).join("");
}

/* ---------- live exchange rate: timeout, HTTP check, 15-minute cache, static fallback ---------- */
const LIVE_TTL_MS = 15 * 60 * 1000;

async function fetchJson(url, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// the fallback rate is a sanity anchor: a live value far from it is treated as a bad response
const egpPlausible = (v) => typeof v === "number" && v > USD_TO_EGP * 0.5 && v < USD_TO_EGP * 2;

function applyLive(d) {
  if (!d || !egpPlausible(d.egp)) return;
  usdToEgp = d.egp;
  if (currency === "EGP") rerenderAll();
}

async function loadLive() {
  const cached = store.json("ov-fx", null);
  if (cached && typeof cached.ts === "number" && Date.now() - cached.ts < LIVE_TTL_MS) {
    applyLive(cached);
    return;
  }
  try {
    const fx = await fetchJson("https://open.er-api.com/v6/latest/USD");
    const egp = fx && fx.rates ? Number(fx.rates.EGP) : NaN;
    if (egpPlausible(egp)) {
      const d = { ts: Date.now(), egp };
      store.setJson("ov-fx", d);
      applyLive(d);
    }
  } catch (_) { /* keep the fallback rate from data.js */ }
}

/* ---------- catalog: country tabs, filters, sortable spec table / cards ---------- */
function renderCountryTabs() {
  const count = (code) => PRODUCTS.filter((p) => p.country === code).length;
  const tab = (code, label, extra, soon) =>
    `<button type="button" role="tab" class="ctab${soon ? " soon" : ""}" data-country="${esc(code)}"
       aria-selected="${countryFilter === code}">${label} <span class="ctab-n">${extra}</span></button>`;
  $("#countryTabs").innerHTML =
    tab("", esc(t("country.all")), PRODUCTS.length, false) +
    CTRY.map((c) => c.status === "soon"
      ? tab(c.code, `${c.flag} ${esc(cname(c))}`, esc(t("country.soon")), true)
      : tab(c.code, `${c.flag} ${esc(cname(c))}`, count(c.code), false)).join("");
}

function searchHay(p) {
  const c = countryOf(p);
  return [p.name, p.form, p.grade, p.uses, p.origin, p.category, pname(p), pform(p), puses(p), porigin(p),
    pcat(p.category), c && c.name, c && c.nameAr, ...p.specs.flat(), ...p.specs.map((s) => SPEC_AR[s[0]] || "")]
    .join(" ").toLowerCase();
}

function filteredProducts() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const cat = $("#categoryFilter").value;
  const inStockOnly = $("#inStockOnly").checked;
  const list = PRODUCTS.filter((p) => {
    if (countryFilter && p.country !== countryFilter) return false;
    if (cat && p.category !== cat) return false;
    if (inStockOnly && isOut(p)) return false;
    if (q && !q.split(/\s+/).every((w) => searchHay(p).includes(w))) return false;
    return true;
  });
  const cmp = {
    name: (a, b) => (isCore(b) - isCore(a)) * sortDir || pname(a).localeCompare(pname(b), lang) || a.basePrice - b.basePrice, // core materials first
    form: (a, b) => pform(a).localeCompare(pform(b), lang),
    purity: (a, b) => a.grade.localeCompare(b.grade, "en", { numeric: true }),
    origin: (a, b) => porigin(a).localeCompare(porigin(b), lang),
    price: (a, b) => a.basePrice - b.basePrice,
    moq: (a, b) => a.moq - b.moq,
    stock: (a, b) => a.stock - b.stock,
  }[sortKey] || ((a, b) => 0);
  return list.sort((a, b) => cmp(a, b) * sortDir);
}

const SORT_PRESETS = { "name": ["name", 1], "price-asc": ["price", 1], "price-desc": ["price", -1], "stock": ["stock", -1] };

function renderProducts() {
  const soon = CTRY.find((c) => c.code === countryFilter && c.status === "soon");
  $("#soonPanel").hidden = !soon;
  $("#catalogBody").hidden = !!soon;
  $("#toolbar").hidden = !!soon;
  if (soon) {
    $("#soonPanel").innerHTML = `
      <h3>${soon.flag} ${esc(fill("country.soonTitle", { country: cname(soon) }))}</h3>
      <p>${esc(fill("country.soonText", { country: cname(soon) }))}</p>
      <button type="button" class="btn-primary" id="registerInterest" data-country="${esc(soon.code)}">${esc(t("country.register"))}</button>`;
    return;
  }
  const list = filteredProducts();
  const mats = new Set(list.map((p) => p.material)).size;
  $("#catalogCount").textContent = fill("catalog.count", { g: list.length, m: mats });
  $("#viewTable").setAttribute("aria-pressed", String(view === "table"));
  $("#viewCards").setAttribute("aria-pressed", String(view === "cards"));
  const grid = $("#productGrid");
  if (!list.length) {
    grid.className = "product-grid";
    grid.innerHTML = `<div class="catalog-empty"><span>${esc(t("catalog.noMatch"))}</span>
      <button type="button" class="btn-outline" data-clear-filters>${esc(t("catalog.clearFilters"))}</button></div>`;
    return;
  }
  if (view === "cards") {
    grid.className = "product-grid";
    grid.innerHTML = list.map(cardHTML).join("");
  } else {
    grid.className = "spec-table-wrap";
    grid.innerHTML = tableHTML(list);
  }
}

function clearFilters() {
  $("#searchInput").value = "";
  $("#categoryFilter").value = "";
  $("#inStockOnly").checked = false;
  renderProducts();
  $("#searchInput").focus();
}

function qtyControl(p) {
  const id = esc(p.id);
  if (isOut(p)) return `<button type="button" class="btn-add btn-notify" data-id="${id}">${t("card.notify")}</button>`;
  const line = cart.find((c) => c.id === p.id);
  return `<input class="qty" type="number" min="${p.moq}" max="${p.stock}" step="1" value="${line ? line.qty : p.moq}" id="qty-${id}" data-line-qty="${id}" aria-label="${esc(t("calc.qty"))} — ${esc(pfull(p))}">
     <label class="rfq-check${line ? " on" : ""}"><input type="checkbox" data-include="${id}"${line ? " checked" : ""}><span>${esc(line ? t("rfq.included") : t("card.add"))}</span></label>`;
}

function tableHTML(list) {
  const th = (key, label, cls = "") => {
    const active = sortKey === key;
    const aria = active ? ` aria-sort="${sortDir > 0 ? "ascending" : "descending"}"` : "";
    return `<th class="${cls}"${aria}><button type="button" class="th-sort" data-sort="${key}">${esc(label)}<span class="sort-ind">${active ? (sortDir > 0 ? "▲" : "▼") : ""}</span></button></th>`;
  };
  const rows = list.map((p) => {
    const href = pageHref(p);
    return `<tr class="${isOut(p) ? "row-out" : ""}">
      <td class="c-mat"><a href="${href}" class="mat-link">${esc(pname(p))}</a><span class="c-cat">${isCore(p) ? `<span class="c-core">${esc(t("card.core"))}</span> · ` : ""}${esc(pcat(p.category))}</span></td>
      <td>${esc(pform(p))}</td>
      <td class="c-purity">${val(p.grade)}</td>
      <td><span class="c-flag">${flagName(p)}</span>${regionOnly(p) ? `<span class="c-sub">${esc(regionOnly(p))}</span>` : ""}</td>
      <td class="num"><strong>${fmtPrice(p.basePrice)}</strong></td>
      <td class="num">${p.moq.toLocaleString()}</td>
      <td class="num">${p.stock.toLocaleString()}<span class="c-badge">${stockBadge(p)}</span></td>
      <td class="c-act">${qtyControl(p)}</td>
    </tr>`;
  }).join("");
  return `<table class="spec-table">
    <thead><tr>
      ${th("name", t("col.material"))}${th("form", t("col.form"))}${th("purity", t("col.purity"))}${th("origin", t("col.origin"))}
      ${th("price", fill("col.price", { cur: currency }), "num")}${th("moq", t("col.moq"), "num")}${th("stock", t("col.stock"), "num")}
      <th>${esc(t("col.action"))}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function cardHTML(p) {
  const maxPct = maxDiscountFor(p);
  const others = gradesOf(p.material).length - 1;
  const more = others > 0 ? (others === 1 ? t("card.grades1") : fill("card.gradesN", { n: others })) : "";
  const href = pageHref(p);
  return `
  <article class="card">
    <a class="card-media" href="${href}" tabindex="-1" aria-hidden="true">
      ${artSVG(p)}
      <img class="card-photo" src="${imgSrc(p)}" alt="" loading="lazy" onerror="this.remove()">
    </a>
    <div class="card-top">
      <span class="c-flag">${flagName(p)}</span>
      <span>${stockBadge(p)}${maxPct ? ` <span class="badge tier">${esc(fill("card.tierBadge", { pct: maxPct }))}</span>` : ""}</span>
    </div>
    <h3><a href="${href}" class="mat-link">${esc(pname(p))}</a></h3>
    <p class="card-form">${esc(pform(p))}</p>
    <dl class="card-kv">
      <div><dt>${t("card.purity")}</dt><dd>${val(p.grade)}</dd></div>
      <div><dt>${t("card.moq")}</dt><dd>${p.moq.toLocaleString()} ${esc(unitName(p.unit))}</dd></div>
      <div><dt>${t("modal.stock")}</dt><dd>${p.stock.toLocaleString()} ${esc(unitName(p.unit))}</dd></div>
    </dl>
    ${more ? `<a class="card-more" href="${href}">${esc(more)}</a>` : ""}
    ${sparkline(p.history)}
    <div class="price-row">
      <span class="price">${fmtPrice(p.basePrice)}</span>
      <span class="per">/ ${esc(unitName(p.unit))} FOB</span>
    </div>
    <div class="card-actions">${qtyControl(p)}</div>
  </article>`;
}

/* ---------- RFQ lines (`cart`): validated quantities, volume discounts, editable lines ---------- */
function sanitizeCart(raw) {
  const out = [];
  const seen = new Set();
  (Array.isArray(raw) ? raw : []).forEach((c) => {
    const p = c && byId(c.id);
    if (!p || isOut(p) || seen.has(p.id)) return; // product removed, sold out, or duplicated
    seen.add(p.id);
    out.push({ id: p.id, qty: clampQty(p, c.qty).qty });
  });
  return out;
}

function saveCart() {
  store.setJson("ov-cart", cart);
  $("#cartCount").textContent = cart.length;
}

function setCartQty(p, rawQty) {
  const { qty, capped } = clampQty(p, rawQty);
  const existing = cart.find((c) => c.id === p.id);
  if (existing) existing.qty = qty;
  else cart.push({ id: p.id, qty });
  saveCart();
  if (capped) toast(fill("toast.maxStock", { n: p.stock.toLocaleString(), unit: unitName(p.unit) }));
  return qty;
}

function removeLine(id) {
  cart = cart.filter((c) => c.id !== id);
  saveCart();
}

function lineTotal(p, qty) {
  const pct = discountPct(p, qty);
  return { pct, total: p.basePrice * qty * (1 - pct / 100) };
}

function rfqTotals() {
  let tonnes = 0, value = 0;
  cart.forEach((c) => { const p = byId(c.id); if (p) { tonnes += c.qty; value += lineTotal(p, c.qty).total; } });
  return { n: cart.length, tonnes, value };
}

/* Plain-text RFQ lines sent with the form (always in English for the sales desk). */
function rfqLinesText() {
  return cart.map((c, i) => {
    const p = byId(c.id);
    return p ? `${i + 1}. ${pfullEn(p)} | ${p.grade} | ${c.qty.toLocaleString("en-US")} ${p.unit} | indicative FOB $${p.basePrice}/${p.unit}` : "";
  }).filter(Boolean).join("\n");
}

/* Keeps a catalog row / card in step with the RFQ without redrawing the table. */
function syncControls(id) {
  const line = cart.find((c) => c.id === id);
  document.querySelectorAll(`[data-include="${CSS.escape(id)}"]`).forEach((box) => {
    box.checked = !!line;
    box.parentElement.classList.toggle("on", !!line);
    box.nextElementSibling.textContent = line ? t("rfq.included") : t("card.add");
  });
  if (line) document.querySelectorAll(`[data-line-qty="${CSS.escape(id)}"]`).forEach((q) => { q.value = line.qty; });
}

function toggleLine(id, include, rawQty) {
  const p = byId(id);
  if (!p || isOut(p)) return;
  if (include) {
    setCartQty(p, rawQty);
    toast(fill("rfq.added", { name: pfull(p) }));
  } else {
    removeLine(id);
  }
  syncControls(id);
  renderCart();
}

/* RFQ summary bar + the line-item table at the top of the RFQ form. */
function renderCart() {
  const { n, tonnes, value } = rfqTotals();
  $("#cartCount").textContent = n;
  const bar = $("#rfqBar");
  bar.hidden = !n;
  document.body.classList.toggle("has-rfq", !!n);
  if (n) {
    bar.querySelector(".rfq-bar-text").innerHTML =
      `<strong>${esc(t("rfq.barTitle"))}</strong> ${esc(fill("rfq.bar", { n, t: tonnes.toLocaleString() }))} · ${esc(t("rfq.indicative"))} <strong>${fmtPrice(value)}</strong>`;
  }
  const box = $("#rfqLines");
  if (!n) {
    box.innerHTML = `<div class="rfq-head"><h3>${esc(t("rfq.linesTitle"))}</h3></div><p class="rfq-empty">${esc(t("rfq.empty"))}</p>`;
    return;
  }
  const rows = cart.map((c, i) => {
    const p = byId(c.id);
    if (!p) return "";
    const { pct, total } = lineTotal(p, c.qty);
    const id = esc(p.id);
    return `<tr>
      <td class="num">${i + 1}</td>
      <td><a class="mat-link" href="${pageHref(p)}">${esc(pname(p))}</a><span class="c-sub">${esc(pform(p))}</span></td>
      <td class="c-purity">${val(p.grade)}</td>
      <td class="num"><input class="qty" type="number" min="${p.moq}" max="${p.stock}" step="1" value="${c.qty}" data-line-qty="${id}" aria-label="${esc(t("calc.qty"))} — ${esc(pfull(p))}"><span class="c-sub">${esc(t("card.moq"))} ${p.moq.toLocaleString()}</span></td>
      <td class="num">${fmtPrice(p.basePrice)}</td>
      <td class="num">${pct ? pctOff(pct) : "—"}</td>
      <td class="num"><strong>${fmtPrice(total)}</strong></td>
      <td class="num"><button type="button" class="line-remove" data-remove="${id}" aria-label="${esc(t("rfq.remove"))} — ${esc(pfull(p))}" title="${esc(t("rfq.remove"))}">✕</button></td>
    </tr>`;
  }).join("");
  box.innerHTML = `<div class="rfq-head"><h3>${esc(t("rfq.linesTitle"))}</h3><button type="button" class="util-btn" data-clear-rfq>${esc(t("rfq.clear"))}</button></div>
    <div class="spec-table-wrap"><table class="spec-table rfq-table">
      <thead><tr><th class="num">#</th><th>${esc(t("rfq.grade"))}</th><th>${esc(t("col.purity"))}</th><th class="num">${esc(t("rfq.qty"))}</th>
        <th class="num">${esc(fill("rfq.unit", { cur: currency }))}</th><th class="num">${esc(t("calc.discount"))}</th><th class="num">${esc(t("rfq.value"))}</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td></td><td colspan="2">${esc(t("rfq.total"))}</td><td class="num"><strong>${tonnes.toLocaleString()} ${esc(unitName("t"))}</strong></td><td></td><td></td><td class="num"><strong>${fmtPrice(value)}</strong></td><td></td></tr></tfoot>
    </table></div>
    <p class="note">${esc(t("rfq.note"))}</p>`;
}

function goToRfq() {
  document.getElementById("contact").scrollIntoView({ behavior: "smooth" });
  const first = document.querySelector('#contactForm [name="name"]');
  if (first) first.focus({ preventScroll: true });
}

/* ---------- price history chart: real recorded prices only, spaced by date ---------- */
function chartSVG(p) {
  const h = p.history || [];
  if (h.length < 2) {
    const since = h.length ? h[0].date : LAST_UPDATED;
    return `<p class="chart-empty">${esc(fill("chart.empty", { date: fmtDate(since) }))}</p>`;
  }
  const times = h.map((e) => Date.parse(e.date + "T00:00:00Z"));
  const t0 = times[0], span = times[times.length - 1] - t0 || 1;
  const prices = h.map((e) => e.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const pad = (max - min) * 0.15 || max * 0.05 || 1; // flat history still gets visible headroom
  const lo = min - pad, hi = max + pad;
  const W = 460, H = 150, PADL = 44, PADR = 14;
  const x = (i) => PADL + ((times[i] - t0) / span) * (W - PADL - PADR);
  const y = (v) => H - 24 - ((v - lo) / (hi - lo)) * (H - 44);
  const pts = prices.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dots = prices.map((v, i) =>
    `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5"><title>${esc(fmtDate(h[i].date))}: ${esc(fmtPrice(v))}</title></circle>`
  ).join("");
  const grid = [min, max]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((v) => `<line x1="${PADL}" x2="${W - PADR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text x="${PADL - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`)
    .join("");
  return `
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("modal.chart"))}">
    <g class="chart-grid">${grid}</g>
    <polyline class="chart-line" points="${pts}"/>
    ${dots}
    <text class="chart-x" x="${PADL}" y="${H - 6}">${esc(fmtDate(h[0].date))}</text>
    <text class="chart-x" x="${W - PADR}" y="${H - 6}" text-anchor="end">${esc(fmtDate(h[h.length - 1].date))}</text>
  </svg>
  <p class="chart-note">${esc(fill("chart.note", { n: h.length }))}</p>`;
}

// recorded prices, newest first, with the change from the previous record
function historyRows(p) {
  const h = p.history || [];
  return h.map((e, i) => {
    let change = `<span class="muted">${esc(t("page.first"))}</span>`;
    if (i > 0) {
      const pct = ((e.price - h[i - 1].price) / h[i - 1].price) * 100;
      const cls = pct > 0 ? "up" : pct < 0 ? "down" : "";
      change = `<span class="${cls}">${pct > 0 ? "+" : ""}${pct.toFixed(1)}%</span>`;
    }
    return `<tr><td>${esc(fmtDate(e.date))}</td><td class="num">${fmtPrice(e.price)}</td><td class="num">${change}</td></tr>`;
  }).reverse().join("");
}

/* ---------- order calculator ---------- */
// "EXW mine site" → "EXW", "Free On Board (FOB)" → "FOB": the calculator keys its rules on the Incoterm code
const incotermCode = (term) => {
  const m = /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/i.exec(String(term || ""));
  return m ? m[1].toUpperCase() : String(term || "").trim().slice(0, 3).toUpperCase();
};

function calcHTML(p, state) {
  const s = state || {};
  const regions = Object.keys(SITE.FREIGHT)
    .map((r) => `<option value="${esc(r)}"${s.region === r ? " selected" : ""}>${esc(lang === "ar" ? AR_FREIGHT[r] || r : r)}</option>`)
    .join("");
  const term = s.term ?? SITE.INCOTERMS.find((x) => incotermCode(x) === "FOB") ?? SITE.INCOTERMS[0];
  const terms = SITE.INCOTERMS
    .map((x) => `<option value="${esc(x)}"${x === term ? " selected" : ""}>${esc(lang === "ar" ? AR_INCOTERMS[x] || x : x)}</option>`)
    .join("");
  return `
  <h3 class="side-h">${t("calc.title")}</h3>
  <div class="calc">
    <label>${t("calc.qty")}<input type="number" id="calcQty" min="${p.moq}" max="${p.stock}" step="1" value="${clampQty(p, s.qty).qty}"></label>
    <label>${t("calc.term")}<select id="calcTerm">${terms}</select></label>
    <label id="calcRegionWrap" hidden>${t("calc.region")}<select id="calcRegion">${regions}</select></label>
    <div class="calc-out" id="calcOut"></div>
    <p class="meta">${t("calc.note")}</p>
  </div>`;
}

function runCalc(p) {
  const { qty } = clampQty(p, $("#calcQty").value);
  const code = incotermCode($("#calcTerm").value);
  const isCif = code === "CIF";
  $("#calcRegionWrap").hidden = !isCif;
  const pct = discountPct(p, qty);
  let unit = p.basePrice * (1 - pct / 100);
  if (code === "EXW") unit *= 0.95; // no inland haulage or port handling
  const freight = isCif ? (Number(SITE.FREIGHT[$("#calcRegion").value]) || 0) * qty : 0;
  const total = unit * qty + freight;
  $("#calcOut").innerHTML = `
    <div><span>${t("calc.qty")}</span><strong>${qty.toLocaleString()}</strong></div>
    ${pct ? `<div><span>${t("calc.discount")}</span><strong>${pctOff(pct)}</strong></div>` : ""}
    ${isCif ? `<div><span>${t("calc.freight")}</span><strong>${fmtPrice(freight)}</strong></div>` : ""}
    <div class="calc-total"><span>${t("calc.total")}</span><strong>${fmtPrice(total)}</strong></div>`;
}

/* ---------- material page (hash route #/m/<material>/<gradeId>) ---------- */
function parseRoute(hash) {
  const m = /^#\/m\/([^/?#]+)(?:\/([^/?#]*))?$/.exec(hash || "");
  if (!m) return null;
  try {
    return { material: decodeURIComponent(m[1]), id: m[2] ? decodeURIComponent(m[2]) : "" };
  } catch (_) { return { material: "", id: "" }; } // malformed escape → "not found" page
}

const tiersText = (p) => TIERS.slice().reverse()
  .map((x) => fill("page.tierText", { pct: x.pct, qty: (x.mult * p.moq).toLocaleString(), unit: unitName(p.unit) }))
  .join(", ") || "—";

function pageSection(id, title, body) {
  return `<section class="mp-sec" id="mp-${id}"><h2>${esc(title)}</h2>${body}</section>`;
}

function mapHTML(info) {
  const loc = info && info.location;
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return "";
  const { lat, lng } = loc;
  const bbox = [lng - 1.6, lat - 1.1, lng + 1.6, lat + 1.1].map((v) => v.toFixed(3)).join(",");
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const big = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=8/${lat}/${lng}`;
  return `<div class="mp-map">
      <iframe title="${esc(t("page.mapTitle"))}" src="${esc(embed)}" loading="lazy" referrerpolicy="no-referrer"></iframe>
      <a href="${esc(big)}" target="_blank" rel="noopener">${esc(t("page.openMap"))} ↗</a>
    </div>`;
}

function renderPage(keepState) {
  const root = $("#materialPage");
  const r = pageRoute;
  const grades = r ? gradesOf(r.material) : [];
  if (!grades.length) {
    document.title = baseTitle;
    root.innerHTML = `<div class="mp-wrap"><a class="mp-back" href="#products">${esc(t("page.back"))}</a>
      <p class="chart-empty">${esc(t("page.notFound"))}</p></div>`;
    return;
  }
  const p = grades.find((g) => g.id === r.id) || grades[0];
  const state = keepState && $("#calcQty") && root.dataset.pid === p.id
    ? { qty: $("#calcQty").value, term: $("#calcTerm").value, region: $("#calcRegion").value }
    : null;
  root.dataset.pid = p.id;
  const info = matInfo(p.material);
  const txt = matText(p.material) || {};
  const out = isOut(p);
  const c = countryOf(p);
  const bench = info && info.benchmark ? BENCHMARKS.find((b) => b.name === info.benchmark) : null;
  const existing = alerts.find((a) => a.id === p.id);
  const alertDefault = existing ? existing.target : Math.max(1, Math.round(p.basePrice * 0.95));
  document.title = `${pfull(p)} | OreBridge Minerals`;

  const gradeRows = grades.map((g) => {
    const sel = g.id === p.id;
    return `<tr class="${sel ? "is-sel" : ""}">
      <td>${esc(pform(g))}</td><td class="c-purity">${val(g.grade)}</td>
      <td class="num">${fmtPrice(g.basePrice)}</td><td class="num">${g.moq.toLocaleString()}</td>
      <td class="num">${g.stock.toLocaleString()} ${stockBadge(g)}</td>
      <td>${sel ? `<span class="sel-tag">${esc(t("page.selected"))}</span>`
        : `<a class="btn-mini" href="${pageHref(g)}">${esc(t("page.select"))}</a>`}</td>
    </tr>`;
  }).join("");

  const specRows = p.specs.map(([k, v]) =>
    `<tr><th scope="row">${specLabel(k)}</th><td class="num">${val(v)}</td></tr>`).join("");

  const props = info ? `<table class="kv-table">
      <tr><th scope="row">${esc(t("page.formula"))}</th><td>${chem(info.formula)}</td></tr>
      <tr><th scope="row">${esc(t("page.hardness"))}</th><td>${esc(info.hardness)}</td></tr>
      <tr><th scope="row">${esc(t("page.density"))}</th><td>${esc(info.density)}</td></tr>
      ${txt.color ? `<tr><th scope="row">${esc(t("page.color"))}</th><td>${esc(txt.color)}</td></tr>` : ""}
      <tr><th scope="row">${esc(t("page.hs"))}</th><td><bdi dir="ltr">${esc(info.hs)}</bdi><span class="c-sub">${esc(t("page.hsNote"))}</span></td></tr>
    </table>` : "";

  const loc = info && info.location;
  const origin = `<div class="mp-origin">
      ${mapHTML(info)}
      <table class="kv-table">
        <tr><th scope="row">${esc(t("page.country"))}</th><td>${c ? `${c.flag} ${esc(cname(c))}` : esc(p.country)}</td></tr>
        <tr><th scope="row">${esc(t("page.region"))}</th><td>${esc(txt.region || porigin(p))}</td></tr>
        ${loc ? `<tr><th scope="row">${esc(t("page.coords"))}</th><td class="num">${Math.abs(loc.lat).toFixed(2)}° ${loc.lat >= 0 ? "N" : "S"}, ${Math.abs(loc.lng).toFixed(2)}° ${loc.lng >= 0 ? "E" : "W"}</td></tr>` : ""}
        ${txt.port ? `<tr><th scope="row">${esc(t("page.port"))}</th><td>${esc(txt.port)}${loc && loc.portKm ? `<span class="c-sub">${esc(fill("page.portKm", { km: loc.portKm }))}</span>` : ""}</td></tr>` : ""}
      </table>
    </div>
    <p class="note">${esc(t("page.originNote"))}</p>`;

  const steps = [1, 2, 3, 4, 5].map((n) =>
    `<li><strong>${esc(t(`page.step${n}t`))}</strong><span>${esc(t(`page.step${n}p`))}</span></li>`).join("");

  const faq = [
    ["page.faq1q", fill("page.faq1a", { moq: p.moq.toLocaleString(), unit: unitName(p.unit), tiers: tiersText(p) })],
    ["page.faq2q", t("page.faq2a")],
    ["page.faq3q", t("page.faq3a")],
    ["page.faq4q", fill("page.faq4a", { days: SITE.QUOTE_VALID_DAYS })],
    ["page.faq5q", t("page.faq5a")],
  ].map(([q, a]) => `<details><summary>${esc(t(q))}</summary><p>${esc(a)}</p></details>`).join("");

  const related = [...new Set(PRODUCTS.filter((x) => x.material !== p.material && x.category === p.category).map((x) => x.material))]
    .concat([...new Set(PRODUCTS.filter((x) => x.material !== p.material && x.category !== p.category).map((x) => x.material))])
    .slice(0, 4)
    .map((m) => {
      const gs = gradesOf(m);
      const from = Math.min(...gs.map((g) => g.basePrice));
      const g = gs[0];
      return `<a class="rel-card" href="${pageHref(g)}">
        <img src="${imgSrc(g)}" alt="" loading="lazy" onerror="this.remove()">
        <span class="rel-name">${esc(pname(g))}</span>
        <span class="rel-sub">${gs.length > 1 ? esc(fill("card.gradesCount", { n: gs.length })) + " · " : ""}${fmtPrice(from)}+ / ${esc(unitName("t"))}</span>
      </a>`;
    }).join("");

  const packaging = SITE.PACKAGING.map((x) => `<li>${esc(x)}</li>`).join("");
  const incoterms = SITE.INCOTERMS.map((x) => `<li>${esc(lang === "ar" ? AR_INCOTERMS[x] || x : x)}</li>`).join("");

  root.innerHTML = `
  <div class="mp-wrap">
    <nav class="mp-crumbs" aria-label="breadcrumb">
      <a class="mp-back" href="#products">${esc(t("page.back"))}</a>
      <span class="muted">/ ${esc(pcat(p.category))} / ${esc(pname(p))}</span>
    </nav>

    <header class="mp-head">
      <div class="mp-photo">${artSVG(p)}<img src="${imgSrc(p)}" alt="${esc(pname(p))}" onerror="this.remove()"></div>
      <div class="mp-title">
        <p class="mp-kicker">${c ? `${c.flag} ${esc(cname(c))}` : ""} · ${esc(pcat(p.category))}${info ? ` · <span class="formula">${chem(info.formula)}</span>` : ""}</p>
        <h1>${esc(pname(p))}</h1>
        <p class="mp-form">${esc(pform(p))}</p>
        <dl class="mp-facts">
          <div><dt>${esc(t("col.purity"))}</dt><dd>${val(p.grade)}</dd></div>
          <div><dt>${esc(t("page.form"))}</dt><dd>${esc(pform(p)) || "—"}</dd></div>
          <div><dt>${esc(t("modal.price"))}</dt><dd>${fmtPrice(p.basePrice)} / ${esc(unitName(p.unit))} FOB</dd></div>
          <div><dt>${esc(fill("page.stockAsOf", { date: fmtDate(LAST_UPDATED) }))}</dt><dd>${out ? esc(t("badge.out")) : `${p.stock.toLocaleString()} ${esc(unitName(p.unit))}`}</dd></div>
          <div><dt>${esc(t("modal.moq"))}</dt><dd>${p.moq.toLocaleString()} ${esc(unitName(p.unit))}</dd></div>
          <div><dt>${esc(t("page.hs"))}</dt><dd>${info ? `<bdi dir="ltr">${esc(info.hs)}</bdi>` : "—"}</dd></div>
        </dl>
      </div>
    </header>

    <div class="mp-grid">
      <div class="mp-main">
        ${pageSection("grades", t("page.grades"), `<div class="spec-table-wrap"><table class="spec-table compact">
          <thead><tr><th>${esc(t("col.form"))}</th><th>${esc(t("col.purity"))}</th><th class="num">${esc(fill("col.price", { cur: currency }))}</th>
          <th class="num">${esc(t("col.moq"))}</th><th class="num">${esc(t("col.stock"))}</th><th></th></tr></thead>
          <tbody>${gradeRows}</tbody></table></div>`)}

        ${pageSection("analysis", t("page.analysis"), (specRows
          ? `<table class="kv-table spec-kv"><thead><tr><th>${esc(t("page.parameter"))}</th><th class="num">${esc(t("page.spec"))}</th></tr></thead><tbody>${specRows}</tbody></table>`
          : "") + `<p class="note">${esc(t("page.analysisNote"))}</p>`)}

        ${pageSection("history", t("page.history"), `${chartSVG(p)}
          <table class="kv-table"><thead><tr><th>${esc(t("page.date"))}</th><th class="num">${esc(t("modal.price"))}</th><th class="num">${esc(t("page.change"))}</th></tr></thead>
          <tbody>${historyRows(p)}</tbody></table>
          ${bench ? `<h3 class="sub-h">${esc(t("page.marketRef"))}</h3>
          <div class="spec-table-wrap"><table class="market-table"><thead><tr><th>${esc(t("market.benchmark"))}</th><th>${esc(t("market.price"))}</th><th>${esc(t("market.unit"))}</th><th>${esc(t("market.change"))}</th></tr></thead>
          <tbody>${benchRowHTML(bench)}</tbody></table></div>` : ""}`)}

        ${pageSection("origin", t("page.origin"), origin)}

        ${info ? pageSection("about", t("page.about"), `
          <p>${esc(txt.summary || "")}</p>
          <h3 class="sub-h">${esc(t("page.geology"))}</h3>
          <p>${esc(txt.geology || "")}</p>
          <h3 class="sub-h">${esc(t("page.props"))}</h3>
          ${props}`) : ""}

        ${pageSection("apps", t("page.apps"), `<ul class="mp-list">${(txt.apps || [puses(p)]).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`)}

        ${pageSection("process", t("page.process"), `<ol class="mp-steps">${steps}</ol>`)}

        ${pageSection("logistics", t("page.logistics"), `<div class="mp-two">
          <div><h3 class="sub-h">${esc(t("modal.packaging"))}</h3><ul class="mp-list">${packaging}</ul></div>
          <div><h3 class="sub-h">${esc(t("modal.terms"))}</h3><ul class="mp-list">${incoterms}</ul></div>
        </div><p class="note">${esc(t("modal.cert"))}</p>`)}

        ${pageSection("faq", t("page.faq"), `<div class="mp-faq">${faq}</div>`)}

        ${related ? pageSection("related", t("page.related"), `<div class="rel-grid">${related}</div>`) : ""}
      </div>

      <aside class="mp-side">
        <div class="side-box">
          <div class="side-price"><strong>${fmtPrice(p.basePrice)}</strong><span>/ ${esc(unitName(p.unit))} FOB</span></div>
          <p class="side-stock">${stockBadge(p)} <span class="muted">${out ? "" : `${p.stock.toLocaleString()} ${esc(unitName(p.unit))} · `}${esc(fill("modal.asOf", { date: fmtDate(LAST_UPDATED) }))}</span></p>
          ${out ? "" : calcHTML(p, state)}
          <div class="side-actions">
            <button type="button" class="btn-primary" data-act="${out ? "notify" : "add"}">${esc(out ? t("modal.notifyBtn") : cart.some((c) => c.id === p.id) ? t("rfq.update") : t("page.buy"))}</button>
            <button type="button" class="btn-outline" data-act="sample">${esc(t("page.sample"))}</button>
            <div class="side-row">
              <button type="button" class="util-btn" data-act="print">${esc(t("modal.print"))}</button>
              <button type="button" class="util-btn" data-act="copy">${esc(t("page.share"))}</button>
            </div>
          </div>
        </div>
        <div class="side-box">
          <h3 class="side-h">${t("alert.title")}</h3>
          <label for="alertTarget" class="muted small">${t("alert.prompt")}</label>
          <div class="alert-row">
            <input type="number" id="alertTarget" min="1" step="1" value="${alertDefault}">
            <button class="btn-outline" type="button" data-act="alert">${t("alert.set")}</button>
          </div>
          <p class="form-note" id="alertNote" hidden>${t("alert.saved")}</p>
        </div>
      </aside>
    </div>
  </div>`;

  if (!out) {
    ["calcQty", "calcTerm", "calcRegion"].forEach((cid) =>
      $("#" + cid).addEventListener("input", () => runCalc(p)));
    // on blur/enter, snap the field itself to a valid quantity
    $("#calcQty").addEventListener("change", (e) => {
      const { qty, capped } = clampQty(p, e.target.value);
      e.target.value = qty;
      if (capped) toast(fill("toast.maxStock", { n: p.stock.toLocaleString(), unit: unitName(p.unit) }));
      runCalc(p);
    });
    runCalc(p);
  }
}

function pageAction(act) {
  const p = byId($("#materialPage").dataset.pid);
  if (!p) return;
  if (act === "add") { toggleLine(p.id, true, $("#calcQty") ? $("#calcQty").value : p.moq); renderPage(true); } // honor the calculator quantity
  else if (act === "notify") notifyMe(p);
  else if (act === "sample") goToContact(fill("page.sampleMsg", { name: pname(p), form: pform(p) }));
  else if (act === "print") printDatasheet(p);
  else if (act === "copy") copyLink();
  else if (act === "alert") {
    const target = Number($("#alertTarget").value);
    if (!Number.isFinite(target) || target <= 0) { $("#alertTarget").focus(); return; }
    alerts = alerts.filter((a) => a.id !== p.id);
    alerts.push({ id: p.id, target });
    store.setJson("ov-alerts", alerts);
    $("#alertNote").hidden = false;
    checkAlerts();
  }
}

function copyLink() {
  const url = location.href;
  const done = () => toast(t("page.copied"));
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => prompt("", url));
  } else {
    prompt("", url);
  }
}

function route() {
  const r = parseRoute(location.hash);
  if (r) {
    const sameMaterial = pageRoute && pageRoute.material === r.material;
    pageRoute = r;
    document.body.classList.add("page-mode");
    $("#materialPage").hidden = false;
    $("#mainNav").classList.remove("open");
    renderPage(false);
    if (!sameMaterial) window.scrollTo(0, 0);
    return;
  }
  if (!pageRoute) return; // normal in-page anchor: the browser scrolls by itself
  pageRoute = null;
  document.body.classList.remove("page-mode");
  $("#materialPage").hidden = true;
  $("#materialPage").innerHTML = "";
  document.title = baseTitle;
  let target = null;
  try { target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null; } catch (_) { /* bad hash */ }
  (target || $("#products")).scrollIntoView();
}

function printDatasheet(p) {
  if (!p) return;
  const w = window.open("", "_blank");
  if (!w) { toast(t("toast.popup")); return; } // popup blocked
  const c = countryOf(p);
  const info = matInfo(p.material);
  const tiers = TIERS.slice().reverse()
    .map((x) => `≥${(x.mult * p.moq).toLocaleString()} ${esc(p.unit)}: −${x.pct}%`).join(" · ");
  const specs = p.specs.map(([k, v]) => `<tr><td>${chem(k)}</td><td>${esc(v)}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(pfullEn(p))} — Datasheet</title>
    <style>body{font-family:Arial,sans-serif;max-width:720px;margin:40px auto;color:#222}
    h1{border-bottom:3px solid #0d3b66;color:#0d3b66;padding-bottom:8px;font-size:1.5em}h2{font-size:1.05em;margin-top:22px}
    td{padding:6px 12px;border:1px solid #ccc}td:first-child{width:38%;background:#f6f6f6}
    table{border-collapse:collapse;width:100%}.muted{color:#777;font-size:.85em}</style></head><body>
    <h1>OreBridge Minerals — ${esc(p.name)}</h1>
    <table>
      <tr><td>Form / condition</td><td>${esc(p.form) || "—"}</td></tr>
      <tr><td>Grade / headline purity</td><td>${chem(p.grade)}</td></tr>
      <tr><td>Category</td><td>${esc(p.category)}</td></tr>
      <tr><td>Country of origin</td><td>${c ? esc(c.name) : esc(p.country)}</td></tr>
      <tr><td>Source region</td><td>${esc(p.origin)}</td></tr>
      ${info ? `<tr><td>Chemical formula</td><td>${chem(info.formula)}</td></tr><tr><td>HS code (indicative)</td><td>${esc(info.hs)}</td></tr>` : ""}
      <tr><td>Typical uses</td><td>${esc(p.uses)}</td></tr>
      <tr><td>Indicative price</td><td>$${p.basePrice.toLocaleString()} / ${esc(p.unit)} FOB (valid ${esc(SITE.QUOTE_VALID_DAYS)} days)</td></tr>
      <tr><td>Minimum order</td><td>${p.moq.toLocaleString()} ${esc(p.unit)}</td></tr>
      ${tiers ? `<tr><td>Volume discounts</td><td>${tiers}</td></tr>` : ""}
      <tr><td>Packaging</td><td>${SITE.PACKAGING.map(esc).join(" · ")}</td></tr>
      <tr><td>Delivery terms</td><td>${SITE.INCOTERMS.map(esc).join(" · ")}</td></tr>
    </table>
    ${specs ? `<h2>Typical analysis</h2><table>${specs}</table>` : ""}
    <p class="muted">Indicative datasheet generated ${esc(LAST_UPDATED)}. Typical values; a certificate of analysis for the exact lot is provided with the formal quotation.</p>
    <script>window.print()<\/script></body></html>`);
  w.document.close();
}

/* ---------- price alerts ---------- */
function sanitizeAlerts(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((a) => a && byId(a.id) && Number(a.target) > 0)
    .map((a) => ({ id: a.id, target: Number(a.target) }));
}

function checkAlerts() {
  const hits = alerts
    .map((a) => ({ a, p: byId(a.id) }))
    .filter(({ a, p }) => p && p.basePrice <= a.target);
  const banner = $("#alertBanner");
  if (!hits.length) { banner.hidden = true; return; }
  banner.innerHTML = hits.map(({ a, p }) =>
    `<span>${esc(fill("alert.banner", { name: pfull(p), price: fmtPrice(p.basePrice), target: fmtPrice(a.target) }))}</span>`
  ).join("") + ` <button id="dismissAlerts">${t("alert.dismiss")}</button>`;
  banner.hidden = false;
  $("#dismissAlerts").addEventListener("click", () => {
    alerts = alerts.filter((a) => {
      const p = byId(a.id);
      return p && p.basePrice > a.target;
    });
    store.setJson("ov-alerts", alerts);
    banner.hidden = true;
  });
}

/* ---------- inquiry form ---------- */
function goToContact(message) {
  const msg = document.querySelector('[name="message"]');
  if (message && !msg.value.includes(message)) msg.value = msg.value.trim() ? `${msg.value.trim()}\n\n${message}` : message;
  document.getElementById("contact").scrollIntoView({ behavior: "smooth" });
  msg.focus({ preventScroll: true });
}

function notifyMe(p) {
  goToContact(fill("notify.msg", { name: pfull(p), qty: p.moq }));
}

function setFormNote(key, kind) {
  const note = $("#formNote");
  note.dataset.i18n = key; // lets a language switch re-translate the visible note
  note.textContent = t(key);
  note.className = "form-note" + (kind ? " " + kind : "");
  note.hidden = false;
}

function mailtoHref(f) {
  const subject = `RFQ — ${f.company || f.name} — OreBridge Minerals`;
  const body =
    `Name: ${f.name}\nCompany: ${f.company || "-"}\nEmail: ${f.email}\nPhone: ${f.phone || "-"}\n` +
    `Country: ${f.country}\nDestination port: ${f.port || "-"}\n` +
    `Delivery term: ${f.incoterm || "-"}\nPayment terms: ${f.payment || "-"}\n\n` +
    (f.rfq_lines ? `RFQ lines:\n${f.rfq_lines}\n\n` : "") + (f.message || "");
  return `mailto:${SITE.CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* Sends through FORM_ENDPOINT when set, else opens the buyer's email app when
   CONTACT_EMAIL is set, else says plainly that nothing was sent. */
async function submitInquiry(form) {
  const f = Object.fromEntries(new FormData(form));
  if (f._gotcha) return; // honeypot filled → bot
  delete f._gotcha;
  if (cart.length) f.rfq_lines = rfqLinesText();
  const btn = form.querySelector('[type="submit"]');

  if (SITE.FORM_ENDPOINT) {
    btn.disabled = true;
    setFormNote("form.sending", "muted");
    try {
      const r = await fetch(SITE.FORM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...f, _subject: `RFQ — ${f.company || f.name}`, language: lang }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      setFormNote("form.note");
      form.reset();
      cart = [];
      saveCart();
      renderCart();
      renderProducts();
    } catch (_) {
      if (SITE.CONTACT_EMAIL) {
        location.href = mailtoHref(f);
        setFormNote("form.mailto", "muted");
      } else {
        setFormNote("form.error", "error");
      }
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (SITE.CONTACT_EMAIL) {
    location.href = mailtoHref(f);
    setFormNote("form.mailto", "muted");
    return;
  }

  console.warn("Inquiry form is not connected: set SITE.FORM_ENDPOINT or SITE.CONTACT_EMAIL in data.js");
  setFormNote("form.notConfigured", "error");
}

/* ---------- downloads ---------- */
function downloadBlob(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500); // revoking immediately cancels the download in some browsers
}

function csvText() {
  const rows = [
    ["Material", "Form", "Category", "Grade", "Country", "Origin", "Price (USD/t)", "MOQ (t)", "Stock (t)", "Uses"],
    ...PRODUCTS.map((p) => {
      const c = countryOf(p);
      return [p.name, p.form, p.category, p.grade, c ? c.name : p.country, p.origin, p.basePrice, p.moq, p.stock, p.uses];
    }),
  ];
  const cell = (c) => {
    let s = String(c ?? "");
    if (/^[=+\-@]/.test(s) && typeof c !== "number") s = "'" + s; // spreadsheet formula injection guard
    return `"${s.replace(/"/g, '""')}"`;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"); // BOM so Excel reads UTF-8 (≥, ·)
}

function downloadCsv() {
  downloadBlob(csvText(), "text/csv;charset=utf-8", `orebridge-price-list-${LAST_UPDATED}.csv`);
}

/* ---------- SEO: Product structured data ---------- */
function injectJsonLd() {
  const ld = {
    "@context": "https://schema.org",
    "@graph": PRODUCTS.map((p) => ({
      "@type": "Product",
      name: pfullEn(p),
      image: new URL(imgSrc(p), location.href).href,
      url: new URL(pageHref(p), location.href).href,
      description: `${p.grade}. ${p.form ? p.form + ". " : ""}Origin: ${p.origin}. Uses: ${p.uses}.`,
      offers: {
        "@type": "Offer",
        price: p.basePrice,
        priceCurrency: "USD",
        availability: isOut(p) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      },
    })),
  };
  const s = document.createElement("script");
  s.type = "application/ld+json";
  s.textContent = JSON.stringify(ld);
  document.head.appendChild(s);
}

/* ---------- i18n ---------- */
function applyI18n() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.body.classList.toggle("ar", lang === "ar");
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); }); // text only, never HTML
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  $("#langToggle").textContent = lang === "ar" ? "EN" : "عربي";
  $("#themeToggle").title = $("#themeToggle").textContent; // tooltip follows the language
  $("#lastUpdated").textContent = fmtDate(LAST_UPDATED);
  $("#lastUpdatedTop").textContent = fmtDate(LAST_UPDATED);
  const inc = $("#formIncoterm");
  const keep = inc.value;
  inc.innerHTML = SITE.INCOTERMS.map((x) =>
    `<option value="${esc(x)}">${esc(lang === "ar" ? AR_INCOTERMS[x] || x : x)}</option>`).join("");
  if (keep) inc.value = keep;
  const sel = $("#categoryFilter");
  [...sel.options].forEach((o) => { if (o.value) o.textContent = pcat(o.value); });
}

function rerenderAll() {
  renderCountryTabs();
  renderProducts();
  renderCart();
  checkAlerts();
  if (pageRoute) renderPage(true);
}

function setLang(next) {
  lang = next === "ar" ? "ar" : "en";
  store.setStr("ov-lang", lang);
  applyI18n();
  renderMarket();
  rerenderAll();
}

/* ---------- init ---------- */
function init() {
  normalizeData();
  cart = sanitizeCart(store.json("ov-cart", []));
  alerts = sanitizeAlerts(store.json("ov-alerts", []));
  baseTitle = document.title;
  if (view !== "table" && view !== "cards") view = window.innerWidth < 760 ? "cards" : "table";

  // categories
  [...new Set(PRODUCTS.map((p) => p.category))].forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = pcat(c);
    $("#categoryFilter").appendChild(o);
  });

  // hero stats
  $("#statProducts").textContent = new Set(PRODUCTS.map((p) => p.material)).size;
  $("#statGrades").textContent = PRODUCTS.length;
  $("#statStock").textContent = PRODUCTS.reduce((s, p) => s + p.stock, 0).toLocaleString();
  $("#statValidity").textContent = SITE.QUOTE_VALID_DAYS;

  // theme
  const setTheme = (dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    $("#themeToggle").dataset.i18n = dark ? "theme.light" : "theme.dark";
    $("#themeToggle").textContent = t($("#themeToggle").dataset.i18n);
    $("#themeToggle").title = t($("#themeToggle").dataset.i18n);
  };
  setTheme(store.str("ov-theme") === "dark");
  $("#themeToggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    setTheme(dark);
    store.setStr("ov-theme", dark ? "dark" : "light");
  });

  // language
  $("#langToggle").addEventListener("click", () => setLang(lang === "ar" ? "en" : "ar"));

  // currency
  $("#currencyToggle").textContent = currency;
  $("#currencyToggle").addEventListener("click", () => {
    currency = currency === "USD" ? "EGP" : "USD";
    store.setStr("ov-currency", currency);
    $("#currencyToggle").textContent = currency;
    rerenderAll();
  });

  // mobile navigation
  const nav = $("#mainNav");
  const navToggle = $("#navToggle");
  const setNav = (open) => {
    nav.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
  };
  navToggle.addEventListener("click", () => setNav(!nav.classList.contains("open")));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) setNav(false); });

  // country tabs
  $("#countryTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-country]");
    if (!b) return;
    countryFilter = b.dataset.country;
    renderCountryTabs();
    renderProducts();
  });
  $("#soonPanel").addEventListener("click", (e) => {
    const b = e.target.closest("#registerInterest");
    if (!b) return;
    const c = CTRY.find((x) => x.code === b.dataset.country);
    goToContact(fill("country.interestMsg", { country: cname(c) }));
  });

  // filters, sorting, view
  ["searchInput", "categoryFilter", "inStockOnly"].forEach((id) =>
    $("#" + id).addEventListener("input", renderProducts));
  $("#sortSelect").addEventListener("input", (e) => {
    [sortKey, sortDir] = SORT_PRESETS[e.target.value] || SORT_PRESETS.name;
    renderProducts();
  });
  [["#viewTable", "table"], ["#viewCards", "cards"]].forEach(([sel, v]) =>
    $(sel).addEventListener("click", () => { view = v; store.setStr("ov-view", v); renderProducts(); }));

  // catalog: sort headers, notify buttons, add buttons (delegated)
  $("#productGrid").addEventListener("click", (e) => {
    const sortBtn = e.target.closest("[data-sort]");
    if (sortBtn) {
      const k = sortBtn.dataset.sort;
      sortDir = sortKey === k ? -sortDir : (k === "stock" ? -1 : 1);
      sortKey = k;
      const preset = Object.keys(SORT_PRESETS).find((x) => SORT_PRESETS[x][0] === sortKey && SORT_PRESETS[x][1] === sortDir);
      if (preset) $("#sortSelect").value = preset;
      renderProducts();
      const again = $(`#productGrid [data-sort="${k}"]`);
      if (again) again.focus();
      return;
    }
    if (e.target.closest("[data-clear-filters]")) { clearFilters(); return; }
    const notify = e.target.closest(".btn-notify");
    if (notify) {
      const p = byId(notify.dataset.id);
      if (p) notifyMe(p);
      return;
    }
  });
  // Include / quantity on catalog rows and cards, quantity on RFQ lines
  document.addEventListener("change", (e) => {
    const inc = e.target.closest("[data-include]");
    if (inc) {
      const q = document.getElementById("qty-" + inc.dataset.include);
      toggleLine(inc.dataset.include, inc.checked, q ? q.value : undefined);
      return;
    }
    const q = e.target.closest("[data-line-qty]");
    if (!q) return;
    const p = byId(q.dataset.lineQty);
    if (!p) return;
    if (cart.some((c) => c.id === p.id)) {
      setCartQty(p, q.value);
      syncControls(p.id);
      renderCart();
    } else {
      q.value = clampQty(p, q.value).qty; // not in the RFQ yet: just tidy the field
    }
  });

  // material page
  $("#materialPage").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b) pageAction(b.dataset.act);
  });
  window.addEventListener("hashchange", route);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    setNav(false);
  });

  // RFQ lines
  $("#cartBtn").addEventListener("click", goToRfq);
  $("#rfqReview").addEventListener("click", goToRfq);
  $("#rfqLines").addEventListener("click", (e) => {
    if (e.target.closest("[data-clear-rfq]")) {
      const ids = cart.map((c) => c.id);
      cart = [];
      saveCart();
      ids.forEach(syncControls);
      renderCart();
      return;
    }
    const id = e.target.closest("[data-remove]")?.dataset.remove;
    if (!id) return;
    removeLine(id);
    syncControls(id);
    renderCart();
  });

  $("#contactForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submitInquiry(e.target);
  });

  // CSV price list
  $("#downloadCsv").addEventListener("click", downloadCsv);

  if (SITE.CONTACT_EMAIL) {
    $("#footerEmail").textContent = SITE.CONTACT_EMAIL;
    $("#footerEmail").href = "mailto:" + SITE.CONTACT_EMAIL;
  } else {
    $("#footerEmail").remove(); // an empty link is an invisible tab stop
  }

  // WhatsApp button (shown only when a number is configured in data.js)
  const wa = String(SITE.WHATSAPP_NUMBER || "").replace(/\D/g, ""); // tolerate "+20 10…" formatting
  if (wa) {
    const fab = $("#whatsappFab");
    fab.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent("Hello OreBridge Minerals, I would like a quote.");
    fab.hidden = false;
  }

  // back to top
  const backTop = $("#backTop");
  window.addEventListener("scroll", () => {
    backTop.hidden = window.scrollY < 600;
  }, { passive: true });
  backTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  injectJsonLd();
  applyI18n();
  saveCart();
  renderMarket();
  renderCountryTabs();
  renderProducts();
  renderCart();
  checkAlerts();
  route();
  loadLive().catch(() => { /* static prices stay */ });
}

document.addEventListener("DOMContentLoaded", init);
