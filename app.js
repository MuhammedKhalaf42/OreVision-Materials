/* ============ OreVision Materials — app logic ============ */

let currency = localStorage.getItem("ov-currency") || "USD";
let lang = localStorage.getItem("ov-lang") || "en";
let cart = JSON.parse(localStorage.getItem("ov-cart") || "[]");
let alerts = JSON.parse(localStorage.getItem("ov-alerts") || "[]");

const $ = (sel) => document.querySelector(sel);
const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
const fill = (key, vars) =>
  t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

/* ---------- localized product fields ---------- */
const pname = (p) => (lang === "ar" && AR_PRODUCTS[p.id] ? AR_PRODUCTS[p.id].name : p.name);
const puses = (p) => (lang === "ar" && AR_PRODUCTS[p.id] ? AR_PRODUCTS[p.id].uses : p.uses);
const porigin = (p) => (lang === "ar" && AR_PRODUCTS[p.id] ? AR_PRODUCTS[p.id].origin : p.origin);
const pcat = (c) => (lang === "ar" ? AR_CATEGORIES[c] || c : c);

/* ---------- helpers ---------- */
let usdToEgp = USD_TO_EGP;

function fmtPrice(usd) {
  if (currency === "EGP") {
    return "E£" + Math.round(usd * usdToEgp).toLocaleString();
  }
  const v = Math.round(usd * 100) / 100;
  return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function stockBadge(p) {
  if (p.stock <= 0) return `<span class="badge out">${t("badge.out")}</span>`;
  if (p.stock < p.moq * 20) return `<span class="badge low">${t("badge.low")}</span>`;
  return `<span class="badge in">${t("badge.in")}</span>`;
}

function discountPct(p, qty) {
  for (const tier of SITE.DISCOUNT_TIERS) {
    if (qty >= tier.mult * p.moq) return tier.pct;
  }
  return 0;
}
const maxDiscount = () => Math.max(...SITE.DISCOUNT_TIERS.map((x) => x.pct));

function sparkline(trend) {
  const min = Math.min(...trend), max = Math.max(...trend);
  const range = max - min || 1;
  const pts = trend
    .map((v, i) => `${(i / (trend.length - 1)) * 100},${30 - ((v - min) / range) * 26 + 2}`)
    .join(" ");
  return `<svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

/* ---------- procedural card art (strata by category) ---------- */
const CAT_HUE = {
  "Industrial Minerals": 36,
  "Fertilizer Minerals": 95,
  "Construction Minerals": 18,
  "Metallic Ores": 210,
};

function seededRand(seed) {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
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
    let d = `M0 ${yBase + rnd() * 8}`;
    for (let x = 20; x <= 200; x += 20) d += ` L${x} ${yBase + rnd() * 14 - 4}`;
    d += ` L200 80 L0 80 Z`;
    const l = 26 - i * 4;
    layers += `<path d="${d}" fill="hsl(${hue} ${40 + i * 8}% ${l}%)"/>`;
  }
  return `<svg class="card-art" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">
    <rect width="200" height="80" fill="hsl(${hue} 30% 14%)"/>${layers}
    <text x="100" y="48" text-anchor="middle" font-size="30" fill="hsl(${hue} 80% 65%)" opacity=".9">${p.icon}</text>
  </svg>`;
}

/* ---------- ticker ---------- */
function renderTicker() {
  const items = BENCHMARKS.map((b) => {
    const cls = b.change >= 0 ? "up" : "down";
    const arrow = b.change >= 0 ? "▲" : "▼";
    const live = b.live ? ` <em class="live-dot" title="${t("market.live")}">●</em>` : "";
    return `<span>${b.name}: <strong>${b.price.toLocaleString()} ${b.unit}</strong> <span class="${cls}">${arrow} ${Math.abs(b.change)}%</span>${live}</span>`;
  }).join("");
  $("#tickerTrack").innerHTML = items + items; // duplicated for seamless loop
}

/* ---------- market table ---------- */
function renderMarket() {
  $("#marketTable tbody").innerHTML = BENCHMARKS.map((b) => {
    const cls = b.change >= 0 ? "up" : "down";
    const arrow = b.change >= 0 ? "▲" : "▼";
    const live = b.live ? ` <span class="live-badge">${t("market.live")}</span>` : "";
    return `<tr><td>${b.name}${live}</td><td><strong>${b.price.toLocaleString()}</strong></td><td>${b.unit}</td><td class="${cls}">${arrow} ${Math.abs(b.change)}%</td></tr>`;
  }).join("");
}

/* ---------- live prices (graceful: static values stay on any failure) ---------- */
async function fetchLive() {
  // FX: USD → EGP
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    const j = await r.json();
    if (j && j.rates && j.rates.EGP > 10 && j.rates.EGP < 500) {
      usdToEgp = j.rates.EGP;
      if (currency === "EGP") { renderProducts(); renderCart(); }
    }
  } catch (_) { /* keep static rate */ }

  // Metals: gold (USD/oz) and copper
  const updates = [
    { symbol: "XAU", match: "Gold", convert: (v) => v },
    { symbol: "HG", match: "Copper", convert: (v) => (v < 100 ? v * 2204.62 : v) }, // per-lb → per-t
  ];
  let changed = false;
  for (const u of updates) {
    try {
      const r = await fetch("https://api.gold-api.com/price/" + u.symbol);
      const j = await r.json();
      const b = BENCHMARKS.find((x) => x.name.startsWith(u.match));
      if (b && j && typeof j.price === "number") {
        const v = Math.round(u.convert(j.price));
        // sanity window: ignore values wildly off the static benchmark
        if (v > b.price * 0.5 && v < b.price * 2) {
          b.change = +((v / b.price - 1) * 100).toFixed(1);
          b.price = v;
          b.live = true;
          changed = true;
        }
      }
    } catch (_) { /* keep static value */ }
  }
  if (changed) { renderTicker(); renderMarket(); }
  checkAlerts();
}

/* ---------- products ---------- */
function renderProducts() {
  const q = $("#searchInput").value.trim().toLowerCase();
  const cat = $("#categoryFilter").value;
  const sort = $("#sortSelect").value;
  const inStockOnly = $("#inStockOnly").checked;

  let list = PRODUCTS.filter((p) => {
    if (cat && p.category !== cat) return false;
    if (inStockOnly && p.stock <= 0) return false;
    if (q && !(p.name + p.grade + p.uses + p.origin + pname(p) + puses(p)).toLowerCase().includes(q)) return false;
    return true;
  });

  const sorters = {
    "name": (a, b) => pname(a).localeCompare(pname(b)),
    "price-asc": (a, b) => a.basePrice - b.basePrice,
    "price-desc": (a, b) => b.basePrice - a.basePrice,
    "stock": (a, b) => b.stock - a.stock,
  };
  list.sort(sorters[sort]);

  $("#productGrid").innerHTML = list.length
    ? list.map(cardHTML).join("")
    : `<p class="cart-empty">${t("catalog.noMatch")}</p>`;
  observeReveals();
}

function cardHTML(p) {
  const out = p.stock <= 0;
  return `
  <article class="card">
    ${artSVG(p)}
    <div class="card-top">
      ${stockBadge(p)}
      <span class="badge tier" title="${t("card.volume")} ${maxDiscount()}%">-${maxDiscount()}%</span>
    </div>
    <h3><a href="#" class="detail-link" data-detail="${p.id}">${pname(p)}</a></h3>
    <p class="meta">${p.grade}<br>${porigin(p)} · ${puses(p)}</p>
    ${sparkline(p.trend)}
    <div class="price-row">
      <span class="price">${fmtPrice(p.basePrice)}</span>
      <span class="per">/ ${p.unit} · ${t("card.moq")} ${p.moq} ${p.unit} · ${p.stock.toLocaleString()} ${p.unit} ${t("card.available")}</span>
    </div>
    <div class="card-actions">
      <input class="qty" type="number" min="${p.moq}" step="1" value="${p.moq}" id="qty-${p.id}" aria-label="Quantity in tonnes" ${out ? "disabled" : ""}>
      ${out
        ? `<button class="btn-add btn-notify" data-id="${p.id}">${t("card.notify")}</button>`
        : `<button class="btn-add" data-id="${p.id}">${t("card.add")}</button>`}
    </div>
  </article>`;
}

/* ---------- cart (with volume discounts) ---------- */
function saveCart() {
  localStorage.setItem("ov-cart", JSON.stringify(cart));
  $("#cartCount").textContent = cart.length;
}

function addToCart(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  const input = $(`#qty-${id}`);
  const qty = Math.max(p.moq, (input && parseInt(input.value, 10)) || p.moq);
  const existing = cart.find((c) => c.id === id);
  if (existing) existing.qty = qty;
  else cart.push({ id, qty });
  saveCart();
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
    return;
  }
  let total = 0;
  body.innerHTML = cart.map((c) => {
    const p = PRODUCTS.find((x) => x.id === c.id);
    const { pct, total: line } = lineTotal(p, c.qty);
    total += line;
    const disc = pct ? ` <span class="disc">−${pct}% ${t("drawer.discount")}</span>` : "";
    return `
    <div class="cart-item">
      <div>
        <h4>${pname(p)}</h4>
        <p class="meta">${c.qty.toLocaleString()} ${p.unit} × ${fmtPrice(p.basePrice)}${disc} = <strong>${fmtPrice(line)}</strong></p>
      </div>
      <button data-remove="${c.id}" title="Remove">✕</button>
    </div>`;
  }).join("");
  $("#cartTotal").textContent = fmtPrice(total);
}

function openDrawer() {
  renderCart();
  $("#cartDrawer").hidden = false;
  $("#drawerBackdrop").hidden = false;
}
function closeDrawer() {
  $("#cartDrawer").hidden = true;
  $("#drawerBackdrop").hidden = true;
}

/* ---------- 90-day price series + chart ---------- */
function series90(p) {
  const rnd = seededRand(p.id + "-series");
  const anchors = p.trend;
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
    .map((v) => `<line x1="${PAD}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}"/>
      <text x="${PAD - 4}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`)
    .join("");
  return `
  <h4>${t("modal.chart")}</h4>
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("modal.chart")}">
    <g class="chart-grid">${grid}</g>
    <polyline class="chart-line" points="${pts}"/>
    <text class="chart-x" x="${PAD}" y="${H - 4}">-90d</text>
    <text class="chart-x" x="${W - 10}" y="${H - 4}" text-anchor="end">${LAST_UPDATED}</text>
  </svg>`;
}

/* ---------- order calculator ---------- */
function calcHTML(p) {
  const regions = Object.keys(SITE.FREIGHT)
    .map((r) => `<option value="${r}">${lang === "ar" ? AR_FREIGHT[r] || r : r}</option>`)
    .join("");
  const terms = SITE.INCOTERMS
    .map((x, i) => `<option value="${i}">${lang === "ar" ? AR_INCOTERMS[x] || x : x}</option>`)
    .join("");
  return `
  <h4>${t("calc.title")}</h4>
  <div class="calc">
    <label>${t("calc.qty")}<input type="number" id="calcQty" min="${p.moq}" step="1" value="${p.moq}"></label>
    <label>${t("calc.term")}<select id="calcTerm">${terms}</select></label>
    <label id="calcRegionWrap" hidden>${t("calc.region")}<select id="calcRegion">${regions}</select></label>
    <div class="calc-out" id="calcOut"></div>
    <p class="meta">${t("calc.note")}</p>
  </div>`;
}

function runCalc(p) {
  const qty = Math.max(p.moq, parseInt($("#calcQty").value, 10) || p.moq);
  const termIdx = +$("#calcTerm").value;
  const isCif = termIdx === 2;
  $("#calcRegionWrap").hidden = !isCif;
  const pct = discountPct(p, qty);
  let unit = p.basePrice * (1 - pct / 100);
  if (termIdx === 0) unit *= 0.95; // EXW: no port handling
  let freight = 0;
  if (isCif) freight = (SITE.FREIGHT[$("#calcRegion").value] || 0) * qty;
  const total = unit * qty + freight;
  $("#calcOut").innerHTML = `
    ${pct ? `<div><span>${t("calc.discount")}</span><strong>−${pct}%</strong></div>` : ""}
    ${isCif ? `<div><span>${t("calc.freight")}</span><strong>${fmtPrice(freight)}</strong></div>` : ""}
    <div class="calc-total"><span>${t("calc.total")}</span><strong>${fmtPrice(total)}</strong></div>`;
}

/* ---------- product detail modal ---------- */
let modalProduct = null;

function openModal(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  modalProduct = p;
  $("#modalTitle").textContent = pname(p);
  const out = p.stock <= 0;
  const packaging = SITE.PACKAGING.map((x) => `<li>${x}</li>`).join("");
  const incoterms = SITE.INCOTERMS
    .map((x) => `<li>${lang === "ar" ? AR_INCOTERMS[x] || x : x}</li>`)
    .join("");
  $("#modalBody").innerHTML = `
    <div class="spec-grid">
      <div><span>${t("modal.category")}</span><strong>${pcat(p.category)}</strong></div>
      <div><span>${t("modal.grade")}</span><strong>${p.grade}</strong></div>
      <div><span>${t("modal.origin")}</span><strong>${porigin(p)}</strong></div>
      <div><span>${t("modal.uses")}</span><strong>${puses(p)}</strong></div>
      <div><span>${t("modal.price")}</span><strong>${fmtPrice(p.basePrice)} / ${p.unit}</strong></div>
      <div><span>${t("modal.moq")}</span><strong>${p.moq} ${p.unit}</strong></div>
      <div><span>${t("modal.stock")}</span><strong>${out ? t("badge.out") : p.stock.toLocaleString() + " " + p.unit}</strong></div>
      <div><span>${t("modal.validity")}</span><strong>${SITE.QUOTE_VALID_DAYS} ${t("modal.days")}</strong></div>
    </div>
    ${chartSVG(p)}
    ${out ? "" : calcHTML(p)}
    <h4>${t("modal.packaging")}</h4>
    <ul>${packaging}</ul>
    <h4>${t("modal.terms")}</h4>
    <ul>${incoterms}</ul>
    <button class="btn-outline alert-btn" id="setAlert" type="button">${t("alert.set")}</button>
    <p class="form-note" id="alertNote" hidden>${t("alert.saved")}</p>
    <p class="meta">${t("modal.cert")}</p>`;
  $("#modalAdd").textContent = out ? t("modal.notifyBtn") : t("modal.add");
  if (!out) {
    ["calcQty", "calcTerm", "calcRegion"].forEach((cid) =>
      $("#" + cid).addEventListener("input", () => runCalc(p)));
    runCalc(p);
  }
  $("#setAlert").addEventListener("click", () => {
    const target = parseFloat(prompt(t("alert.prompt"), Math.round(p.basePrice * 0.95)));
    if (!target || target <= 0) return;
    alerts = alerts.filter((a) => a.id !== p.id);
    alerts.push({ id: p.id, target });
    localStorage.setItem("ov-alerts", JSON.stringify(alerts));
    $("#alertNote").hidden = false;
    checkAlerts();
  });
  $("#productModal").hidden = false;
  $("#modalBackdrop").hidden = false;
}

function closeModal() {
  $("#productModal").hidden = true;
  $("#modalBackdrop").hidden = true;
  modalProduct = null;
}

function printDatasheet() {
  const p = modalProduct;
  if (!p) return;
  const w = window.open("", "_blank");
  w.document.write(`<!doctype html><html><head><title>${p.name} — Datasheet</title>
    <style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#222}
    h1{border-bottom:3px solid #f5a623;padding-bottom:8px}td{padding:6px 12px;border:1px solid #ccc}
    table{border-collapse:collapse;width:100%}.muted{color:#777;font-size:.85em}</style></head><body>
    <h1>OreVision Materials — ${p.name}</h1>
    <table>
      <tr><td>Grade / Specification</td><td>${p.grade}</td></tr>
      <tr><td>Category</td><td>${p.category}</td></tr>
      <tr><td>Origin</td><td>${p.origin}</td></tr>
      <tr><td>Typical uses</td><td>${p.uses}</td></tr>
      <tr><td>Indicative price</td><td>$${p.basePrice} / ${p.unit} (valid ${SITE.QUOTE_VALID_DAYS} days)</td></tr>
      <tr><td>Minimum order</td><td>${p.moq} ${p.unit}</td></tr>
      <tr><td>Volume discounts</td><td>${SITE.DISCOUNT_TIERS.map((x) => `≥${x.mult * p.moq} t: −${x.pct}%`).join(" · ")}</td></tr>
      <tr><td>Packaging</td><td>${SITE.PACKAGING.join(" · ")}</td></tr>
      <tr><td>Delivery terms</td><td>${SITE.INCOTERMS.join(" · ")}</td></tr>
    </table>
    <p class="muted">Indicative datasheet generated ${LAST_UPDATED}. Certified assay provided with formal quotation.</p>
    <script>window.print()<\/script></body></html>`);
  w.document.close();
}

/* ---------- price alerts ---------- */
function checkAlerts() {
  const hits = alerts
    .map((a) => ({ a, p: PRODUCTS.find((x) => x.id === a.id) }))
    .filter(({ a, p }) => p && p.basePrice <= a.target);
  const banner = $("#alertBanner");
  if (!hits.length) { banner.hidden = true; return; }
  banner.innerHTML = hits.map(({ a, p }) =>
    `<span>${fill("alert.banner", { name: pname(p), price: fmtPrice(p.basePrice), target: fmtPrice(a.target) })}</span>`
  ).join("") + ` <button id="dismissAlerts">${t("alert.dismiss")}</button>`;
  banner.hidden = false;
  $("#dismissAlerts").addEventListener("click", () => {
    alerts = alerts.filter((a) => {
      const p = PRODUCTS.find((x) => x.id === a.id);
      return p && p.basePrice > a.target;
    });
    localStorage.setItem("ov-alerts", JSON.stringify(alerts));
    banner.hidden = true;
  });
}

/* ---------- notify me (out of stock) ---------- */
function notifyMe(p) {
  const msg = document.querySelector('[name="message"]');
  msg.value = fill("notify.msg", { name: pname(p), qty: p.moq });
  closeModal();
  closeDrawer();
  document.getElementById("contact").scrollIntoView({ behavior: "smooth" });
  msg.focus();
}

/* ---------- CSV price list ---------- */
function downloadCsv() {
  const rows = [
    ["Material", "Category", "Grade", "Origin", "Price (USD/t)", "MOQ (t)", "Stock (t)", "Uses"],
    ...PRODUCTS.map((p) => [p.name, p.category, p.grade, p.origin, p.basePrice, p.moq, p.stock, p.uses]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `orevision-price-list-${LAST_UPDATED}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- SEO: Product structured data ---------- */
function injectJsonLd() {
  const ld = {
    "@context": "https://schema.org",
    "@graph": PRODUCTS.map((p) => ({
      "@type": "Product",
      name: p.name,
      description: `${p.grade}. Origin: ${p.origin}. Uses: ${p.uses}.`,
      offers: {
        "@type": "Offer",
        price: p.basePrice,
        priceCurrency: "USD",
        availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
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
  // category filter options (beyond the first "all")
  const sel = $("#categoryFilter");
  [...sel.options].forEach((o) => { if (o.value) o.textContent = pcat(o.value); });
}

function setLang(next) {
  lang = next;
  localStorage.setItem("ov-lang", lang);
  applyI18n();
  renderProducts();
  renderCart();
  renderTicker();
  renderMarket();
  checkAlerts();
  if (modalProduct) openModal(modalProduct.id);
}

/* ---------- exit popup ---------- */
function setupExitPopup() {
  const show = () => {
    if (sessionStorage.getItem("ov-popup")) return;
    sessionStorage.setItem("ov-popup", "1");
    $("#exitPopup").hidden = false;
    $("#popupBackdrop").hidden = false;
  };
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget && e.clientY <= 0) show();
  });
  const close = () => { $("#exitPopup").hidden = true; $("#popupBackdrop").hidden = true; };
  $("#popupClose").addEventListener("click", close);
  $("#popupBackdrop").addEventListener("click", close);
  $("#popupCsv").addEventListener("click", () => { downloadCsv(); close(); });
  $("#popupSubscribe").addEventListener("click", () => {
    const email = $("#popupEmail").value.trim();
    if (!email) { $("#popupEmail").focus(); return; }
    const msg = document.querySelector('[name="message"]');
    const emailField = document.querySelector('[name="email"]');
    emailField.value = email;
    msg.value = "Please add me to the price update list.";
    close();
    document.getElementById("contact").scrollIntoView({ behavior: "smooth" });
  });
}

/* ---------- scroll reveal ---------- */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); revealObserver.unobserve(e.target); }
  });
}, { threshold: 0.12 });

function observeReveals() {
  document.querySelectorAll(".card, .feature, .section-head, .docs-box").forEach((el) => {
    if (!el.classList.contains("in")) { el.classList.add("reveal"); revealObserver.observe(el); }
  });
}

/* ---------- init ---------- */
function init() {
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
  const savedTheme = localStorage.getItem("ov-theme");
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $("#themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ov-theme", next);
  });

  // language
  $("#langToggle").addEventListener("click", () => setLang(lang === "ar" ? "en" : "ar"));

  // currency
  $("#currencyToggle").textContent = currency;
  $("#currencyToggle").addEventListener("click", () => {
    currency = currency === "USD" ? "EGP" : "USD";
    localStorage.setItem("ov-currency", currency);
    $("#currencyToggle").textContent = currency;
    renderProducts();
    renderCart();
    if (modalProduct) openModal(modalProduct.id);
  });

  // filters
  ["searchInput", "categoryFilter", "sortSelect", "inStockOnly"].forEach((id) =>
    $("#" + id).addEventListener("input", renderProducts)
  );

  // product grid: add buttons, notify buttons, detail links (delegated)
  $("#productGrid").addEventListener("click", (e) => {
    const link = e.target.closest(".detail-link");
    if (link) {
      e.preventDefault();
      openModal(link.dataset.detail);
      return;
    }
    const notify = e.target.closest(".btn-notify");
    if (notify) {
      notifyMe(PRODUCTS.find((p) => p.id === notify.dataset.id));
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
    if (!modalProduct) return;
    if (modalProduct.stock <= 0) { notifyMe(modalProduct); return; }
    const id = modalProduct.id;
    closeModal();
    addToCart(id);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeDrawer(); }
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

  $("#requestQuote").addEventListener("click", () => {
    if (!cart.length) return;
    const lines = cart.map((c) => {
      const p = PRODUCTS.find((x) => x.id === c.id);
      return `• ${p.name}: ${c.qty} ${p.unit}`;
    }).join("\n");
    $("#quoteNote").hidden = false;
    const msg = document.querySelector('[name="message"]');
    msg.value = t("quote.header") + "\n" + lines + "\n\n" + t("quote.dest");
    closeDrawer();
    document.getElementById("contact").scrollIntoView({ behavior: "smooth" });
    msg.focus();
  });

  // contact form: with CONTACT_EMAIL set in data.js it opens the buyer's
  // email app pre-filled; otherwise it shows the confirmation note only.
  $("#contactForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (SITE.CONTACT_EMAIL) {
      const subject = "Inquiry — OreVision Materials";
      const body =
        `Name: ${f.get("name")}\nEmail: ${f.get("email")}\nCompany: ${f.get("company") || "-"}\n` +
        `Country: ${f.get("country")}\n\n${f.get("message") || ""}`;
      location.href = `mailto:${SITE.CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
    $("#formNote").hidden = false;
    e.target.reset();
  });

  // CSV price list
  $("#downloadCsv").addEventListener("click", downloadCsv);

  // WhatsApp button (shown only when a number is configured in data.js)
  if (SITE.WHATSAPP_NUMBER) {
    const fab = $("#whatsappFab");
    fab.href = "https://wa.me/" + SITE.WHATSAPP_NUMBER + "?text=" +
      encodeURIComponent("Hello OreVision, I would like a quote.");
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
  observeReveals();
  fetchLive();
}

document.addEventListener("DOMContentLoaded", init);
