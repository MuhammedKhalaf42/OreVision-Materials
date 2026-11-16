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
  CONTACT_EMAIL: "",
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
    basePrice: 98,
    unit: "t",
    moq: 1000,
    stock: 45000,
    icon: "⬣",
    uses: "Steel production",
    trend: [105, 103, 101, 100, 99, 98, 98],
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
];

/* Global commodity benchmarks shown in the market ticker/table.
   Source: indicative exchange & trade-press levels. */
const BENCHMARKS = [
  { name: "Copper (LME)", price: 10850, unit: "USD/t", change: +1.2 },
  { name: "Gold (COMEX)", price: 4120, unit: "USD/oz", change: +0.4 },
  { name: "Iron Ore 62% Fe (CFR China)", price: 104, unit: "USD/t", change: -0.8 },
  { name: "Aluminium (LME)", price: 2740, unit: "USD/t", change: +0.3 },
  { name: "Zinc (LME)", price: 2950, unit: "USD/t", change: -0.5 },
  { name: "Phosphate Rock (Morocco FOB)", price: 155, unit: "USD/t", change: -0.2 },
  { name: "TiO2 Feedstock Index", price: 348, unit: "USD/t", change: +0.6 },
  { name: "Silica Sand (Glass, FOB)", price: 61, unit: "USD/t", change: +0.1 },
];

const USD_TO_EGP = 48.6; // indicative rate, update as needed
