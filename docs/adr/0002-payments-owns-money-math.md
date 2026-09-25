# ADR 0002 — The payments module owns all money math

**Status:** accepted (2026-07-03)

## Context

Before the reorg, balance math lived inside `server/routes/payments.ts`;
`customers.ts` imported `creditBalanceCents` from it (the app's only
route→route import), and `jobs.ts` re-derived paid sums with its own SQL
against the payments table for the unpaid-pickup block. Two modules knew how
money adds up — a locality leak in the most correctness-critical logic after
pricing.

## Decision

`server/modules/payments/index.ts` exposes exactly:

- `paymentRoutes` — HTTP registration (payments, balances, reports/CSV)
- `creditBalanceCents(customerId)` — store-credit ledger balance
- `paidNetCents(jobId)` — live payments − refunds, voids excluded
- `livePaymentCount(jobId)` — count of live money rows (jobs' removal rule:
  count-based on purpose — a fully-refunded job still has live rows and still
  blocks deletion, exactly as before)

Consumers: customers (credit balance), jobs (pickup blocking via
`paidNetCents` instead of raw SQL). Reports/CSV endpoints stay *inside* the
module — CPA requirements are still TBD; a separate reports module would be a
seam with nothing varying behind it (one adapter = hypothetical seam).

## Consequences

- Void/refund/credit/balance rules are implemented and tested in one place.
- A future card processor integrates behind this same interface (e.g. a hard
  overpayment cap inside `paymentRoutes`), touching no other module.
- If the CPA conversation produces real reporting requirements, extracting a
  reports module then is a mechanical move out of payments.
