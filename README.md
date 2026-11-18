# Ore Bridge

Industrial minerals trading (formerly "OreVision Materials"), the trading arm of OreVision.

A static marketplace website for AI-sorted mining materials — the selling counterpart to the
[OreVision showcase site](https://mohammedmadany.github.io/OreVision-Web-Showcase/).

## Features
- **Spec-sheet catalog** — a sortable table (Material · Form · Purity · Origin · Price · MOQ · Stock) with a card view toggle; 18 grades of 13 Egyptian materials
- **Same material, several grades** — e.g. iron oxide as lump, 325-mesh powder and 600-mesh micronized, each with its own purity, price and stock
- **Country tabs** — Egypt live; Sudan shown as "Coming soon" with a register-interest button (edit `COUNTRIES` in `data.js` to open it)
- **A page for every material** (`#/m/<material>/<grade>`) — grade comparison, typical chemical analysis, real price history, related market price, map of the deposit region, geology, properties and HS code, applications, mine-to-port steps, packaging and delivery terms, FAQ, order calculator, sample request, printable datasheet, shareable link
- **Market reference data** — table with the date and source of every figure
- **RFQ line items** — buyers tick *Include* on any grade and set the tonnage; a summary bar keeps the running total, and the lines (with volume discounts) appear at the top of the RFQ form and are sent with it
- **RFQ form** — company, destination port, delivery term (Incoterms) and payment terms (L/C, T/T, CAD)
- Price alerts, USD ⇄ EGP, English ⇄ Arabic (right-to-left), light/dark theme, phone-ready

Material page text (history, geology, map location, HS codes) lives in `materials.js`.

## Operations console (`ops.html`)
The internal back office, reached from the "Staff · Operations" link in the top bar (hidden from search engines; it holds no data until staff enter it in their own browser).
Open it at `…/OreVision-Materials/ops.html`.
- **Dashboard** — open RFQs and pipeline value, won contracts and win rate, released stock, stock pending lab, active shipments, and action items (stock shortfalls against contracts, missing shipping documents, low stock)
- **RFQs & Orders** — every inquiry with company, grade, quantity, delivery term, target and quoted price; statuses New → Quoted → Negotiation → Won (contract) / Lost
- **Inventory** — lot register (tonnes, location, assay, lab status). Only *Released* lots count as sellable; won contracts are deducted until their shipment sails
- **Shipments** — contract, route, ETD/ETA, B/L number, and a six-document checklist
- **Customers** — built automatically from the RFQs
- **Website** — downloads a new `data.js` with stock taken from the lot register (prices are edited in `admin.html`)
- CSV export per table, JSON backup / restore, and clearly marked sample data for trying it out

**Important:** the console saves records in the browser on the computer where it is used. Export a backup regularly. To let several staff work on the same live records from different computers, the next step is a hosted database (for example Supabase or Firebase); the logic in `ops.js` is written to make that switch straightforward.

## Activate contact features (2-minute setup)
Easiest: open **`admin.html`**, fill in the *Contact settings* boxes, download the new `data.js`.
Or edit the `SITE` block at the top of `data.js` by hand:
- `FORM_ENDPOINT: "https://formspree.io/f/…"` → **best option.** Create a free form at formspree.io, paste its URL here, and inquiries arrive in your inbox without the buyer leaving the site.
- `CONTACT_EMAIL: "you@example.com"` → fallback: "Send Inquiry" opens the buyer's email app pre-addressed to you
- `WHATSAPP_NUMBER: "2010XXXXXXXX"` (international format) → shows a floating WhatsApp chat button

Until one of the first two is set, the form tells visitors honestly that nothing was sent.

## Tests
```bash
node tests/run-tests.js
```
45 checks covering data integrity (every product has a photo, country, form, specs and Arabic translation; every material has a page entry in both languages; English and Arabic keys match and none is left unused), quantity and discount rules, price-history rules, recovery from corrupt saved data, and the operations logic (stock commitments, KPIs, publishing, backups). Run it after editing `data.js` or `i18n.js`.

## How the site protects itself
- A typo in `data.js` (text where a number should be, a broken price history, a duplicate id) is repaired or skipped at startup instead of breaking the page.
- Visitors' saved carts are re-validated on every visit: removed or sold-out products are dropped, quantities are kept between the minimum order and the stock on hand.
- The live USD→EGP rate times out after 6 seconds, is cached for 15 minutes, ignores implausible values, and falls back to `USD_TO_EGP` in `data.js`.

## Product photos
- Every product card and detail view has a real mineral photograph, plus an open-pit mine behind the hero.
- Photos live in `images/` named by product id (e.g. `images/quartz-hp.jpg`). **To use your own photo, just replace the file with the same name.** If a file is missing, the card falls back to generated artwork automatically.
- Current photos are from Wikimedia Commons under free licenses (CC BY / CC BY-SA / public domain). These licenses require credit, which is provided on `credits.html` (linked in the footer) from `images/credits.json`. If you swap in your own photos, remove the matching entry from `credits.json`.
- The photos illustrate the mineral type — they are not photos of your actual stock. Replacing them with real yard/lot photos will build more buyer trust.

## New in this version
- **Arabic / English toggle** (عربي button) with full right-to-left layout — the whole site, catalog included, flips languages
- **Live exchange rate** — USD→EGP updates from a free public API on page load. The reference prices are updated by hand in `data.js` (`BENCHMARKS`): there is no free live feed for iron ore, iron oxide or the other industrial minerals, so each entry carries an `asOf` date and a `source`.
- **Order calculator** in every product detail: quantity + delivery term (EXW/FOB/CIF) + destination region → estimated total with freight
- **Volume discounts** — tiers in `data.js` (`SITE.DISCOUNT_TIERS`): ≥5× MOQ → −3%, ≥20× MOQ → −7%, applied automatically to RFQ lines and in the calculator
- **Price history charts** on material pages, drawn from real recorded prices once a grade has two or more
- **Price alerts** — buyers set a target price per product; a banner appears when the price reaches it
- **About & Certifications section** with the sorting process and export documentation list
- **Admin page** — open `admin.html`, edit prices/stock in a table, download a fresh `data.js`, replace the old one on GitHub. No coding needed.
- **Product card artwork** — procedurally generated strata graphics colored by category

## More built-in features
- **Material pages** — click any product name for a full spec sheet with packaging and Incoterms
- **Printable datasheets** — every material page has a Print Datasheet button buyers can save as PDF
- **CSV price list download** — button under the catalog, for buyers who work in Excel
- **Notify me** — out-of-stock products let buyers request a restock alert
- **SEO ready** — Open Graph tags (nice link previews on WhatsApp/LinkedIn), Product structured data for Google, `sitemap.xml` + `robots.txt` (update the URL inside them if your repo name differs from `OreVision-Materials`)

## Editing prices and stock
Everything lives in **`data.js`**:
- `PRODUCTS` — change `basePrice`, `stock`, add or remove materials
- `BENCHMARKS` — the Market Reference Data table
- `USD_TO_EGP` — the exchange rate
- `LAST_UPDATED` — shown on the catalog

No build step. Just edit and refresh.

## Run locally
```bash
python3 -m http.server 4173
```
Then open http://localhost:4173

## Deploy to GitHub Pages (same as your first site)
1. Create a new repository, e.g. `OreVision-Materials`
2. Upload all files and the `images/` folder (`index.html`, `styles.css`, `app.js`, `data.js`, `i18n.js`, `materials.js`, `ops.html`, `ops.js`, `admin.html`, `datafile.js`, `credits.html`, `robots.txt`, `sitemap.xml`)
3. Repository **Settings → Pages → Deploy from branch → main / (root)**
4. The site appears at `https://muhammedkhalaf42.github.io/OreVision-Materials/`

## Ideas for later
- Wire the inquiry form to a free form service (Formspree / Web3Forms) so submissions reach your email
- Pull real commodity prices from a free API (e.g. metals.dev) instead of `data.js`
- Downloadable purity certificates per lot on the material pages
