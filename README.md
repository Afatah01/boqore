# BOQORE GOLD TRADE

**Gold Production & Market Control** — a complete, professional, responsive web application for
managing BOQORE GOLD TRADE's own gold processing operation (gravity separation) and monitoring
the general Somaliland gold market price.

## The two clearly separated areas

1. **BOQORE OPERATIONS** — our actual production data: gold produced, ore processed, gravity
   recovery rate, processing plant status, equipment status, gold inventory.
2. **SOMALILAND GOLD MARKET** — external market information: local SOS/gram price by karat,
   USD reference, price history, and the estimated market value of our gold.

> Market prices are **never** presented as our production price. Market data is stored and
> displayed separately from production data. Market prices show **Live** only when verified from
> a live source; otherwise they are marked **Manually Updated** with the date/time.

## Run

```bash
npm install
npm start        # http://localhost:3000
```

## Demo accounts (initial)

| Role     | Username   | Password     | Access |
|----------|------------|--------------|--------|
| Admin    | `admin`    | `boqore2026` | Everything, incl. Settings & manual market price entry |
| Manager  | `manager`  | `boqore2026` | Dashboard, Production, Plant, Equipment, Gold, Market, Reports |
| Operator | `operator` | Production entry, Processing status, Equipment status |

Change these in **Settings → Users** once you start using the app for real.

## Demo data

The application is seeded with clearly-labelled **DEMO DATA** (a gold banner is shown while it is
active, and all exports are stamped "DEMO DATA") so the interface can be reviewed.
**Settings → Clear demo data** wipes it and starts from an empty, real-data state. When empty,
the UI shows `0` / `No Data` / `Insufficient Data` — it never invents production, recovery,
inventory or market figures.

## Pages

- **Dashboard** — 6 KPI cards (Gold Today, This Month, Ore Processed, Recovery Rate, Gold
  Inventory, Somaliland Gold Price), 30-day production chart, market panel (price, history,
  karat chips), plant status, gravity recovery for today, important alerts.
- **Production** — KPIs (today / 7 days / month / total / ore / recovery), chart with
  7D / 30D / 3M / 1Y + site/shift/date filters, production table, Add / View / Edit forms
  (mobile-friendly, recovery auto-calculated).
- **Processing Plant** — the full gravity workflow (Ore Feed → Vibrating Feeder → Jaw Crusher →
  Hammer Crusher → Belt Conveyor → Ball Mill → Gravity Concentrator → Shaking Table →
  Gold Concentrate → Recovered Gold) with per-stage status/runtime/feed-output and status
  updates, plus Gravity Recovery Performance (7D/30D/90D).
- **Equipment** — photo cards with model, capacity, power, runtime, status (running / attention /
  stopped / offline), status changes and details.
- **Gold** — recovered / in concentrate / refined / sold / balance, batch tracking
  (batch no, weight, karat, purity, status, sale status), add batch and record actual sales.
- **Market Price** — large current-price card (SOS/g + USD ref + movement), karat cards
  (24K/22K/21K/18K), history chart (7D/30D/90D/1Y) with high/low/average/change, manual price
  update (admin), gold value calculator (clearly labelled *Estimated Market Value*), price history.
- **Reports** — Daily Production, Monthly Production, Gold Recovery, Equipment Status, Gold
  Inventory, Market Price — each with View, **PDF** and **Excel** export.
- **Settings** — company (name/tagline/currency/logo), production targets, mining sites, market
  source, users & roles, equipment info, demo-data control.

## Processing method & calculations

The app is built around our **gravity separation** workflow.

- Recovery % = Gold recovered ÷ Estimated gold in feed × 100, where
  Estimated gold in feed = Ore (t) × Head grade (g/t).
- If head grade data is missing, the UI shows **Insufficient Data** instead of a guessed number.
- Gold inventory = gold recovered minus recorded gold removed/sold.

## Stack

- **Node.js + Express** REST API
- **SQLite** (better-sqlite3) relational database
- Vanilla JS single-page frontend, Chart.js (vendored locally) for charts
- Stateful cookie authentication, three roles (Admin / Manager / Operator)
- Reports: **pdfkit** (branded PDF) and **xlsx** (Excel)

### Database tables
`users`, `mining_sites`, `production`, `processing`, `equipment`, `plant_stages`,
`gold_inventory`, `market_prices`, `alerts`, `reports`, `settings`
