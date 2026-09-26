# ADR 0005 — No hard deletes, an append-only audit log, and one transaction per write

**Status:** accepted (2026-09-25). Builds on ADR 0004 (roles, sessions, approvals).

## Context

Before Phase 1b the app could lose history in several ways:

- Six admin "Remove" buttons hard-deleted rows (customers, categories, category
  sizes, suppliers, materials, material colors). Removing a customer also
  deleted their **store-credit ledger** — money history. Removing a category
  deleted its size list and custom-field definitions and cleared every item's
  category. Guards ("blocked if it has order history") existed only in route
  code; nothing in the database stopped a stray `DELETE`.
- Editing a job deleted and re-inserted all of its lines, so the prior quote
  was gone.
- Payments were "never deleted" by convention only; any code path (or a
  sqlite3 shell) could rewrite an amount.
- There was no record of *who changed what*. The approvals table (ADR 0004)
  covers the few gated actions, not ordinary edits.
- Multi-step writes (job + lines, counter sale = job + payment + stock
  deduction, cycle-count close-out, receiving) were a series of independent
  statements. A crash or error midway left half a sale on the books.
- `GET /api/jobs?q=` filtered **after** the row limit, so search only covered
  the newest jobs.

Owner decisions (2026-09-25): no hard deletes on transactional or master data —
"delete" becomes **archive** (hidden but kept; the button stays and just
archives); an append-only audit log; multi-step writes in one DB transaction;
indexes for the common lookups. No other user-facing feature changes.

## Decision

### Archive instead of delete (migration `0014`)

- `archived_at` / `archived_by` (user id) on **customers, categories,
  category_sizes, suppliers, materials, material_colors**. `job_items` gets
  `deleted_at` (lines replaced by an edit). Jobs keep their existing
  `deleted_at` soft delete; users keep `active` (deactivate).
- Every existing `DELETE` route keeps its URL and its role/approval check but
  sets `archived_at` instead. It never cascades: a customer's credits, a
  category's sizes/fields/items, a supplier's receipts and item references all
  stay as they were. Archiving an already-archived row is a no-op `{ok:true}`
  (wifi retry).
- Each gets `POST …/:id/unarchive` with the same permission (customers: manager
  approval `customer.unarchive`; jobs: approval `job.unarchive`; the rest their
  existing role).
- List endpoints hide archived rows by default; `?includeArchived=1` shows them.
  Pickers for new records use the default. Records that point at an archived
  row (a job's material, an item's category/supplier) still resolve and show it
  — the client loads the full list for name lookups.
- The old "has order history / receiving history → 409, deactivate instead"
  guards on customer/material/supplier delete are gone: they existed to protect
  history, and archiving no longer threatens it.

### The database refuses hard deletes

`BEFORE DELETE … RAISE(ABORT, 'hard delete not allowed')` triggers on:

| Table | Also |
|---|---|
| payments | `BEFORE UPDATE`: only an unvoided payment's `voided_at`/`void_reason` may change — amount, method, kind, job, note, client ref, author and timestamp are immutable, and a void can't be undone |
| customer_credits | append-only (UPDATE blocked) |
| inventory_adjustments | append-only (UPDATE blocked) |
| cycle_counts | |
| cycle_count_lines | append-only (UPDATE blocked) |
| jobs, job_items | |
| customers, suppliers, categories, category_sizes | |
| materials, material_colors | |
| inventory_items | |
| users | |
| approvals | already append-only (0013) |
| audit_log | append-only (UPDATE blocked) |

### Audit log

- Table `audit_log` (`id, at, user_id, action, entity, entity_id, before_json,
  after_json, approval_id, request_id`), append-only by trigger.
- New module `server/modules/audit` (index.ts is the import surface):
  `audit(tx, req, {action, entity, entityId, before, after, approvalId})`.
  **Every mutating route** calls it inside the same transaction as its change,
  so the row exists if and only if the change committed. Actions are
  `<entity>.<verb>` (`customer.archive`, `payment.void`, `job.status`,
  `inventory.receive`, `cycle_count.complete`, `settings.update`,
  `auth.login` …). User snapshots never include the PIN hash.
- `requireApproval` now returns `{…approver, approvalId}`; gated actions put
  that id on their audit row. Called inside the route's transaction, the
  approvals row commits or rolls back with the action.
- `GET /api/audit` (admin): filters `entity`, `entityId`, `userId`, `from`,
  `to`; newest first; keyset pagination (`limit` ≤ 200, `before=<id>` cursor,
  response `{rows, nextBefore}`). `GET /api/audit.csv`: same filters, all rows.
  No UI page yet.
- **Not audited:** `PUT /api/users/prefs` (theme/accent/dashboard cards —
  cosmetic), read-only POSTs (`/api/stock-check/batch`), and the session
  `last_seen_at` touch.

### One transaction per write — `withTx`

- `withTx(async (tx) => …)` in `server/db/index.ts` runs `BEGIN IMMEDIATE …
  COMMIT` (ROLLBACK on any throw) on a **dedicated writer connection**, with an
  in-process queue so only one write transaction runs at a time. Re-entrant: a
  nested `withTx` joins the outer transaction.
- Why not drizzle's `db.transaction()`: `@libsql/client`'s local-file driver
  hands its one connection to the transaction and lazily opens a new one for
  everything else. The new connection has no `PRAGMA foreign_keys = ON`, the
  old one is never closed (a handle leak per transaction), and a write on the
  new connection while a transaction is open fails `SQLITE_BUSY` (the driver's
  busy wait is synchronous, so it can't wait for our own async transaction).
  One long-lived writer connection plus an in-process queue avoids all three;
  reads stay on the main connection (WAL).
- Every mutating route — including single-row ones, since each also writes an
  audit row — runs in `withTx`, and every read that decides the write
  (idempotency lookups, balances, counts, "already voided") goes through `tx`.
  Cross-module functions take an optional `dbx: Db = db`: `creditBalanceCents`,
  `paidNetCents`, `livePaymentCount`, `recordSale`, `getSetting`, `setSetting`,
  `taxRatePct`, `activeAdminCount`, and jobs' `generatePo` / `verifyQuoteMath`.
- **Counter sale:** job + payment + stock deduction + audit rows are one
  transaction. "A sale is never blocked by inventory" still holds for stock
  levels (unknown/inactive item → no deduction; oversell clamps at zero), but a
  genuine DB error in the deduction now rolls the whole sale back (500) instead
  of leaving a paid sale with an unrecorded deduction; the client's idempotent
  retry (same `clientRef`) redoes it.

### Indexes

Added: `jobs(created_at)`, `jobs(status)`, `jobs(customer_id)`,
`job_items(job_id)`, `payments(job_id)`, `payments(created_at)`,
`customer_credits(customer_id)`, `inventory_adjustments(item_id, created_at)`,
`inventory_adjustments(created_at)`, `cycle_count_lines(cycle_count_id)`,
`customers(name)`, `customers(email)`, `audit_log(entity, entity_id)`,
`audit_log(at)`, `approvals(created_at)`. Already present (not duplicated):
`jobs(po)` unique, roll-SKU unique key, `sessions(user_id)`,
`suppliers(lower(name))` unique. `inventory_items` has no `sku` or barcode
column, so none was added.

### Jobs search

`GET /api/jobs?q=` now filters in SQL (`LIKE` on title, PO, tags, file ref,
customer name; `%`/`_` in the search text match literally) **before** `LIMIT`.

## Consequences

- Nothing entered in the app can be erased through it, and the database backs
  that up for anything that bypasses the app. Archived rows accumulate; at this
  shop's volume that is a non-issue.
- A deliberate data fix (e.g. removing a test customer) now needs a manual
  migration that drops/recreates the trigger — by design.
- Every change is attributable after the fact, not just approved actions.
  `audit_log` grows by one row per mutation (~ a few thousand a month) —
  indexed on `at` and `(entity, entity_id)`.
- Writes are serialized in-process. For a 1–5 person shop each transaction is
  milliseconds; the queue is invisible. Scaling to multiple server processes
  would need a different approach (not planned).
- The Phase 1b perf re-run showed no meaningful regression
  (`docs/perf-baseline.md`).
