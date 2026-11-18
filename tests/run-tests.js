/* Logic tests for OreVision Materials.  Run:  node tests/run-tests.js
   Loads data.js, i18n.js, materials.js and app.js into a sandbox with a stub browser
   environment and checks the pure logic (no real DOM needed).            */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

function makeSandbox(storage = {}) {
  const mem = { ...storage };
  const storageApi = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
  };
  const sandbox = {
    console,
    localStorage: storageApi,
    sessionStorage: storageApi,
    document: { addEventListener() {}, querySelector: () => null, getElementById: () => null },
    location: { href: "http://localhost/" },
    URL, setTimeout, clearTimeout, AbortController,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ["data.js", "i18n.js", "materials.js", "app.js"]) vm.runInContext(read(f), sandbox, { filename: f });
  return { run: (code) => vm.runInContext(code, sandbox), mem };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; console.log("  ✗ " + name + "\n      " + e.message); }
}
function eq(actual, expected, label = "") {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} expected ${b}, got ${a}`);
}

console.log("Data integrity");
{
  const { run } = makeSandbox();
  run("normalizeData()");
  test("every product has id, name, positive price, MOQ ≥ 1 and at least one recorded price", () => {
    const bad = run(`PRODUCTS.filter(p => !p.id || !p.name || !(p.basePrice > 0) || p.moq < 1 || !p.history.length).map(p => p.id)`);
    eq(bad, []);
  });
  test("price history is real data: valid dates, oldest first, newest entry equals the current price", () => {
    eq(run(`PRODUCTS.filter(p => p.history.some((h, i) => !isIsoDate(h.date) || !(h.price > 0) || (i && h.date <= p.history[i - 1].date))
      || p.history[p.history.length - 1].price !== p.basePrice).map(p => p.id)`), []);
  });
  test("every product's country exists in COUNTRIES", () => {
    eq(run("PRODUCTS.filter(p => !COUNTRIES.some(c => c.code === p.country)).map(p => p.id)"), []);
  });
  test("every material has a MATERIALS entry with English and Arabic text and a map location", () => {
    eq(run(`[...new Set(PRODUCTS.map(p => p.material))].filter(m => { const x = MATERIALS[m];
      return !x || !x.en || !x.ar || !x.en.summary || !x.ar.summary || !Array.isArray(x.ar.apps) || !x.location || !Number.isFinite(x.location.lat); })`), []);
  });
  test("every product has a form and at least one spec line", () => {
    eq(run("PRODUCTS.filter(p => !p.form || !p.specs.length).map(p => p.id)"), []);
  });
  test("every spec label is a formula or has an Arabic translation", () => {
    eq(run(`[...new Set(PRODUCTS.flatMap(p => p.specs.map(s => s[0])))]
      .filter(l => !/^[A-Z][A-Za-z0-9()·,]*$/.test(l.replace(/\s/g, '')) || /[a-z]{3}/.test(l))
      .filter(l => !AR_SPEC_LABELS[l])`), []);
  });
  test("every Arabic product entry has name, form, uses and origin", () => {
    eq(run("PRODUCTS.filter(p => { const a = AR_PRODUCTS[p.id]; return !a || !a.name || !a.form || !a.uses || !a.origin; }).map(p => p.id)"), []);
  });
  test("material page route parses and unknown routes are rejected", () => {
    eq(run("parseRoute('#/m/iron-oxide/iron-oxide-powder')"), { material: "iron-oxide", id: "iron-oxide-powder" });
    eq(run("parseRoute('#/m/talc')"), { material: "talc", id: "" });
    eq(run("parseRoute('#products')"), null);
    eq(run("parseRoute('#/m/%E0%A4%A')"), { material: "", id: "" });
  });
  test("chemical formulas get subscripts without touching values", () => {
    eq(run("chem('Fe2O3 ≥ 80%')"), "Fe<sub>2</sub>O<sub>3</sub> ≥ 80%");
    eq(run("chem('CaSO4·2H2O')"), "CaSO<sub>4</sub>·2H<sub>2</sub>O");
    eq(run("chem('<b>')"), "&lt;b&gt;");
  });
  test("product ids are unique", () => {
    eq(run("new Set(PRODUCTS.map(p => p.id)).size === PRODUCTS.length"), true);
  });
  test("every product has an Arabic translation", () => {
    eq(run("PRODUCTS.filter(p => !AR_PRODUCTS[p.id]).map(p => p.id)"), []);
  });
  test("every category, freight region and incoterm has an Arabic translation", () => {
    eq(run("[...new Set(PRODUCTS.map(p => p.category))].filter(c => !AR_CATEGORIES[c])"), []);
    eq(run("Object.keys(SITE.FREIGHT).filter(r => !AR_FREIGHT[r])"), []);
    eq(run("SITE.INCOTERMS.filter(x => !AR_INCOTERMS[x])"), []);
  });
  test("English and Arabic have exactly the same translation keys", () => {
    eq(run("Object.keys(I18N.en).filter(k => !(k in I18N.ar))"), [], "missing in ar:");
    eq(run("Object.keys(I18N.ar).filter(k => !(k in I18N.en))"), [], "missing in en:");
  });
  test("every translation key is used by the site (no leftovers from removed features)", () => {
    const src = read("app.js") + read("index.html");
    const built = [/^page\.step\d[tp]$/, /^page\.faq\d[qa]$/]; // keys assembled in a loop
    eq(run("Object.keys(I18N.en)").filter((k) => !src.includes(`"${k}"`) && !built.some((r) => r.test(k))), []);
  });
  test("every product's photo file exists", () => {
    const ids = run("PRODUCTS.map(p => p.image)");
    eq(ids.filter((id) => !fs.existsSync(path.join(root, "images", id + ".jpg"))), []);
  });
  test("every reference price has a name, a price or range, a date and a source", () => {
    eq(run(`BENCHMARKS.filter(b => !b.name || !(b.price > 0 || b.range) || !b.asOf || !b.source).map(b => b.name)`), []);
  });
  test("no precious metals in the reference prices or the catalog", () => {
    eq(run(`[...BENCHMARKS.map(b => b.name), ...PRODUCTS.map(p => p.name)].filter(n => /gold|silver|platinum|palladium/i.test(n))`), []);
  });
  test("every photo has a credits entry", () => {
    const credits = JSON.parse(read("images/credits.json")).map((c) => c.id);
    const files = fs.readdirSync(path.join(root, "images")).filter((f) => f.endsWith(".jpg")).map((f) => f.replace(".jpg", ""));
    eq(files.filter((f) => !credits.includes(f)), []);
  });
}

console.log("Quantities and discounts");
{
  const { run } = makeSandbox();
  run("normalizeData()");
  test("quantity below MOQ is raised to MOQ", () => {
    eq(run("clampQty({moq: 25, stock: 1000}, 3)"), { qty: 25, capped: false });
  });
  test("garbage quantity falls back to MOQ", () => {
    eq(run("clampQty({moq: 25, stock: 1000}, 'abc')"), { qty: 25, capped: false });
    eq(run("clampQty({moq: 25, stock: 1000}, -50)"), { qty: 25, capped: false });
  });
  test("quantity above stock is capped at stock", () => {
    eq(run("clampQty({moq: 25, stock: 1000}, 99999)"), { qty: 1000, capped: true });
  });
  test("fractional quantity is floored", () => {
    eq(run("clampQty({moq: 25, stock: 1000}, 40.9)"), { qty: 40, capped: false });
  });
  test("discount tiers apply at the right thresholds", () => {
    eq(run("discountPct({moq: 20}, 99)"), 0);
    eq(run("discountPct({moq: 20}, 100)"), 3);
    eq(run("discountPct({moq: 20}, 399)"), 3);
    eq(run("discountPct({moq: 20}, 400)"), 7);
  });
  test("line total applies the discount", () => {
    eq(run("lineTotal({moq: 20, basePrice: 100}, 400)"), { pct: 7, total: 37200 });
  });
  test("advertised max discount is reachable with available stock", () => {
    eq(run("maxDiscountFor({moq: 100, stock: 1500})"), 3);   // 20×MOQ = 2000 > stock
    eq(run("maxDiscountFor({moq: 100, stock: 5000})"), 7);
    eq(run("maxDiscountFor({moq: 100, stock: 50})"), 0);     // cannot fill one MOQ
  });
  test("a product with stock below its MOQ counts as out of stock", () => {
    eq(run("isOut({moq: 100, stock: 99})"), true);
    eq(run("isOut({moq: 100, stock: 100})"), false);
  });
}

console.log("Resilience to bad saved data");
{
  test("corrupt localStorage values do not throw", () => {
    const { run } = makeSandbox({ "ov-cart": "{not json", "ov-alerts": "###", "ov-lang": "xx", "ov-currency": "BTC" });
    run("normalizeData()");
    eq(run("sanitizeCart(store.json('ov-cart', []))"), []);
    eq(run("sanitizeAlerts(store.json('ov-alerts', []))"), []);
    eq(run("lang"), "en");
    eq(run("currency"), "USD");
  });
  test("cart drops removed products, sold-out products and duplicates, and repairs quantities", () => {
    const { run } = makeSandbox();
    run("normalizeData()");
    const out = run(`sanitizeCart([
      {id: 'removed-product', qty: 50},
      {id: 'manganese', qty: 500},
      {id: 'gypsum', qty: 5},
      {id: 'gypsum', qty: 700},
      {id: 'talc', qty: 9999999},
      null, 'junk', {qty: 3}
    ])`);
    eq(out, [{ id: "gypsum", qty: 100 }, { id: "talc", qty: 940 }]);
  });
  test("alerts drop unknown products and invalid targets", () => {
    const { run } = makeSandbox();
    run("normalizeData()");
    eq(run("sanitizeAlerts([{id:'gypsum', target: 30}, {id:'nope', target: 5}, {id:'talc', target: -1}, null])"),
      [{ id: "gypsum", target: 30 }]);
  });
  test("broken entries in data.js are repaired or dropped", () => {
    const { run } = makeSandbox();
    run(`PRODUCTS.push({id: 'x1', name: 'Bad numbers', basePrice: 'abc', stock: -5, moq: 0, trend: [5], specs: [['Fe'], 'x', ['SiO2', '≤ 5%']], history: [{date: 'nope', price: 5}, {date: '2026-01-02', price: -1}]});
         PRODUCTS.push({name: 'No id'});
         PRODUCTS.push({id: 'gypsum', name: 'Duplicate'});
         normalizeData();`);
    eq(run("PRODUCTS.filter(p => p.name === 'No id' || p.name === 'Duplicate').length"), 0);
    eq(run("(({basePrice, stock, moq, country, material, form, image, specs, history, trend}) => ({basePrice, stock, moq, country, material, form, image, specs, history, trend}))(byId('x1'))"),
      { basePrice: 0, stock: 0, moq: 1, country: "EG", material: "x1", form: "", image: "x1", specs: [["SiO2", "≤ 5%"]], history: [] });
    run("sparkline(byId('x1').history); historyRows(byId('x1'));"); // must not throw
  });
}

console.log("Formatting and escaping");
{
  const { run } = makeSandbox();
  run("normalizeData()");
  test("USD prices use thousands separators and at most 2 decimals", () => {
    eq(run("fmtPrice(126240)"), "$126,240");
    eq(run("fmtPrice(297.6)"), "$297.6");
    eq(run("fmtPrice(0)"), "$0");
  });
  test("HTML special characters are escaped", () => {
    eq(run(`esc('<img src=x onerror=alert(1)> & "q"')`), "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;");
  });
  test("history table shows the change between recorded prices, newest first", () => {
    const html = run("historyRows({history: [{date: '2026-01-01', price: 100}, {date: '2026-02-01', price: 110}], unit: 't'})");
    if (!/\+10\.0%/.test(html)) throw new Error("missing +10.0% in " + html);
    if (html.indexOf("110") > html.indexOf("First recorded")) throw new Error("newest row should come first");
  });
  test("Arabic shows the tonne unit in Arabic; discounts stay left-to-right", () => {
    eq(run("unitName('t')"), "t");
    eq(run("lang = 'ar'; const u = unitName('t'); lang = 'en'; u"), "طن");
    eq(run("unitName('kg')"), "kg");
    eq(run("pctOff(7)"), '<bdi dir="ltr">−7%</bdi>');
  });
  test("calculator recognises delivery terms by Incoterm code, whatever their order or wording", () => {
    eq(run("SITE.INCOTERMS.map(incotermCode)"), ["EXW", "FOB", "CIF"]);
    eq(run("incotermCode(' cif Rotterdam')"), "CIF");
    eq(run("incotermCode(undefined)"), "");
  });
  test("sparkline needs two real prices", () => {
    eq(run("sparkline([{date: '2026-01-01', price: 5}])"), "");
  });
  test("CSV includes country and form, and guards against formula injection", () => {
    const csv = run("csvText()");
    if (!csv.includes('"Country"') || !csv.includes('"Form"')) throw new Error("missing columns");
    if (!csv.includes('"Egypt"')) throw new Error("missing country name");
  });
}


console.log("Operations console");
{
  const sb = { console, URL, Date, JSON };
  sb.window = sb;
  vm.createContext(sb);
  for (const f of ["data.js", "datafile.js", "ops.js"]) vm.runInContext(read(f), sb, { filename: f });
  const run = (code) => vm.runInContext(code, sb);
  test("references are sequential per year and survive gaps", () => {
    eq(run("nextId([], 'RFQ', '2026')"), "RFQ-2026-0001");
    eq(run("nextId([{id:'RFQ-2026-0007'},{id:'RFQ-2025-0099'},{id:'junk'}], 'RFQ', '2026')"), "RFQ-2026-0008");
  });
  test("a corrupt or foreign backup is repaired, not trusted", () => {
    eq(run("JSON.stringify(sanitizeDb(null))"), JSON.stringify({ version: 1, rfqs: [], lots: [], shipments: [] }));
    const d = run(`sanitizeDb({ rfqs: [{id:'A', qty:'12', status:'hacked'}, {id:'A', qty: 1}, {qty: 5}, null],
      lots: [{id:'L', tonnes: -4, status:'released'}], shipments: [{id:'S', docs: {coa: 1, evil: true}}] })`);
    eq([d.rfqs.length, d.rfqs[0].qty, d.rfqs[0].status, d.lots[0].tonnes, d.shipments[0].status, Object.keys(d.shipments[0].docs).length, d.shipments[0].docs.coa],
      [1, 12, "new", 0, "planned", 6, true]);
  });
  test("only released lots count; won contracts commit stock until their shipment sails", () => {
    run(`var P = [{id:'g1', name:'G', moq: 10, stock: 999, basePrice: 100}];
      var D = sanitizeDb({ lots: [{id:'L1', productId:'g1', tonnes: 500, status:'released'}, {id:'L2', productId:'g1', tonnes: 300, status:'pending'},
        {id:'L3', productId:'g1', tonnes: 200, status:'rejected'}, {id:'L4', productId:'g1', tonnes: 50, status:'shipped'}],
        rfqs: [{id:'R1', productId:'g1', qty: 120, status:'won'}, {id:'R2', productId:'g1', qty: 40, status:'quoted', quotedPrice: 110}],
        shipments: [{id:'S1', rfqId:'R1', status:'loading'}] });`);
    eq(run("(({released, pending, committed, available, short}) => ({released, pending, committed, available, short}))(stockByGrade(D, P)[0])"),
      { released: 500, pending: 300, committed: 120, available: 380, short: 0 });
    run("D.shipments[0].status = 'sailed'");
    eq(run("stockByGrade(D, P)[0].available"), 500);
  });
  test("dashboard figures: pipeline, win rate, shortfalls", () => {
    run(`var D2 = sanitizeDb({ lots: [{id:'L1', productId:'g1', tonnes: 50, status:'released'}],
      rfqs: [{id:'R1', productId:'g1', qty: 120, status:'won'}, {id:'R2', productId:'g1', qty: 40, status:'quoted', quotedPrice: 110},
             {id:'R3', productId:'g1', qty: 10, status:'lost'}, {id:'R4', productId:'g1', qty: 10, status:'new', targetPrice: 90}] });`);
    const k = run("kpis(D2, P)");
    eq([k.openRfqs, k.pipelineValue, k.wonCount, k.wonValue, k.winRate, k.shortfalls.length], [2, 40 * 110 + 10 * 90, 1, 12000, 50, 1]);
  });
  test("publishing stock only changes grades that have lots", () => {
    run(`var P2 = [{id:'g1', name:'A', moq: 1, stock: 999}, {id:'g2', name:'B', moq: 1, stock: 777}];
      var D3 = sanitizeDb({ lots: [{id:'L1', productId:'g1', tonnes: 250.7, status:'released'}] });`);
    eq(run("productsWithLotStock(D3, P2).map(p => p.stock)"), [250, 777]);
  });
  test("generated data.js is valid and keeps countries, products and prices", () => {
    const text = run(`buildDataFile({ lastUpdated: '2026-11-17', site: SITE, countries: COUNTRIES, products: cloneProducts(productsWithLotStock(sampleDb(PRODUCTS, '2026'), PRODUCTS)), benchmarks: BENCHMARKS, fx: 50 })`);
    const sb2 = {};
    vm.createContext(sb2);
    vm.runInContext(text + ";this.out = {n: PRODUCTS.length, c: COUNTRIES.length, d: LAST_UPDATED, fx: USD_TO_EGP, trend: PRODUCTS.some(p => 'trend' in p)}", sb2);
    eq(sb2.out, { n: run("PRODUCTS.length"), c: run("COUNTRIES.length"), d: "2026-11-17", fx: 50, trend: false });
  });
  test("sample data is flagged as sample and references real grades", () => {
    eq(run("(d => [d.sample, d.rfqs.every(r => PRODUCTS.some(p => p.id === r.productId)), d.lots.every(l => PRODUCTS.some(p => p.id === l.productId))])(sampleDb(PRODUCTS, '2026'))"), [true, true, true]);
  });
  test("CSV export guards against spreadsheet formulas", () => {
    eq(run("toCsv([['=HYPERLINK(1)', 5]]).slice(1)"), `"'=HYPERLINK(1)","5"`);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
