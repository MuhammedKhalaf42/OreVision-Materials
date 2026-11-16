# OreVision Materials

A static marketplace website for AI-sorted mining materials — the selling counterpart to the
[OreVision showcase site](https://mohammedmadany.github.io/OreVision-Web-Showcase/).

## Features
- **Materials catalog** — 12 Egyptian mining products with grade, origin, uses, MOQ and live stock levels
- **Global pricing** — scrolling benchmark ticker + market table (LME copper, gold, iron ore, phosphate…)
- **Price trend sparklines** on every product card
- **Quote cart** — add quantities, see an indicative total, and auto-fill the inquiry form (saved in the browser, survives reload)
- **Currency toggle** — USD ⇄ EGP
- **Dark / light theme**, fully responsive (phone-ready)
- Search, category filter, sorting, in-stock filter

## Activate contact features (2-minute setup)
Open **`data.js`** and fill in the `SITE` block at the top:
- `CONTACT_EMAIL: "you@example.com"` → "Send Inquiry" opens the buyer's email app pre-addressed to you
- `WHATSAPP_NUMBER: "2010XXXXXXXX"` (international format, digits only) → shows a floating WhatsApp chat button

## More built-in features
- **Product detail pages** — click any product name for a full spec sheet with packaging and Incoterms
- **Printable datasheets** — every product modal has a Print Datasheet button buyers can save as PDF
- **CSV price list download** — button under the catalog, for buyers who work in Excel
- **Notify me** — out-of-stock products let buyers request a restock alert
- **SEO ready** — Open Graph tags (nice link previews on WhatsApp/LinkedIn), Product structured data for Google, `sitemap.xml` + `robots.txt` (update the URL inside them if your repo name differs from `OreVision-Materials`)

## Editing prices and stock
Everything lives in **`data.js`**:
- `PRODUCTS` — change `basePrice`, `stock`, add or remove materials
- `BENCHMARKS` — the ticker / market-table numbers
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
2. Upload `index.html`, `styles.css`, `app.js`, `data.js`
3. Repository **Settings → Pages → Deploy from branch → main / (root)**
4. The site appears at `https://<username>.github.io/OreVision-Materials/`

## Ideas for later
- Wire the inquiry form to a free form service (Formspree / Web3Forms) so submissions reach your email
- Pull real commodity prices from a free API (e.g. metals.dev) instead of `data.js`
- Arabic version (your showcase already has العربية — same approach works here)
- Per-product detail pages with datasheets and purity certificates
