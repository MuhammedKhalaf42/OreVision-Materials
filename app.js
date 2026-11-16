/* ============ OreVision Materials — app logic ============ */
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
const session = {
  get(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } },
  set(key, val) { try { sessionStorage.setItem(key, val); } catch (_) { /* storage unavailable */ } },
};

/* ---------- state ---------- */
let currency = store.str("ov-currency") === "EGP" ? "EGP" : "USD";
let lang = store.str("ov-lang") === "ar" ? "ar" : "en";
let cart = [];
let alerts = [];
let usdToEgp = Number(USD_TO_EGP) > 0 ? Number(USD_TO_EGP) : 1;
let TIERS = [];

const $ = (sel) => document.querySelector(sel);
const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
const fill = (key, vars) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = (id) => PRODUCTS.find((p) => p.id === id);

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
    const trend = (Array.isArray(p.trend) ? p.trend : []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
    p.trend = trend.length >= 2 ? trend : [p.basePrice || 1, p.basePrice || 1];
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
const pname = (p) => (lang === "ar" && AR_PRODUCTS[p.id] ? AR_PRODUCTS[p.id].name : p.name);
const puses = (p) => (lang === "ar" && AR_PRODUCTS[p.id] ? AR_PRODUCTS[p.id].uses : p.uses);
const porigin = (p) => (lang === "ar" && AR_PRODUCTS[p.id] ? AR_PRODUCTS[p.id].origin : p.origin);
const pcat = (c) => (lang === "ar" ? AR_CATEGORIES[c] || c : c);
const isOut = (p) => p.stock < p.moq; // cannot fill even one minimum order

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

function sparkline(trend) {
  const min = Math.min(...trend), max = Math.max(...trend);
  const range = max - min || 1;
  const pts = trend
    .map((v, i) => `${((i / (trend.length - 1)) * 100).toFixed(1)},${(30 - ((v - min) / range) * 26 + 2).toFixed(1)}`)
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

/* ---------- overlays: scroll lock + focus restore ---------- */
let lastFocus = null;

function syncScrollLock() {
  const open = ["#cartDrawer", "#productModal", "#exitPopup"].some((s) => !$(s).hidden);
  document.body.classList.toggle("no-scroll", open);
}

function showOverlay(panel, backdrop, focusEl) {
  if (panel.hidden) lastFocus = document.activeElement;
  panel.hidden = false;
  backdrop.hidden = false;
  syncScrollLock();
  if (focusEl) focusEl.focus({ preventScroll: true });
}

function hideOverlay(panel, backdrop) {
  if (panel.hidden) return;
  panel.hidden = true;
  backdrop.hidden = true;
  syncScrollLock();
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
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

/* ---------- reference prices: ticker + table ---------- */
const benchPrice = (b) =>
  b.range ? String(b.range) : b.price.toLocaleString(undefined, { maximumFractionDigits: 2 });

function renderTicker() {
  const items = BENCHMARKS.map((b) =>
    `<span>${esc(b.name)}: <strong>${esc(benchPrice(b))} ${esc(b.unit)}</strong>${b.asOf ? ` <em class="as-of">${esc(b.asOf)}</em>` : ""}</span>`
  ).join("");
  $("#tickerTrack").innerHTML = items + items; // duplicated for seamless loop
}

function renderMarket() {
  $("#marketTable tbody").innerHTML = BENCHMARKS.map((b) =>
    `<tr>
      <td>${esc(b.name)}${b.source ? `<span class="bench-source">${esc(b.source)}</span>` : ""}</td>
      <td><strong>${esc(benchPrice(b))}</strong></td>
      <td>${esc(b.unit)}</td>
      <td>${esc(b.asOf) || "—"}</td>
    </tr>`
  ).join("");
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
  if (currency === "EGP") {
    renderProducts();
    renderCart();
    if (modalProduct) renderModal(modalProduct);
    checkAlerts();
  }
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

/* ---------- products ---------- */
function renderProducts() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const cat = $("#categoryFilter").value;
  const sort = $("#sortSelect").value;
  const inStockOnly = $("#inStockOnly").checked;

  const list = PRODUCTS.filter((p) => {
    if (cat && p.category !== cat) return false;
    if (inStockOnly && isOut(p)) return false;
    if (q) {
      const hay = [p.name, p.grade, p.uses, p.origin, p.category, pname(p), puses(p), porigin(p), pcat(p.category)]
        .join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sorters = {
    "name": (a, b) => pname(a).localeCompare(pname(b), lang),
    "price-asc": (a, b) => a.basePrice - b.basePrice,
    "price-desc": (a, b) => b.basePrice - a.basePrice,
    "stock": (a, b) => b.stock - a.stock,
  };
  list.sort(sorters[sort] || sorters.name);

  $("#productGrid").innerHTML = list.length
    ? list.map(cardHTML).join("")
    : `<p class="cart-empty">${t("catalog.noMatch")}</p>`;
  observeReveals();
}

function cardHTML(p) {
  const out = isOut(p);
  const maxPct = maxDiscountFor(p);
  const id = esc(p.id);
  return `
  <article class="card">
    <div class="card-media">
      ${artSVG(p)}
      <img class="card-photo" src="images/${encodeURIComponent(p.id)}.jpg" alt="${esc(pname(p))}" loading="lazy" onerror="this.remove()">
    </div>
    <div class="card-top">
      ${stockBadge(p)}
      ${maxPct ? `<span class="badge tier" title="${esc(t("card.volume"))} ${maxPct}%">-${maxPct}%</span>` : ""}
    </div>
    <h3><a href="#" class="detail-link" data-detail="${id}">${esc(pname(p))}</a></h3>
    <p class="meta">${esc(p.grade)}<br>${esc(porigin(p))} · ${esc(puses(p))}</p>
    ${sparkline(p.trend)}
    <div class="price-row">
      <span class="price">${fmtPrice(p.basePrice)}</span>
      <span class="per">/ ${esc(p.unit)} · ${t("card.moq")} ${p.moq} ${esc(p.unit)} · ${p.stock.toLocaleString()} ${esc(p.unit)} ${t("card.available")}</span>
    </div>
    <div class="card-actions">
      <input class="qty" type="number" min="${p.moq}" max="${p.stock}" step="1" value="${p.moq}" id="qty-${id}" aria-label="${esc(t("calc.qty"))}" ${out ? "disabled" : ""}>
      ${out
        ? `<button class="btn-add btn-notify" data-id="${id}">${t("card.notify")}</button>`
        : `<button class="btn-add" data-id="${id}">${t("card.add")}</button>`}
    </div>
  </article>`;
}

/* ---------- cart (validated quantities, volume discounts, editable lines) ---------- */
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
  if (capped) toast(fill("toast.maxStock", { n: p.stock.toLocaleString(), unit: p.unit }));
}

function addToCart(id, rawQty) {
  const p = byId(id);
  if (!p || isOut(p)) return;
  const input = document.getElementById("qty-" + id);
  setCartQty(p, rawQty ?? (input ? input.value : p.moq));
  openDrawer();
}

function lineTotal(p, qty) {
  const pct = discountPct(p, qty);
  return { pct, total: p.basePrice * qty * (1 - pct / 100) };
}

function renderCart() {
  const body = $("#cartItems");
  if (!cart.length) {
    body.innerHTML = `<p class="cart-empty">${t("drawer.empty")}</p>`;
    $("#cartTotal").textContent = fmtPrice(0);
    $("#requestQuote").disabled = true;
    return;
  }
  $("#requestQuote").disabled = false;
  let total = 0;
  body.innerHTML = cart.map((c) => {
    const p = byId(c.id);
    if (!p) return "";
    const { pct, total: line } = lineTotal(p, c.qty);
    total += line;
    const disc = pct ? ` <span class="disc">−${pct}% ${t("drawer.discount")}</span>` : "";
    const id = esc(p.id);
    return `
    <div class="cart-item">
      <div>
        <h4>${esc(pname(p))}</h4>
        <p class="meta">
          <input class="qty cart-qty" type="number" min="${p.moq}" max="${p.stock}" step="1" value="${c.qty}" data-qty="${id}" aria-label="${esc(t("calc.qty"))}">
          ${esc(p.unit)} × ${fmtPrice(p.basePrice)}${disc} = <strong>${fmtPrice(line)}</strong>
        </p>
      </div>
      <button data-remove="${id}" aria-label="${esc(t("drawer.remove"))}" title="${esc(t("drawer.remove"))}">✕</button>
    </div>`;
  }).join("");
  $("#cartTotal").textContent = fmtPrice(total);
}

function openDrawer() {
  renderCart();
  showOverlay($("#cartDrawer"), $("#drawerBackdrop"), $("#closeDrawer"));
}
function closeDrawer() {
  hideOverlay($("#cartDrawer"), $("#drawerBackdrop"));
}

/* ---------- 90-day price series + chart ---------- */
function series90(p) {
  const rnd = seededRand(p.id + "-series");
  const anchors = p.trend; // normalizeData guarantees length >= 2
  const out = [];
  for (let d = 0; d < 90; d++) {
    const pos = (d / 89) * (anchors.length - 1);
    const i = Math.min(Math.floor(pos), anchors.length - 2);
    const frac = pos - i;
    const base = anchors[i] + (anchors[i + 1] - anchors[i]) * frac;
    out.push(base * (1 + (rnd() - 0.5) * 0.02));
  }
  return out;
}

function chartSVG(p) {
  const data = series90(p);
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const W = 460, H = 140, PAD = 34;
  const x = (i) => PAD + (i / (data.length - 1)) * (W - PAD - 10);
  const y = (v) => H - 20 - ((v - min) / range) * (H - 40);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const grid = [min, (min + max) / 2, max]
    .map((v) => `<line x1="${PAD}" x2="${W - 10}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text x="${PAD - 4}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`)
    .join("");
  return `
  <h4>${t("modal.chart")}</h4>
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("modal.chart"))}">
    <g class="chart-grid">${grid}</g>
    <polyline class="chart-line" points="${pts}"/>
    <text class="chart-x" x="${PAD}" y="${H - 4}">-90d</text>
    <text class="chart-x" x="${W - 10}" y="${H - 4}" text-anchor="end">${esc(LAST_UPDATED)}</text>
  </svg>`;
}

/* ---------- order calculator ---------- */
function calcHTML(p, state) {
  const s = state || {};
  const regions = Object.keys(SITE.FREIGHT)
    .map((r) => `<option value="${esc(r)}"${s.region === r ? " selected" : ""}>${esc(lang === "ar" ? AR_FREIGHT[r] || r : r)}</option>`)
    .join("");
  const terms = SITE.INCOTERMS
    .map((x, i) => `<option value="${i}"${String(s.term) === String(i) ? " selected" : ""}>${esc(lang === "ar" ? AR_INCOTERMS[x] || x : x)}</option>`)
    .join("");
  return `
  <h4>${t("calc.title")}</h4>
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
  const termIdx = Number($("#calcTerm").value) || 0;
  const isCif = termIdx === 2;
  $("#calcRegionWrap").hidden = !isCif;
  const pct = discountPct(p, qty);
  let unit = p.basePrice * (1 - pct / 100);
  if (termIdx === 0) unit *= 0.95; // EXW: no port handling
  const freight = isCif ? (Number(SITE.FREIGHT[$("#calcRegion").value]) || 0) * qty : 0;
  const total = unit * qty + freight;
  $("#calcOut").innerHTML = `
    <div><span>${t("calc.qty")}</span><strong>${qty.toLocaleString()}</strong></div>
    ${pct ? `<div><span>${t("calc.discount")}</span><strong>−${pct}%</strong></div>` : ""}
    ${isCif ? `<div><span>${t("calc.freight")}</span><strong>${fmtPrice(freight)}</strong></div>` : ""}
    <div class="calc-total"><span>${t("calc.total")}</span><strong>${fmtPrice(total)}</strong></div>`;
}

/* ---------- product detail modal ---------- */
let modalProduct = null;

function renderModal(p) {
  // keep whatever the buyer already typed when the modal re-renders (language / currency switch)
  const state = $("#calcQty")
    ? { qty: $("#calcQty").value, term: $("#calcTerm").value, region: $("#calcRegion").value }
    : null;
  $("#modalTitle").textContent = pname(p);
  const out = isOut(p);
  const packaging = SITE.PACKAGING.map((x) => `<li>${esc(x)}</li>`).join("");
  const incoterms = SITE.INCOTERMS
    .map((x) => `<li>${esc(lang === "ar" ? AR_INCOTERMS[x] || x : x)}</li>`)
    .join("");
  const existing = alerts.find((a) => a.id === p.id);
  const alertDefault = existing ? existing.target : Math.max(1, Math.round(p.basePrice * 0.95));
  $("#modalBody").innerHTML = `
    <img class="modal-photo" src="images/${encodeURIComponent(p.id)}.jpg" alt="${esc(pname(p))}" onerror="this.remove()">
    <div class="spec-grid">
      <div><span>${t("modal.category")}</span><strong>${esc(pcat(p.category))}</strong></div>
      <div><span>${t("modal.grade")}</span><strong>${esc(p.grade)}</strong></div>
      <div><span>${t("modal.origin")}</span><strong>${esc(porigin(p))}</strong></div>
      <div><span>${t("modal.uses")}</span><strong>${esc(puses(p))}</strong></div>
      <div><span>${t("modal.price")}</span><strong>${fmtPrice(p.basePrice)} / ${esc(p.unit)}</strong></div>
      <div><span>${t("modal.moq")}</span><strong>${p.moq} ${esc(p.unit)}</strong></div>
      <div><span>${t("modal.stock")}</span><strong>${out ? t("badge.out") : p.stock.toLocaleString() + " " + esc(p.unit)}</strong></div>
      <div><span>${t("modal.validity")}</span><strong>${esc(SITE.QUOTE_VALID_DAYS)} ${t("modal.days")}</strong></div>
    </div>
    ${chartSVG(p)}
    ${out ? "" : calcHTML(p, state)}
    <h4>${t("modal.packaging")}</h4>
    <ul>${packaging}</ul>
    <h4>${t("modal.terms")}</h4>
    <ul>${incoterms}</ul>
    <h4>${t("alert.title")}</h4>
    <div class="alert-box">
      <label for="alertTarget">${t("alert.prompt")}</label>
      <div class="alert-row">
        <input type="number" id="alertTarget" min="1" step="1" value="${alertDefault}">
        <button class="btn-outline" id="setAlert" type="button">${t("alert.set")}</button>
      </div>
      <p class="form-note" id="alertNote" hidden>${t("alert.saved")}</p>
    </div>
    <p class="meta">${t("modal.cert")}</p>`;
  $("#modalAdd").textContent = out ? t("modal.notifyBtn") : t("modal.add");

  if (!out) {
    ["calcQty", "calcTerm", "calcRegion"].forEach((cid) =>
      $("#" + cid).addEventListener("input", () => runCalc(p)));
    // on blur/enter, snap the field itself to a valid quantity
    $("#calcQty").addEventListener("change", (e) => {
      const { qty, capped } = clampQty(p, e.target.value);
      e.target.value = qty;
      if (capped) toast(fill("toast.maxStock", { n: p.stock.toLocaleString(), unit: p.unit }));
      runCalc(p);
    });
    runCalc(p);
  }
  $("#setAlert").addEventListener("click", () => {
    const target = Number($("#alertTarget").value);
    if (!Number.isFinite(target) || target <= 0) { $("#alertTarget").focus(); return; }
    alerts = alerts.filter((a) => a.id !== p.id);
    alerts.push({ id: p.id, target });
    store.setJson("ov-alerts", alerts);
    $("#alertNote").hidden = false;
    checkAlerts();
  });
}

function openModal(id) {
  const p = byId(id);
  if (!p) return;
  modalProduct = p;
  renderModal(p);
  showOverlay($("#productModal"), $("#modalBackdrop"), $("#closeModal"));
  $("#productModal").scrollTop = 0;
}

function closeModal() {
  hideOverlay($("#productModal"), $("#modalBackdrop"));
  $("#modalBody").innerHTML = "";
  modalProduct = null;
}

function printDatasheet() {
  const p = modalProduct;
  if (!p) return;
  const w = window.open("", "_blank");
  if (!w) { toast(t("toast.popup")); return; } // popup blocked
  const tiers = TIERS.slice().reverse()
    .map((x) => `≥${(x.mult * p.moq).toLocaleString()} ${esc(p.unit)}: −${x.pct}%`).join(" · ");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.name)} — Datasheet</title>
    <style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#222}
    h1{border-bottom:3px solid #f5a623;padding-bottom:8px}td{padding:6px 12px;border:1px solid #ccc}
    table{border-collapse:collapse;width:100%}.muted{color:#777;font-size:.85em}</style></head><body>
    <h1>OreVision Materials — ${esc(p.name)}</h1>
    <table>
      <tr><td>Grade / Specification</td><td>${esc(p.grade)}</td></tr>
      <tr><td>Category</td><td>${esc(p.category)}</td></tr>
      <tr><td>Origin</td><td>${esc(p.origin)}</td></tr>
      <tr><td>Typical uses</td><td>${esc(p.uses)}</td></tr>
      <tr><td>Indicative price</td><td>$${p.basePrice.toLocaleString()} / ${esc(p.unit)} (valid ${esc(SITE.QUOTE_VALID_DAYS)} days)</td></tr>
      <tr><td>Minimum order</td><td>${p.moq} ${esc(p.unit)}</td></tr>
      ${tiers ? `<tr><td>Volume discounts</td><td>${tiers}</td></tr>` : ""}
      <tr><td>Packaging</td><td>${SITE.PACKAGING.map(esc).join(" · ")}</td></tr>
      <tr><td>Delivery terms</td><td>${SITE.INCOTERMS.map(esc).join(" · ")}</td></tr>
    </table>
    <p class="muted">Indicative datasheet generated ${esc(LAST_UPDATED)}. Certified assay provided with formal quotation.</p>
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
    `<span>${esc(fill("alert.banner", { name: pname(p), price: fmtPrice(p.basePrice), target: fmtPrice(a.target) }))}</span>`
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
  if (message != null) msg.value = message;
  closeModal();
  closeDrawer();
  closePopup();
  document.getElementById("contact").scrollIntoView({ behavior: "smooth" });
  msg.focus({ preventScroll: true });
}

function notifyMe(p) {
  goToContact(fill("notify.msg", { name: pname(p), qty: p.moq }));
}

function setFormNote(key, kind) {
  const note = $("#formNote");
  note.dataset.i18n = key; // lets a language switch re-translate the visible note
  note.textContent = t(key);
  note.className = "form-note" + (kind ? " " + kind : "");
  note.hidden = false;
}

function mailtoHref(f) {
  const subject = "Inquiry — OreVision Materials";
  const body =
    `Name: ${f.name}\nEmail: ${f.email}\nCompany: ${f.company || "-"}\n` +
    `Country: ${f.country}\n\n${f.message || ""}`;
  return `mailto:${SITE.CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* Sends through FORM_ENDPOINT when set, else opens the buyer's email app when
   CONTACT_EMAIL is set, else says plainly that nothing was sent. */
async function submitInquiry(form) {
  const f = Object.fromEntries(new FormData(form));
  if (f._gotcha) return; // honeypot filled → bot
  delete f._gotcha;
  const btn = form.querySelector('[type="submit"]');

  if (SITE.FORM_ENDPOINT) {
    btn.disabled = true;
    setFormNote("form.sending", "muted");
    try {
      const r = await fetch(SITE.FORM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...f, _subject: "Inquiry — OreVision Materials", language: lang }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      setFormNote("form.note");
      form.reset();
      $("#quoteNote").hidden = true;
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

function downloadCsv() {
  const rows = [
    ["Material", "Category", "Grade", "Origin", "Price (USD/t)", "MOQ (t)", "Stock (t)", "Uses"],
    ...PRODUCTS.map((p) => [p.name, p.category, p.grade, p.origin, p.basePrice, p.moq, p.stock, p.uses]),
  ];
  const cell = (c) => {
    let s = String(c ?? "");
    if (/^[=+\-@]/.test(s) && typeof c !== "number") s = "'" + s; // spreadsheet formula injection guard
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"); // BOM so Excel reads UTF-8 (≥, ·)
  downloadBlob(csv, "text/csv;charset=utf-8", `orevision-price-list-${LAST_UPDATED}.csv`);
}

/* ---------- SEO: Product structured data ---------- */
function injectJsonLd() {
  const ld = {
    "@context": "https://schema.org",
    "@graph": PRODUCTS.map((p) => ({
      "@type": "Product",
      name: p.name,
      image: new URL(`images/${encodeURIComponent(p.id)}.jpg`, location.href).href,
      description: `${p.grade}. Origin: ${p.origin}. Uses: ${p.uses}.`,
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
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = t(el.dataset.i18n);
    if (v.includes("<br>")) el.innerHTML = v; else el.textContent = v;
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  $("#langToggle").textContent = lang === "ar" ? "EN" : "عربي";
  const sel = $("#categoryFilter");
  [...sel.options].forEach((o) => { if (o.value) o.textContent = pcat(o.value); });
}

function setLang(next) {
  lang = next === "ar" ? "ar" : "en";
  store.setStr("ov-lang", lang);
  applyI18n();
  renderProducts();
  renderCart();
  renderTicker();
  renderMarket();
  checkAlerts();
  if (modalProduct) renderModal(modalProduct);
}

/* ---------- exit popup ---------- */
function closePopup() {
  hideOverlay($("#exitPopup"), $("#popupBackdrop"));
}

function setupExitPopup() {
  const show = () => {
    if (session.get("ov-popup")) return;
    // don't interrupt a buyer who is in the middle of something
    if (!$("#cartDrawer").hidden || !$("#productModal").hidden) return;
    session.set("ov-popup", "1");
    showOverlay($("#exitPopup"), $("#popupBackdrop"), $("#popupClose"));
  };
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget && e.clientY <= 0) show();
  });
  $("#popupClose").addEventListener("click", closePopup);
  $("#popupBackdrop").addEventListener("click", closePopup);
  $("#popupCsv").addEventListener("click", () => { downloadCsv(); closePopup(); });
  $("#popupSubscribe").addEventListener("click", () => {
    const field = $("#popupEmail");
    const email = field.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { field.focus(); field.classList.add("invalid"); return; }
    field.classList.remove("invalid");
    document.querySelector('[name="email"]').value = email;
    goToContact(t("popup.subscribeMsg"));
  });
}

/* ---------- scroll reveal ---------- */
const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); revealObserver.unobserve(e.target); }
      });
    }, { threshold: 0.12 })
  : null;

function observeReveals() {
  if (!revealObserver) return; // without the observer, content simply stays visible
  document.querySelectorAll(".card, .feature, .section-head, .docs-box").forEach((el) => {
    if (!el.classList.contains("in")) { el.classList.add("reveal"); revealObserver.observe(el); }
  });
}

/* ---------- init ---------- */
function init() {
  normalizeData();
  cart = sanitizeCart(store.json("ov-cart", []));
  alerts = sanitizeAlerts(store.json("ov-alerts", []));

  $("#lastUpdated").textContent = LAST_UPDATED;

  // categories
  [...new Set(PRODUCTS.map((p) => p.category))].forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = pcat(c);
    $("#categoryFilter").appendChild(o);
  });

  // hero stats
  $("#statProducts").textContent = PRODUCTS.length;
  $("#statStock").textContent = PRODUCTS.reduce((s, p) => s + p.stock, 0).toLocaleString();

  // theme
  if (store.str("ov-theme") === "light") document.documentElement.dataset.theme = "light";
  $("#themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "" : "light";
    document.documentElement.dataset.theme = next;
    store.setStr("ov-theme", next);
  });

  // language
  $("#langToggle").addEventListener("click", () => setLang(lang === "ar" ? "en" : "ar"));

  // currency
  $("#currencyToggle").textContent = currency;
  $("#currencyToggle").addEventListener("click", () => {
    currency = currency === "USD" ? "EGP" : "USD";
    store.setStr("ov-currency", currency);
    $("#currencyToggle").textContent = currency;
    renderProducts();
    renderCart();
    checkAlerts();
    if (modalProduct) renderModal(modalProduct);
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

  // filters
  ["searchInput", "categoryFilter", "sortSelect", "inStockOnly"].forEach((id) =>
    $("#" + id).addEventListener("input", renderProducts)
  );

  // product grid: detail links, notify buttons, add buttons (delegated)
  $("#productGrid").addEventListener("click", (e) => {
    const link = e.target.closest(".detail-link");
    if (link) {
      e.preventDefault();
      openModal(link.dataset.detail);
      return;
    }
    const notify = e.target.closest(".btn-notify");
    if (notify) {
      const p = byId(notify.dataset.id);
      if (p) notifyMe(p);
      return;
    }
    const btn = e.target.closest(".btn-add");
    if (!btn || btn.disabled) return;
    addToCart(btn.dataset.id);
  });

  // modal
  $("#closeModal").addEventListener("click", closeModal);
  $("#modalBackdrop").addEventListener("click", closeModal);
  $("#printDatasheet").addEventListener("click", printDatasheet);
  $("#modalAdd").addEventListener("click", () => {
    const p = modalProduct;
    if (!p) return;
    if (isOut(p)) { notifyMe(p); return; }
    const qty = $("#calcQty") ? $("#calcQty").value : p.moq; // honor the calculator quantity
    closeModal();
    addToCart(p.id, qty);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#exitPopup").hidden) closePopup();
    else if (!$("#productModal").hidden) closeModal();
    else if (!$("#cartDrawer").hidden) closeDrawer();
    else setNav(false);
  });

  // cart
  $("#cartBtn").addEventListener("click", openDrawer);
  $("#closeDrawer").addEventListener("click", closeDrawer);
  $("#drawerBackdrop").addEventListener("click", closeDrawer);
  $("#cartItems").addEventListener("click", (e) => {
    const id = e.target.closest("[data-remove]")?.dataset.remove;
    if (!id) return;
    cart = cart.filter((c) => c.id !== id);
    saveCart();
    renderCart();
  });
  $("#cartItems").addEventListener("change", (e) => {
    const input = e.target.closest("[data-qty]");
    if (!input) return;
    const p = byId(input.dataset.qty);
    if (!p) return;
    setCartQty(p, input.value);
    renderCart();
  });

  $("#requestQuote").addEventListener("click", () => {
    if (!cart.length) return;
    const lines = cart.map((c) => {
      const p = byId(c.id);
      return p ? `• ${p.name}: ${c.qty.toLocaleString()} ${p.unit}` : "";
    }).filter(Boolean).join("\n");
    $("#quoteNote").hidden = false;
    goToContact(t("quote.header") + "\n" + lines + "\n\n" + t("quote.dest"));
  });

  $("#contactForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submitInquiry(e.target);
  });

  // CSV price list
  $("#downloadCsv").addEventListener("click", downloadCsv);

  // WhatsApp button (shown only when a number is configured in data.js)
  const wa = String(SITE.WHATSAPP_NUMBER || "").replace(/\D/g, ""); // tolerate "+20 10…" formatting
  if (wa) {
    const fab = $("#whatsappFab");
    fab.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent("Hello OreVision, I would like a quote.");
    fab.hidden = false;
  }

  // back to top
  const backTop = $("#backTop");
  window.addEventListener("scroll", () => {
    backTop.hidden = window.scrollY < 600;
  }, { passive: true });
  backTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  setupExitPopup();
  injectJsonLd();
  applyI18n();
  saveCart();
  renderTicker();
  renderMarket();
  renderProducts();
  renderCart();
  checkAlerts();
  loadLive().catch(() => { /* static prices stay */ });
}

document.addEventListener("DOMContentLoaded", init);
