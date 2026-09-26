# Shop Manager — Project Instructions

ERP/POS for Decals Plus, a 1–5 person custom graphics shop.

## Session start — read first
At the start of a session, before doing anything, read these to load current state:
1. `ROADMAP.md` — what we're working on next and why (current focus lives here).
2. `TASKS.md` — the phased build plan; **open `[ ]` items are the live backlog** (the in-chat task list does not persist between sessions, this file is the source of truth).
3. `CONTEXT.md` — business background. `HANDOFF.md` — full current state of the codebase.
4. `devlog.md` — accumulating changelog of what shipped/changed each session (skim the most recent entries for anything HANDOFF.md hasn't caught up on yet).

## Session end — update the devlog
At the end of any session that changed code, schema, architecture, or a
planning doc, update `devlog.md` in two ways, not just one:
1. **Edit** the relevant bullet(s) under "Current Feature Set" so that section
   always reflects the app as it exists right now — don't leave it describing
   something that changed or got removed this session.
2. **Append** a new dated entry under "Session Log" describing what changed,
   what was decided, and what's still open.
Both steps matter — Session Log is a history you never rewrite, but Current
Feature Set is a living description you must keep accurate by editing it in
place. Skip this entirely for pure-conversation sessions that touched no
files. This is in addition to, not instead of, keeping `TASKS.md`/`ROADMAP.md`
current.

**Current focus:** Phase 12 inventory management shipped 2026-07-09 (suppliers + lead time, UOM, blind cycle-count v2 with variance reason codes, Min/Max + AUTO reorder point, receiving with per-receipt cost, counter-sale deduction on Quick Order, valuation/cost/variance reports — migration `0012`, 147 tests, see devlog entry). Domain-module reorg shipped 2026-07-03 (ADR 0001–0003). **v0.10.0.** **Next:** (1) Josiah runs `7-Runtime-Test.bat` on Windows (confirms reorg + Phase 12 together; also rebuild `dist/` locally — the sandbox verified the build to a temp dir only), sets supplier lead times in Taxonomy → Suppliers, then the three drills in `DRILLS.md`, (2) seed inventory from the approved `Inventory-Restock-Review.xlsx` (now can include supplier/UOM in one pass), (3) then decide Slice 2 Pass 2 (custom fields) vs. Phase 9 reskin. See `ROADMAP.md`. Briefly tell me where we left off and the next action before starting work.

## Prime Directive

The v1 win condition: **anyone in the shop can quote a job consistently.** When prioritizing, the estimator and order tracking beat everything else. Build for busy people who wear all hats — if a feature requires discipline to maintain (e.g., per-job material deduction), it doesn't belong in v1.

## Architecture

- **Self-hosted LAN web app.** Server runs on the shop NAS/local PC (wired); clients are browsers on multiple shop PCs over sketchy wifi.
- **Stack**: TypeScript end to end. React + Vite + Tailwind frontend; Fastify (Node) API; **SQLite** via Drizzle ORM. Single Docker container for deployment.
- **Why SQLite**: one small team on a LAN; the DB is a single file that rides the existing NAS → cloud backup pipeline for free. Do not introduce Postgres/MySQL without an explicit decision.
- **Sketchy-wifi rules**: keep payloads small; autosave form drafts client-side; idempotent mutations with retry; no features that break if a request drops mid-flight.
- No external SaaS dependencies. No card processing. Payments are record-only.
- **Archive + audit (Phase 1b, 2026-09-25 — ADR 0005)**: nothing is hard-deleted (DB triggers enforce it); every mutation runs in one serialized `withTx` transaction with an append-only `audit_log` row; `GET /api/audit` (+ `.csv`) is admin-only, no UI yet.
- **Auth (Phase 1a, 2026-09-25 — ADR 0004)**: per-user roles cashier / manager / admin with scrypt-hashed PINs; server sessions (bearer token, 12 h idle / 7-day cap); every `/api` route except health + sign-in needs a session. Manager approval = a manager types their own name + PIN at the moment of a void/refund/unpaid pickup/removal/credit or stock correction, logged to the append-only `approvals` table. The old LAN-trust shared admin password and `AdminGate` are gone; the client uses `RoleGate` and the one shared approval dialog (`src/components/ApprovalDialog.tsx`, driven by `src/lib/api.ts`).

### Module map (2026-07-03 reorg — ADR 0001)

- **`server/modules/<domain>/`** — auth (sessions, roles, approvals — ADR 0004), audit (audit log — ADR 0005), jobs, payments, customers, materials, inventory (incl. categories, suppliers, locations, cycle counts, the ledger — ADR 0006), settings, users. Each has `routes.ts` (+ `service.ts`/`queries.ts` where warranted) behind **`index.ts`, the module's only import surface** — nothing outside a module folder imports its internals.
- **Cross-module rules:** money math lives in payments (`creditBalanceCents`, `paidNetCents`, `livePaymentCount` — ADR 0002); settings reads live in settings (`getSetting`, `setSetting`, `taxRatePct` — ADR 0003); **auth lives in `server/modules/auth`** (ADR 0004): sessions, `requireRole(req, reply, 'manager'|'admin')` for configuration, `requireApproval(req, reply, {action, entity, …})` for money/override actions. Never re-add a password-in-body check; attribution (`createdBy` etc.) always comes from `req.user`, never the request body.
- **`server/db/schema/<domain>.ts`** barreled through `server/db/schema/index.ts` (drizzle-kit's entry). Table definitions must stay in sync with checked-in migrations; `server/db/index.ts` must not move (it resolves the migrations folder relative to itself).
- **`shared/`** — unchanged: pure client+server business logic (pricing, rolls, stockCheck, statusFlow, priceVerify, inventoryView, domain), each with co-located tests.
- **`src/modules/<domain>/`** — domain pages (Quotes/Orders/QuickOrder → jobs, Pos → payments, etc.); Dashboard, Settings, `src/lib`, `src/components` stay app-level. API URL paths were NOT changed by the reorg.

## Domain Rules

- **Job types**: decal/vinyl, sign/large-format, apparel (heat press), magnet plate, retail. Apparel: t-shirt blanks are stocked; other fabrics are customer-supplied/outside-sourced per job.
- **Order lifecycle**: default simple path `Order → In Production → Done → Picked Up`. An optional design/proof stage (`Quote → Approved → Design → Production → Done → Picked Up`) can be enabled per job. Don't force the long path on simple jobs.
- **Estimator**: advisory, never binding. A quote is priced per **line** (the main item plus any additional items), each line independent. Per line: material price-rule (per-inch / per-sqft / per-unit / flat / custom) × qty × that line's color multiplier. **The complexity surcharge was removed entirely 2026-07-02** (DB columns retained for historical jobs, never written). Color (2/3) is assigned to a specific line so it never inflates the whole ticket. Output: suggested total. The user can always override with a manual price; record both suggested and final.
- **Materials admin**: back-end CRUD for material types, costs, price rules, and the `usesRoll` / `isAddon` flags. Changing a cost never rewrites historical quotes (cost is snapshotted on each job). Add-ons (t-shirt blank, squeegee, etc.) are flat-priced materials flagged `isAddon`. Roll materials (`usesRoll`) carry an admin-managed **color list** (a material *variant*, distinct from the 2/3-color price tag); color **does not change price** (planned, Phase 8).
- **Vinyl rolls**: materials flagged `usesRoll` show a roll-width picker. Usable width = nominal − 1.5″; the roll auto-selects for least waste across either orientation (override allowed). Roll choice is advisory/recorded — it does not change price.
- **Payments**: never hard-delete money rows. Mistakes are voided (with reason); refunds are their own rows; customer credit is a ledger. Balance = after-tax total − live payments + live refunds. Overpayment warns (client confirm) but is allowed — a future card processor would enforce a hard cap server-side (decided 2026-07-02).
- **Customers**: a valid email is **required** for every new customer (client + server enforced, 2026-07-02). Sole exemption: the generic `Walk-in` record Quick Order auto-creates.
- **Inventory ledger (Phase 2, 2026-09-26 — ADR 0006)**: perpetual inventory. Every on-hand change is one append-only **inventory transaction** (`inventory_adjustments`, evolved in place: `txn_type`, `location_id`, per-count-unit `unit_cost_cents`, `source_type/id`, `user_id`), written only through `postTransaction()` in the inventory service. A DB trigger applies each row to `inventory_balances` (item × location) and the `inventory_items.count` cache; guard triggers reject any other write to either — never write `count` directly, and seed stock as ledger rows. Item create takes a starting count as an `opening` transaction; item edit refuses `count`. **Moving weighted-average cost** (`avg_cost_cents`, math in `shared/costing.ts`); valuation = on-hand × average. Cycle counts: submit (snapshot, no stock change) → manager posts variance-based `count` transactions, or sends back. `production` exists only as a transaction type. `GET /api/inventory/reconcile` must stay empty.
- **Inventory**: simple unit counts, low-stock thresholds, cycle counts with scheduling. **No per-job/production consumption tracking** — deferred deliberately; the **weekly cycle count is the reconciler** for everything untracked (production use, waste, shrinkage). One deliberate exception (Phase 12, 2026-07-09): a Quick Order counter sale optionally linked to a stocked item **does** deduct on sale (reason `sold`, idempotent, clamps at zero, never blocks the sale). Items carry a preferred **supplier** (suppliers table with lead-time days; the old vendor free text is legacy/read-only) and a **UOM** (purchase unit / count unit / conversion factor; `count` is always count units; roll SKUs are whole rolls, 1:1 by decision). **Cycle count v2** is blind (system counts hidden during entry), grouped by category for the shop walk; variances above the Settings-configurable threshold require a reason code before submit; sessions lock and snapshot per-item lines; closing a session recomputes each item's avg daily usage, which drives the **AUTO reorder-point suggestion** (usage × (lead + buffer)) — `lowStockThreshold` stays the human-owned Min, `reorderMaxQty` is the order-up-to Max. Receiving records cost per purchase unit + supplier per receipt (cost-trend history). Roll materials are stocked as SKUs by **color + nominal width** (e.g. `651 · Red · 24in`), maintained via the weekly cycle count. The estimator does an **advisory stock *check*** at quote time (count > 0 across all in-stock widths of the chosen color): optimal width in stock → no flag; optimal out but a fitting width in stock → yellow note + that width highlighted; nothing fitting in stock → red out-of-stock warning. The check never blocks a quote and never deducts stock — it is a lookup, not consumption (Phase 8).
- **Reporting**: CPA requirements are TBD (pending conversation). Until defined, every money table gets a CSV export. Don't invent report formats.

## UI / Aesthetic

- Easier to read than a typical ERP: generous type size, clear hierarchy, no 40-column grids.
- But **dense enough to be meaningful** — a small-business dashboard, not a marketing site. One screen should answer "what's due, what's owed, what's low."
- Theme support is a requirement: light, dark, and a minimal mode. Build with CSS variables/design tokens from day one.
- Touch-friendly targets at the counter; keyboard-fast entry for quoting.

## Conventions

- Plain, boring code over clever code. This will be maintained sporadically.
- Migrations checked in; `db:migrate` must run clean on a fresh SQLite file.
- Seed script with realistic shop data (materials, sample jobs) for dev.
- Money as integer cents. Dates in ISO 8601, displayed local.
- Tests for the estimator math and status transitions at minimum.
- **No hard deletes** (ADR 0005). "Delete" archives (`archived_at`/`archived_by`, or `deleted_at` on jobs/job_items); list endpoints hide archived rows unless `?includeArchived=1`, and every archive has a `POST …/unarchive` with the same permission. SQLite triggers reject `DELETE` on the protected tables and edits to payment amounts / ledger rows — don't work around them.
- **Every mutation writes an audit row in the same transaction** — `audit(tx, req, {action, entity, entityId, before, after, approvalId})` from `server/modules/audit`. Only user theme prefs are exempt.
- **Multi-step writes use one transaction** — `withTx(async (tx) => …)` from `server/db` (not `db.transaction`, see ADR 0005). Inside it, every read that decides the write goes through `tx`; cross-module functions take an optional `dbx: Db = db`.

## Consulting Posture

Act as a senior developer and operations consultant: challenge scope creep, flag when a request contradicts the prime directive, and propose the simplest operationally-sound option first.
