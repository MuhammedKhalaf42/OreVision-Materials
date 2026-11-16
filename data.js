/* ============================================================
   OreVision Materials — Product & Market Data
   Prices are indicative global benchmarks (USD per metric tonne
   unless noted). Update basePrice / stock here as needed.
   ============================================================ */

const LAST_UPDATED = "2026-11-16";

/* ---- Site settings: fill these in to activate contact features ----
   (easiest way: open admin.html, fill the Settings boxes, download)
   FORM_ENDPOINT  : a form-service URL (e.g. a Formspree endpoint like
                    "https://formspree.io/f/abcdwxyz"). Inquiries are
                    then delivered to your inbox without the buyer
                    leaving the site. Best option.
   CONTACT_EMAIL  : fallback — "Send Inquiry" opens the buyer's email
                    app pre-filled and addressed to you.
                    With both empty, the form tells the visitor that
                    nothing was sent.
   WHATSAPP_NUMBER: international format, e.g. "2010XXXXXXXX".
                    Leave "" to hide the WhatsApp button.               */
const SITE = {
  FORM_ENDPOINT: "",
  CONTACT_EMAIL: "orevision.asw.eg@outlook.com",
  WHATSAPP_NUMBER: "",
  QUOTE_VALID_DAYS: 14,
  PACKAGING: ["Bulk vessel", "Big bags (1–1.5 t)", "25 kg bags on pallets"],
  INCOTERMS: ["EXW mine site", "FOB Alexandria / Adabiya", "CIF destination port"],
  /* Indicative ocean freight, USD per tonne, used by the CIF calculator */
  FREIGHT: {
    "Mediterranean / Europe": 18,
    "Gulf / MENA": 14,
    "South Asia": 22,
    "East Asia": 30,
    "Africa": 20,
    "Americas": 38,
  },
  /* Volume discounts: ordered largest first. qty >= mult × MOQ → pct off */
  DISCOUNT_TIERS: [
    { mult: 20, pct: 7 },
    { mult: 5, pct: 3 },
  ],
};

const PRODUCTS = [
  {
    id: "feldspar-k",
    name: "Potassium Feldspar (K-Feldspar)",
    category: "Industrial Minerals",
    grade: "K2O ≥ 10%, Fe2O3 ≤ 0.15%",
    origin: "Eastern Desert, Egypt",
    basePrice: 135,
    unit: "t",
    moq: 25,
    stock: 4200,
    icon: "▦",
    uses: "Ceramics, glass, glazes",
    trend: [128, 130, 129, 132, 131, 134, 135],
  },
  {
    id: "feldspar-na",
    name: "Sodium Feldspar (Na-Feldspar)",
    category: "Industrial Minerals",
    grade: "Na2O ≥ 9%, sorted purity 98%",
    origin: "Sinai, Egypt",
    basePrice: 110,
    unit: "t",
    moq: 25,
    stock: 6800,
    icon: "▧",
    uses: "Tiles, sanitaryware, glass",
    trend: [104, 106, 105, 108, 109, 108, 110],
  },
  {
    id: "quartz-hp",
    name: "High-Purity Quartz",
    category: "Industrial Minerals",
    grade: "SiO2 ≥ 99.5%, AI-sorted",
    origin: "Eastern Desert, Egypt",
    basePrice: 320,
    unit: "t",
    moq: 20,
    stock: 1850,
    icon: "◈",
    uses: "Glass, solar, electronics",
    trend: [298, 305, 302, 310, 315, 318, 320],
  },
  {
    id: "silica-sand",
    name: "Silica Sand (Glass Grade)",
    category: "Industrial Minerals",
    grade: "SiO2 ≥ 99%, Fe2O3 ≤ 0.03%",
    origin: "Zafarana, Egypt",
    basePrice: 62,
    unit: "t",
    moq: 50,
    stock: 12500,
    icon: "∴",
    uses: "Float glass, foundry, filtration",
    trend: [58, 59, 60, 59, 61, 62, 62],
  },
  {
    id: "phosphate",
    name: "Phosphate Rock",
    category: "Fertilizer Minerals",
    grade: "P2O5 28–30%",
    origin: "Abu Tartur, Egypt",
    basePrice: 152,
    unit: "t",
    moq: 500,
    stock: 28000,
    icon: "✱",
    uses: "Fertilizers, phosphoric acid",
    trend: [158, 156, 155, 153, 154, 152, 152],
  },
  {
    id: "kaolin",
    name: "Kaolin (China Clay)",
    category: "Industrial Minerals",
    grade: "Al2O3 ≥ 34%, brightness 85+",
    origin: "Sinai, Egypt",
    basePrice: 185,
    unit: "t",
    moq: 25,
    stock: 3600,
    icon: "◍",
    uses: "Paper, ceramics, paint",
    trend: [178, 180, 182, 181, 183, 184, 185],
  },
  {
    id: "talc",
    name: "Talc Powder",
    category: "Industrial Minerals",
    grade: "Mesh 325, whiteness 92%",
    origin: "Eastern Desert, Egypt",
    basePrice: 310,
    unit: "t",
    moq: 20,
    stock: 940,
    icon: "❖",
    uses: "Plastics, paint, cosmetics",
    trend: [300, 302, 305, 304, 308, 309, 310],
  },
  {
    id: "gypsum",
    name: "Gypsum (Natural)",
    category: "Construction Minerals",
    grade: "CaSO4·2H2O ≥ 92%",
    origin: "Red Sea Coast, Egypt",
    basePrice: 38,
    unit: "t",
    moq: 100,
    stock: 22000,
    icon: "▤",
    uses: "Cement, plasterboard",
    trend: [36, 36, 37, 37, 38, 38, 38],
  },
  {
    id: "ilmenite",
    name: "Ilmenite Concentrate",
    category: "Metallic Ores",
    grade: "TiO2 ≥ 44%",
    origin: "Abu Ghalaga, Egypt",
    basePrice: 345,
    unit: "t",
    moq: 100,
    stock: 1500,
    icon: "⬢",
    uses: "Titanium dioxide pigment",
    trend: [330, 335, 332, 338, 340, 342, 345],
  },
  {
    id: "iron-ore",
    name: "Iron Ore Fines",
    category: "Metallic Ores",
    grade: "Fe 58–60%",
    origin: "Bahariya Oasis, Egypt",
    basePrice: 68,
    unit: "t",
    moq: 1000,
    stock: 45000,
    icon: "⬣",
    uses: "Steel production",
    trend: [73, 71, 70, 69, 69, 68, 68],
  },
  {
    id: "manganese",
    name: "Manganese Ore",
    category: "Metallic Ores",
    grade: "Mn ≥ 38%",
    origin: "Um Bogma, Sinai",
    basePrice: 168,
    unit: "t",
    moq: 200,
    stock: 0,
    icon: "⬡",
    uses: "Ferroalloys, batteries",
    trend: [160, 163, 162, 165, 166, 167, 168],
  },
  {
    id: "limestone",
    name: "Limestone (High Calcium)",
    category: "Construction Minerals",
    grade: "CaCO3 ≥ 97%",
    origin: "Minya, Egypt",
    basePrice: 29,
    unit: "t",
    moq: 200,
    stock: 60000,
    icon: "▥",
    uses: "Cement, lime, steel flux",
    trend: [28, 28, 28, 29, 29, 29, 29],
  },
  {
    id: "iron-oxide-powder",
    name: "Iron Oxide Powder (Natural Red)",
    category: "Industrial Minerals",
    grade: "Fe2O3 ≥ 85%, 325 mesh",
    origin: "Egypt",
    basePrice: 260,
    unit: "t",
    moq: 25,
    stock: 2000,
    icon: "●",
    uses: "Cement & concrete coloring, ceramics, primers",
    trend: [260, 260],
  },
];

/* Reference prices shown in the ticker and the Global Prices table.
   Each entry has either `price` (a single figure) or `range` (text such
   as "300–800"), plus `asOf` and `source` so buyers can see how current
   and where each number comes from. Update these by hand; there is no
   free live feed for these materials. */
const BENCHMARKS = [
  { name: "Iron Ore 62% Fe (CFR China)", price: 91.48, unit: "USD/t", asOf: "13 Nov 2026", source: "Trading Economics" },
  { name: "Iron Ore 58% Fe (CFR China)", price: 85, unit: "USD/t", asOf: "Nov 2026 (est.)", source: "Estimated from the usual 58%/62% spread" },
  { name: "Natural Red Iron Oxide Powder", range: "300–800", unit: "USD/t", asOf: "Mar 2026", source: "Indian supplier quotes (TradeIndia)" },
  { name: "Iron Oxide Red Pigment (China FOB)", range: "800–1,200", unit: "USD/t", asOf: "Nov 2026", source: "IndexBox market report, construction grade" },
  { name: "Phosphate Rock (Morocco)", price: 156.9, unit: "USD/t", asOf: "Jun 2026", source: "World Bank" },
  { name: "Ilmenite (Malaysia)", price: 273, unit: "USD/t", asOf: "Sep 2026", source: "IMARC" },
  { name: "Silica Sand (Egypt FOB)", range: "40–135", unit: "USD/t", asOf: "2026", source: "Egyptian supplier quotes, by grade" },
];

const USD_TO_EGP = 53.74; // fallback only — the site fetches the live rate on load
