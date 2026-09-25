# Decals Plus — Business Context & Challenges

## What Decals Plus Does

Decals Plus is a small custom graphics shop (1–5 people, everyone wears all hats) producing:

- **Custom decals and cut vinyl** — made to order, quoted per job
- **Signs and large format** — banners, vehicle graphics, and similar
- **Custom heat-pressed apparel** — t-shirts are the only stocked blank; most other fabrics are customer-supplied or sourced outside per job
- **Magnet plates**
- **Retail/stock items** sold over the counter

## How the Shop Runs Today

Design work happens in **SignLab**. Files live on a **local NAS** with automated **cloud backup**. Everything operational is analog: deals are written **pen-and-paper in a notebook**, and pricing is **tribal knowledge / best guess** held in the owner's head. The owner's wife is a **CPA**, so the books are well kept — the gap is operational, not financial.

## The Challenges

1. **Pricing lives in one person's head.** Quotes are inconsistent and the business can't delegate quoting. This is the #1 problem: *v1 succeeds when anyone in the shop can quote a job consistently.*
2. **Job tracking is a notebook.** No shared view of what's in production, what's due, or what's been picked up. Jobs can fall through cracks.
3. **Inventory is guesswork.** Vinyl rolls, shirt blanks, magnet stock — no counts, no reorder signals, no cycle counting.
4. **Unreliable wifi.** The shop's wifi is sketchy, so the system must be **self-hosted on the LAN** (NAS/local server, wired) and tolerant of flaky client connections.
5. **Reporting needs are undefined.** The CPA's requirements haven't been gathered yet — a conversation is pending. CSV export of sales/payments is the safe baseline until then.

## What the ERP/POS Must Be

A **self-hosted LAN web app** used from multiple shop PCs. Pillars:

- **Quoting/estimator**: manual price entry always allowed, plus an advisory estimator driven by dimensions, a complexity scale, and a material picker. Materials and their costs are admin-configurable.
- **Order tracking**: most jobs follow one simple path; some need a fuller flow (design/proof step). Statuses must flex per job type without bloat.
- **Inventory**: simple unit counts with low-stock thresholds, cycle counts, and cycle-count scheduling. Per-job material consumption is explicitly out of scope for now.
- **POS/payments**: record-only (amount, method, balance due). No card processing integration.
- **Clean aesthetic**: easier to read than a typical ERP, with light/dark/minimal theme options — but dense enough to be meaningful to a small business.

## Domain Glossary

Canonical terms, confirmed against the code (2026-07-03). When a word below is
used in code, docs, or conversation, it means exactly this.

### Jobs

- **Job** — the single aggregate for all work sold: a quote and an order are the
  *same record* at different lifecycle statuses, never two entities. Carries the
  estimator inputs it was derived from, both prices (suggested and final), and a
  soft-delete flag. Identified to humans by its **PO**.
- **Quote** — a Job whose status is `quote` (proof flow only). Simple jobs skip
  it and are born `acknowledged`.
- **Order** — informal name for a Job past the quote stage. Not a separate table.
- **Line** — one independently-priced unit of a Job: the *main item* (columns on
  the Job itself) plus zero or more *additional items* (`job_items` rows). Each
  line has its own material, dimensions, qty, and color multiplier.
- **PO** — auto-generated order key, `MMDDYY + 3-digit daily sequence`. Also the
  SignLab filename convention on the NAS (see File reference).
- **Proof flow** — the optional long lifecycle (`quote → approved → design →
  in production → done → picked up`), enabled per job. The default simple path
  is `acknowledged → in production → done → picked up`.
- **Cost snapshot** — a material's cost copied onto the Job at quote time.
  Editing a material's cost never rewrites history.
- **Price check** — the server's recomputation of a quote's suggested and grand
  totals. A mismatch warns (stale client) but never blocks the save.
- **Client ref** — client-generated UUID making job/payment creation idempotent
  over sketchy wifi; a retry returns the existing row.

### Materials & pricing

- **Material** — an admin-configured thing jobs are priced against (651 vinyl,
  magnet blank, t-shirt). Carries its **price rule**.
- **Price rule / price mode** — how a material suggests a price: `per_inch_max`,
  `per_sqft`, `per_unit`, `flat`, or `custom` (no suggestion).
- **Add-on** — a flat-priced material flagged `isAddon` (t-shirt blank,
  squeegee), grouped separately in the item picker.
- **Roll material** — a material flagged `usesRoll`; shows the roll-width picker
  and carries an admin-managed **color list**.
- **Estimator** — the advisory pricing engine (`shared/pricing.ts`). Suggests,
  never binds; the human-set final price always wins.
- **Color (two meanings — never conflate):**
  1. **Color multiplier** — the `2 color`/`3 color` *price tag* on a single
     line (×2/×3). About artwork complexity, not the vinyl.
  2. **Material color (variant)** — Red 651 vs Blue 651. Selects which roll
     SKU to stock-check. **Never changes price.**

### Inventory

- **Inventory item** — a simple unit count with a low-stock threshold. No
  per-job consumption, deliberately.
- **Roll SKU** — an inventory item keyed `material + color + nominal width`
  (e.g. `651 · Red · 24in`). Unique per key (DB-enforced); color must be on the
  material's color list.
- **Nominal vs usable width** — usable = nominal − 1.5″ (web/clamp loss).
- **Stock check** — the advisory quote-time lookup: `unknown` (no data — show
  nothing), `in_stock`, `suboptimal` (optimal width out, a wider fitting width
  in), `out_of_stock`. Never blocks, never deducts. *This is the only
  job↔inventory relationship in the system.*
- **Adjustment** — a signed count change with a mandatory reason
  (received/used/damaged/cycle_count/correction) and who did it.
- **Cycle count** — the weekly recount session; completing one auto-schedules
  the next (+7 days).
- **Category** — inventory taxonomy (browsing/admin defaults only). Orthogonal
  to roll SKUs and the stock check; no pricing effect.

### Money

- **Payment / Refund** — rows in one ledger (`kind`). Money rows are never
  hard-deleted.
- **Void** — marking a money row mistaken (reason required). The row stays on
  the books.
- **Balance** — derived, never stored: after-tax total − live payments + live
  refunds. Overpayment warns but is allowed.
- **Credit ledger** — per-customer store credit as signed entries; balance may
  not go negative.

### Customers & access

- **Walk-in** — the one generic customer record Quick Order uses; the sole
  exemption from the email-required rule.
- **Level** — admin-assigned customer tier 0–3; levels 1+ get a discount %.
- **Account / admin password** — LAN-trust attribution, not security. Account
  passwords gate edits and attribution; one shared admin password gates
  configuration and overrides.

### Explicit non-concepts

- **Job-material consumption** — does not exist and is out of scope for v1 by
  design. Quoting a job never decrements inventory; the stock check is a
  lookup. If a future phase adds consumption, that is a new decision, not a
  gap.
- **Complexity surcharge** — removed 2026-07-02. DB columns remain for
  historical jobs but are never written.
