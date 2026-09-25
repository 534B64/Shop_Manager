# Shop Manager — Handoff

Full current-state snapshot of the codebase, for the session-start ritual in
`CLAUDE.md`. This file was missing as of 2026-06-30 despite being referenced
there; recreated during a triage session (see `ROADMAP.md` for the decisions
that came out of it). Keep this updated at the end of any session that changes
architecture, not every session — day-to-day progress lives in `TASKS.md`.

## What's running

- **Stack**: TypeScript end to end. Fastify API + React/Vite/Tailwind client,
  built and served from one process in production (`server/index.ts`). SQLite
  via Drizzle ORM (`@libsql/client`), one file on a Docker volume meant to sit
  inside the shop's NAS → cloud backup pipeline.
- **Version**: v0.10.0 ("Shop Manager", renamed from "DP ERP" in Phase 10.5).
  DB filename and Docker/deploy artifact names were deliberately kept as
  `dp-erp.db` etc. to protect live data — a rename would need its own migration
  step, not done yet.
- **Current phase**: Phase 12 inventory management shipped 2026-07-09 (see
  `devlog.md` for the full entry): suppliers with lead time (backfilled from
  vendor free text — old columns retained read-only), per-item UOM
  (purchase/count unit + factor), blind cycle-count v2 with variance reason
  codes + immutable session snapshots (`cycle_count_lines`), count-derived
  avg daily usage → AUTO reorder-point suggestion, Min/Max + urgency-sorted
  needs-ordering view, receiving with per-receipt cost history, counter-sale
  deduction via Quick Order's optional from-stock picker (`recordSale`,
  payments → inventory via the module interface), and valuation / cost-trend
  / variance-trend reports. Migration `0012` (hand-written; drizzle-kit
  generate still blocked by the snapshot-meta collision). Suite: 147 tests.
  Phase 11 hardening shipped 2026-07-01. Phase 10 status: Slice 1 and
  Slice 2 Pass 1 done; Slice 2 Pass 2 (custom fields per category) stays
  schema-only/dormant. The roll-SKU seed from `Inventory-Restock-Review.xlsx`
  is still pending — do it now that supplier/UOM fields exist.

## Architecture at a glance

- `shared/` holds all business logic used by *both* client and server:
  `domain.ts` (enums/constants), `pricing.ts` (price-book engine),
  `priceVerify.ts` (server-side re-check of client quote math), `rolls.ts`
  (roll-width auto-select), `statusFlow.ts` (order lifecycle transitions),
  `stockCheck.ts` (advisory inventory lookup, incl. request derivation),
  `inventoryView.ts` (filter/search/group/sort pipeline). Each has a
  co-located `.test.ts` and zero framework/DB dependencies — this is where
  correctness lives.
- `server/modules/<domain>/` — domain modules (2026-07-03 reorg, ADR 0001):
  jobs, payments, customers, materials, inventory (incl. categories),
  settings, users. Each module's `index.ts` is its only import surface;
  money math is payments-owned (ADR 0002), the admin gate settings-owned and
  account verification users-owned (ADR 0003). All registered from
  `server/app.ts`; the app-factory pattern means `server/index.ts` (real
  server) and `server/integration.test.ts` (tests) build from identical
  wiring. API URL paths were not changed by the reorg.
- `server/db/schema/<domain>.ts` barreled through `server/db/schema/index.ts`
  — source of truth for the data model (definitions unchanged by the split).
  Migrations are checked into `server/db/migrations/` and run automatically on
  every `buildApp()` call; `server/db/index.ts` must not move (it resolves the
  migrations folder relative to itself).
- `src/modules/<domain>/*.tsx` — domain pages (Quotes/Orders/QuickOrder under
  jobs, Pos under payments, Inventory/Taxonomy under inventory, etc.);
  Dashboard, Settings, `src/components/`, and `src/lib/` stay app-level.
  `src/lib/ui.ts` is a shared style-primitives module; adoption across pages
  is partial and intentionally deferred (Phase 9 reskin).
- Auth is LAN-trust, not security: plain-text account passwords gate
  attribution/edits, a single shared admin password gates configuration. This
  is a documented, deliberate tradeoff for a 1–5 person shop tool, not an
  oversight — see `server/routes/users.ts` comments.

## Known gaps as of this snapshot (see `TASKS.md` for the live list)

- **The three drills have never been run** — deploy-to-NAS-over-real-wifi,
  backup/restore, and the non-owner quoting trial. Still the biggest unproven
  bets under the whole app, and now the critical path. Printable checklists:
  `DRILLS.md`.
- One-time roll-SKU seed from `Inventory-Restock-Review.xlsx` — unblocked by
  the 2026-07-01 integrity work, not yet done. Note: seed colors must exist in
  each material's admin color list first (the API now enforces it), and the
  seed should now also set supplier + UOM per item (Phase 12 fields).
- Supplier lead times are all at the default 7 days (backfill couldn't know
  real ones) — set them in Taxonomy → Suppliers before trusting AUTO Min.
- AUTO Min stays disabled per item until two completed counts produce a
  usage rate — expected, not a bug.
- Startup warning if the server is reachable on a non-private IP — the only
  remaining Phase 11 code item.
- Slice 2 Pass 2 (`categoryFields`) — schema-only, dormant on purpose.
- Calendar integration (Google/Microsoft) for cycle counts stays rejected —
  would violate CLAUDE.md's "no external SaaS dependencies" rule; the in-app
  auto-reschedule (shipped 2026-07-01) covers the forgetting problem.
  Revisiting the rule itself remains a separate, deliberate conversation.
- File-reference model: settled. `jobs.fileRef` / `jobItems.fileRef`
  (NAS-path text) is the only mechanism; the multipart upload endpoints were
  removed 2026-07-01.

## Where to look next

Read `ROADMAP.md` for the narrative behind current priorities and
`TASKS.md` for the phase-by-phase checklist — `TASKS.md` is the source of
truth for open work, this file is the source of truth for *why the codebase
looks the way it does*.
