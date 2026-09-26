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
- **TypeScript end to end**, with a `shared/` folder (`domain.ts`, `pricing.ts`, `priceVerify.ts`, `rolls.ts`, `statusFlow.ts`, `stockCheck.ts`, `countReview.ts`, `reorder.ts`, `costing.ts`, `invoice.ts`) imported by both client and server so business rules exist in exactly one place and are unit-testable without a browser or DB.
- **SQLite via Drizzle ORM** (`@libsql/client`), chosen over Postgres/MySQL: one small team on a flaky LAN, and a single `.db` file rides the shop's existing NAS → cloud backup pipeline for free.
- **WAL journal mode + foreign keys** turned on at boot so multiple counter PCs can read while one writes without locking each other out.
- **App factory pattern** (`server/app.ts` builds and registers routes but doesn't `listen()`) — the real server and the integration test suite build from the same function, so tests exercise identical wiring.
- **Domain modules (2026-07-03 reorg).** Server code lives in `server/modules/<domain>/` (auth, audit, jobs, payments, sales, customers, materials, inventory, settings, users), each with `routes.ts` (+ `service.ts`/`queries.ts` where warranted) behind an `index.ts` that is the module's **only** import surface (ADR 0001). Money math is payments-owned (ADR 0002); settings reads are settings-owned (ADR 0003); sessions, roles, and manager approvals are auth-owned (ADR 0004); invoices, voids, returns and the cash drawer are sales-owned (ADR 0007). Client pages live in one folder per route under `src/modules/<domain>/` (wave 2, 2026-09-26: jobs `quote/ orders/ quick/`, pos `counter/ drawer/ invoices/ returns/`, payments, customers, inventory `list/ item/ receiving/ counts/ adjustments/ reorder/`); app-level pages in `src/pages/{dashboard,settings,reports,audit}`.
- **Migrations are checked into git** and run automatically at every `buildApp()` call, so a fresh SQLite file always comes up clean.
- **Idempotent mutations for sketchy wifi.** Job, payment, sale and return creation take a client-generated id (`clientRef`, from `src/lib/ref.ts` — `crypto.randomUUID` is missing on the shop's plain-http LAN origin, so it falls back to `getRandomValues`); POSTing the same ref twice returns the original row instead of duplicating it. `src/lib/api.ts` retries on network failure only, never on HTTP error responses.
- **Money as integer cents** everywhere in the schema and pricing math.
- **Roles, sessions, manager approval (Phase 1a, 2026-09-25 — ADR 0004).** Per-user roles cashier/manager/admin with scrypt-hashed PINs (node:crypto); server sessions (sha256-hashed bearer token, 12 h sliding idle, 7-day cap); a root `onRequest` hook 401s every `/api` route except health + sign-in. Configuration is `requireRole`-gated; money/override actions are `requireApproval`-gated (a manager acts alone or types their name + PIN for a cashier) and log to the append-only `approvals` table. Attribution comes from the session, never the body. The shared admin password and all plaintext passwords are gone (startup upgrade hashes legacy passwords once). Login rate limit: 10 failures / name / 5 min.
- **No hard deletes, audit log, one transaction per write (Phase 1b, 2026-09-25 — ADR 0005).** Every "delete" archives (`archived_at`/`archived_by` on customers, categories, category sizes, suppliers, materials, material colors; jobs keep `deleted_at`; replaced job lines get `deleted_at`), with a matching `POST …/unarchive`; lists hide archived rows unless `?includeArchived=1`. SQLite triggers reject `DELETE` on every transactional/master table and edits to payments (only an unvoided payment's void fields may change), credits, adjustments, count lines and the audit log. Every mutating route runs in `withTx` (one `BEGIN IMMEDIATE` on a dedicated writer connection, serialized in-process, re-entrant) and writes one append-only `audit_log` row (who, before/after JSON, linked approval id, request id) in the same transaction — only user theme prefs are exempt. Payments are voided with a required reason, never deleted; refunds are their own rows.
- **Docker multi-stage build** with the SQLite file and design-file references on a mounted volume so the container itself is disposable.

### Data model (`server/db/schema/<domain>.ts`, barreled through `schema/index.ts`)

- **customers** — name/phone/email/notes plus an admin-assigned `level` (0–3) driving an after-tax discount; `archived_at`/`archived_by` (0014).
- **materials** — the price-book engine's source of truth: `priceMode`, `rateCents`/`rate2Cents`, `minQty`, `colorMultiplier` opt-out, `usesRoll`/`isAddon` flags, snapshotted cost.
- **jobs** — the central order/quote record: idempotent `clientRef`, auto-generated `po`, lifecycle `status`, all estimator inputs, both `suggestedPriceCents` and `finalPriceCents`; `tax_rate_pct` (0016) = the rate its stored total was computed with.
- **jobItems** — extra line items on a job beyond the primary item, each independently priced. An edit that replaces the lines soft-deletes the old ones (`deleted_at`, 0014); readers ignore them.
- **payments** — `kind` (payment/refund) and `method`, never hard-deleted; void with reason instead. DB triggers (0014, recreated in 0016) block DELETE and any change except voiding an unvoided row. Since 0016: `drawer_session_id` (every row written while a drawer is open), `tendered_cents` + `change_cents` (cash), `return_id` / `invoice_void_id` (what a refund was for).
- **invoices / invoice_lines (Phase 3, 2026-09-26 — ADR 0007)** — locked sale snapshots, UPDATE/DELETE blocked by trigger: gap-free `number` (unique; the insert trigger only accepts the number `number_sequences` just handed out), job, customer + name, PO, source `job`/`counter_sale`, rate, subtotal/tax/discount/total, drawer session; lines carry qty, unit price, subtotal, suggested, taxable, rate, **tax per line**, discount share, total, stock item + qty deducted.
- **number_sequences** — gap-free counters (`invoice`); UPDATE may only step +1, never DELETE.
- **invoice_voids / returns / return_lines** — append-only: one void per invoice (reason, refund, `net_total_cents`/`net_tax_cents` = what it cancelled after earlier returns (0017, wave 1), job archived?, approval, drawer); RMA header (client ref, reason, value parts, refund + method, approval, drawer) and lines (qty, restock, restocked qty, value parts).
- **drawer_sessions** — cash drawer: register (1), float, opened by/at; closed once (manager+) with expected/counted/over-short for cash and checks and the frozen `z_report_json`; one open per register (partial unique index); no DELETE, no UPDATE after close.
- **customerCredits** — a signed ledger (`deltaCents`) of store-credit grants/applications.
- **inventoryItems** — dual-purpose: plain stock rows *and* roll SKUs (same table, `materialId`+`color`+`nominalWidthIn` set); also carries the Phase 10 taxonomy columns and, since migration `0012` (2026-07-09), supplier + UOM (`purchaseUnit`/`countUnit`/`purchaseToCountFactor`, `count` always in count units), `reorderMaxQty` (Max; `lowStockThreshold` stays the Min), and the count-derived `avgDailyUse`.
- **suppliers** — name, `leadTimeDays` (feeds the AUTO reorder-point suggestion), contact, active flag; unique on lower(name). Backfilled by migration `0012` from the old free-text vendor strings, which remain in the DB for history but are no longer written by the UI.
- **categories / categorySizes / categoryFields** — admin-managed inventory taxonomy, explicitly orthogonal to the roll-SKU/pricing path. `categoryFields` (custom fields per category) is schema-only — no API/UI yet, deliberately dormant as of 2026-06-30. Categories gained `defaultSupplierId` (2026-07-09), superseding the free-text `defaultVendor`.
- **materialColors** — admin-managed color list per roll material; a color is a material *variant*, never a price input.
- **inventoryAdjustments = the inventory transaction ledger (Phase 2, 2026-09-26 — ADR 0006)** — append-only; `txn_type` (receipt/sale/return/adjustment/transfer_out/transfer_in/production/count/opening), `location_id`, `unit_cost_cents` per COUNT unit on every row (the old per-purchase-unit receipt cost is now `purchase_unit_cost_cents`), `source_type`/`source_id`, `user_id`. A trigger applies each row to `inventory_balances` (item × location, new) and the `inventory_items.count` cache; guard triggers reject any other write. `locations` (default 1 = Shop) is new; items gained `avg_cost_cents` (moving weighted average). Before Phase 2: every count change is a logged, reason-coded delta. Since 2026-07-09: receipts carry `unitCostCents` (per purchase unit) + `supplierId` (the per-receipt cost history behind the cost-trend view), count-session rows carry `cycleCountId`, and the reason enum grew `sold` + the variance reason codes (see `ADJUST_REASONS` in `shared/domain.ts`).
- **cycleCounts / cycleCountLines** — since Phase 2 a session has `status` counting → submitted → posted (+ `submission` round, `submitted_by/at`, `posted_by`); lines are tagged with their round, and posting writes variance-based `count` transactions. Scheduled count sessions; completing one auto-queues the next (chosen date, else +7 days) so the weekly rhythm never depends on memory (2026-07-01). Since 2026-07-09 a session records `completedBy` and writes one immutable `cycleCountLines` snapshot per counted item (system count, counted qty, cost snapshot, reason code, note) — the data behind variance review and the per-item variance trend.
- **users** — accounts with `role` (cashier/manager/admin, CHECK-constrained), `pinHash` (scrypt), active flag, per-account JSON `prefs`. The legacy plaintext `password` column is kept for migration history only and NULLed by the startup upgrade (migration `0013`).
- **sessions** — sha256 of the bearer token (PK), user, created / last-seen / expires / revoked timestamps (`0013`).
- **approvals** — append-only (UPDATE/DELETE triggers) log of every manager-approved action: action, entity, entity id, requested by, approved by, reason, details JSON (`0013`).
- **settings** — generic key/value table backing tax rate, unit-type list, level discounts, inventory knobs, POS knobs (`posSettings.refundApprovalThresholdCents`, default 5000). (The `adminPassword` row was deleted by `0013`.)
- **audit_log** — append-only (UPDATE/DELETE triggers): `at`, `user_id`, `action` (`<entity>.<verb>`), `entity`, `entity_id`, `before_json`, `after_json`, `approval_id`, `request_id`; indexed on `(entity, entity_id)` and `at` (0014).
- **Archive columns (0014)** — `archived_at`/`archived_by` also on materials, material_colors, suppliers, categories, category_sizes. 0014 also added lookup indexes (jobs created_at/status/customer, job_items job, payments job/created_at, credits customer, adjustments item+created_at/created_at, count lines session, customers name/email, approvals created_at).

### API surface (`server/modules/<domain>/`)

- **modules/jobs** — search (SQL `LIKE` on title/PO/tags/file/customer **before** the limit — fixed 2026-09-25) + idempotent create (auto-PO), full edit (any signed-in account; replaced lines soft-deleted) / soft-delete (manager approval) + `POST /:id/unarchive` (approval `job.unarchive`), status transitions (lifecycle-rule-enforced; pickup-with-balance-due returns 402, then needs a manager-approved override — stamped onto the job's notes with approver + requester and logged to `approvals`), quote→order conversion. **Phase 3:** pickup issues the invoice; an invoiced job refuses (409) changes to price/tax/discount/customer/estimator inputs/lines (unchanged re-sends are fine) and removal; a saved price ≠ the suggestion needs approval `price.override` (create, and edits that create/change the override). **Server-side quote-math verification (2026-07-01):** create/edit recomputes the suggested total (`shared/priceVerify.ts` + material rules) and the grand total (tax → after-tax discount) and stores the server's answer; a mismatch returns a non-blocking `priceCheck` warning. File uploads are gone — `fileRef` (NAS-path text) is the only design-file mechanism (ROADMAP §C). **Wave 2 (`lists.ts`):** `GET /api/jobs` is paged (`{rows,total,limit,offset}`, `q` + `status` list) **only when `offset` is sent** — `?limit=` alone keeps the old bare array; `GET /api/jobs/board` (every lane's first `limit` jobs, soonest due first, + lane counts), `GET /api/jobs/due-soon?days&limit&today` (open jobs due within N days incl. overdue + counts); job detail returns its live `invoice` (number) and `owedCents`.
- **modules/auth** (2026-09-25, ADR 0004) — `/api/auth/login`, `/logout`, `/me`, public `/status` (sign-in account picker + `needsSetup`) and first-run `/setup` (creates the first admin only while none can sign in); admin-only `GET /api/approvals` (who approved what, names joined, keyset-paged, action/entity/user/date filters — wave 2); the root auth hook; `requireRole` / `requireApproval`; the plaintext-password startup upgrade.
- **modules/audit** (2026-09-25, ADR 0005) — `audit(tx, req, …)` used by every mutating route; admin-only `GET /api/audit` (entity / entityId / userId / from / to filters, newest first, keyset `before` cursor, limit ≤ 200) and `GET /api/audit.csv`, shown on `/audit` (wave 2).
- **modules/materials** — price-book CRUD (admin-only); DELETE archives (jobs that used it still show it) + `/unarchive`; nested color list with archive/unarchive. `?includeArchived=1` on both lists.
- **modules/inventory (Phase 2 ledger)** — `postTransaction()` in `service.ts` is the only on-hand write path (`receive`/`adjust`/`transfer`/`recordSale`/`recordReturn`/`recordProduction` wrap it); item create writes an `opening` transaction for a starting count, item edit refuses `count` (400); `POST /:id/transfer` (manager+), `GET /:id/transactions` (keyset paged), `GET /:id/balances`, `GET /api/inventory/reconcile` (manager+), `/api/locations` CRUD + archive (admin); `cycle-counts.routes.ts`: `/submit` (anyone; snapshot, no stock change; `post:true` lets a manager post in one step), `/post` (approval `cycle_count.post`), `/send-back` (manager+). Valuation = on-hand × `avg_cost_cents`. Earlier: item CRUD (incl. supplier/UOM/Min–Max fields), reason-coded `/adjust` (receiving persists per-receipt cost + supplier; any non-receipt adjustment needs manager approval), cycle-count v2 completion (blind-count reconciliation: per-item snapshot lines, server-enforced reason codes above the configurable variance threshold, one-shot lock, avg-daily-usage recompute, auto-queues the next session), needs-ordering view (`/api/inventory/reorder`, urgency-sorted with supplier lead time + days-until-stockout), `/api/inventory/usage` (count-derived rates — replaced the manual-tap trends 2026-07-09), `/api/inventory/valuation`, per-item `/cost-history` and `/variances` (with the repeated-variance signal), roll-SKU create/list (color validated against the material's color list; duplicates blocked by the DB unique index from migration `0011`), advisory `/api/stock-check` + batched `/api/stock-check/batch` (one request covers every quote line), `/api/dashboard` low-stock summary (SQL: most urgent 20 + `lowStockCount`, 2026-09-26). **Server paging (2026-09-26, ADR 0009, `lists.ts`):** `/api/inventory`, `/reorder` and `/usage` return `{ rows, total, limit, offset }` when `limit`/`offset` is sent, with `q`/`kind`/`materialId`/`color`/`widthIn`/`categoryId`/`supplierId`/`low`/`stock` filters and (items) `sort`/`dir` in SQL — the old bare-array responses are unchanged without them; valuation sums in SQL. **Wave 2:** `GET /api/inventory/:id` (one item), `GET /api/inventory/transactions` (manager+, the ledger across items, keyset, `type`/`itemId`/`from`/`to`), `GET /api/cycle-counts` (history, paged) + `GET /api/cycle-counts/:id` (lines only once submitted — entry stays blind); the item list also takes `ids=`, `match=contains|starts|ends|exact`, sorts `size`/`color`/`low` (low first) and `group=material|color|size|unit|category` (ordered by the group, `groupKey`/`groupLabel` per row + per-group counts — the old page's Group by). Interface exports `recordSale` — the one inventory write other modules may call (payments' counter-sale deduction).
- **modules/inventory (suppliers.routes.ts)** — supplier CRUD (manager+); DELETE archives (admin-only; receipts, items and category defaults keep the reference) + `/unarchive`.
- **modules/customers** — search, full account view (profile + credit + history), manager-only level assignment, manager-approved archive/unarchive (orders, payments and the credit ledger are untouched; `?includeArchived=1` on the list) and manager-approved store-credit adjustments. New customers require a valid email (2026-07-02); the generic `Walk-in` record is the sole exemption. Wave 2: `GET /api/customers` is paged with `limit`/`offset` (`q` over name/email/phone digits, `sort=recent|name|created`, `includeArchived`); `PUT /api/customers/:id` checks a sent email's format and refuses clearing an existing one but no longer demands an email on edits that don't touch it (older customers without one can have name/phone/notes fixed); renaming Walk-in into a real customer still needs one.
- **modules/payments** — recording (incl. `credit` as a method drawing down store credit; cash needs an open drawer, optional `tenderedCents` → change recorded; a payment that settles the job issues its invoice and returns it), void and refund (both manager-approved; since wave 1 a refund over what the job was paid is refused 409, and a payment can't be voided when it is a return's/void's refund or sits in a closed drawer — issue a refund/return instead), `/api/balances` (net of returned goods, archived jobs left out since Phase 3; wave 2: paged with `q`, largest first, + `totalOwedCents`), `/api/payments` paged (`q`, newest first; unpaged = newest 100 as before), date-range summary (wave 2: range filtered in SQL, `from` may be a timestamp, adds `paymentCount`) + CSV exports. `recordPayment()` is the single writer of payment rows. Interface exports `creditBalanceCents` / `paidNetCents` / `livePaymentCount` / `returnedCents` / `owedCents` / `openDrawer` / `recordPayment` — the only money math other modules may call (ADR 0002).
- **modules/sales (Phase 3, 2026-09-26 — ADR 0007)** — `/api/pos/sale` (moved from payments, same path + legacy body; also itemized `lines`, `taxable`, `tenderedCents`, per-line `suggestedUnitPriceCents` → override approval): job + stock deduction (reason `sold`, idempotent, clamps at zero) + invoice + payment in one transaction. `GET /api/invoices` (keyset, filters), `GET /api/invoices/:number`, `POST /api/invoices` (invoice a job by hand), `POST /api/invoices/:id/void` (approval; puts back stock sold minus every unit already returned, records its net-of-returns total/tax for the Z-report), `POST /api/returns` (threshold approval; restocks at most what the sale deducted), `GET /api/returns`, `GET /api/returns/:id`, `POST /api/drawer/open`, `GET /api/drawer/current`, `POST /api/drawer/close` (manager+), `GET /api/drawer`, `GET /api/drawer/:id`, `GET /api/drawer/:id/z-report` (+ `.csv`). Interface: `invoiceJob`, `invoiceIfSettled`, `liveInvoiceForJob`. $0 pickups take no invoice number (wave 1). Wave 2: `GET /api/reports/sales?from&to` (manager+, `reports.ts`) — invoices issued, voids and returns made in the range, netted with the Z-report rule, all in SQL.
- **modules/settings** — tax rate, unit-type list, per-level discounts, inventory knobs (`/api/settings/inventory`: variance thresholds ±% / ±units + reorder buffer days), POS knobs (`/api/settings/pos`: refund approval threshold). Writes are admin-only (unit list: manager). Interface exports `getSetting`/`setSetting`/`taxRatePct`/`posSettings` (ADR 0003).
- **modules/users** — account list; admin create (name + role + PIN), role change, PIN reset, deactivate/reactivate (never delete) with a last-active-admin guard; own PIN change (current PIN required); own prefs save.
- **modules/inventory (categories.routes.ts)** — category + size-list CRUD (manager+); category DELETE archives (admin-only; items keep the category, sizes/fields stay), size DELETE archives (manager+); both have `/unarchive`. Categories folded into the inventory module (inventory-only by decision).

### Shared business logic (`shared/`)

- **pricing.ts** — price-book engine: per line, price = rule × qty × that line's color multiplier, rounded up to whole dollars. (Complexity surcharge removed 2026-07-02.)
- **rolls.ts** — auto-picks least-waste standard roll width across either part orientation (1.5″ usable-width margin).
- **stockCheck.ts** — advisory three-state availability check (in_stock / suboptimal / out_of_stock / unknown) across all in-stock widths of a chosen color; covers **every quote line** (main + additional items) since 2026-07-01. Also owns `acrossFromDims` so client and server derive stock-check requests identically.
- **priceVerify.ts** — server-side re-check of client quote math: suggested total across all lines + grand total (tax, after-tax discount), rounding mirrored from the Quotes page (2026-07-01).
- **statusFlow.ts** — two lifecycles (4-step simple, 6-step proof/design), one-step-forward/one-step-back transitions only.
- **countReview.ts** — cycle-count variance math shared by the review screen and the submit validation: threshold flagging (beats ±% OR ±units; found-from-zero always flags), dollar-impact sort, and the repeated-variance signal (3+ of the last 4 counts flagged).
- **reorder.ts** — reorder math: count-to-count avg daily usage, suggested Min (`usage × (lead time + buffer)`, never invented without history), days-until-stockout, and the needs-ordering urgency comparator.
- **invoice.ts** (Phase 3) — per-line tax (round half-up), after-tax discount allocated to lines (largest remainder), `taxForTotal` for pre-Phase-3 totals, pro-rated return refunds that sum exactly to the line, refund-only-what-was-overpaid, change, over/short, invoice-number format/parse, and the Z-report builder (+ `netSales`, shared with the date-range sales report).
- **domain.ts** — single source of truth for shared enums/constants, incl. `ADJUST_REASONS` / `VARIANCE_REASON_CODES` + labels.

### Frontend (`src/` — domain pages under `src/modules/<domain>/`, app chrome in `src/pages` + `src/components` + `src/lib`)

- **App.tsx / routes.tsx / shell/AppShell.tsx** (Material 3, 2026-09-26, ADR 0009) — session-gated SPA (any 401 drops back to sign-in — except a wrong PIN on sign-in/setup/own-PIN-change, fixed wave 2; role refreshed from `/api/auth/me` on load). One route table (`src/routes.tsx`, map in `docs/UI-GUIDE.md`): every page `React.lazy`-loaded behind one Suspense bar; real URLs — `/`, `/quotes/new`, `/quotes/:id`, `/orders`, `/quick`, `/pos` (counter; `/pos/counter` redirects), `/pos/drawer[/:id]`, `/pos/invoices[/:number]`, `/pos/returns[/new|/:id]`, `/payments`, `/customers[/:id]`, `/inventory` + `/:id`, `/receiving`, `/counts[/:id]`, `/adjustments` (manager), `/reorder`, `/reports`, `/settings` + `/settings/users|shop|materials|locations` (admin) and `/settings/taxonomy|suppliers` (manager), `/audit` (admin); old `/quotes`, `/materials`, `/taxonomy` redirect; role-gated routes via `RoleGate`. No placeholders left. Shell = navigation rail (≥ 768px) / modal drawer (narrower), top app bar with the account menu, snackbar host, skip link, the DEMO DATA strip above every page; nav items filtered by role.
- **components/m3** — the Material 3 kit: Button (filled/tonal/outlined/text/elevated/danger, `touch` = 48px, `to` = link), IconButton, TextField/Select (filled/outlined, supporting + error text), Checkbox, Switch, Chip (assist/filter), Card (+CardHeader), Dialog (focus trap on the whole document — Tab can't reach the page behind; `nextTrapFocus`), Snackbar (`showSnackbar`), Tabs (route or state), List/ListItem, DataTable (+Pager, server paging, empty/error; wave 2: no state-layer on `<tr>` — it shifted clickable rows by a column; optional group header rows via `groupOf`/`renderGroup`/`hideRow`), NavigationRail/Drawer, TopAppBar, Badge, Linear/CircularProgress, EmptyState, inline-SVG Icon. Rules for pages: `docs/UI-GUIDE.md`.
- **SignIn.tsx** (role tokens since wave 2) — tap-a-name-then-type-PIN flow against `/api/auth/login` (first-run "create the owner admin" form when `needsSetup`), applies the account's saved theme/dashboard prefs on success.
- **ApprovalDialog.tsx** — the one Manager-approval dialog (manager name + PIN + optional reason; M3 `Dialog` with focus trap since 2026-09-26; plain-language labels for every server approval action live in `lib/approvalLabels.ts`, test-enforced); `lib/api.ts` opens it on any 403 `approval_required` and retries the request with `approval` attached.
- **RoleGate.tsx** — hides role-restricted sections (replaced the shared-password AdminGate 2026-09-25); server enforces regardless.
- **pages/dashboard/** — one-screen "what's due, what's owed, what's low," three toggleable per-account cards (filter chips), Owed hidden in counter mode. The M3 reference page (2026-09-26): one component per card, each loads its own data with its own loading/error/retry; due dates use local time (was UTC); low stock links to `/inventory/reorder` and shows "+N more"; tags are colored dots (AA-safe) instead of white-on-color pills.
- **modules/jobs (wave 2)** — `quote/` (QuotePage → QuoteEditor: job header + customer search, lines editor with per-line material/size/roll/color and live stock notes (one batched check), price panel with suggested vs final and the `price.override` approval, invoice lock banner for invoiced jobs, autosaved draft, recent jobs, print sheet; `discountPct` is always sent so clearing a discount sticks), `orders/` (board: 7 lanes from `/api/jobs/board` with counts, move buttons via `useMoveJob` incl. the pickup-with-balance approval; list view paged + status filter), `quick/` (Quick Order: customer search or Walk-in, amount + method, optional from-stock item that deducts; cash needs an open drawer; "Today" card = SQL total since local midnight + the newest 12 payments). `shared/` = CustomerSearch (paged `/api/customers?q=&limit=10&offset=0`), CopyPo, job helpers.
- **modules/pos (wave 2)** — `/pos` counter sale (cart of stock items/free lines, customer picker (paged search) or Walk-in, tender buttons, cash keypad with change, receipt; 48px touch targets; drawer status bar), `/pos/drawer` (open with float, close with counted cash/checks → over/short + Z-report, session history), `/pos/drawer/:id` Z-report (+ CSV), `/pos/invoices` (keyset list with date/number/status filters) + detail (lines, payments, returns, void with approval), `/pos/returns` + new return (pick lines/qty/restock, refund method, threshold approval) + return detail.
- **modules/payments (wave 2, `/payments`)** — summary cards, Owed list (paged `/api/balances`) with record-payment dialog, recent payments (paged, search) with void/refund dialogs (manager approval), overpayment warning kept.
- **modules/customers (wave 2)** — paged list (search, sort, archived toggle), detail with profile card (edit sends only changed fields — legacy customers without email editable), store credit + adjust (approval), level (manager), jobs, invoices (keyset), printable history, archive/restore (approval).
- **modules/inventory (wave 2)** — `/inventory` list: search + match mode, stock/kind chips, more filters (category/supplier/roll material/color/width), sort (incl. size, color, low first), **group by** material/color/size/unit/category (default material; collapsible header rows with count + LOW badge; collapsed groups, filters, sort and page in the URL so back/forward work), one-tap −1 used / +1 received and "Adjust…" (correction) per row, valuation line, count banner, new item. `/inventory/:id` item detail (fields card, stock by location + transfer, adjust dialog, variance + cost history, ledger with Load more). Receiving, cycle counts (blind entry grouped by category with a local draft, submit → manager review/post or send back, history), adjustments ledger (manager), needs ordering / usage.
- **pages/reports (wave 2)** — date range in the URL; payments summary, sales & tax (manager+, one `/api/reports/sales` call), CSV exports, inventory valuation, drawer Z-report history. **pages/audit** (admin) — audit log (keyset, filters, before/after dialog, CSV) and approvals tab. **pages/settings** — My account (theme, accent, own PIN), users, shop (tax, levels, inventory + POS knobs), materials + colors, taxonomy, suppliers, locations; archive/restore via ConfirmDialog.
- **lib/api.ts** — fetch wrapper retrying only on network failure; sends the bearer token (`localStorage['dp-token']`), handles 401 (back to sign-in) and 403 `approval_required` (approval dialog + retry); `download()` for authenticated CSV exports.
- **lib/m3/** (2026-09-26, ADR 0009) — dependency-free M3 color: OKLCH hue/chroma + exact L\* tones → tonal palettes (primary, secondary, tertiary, neutral, neutral-variant, error, success, warning) → scheme roles for light / dark / High Contrast; token + CSS generator (`npm run tokens` writes `src/styles/tokens.css`: colors, type scale, shape, elevation, state-layer opacities, legacy aliases). Tailwind maps role classes + `text-<type-role>` onto the tokens.
- **lib/theme.ts** — sets `data-theme`; a non-default accent regenerates the account's scheme and sets the color roles inline (all three themes); prefs storage unchanged.
- **lib/query.ts** (2026-09-26) — `useQuery(url)` (data / loading / error / reload, stale responses dropped) and `usePaged(url, params)` (server paging; params change → page 1), both on top of `lib/api.ts`. Wave 2: `lib/keysetPaging.ts` (`useKeyset` page-at-a-time + `useKeysetMore` load-more; `components/KeysetPager` with `touch`), `lib/errorText.ts` (the one error-to-words helper + `isDrawerClosed`/`lockedInvoice`/`isNetworkError`), `lib/ref.ts` (`newRef`), `components/ConfirmDialog.tsx`, `components/DateRangeFields.tsx`.
- **lib/session.ts** — cached signed-in user (name + role), `hasRole`, sign-out (revokes the server session), prefs save.

### Testing (`vitest`)

- Pure-logic unit tests next to each `shared/` module.
- Integration tests (`server/integration.test.ts`) cover job creation/idempotency, status transitions, payment/void/refund math, roll-SKU integrity (dup + color-typo rejection), batch stock-check, quote-math verification, cycle-count auto-reschedule, inventory adjust, override attribution, and (2026-07-09) suppliers CRUD/delete-guard, per-receipt cost history, cycle count v2 (reason enforcement, lock, snapshot, no-invented-usage), needs-ordering + valuation math, counter-sale deduction (idempotency + zero-clamp), and the inventory settings knobs — against a throwaway SQLite file per run. Since 2026-09-25 every integration request carries a session (`server/test-helpers.ts` → `createUserWithToken`), and `server/modules/auth/auth.test.ts` covers sign-in, rate limit, session expiry/revocation, roles, approvals (required / manager PIN / self / wrong PIN / append-only), users admin + last-admin guard, and the plaintext upgrade. `server/phase1b.test.ts` (2026-09-25) covers archive/unarchive (customer credits kept, hidden/`includeArchived`, approval, materials + categories), the DELETE/UPDATE triggers, one-audit-row-per-mutation with before/after + approval link, `/api/audit` paging/filters/CSV, rollback of a counter sale failing midway, concurrent writes, job-line soft delete, and the jobs search beyond the limit. `server/phase2.test.ts` (2026-09-26) covers the ledger triggers (raw count/balance/ledger writes refused), item edit refusing count, opening transactions, a mixed receive/sale/adjust/transfer sequence keeping count == ledger == balances, adjustment reason + approval, transfers, weighted-average cost with UOM + empty-shelf reset, the count submit → post flow with a sale in between, send-back, reconcile, and migration 0015 over pre-ledger data. `server/phase3.test.ts` (2026-09-26) covers cash-without-drawer 409, gap-free invoice numbers (a failed sale gives its number back, concurrent sales, wifi retry, DB-level sequence/number guards), full rollback of a sale failing partway, per-line tax sums, job invoice = job total, the invoiced-job lock, invoice void (approval, snapshot unchanged, stock + money back, job archived / keepJob re-invoice), returns (qty cap, pro-rata incl. tax, restock only restockable, unpaid invoice lowers the balance), the refund threshold, price override (job create/edit, counter-sale line), drawer open/close/over-short/Z-report JSON + CSV/immutability, invoice paging/filters, and the DELETE/UPDATE triggers. `server/backup.test.ts` + `server/dataset.test.ts` (2026-09-26, Phase 4) cover a backup taken during an open write transaction, restore into a fresh place with row-for-row equality and a clean `/api/inventory/reconcile`, the pre-restore copy, refusals (corrupt file ×3, app running, demo over production, newer app version), upgrading an older-version backup, rotation, and the demo/production rules including the real `db:init-prod` / `db:seed` scripts run as child processes. `server/paging.test.ts` (2026-09-26) covers the opt-in paging contract (unpaged shape kept, full walk without gaps, SQL filters/sort, 400 on bad params), reorder paged == unpaged order, usage order, SQL valuation, and the dashboard summary; `src/lib/m3/m3.test.ts` covers the tone solver, stable default tokens, the generated `tokens.css` being current, and WCAG contrast on every role pair (incl. the status chips/headers) in all three themes for the default, ten sample accents and a 216-seed sweep. Wave 1 (2026-09-26) added void-after-return Z-report / restock, restock cap, $0 pickup, refund cap, payment-void guards (`server/phase3.test.ts`), the restore dataset rule + restore lock + Phase 3 tables in backups (`server/backup.test.ts`, `server/dataset.test.ts`), approval labels, the `/pos` redirect and the focus-trap logic. Wave 2 added `server/inventory-pages.test.ts`, `inventory-group.test.ts`, `jobs-lists.test.ts`, `payments-paging.test.ts`, `admin-lists.test.ts` (customers paging + edit email rule, approvals), `sales-report.test.ts` (report == Z-report) and page-logic tests next to each page folder (`logic.test.ts`, `draft.test.ts`, `cart`/`keypad`/`plan`, `lib/ref.test.ts`, `lib/keysetPaging.test.ts`); `shared/inventoryView` and its tests were removed with the old page. **__TESTS__ tests total as of 2026-09-26 (wave 2 integration).**

### Deployment

- `npm run build` + `npm start` (or Docker `CMD`) — Fastify serves the built client and falls back to `index.html` for SPA routing.
- Docker Compose maps a local `./data` folder (intended to be the NAS share) to `/app/data`; it holds the live DB **and** `data/backups/`. `init: true` so `docker stop` reaches the app. `TZ=America/Chicago` in the image and compose (change it if the shop is elsewhere).
- **Demo vs production (ADR 0008, 2026-09-26):** `settings.dataset` = `demo` | `production`. `npm run db:init-prod` starts the real DB (one admin, no sample data, refuses any file with data — no override). `db:seed` writes `data/demo.db` by default and refuses production-labeled DBs, an unlabeled `dp-erp.db`, and unlabeled DBs with data; `db:seed:perf` / `perf:baseline` also refuse production. `/api/health` returns `dataset`; the server logs it at start; the client shows a DEMO DATA strip (`src/components/DemoBanner.tsx`).
- **Backups (ADR 0008):** `npm run db:backup` = `VACUUM INTO` a timestamped file in `BACKUP_DIR` (default: `backups/` next to the DB), verified (integrity_check, key-table counts between the live before/after counts, migration journal), then rotation (newest per day × 14, per week × 8). The server runs the same backup daily at `BACKUP_HOUR` (set to 2 in the Docker image and the Windows production launchers) plus a catch-up at start if the newest is > 26 h old. `npm run db:restore -- <file>` refuses while the server's heartbeat lock (`<db>.server-lock`) is fresh, checks the backup, migrates a copy, moves the current DB aside as `*.pre-restore-<stamp>.db` (never deleted), then swaps it in. Wave 1: it also refuses a demo/unlabeled backup into `dp-erp.db` or over a database with data (unless both demo), holds `<db>.restore-lock` so the server refuses to start mid-restore, and re-checks the heartbeat right before the swap; backup verification covers the Phase 3 tables. Procedures: `docs/BACKUP.md`, `docs/PRODUCTION-SETUP.md`.
- `batch/` holds Windows `.bat` scripts for install / demo seed (`2-…`, demo.db, type DEMO to confirm) / dev (demo.db) / production (dp-erp.db) / hidden-run / runtime test / `8-Init-Production.bat`, used for shop-PC operation without a terminal.
- **Unverified on real hardware:** deploy-to-NAS-over-real-wifi and a backup/restore drill on the NAS itself (the scripted drill passed in `/tmp` 2026-09-26 — see `docs/BACKUP.md`).

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

---

### 2026-07-03 — Domain-module reorg (pure reorganization pass)

Whole-session restructure: technical layers → domain modules. **No behavior
changes**; API URLs, table definitions, and `shared/` untouched. Decisions in
`docs/adr/0001..0003` (new); domain glossary added to `CONTEXT.md`. Scope,
layout (`server/modules/<domain>`), and order grilled and approved. Safety:
`pre-reorg-snapshot-2026-07-03.zip` (in this folder, rides the backup
pipeline) + git history built in the session sandbox (copied in at session
end). Verification per module in a sandbox mirror: `tsc --noEmit`, full
vitest (baseline **118/118** — CLAUDE.md's "119" was stale), `vite build`.

**Module 0 — schema split.** `server/db/schema.ts` (13 tables) →
`server/db/schema/{common,customers,materials,jobs,payments,inventory,users,settings}.ts`
barreled through `server/db/schema/index.ts`. Table definitions byte-identical
(verified: fresh-file migrate + full suite). Importers updated: 8 route files,
`db/index.ts`, `db/seed.ts`, `drizzle.config.ts` (schema →
`./server/db/schema/index.ts`). Reverse by hand: concatenate the eight domain
files back into `schema.ts` (drop the `common.js` imports, restore one
`nowIso`) and revert the 12 one-line import edits.

**Module 1 — payments.** `routes/payments.ts` →
`server/modules/payments/{routes,service,index}.ts` (ADR 0002).
`creditBalanceCents` moved to `service.ts`; `paidNetCents` +
`livePaymentCount` added there (pure extractions of jobs' inline money SQL).
`customers.ts` and `app.ts` now import from `modules/payments/index.js` —
the route→route import is gone. Reverse: concatenate service back into
routes.ts as `routes/payments.ts`, restore the two import lines.

**Module 2 — jobs.** `routes/jobs.ts` (456 lines) →
`server/modules/jobs/{routes,service,queries,index}.ts`. `service.ts` owns PO
generation + server-side quote-math verification; `queries.ts` owns the
joined read-model (`baseQuery`); `routes.ts` is HTTP only and consumes the
payments interface for the unpaid-pickup check (`paidNetCents`) and the
removal rule (`livePaymentCount` — count-based on purpose, a fully-refunded
job still blocks deletion). Temporary: `routes.ts` still imports `verifyUser`
from `routes/users.js` until Module 6. Reverse: concatenate the three files
back into `routes/jobs.ts`, restore inline PO/SQL blocks per git history.

**Module 3 — inventory (+categories).** `routes/inventory.ts` +
`routes/categories.ts` → `server/modules/inventory/{routes,categories.routes,index}.ts`.
Pure move, import depth only; categories folded in (inventory-only by
decision). Reverse: move the two files back, restore `../db/` import depth,
re-add the separate `categoryRoutes` import in `app.ts`.

**Module 4 — materials.** `routes/materials.ts` →
`server/modules/materials/{routes,index}.ts`. Pure move.

**Module 5 — customers.** `routes/customers.ts` →
`server/modules/customers/{routes,index}.ts`. Pure move; consumes
`creditBalanceCents` via the payments interface.

**Module 6 — settings + users (the one consolidation, ADR 0003).**
`routes/settings.ts` → `modules/settings/{routes,service,index}`;
`routes/users.ts` → `modules/users/{routes,service,index}`. The four
duplicated admin-password checks (users, categories, customers ×2, jobs
pickup) now call `requireAdmin`; jobs' tax lookup uses `taxRatePct()`;
`verifyUser` moved behind the users interface. `server/routes/` is gone.
Same defaults, same status codes — asserted by the integration suite.

**Module 7 — client grouping.** Whole-page moves into
`src/modules/{jobs,payments,customers,inventory,materials}/`; Dashboard,
Settings, Placeholder, `lib/`, `components/` stay app-level. Import-depth
fixes + `App.tsx` paths only. **The production bundle hash is byte-identical
to the pre-reorg build** (`index-DebldSAm.js` / `index-B8tJjMLg.css`) —
zero client behavior change, proven.

**Final state:** `server/{app.ts,index.ts,integration.test.ts,db/,modules/}`;
verification after every module: `tsc --noEmit` clean, **118/118 vitest**,
`vite build` clean. Session git history copied into `.git/` (see below);
`git status` should be checked on Windows, not through the sandbox mount.

**Found, not fixed (bug log):**
- `npx drizzle-kit generate` fails pre-reorg and post-reorg alike:
  `meta/0006_snapshot.json / 0007_snapshot.json` point at the same parent
  snapshot ("collision") — migrations 0009–0011 were evidently hand-written
  without regenerating snapshots. Harmless at runtime (the migrator doesn't
  read snapshots) but blocks `db:generate` until the meta chain is repaired.
- `src/pages/Inventory.tsx` re-implements parts of the
  `shared/inventoryView.ts` filter/group pipeline instead of calling it —
  locality bug-in-waiting, fix in a behavior pass.

### 2026-07-09 — Inventory management pass (suppliers, UOM, blind count v2, Min/Max, receiving, reports)

One-pass build of the full weekly-cycle-count inventory feature set
(Josiah's spec; all design decisions confirmed via Q&A before code). Core
principle preserved: **no production-consumption tracking** — the weekly
count reconciles everything that isn't a tracked counter sale.

**Review findings that shaped the design (before any code):**
- Counter sales did NOT auto-deduct (contrary to assumption) — Quick Order
  (`/api/pos/sale`) had no link to inventory items at all. Decision: optional
  "from stock" picker; free-text sales stay untracked.
- The old count entry pre-filled system counts ("system: N") — the exact
  anchoring bias the new spec bans. Replaced in place (decision).
- No suppliers table (vendor was free text), no UOM anywhere, no per-receipt
  cost history (receiving only overwrote `lastCostCents`), no Max, and the
  usage-trends endpoint counted only manual `used` taps (excluded count
  drift) — replaced by count-derived rates (decision).
- Roll SKUs stay counted in **whole rolls** (purchase=count='roll', 1:1) so
  the estimator's `count > 0` stock-check semantics are untouched (decision).
- `lowStockThreshold` remains the operative Min everywhere; AUTO is a
  suggestion button (usage × (lead + buffer)), never a silent recompute
  (decision: human applies, plus AUTO from last-month history).

**Schema (migration `0012_inventory_management`, hand-written like 0009–0011):**
new `suppliers` (lead time; unique lower(name)) + `cycle_count_lines`
(immutable per-item count snapshot); `inventory_items` += supplierId,
purchaseUnit/countUnit/purchaseToCountFactor, reorderMaxQty, avgDailyUse;
`inventory_adjustments` += unitCostCents, supplierId, cycleCountId;
`cycle_counts` += completedBy; `categories` += defaultSupplierId. Backfill:
one supplier per distinct vendor string (case-insensitive), items/categories
linked; vendor text columns retained read-only for history. Verified
migrate-clean on a fresh DB.

**Shared logic (new, fully unit-tested):** `shared/countReview.ts` (variance
flagging ±% OR ±units, dollar-impact sort, repeated-variance signal) and
`shared/reorder.ts` (count-to-count avg daily usage, suggested Min, days
until stockout, urgency sort). `ADJUST_REASONS` extended with `sold` + the
variance reason codes (production_use, waste_scrap, theft_loss,
receiving_error, other; `correction`/`damaged` reused).

**Server:** suppliers CRUD (delete blocked while receipts reference it);
receiving via `/adjust` persists cost-per-purchase-unit + supplier per
receipt; cycle-count complete v2 (blind reconciliation, server-enforced
reason codes above threshold using the SAME shared math as the review
screen, per-item snapshot lines, one-shot lock, avg-usage recompute over a
28-day baseline window, auto-reschedule kept); needs-ordering view
(urgency-sorted, fills to Max, 2×-threshold fallback); `/usage` replaces
`/trends`; valuation, per-item cost-history + variances endpoints;
`/api/settings/inventory` knobs. `recordSale` exported from the inventory
module and called by `/api/pos/sale` — idempotent under clientRef retries,
clamps at zero, never blocks a sale.

**Client:** Inventory page — blind count entry (system counts hidden,
worklist grouped by category for one shop walk, blank = skip), variance
review (dollar impact first, reason selects + notes, submit disabled until
flagged rows have reasons), receiving form (purchase-unit qty × factor
conversion shown), per-item editor (supplier/UOM/Min+AUTO/Max), status dots
+ OUT chip, valuation line, needs-ordering + usage panels, Log modal gains
count history (with repeated-variance banner) and cost-per-receipt trend.
Quick Order gains the optional from-stock picker. Taxonomy page gains
supplier admin; category default vendor became a supplier dropdown.
Settings gains the three inventory knobs.

**Verification:** `tsc --noEmit` clean, **147/147 vitest** (was 118; +20
shared, +9 integration), `vite build` clean. NOTE: built to a temp dir in
the sandbox — run `4-Production.bat`/normal build once locally to refresh
`dist/`.

**Still open / operational:**
- Suppliers list starts from the vendor-string backfill — set real lead
  times in Taxonomy → Suppliers (default 7d).
- AUTO Min needs two completed counts (a usage rate) + a supplier lead time
  before it activates; until then it's disabled with an explanatory tooltip.
- The three drills (`DRILLS.md`) remain the critical path, and the roll-SKU
  seed from `Inventory-Restock-Review.xlsx` is still pending — do it AFTER
  this session's fields exist so the seed can set supplier/UOM in one pass.
- `7-Runtime-Test.bat` should be run on Windows to confirm this session +
  the 2026-07-03 reorg together.

### 2026-09-25 — Phase 0 (hardening): AGENTS.md, perf seeder, baseline
Setup for a larger refactor/hardening effort. **No app features, schema, or UI changed.**

- Added `AGENTS.md` (agent env setup + verify commands + guardrails; points at `CLAUDE.md`).
- `.gitignore` gained `node_modules` (no slash, so a symlinked `node_modules` is ignored too);
  `package.json` gained `allowScripts` for the four esbuild versions in the lockfile (npm 11).
  `tsconfig.json` now also type-checks `scripts/`.
- **Perf tooling** — `server/db/seed-perf.ts` (`npm run db:seed:perf`) fills a throwaway DB with
  5,000 inventory items, 500 customers, 3,000 jobs (+4,344 items), 3,577 payments, 20,000 adjustments,
  105 cycle counts in ~1 s, deterministic (seeded PRNG, fixed anchor date). `scripts/perf-baseline.ts`
  (`npm run perf:baseline`) times first-view GETs via `app.inject`. Both refuse to run unless `DB_PATH`
  is set explicitly and doesn't contain `dp-erp.db` (`server/db/perf-guard.ts`, +3 tests → 150).
  The seeder also refuses a DB that already has data.
- **Baseline** (`docs/perf-baseline.md`): everything is fast (< 25 ms) except the unpaginated
  `inventory_items` full scans — `/api/inventory` 60 ms and **2.06 MB**, `/api/dashboard` 55 ms,
  `/api/inventory/usage` 53 ms, `/reorder` 47 ms, `/valuation` 46 ms. Job/customer/payment lists are
  capped and take 2–5 ms.
- **Still open:** paginate / push filters into SQL for the inventory endpoints; consider response
  compression; `/api/jobs?q=` filters after the limit (search only covers the newest N rows).

### 2026-09-25 — Phase 1a: roles, sessions, manager approval
First hardening step toward real sales: the LAN-trust shared admin password is replaced by
per-user roles, server sessions, and logged manager approvals. **No other feature changed.**
Decisions and the full route → role/approval table are in `docs/adr/0004-roles-sessions-approvals.md`.

- **Migration `0013_roles_sessions_approvals`** (hand-written, journal idx 13): `users.role`
  (CHECK cashier|manager|admin, default cashier; **every existing user → admin** so nobody is locked
  out), `users.pin_hash`; new `sessions` and append-only `approvals` (UPDATE/DELETE triggers);
  the `adminPassword` settings row is deleted.
- **Startup upgrade** in `buildApp`: legacy plaintext passwords are scrypt-hashed into `pin_hash`
  and NULLed (idempotent; verified against a real pre-0013 DB). Legacy passwords keep working as the
  PIN until changed; users with no password need an admin to set a PIN.
- **New `server/modules/auth`**: login/logout/me, public `/api/auth/status` (account picker +
  `needsSetup`) and first-run `/api/auth/setup`, root `onRequest` hook (401 for every `/api` route
  except health + sign-in), `requireRole`, `requireApproval`, 10-failures/5-min rate limit.
  `users/service.ts` (`verifyUser`) and settings' `requireAdmin` are gone.
- **Every old gate replaced** (materials/categories/suppliers/settings writes previously had no server
  check at all). Money/override actions — void, refund, unpaid pickup, job removal, customer removal,
  store-credit adjustment, non-receipt stock adjustment — now need manager approval. Unpaid pickup is a
  two-step: 402 with the balance, confirm, retry with `override: true`. `createdBy` / `completedBy` come
  from the session; body copies are stripped.
- **Users admin**: create (name + role + PIN ≥ 4 digits), role change, PIN reset, deactivate/reactivate,
  own-PIN change; last active admin can't be demoted/deactivated; role/PIN/active changes revoke sessions.
- **Client**: token in `localStorage['dp-token']`; sign-in posts to `/api/auth/login`; 401 → sign-in;
  shared `ApprovalDialog` driven from `lib/api.ts` (retries with `approval`); `AdminGate` → `RoleGate`;
  default-admin-password banner removed; Orders/Quotes "Edit" no longer re-prompts for a password;
  CSV exports download via authenticated fetch. No restyling.
- **Seeds**: `server/db/seed-users.ts` — Josiah admin 1234, Amy manager 2222, Sam cashier 3333
  (demo + perf seeders); `perf:baseline` signs in as the first admin. `batch/smoke.ts` (7-Runtime-Test)
  now exercises first-run setup + 401 — and its job step was already broken by the 2026-07-02
  email-required rule (fixed: sends an email).
- **Tests**: 150 → 172. `npx tsc --noEmit` clean, `vite build` to a temp dir OK, smoke test 15/15.
- **Still open**: no UI to view/export the `approvals` log (CSV per the money-table rule); rate limiter
  is in-memory; the client still uses `prompt()` for PIN entry in Settings (Material 3 redesign later);
  the approval dialog asks for the manager's name as free text (no picker); decide whether inventory
  item edits (cost, Min, deactivate) should be manager-only — left open to all for now.

### 2026-09-25 — Phase 1b: archive, audit log, transactions, indexes

**Why:** Phase 1b of hardening for real sales. Owner decisions: no hard deletes on transactional/master data ("delete" archives, the button stays); an append-only audit log; multi-step writes in one DB transaction; indexes for common lookups. No other feature changes. Full rationale: **ADR 0005**.

**Changed**
- **Migration `0014_archive_audit_indexes`** (hand-written, journal idx 14): `archived_at`/`archived_by` on customers, categories, category_sizes, suppliers, materials, material_colors; `job_items.deleted_at`; `audit_log` table; `BEFORE DELETE` triggers on payments, customer_credits, inventory_adjustments, cycle_counts, cycle_count_lines, jobs, job_items, customers, suppliers, categories, category_sizes, materials, material_colors, inventory_items, users, audit_log (approvals already had one); `BEFORE UPDATE` guards on payments (only voiding an unvoided row), customer_credits, inventory_adjustments, cycle_count_lines, audit_log; 15 lookup indexes (existing ones — jobs.po, roll-SKU key, sessions.user_id, suppliers name — not duplicated; inventory_items has no sku/barcode column). Drizzle schema files updated to match.
- **Archive instead of delete** — converted DELETE routes: `/api/customers/:id`, `/api/materials/:id`, `/api/materials/:id/colors/:colorId`, `/api/categories/:id`, `/api/categories/:id/sizes/:sizeId`, `/api/suppliers/:id`. Each keeps its URL + permission, never cascades (customer credits, category sizes/fields/item links, supplier references all stay), and has a `POST …/unarchive`. `/api/jobs/:id` already soft-deleted — unchanged, plus a new `/unarchive` (approval). `/api/users/:id` already deactivated — unchanged. Lists hide archived unless `?includeArchived=1`. Removed the old "has history → 409, deactivate instead" guards on customer/material/supplier delete (archive no longer threatens history).
- **Job edit** soft-deletes replaced lines instead of deleting them; `GET /api/jobs/:id`, create/edit responses and quote-math re-verify read only live lines (`liveItems` in jobs/queries.ts).
- **`withTx`** (`server/db/index.ts`): serialized `BEGIN IMMEDIATE` transactions on a dedicated writer connection, re-entrant via AsyncLocalStorage. Chosen over drizzle's `db.transaction()` because the libsql local driver swaps its only connection into the transaction and reopens a new one without `foreign_keys = ON`, leaking the old handle and hitting SQLITE_BUSY on concurrent writes. Every mutating route now runs inside it, including session create/revoke/touch and approvals.
- **Cross-module functions take an optional `dbx`**: `creditBalanceCents`, `paidNetCents`, `livePaymentCount`, `recordSale`, `getSetting`, `setSetting`, `taxRatePct`, `activeAdminCount`, jobs' `generatePo`/`verifyQuoteMath`.
- **Counter sale** is one transaction; `recordSale` no longer swallows errors (a DB error rolls back the whole sale; stock-level cases still never block).
- **Audit module** `server/modules/audit`: `audit(tx, req, …)` on every mutating route; `requireApproval` returns `approvalId`, linked on the audit row; admin-only `GET /api/audit` (filters + keyset paging) and `/api/audit.csv`.
- **Jobs search bug**: `?q=` now filters in SQL (LIKE, wildcards escaped) before LIMIT.
- **Client**: Customers / Materials (+ colors) / Taxonomy (suppliers, categories, sizes) say "Archive" instead of "Remove", gained a "Show archived" toggle and "Restore". Inventory and Quotes load archived categories/suppliers/materials for name lookups so existing records still show them; pickers for new records list only live ones. Approval dialog labels for `customer.unarchive` / `job.unarchive`.
- **Tests**: new `server/phase1b.test.ts` (16 tests); the supplier delete-guard test rewritten for archive. 187 pass; `tsc` clean; `vite build --outDir /tmp/sm-build` OK.
- **Perf**: re-ran the seed + baseline (`/tmp/perf-1b.db`), added two jobs-search probes; nothing meaningfully slower — see "After Phase 1b" in `docs/perf-baseline.md`.
- **Docs**: ADR 0005; CONTEXT.md glossary (Archive, Audit log, Job/Line wording, approval list); CLAUDE.md conventions (no hard deletes, audit row per mutation, one transaction per multi-step write).

**Not audited (deliberately):** `PUT /api/users/prefs` (theme/accent/cards), `POST /api/stock-check/batch` (read-only), the session last-seen touch.

**Open**
- No audit-log UI page yet (later phase) — rows are reachable via `/api/audit` and the CSV.
- Roll SKUs of an archived (or deactivated) material fall into "Other / Consumables" on the Inventory page, same as the existing deactivated-material edge case.
- An archived supplier's name can't be reused for a new supplier (case-insensitive unique index) — restore it instead.
- Josiah: run `7-Runtime-Test.bat` on Windows to confirm Phase 1a + 1b together (migration 0014 on the real DB copy first).

### 2026-09-26 — Phase 2: inventory ledger

**What changed.** Perpetual inventory, modeled on Epicor P21's integrity rules (ADR 0006). Migration `0015_inventory_ledger` evolves `inventory_adjustments` into the transaction ledger in place (txn type, location, per-count-unit cost, source document, user), adds `locations` (default Shop) and `inventory_balances`, backfills one `opening` transaction per item for any count its history didn't explain, and adds triggers so on-hand can only move by inserting a ledger row. Items gained `avg_cost_cents` (moving weighted average; receipts convert per-purchase-unit cost via the UOM factor, `shared/costing.ts`). Cycle counts now go counting → submitted → posted: submitting snapshots and changes nothing; a manager posts variance-based `count` transactions (so sales between count and post survive) or sends the count back. New routes: transfer, transactions (paged), balances, reconcile, locations. Client: the count screen shows "Submitted — awaiting manager approval" with Approve & Post / Send back.

**Decided.** Evolve the table in place rather than add a second one; enforce the invariant in SQLite, not just code; keep `inventory_items.count` as a cache so reads stay fast; moving average over FIFO/standard; production is a type only (no workflow — the weekly count still reconciles). Counts assume the default location for now.

**How it was built.** Started as an aios background job that was interrupted twice; Josiah asked to stop using aios, so the partial work was pulled into a `phase2-ledger` branch and finished directly: reviewed, cycle-count submit now loads only counted items (was all 5,000), 18 new tests in `server/phase2.test.ts`, docs.

**Numbers.** 212/212 tests, tsc clean, client build ok. Perf on the 5,000-item seed unchanged (see `docs/perf-baseline.md` "After Phase 2").

**Still open.** Phase 3 (invoices/POS) will call `recordReturn`. Paging the full-table inventory endpoints is the UI phase's job. Counting per location is a later decision.

### 2026-09-26 — Phase 3: invoices, returns, cash drawer

**What changed (ADR 0007, migration `0016`, new module `server/modules/sales`).**
- **Invoices**: a locked snapshot (`invoices` + `invoice_lines`, UPDATE/DELETE blocked) issued when a job is paid in full, picked up, or rung up at the counter. Gap-free invoice numbers from `number_sequences`, taken inside the invoice's transaction (a failed sale gives its number back; the DB only lets the sequence step +1 and only accepts the number just taken). Tax stored per line with its rate; totals are line sums; the customer discount stays after-tax and is allocated to lines. A job invoices as one line carrying its Price (items ride along as detail). Invoiced jobs refuse money edits (409) and removal.
- **Invoice void** (manager approval): linked `invoice_voids` row, refunds by original tender (or one `refundMethod`), stock the sale deducted goes back (`return` transactions), job archived unless `keepJob` (then editable + re-invoiceable under a new number).
- **Returns (RMA)**: `returns` + `return_lines`; qty ≤ sold − returned; pro-rated value incl. tax + discount share; restock only lines marked restock; money back only what was overpaid (a return on an unpaid invoice lowers the balance). Over `posSettings.refundApprovalThresholdCents` (default $50, admin via `PUT /api/settings/pos`) needs approval `return.refund`.
- **Balance** is now total − returned goods − payments + refunds (`owedCents`); `/api/balances` skips archived jobs.
- **Price override**: final ≠ the estimator suggestion needs approval `price.override` at job create/edit (only when the override is created or changed) and on counter-sale lines that carry `suggestedUnitPriceCents`.
- **Cash drawer**: `drawer_sessions`; cash anywhere needs an open drawer (409 `drawer_closed`); every money row written while one is open is stamped with it; close (manager+) → expected vs counted cash (+ checks), over/short, frozen Z-report (JSON + CSV).
- **Payments**: `recordPayment()` is now the single writer of payment rows (drawer rule, cash tendered + change, store credit, audit). `/api/pos/sale` moved into sales (same path + legacy body; new: itemized `lines`, `taxable`, `tenderedCents`).
- Seeds: demo seed invoices its picked-up counter sale; perf seed adds 2,646 invoices (date order, one at a time through the sequence, lines batched) + 365 closed drawer sessions. Perf: no meaningful regression (`docs/perf-baseline.md` → After Phase 3).
- Existing test suites now open a drawer in setup (they take cash). 212 → 244 tests.

**Decided / flagged for Josiah:** Quick Order still adds no sales tax unless the request sends `taxable: true` (today's counter behavior kept); the current UI has no drawer screen, so cash is refused in the app until the UI phase adds one (or a drawer is opened through the API); card/check taken with no drawer open appear in no Z-report; voiding a sale archives the job by default.

**Open:** UI for invoices / voids / returns / drawer + Z-report (next builder); receipt/invoice printing; exchanges; split tender on a counter sale; approvals viewer/CSV.

### 2026-09-26 — Phase 4: production DB setup, backup and restore

**What changed.** Getting ready for real transactions (ADR 0008). A database now carries a label, `settings.dataset` = `demo` or `production`. New `npm run db:init-prod` (`server/db/init-prod.ts`, `batch/8-Init-Production.bat`) makes a clean production DB: migrations (price book, default suppliers, Shop location), one admin from a prompt or `INIT_ADMIN_NAME`/`INIT_ADMIN_PIN`, the label, one audit row. It refuses any file that already has data or a label and has no override. The demo seed now defaults to `data/demo.db`, labels it demo, and refuses a production label, an unlabeled `dp-erp.db`, or unlabeled data; the perf seeder and perf baseline refuse production too. `2-Seed-Database.bat` asks you to type DEMO and targets demo.db; `3-Start-Dev.bat` runs on demo.db; `4-Start-Production.bat`/hidden start pin `dp-erp.db` and turn on the 2 AM backup. `/api/health` returns `dataset`, the server logs it at start, and a small DEMO DATA strip shows in the app shell (`DemoBanner.tsx`, one line in `Layout.tsx`).

Backups: `npm run db:backup` (`server/db/backup.ts` + `backup-cli.ts`) does `VACUUM INTO`, verifies (integrity_check, key-table counts, migration journal), then rotates 14 daily / 8 weekly. `npm run db:restore -- <file>` (`restore-cli.ts`) refuses while the app runs (heartbeat lock `server-lock.ts`), refuses damaged / newer-version / demo-over-production backups, migrates a prepared copy, moves the current DB aside (`*.pre-restore-<stamp>.db`, never deleted), and swaps. The server also runs the backup daily at `BACKUP_HOUR` (2 in the Docker image) and catches up at start if the newest is > 26 h old. SIGTERM/SIGINT now close the app cleanly and release the lock; compose gets `init: true` and the backup env.

**Decided.** Label in the DB, not just the file name; demo data in its own file; no "erase anyway" flag anywhere. `VACUUM INTO` over file copies. Heartbeat file over PID or SQLite locks (the server and the restore run in different containers). Restore prepares and checks the new file before it moves anything. In-app daily schedule over NAS Task Scheduler (nothing to set up on the NAS; it only runs when the app runs, which is exactly when data can change). Backups stay on the data volume so the NAS → cloud job carries them offsite.

**Numbers.** 236 tests (24 new: `server/backup.test.ts`, `server/dataset.test.ts`), tsc clean, client build ok. Full drill run by hand in `/tmp/sm-drill` (transcript summary in `docs/BACKUP.md`): backup taken mid-way through 400 live sales captured a consistent 305, restore refused while running, restored after stop, reconcile clean.

**Still open.** Josiah: run `8-Init-Production.bat` (or the NAS terminal command) for the real DB, confirm the backups folder is in the NAS cloud job, set `TZ` in docker-compose, and do the monthly restore test from `docs/BACKUP.md`. No UI yet for "last backup" (a Settings tile could read `data/backups`); PIN is visible while typing in init-prod; untested inside a real container (`init: true` + npx signal forwarding — the heartbeat covers it either way).

### 2026-09-26 — Phase 5a: Material 3 foundation, routes, paging

**Why.** Owner decisions (final): rebuild the UI on Material Design 3 in blue and white, keep light / dark /
High Contrast and the per-account accent picker (the accent seeds the account's scheme), WCAG AA for every token
pair and any accent, ≥ 48px targets at the counter, one lazy-loaded route per page, and no full-table loads in the
browser. This session builds the **foundation + shell**; page builders move the remaining pages onto it next.
Rationale: **ADR 0009**. How-to for page builders: **`docs/UI-GUIDE.md`**.

**Changed**
- **Color + tokens** — `src/lib/m3/` (no deps): OKLCH hue/chroma + exact CIELAB-L\* tones → palettes → M3 roles
  (+ success / warning groups) for the three themes. `npm run tokens` writes `src/styles/tokens.css` (colors for
  seed `#2456c4`, type scale, shape, elevation, state-layer opacities, aliases for the old `--bg/--ink/--muted/…`
  names so un-migrated pages follow the theme). `lib/theme.ts` regenerates the scheme for a non-default accent.
  Tailwind maps role classes (with alpha), `text-display-large…label-small`, `rounded-shape-*`, `shadow-elevation-*`.
- **Kit** — `src/components/m3/` (see Current Feature Set). Global `:focus-visible` ring, `.state-layer` utility.
- **Shell + routes** — `routes.tsx` (lazy pages, role-gated routes, redirects), `shell/AppShell.tsx` + `AccountMenu.tsx`;
  `Layout.tsx` and the unused `Placeholder.tsx` removed; `ComingSoon` / `NotFound` pages. ApprovalDialog on the M3 Dialog.
  Settings links point at `/settings/materials` / `/settings/taxonomy`; the accent picker shows in every theme.
- **Data hooks** — `lib/query.ts` (`useQuery`, `usePaged`, `withParams`, `pageInfo`).
- **Server** — `server/lib/paging.ts` (contract helpers) + `server/modules/inventory/lists.ts`: opt-in `limit`/`offset`
  paging with SQL filters/sort on `/api/inventory`, `/reorder`, `/usage`; `/api/dashboard` low stock in SQL (top 20
  by urgency + `lowStockCount`); `/api/inventory/valuation` summed in SQL; unpaged reorder filters in SQL.
- **Dashboard** rebuilt as the reference page (`src/pages/dashboard/`, 7 small files + a logic test). Checked at
  1280px and 820px, light / dark / High Contrast and a green accent, plus the phone drawer, account menu and
  redirects, in the desktop app's browser pane.
- **Perf** — "After UI foundation" in `docs/perf-baseline.md`: paged inventory ~2 ms / 22 KB vs ~70 ms / 2.1 MB;
  dashboard 55 → 1.5 ms; valuation 57 → 2 ms. New paged probes in `scripts/perf-baseline.ts`.
- **Tests** 212 → 263 (`src/lib/m3/m3.test.ts`, `src/lib/query.test.ts`, `src/pages/dashboard/logic.test.ts`,
  `server/paging.test.ts`). `tsc` clean; `vite build` OK — every page is its own chunk (Inventory 40 KB, Quotes 29 KB,
  Dashboard 8 KB; shared entry 204 KB incl. React).
- **Docs** — ADR 0009, `docs/UI-GUIDE.md`, CLAUDE.md UI/Aesthetic section, AGENTS.md guardrail line.

**Decided**
- OKLCH + L\* tones instead of porting HCT: same contrast guarantee, ~150 lines. Own kit on Tailwind instead of
  Material Web/MUI (no new deps, denser). Offset paging + total instead of cursors.
- `/pos` is now the POS (placeholder until the POS builder lands); the old Payments page moved to **`/payments`**.
- High Contrast now uses the account accent too (at dark tones, 7:1 text) instead of a fixed near-black accent.

**Still open**
- Page builders: move Inventory (still loads the unpaged 2.1 MB list; `/inventory/*` sub-routes all render the old
  page), Quick Order (also loads all inventory for its picker — use `?q=&limit=`), Quotes (`/quotes/:id` doesn't read
  the id yet), Customers (`/customers/:id` same), Orders, Payments, Settings, Materials, Taxonomy, SignIn onto the kit.
- Dashboard still loads `/api/jobs?limit=200` (122 KB) to find due-soon jobs and all of `/api/balances`; server-side
  "due soon" / "owing" queries would shrink both.
- Legacy token aliases and unpaged list responses are transitional; delete once no page uses them.

### 2026-09-26 — Wave 1 integration

**What merged.** `team/ops` (Phase 4), `team/pos` (Phase 3) and `team/ui-foundation` (Phase 5a) into
`team/integrate`, in that order, `--no-ff`. Conflicts: this devlog (all entries kept, date order;
Current Feature Set bullets combined), `server/db/seed.ts` (ops' demo guard + dynamic imports with
pos' invoice block), `docs/perf-baseline.md` (all sections kept), `src/components/Layout.tsx`
(deleted; `DemoBanner` now renders in `shell/AppShell.tsx` above the page, restyled with
warning-container tokens). One test fix after the pos merge: the backup "older version" test
counted migrations by hand (+3) — it now reads the journal.

**Fixes applied (checker's list).**
- POS: a void stores `net_total_cents`/`net_tax_cents` (migration `0017`, backfilled) so a void
  after a return isn't counted twice in the Z-report; a void puts back stock sold minus every unit
  already returned (damaged returns stay off the shelf); a return restocks at most what the sale
  deducted; $0 pickups take no invoice number; `POST /api/payments` refuses a refund over what was
  paid; a payment can't be voided when it is a return/void refund or its drawer is closed; the
  approval dialog has labels for `invoice.void`, `return.refund`, `price.override` (test fails if a
  server action lacks one). ADR 0007 gained "Known limits".
- Ops: restore dataset rule (`restoreDatasetProblem`, mirrors the seed rule); Phase 3 tables in
  `KEY_TABLES`/`DATA_TABLES`; restore lock + server start refusal (`server/restore-guard.ts`) +
  heartbeat re-check before the swap; `TZ=America/Chicago` in Dockerfile/compose + docs.
- UI: `/pos` redirects to `/payments` (placeholder at `/pos/counter`, nav item points there);
  `text-white` on legacy warn/danger/ok and the Orders headers replaced by on-* role pairs, accent
  swatches use each accent's primary/on-primary; contrast test covers those pairs plus a 216-seed
  sweep (no generator change needed — all pass); dialog focus trap listens on the document.
- `batch/smoke.ts` opens a drawer before its cash payment (cash needs one now) and checks the invoice.

**Left as is (owner decisions):** counter sales untaxed by default, void archives the job, card/check
without an open drawer, the always-approval bare refund (now capped).

**Verification.** 338/338 tests, tsc clean, client build ok. Master DB (seed + item + cash payment
+ counter sale) migrated cleanly 16 → 18 migrations with the new code; reconcile ok before and after
a new sale. Demo seed → `dataset=demo`; seed refused an unlabeled `dp-erp.db` and a production-labeled
file. `db:backup` of demo.db lists the Phase 3 tables; `db:restore` into a temp file OK, into a
`dp-erp.db` path refused. `npm run tokens` leaves `tokens.css` unchanged. Perf: no regression
(`docs/perf-baseline.md` → After wave 1 merge). `batch/smoke.ts`: 18 passed, 0 failed.

**Still open.** POS counter/drawer/invoice/return screens (next wave; move the placeholder from
`/pos/counter` to `/pos`). Jobs paid/picked up before 0016 aren't invoiced retroactively. Real-NAS
restore drill and a `TZ` check on the NAS.

### 2026-09-26 — Wave 2: pages on Material 3 (inventory, jobs, POS, admin)

**What merged.** `team/admin-ui` → `team/inventory-ui` → `team/jobs-ui` → `team/pos-ui` into
`team/integrate2`, `--no-ff` each, tsc + vitest after every merge. Conflicts: `src/routes.tsx` twice
(kept admin's customer/settings/reports/audit imports, inventory's 7 `/inventory*` routes with
`/inventory/adjustments` manager-only, then pos' 9 lazy imports + routes, `/pos/counter` → `/pos`, NAV → `/pos`;
the `soon()` placeholder helper, `posLinks` and `ComingSoon` are gone) and
`server/modules/payments/routes.ts` (took pos-ui's side whole — `lists.ts` `balances()` + `paymentPage()`;
jobs-ui's inline paged balances block dropped; `server/jobs-lists.test.ts` passes against it).

**Pages.** Every route now has its own page folder (map in `docs/UI-GUIDE.md`): inventory list / item /
receiving / counts / adjustments / reorder; quote editor, orders board + list, Quick Order; POS counter,
drawer + Z-report, invoices, returns; Payments; customers list + detail; Reports, Audit (+ approvals),
Settings sub-pages. Old monoliths (`Inventory.tsx`, `Quotes.tsx`, `Orders.tsx`, `QuickOrder.tsx`, `Pos.tsx`,
`Customers.tsx`, `Settings.tsx`, `Materials.tsx`, `Taxonomy.tsx`) are gone.

**Checker's MUST FIX, applied.**
- Inventory: group-by is back (material default / color / size / unit / category; SQL orders by the group
  then the sort, rows carry `groupKey`/`groupLabel`, `groups` gives count + low per group; header rows collapse,
  collapsed keys live in the URL as repeated `closed=`), the size / color / low-first sorts are back, and each
  row has one-tap −1 (used) / +1 (received) — a cashier's −1 gets the manager prompt like any adjustment — plus
  "Adjust…" opening the adjust dialog preset to correction (the old Discrepancy).
- `crypto.randomUUID` doesn't exist on plain-http LAN origins: `src/lib/ref.ts` (`getRandomValues` fallback)
  is now used by Quick Order, the quote draft, POS and payments.
- Reports' sales card no longer walks `/api/invoices` in the browser: new `GET /api/reports/sales` (SQL, Z-report
  rule via `netSales`, manager+ — the card now shows for managers and admins only).
- Customer edit: legacy customers without an email can have name/phone/notes edited again (client sends only
  changed fields; email required only for new customers, customers who had one, or when the field is touched;
  server validates a sent email and refuses clearing one).
- `/api/balances` conflict resolved by the merge.

**Consolidation.** One keyset module (`lib/keysetPaging.ts`: `useKeyset` with `url | null`, `useKeysetMore` for the
ledger tables) and one `KeysetPager` (`touch` on POS); one `errorText` (+ `isDrawerClosed`, `lockedInvoice`,
`isNetworkError`) in `lib/errorText.ts`; customer pickers and Quick Order's Walk-in lookup use the paged
`/api/customers?q=&limit=10&offset=0` (the unpaged search only looked through 2,000 rows); Quick Order's "Today"
total comes from `/api/reports/summary?from=<local midnight>` (range now filtered in SQL, `paymentCount` added)
and its list from `/api/payments?limit=12&offset=0` (no more newest-100 undercount); `scripts/perf-baseline.ts`
probes every page's real first-load URLs; `shared/inventoryView.ts` (+ tests) and `pages/ComingSoon.tsx`
deleted; `SignIn`, `RoleGate`, `CopyButton` moved to role tokens and the legacy `ui.*` class strings removed.
Builder fixes carried in: `api.ts` no longer signs you out on a wrong current PIN when changing your own,
DataTable rows no longer shift (no state-layer on `<tr>`), the quote always sends `discountPct`.

**Verification.** __TESTS__ tests, tsc clean, client build ok; greps clean (`randomUUID` only inside `lib/ref.ts`,
no keyset hooks outside `src/lib`, no `soon(`, no raw hex / `text-white` / legacy aliases, no
`prompt/confirm/alert`); perf: every first-load probe < 10 ms (`docs/perf-baseline.md` → After wave 2 merge);
demo seed, backup + restore into a temp path, `batch/smoke.ts` 18/18; browser pass — see the integration report.

**Still open.** `/api/jobs` pages only when `offset` is sent (documented, left as is). `/api/reports/summary` and
`/api/reports/sales` compare stored UTC timestamps with plain dates, so a `YYYY-MM-DD` range is a UTC day
(Quick Order passes local midnight to avoid it). Server route files over 300 lines (sales, inventory, jobs)
were not split. Jobs paid/picked up before 0016 still aren't invoiced retroactively.
