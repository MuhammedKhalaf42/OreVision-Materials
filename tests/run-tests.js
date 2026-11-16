/* Logic tests for OreVision Materials.  Run:  node tests/run-tests.js
   Loads data.js, i18n.js and app.js into a sandbox with a stub browser
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
  for (const f of ["data.js", "i18n.js", "app.js"]) vm.runInContext(read(f), sandbox, { filename: f });
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
  test("every product has id, name, positive price, MOQ ≥ 1, trend ≥ 2 points", () => {
    const bad = run(`PRODUCTS.filter(p => !p.id || !p.name || !(p.basePrice > 0) || p.moq < 1 || p.trend.length < 2).map(p => p.id)`);
    eq(bad, []);
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
  test("every product has a photo file", () => {
    const ids = run("PRODUCTS.map(p => p.id)");
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
    run(`PRODUCTS.push({id: 'x1', name: 'Bad numbers', basePrice: 'abc', stock: -5, moq: 0, trend: [5]});
         PRODUCTS.push({name: 'No id'});
         PRODUCTS.push({id: 'gypsum', name: 'Duplicate'});
         normalizeData();`);
    eq(run("PRODUCTS.filter(p => p.name === 'No id' || p.name === 'Duplicate').length"), 0);
    eq(run("(({basePrice, stock, moq, trend}) => ({basePrice, stock, moq, n: trend.length}))(byId('x1'))"),
      { basePrice: 0, stock: 0, moq: 1, n: 2 });
    run("sparkline(byId('x1').trend); series90(byId('x1'));"); // must not throw
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
  test("90-day series has 90 finite positive points for every product", () => {
    eq(run("PRODUCTS.filter(p => { const s = series90(p); return s.length !== 90 || s.some(v => !(v > 0)); }).map(p => p.id)"), []);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
