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
- **Current phase**: Phase 11 hardening batch shipped 2026-07-01 (see
  `devlog.md` for the full entry): server-side quote-math verification,
  multi-line stock check (batched), roll-SKU DB integrity (migration `0011`),
  cycle-count auto-reschedule, attributable pickup overrides, upload
  endpoints removed. Phase 10 status: Slice 1 and Slice 2 Pass 1 done;
  Slice 2 Pass 2 (custom fields per category) is schema-ready
  (`categoryFields` table exists) but has no API or UI — deliberately dormant
  pending a later decision, not a bug. The roll-SKU seed from
  `Inventory-Restock-Review.xlsx` is now unblocked.

## Architecture at a glance

- `shared/` holds all business logic used by *both* client and server:
  `domain.ts` (enums/constants), `pricing.ts` (price-book engine),
  `priceVerify.ts` (server-side re-check of client quote math), `rolls.ts`
  (roll-width auto-select), `statusFlow.ts` (order lifecycle transitions),
  `stockCheck.ts` (advisory inventory lookup, incl. request derivation),
  `inventoryView.ts` (filter/search/group/sort pipeline). Each has a
  co-located `.test.ts` and zero framework/DB dependencies — this is where
  correctness lives.
- `server/routes/*.ts` — one file per resource (jobs, materials, customers,
  payments, inventory, settings, users, categories), registered from
  `server/app.ts`. The app-factory pattern means `server/index.ts` (real
  server) and `server/integration.test.ts` (tests) build from identical
  wiring.
- `server/db/schema.ts` — single source of truth for the data model.
  Migrations are checked into `server/db/migrations/` and run automatically on
  every `buildApp()` call.
- `src/pages/*.tsx` — one file per nav menu item (Dashboard, Quotes, Orders,
  Quick Order, Payments/Pos, Customers, Inventory, Materials, Settings).
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
  each material's admin color list first (the API now enforces it).
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
