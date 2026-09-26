# ADR 0006 — Perpetual inventory ledger, DB-enforced on-hand, moving average cost

**Status:** accepted (2026-09-26)

## Context

Before Phase 2, `inventory_items.count` was a plain column. Most changes wrote
an `inventory_adjustments` row, but item create/edit could set the count
directly, so the adjustment history could not be trusted to explain on-hand.
The owner wants the app ready for real sales and inventory, using Epicor
Prophet 21 as the reference for data integrity (not UI): every quantity change
is a transaction with who, when, why and source document; nobody edits on-hand;
one documented costing method; cycle counts go count → variance → approve →
post.

Constraints from CLAUDE.md still hold: the weekly cycle count is the reconciler
for untracked use, and there is **no production-consumption workflow**.

## Decision

1. **The ledger is `inventory_adjustments`, evolved in place** (migration
   0015). The table name stays so history, reports and Phase 12 code keep
   working. The domain term is *inventory transaction*. New columns:
   `txn_type` (receipt, sale, return, adjustment, transfer_out, transfer_in,
   production, count, opening), `location_id`, `unit_cost_cents` (per COUNT
   unit, stamped on every row), `purchase_unit_cost_cents` (receipts, as
   entered — the old `unit_cost_cents` renamed), `source_type`/`source_id`,
   `user_id`. Rows remain append-only (ADR 0005 trigger).
2. **Locations.** `locations` (default id 1 "Shop") and `inventory_balances`
   (item × location). `inventory_items.count` stays as the item's total
   on-hand cache, because the whole app reads it.
3. **The invariant lives in the database, not only the app.** An AFTER INSERT
   trigger on the ledger applies each delta to the balance and the item count.
   Guard triggers reject any other write: an item inserted with count ≠ 0, an
   UPDATE of `count` that doesn't equal the ledger sum, and any balance write
   that doesn't equal the per-location sum. Migration 0015 first writes one
   `opening` transaction per item for whatever the old count held that the
   history didn't explain, so existing data satisfies the invariant.
4. **One write path in code:** `postTransaction()` in the inventory service.
   `receive`, `adjust`, `transfer`, `recordSale`, `recordReturn` and
   `recordProduction` are thin wrappers. Reasons are required for adjustment,
   count and production. A withdrawal may not take a location below zero; a
   counter sale clamps at what's on hand instead (a sale is never blocked).
5. **Moving weighted-average cost**, per count unit, on `inventory_items.avg_cost_cents`.
   A receipt converts its per-purchase-unit cost through the UOM factor, then
   `avg = round((onHand·avg + qty·cost) / (onHand + qty))`; if on-hand was ≤ 0
   the receipt cost becomes the average outright. All other transactions are
   stamped with the current average. Valuation = on-hand × average.
   Pure math in `shared/costing.ts`.
6. **Cycle count posting is variance-based.** Submitting snapshots the system
   count per line and changes nothing. A manager (via `requireApproval`,
   action `cycle_count.post`) posts one `count` transaction per line with
   delta = counted − snapshot, *not* counted − current, so sales between the
   count and the posting aren't wiped out. A manager may send a submission
   back (lines stay, append-only, superseded by the next round) or submit and
   post in one step.
7. **Production** exists only as a transaction type. Nothing in the UI creates it.

## Alternatives considered

- **New `inventory_transactions` table** alongside the old one: cleaner name,
  but two tables describing the same history, a copy step, and every Phase 12
  report rewritten. Rejected.
- **Derive on-hand with `SUM()` on every read:** always correct but every
  inventory page scans 25k+ rows. The cache + guard trigger gives the same
  guarantee at no read cost.
- **FIFO / standard cost:** FIFO needs cost layers per receipt and consumption
  matching — heavy for a 1–5 person shop. Standard cost needs someone to
  maintain standards and book variances. Moving average is what P21 defaults
  to for distributors and needs no upkeep.

## Consequences

- Nothing — app code, a script, or the sqlite shell — can change on-hand
  without leaving a ledger row. `GET /api/inventory/reconcile` (manager+)
  should always return `ok: true`.
- Item create with a starting count writes an `opening` transaction; item edit
  refuses `count` with a 400 pointing to adjustments.
- Seed scripts must write stock through ledger rows (the triggers apply them).
- Cycle counts assume the default location: the snapshot is the item total and
  postings go to "Shop". Counting per location is a later decision if the shop
  ever stocks more than one place.
- Posting clamps a negative variance at what's left on the shelf (an oversell
  between count and post) and notes the shortfall on the row.
