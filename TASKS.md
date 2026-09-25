# Shop Manager — Build Plan

Phases ship independently. Each ends with something usable in the shop.

## Phase 0 — Foundation
- [x] Scaffold repo: Vite + React + Tailwind, Fastify API, SQLite + Drizzle, Docker
- [x] Design tokens + theme switcher (light / dark / minimal)
- [x] App shell: nav, layout, settings page
- [x] Seed script with realistic materials and sample jobs
- [ ] Deploy to NAS; verify access from two shop PCs over wifi

## Phase 1 — Quoting & Estimator (the v1 win)
- [x] Materials admin: CRUD for material types and unit costs
- [x] Estimator: dimensions + complexity scale + material → suggested price
- [x] Quote entry: manual price always allowed; store suggested vs. final
- [x] Customer record (name, phone, notes) attached to quote
- [x] Quote → order conversion
- [x] Print quote for the customer (browser print)
- [x] Unit tests on estimator math
- [ ] **Milestone: someone other than the owner quotes a real job**

## Phase 2 — Order Tracking
- [x] Order board grouped by status, due dates visible
- [x] Default short lifecycle; optional design/proof stage per job (transition rules + tests)
- [ ] Job detail: files reference (NAS path) — deferred
- [x] Due-date flagging (overdue / due soon)
- [ ] **Milestone: the notebook retires**

## Phase 3 — POS & Payments (record-only)
- [x] Payment recording: amount, method, date; balance due per order
- [x] Counter sale flow for retail/stock items
- [x] Daily sales view + CSV export (payments.csv, jobs.csv)
- [ ] **Blocked task: sit down with the CPA, define required reports** — until then CSV everywhere

## Phase 4 — Inventory
- [x] Item counts: vinyl, shirt blanks, magnet stock, retail items
- [x] Low-stock thresholds and an at-a-glance "what's low" panel
- [x] Cycle counts: count session workflow + scheduling
- [x] Manual adjust with reason log (received/used/damaged/cycle_count/correction)
- [ ] **Milestone: no more promising jobs against stock that isn't there**

## Phase 4.5 — Shop feedback round 1
- [x] Void payments (kept on the books with reason — never deleted)
- [x] Refunds (cash/check/card, or back to store credit)
- [x] Customer credit ledger (add/reduce/apply at POS)
- [x] Customers page: account view, job history, credit history
- [x] Estimator tuning in Settings (waste, markup, setup, labor/point, min price)
- [x] Complexity scale configurable 3–10 (recommend staying at 5)
- [x] Per-material labor factor (e.g. HTV press = 150% labor)
- [x] Lifecycle legend on Orders page

## Phase 4.6 — Shop feedback round 2 (v0.6.0)
- [x] Required sign-in (attribution): orders, payments, inventory changes record who
- [x] Admin password gate on tuning/materials/users (default `admin`, changeable)
- [x] Counter mode per device — hides "Owed" on customer-facing dashboard
- [x] Auto PO numbers `YYMMDD-###` + tags + design-file reference; search by any
- [x] Roll-width-aware waste in estimator (full-width strips, nesting across roll)
- [x] Reports: today / 7 / 30 days / custom range with method breakdown + CSV
- [x] Customers: last-purchase date, INACTIVE badge after 30 days idle
- [x] Inventory discrepancy logging (required note) + per-item change log
- [x] Theme picker with color-bar previews
- [x] Rebrand: "Decals Plus Shop Manager"; PO without DP prefix
- [ ] Multi-line-item POs — deferred; tags + notes cover it until proven needed

## Phase 4.7 — Shop feedback round 3 (v0.7.0)
- [x] Real sign-in: accounts with passwords; admin-only add/remove accounts
- [x] Per-account prefs: theme + dashboard card layout follow the user to any PC
- [x] Custom theme with 5 selectable accent colors
- [x] Quote maker: additional line items (with job type), total + total w/ tax, tax checkbox
- [x] Roll width shown only for sqft (vinyl) materials
- [x] Proof-flow jobs can only be saved as quotes (no direct order)
- [x] Design file is a real attachment (uploaded, stored beside DB, downloadable)
- [x] Tag buttons (rush, 2 color, 3 color, tshirt provided, due later) + custom
- [x] Mandatory fields: title, customer, phone, job type ('other' added)
- [x] Edit any job with account password (full form or Orders detail modal)
- [x] Orders: color-coded phase columns, click-through detail modal (read-only → Edit)
- [x] Picked-up jobs removable with account password (soft delete; payments kept)
- [x] POS renamed Payments; new Quick Order tab for counter sales
- [x] Customer order history printable (browser print → PDF)
- [x] Inventory purchasing: vendor + last cost paid, reorder report, usage trends

## Phase 4.8 — Shop feedback round 4 (v0.8.0)
- [x] Price book replaces estimator: per-inch (651 $1, cast $2), per-sqft (banner $6), per-unit w/ complexity range (shirts $24–30, provided $12, transfers $9 min 2), flat (magnets $65/$75), custom (aluminum, full-color)
- [x] Full pricing customizability in Materials admin (mode, rate, range, min qty, ×2/×3 color)
- [x] Tax on by default, 8.25% (admin-set); discounts apply after tax
- [x] Customer levels 0–3, admin-assigned, per-level discount %, hidden for level 0
- [x] PO format MMDDYY+seq (061226035); search by phone everywhere
- [x] Phone autoformat "(123) 456 - 7890" + validation; email must have @ and .
- [x] Item lines: type, material, dimensions, qty, price, per-item file upload
- [x] Statuses: Acknowledged → In Progress → Done → Picked Up (4 fixed columns)
- [x] No pickup with balance due — admin-password override popup
- [x] Quick Order requires a customer (Walk-in one tap)
- [x] Tags as colored chips on dashboard due list
- [x] Roll sizes 15/24/30/48 dropdown (vinyl only)

## Phase 5 — Polish & CPA Reports
- [ ] Build the reports the CPA actually asked for in Phase 3's conversation
- [x] Dashboard: due soon, owed, low stock on one screen
- [ ] Backup verification: confirm SQLite file is in the NAS → cloud pipeline
- [ ] Onboard the rest of the crew

## Phase 6 — Quote workflow round 5 (v0.9.0)
- [x] Complexity = flat per-line surcharge (1:$0 2:$2.50 3:$5 4:$7.50 5:$10), step editable in Settings — replaces the old rate2 complexity-range interpolation
- [x] Per-line color multiplier: tap a 2/3-color tag then tap a line; one item no longer multiplies the whole ticket; chips still display over the whole ticket
- [x] Roll auto-select: true width = roll − 1.5″, least-waste across either orientation (25×13→15″, 24×2→30″), auto with manual override; roll shown only for materials flagged "vinyl roll"
- [x] Add-on line items (t-shirt blank, squeegee, other) — flagged on Materials, priced in admin, quick-add buttons + grouped picker
- [x] Phone field only for new customers; material / qty / due date now required
- [x] Removed design-file uploads; larger notes pad; hideable Recent panel
- [ ] **Milestone: shop confirms the new quote flow on a real job**

## Phase 7 — Hardening (do before new features) — planned
See `ROADMAP.md` §E. **Step-by-step checklists for the three open drills: `DRILLS.md` (added 2026-07-01).**
- [ ] Deploy to NAS, fixed IP, verify from two PCs over wifi (closes Phase 0) — Drill 1 in `DRILLS.md`
- [ ] **Milestone: non-owner quotes ~3 real jobs; log time-vs-notebook + friction** (the v1 win) — Drill 3 in `DRILLS.md`
- [ ] Backup + restore drill: confirm `dp-erp.db` (+ `-wal`/`-shm`) in NAS→cloud pipeline, restore to a scratch container — Drill 2 in `DRILLS.md`
- [x] Trust fixes: non-blocking warning banner while admin password is default `admin` (chose warn-not-block); reconciled tax default to one shared constant `DEFAULT_TAX_RATE_PCT = 8.25` (server/Quotes/Settings); removed legacy `laborFactorPct` from materials PUT API
- [x] Integration tests: job creation/idempotency, status transitions (+ pickup gating & admin override), payment/void/refund/balance math (`server/integration.test.ts`; app factory extracted to `server/app.ts`) — run locally with `npm test`

## Phase 8 — Inventory-aware quoting — code complete (verify locally)
See `ROADMAP.md` §A. Advisory stock **check**, never per-job consumption; color does not change price.
- [x] Material color variants: `material_colors` table; admin color list on roll materials (Materials page); color dropdown in quote when a roll material is selected
- [x] Roll inventory as SKUs: `inventory_items` gained `material_id/color/nominal_width_in`; a roll SKU is just an inventory item (so cycle counts/adjust/low-stock maintain it). Add-SKU panel on Inventory page; auto-named `Name · Color · 24in`. Migration `0009_roll_skus` — **verified clean on a fresh DB**
- [x] Quote cross-reference (`shared/stockCheck.ts`, `GET /api/stock-check`): in stock → green ✓ · optimal out but fitting width in stock → **yellow** note + in-stock widths flagged in the roll picker · no fitting width → **red** out-of-stock warning
- [x] Advisory only — never blocks the quote; opt-in per material; no color/stock data → shows nothing (no false alarm)
- [x] Tests: three-state logic incl. "wider roll still fits" (`shared/stockCheck.test.ts`, 10 cases **verified passing**) + endpoint tests in `server/integration.test.ts`
- [ ] One-time load of current roll SKUs + counts, then rely on cycle counts (operational — your data entry)

## Phase 9 — UX/UI pass — partially done
See `ROADMAP.md` §B.
- [x] File reference by PO name: one-tap **Copy PO** (`CopyButton`) on Orders detail + Quotes recent list; editable **NAS-path/filename** reference field on Orders detail (no uploads — ROADMAP §C)
- [x] Design-system **foundation**: shared primitives in `src/lib/ui.ts` (button/input/card/chip/label class tokens + `copyToClipboard`) on the existing CSS-variable themes
- [x] Inventory filtering (speeds stock checks): search box (name/color/vendor) + filters for kind (rolls / other), material, color, size, and low-only; live "X of Y" count + Clear; roll SKUs tagged in the list
- [ ] Adopt direction B (dense + keyboard-fast quoting) with A's large, confident total — **deferred**: needs a live preview to iterate; migrate pages onto `src/lib/ui.ts` incrementally
- [ ] Reserve warm/rounded treatment (direction C) for counter-facing surfaces (Quick Order, customer printout) — deferred with the reskin

## Phase 10 — Inventory corrections
Driven by Josiah's real pain: organizing + finding inventory fast.

### Slice 1 — Inventory organization + advanced search/filter — DONE (verified locally 2026-06-16)
- [x] Pure `shared/inventoryView.ts` (+ `inventoryView.test.ts`, 31 cases): filter → search → group → sort pipeline; group by material (default) / color / size / unit; ordinary items bucket to "Other / Consumables" (always last); size sorts numerically
- [x] Search operators: contains / starts-with / ends-with / equals over name + color + vendor
- [x] `Inventory.tsx`: operator + group-by + sort dropdowns; collapsible group headers with count + LOW chips; existing controls/rows untouched. No schema change. `7-Runtime-Test.bat` passed locally.

### Slice 2 — Admin taxonomy (categories, units, sizes) + smart categories
**Pass 1 — DONE (verified 2026-06-16):** migration `0010_inventory_taxonomy` (new tables `categories`, `category_sizes`, `category_fields`; item columns `category_id`, `size_text`, `custom`, `order_note` — migrate-clean on a fresh DB verified). Admin-managed **unit types** (settings-backed; materials `unit` validation relaxed) + **categories** with smart defaults (default unit, tracks-color, default vendor) and per-category **size lists**. Category-aware item entry (pick category → pre-fills unit/vendor, conditional color, size-from-list or free). Category group/filter added to `inventoryView` (34 tests pass). Managed in **Settings → admin** (Inventory Settings folded in). Orthogonal to the roll-SKU/estimator path.
- [ ] **Pass 2 — custom fields per category** (defs: name + type text|number|select; values stored on items as JSON) + make custom-field values **searchable** + validation helper + tests. NOT started. *(2026-06-30 triage: `category_fields` table stays in schema but dormant — no commitment yet to build or remove it; decide once the higher-priority SKU-integrity and multi-line-stock-check items above are done.)*
- [ ] Seed from approved `Inventory-Restock-Review.xlsx` (after Josiah OKs it). Decided: auto-create roll SKUs for every color × width — mind the initial-count / temporary red out-of-stock-flag tradeoff.

### Next up (promoted 2026-06-30 triage — see below)
- [x] Stock-check on additional quote line items — DONE 2026-07-01: every quote line with a roll material gets its own color picker + advisory signal; all lines checked in ONE batched request (`POST /api/stock-check/batch`), request-building logic unified into `shared/stockCheck.ts` (`acrossFromDims`) so client and server can't drift.
- [x] Roll SKU data integrity — DONE 2026-07-01: migration `0011_roll_sku_integrity` adds a DB unique index on material + lower(color) + width (active SKUs); SKU create/edit validates color against the material's admin color list (400 with the valid list on a typo). Racy app-level dup pre-check removed; constraint violations map to the same friendly 409. **Restock-spreadsheet seed is now unblocked.**

### Later slices — deferred (not started)
- [ ] Roll-aware reorder / trends / dashboard reports (group by material/color/width/vendor)
- [ ] (Open) Any further inventory workflow bugs Josiah hits with real data

## Phase 10.5 — Live UI feedback, rename & theme (v0.10.0)
From a live walkthrough; all shipped 2026-06-16 (run `7-Runtime-Test.bat` to confirm the latest batch's typecheck).
- [x] Inventory page: removed the "Add vinyl roll SKU" box; widened New-item form + search + list to full width; rows now tag **category, color, size** (plus roll / LOW)
- [x] Inventory Settings folded into **Settings → admin** (standalone nav item + route removed)
- [x] Search fields added to Materials, Categories, Accounts, Payments (Customers + Inventory already had them)
- [x] Removed the redundant "customer-facing counter display" toggle from Settings
- [x] **Customers removable** with admin password — blocked if they have order history (books stay intact)
- [x] **Categories removable** with admin password — referencing items keep their data, just lose the category
- [x] **Orders removable** while no payment has been taken; once paid, must void/refund first (server-enforced)
- [x] App renamed **DP ERP → Shop Manager** (package name, doc headers, batch titles); version **0.8.0 → 0.10.0**. Deliberately kept the `dp-erp.db` filename + Docker/deploy artifact names to protect live data (rename later with migration steps if wanted)
- [x] Theme: **Light & Dark** both get the accent-color picker; **"Minimal" → "High Contrast"**; **Custom** removed as a theme (reserved for a future view option; any saved 'custom' migrates to Light)

## Phase 11 — Triage hardening (from 2026-06-30 codebase critique + grill session)
Not a feature phase — cleanup, risk-reduction, and doc fixes surfaced by an
external review of the whole codebase. See `HANDOFF.md` for the full critique
context.
- [x] Recreate `HANDOFF.md` (was referenced by `CLAUDE.md`'s session-start ritual but didn't exist)
- [x] Drop dead `materialLaborFactorPct` from the jobs API response (`server/routes/jobs.ts`) — legacy field, unused by the price book, was shipped on every job fetch for no reason
- [x] Merge `InventorySettings.tsx` into `Settings.tsx` — it was a leftover standalone file glued in via import since the Phase 10.5 UI fold; now properly inlined, file deleted
- [x] Remove the multipart file-upload endpoints — DONE 2026-07-01: `POST/GET /api/jobs/:id/file` + per-item upload deleted, `@fastify/multipart` dependency dropped, `fileRef` (NAS-path text) is the only mechanism, per ROADMAP §C.
- [x] Cycle counts auto-reschedule — DONE 2026-07-01: completing a count ALWAYS queues the next session (uses the date you pick, else +7 days); Inventory page default changed 30 → 7 days and shows the next date. In-app only, no external calendar (decision stands).
- [ ] Startup warning if the server is reachable on a non-private IP (LAN-trust security model has no code-level check today that the trust assumption still holds)
- [x] Attributable unpaid-pickup override — DONE 2026-07-01: Orders page sends the signed-in account with the override; server appends "[date] Picked up with $X balance due — admin override by NAME." to the job's notes and logs it.
- [x] Integration test coverage for inventory routes — DONE 2026-07-01: `/adjust`, cycle-count complete (+auto-reschedule), stock-check batch, SKU color validation, price verification, and override attribution all covered; suite now 28 integration tests / 119 total, all passing.
- [x] **Server-side quote-math verification** (added + DONE 2026-07-01, from the codebase critique's top finding): the server now recomputes the suggested total (`shared/priceVerify.ts` + material rules) and the grand total (tax → after-tax discount) on every job create/edit and stores ITS answer; a stale client (old tax rate / pricing settings) gets a non-blocking warning on the Quotes page. The human-set final price is never second-guessed.

## Phase 12 — Inventory management (weekly-cycle-count based) — shipped 2026-07-09
Full spec session with Josiah; all design decisions confirmed via Q&A first.
Core principle preserved: no production-consumption tracking — the weekly
count reconciles everything that isn't a tracked counter sale. Migration
`0012`; 147 tests passing; see `devlog.md` 2026-07-09 for the full entry.
- [x] Suppliers table (lead-time days, contact, active) + admin UI on Taxonomy page; backfilled from free-text vendor strings (vendor columns retained read-only); delete blocked while receipts reference the supplier
- [x] UOM per item: purchase unit / count unit / conversion factor (1:1 default; roll SKUs fixed at roll/roll — whole-roll counting decision stands); `count` always in count units
- [x] Cycle count v2: blind entry (system counts hidden), worklist grouped by category, variance review sorted by dollar impact, reason codes required above the configurable threshold (±5% or ±5 units default, Settings-adjustable), submit locks the session (who/when/what recorded in `cycle_count_lines`), auto-reschedule kept
- [x] Avg daily usage recomputed per item at session close (28-day count-to-count window + receipts) — no rate until two counts exist, no invented numbers
- [x] Min/Max reorder: `lowStockThreshold` stays the operative Min; AUTO button suggests usage × (supplier lead + buffer days); new Max (reorder-up-to); needs-ordering view sorted by urgency (days-until-stockout, then depth below Min)
- [x] Receiving form: qty in purchase units (converted), cost per purchase unit stored per receipt, supplier, who — cost-trend history per item
- [x] Counter-sale deduction: optional "from stock" picker on Quick Order → `/api/pos/sale` deducts (reason `sold`, idempotent on retry, clamps at zero, never blocks the sale)
- [x] Reports: stock-status dots (in/low/out), on-hand valuation (÷ factor × last cost), per-item cost trend + count-variance history with repeated-variance signal (3+ of last 4 counts flagged), usage view (replaced manual-tap trends)
- [ ] Set real lead times on the backfilled suppliers (Taxonomy → Suppliers; default 7d) — operational, your data entry
- [ ] Run `7-Runtime-Test.bat` to confirm this phase + the 2026-07-03 reorg locally
- [ ] **Milestone: two weekly counts completed → AUTO Min activates with real usage rates**

## Explicitly Out of Scope (v1)
- Per-job material consumption / partial roll tracking (the Phase 8 stock check is a count>0 *lookup*, not deduction; the Phase 12 counter-sale deduction is a tracked *sale* of a stocked item — a deliberate, single exception, not BOM consumption)
- Lot/batch tracking; multi-location/bin-level tracking; statistical safety-stock formulas (z-scores etc.) — Phase 12 non-goals, lead-time + avg usage is enough
- Integrated card processing (Stripe/Square/Venmo/CashApp) — revisit post-rollout; find what the shop swipes today first (see ROADMAP §D)
- Online ordering / customer portal
- User roles & permissions (revisit if team grows past ~5)
- Reorder-to-PO tracking / "on order" inventory flag (2026-06-30 triage: the printable reorder report is enough for now; don't grow it into a purchase-order system)
- Calendar-integrated cycle-count scheduling (2026-06-30 triage: would require an external SaaS dependency the LAN architecture explicitly rules out; use in-app auto-reschedule instead)
