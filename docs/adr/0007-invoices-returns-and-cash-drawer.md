# ADR 0007 — Locked invoices, voids, returns, price overrides, and the cash drawer

**Status:** accepted (2026-09-26). Builds on ADR 0002 (payments own money
math), 0004 (approvals), 0005 (no hard deletes, audit, `withTx`), 0006
(inventory ledger). Epicor Prophet 21 was the reference for the
data-integrity rules (order → invoice, RMAs), not for UI.

## Context

Until Phase 3 a Job was the only sales record. A paid, picked-up job could
still be edited (price, tax, customer), so what the customer was charged was
never fixed anywhere; tax existed only inside `jobs.total_cents`; a "void"
could only mark one payment row as a mistake; there was no return flow (a
refund was a bare money row with nothing about what came back or whether it
went back on the shelf); and nothing tied cash to a counted drawer.

Owner decisions (final): the Job stays the editable quote/order; an
**Invoice** is a locked snapshot made when the job is paid in full or picked
up (a counter sale makes one at once); invoice numbers are separate from the
PO and **gap-free**; tax is stored **per invoice line**; voids and returns are
new linked records; card is record-only; refunds over a Settings threshold
(default $50) need a manager; a price different from the estimator's
suggestion needs a manager; cash goes through a counted **drawer session**
that closes into an immutable **Z-report**.

## Decision

### Tables (migration `0016`, schema `server/db/schema/sales.ts`)

| Table | What | Guard triggers |
|---|---|---|
| `number_sequences` | `name` → `next_value`; row `invoice` | no DELETE; UPDATE only `next_value + 1` |
| `invoices` | header snapshot: number, job, customer (+name), PO, title, source `job`/`counter_sale`, rate, subtotal/tax/discount %/discount/total, drawer, who, when | no UPDATE, no DELETE; INSERT only with the number the sequence just handed out |
| `invoice_lines` | line no, description, `detail` (JSON of the job's extra items), qty, unit price, subtotal, suggested, taxable, rate, tax, discount share, total, stock item + qty deducted | no UPDATE, no DELETE |
| `invoice_voids` | one per invoice (unique): reason, refund total, job archived?, approval, drawer | append-only |
| `returns`, `return_lines` | RMA header (client ref, reason, subtotal/tax/discount/total, refund + method, approval, drawer) and lines (invoice line, qty, restock?, restocked qty, value parts) | append-only |
| `drawer_sessions` | register (1 today), status, float, opened by/at, close fields, `z_report_json` | no DELETE; the only UPDATE is open → closed, once; one open session per register (partial unique index) |

`payments` gains `drawer_session_id`, `tendered_cents`, `change_cents`,
`return_id`, `invoice_void_id` (the immutability trigger is recreated to cover
them). `jobs` gains `tax_rate_pct` — the rate its stored total was computed
with, so the invoice can snapshot it.

**Invoice payments reuse `payments` (by job), not a new table.** An invoice
belongs to exactly one job; the job's payment rows are the invoice's payments.
A job has at most one *live* (unvoided) invoice, so there's no ambiguity, and
every existing balance/report query keeps working. Rejected: an
`invoice_payments` table (a second money ledger to keep in sync) and an
`invoice_id` column on payments (payments made before invoicing would need an
UPDATE of immutable rows).

### Invoice numbers

`UPDATE number_sequences SET next_value = next_value + 1 … RETURNING` inside
the same `withTx` as the invoice insert. A failed sale rolls the step back, so
no number is consumed; the in-process write queue serializes concurrent sales.
The DB enforces it too: the sequence only moves by one, the insert trigger
only accepts that number, and `number` is unique. Displayed zero-padded to six
digits (`000001`). Rejected: `MAX(number)+1` (races, and reuses a number if the
newest invoice were ever lost) and the invoice's row id (not gap-free across
rollbacks).

### Tax and totals (`shared/invoice.ts`)

- Per line: `round(line subtotal × rate / 100)` (JS `Math.round`, half-up on
  the cent — the same call the Quotes page uses). Invoice tax = sum of lines.
- The customer discount stays today's rule: % of (subtotal + tax), after tax,
  rounded once for the ticket, then allocated to lines by (subtotal + tax)
  with largest-remainder so the line shares sum exactly.
- Line total = subtotal + tax − discount share; invoice totals are the sums.
  For a one-line invoice this equals `grandTotalCents` exactly.
- **A job invoices as one line** carrying the job's price: the Price field is
  the whole pre-tax ticket and additional items are advisory estimator lines
  (their `priceCents` do not add up to the price), so they ride along in the
  line's `detail` for printing. qty = the job's quantity (for pro-rated
  returns).
- A job with no stored total (the pre-Phase-11 path, never charged tax)
  invoices untaxed. A stored total the current rate no longer reproduces keeps
  its original tax (`taxForTotal`), so the invoice always equals what the job
  charged.

### When an invoice is created

- `POST /api/pos/sale` — always, in the sale's transaction.
- A payment that brings the balance to ≤ 0 (`invoiceIfSettled`).
- A status change to `picked_up` (paid or with the approved unpaid override).
- `POST /api/invoices {jobId}` by hand (re-invoicing after a keep-job void).

Once a job has a live invoice, `PUT /api/jobs/:id` refuses (409) any change to
price, tax flag, discount, customer, estimator inputs, or lines; re-sending
them unchanged is fine (the edit form sends everything), other fields still
save, and removing the job is refused.

### Void

`POST /api/invoices/:id/void` — manager approval (`invoice.void`), reason.
Writes an `invoice_voids` row; the invoice and lines are untouched. Refunds
what was paid (net of earlier refunds) as refund rows linked to the void — by
original tender, or all to `refundMethod`; cash needs the drawer. Stock the
sale deducted goes back as `return` inventory transactions (source
`invoice_void`), less every unit already returned (restocked ones are already
back; damaged ones stay off the shelf). The void row stores what it actually
cancelled — `net_total_cents` / `net_tax_cents` = invoice total/tax minus the
returns already taken (migration `0017`) — and the Z-report subtracts that, so
a return followed by a void is never counted twice. By default the job
is archived (the sale is cancelled, so it leaves the owed list);
`keepJob: true` leaves it open, unlocked, to be corrected and re-invoiced under
a new number.

### Return (RMA)

`POST /api/returns` lists invoice lines + qty (≤ sold − already returned) and
`restock` per line (only stock-item lines; damaged goods stay off the shelf).
A restock never puts back more than the sale took off the shelf (`stockQty`,
which is below qty when the sale clamped at zero) less what was returned before.
Each part (subtotal, tax, discount) is refunded pro-rata by the difference of
cumulative shares, so returning a whole line in pieces adds up to exactly the
line. Money back = only what the customer overpaid once the return lowers what
they owe (`refundDueCents`) — returning part of an unpaid invoice just lowers
the balance. **Balance** is now after-tax total − returned value − live
payments + live refunds (`owedCents` in payments). A return whose value is
over `posSettings.refundApprovalThresholdCents` (default 5000, admin,
`PUT /api/settings/pos`) needs manager approval (`return.refund`); at or under
it a cashier does it alone. The existing bare refund (`POST /api/payments`
kind `refund`) still always needs approval, and is refused (409) when it is more
than the job has been paid (`paidNetCents`). A payment row can't be voided when
it is a return's or void's refund, or when its drawer session is closed — issue
a refund/return instead.

### Price override

Server-side at job create/edit: if the stored suggestion (server-computed,
else the client's) is not null and the final price differs, saving needs
approval `price.override` — only when the edit creates or changes the
override. Counter-sale lines may carry `suggestedUnitPriceCents` and the same
rule applies. Inventory items have no sell price, so a plain Quick Order has
no suggestion and no override. The estimator stays advisory: the override is
always possible, just approved and logged (approvals row + audit row).

### Cash drawer

`POST /api/drawer/open` (anyone, counted float) → one open session per
register. Every payment/refund row written while a drawer is open is attached
to it; **cash with no open drawer is refused (409, `code: 'drawer_closed'`)**
everywhere — payments, counter sale, void and return refunds. Card/check need
no drawer. `POST /api/drawer/close` (manager+) takes counted cash (and
optionally checks), computes expected cash = float + cash payments − cash
refunds (voided rows excluded), over/short = counted − expected, and freezes
the **Z-report** (by-tender totals, sales/tax/discounts, voids, returns,
voided payments, invoice number range, net sales/tax, cash + checks
expected/counted/over-short) into the session. `GET /api/drawer/:id/z-report`
(+ `.csv`) serves the frozen copy; while open, a live preview with
`final: false`. Invoices, voids, returns are stamped with the open session so
the Z-report counts them.

**Date-range sales (wave 2, 2026-09-26):** `GET /api/reports/sales?from&to`
(manager+, `server/modules/sales/reports.ts`) adds up the same three parts in
SQL for any date range — invoices issued, what voids made in the range
cancelled (`net_total_cents`/`net_tax_cents`), returns made in the range —
and nets them with the Z-report's own rule (`netSales` in `shared/invoice.ts`),
so a day's figures equal that day's Z-reports. A void or return counts on the
day it happened, not the invoice's day. The Reports page's sales card calls it
once instead of reading invoices in the browser.

### Module

New `server/modules/sales` (routes/service/index, ADR 0001). `POST
/api/pos/sale` moved there (same path, same legacy body). Payments keeps money
math and is now the single writer of payment rows (`recordPayment`: drawer
rule, tender/change, store credit, audit). Payments ↔ sales import each other
through their `index.ts` (payments' route issues the invoice on settle; sales
uses `recordPayment`/`owedCents`); every cross use is inside a function, so the
ES-module cycle is safe.

## Consequences

- What the customer was charged is fixed the moment it's sold; corrections
  leave a trail (void or return records, their refund rows, approvals, audit).
- Cash can't be taken until someone counts the float in the morning; the shop
  gets a daily over/short. Card/check payments with no drawer open aren't in
  any Z-report.
- `/api/balances` now skips archived jobs and subtracts returns.
- Quick Order still adds no tax unless the request says `taxable: true`
  (flagged for the owner).
- Not built: invoice/receipt printing, credit-memo numbering for returns,
  exchanges, per-line tax categories, multi-register, split tender on a counter
  sale (pay the rest through `/api/payments`), UI (next phase).

## Known limits

- Counter-sale price-override detection depends on the client sending
  `suggestedUnitPriceCents` on the line: inventory items have no sell price,
  so a line rung up with no suggestion is never flagged.
- Jobs paid or picked up before migration `0016` are not invoiced
  retroactively — invoice numbering starts at go-live. `POST /api/invoices`
  can invoice one by hand if it's ever needed.
- A $0 pickup (warranty redo, freebie) takes no invoice number.
