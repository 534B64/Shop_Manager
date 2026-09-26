# Performance baseline — 2026-09-25

**Method.** Seeded a throwaway DB with `DB_PATH=/tmp/perf-test.db npm run db:seed:perf`
(5,000 inventory items incl. 225 roll SKUs, 500 customers, 3,000 jobs / 4,344 job items,
3,577 payments, 20,000 inventory adjustments over 2 years, 105 cycle counts; deterministic),
then ran `DB_PATH=/tmp/perf-test.db npm run perf:baseline`. The script builds the real app via
`buildApp()` and times each first-view GET in-process with `app.inject` (1 warm-up discarded,
then the median of 5). Timings are handler + SQLite + JSON serialization on a WSL2 dev box —
**no network**, so real LAN/wifi transfer time comes on top (see Size). Re-run after any change to
compare; numbers are only comparable against the same seed.

| Endpoint | Page | Median ms | Size KB | Rows | Unpaginated | Notes |
|---|---|---:|---:|---:|:---:|---|
| `/api/dashboard` | Dashboard | 54.8 | 21.1 | — | yes | all inventory rows, filtered in memory |
| `/api/jobs?limit=200` | Dashboard / Orders | 4.8 | 122.5 | 200 |  | LIMIT 200 (server cap 500) |
| `/api/jobs?limit=50` | Quotes | 2.1 | 30.8 | 50 |  | LIMIT 50; search `q` filters in memory AFTER the limit |
| `/api/jobs?limit=500` | (max page size) | 10.6 | 306.3 | 500 |  | server cap |
| `/api/jobs/1` | Orders (detail) | 0.6 | 0.6 | — |  | one job + items |
| `/api/customers` | Customers | 2.3 | 39.2 | 200 |  | LIMIT 200; group-by over all jobs |
| `/api/customers?q=Walk-in` | Quick Order | 3.1 | 0.0 | 0 |  | loads up to 2000 rows, filters in memory |
| `/api/inventory` | Inventory | 60.4 | 2059.0 | 5000 | yes |  |
| `/api/inventory/reorder` | Inventory | 47.0 | 85.5 | 308 | yes | full scan + in-memory sort |
| `/api/inventory/usage` | Inventory | 53.0 | 617.5 | 5000 | yes | full scan + in-memory sort |
| `/api/inventory/valuation` | Inventory | 46.2 | 0.5 | — | yes | full scan, aggregated object |
| `/api/inventory/1/history` | Inventory (item log) | 0.5 | 0.5 | 3 |  | LIMIT 50 |
| `/api/roll-skus` | Inventory / Quotes | 2.7 | 90.3 | 225 | yes |  |
| `/api/cycle-counts/next` | Inventory (cycle count) | 0.1 | 0.1 | — |  |  |
| `/api/materials` | Materials / Quotes | 0.3 | 3.6 | 14 | yes |  |
| `/api/materials?all=1` | Materials (admin) | 0.3 | 3.6 | 14 | yes |  |
| `/api/categories` | Taxonomy / Inventory | 0.4 | 1.4 | 8 | yes |  |
| `/api/suppliers` | Taxonomy / Inventory | 0.2 | 0.9 | 6 | yes |  |
| `/api/payments` | Payments | 1.5 | 22.3 | 100 |  | LIMIT 100 |
| `/api/balances` | Payments | 13.6 | 59.4 | 388 | yes | every job, filtered to owing in memory |
| `/api/reports/summary` | Reports | 19.5 | 0.2 | — | yes | reads ALL payments, filters in memory |
| `/api/reports/payments.csv` | Reports (CSV) | 23.7 | 337.7 | 3577 | yes |  |
| `/api/reports/jobs.csv` | Reports (CSV) | 19.4 | 317.9 | 3000 | yes |  |
| `/api/settings/tax` | Settings / all | 0.2 | 0.0 | — |  |  |
| `/api/settings/inventory` | Settings / all | 0.2 | 0.1 | — |  |  |
| `/api/users` | Sign-in | 0.1 | 0.0 | 0 |  |  |

## Slowest (median ms)
1. `/api/inventory` — 60 ms
2. `/api/dashboard` — 55 ms
3. `/api/inventory/usage` — 53 ms
4. `/api/inventory/reorder` — 47 ms
5. `/api/inventory/valuation` — 46 ms

## Biggest (response size)
1. `/api/inventory` — **2.06 MB** (5,000 rows, every column)
2. `/api/inventory/usage` — 618 KB
3. `/api/reports/payments.csv` — 338 KB, `/api/reports/jobs.csv` — 318 KB (exports; expected)
4. `/api/jobs?limit=500` — 306 KB; the pages actually use `limit=200` (123 KB)

## Findings
- **Every slow or large endpoint is an unpaginated full-table read of `inventory_items`.** Five
  endpoints (`/api/inventory`, `/dashboard`, `/reorder`, `/usage`, `/valuation`) each `SELECT *` all
  5,000 rows and filter/sort/aggregate in JS; the ~46–60 ms floor is that scan, not the payload.
- `/api/dashboard` ships only the low-stock list (21 KB) but pays the full inventory scan to compute it —
  a `WHERE active AND count <= low_stock_threshold` in SQL would avoid that.
- `/api/inventory` at 2 MB is the transfer-cost problem on sketchy wifi; the response is also not
  compressed (no `@fastify/compress` registered).
- Other unpaginated endpoints (`/api/balances`, `/api/reports/summary`, CSV exports, `/api/roll-skus`,
  materials/categories/suppliers) are fine at this volume (≤ 24 ms; the small lookup tables are tiny).
  `/api/balances` and `/api/reports/summary` scale with jobs/payments and are the next to watch.
- Job/customer/payment lists are capped server-side (`limit`, 200, 100) and are fast (2–5 ms).
  Caveat: `/api/jobs?q=` filters in memory *after* the limit, so search only covers the newest N rows.
  *(Fixed in Phase 1b — the filter is now SQL `LIKE` before `LIMIT`; see below.)*
- Seed caveat: `/api/customers?q=Walk-in` returns 0 rows because the perf seed has no Walk-in
  customer; the cost measured is the 500-row scan + filter.

## After Phase 1b (2026-09-25)

Same seed (`DB_PATH=/tmp/perf-1b.db npm run db:seed:perf`), same script, run 3× (the first run
on a busy box was ~1.4× slower across the board, including untouched inventory/CSV endpoints —
machine noise). Representative run:

| Endpoint | Before ms | After ms | Note |
|---|---:|---:|---|
| `/api/jobs?limit=50` | 2.1 | 1.6 | new `jobs(created_at)` / `jobs(status)` indexes |
| `/api/jobs?limit=50&q=decal` | — | 1.7 | **new probe** — search now runs in SQL before LIMIT |
| `/api/jobs?limit=50&q=zzzz-nohit` | — | 1.7 | **new probe** — no-hit worst case scans all 3,000 jobs |
| `/api/jobs?limit=200` | 4.8 | 4.2 | |
| `/api/customers` | 2.3 | 2.9 | +`archived_at` column / filter (42.7 KB vs 39.2 KB) |
| `/api/inventory` | 60.4 | 66.1 | unchanged code; run-to-run spread 66–95 ms |
| `/api/dashboard` | 54.8 | 53.8 | |
| `/api/balances` | 13.6 | 13.4 | |
| `/api/payments` | 1.5 | 1.1 | `payments(created_at)` index |
| `/api/reports/payments.csv` | 23.7 | 22.5 | |

**Nothing got meaningfully slower.** The archive filter and audit columns add well under a
millisecond; the jobs-search fix costs nothing measurable at 3,000 jobs. Writes are not in this
GET-only baseline — each mutation now also writes one audit row inside its transaction, which is a
single indexed insert. The inventory full-scan findings above still stand (next target).

## After Phase 2 (2026-09-26)

Fresh seed (`DB_PATH=/tmp/perf-2.db npm run db:seed:perf`, now 24,993 ledger rows including
opening balances), same script:

| Endpoint | After 1b ms | After 2 ms | Note |
|---|---:|---:|---|
| `/api/inventory` | 66.1 | 70.5 | unchanged read path (count cache); within run-to-run spread |
| `/api/dashboard` | 53.8 | 54.7 | |
| `/api/inventory/usage` | — | 59.6 | |
| `/api/inventory/valuation` | — | 56.7 | now on-hand × moving average |
| `/api/inventory/1/history` | — | 0.4 | |
| `/api/balances` | 13.4 | 12.9 | |

**No regression.** On-hand reads still use `inventory_items.count`; the ledger only costs an
indexed `SUM` inside the guard trigger on writes. The full-table inventory endpoints (2.1 MB for
`/api/inventory`) remain the paging target for the UI phase.

## After Phase 3 (2026-09-26)

Fresh seed (`DB_PATH=/tmp/perf-3.db npm run db:seed:perf`): same jobs/payments/ledger data as
Phase 2 (the invoice step draws no random numbers) plus **2,646 invoices** (one per settled job,
numbered in date order through the gap-free sequence, one row at a time; lines batched) and
**365 closed drawer sessions**. The perf seed still finishes in ~1.5 s. New probes added to
`scripts/perf-baseline.ts` (their responses are `{rows, nextBefore}` objects, so Rows shows —):

| Endpoint | After 2 ms | After 3 ms | Note |
|---|---:|---:|---|
| `/api/invoices?limit=50` | — | 1.2 | **new** — keyset page, void join + returned-value subquery |
| `/api/invoices?limit=50&from=…&to=…` | — | 1.5 | **new** — `invoices(created_at)` index |
| `/api/invoices?number=000100` | — | 0.5 | **new** — unique number index |
| `/api/invoices/000100` | — | 0.9 | **new** — detail: lines, void, returns, payments |
| `/api/returns?limit=50` | — | 0.5 | **new** (empty in the perf seed) |
| `/api/drawer?limit=50` | — | 0.8 | **new** — session history |
| `/api/drawer/1/z-report` | — | 0.5 | **new** — stored Z-report |
| `/api/balances` | 12.9 | 16.6 | now also subtracts returned goods (one more grouped CTE) and skips archived jobs |
| `/api/payments` | 1.1 | 1.5 | 5 more columns per row |
| `/api/inventory` | 70.5 | 74.0 | unchanged code; run-to-run spread |

**No meaningful regression.** `/api/balances` is the one endpoint that does more work (≈ +4 ms at
3,000 jobs) and is still unpaginated — the next thing to watch as jobs grow. Writes (counter sale =
job + invoice + lines + payment + audit in one transaction) are not in this GET-only baseline.
