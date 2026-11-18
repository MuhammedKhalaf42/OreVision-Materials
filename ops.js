/* ============================================================
   Ore Bridge — Operations console (ops.html)
   Internal back office: RFQs & orders, inventory lots, shipments,
   customers, and publishing stock to the public price list.

   Storage: this browser (localStorage key "ov-ops"). Use Export
   backup regularly. A shared multi-user system needs a database —
   see README "Operations console".
   The top half of this file is pure logic (tested by
   tests/run-tests.js); the bottom half draws the screens.
   ============================================================ */
"use strict";

const OPS_KEY = "ov-ops";

const STATUS = {
  rfq: [["new", "New"], ["quoted", "Quoted"], ["negotiation", "Negotiation"], ["won", "Won — contract"], ["lost", "Lost"]],
  lot: [["pending", "Lab pending"], ["released", "Released"], ["rejected", "Rejected"], ["shipped", "Shipped"]],
  shipment: [["planned", "Planned"], ["loading", "Loading"], ["sailed", "In transit"], ["delivered", "Delivered"]],
};
const OPEN_RFQ = ["new", "quoted", "negotiation"];
const DOCS = [
  ["invoice", "Commercial invoice"], ["packing", "Packing list"], ["coo", "Certificate of origin"],
  ["coa", "Certificate of analysis"], ["bl", "Bill of lading"], ["inspection", "Inspection report"],
];
const LOCATIONS = ["Mine stockpile", "Processing plant", "Port warehouse — Adabiya", "Port warehouse — Alexandria", "Port warehouse — Safaga"];
const PORTS = ["Adabiya", "Alexandria", "Safaga", "Damietta", "Port Said"];
const MODES = ["Bulk vessel", "Container (FCL)", "Truck"];

/* ---------- pure logic ---------- */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const statusOk = (kind, s) => STATUS[kind].some(([k]) => k === s);

function emptyDb() { return { version: 1, rfqs: [], lots: [], shipments: [] }; }

/* Repairs anything loaded from storage or an imported backup: unknown statuses fall
   back to the first state, numbers are coerced, records without an id are dropped. */
function sanitizeDb(raw) {
  const db = emptyDb();
  if (!raw || typeof raw !== "object") return db;
  const list = (x) => (Array.isArray(x) ? x.filter((r) => r && typeof r === "object" && typeof r.id === "string" && r.id) : []);
  const seen = new Set();
  const uniq = (r) => (seen.has(r.id) ? false : (seen.add(r.id), true));
  db.rfqs = list(raw.rfqs).filter(uniq).map((r) => ({
    ...r, qty: Math.max(0, num(r.qty)), targetPrice: num(r.targetPrice) || "", quotedPrice: num(r.quotedPrice) || "",
    status: statusOk("rfq", r.status) ? r.status : "new", date: isDate(r.date) ? r.date : today(),
  }));
  db.lots = list(raw.lots).filter(uniq).map((l) => ({
    ...l, tonnes: Math.max(0, num(l.tonnes)), status: statusOk("lot", l.status) ? l.status : "pending",
    date: isDate(l.date) ? l.date : today(),
  }));
  db.shipments = list(raw.shipments).filter(uniq).map((s) => ({
    ...s, tonnes: Math.max(0, num(s.tonnes)), status: statusOk("shipment", s.status) ? s.status : "planned",
    docs: Object.fromEntries(DOCS.map(([k]) => [k, !!(s.docs && s.docs[k])])),
  }));
  if (raw.sample) db.sample = true;
  return db;
}

/* Next sequential reference for the year: RFQ-2026-0001, LOT-2026-0001, SHP-2026-0001 */
function nextId(list, prefix, year) {
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let max = 0;
  list.forEach((x) => { const m = re.exec(x.id); if (m) max = Math.max(max, Number(m[1])); });
  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
}

function unitPrice(r, products) {
  const p = products.find((x) => x.id === r.productId);
  return num(r.quotedPrice) || num(r.targetPrice) || (p ? num(p.basePrice) : 0);
}
const rfqValue = (r, products) => num(r.qty) * unitPrice(r, products);

/* Tonnes already committed to won contracts that have not left yet
   (no linked shipment in transit or delivered). */
function committedByGrade(db) {
  const out = {};
  db.rfqs.filter((r) => r.status === "won").forEach((r) => {
    const gone = db.shipments.some((s) => s.rfqId === r.id && (s.status === "sailed" || s.status === "delivered"));
    if (!gone) out[r.productId] = (out[r.productId] || 0) + num(r.qty);
  });
  return out;
}

/* Stock position per grade from the lot register. */
function stockByGrade(db, products) {
  const committed = committedByGrade(db);
  return products.map((p) => {
    const lots = db.lots.filter((l) => l.productId === p.id);
    const sum = (st) => lots.filter((l) => l.status === st).reduce((a, l) => a + num(l.tonnes), 0);
    const released = sum("released");
    const c = committed[p.id] || 0;
    return {
      id: p.id, name: p.name, form: p.form || "", moq: p.moq, website: p.stock,
      lots: lots.length, released, pending: sum("pending"), rejected: sum("rejected"),
      committed: c, available: Math.max(0, released - c), short: Math.max(0, c - released),
    };
  });
}

function kpis(db, products) {
  const open = db.rfqs.filter((r) => OPEN_RFQ.includes(r.status));
  const won = db.rfqs.filter((r) => r.status === "won");
  const lost = db.rfqs.filter((r) => r.status === "lost");
  const stock = stockByGrade(db, products);
  const active = db.shipments.filter((s) => s.status !== "delivered");
  return {
    openRfqs: open.length,
    pipelineValue: open.reduce((a, r) => a + rfqValue(r, products), 0),
    wonCount: won.length,
    wonValue: won.reduce((a, r) => a + rfqValue(r, products), 0),
    winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    released: stock.reduce((a, s) => a + s.released, 0),
    available: stock.reduce((a, s) => a + s.available, 0),
    pendingLab: stock.reduce((a, s) => a + s.pending, 0),
    inTransit: db.shipments.filter((s) => s.status === "loading" || s.status === "sailed").length,
    docsMissing: active.filter((s) => s.status !== "planned" && DOCS.some(([k]) => !s.docs[k])).length,
    lowStock: stock.filter((s) => s.lots && s.available < s.moq * 20),
    shortfalls: stock.filter((s) => s.short > 0),
  };
}

/* Products for the website with stock taken from the lot register. Grades with no lots
   recorded keep their current published stock, so a half-filled register can't zero them. */
function productsWithLotStock(db, products) {
  const pos = Object.fromEntries(stockByGrade(db, products).map((s) => [s.id, s]));
  return products.map((p) => (pos[p.id] && pos[p.id].lots ? { ...p, stock: Math.floor(pos[p.id].available) } : { ...p }));
}

function toCsv(rows) {
  const cell = (c) => {
    let s = String(c ?? "");
    if (/^[=+\-@]/.test(s) && typeof c !== "number") s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

/* Clearly labelled demonstration records so the screens can be explored. */
function sampleDb(products, year) {
  const pid = (id) => (products.some((p) => p.id === id) ? id : products[0].id);
  const d = (m, day) => `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return sanitizeDb({
    version: 1, sample: true,
    rfqs: [
      { id: `RFQ-${year}-0001`, date: d(10, 2), company: "Sample Customer A (Italy)", contact: "Procurement", country: "Italy", productId: pid("feldspar-na"), qty: 2000, incoterm: "CIF destination port", port: "Ravenna", targetPrice: 105, quotedPrice: 112, status: "won", notes: "Sample record" },
      { id: `RFQ-${year}-0002`, date: d(10, 20), company: "Sample Customer B (UAE)", contact: "Purchasing", country: "United Arab Emirates", productId: pid("iron-oxide-powder"), qty: 300, incoterm: "FOB Alexandria / Adabiya", port: "Jebel Ali", targetPrice: 240, quotedPrice: 258, status: "negotiation", notes: "Sample record" },
      { id: `RFQ-${year}-0003`, date: d(11, 3), company: "Sample Customer C (India)", contact: "Raw materials", country: "India", productId: pid("quartz-hp"), qty: 500, incoterm: "CIF destination port", port: "Mundra", targetPrice: 300, quotedPrice: "", status: "new", notes: "Sample record" },
      { id: `RFQ-${year}-0004`, date: d(11, 8), company: "Sample Customer D (Spain)", contact: "Buyer", country: "Spain", productId: pid("kaolin"), qty: 250, incoterm: "FOB Alexandria / Adabiya", port: "Castellón", targetPrice: 170, quotedPrice: 182, status: "quoted", notes: "Sample record" },
      { id: `RFQ-${year}-0005`, date: d(9, 14), company: "Sample Customer E (Turkey)", contact: "Buyer", country: "Turkey", productId: pid("iron-ore"), qty: 20000, incoterm: "FOB Alexandria / Adabiya", port: "Iskenderun", targetPrice: 62, quotedPrice: 68, status: "lost", notes: "Sample record — price" },
    ],
    lots: [
      { id: `LOT-${year}-0001`, date: d(10, 5), productId: pid("feldspar-na"), tonnes: 3500, location: LOCATIONS[3], status: "released", assay: "Na2O 9.4%, Fe2O3 0.14%", notes: "Sample record" },
      { id: `LOT-${year}-0002`, date: d(10, 28), productId: pid("feldspar-na"), tonnes: 2400, location: LOCATIONS[1], status: "released", assay: "Na2O 9.2%, Fe2O3 0.17%", notes: "Sample record" },
      { id: `LOT-${year}-0003`, date: d(11, 1), productId: pid("iron-oxide-powder"), tonnes: 1800, location: LOCATIONS[1], status: "released", assay: "Fe2O3 86.1%, 325 mesh residue 0.6%", notes: "Sample record" },
      { id: `LOT-${year}-0004`, date: d(11, 10), productId: pid("iron-oxide-powder"), tonnes: 400, location: LOCATIONS[1], status: "pending", assay: "", notes: "Sample record" },
      { id: `LOT-${year}-0005`, date: d(11, 4), productId: pid("quartz-hp"), tonnes: 900, location: LOCATIONS[0], status: "rejected", assay: "SiO2 99.1% — below spec", notes: "Sample record" },
      { id: `LOT-${year}-0006`, date: d(11, 12), productId: pid("quartz-hp"), tonnes: 1600, location: LOCATIONS[2], status: "released", assay: "SiO2 99.62%, Fe2O3 0.015%", notes: "Sample record" },
    ],
    shipments: [
      { id: `SHP-${year}-0001`, rfqId: `RFQ-${year}-0001`, productId: pid("feldspar-na"), tonnes: 2000, mode: MODES[0], pol: "Adabiya", pod: "Ravenna", etd: d(11, 18), eta: d(11, 26), bl: "", status: "loading", docs: { invoice: true, packing: true, coo: true, coa: true }, notes: "Sample record" },
    ],
  });
}

/* ============================================================
   Screens (browser only)
   ============================================================ */
let db = emptyDb();
let tab = "dashboard";
const filters = { rfqs: { q: "", status: "" }, lots: { q: "", status: "" }, shipments: { q: "", status: "" } };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (v) => "$" + Math.round(num(v)).toLocaleString("en-US");
const t0 = (v) => Math.round(num(v)).toLocaleString("en-US");
const prod = (id) => PRODUCTS.find((p) => p.id === id);
const prodName = (id) => { const p = prod(id); return p ? (p.form ? `${p.name} — ${p.form}` : p.name) : `(removed: ${id})`; };
const label = (kind, s) => (STATUS[kind].find(([k]) => k === s) || [s, s])[1];
const pill = (kind, s) => `<span class="pill pill-${esc(kind)}-${esc(s)}">${esc(label(kind, s))}</span>`;
const fmtD = (s) => (isDate(s) ? new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

function load() {
  try { db = sanitizeDb(JSON.parse(localStorage.getItem(OPS_KEY) || "null")); } catch (_) { db = emptyDb(); }
}
function save() {
  try {
    localStorage.setItem(OPS_KEY, JSON.stringify(db));
    $("#saveState").textContent = "Saved in this browser · " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    $("#saveState").textContent = "⚠ Could not save — browser storage is blocked. Export a backup now.";
  }
}
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3500);
}

/* ---------- record forms (one schema per entity) ---------- */
const productOptions = () => PRODUCTS.map((p) => [p.id, prodName(p.id)]);
const SCHEMA = {
  rfqs: {
    title: "RFQ / order", prefix: "RFQ",
    fields: () => [
      ["date", "Date received", "date", { required: true }],
      ["status", "Status", "select", { options: STATUS.rfq }],
      ["company", "Company", "text", { required: true }],
      ["contact", "Contact person", "text"],
      ["email", "Email", "email"],
      ["country", "Country", "text"],
      ["productId", "Grade", "select", { options: productOptions(), wide: true }],
      ["qty", "Quantity (t)", "number", { required: true, min: 1 }],
      ["incoterm", "Delivery term", "select", { options: SITE.INCOTERMS.map((x) => [x, x]) }],
      ["port", "Destination port", "text"],
      ["targetPrice", "Customer target (USD/t)", "number", { min: 0, step: "0.5" }],
      ["quotedPrice", "Our quote (USD/t)", "number", { min: 0, step: "0.5" }],
      ["notes", "Notes", "textarea", { wide: true }],
    ],
  },
  lots: {
    title: "Inventory lot", prefix: "LOT",
    fields: () => [
      ["date", "Date produced", "date", { required: true }],
      ["status", "Lab / stock status", "select", { options: STATUS.lot }],
      ["productId", "Grade", "select", { options: productOptions(), wide: true }],
      ["tonnes", "Tonnes", "number", { required: true, min: 0 }],
      ["location", "Location", "select", { options: LOCATIONS.map((x) => [x, x]) }],
      ["assay", "Assay result", "text", { placeholder: "e.g. Fe2O3 86.1%, residue 0.6%", wide: true }],
      ["notes", "Notes", "textarea", { wide: true }],
    ],
  },
  shipments: {
    title: "Shipment", prefix: "SHP",
    fields: () => [
      ["rfqId", "Contract (won RFQ)", "select", { options: [["", "— none —"], ...db.rfqs.filter((r) => r.status === "won").map((r) => [r.id, `${r.id} · ${r.company}`])], wide: true }],
      ["productId", "Grade", "select", { options: productOptions(), wide: true }],
      ["tonnes", "Tonnes", "number", { required: true, min: 0 }],
      ["mode", "Mode", "select", { options: MODES.map((x) => [x, x]) }],
      ["pol", "Port of loading", "select", { options: PORTS.map((x) => [x, x]) }],
      ["pod", "Port of discharge", "text"],
      ["etd", "ETD", "date"],
      ["eta", "ETA", "date"],
      ["bl", "B/L number", "text"],
      ["status", "Status", "select", { options: STATUS.shipment }],
      ["docs", "Documents ready", "docs", { wide: true }],
      ["notes", "Notes", "textarea", { wide: true }],
    ],
  },
};

let editing = null; // { kind, id|null }

function openForm(kind, id) {
  const sch = SCHEMA[kind];
  const rec = id ? db[kind].find((r) => r.id === id) : { date: today(), docs: {} };
  if (!rec) return;
  editing = { kind, id: id || null };
  $("#formTitle").textContent = id ? `Edit ${sch.title} ${id}` : `New ${sch.title}`;
  $("#formDelete").hidden = !id;
  $("#recordFields").innerHTML = sch.fields().map(([key, lab, type, o = {}]) => {
    const v = rec[key] ?? "";
    const req = o.required ? " required" : "";
    let input;
    if (type === "select") {
      input = `<select name="${key}"${req}>${o.options.map(([k, l]) => `<option value="${esc(k)}"${String(v) === String(k) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    } else if (type === "textarea") {
      input = `<textarea name="${key}" rows="3">${esc(v)}</textarea>`;
    } else if (type === "docs") {
      input = `<div class="doc-checks">${DOCS.map(([k, l]) => `<label class="chk"><input type="checkbox" name="doc_${k}"${rec.docs && rec.docs[k] ? " checked" : ""}> ${esc(l)}</label>`).join("")}</div>`;
    } else {
      input = `<input type="${type}" name="${key}" value="${esc(v)}"${req}${o.min != null ? ` min="${o.min}"` : ""}${o.step ? ` step="${o.step}"` : ""}${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ""}>`;
    }
    return `<label class="${o.wide ? "wide" : ""}"><span>${esc(lab)}${o.required ? " *" : ""}</span>${input}</label>`;
  }).join("");
  // a new shipment copies grade and tonnes from the chosen contract
  const rfqSel = $("#recordFields [name=rfqId]");
  if (rfqSel) rfqSel.addEventListener("change", () => {
    const r = db.rfqs.find((x) => x.id === rfqSel.value);
    if (!r) return;
    $("#recordFields [name=productId]").value = r.productId;
    if (!$("#recordFields [name=tonnes]").value) $("#recordFields [name=tonnes]").value = r.qty;
    if (!$("#recordFields [name=pod]").value) $("#recordFields [name=pod]").value = r.port || "";
  });
  $("#recordDialog").showModal();
  const first = $("#recordFields input, #recordFields select");
  if (first) first.focus();
}

function submitForm(e) {
  e.preventDefault();
  const { kind, id } = editing;
  const form = $("#recordForm");
  const data = {};
  SCHEMA[kind].fields().forEach(([key, , type]) => {
    if (type === "docs") data.docs = Object.fromEntries(DOCS.map(([k]) => [k, form.elements["doc_" + k].checked]));
    else data[key] = type === "number" ? (form.elements[key].value === "" ? "" : num(form.elements[key].value)) : form.elements[key].value.trim();
  });
  const list = db[kind];
  if (id) {
    Object.assign(list.find((r) => r.id === id), data);
  } else {
    const year = (isDate(data.date) ? data.date : today()).slice(0, 4);
    list.unshift({ id: nextId(list, SCHEMA[kind].prefix, year), ...data });
  }
  db = sanitizeDb(db);
  save();
  $("#recordDialog").close();
  render();
  toast(id ? `${id} updated` : `${list[0].id} created`);
}

function deleteRecord() {
  const { kind, id } = editing;
  if (!id || !confirm(`Delete ${id}? This cannot be undone (unless you have a backup).`)) return;
  db[kind] = db[kind].filter((r) => r.id !== id);
  save();
  $("#recordDialog").close();
  render();
  toast(`${id} deleted`);
}

/* ---------- screens ---------- */
function kpiTile(labelText, value, sub, tone) {
  return `<div class="kpi${tone ? " kpi-" + tone : ""}"><span>${esc(labelText)}</span><strong>${value}</strong>${sub ? `<em>${sub}</em>` : ""}</div>`;
}

function renderDashboard() {
  const k = kpis(db, PRODUCTS);
  const stock = stockByGrade(db, PRODUCTS).filter((s) => s.lots || s.committed);
  const openList = db.rfqs.filter((r) => OPEN_RFQ.includes(r.status)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const active = db.shipments.filter((s) => s.status !== "delivered").sort((a, b) => String(a.etd).localeCompare(String(b.etd)));
  const alerts = [
    ...k.shortfalls.map((s) => `<li class="bad"><strong>${esc(prodName(s.id))}</strong>: contracts need ${t0(s.committed)} t but only ${t0(s.released)} t is released — short ${t0(s.short)} t.</li>`),
    ...k.lowStock.filter((s) => !s.short).map((s) => `<li><strong>${esc(prodName(s.id))}</strong>: ${t0(s.available)} t available (below 20 × MOQ).</li>`),
    ...(k.docsMissing ? [`<li>${k.docsMissing} shipment(s) loading or sailing with documents still missing.</li>`] : []),
    ...(k.pendingLab ? [`<li>${t0(k.pendingLab)} t waiting for laboratory release.</li>`] : []),
  ];
  return `
  <div class="kpi-row">
    ${kpiTile("Open RFQs", k.openRfqs, `${usd(k.pipelineValue)} pipeline`)}
    ${kpiTile("Won contracts", k.wonCount, `${usd(k.wonValue)}${k.winRate != null ? ` · ${k.winRate}% win rate` : ""}`, "good")}
    ${kpiTile("Released stock", `${t0(k.released)} t`, `${t0(k.available)} t uncommitted`)}
    ${kpiTile("Pending lab", `${t0(k.pendingLab)} t`, "awaiting release", k.pendingLab ? "warn" : "")}
    ${kpiTile("Shipments active", k.inTransit, k.docsMissing ? `${k.docsMissing} with missing documents` : "documents complete", k.docsMissing ? "warn" : "")}
  </div>
  <div class="ops-grid">
    <section class="panel">
      <h2>Action items</h2>
      ${alerts.length ? `<ul class="alerts">${alerts.join("")}</ul>` : `<p class="empty">Nothing needs attention.</p>`}
    </section>
    <section class="panel">
      <h2>Open RFQs <a class="link" data-tab="rfqs" href="#rfqs">All RFQs →</a></h2>
      ${openList.length ? `<div class="table-scroll"><table class="ops-table"><thead><tr><th>Ref</th><th>Company</th><th>Grade</th><th class="num">Qty t</th><th class="num">Value</th><th>Status</th></tr></thead><tbody>
        ${openList.map((r) => `<tr><td><button class="ref" data-edit="rfqs" data-id="${esc(r.id)}">${esc(r.id)}</button></td><td>${esc(r.company)}</td><td>${esc(prodName(r.productId))}</td><td class="num">${t0(r.qty)}</td><td class="num">${usd(rfqValue(r, PRODUCTS))}</td><td>${pill("rfq", r.status)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">No open RFQs.</p>`}
    </section>
  </div>
  <section class="panel">
    <h2>Stock position by grade <a class="link" data-tab="inventory" href="#inventory">Lot register →</a></h2>
    ${stock.length ? stockTable(stock) : `<p class="empty">No lots recorded yet. Add lots in <a class="link" data-tab="inventory" href="#inventory">Inventory</a>.</p>`}
  </section>
  <section class="panel">
    <h2>Shipments in progress <a class="link" data-tab="shipments" href="#shipments">All shipments →</a></h2>
    ${active.length ? shipmentRows(active, true) : `<p class="empty">No active shipments.</p>`}
  </section>`;
}

function stockTable(stock) {
  return `<div class="table-scroll"><table class="ops-table"><thead><tr><th>Grade</th><th class="num">Lots</th><th class="num">Released t</th><th class="num">Pending lab t</th><th class="num">Committed t</th><th class="num">Available t</th><th class="num">On website t</th><th></th></tr></thead><tbody>
    ${stock.map((s) => {
      const diff = s.lots && Math.floor(s.available) !== s.website;
      return `<tr class="${s.short ? "row-bad" : ""}"><td>${esc(prodName(s.id))}</td><td class="num">${s.lots}</td><td class="num">${t0(s.released)}</td><td class="num">${t0(s.pending)}</td><td class="num">${t0(s.committed)}</td><td class="num"><strong>${t0(s.available)}</strong></td><td class="num">${t0(s.website)}</td>
      <td>${s.short ? `<span class="pill pill-bad">Short ${t0(s.short)} t</span>` : diff ? `<span class="pill pill-warn">Website differs</span>` : s.lots ? `<span class="pill pill-ok">In sync</span>` : ""}</td></tr>`;
    }).join("")}
  </tbody></table></div>`;
}

function toolbar(kind, statuses, addLabel) {
  const f = filters[kind];
  return `<div class="ops-toolbar">
    <input type="search" data-filter="${kind}" placeholder="Search…" value="${esc(f.q)}" aria-label="Search">
    <select data-status-filter="${kind}" aria-label="Status filter"><option value="">All statuses</option>${statuses.map(([k, l]) => `<option value="${k}"${f.status === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
    <span class="spacer"></span>
    <button class="btn-outline small-btn" data-csv="${kind}" type="button">Export CSV</button>
    <button class="btn-primary small-btn" data-new="${kind}" type="button">+ ${esc(addLabel)}</button>
  </div>`;
}

function filtered(kind) {
  const f = filters[kind];
  const q = f.q.trim().toLowerCase();
  return db[kind].filter((r) => (!f.status || r.status === f.status) &&
    (!q || JSON.stringify({ ...r, product: prodName(r.productId) }).toLowerCase().includes(q)));
}

const statusSelect = (kind, entity, r) =>
  `<select class="inline-status st-${esc(r.status)}" data-status="${entity}" data-id="${esc(r.id)}" aria-label="Status of ${esc(r.id)}">${STATUS[kind].map(([k, l]) => `<option value="${k}"${r.status === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;

function renderRfqs() {
  const rows = filtered("rfqs").sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((a, r) => a + rfqValue(r, PRODUCTS), 0);
  return `<section class="panel">${toolbar("rfqs", STATUS.rfq, "New RFQ")}
    ${rows.length ? `<div class="table-scroll"><table class="ops-table"><thead><tr><th>Ref</th><th>Date</th><th>Company</th><th>Country</th><th>Grade</th><th class="num">Qty t</th><th>Term</th><th class="num">Target $/t</th><th class="num">Quote $/t</th><th class="num">Value</th><th>Status</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><button class="ref" data-edit="rfqs" data-id="${esc(r.id)}">${esc(r.id)}</button></td><td>${fmtD(r.date)}</td><td>${esc(r.company)}<span class="sub">${esc(r.contact || "")}</span></td><td>${esc(r.country)}</td><td>${esc(prodName(r.productId))}</td><td class="num">${t0(r.qty)}</td><td class="nowrap">${esc((r.incoterm || "").split(" ")[0])}</td><td class="num">${r.targetPrice ? t0(r.targetPrice) : "—"}</td><td class="num">${r.quotedPrice ? t0(r.quotedPrice) : "—"}</td><td class="num">${usd(rfqValue(r, PRODUCTS))}</td><td>${statusSelect("rfq", "rfqs", r)}</td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="9">${rows.length} record(s)</td><td class="num"><strong>${usd(total)}</strong></td><td></td></tr></tfoot></table></div>`
      : `<p class="empty">No RFQs${filters.rfqs.q || filters.rfqs.status ? " match the filter" : " yet — add the first one with “+ New RFQ”"}.</p>`}
    <p class="hint">Value uses our quote, else the customer's target, else the list price. Set an RFQ to “Won — contract” to commit its tonnes against stock.</p></section>`;
}

function renderInventory() {
  const rows = filtered("lots").sort((a, b) => b.date.localeCompare(a.date));
  const stock = stockByGrade(db, PRODUCTS).filter((s) => s.lots || s.committed);
  return `<section class="panel"><h2>Stock position by grade</h2>${stock.length ? stockTable(stock) : `<p class="empty">No lots yet.</p>`}</section>
  <section class="panel"><h2>Lot register</h2>${toolbar("lots", STATUS.lot, "New lot")}
    ${rows.length ? `<div class="table-scroll"><table class="ops-table"><thead><tr><th>Lot</th><th>Date</th><th>Grade</th><th class="num">Tonnes</th><th>Location</th><th>Assay</th><th>Status</th></tr></thead><tbody>
      ${rows.map((l) => `<tr><td><button class="ref" data-edit="lots" data-id="${esc(l.id)}">${esc(l.id)}</button></td><td>${fmtD(l.date)}</td><td>${esc(prodName(l.productId))}</td><td class="num">${t0(l.tonnes)}</td><td>${esc(l.location)}</td><td>${esc(l.assay || "—")}</td><td>${statusSelect("lot", "lots", l)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">No lots${filters.lots.q || filters.lots.status ? " match the filter" : " yet"}.</p>`}
    <p class="hint">Only <strong>Released</strong> lots count as sellable stock. Mark lots <strong>Shipped</strong> once they have left, so they stop counting.</p></section>`;
}

function shipmentRows(rows, compact) {
  return `<div class="table-scroll"><table class="ops-table"><thead><tr><th>Ref</th><th>Contract</th><th>Grade</th><th class="num">Tonnes</th><th>Route</th><th>ETD</th><th>ETA</th>${compact ? "" : "<th>B/L</th>"}<th>Documents</th><th>Status</th></tr></thead><tbody>
    ${rows.map((s) => {
      const done = DOCS.filter(([k]) => s.docs[k]).length;
      const r = db.rfqs.find((x) => x.id === s.rfqId);
      return `<tr><td><button class="ref" data-edit="shipments" data-id="${esc(s.id)}">${esc(s.id)}</button></td><td>${r ? `${esc(r.id)}<span class="sub">${esc(r.company)}</span>` : "—"}</td><td>${esc(prodName(s.productId))}</td><td class="num">${t0(s.tonnes)}</td><td class="nowrap">${esc(s.pol || "—")} → ${esc(s.pod || "—")}<span class="sub">${esc(s.mode || "")}</span></td><td>${fmtD(s.etd)}</td><td>${fmtD(s.eta)}</td>${compact ? "" : `<td>${esc(s.bl || "—")}</td>`}
        <td><span class="docs-meter" title="${esc(DOCS.filter(([k]) => !s.docs[k]).map(([, l]) => "Missing: " + l).join("\n") || "All documents ready")}"><span style="width:${(done / DOCS.length) * 100}%"></span></span> ${done}/${DOCS.length}</td>
        <td>${statusSelect("shipment", "shipments", s)}</td></tr>`;
    }).join("")}
  </tbody></table></div>`;
}

function renderShipments() {
  const rows = filtered("shipments").sort((a, b) => String(b.etd).localeCompare(String(a.etd)));
  return `<section class="panel">${toolbar("shipments", STATUS.shipment, "New shipment")}
    ${rows.length ? shipmentRows(rows, false) : `<p class="empty">No shipments${filters.shipments.q || filters.shipments.status ? " match the filter" : " yet"}.</p>`}
    <p class="hint">Documents: ${DOCS.map(([, l]) => esc(l)).join(" · ")}. Hover the bar to see what is missing.</p></section>`;
}

function customers() {
  const by = {};
  db.rfqs.forEach((r) => {
    const key = (r.company || "").trim().toLowerCase();
    if (!key) return;
    const c = by[key] || (by[key] = { company: r.company, country: r.country, contact: r.contact, email: r.email, rfqs: 0, won: 0, wonValue: 0, open: 0, last: "" });
    c.rfqs++;
    if (r.status === "won") { c.won++; c.wonValue += rfqValue(r, PRODUCTS); }
    if (OPEN_RFQ.includes(r.status)) c.open++;
    if (r.date > c.last) { c.last = r.date; c.country = r.country || c.country; c.contact = r.contact || c.contact; c.email = r.email || c.email; }
  });
  return Object.values(by).sort((a, b) => b.wonValue - a.wonValue || b.last.localeCompare(a.last));
}

function renderCustomers() {
  const list = customers();
  return `<section class="panel"><h2>Customers <span class="muted">(built from RFQs)</span></h2>
    ${list.length ? `<div class="table-scroll"><table class="ops-table"><thead><tr><th>Company</th><th>Country</th><th>Contact</th><th class="num">RFQs</th><th class="num">Open</th><th class="num">Won</th><th class="num">Won value</th><th>Last RFQ</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><strong>${esc(c.company)}</strong></td><td>${esc(c.country)}</td><td>${esc(c.contact || "")}${c.email ? `<span class="sub"><a class="link" href="mailto:${esc(c.email)}">${esc(c.email)}</a></span>` : ""}</td><td class="num">${c.rfqs}</td><td class="num">${c.open}</td><td class="num">${c.won}</td><td class="num">${usd(c.wonValue)}</td><td>${fmtD(c.last)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="empty">Customers appear here automatically once RFQs are recorded.</p>`}</section>`;
}

function renderWebsite() {
  const stock = stockByGrade(db, PRODUCTS).filter((s) => s.lots);
  const changes = stock.filter((s) => Math.floor(s.available) !== s.website);
  return `<section class="panel"><h2>Publish stock to the website</h2>
    <p>The public price list shows the stock in <code>data.js</code>. This takes <strong>available</strong> tonnes (released lots minus committed contracts) for every grade that has lots, and keeps the current figure for grades with no lots recorded.</p>
    ${stock.length ? `<div class="table-scroll"><table class="ops-table"><thead><tr><th>Grade</th><th class="num">On website t</th><th class="num">Will publish t</th><th></th></tr></thead><tbody>
      ${stock.map((s) => `<tr><td>${esc(prodName(s.id))}</td><td class="num">${t0(s.website)}</td><td class="num"><strong>${t0(Math.floor(s.available))}</strong></td><td>${Math.floor(s.available) !== s.website ? `<span class="pill pill-warn">Changes</span>` : `<span class="pill pill-ok">Same</span>`}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="empty">Record lots in Inventory first.</p>`}
    <div class="publish-row">
      <button class="btn-primary" id="publishStock" type="button"${stock.length ? "" : " disabled"}>Download data.js with ${changes.length} stock change(s)</button>
      <a class="btn-outline" href="admin.html">Edit prices &amp; contact settings →</a>
    </div>
    <ol class="steps"><li>Download the file.</li><li>On GitHub, open <code>data.js</code> → pencil icon → paste the new content → Commit.</li><li>The public site updates within a few minutes.</li></ol>
    ${db.sample ? `<p class="warn-box">Sample data is loaded — don't publish stock from sample lots. Use “Clear all data” first.</p>` : ""}
  </section>`;
}

function publishStock() {
  if (db.sample && !confirm("Sample data is loaded. Publish stock figures from SAMPLE lots anyway?")) return;
  const products = cloneProducts(productsWithLotStock(db, PRODUCTS));
  downloadText(buildDataFile({
    lastUpdated: today(), site: SITE, products, benchmarks: BENCHMARKS, fx: USD_TO_EGP,
    countries: typeof COUNTRIES !== "undefined" ? COUNTRIES : [], generatedBy: "ops.html",
  }), "data.js", "text/javascript");
  toast("data.js downloaded — replace it on GitHub to publish.");
}

const TABS = { dashboard: ["Dashboard", renderDashboard], rfqs: ["RFQs & Orders", renderRfqs], inventory: ["Inventory", renderInventory], shipments: ["Shipments", renderShipments], customers: ["Customers", renderCustomers], website: ["Website", renderWebsite] };

function render() {
  if (!TABS[tab]) tab = "dashboard";
  document.querySelectorAll("[data-tab-btn]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.tabBtn === tab)));
  $("#pageTitle").textContent = TABS[tab][0];
  $("#sampleBanner").hidden = !db.sample;
  $("#view").innerHTML = TABS[tab][1]();
  document.title = `${TABS[tab][0]} · Ore Bridge Operations`;
  const counts = { rfqs: db.rfqs.filter((r) => OPEN_RFQ.includes(r.status)).length, inventory: db.lots.filter((l) => l.status === "pending").length, shipments: db.shipments.filter((s) => s.status === "loading" || s.status === "sailed").length };
  Object.entries(counts).forEach(([k, n]) => { const el = document.querySelector(`[data-count="${k}"]`); if (el) { el.textContent = n; el.hidden = !n; } });
}

function exportCsv(kind) {
  const cols = {
    rfqs: [["id", "Ref"], ["date", "Date"], ["status", "Status"], ["company", "Company"], ["contact", "Contact"], ["email", "Email"], ["country", "Country"], ["productId", "Grade"], ["qty", "Qty (t)"], ["incoterm", "Term"], ["port", "Port"], ["targetPrice", "Target USD/t"], ["quotedPrice", "Quote USD/t"], ["notes", "Notes"]],
    lots: [["id", "Lot"], ["date", "Date"], ["status", "Status"], ["productId", "Grade"], ["tonnes", "Tonnes"], ["location", "Location"], ["assay", "Assay"], ["notes", "Notes"]],
    shipments: [["id", "Ref"], ["rfqId", "Contract"], ["productId", "Grade"], ["tonnes", "Tonnes"], ["mode", "Mode"], ["pol", "POL"], ["pod", "POD"], ["etd", "ETD"], ["eta", "ETA"], ["bl", "B/L"], ["status", "Status"], ["docs", "Documents ready"], ["notes", "Notes"]],
  }[kind];
  const val = (r, k) => (k === "productId" ? prodName(r[k]) : k === "docs" ? DOCS.filter(([d]) => r.docs[d]).map(([, l]) => l).join("; ") : r[k]);
  downloadText(toCsv([cols.map((c) => c[1]), ...filtered(kind).map((r) => cols.map(([k]) => val(r, k)))]), `ore-bridge-${kind}-${today()}.csv`, "text/csv;charset=utf-8");
}

function init() {
  load();
  tab = (location.hash || "#dashboard").slice(1);
  window.addEventListener("hashchange", () => { tab = location.hash.slice(1); render(); });

  document.addEventListener("click", (e) => {
    const tabLink = e.target.closest("[data-tab]");
    if (tabLink) { e.preventDefault(); location.hash = tabLink.dataset.tab; return; }
    const ed = e.target.closest("[data-edit]");
    if (ed) { openForm(ed.dataset.edit, ed.dataset.id); return; }
    const nw = e.target.closest("[data-new]");
    if (nw) { openForm(nw.dataset.new, null); return; }
    const csv = e.target.closest("[data-csv]");
    if (csv) { exportCsv(csv.dataset.csv); return; }
    if (e.target.closest("#publishStock")) publishStock();
  });
  document.addEventListener("input", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) {
      filters[f.dataset.filter].q = f.value;
      const pos = f.selectionStart;
      render();
      const again = document.querySelector(`[data-filter="${f.dataset.filter}"]`);
      again.focus();
      again.setSelectionRange(pos, pos);
    }
  });
  document.addEventListener("change", (e) => {
    const sf = e.target.closest("[data-status-filter]");
    if (sf) { filters[sf.dataset.statusFilter].status = sf.value; render(); return; }
    const st = e.target.closest("[data-status]");
    if (st) {
      const rec = db[st.dataset.status].find((r) => r.id === st.dataset.id);
      if (rec) { rec.status = st.value; save(); render(); toast(`${rec.id} → ${st.options[st.selectedIndex].text}`); }
    }
  });

  $("#recordForm").addEventListener("submit", submitForm);
  $("#formCancel").addEventListener("click", () => $("#recordDialog").close());
  $("#formDelete").addEventListener("click", deleteRecord);

  $("#exportBackup").addEventListener("click", () => {
    downloadText(JSON.stringify(db, null, 2), `ore-bridge-ops-backup-${today()}.json`, "application/json");
    toast("Backup downloaded — keep it somewhere safe.");
  });
  $("#importBackup").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = sanitizeDb(JSON.parse(await file.text()));
      if (!confirm(`Replace the current data with this backup?\n${data.rfqs.length} RFQs, ${data.lots.length} lots, ${data.shipments.length} shipments.`)) return;
      db = data;
      save();
      render();
      toast("Backup restored.");
    } catch (_) {
      alert("That file is not a valid Ore Bridge operations backup.");
    }
  });
  $("#loadSample").addEventListener("click", () => {
    if ((db.rfqs.length || db.lots.length || db.shipments.length) && !confirm("Replace the current data with sample data?")) return;
    db = sampleDb(PRODUCTS, today().slice(0, 4));
    save();
    render();
  });
  $("#clearAll").addEventListener("click", () => {
    if (!confirm("Delete ALL operations data in this browser? Export a backup first if you need it.")) return;
    db = emptyDb();
    save();
    render();
  });
  $("#lastUpdated").textContent = fmtD(LAST_UPDATED);
  render();
}

if (typeof window !== "undefined" && typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", init);
}
