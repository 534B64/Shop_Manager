# Shop Manager — Developer Log

A running technical record of the app: the full feature set as it exists
today, plus a dated entry for every session that changes it. Unlike
`HANDOFF.md` (a point-in-time snapshot rewritten as needed) and `TASKS.md`
(the live backlog), this file **accumulates** — old entries stay, new ones get
appended. If you want "what shipped and when," this is the file.

**Maintenance rule:** update this file at the end of any session that changes
code, schema, or architecture. Add a dated entry under Session Log; if the
change alters the feature set, update the relevant bullet under Current
Feature Set too. Skip the update only for pure conversation/planning sessions
that touched no files.

---

## Current Feature Set

### Architecture & technical decisions

- **Single-container monorepo.** One Fastify process serves both the JSON API (`/api/*`) and the built Vite/React SPA (`dist/`) in production — one port, one deploy artifact, no reverse proxy needed (`server/index.ts`).
- **TypeScript end to end**, with a `shared/` folder (`domain.ts`, `pricing.ts`, `priceVerify.ts`, `rolls.ts`, `statusFlow.ts`, `stockCheck.ts`, `inventoryView.ts`) imported by both client and server so business rules exist in exactly one place and are unit-testable without a browser or DB.
- **SQLite via Drizzle ORM** (`@libsql/client`), chosen over Postgres/MySQL: one small team on a flaky LAN, and a single `.db` file rides the shop's existing NAS → cloud backup pipeline for free.
- **WAL journal mode + foreign keys** turned on at boot so multiple counter PCs can read while one writes without locking each other out.
- **App factory pattern** (`server/app.ts` builds and registers routes but doesn't `listen()`) — the real server and the integration test suite build from the same function, so tests exercise identical wiring.
- **Migrations are checked into git** and run automatically at every `buildApp()` call, so a fresh SQLite file always comes up clean.
- **Idempotent mutations for sketchy wifi.** Job and payment creation take a client-generated UUID (`clientRef`); POSTing the same ref twice returns the original row instead of duplicating it. `src/lib/api.ts` retries on network failure only, never on HTTP error responses.
- **Money as integer cents** everywhere in the schema and pricing math.
- **Plain-text passwords, on purpose.** Both account and admin passwords are stored as plain text — this is a LAN tool gating *actions* and *config*, not a security boundary.
- **Soft deletes only for money-adjacent rows.** Jobs are soft-deleted (only when unpaid); payments are never deleted, only voided with a required reason; refunds are their own rows.
- **Docker multi-stage build** with the SQLite file and design-file references on a mounted volume so the container itself is disposable.

### Data model (`server/db/schema.ts`)

- **customers** — name/phone/email/notes plus an admin-assigned `level` (0–3) driving an after-tax discount.
- **materials** — the price-book engine's source of truth: `priceMode`, `rateCents`/`rate2Cents`, `minQty`, `colorMultiplier` opt-out, `usesRoll`/`isAddon` flags, snapshotted cost.
- **jobs** — the central order/quote record: idempotent `clientRef`, auto-generated `po`, lifecycle `status`, all estimator inputs, both `suggestedPriceCents` and `finalPriceCents`.
- **jobItems** — extra line items on a job beyond the primary item, each independently priced.
- **payments** — `kind` (payment/refund) and `method`, never hard-deleted; void with reason instead.
- **customerCredits** — a signed ledger (`deltaCents`) of store-credit grants/applications.
- **inventoryItems** — dual-purpose: plain stock rows *and* roll SKUs (same table, `materialId`+`color`+`nominalWidthIn` set); also carries the Phase 10 taxonomy columns.
- **categories / categorySizes / categoryFields** — admin-managed inventory taxonomy, explicitly orthogonal to the roll-SKU/pricing path. `categoryFields` (custom fields per category) is schema-only — no API/UI yet, deliberately dormant as of 2026-06-30.
- **materialColors** — admin-managed color list per roll material; a color is a material *variant*, never a price input.
- **inventoryAdjustments** — every count change is a logged, reason-coded delta.
- **cycleCounts** — scheduled count sessions; completing one auto-queues the next (chosen date, else +7 days) so the weekly rhythm never depends on memory (2026-07-01).
- **users** — LAN accounts with plain-text passwords, per-account JSON `prefs`.
- **settings** — generic key/value table backing tax rate, pricing tuning, unit-type list, level discounts, admin password.

### API surface (`server/routes/*.ts`)

- **jobs.ts** — search + idempotent create (auto-PO), full edit/soft-delete (account-password gated), status transitions (lifecycle-rule-enforced; pickup-with-balance-due blocked unless admin override, and every override is stamped onto the job's notes with the signed-in account name), quote→order conversion. **Server-side quote-math verification (2026-07-01):** create/edit recomputes the suggested total (`shared/priceVerify.ts` + material rules) and the grand total (tax → after-tax discount) and stores the server's answer; a mismatch returns a non-blocking `priceCheck` warning. File uploads are gone — `fileRef` (NAS-path text) is the only design-file mechanism (ROADMAP §C).
- **materials.ts** — price-book CRUD, hard-delete guard (refuses removal if referenced by any job), nested color-list CRUD.
- **inventory.ts** — item CRUD, reason-coded `/adjust`, cycle-count scheduling/completion (auto-queues the next session), reorder report, 6-month usage trends, roll-SKU create/list (color validated against the material's color list; duplicates blocked by the DB unique index from migration `0011`), advisory `/api/stock-check` + batched `/api/stock-check/batch` (one request covers every quote line), `/api/dashboard` low-stock summary.
- **customers.ts** — search, full account view (profile + credit + history), admin-gated level assignment, delete blocked if order history exists. New customers require a valid email (2026-07-02); the generic `Walk-in` record is the sole exemption.
- **payments.ts** — recording (incl. `credit` as a method drawing down store credit), void, `/api/balances`, date-range summary + CSV exports, `/api/pos/sale` for counter sales.
- **settings.ts** — tax rate, unit-type list, per-level discounts. (`/api/settings/pricing` — complexity max/step — removed 2026-07-02.)
- **users.ts** — account list/create/deactivate, sign-in verification, prefs save, non-blocking default-admin-password flag.
- **categories.ts** — category + size-list CRUD, admin-gated delete (clears references, doesn't cascade).

### Shared business logic (`shared/`)

- **pricing.ts** — price-book engine: per line, price = rule × qty × that line's color multiplier, rounded up to whole dollars. (Complexity surcharge removed 2026-07-02.)
- **rolls.ts** — auto-picks least-waste standard roll width across either part orientation (1.5″ usable-width margin).
- **stockCheck.ts** — advisory three-state availability check (in_stock / suboptimal / out_of_stock / unknown) across all in-stock widths of a chosen color; covers **every quote line** (main + additional items) since 2026-07-01. Also owns `acrossFromDims` so client and server derive stock-check requests identically.
- **priceVerify.ts** — server-side re-check of client quote math: suggested total across all lines + grand total (tax, after-tax discount), rounding mirrored from the Quotes page (2026-07-01).
- **statusFlow.ts** — two lifecycles (4-step simple, 6-step proof/design), one-step-forward/one-step-back transitions only.
- **inventoryView.ts** — filter → search → group → sort pipeline for the Inventory page.
- **domain.ts** — single source of truth for shared enums/constants.

### Frontend (`src/`)

- **App.tsx / Layout.tsx** — gated SPA with a persistent nav sidebar and a non-blocking default-admin-password warning banner; main content area is fluid (no max-width cap) so pages size to the window.
- **SignIn.tsx** — tap-a-name-then-type-password flow, applies the account's saved theme/dashboard prefs on success.
- **AdminGate.tsx** — reusable component locking any section behind the shop admin password, session-cached.
- **Dashboard.tsx** — one-screen "what's due, what's owed, what's low," three toggleable per-account cards, Owed hidden in counter mode.
- **Quotes.tsx** — autosaved draft, independently-priced multi-line items, tap-to-assign color tags, roll auto-select with override, live stock-check on **every line** (per-item color picker, one batched request), a non-blocking notice when the server corrects stale quote math, browser-print quote.
- **Orders.tsx** — Kanban board with color-coded phase columns, click-through detail modal → edit form. Proof columns (Quote/Approved/Design) are all-or-nothing: if any active job is in the proof flow all three render, so advancing a job visibly moves its card; with none, the simple 5-column board returns. Cards and history show the **after-tax total** (`totalCents`, falling back to pre-tax price); the detail modal shows a read-only "Total (with tax)" that the server recomputes on any money edit.
- **Pos.tsx (Payments)** — recording, void, refund (cash/check/card/store-credit), sales reporting + CSV. Recording more than the balance due triggers a confirm (warn-but-allow, decided 2026-07-02).
- **QuickOrder.tsx** — minimal counter-sale flow, Walk-in one-tap.
- **Inventory.tsx** — search/filter/group/sort, per-item adjust-with-reason, cycle-count entry, roll-SKU tagging.
- **Materials.tsx** — price-book admin + roll-color-list manager.
- **Taxonomy.tsx** — inventory taxonomy admin (unit types + smart categories/sizes), AdminGate-wrapped at `/taxonomy`, linked from Settings → Admin (moved out of Settings 2026-07-02).
- **Customers.tsx** — search, account detail, printable order history, admin-gated level assignment.
- **Settings.tsx** — theme picker (per-account), admin-gated tax/level-discount tuning, account management, admin password change. The Admin section links out to `/materials` and `/taxonomy` (taxonomy admin moved to its own page 2026-07-02; complexity tuning removed the same day).
- **lib/api.ts** — fetch wrapper retrying only on network failure.
- **lib/theme.ts** — CSS-custom-property theme/accent application.
- **lib/session.ts** — sign-in state, password/admin-unlock state (session-scoped).

### Testing (`vitest`)

- Pure-logic unit tests next to each `shared/` module.
- Integration tests (`server/integration.test.ts`) cover job creation/idempotency, status transitions, payment/void/refund math, roll-SKU integrity (dup + color-typo rejection), batch stock-check, quote-math verification, cycle-count auto-reschedule, inventory adjust, and override attribution — against a throwaway SQLite file per run. 118 tests total as of 2026-07-02 (complexity tests retired, email-rule tests added).

### Deployment

- `npm run build` + `npm start` (or Docker `CMD`) — Fastify serves the built client and falls back to `index.html` for SPA routing.
- Docker Compose maps a local `./data` folder (intended to be the NAS share) to `/app/data`.
- `batch/` holds Windows `.bat` scripts for install/seed/dev/production/hidden-run/typecheck, used for shop-PC operation without a terminal.
- **Unverified as of 2026-06-30:** deploy-to-NAS-over-real-wifi and a backup/restore drill have never actually been done — both are still open hardening items and the biggest unproven bets under the whole app.

---

## Session Log

### 2026-06-30 — Developer-log creation + codebase critique + triage
Two-part session: wrote this file and the original dev-log content (via
research across the full codebase), then ran a critique + `/grill-me`
session to turn findings into prioritized decisions.

**Docs created/fixed:**
- Created `devlog.md` (this file) and `HANDOFF.md` (was referenced by `CLAUDE.md`'s session-start ritual but didn't exist).
- Updated `TASKS.md`: added Phase 11 (triage hardening), promoted two Phase 10 "later slice" items to next-up, marked `categoryFields` as deliberately dormant, added two new "explicitly out of scope" entries.
- Updated `ROADMAP.md`: status note pointing to the triage outcome, and a new §D-pre flagging the "should the no-external-SaaS rule ever flex" question as a deliberately undecided, separate future conversation.

**Code changed:**
- Removed the dead `materialLaborFactorPct` field from the jobs API response (`server/routes/jobs.ts`) — legacy, unused by the price book, was shipped on every job fetch.
- Merged `InventorySettings.tsx` into `Settings.tsx` and deleted the standalone file — it had been a leftover seam since the Phase 10.5 UI fold-in. Typecheck (`tsc --noEmit`) verified clean after the merge.

**Decisions made (not yet built — see `TASKS.md` Phase 11 / promoted items):**
- Promote multi-line-item stock-check and roll-SKU data integrity (DB uniqueness + color validation) ahead of Slice 2 Pass 2 and the restock-spreadsheet seed — the integrity fix specifically before more SKU data gets loaded.
- Remove the Phase 4.7 multipart file-upload endpoints; revert to `fileRef` (NAS-path text reference) only — reason given: RAM/storage overhead, slows the app.
- Add in-app cycle-count auto-reschedule (default +7 days). Explicitly **rejected** Google/Microsoft Calendar integration for this — violates CLAUDE.md's no-external-SaaS rule; revisiting that rule is flagged as its own separate conversation, not decided here.
- Add a startup warning if the server is reachable on a non-private IP.
- Log the signed-in account name on admin-override pickup-with-balance-due actions (currently only the shared admin password is checked, no attribution).
- Add integration tests for the inventory HTTP routes (adjust, cycle-count complete, stock-check) before more inventory work lands.
- Explicitly declined as out of scope: an "on order" flag / reorder-to-PO tracking (the printable reorder report is enough for now), and `categoryFields` stays dormant pending a later decision.

**Known issue found but not fixed:** the sandbox's `vitest` run fails on a `@rollup/rollup-linux-x64-gnu` native-module mismatch (Windows-installed `node_modules` being run against a Linux test runner) — unrelated to any code change, verify the real test suite via `7-Runtime-Test.bat` locally as usual.

### 2026-07-01 — Phase 11 hardening batch (the 2026-06-30 triage, built)

One session shipped the whole promoted triage list plus the critique's top
finding. All verified in a clean Linux sandbox (fresh `npm install`): **119
tests passing (28 integration), `tsc --noEmit` clean, migration `0011` clean
on a fresh DB.** Run `7-Runtime-Test.bat` once locally to confirm on Windows.

**1. Server-side quote-math verification (the "Strong" critique finding).**
New `shared/priceVerify.ts` (+ 8 unit tests): suggested-total across all lines
and grand-total (tax → after-tax discount) with rounding mirrored from
`Quotes.tsx`. `POST/PUT /api/jobs` now recompute both from the server's own
settings + material rules and **store the server's answer** (suggested always;
total only when the client derived one, so quick callers keep the
finalPrice-as-balance path). Mismatches return a non-blocking `priceCheck`
object and log a warning; the Quotes page shows a dismissible "server
recalculated — refresh for current settings" notice. The human-set final
price is never touched.

**2. Multi-line stock check + unified request logic.** `shared/stockCheck.ts`
gained `acrossFromDims` + `StockLineQuery`, so client and server derive the
request identically (was hand-assembled on both sides). New
`POST /api/stock-check/batch` answers every quote line in one round trip
(sketchy-wifi friendly); the old GET stays for compatibility. Quotes page:
each additional item with a roll material now gets its own color picker
(color lists cached per material) and its own green/yellow/red advisory
signal + in-stock roll flags.

**3. Roll SKU integrity (before the seed load — now unblocked).** Migration
`0011_roll_sku_integrity`: DB unique index on material + lower(color) + width
(active SKUs only, so a retired SKU never blocks re-adding). The racy
app-level dup pre-check was removed; constraint violations map to the same
friendly 409. SKU create **and** color edits now validate against the
material's admin color list (400 lists the valid colors) — a typo can no
longer create an orphan color the stock check silently never finds.

**4. Cycle-count auto-reschedule.** Completing a count always queues the next
session — the date you pick, else +7 days (was: relied on the client passing
`nextScheduledFor`; Inventory page default also changed 30 → 7 days and the
completion alert shows the next date). In-app only; no external calendar.

**5. Attributable unpaid-pickup overrides.** Orders page sends the signed-in
account with the admin override; the server appends
`[date] Picked up with $X balance due — admin override by NAME.` to the job's
notes (visible everywhere, rides the same backup) and logs it.

**6. File uploads removed (ROADMAP §C, completed).** The three multipart
endpoints and the `@fastify/multipart` dependency are gone; `fileRef`
(NAS-path text + Copy-PO button) is the only design-file mechanism.
`jobItems.fileRef` column kept (harmless, holds text references).

**7. Tests + drills.** Integration suite extended to the inventory routes
(adjust, cycle-count complete, batch stock-check) and all of the above.
New `DRILLS.md`: printable checklists for the three never-run drills — NAS
deploy over real wifi, backup/restore, and the non-owner quoting trial —
which are now the critical path to rollout.

**Still open (deliberately):** startup warning on non-private IP (only
remaining Phase 11 code item); the three drills (Josiah, physical); the
one-time roll-SKU seed from `Inventory-Restock-Review.xlsx` (unblocked by #3);
Slice 2 Pass 2 (`categoryFields` still dormant); Phase 9 reskin.

**Note for the seed load:** migration `0011` will refuse to apply on a DB that
already contains duplicate active SKUs (same material+color+width, any case).
Dev DBs created through the app should be fine (the app blocked dupes at the
API level); if it ever fails, deactivate or merge the duplicates first.

### 2026-07-02 — Fluid page widths + Orders board proof-phase zones

Small UI session, two changes, no schema/API impact. Typecheck clean.

**1. Pages size to the window.** Removed the app-shell `max-w-7xl` cap
(`Layout.tsx`) and the per-page caps on data-dense surfaces: Payments
(`max-w-5xl` ×5), Materials (`max-w-4xl` ×3), Inventory panels (`max-w-3xl`
×4 — cycle count, reorder report, trends, change log), and the Orders
picked-up history list. Boards, lists, and search bars now stretch with the
browser window. Deliberately kept capped: Sign-in/AdminGate (`max-w-md`),
the order-detail modal (`max-w-lg`), Settings form sections (`max-w-2xl`),
and Quick Order (`max-w-xl`) — full-window text inputs hurt readability.

**2. Orders board: a ca
### 2026-07-02 (batch 2) — After-tax totals, overpayment warn, required email, complexity removed, taxonomy page

Live-feedback batch from Josiah. Typecheck clean; **118 tests passing** (5
complexity tests retired, 4 email-rule tests added).

**1. Orders shows the after-tax total.** Cards and the picked-up history now
display `totalCents ?? finalPriceCents`; the detail modal gains a read-only
"Total (with tax)" field. Server-side: `PUT /api/jobs/:id` now always
refreshes the stored `totalCents` when any money-relevant field changes
(previously only when the client sent one), so an edited price can't leave a
stale total on the board. `/api/balances` already used
`coalesce(totalCents, finalPriceCents)` — no change needed there.

**2. Overpayment: warn but allow (decided).** Recording a payment above the
balance due pops a confirm naming the overage and pointing to store credit
for intentional extra money. Server still accepts — chosen over a hard block.
NOTE for future card processing: Stripe-style integration will need a
server-side cap; revisit then.

**3. Email required for new customers (decided).** Quote form's new-customer
block now has a required, validated email field next to phone; enforced
server-side in both `POST /api/jobs` (`newCustomer` schema) and
`POST /api/customers` (regex check). Sole exemption: the generic `Walk-in`
record Quick Order auto-creates. Existing customers are untouched.

**4. Complexity surcharge removed entirely (decided).** Gone from
`shared/pricing.ts` (suggest = rule × qty × color mult, rounded up),
`priceVerify.ts`, the jobs API schema/verify/insert, the Quotes UI (both the
main picker and per-item selects), and Settings (complexity max/step inputs
and the whole `/api/settings/pricing` endpoint). DB columns
(`jobs.complexity`, `job_items.complexity`) are retained for historical jobs
but never written. `per_unit` label renamed from "Per unit (complexity
range)" to "Per unit". CLAUDE.md domain rule updated.

**5. Inventory taxonomy → own page.** Units + categories/sizes admin moved
from an inline Settings section to `/taxonomy` (new `Taxonomy.tsx`,
AdminGate-wrapped), linked from Settings → Admin next to "Manage materials &
costs" — same pattern as `/materials`.

**Sandbox note:** OneDrive sync into the verification sandbox lagged file
tails this session (NUL-padded/truncated copies). Worked around by patching a
`/tmp` copy; also installed the Linux native binaries
(`@rollup/rollup-linux-x64-gnu`, `@esbuild/linux-x64` ×2 versions,
`@libsql/linux-x64-gnu`) into `node_modules` so future sandbox test runs work
alongside the Windows binaries. Harmless to Windows use.

**Still open (unchanged):** `7-Runtime-Test.bat` on Windows; the three
`DRILLS.md` drills; roll-SKU seed; Slice 2 Pass 2 vs. Phase 9 reskin.
