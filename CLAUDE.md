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

**Current focus:** Phase 11 hardening shipped 2026-07-01 (server-side price verification, multi-line stock-check, roll-SKU DB integrity via migration `0011`, cycle-count auto-reschedule, attributable pickup overrides, upload endpoints removed — 119 tests passing in a clean sandbox). **v0.10.0.** **Next:** (1) Josiah runs the three drills in `DRILLS.md` (NAS deploy, backup/restore, quoting trial), (2) seed inventory from the approved `Inventory-Restock-Review.xlsx` (now unblocked), (3) then decide Slice 2 Pass 2 (custom fields) vs. Phase 9 reskin. NOTE: run `7-Runtime-Test.bat` locally once to confirm typecheck on Windows. See `ROADMAP.md`. Briefly tell me where we left off and the next action before starting work.

## Prime Directive

The v1 win condition: **anyone in the shop can quote a job consistently.** When prioritizing, the estimator and order tracking beat everything else. Build for busy people who wear all hats — if a feature requires discipline to maintain (e.g., per-job material deduction), it doesn't belong in v1.

## Architecture

- **Self-hosted LAN web app.** Server runs on the shop NAS/local PC (wired); clients are browsers on multiple shop PCs over sketchy wifi.
- **Stack**: TypeScript end to end. React + Vite + Tailwind frontend; Fastify (Node) API; **SQLite** via Drizzle ORM. Single Docker container for deployment.
- **Why SQLite**: one small team on a LAN; the DB is a single file that rides the existing NAS → cloud backup pipeline for free. Do not introduce Postgres/MySQL without an explicit decision.
- **Sketchy-wifi rules**: keep payloads small; autosave form drafts client-side; idempotent mutations with retry; no features that break if a request drops mid-flight.
- No external SaaS dependencies. No card processing. Payments are record-only.

## Domain Rules

- **Job types**: decal/vinyl, sign/large-format, apparel (heat press), magnet plate, retail. Apparel: t-shirt blanks are stocked; other fabrics are customer-supplied/outside-sourced per job.
- **Order lifecycle**: default simple path `Order → In Production → Done → Picked Up`. An optional design/proof stage (`Quote → Approved → Design → Production → Done → Picked Up`) can be enabled per job. Don't force the long path on simple jobs.
- **Estimator**: advisory, never binding. A quote is priced per **line** (the main item plus any additional items), each line independent. Per line: material price-rule (per-inch / per-sqft / per-unit / flat / custom) × qty × that line's color multiplier. **The complexity surcharge was removed entirely 2026-07-02** (DB columns retained for historical jobs, never written). Color (2/3) is assigned to a specific line so it never inflates the whole ticket. Output: suggested total. The user can always override with a manual price; record both suggested and final.
- **Materials admin**: back-end CRUD for material types, costs, price rules, and the `usesRoll` / `isAddon` flags. Changing a cost never rewrites historical quotes (cost is snapshotted on each job). Add-ons (t-shirt blank, squeegee, etc.) are flat-priced materials flagged `isAddon`. Roll materials (`usesRoll`) carry an admin-managed **color list** (a material *variant*, distinct from the 2/3-color price tag); color **does not change price** (planned, Phase 8).
- **Vinyl rolls**: materials flagged `usesRoll` show a roll-width picker. Usable width = nominal − 1.5″; the roll auto-selects for least waste across either orientation (override allowed). Roll choice is advisory/recorded — it does not change price.
- **Payments**: never hard-delete money rows. Mistakes are voided (with reason); refunds are their own rows; customer credit is a ledger. Balance = after-tax total − live payments + live refunds. Overpayment warns (client confirm) but is allowed — a future card processor would enforce a hard cap server-side (decided 2026-07-02).
- **Customers**: a valid email is **required** for every new customer (client + server enforced, 2026-07-02). Sole exemption: the generic `Walk-in` record Quick Order auto-creates.
- **Inventory**: simple unit counts, low-stock thresholds, cycle counts with scheduling. **No per-job consumption tracking** — deferred deliberately. Roll materials are stocked as SKUs by **color + nominal width** (e.g. `651 · Red · 24in`), maintained via the weekly cycle count. The estimator does an **advisory stock *check*** at quote time (count > 0 across all in-stock widths of the chosen color): optimal width in stock → no flag; optimal out but a fitting width in stock → yellow note + that width highlighted; nothing fitting in stock → red out-of-stock warning. The check never blocks a quote and never deducts stock — it is a lookup, not consumption (planned, Phase 8).
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

## Consulting Posture

Act as a senior developer and operations consultant: challenge scope creep, flag when a request contradicts the prime directive, and propose the simplest operationally-sound option first.
