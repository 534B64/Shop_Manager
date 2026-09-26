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

## After UI foundation (2026-09-26)

Fresh seed (`DB_PATH=/tmp/perf-ui.db npm run db:seed:perf`), same script plus new **paged probes**
(`limit=50`); three runs, representative numbers. "Before" is the After Phase 2 column.

| Endpoint | Before ms | After ms | Before KB | After KB | Note |
|---|---:|---:|---:|---:|---|
| `/api/dashboard` | 54.7 | **1.5** | 21.1 | **1.4** | low-stock `WHERE` + urgency `ORDER BY` in SQL, top 20 + `lowStockCount` |
| `/api/inventory/valuation` | 56.7 | **2.0** | 0.5 | 0.5 | per-category `SUM` in SQL, same math |
| `/api/inventory/reorder` (unpaged) | 47.0 | **5.3** | 85.5 | 85.5 | only low rows leave SQL; JS urgency sort kept |
| `/api/inventory?limit=50` | — | 2.0 | — | 21.7 | **new** — page 1 of 5,000 + `count(*)` |
| `/api/inventory?limit=50&q=red` | — | 2.5 | — | 21.6 | **new** — LIKE over name/color/vendor (99 hits) |
| `/api/inventory?limit=50&offset=4950` | — | 6.5 | — | 21.2 | **new** — last page, worst-case OFFSET |
| `/api/inventory?limit=50&low=1&sort=count` | — | 1.6 | — | 21.3 | **new** — 308 low items, by count |
| `/api/inventory/reorder?limit=50` | — | 1.9 | — | 14.0 | **new** — urgency order in SQL |
| `/api/inventory/usage?limit=50` | — | 1.8 | — | 6.5 | **new** — rate order in SQL |
| `/api/inventory` (unpaged) | 70.5 | 68–74 | 2,059 | 2,152 | unchanged on purpose — old pages still call it |
| `/api/inventory/usage` (unpaged) | 59.6 | 55–63 | 617.5 | 617.5 | unchanged on purpose |

**Result.** A paged inventory view costs ~2 ms and ~22 KB instead of ~70 ms and 2.1 MB (≈100×
smaller on the wire). The dashboard's low-stock summary and the valuation no longer scan the table
in JS (~30× faster). The unpaged `/api/inventory` and `/usage` stay as they were until the page
builders move the Inventory and Quick Order pages to `?limit=` — then nothing in the browser loads
the full table. (Reorder "before" is the original 2026-09-25 number; Phase 2 didn't re-list it.)
Still open: `/api/balances` (15 ms, 59 KB) and the dashboard's `/api/jobs?limit=200` (122 KB) — a
server-side "due soon" / "owing" query would shrink both.

## After wave 1 merge (2026-09-26)

Fresh seed (`DB_PATH=/tmp/perf-int.db npm run db:seed:perf`) on the merged `team/integrate`
(ops + POS + UI foundation + the wave 1 fixes), same script. Compared with the best earlier column
for each probe:

| Endpoint | Before ms | Wave 1 ms | Note |
|---|---:|---:|---|
| `/api/dashboard` | 1.5 (UI) | 1.3 | SQL summary kept through the merge |
| `/api/inventory/valuation` | 2.0 (UI) | 1.7 | |
| `/api/inventory?limit=50` | 2.0 (UI) | 1.9 | paged probes all 1.5–5.9 ms, as before |
| `/api/inventory` (unpaged) | 74.0 (3) | 68.0 | run-to-run spread |
| `/api/invoices?limit=50` | 1.2 (3) | 1.2 | |
| `/api/drawer?limit=50` | 0.8 (3) | 1.0 | |
| `/api/balances` | 16.6 (3) | 15.0 | still the unpaged one to watch |
| `/api/payments` | 1.5 (3) | 1.4 | |

**No regression from the merge.** The wave 1 fixes touch write paths only (void/return/refund
guards, one extra `SUM` over `returns` when voiding); no GET got slower. `scripts/perf-baseline.ts`
now shows keyset pages (`{rows, nextBefore}`) as a plain row count instead of "50 of undefined".

## After wave 2 merge (2026-09-26)

Fresh seed (`DB_PATH=/tmp/int2-perf.db npm run db:seed:perf`) on `team/integrate2` (inventory, jobs, POS and
admin pages on Material 3 + the checker fixes). The probe list is now **every page's real first-load URL**
(what `src/` actually fetches, incl. the new inventory `group=` default); probes of unpaged whole-table
endpoints no page calls any more (`/api/inventory`, `/api/balances`, `/api/payments`, `/api/inventory/usage`,
the CSV exports, `/api/customers` without paging) were dropped. The only unpaged probes left are small
configuration tables (materials, categories, suppliers, locations, users).

**Every first-load probe is under 10 ms** (slowest: the inventory list's last page at offset 4950, 8.3 ms;
the Orders board, 5.5 ms). Reports' sales card is one SQL call (0.6 ms) instead of walking up to 10,000
invoices in the browser; Quick Order's "today" total is a SQL range sum (0.3 ms) instead of the newest 100 rows.

Baseline against `/tmp/int2-perf.db` — median of 5 runs (after 1 warm-up), app.inject, in-process.

| Endpoint | Page | Median ms | Size KB | Rows | Unpaginated | Notes |
|---|---|---:|---:|---:|:---:|---|
| `/api/dashboard` | Dashboard | 1.3 | 1.4 | — |  | low-stock top 20 + count in SQL |
| `/api/jobs/due-soon?days=7&limit=6&today=2026-09-26` | Dashboard | 1.9 | 3.9 | 6 of 262 |  |  |
| `/api/balances?limit=5` | Dashboard | 4.4 | 0.9 | 5 of 330 |  | owed, largest first, SQL |
| `/api/jobs?limit=6&offset=0` | Quotes /quotes/new | 1.2 | 3.8 | 6 of 2942 |  | recent jobs |
| `/api/materials` | Quotes /quotes/new | 0.7 | 4.1 | 14 | yes | config table |
| `/api/jobs/1` | Quotes /quotes/:id | 1.3 | 0.7 | — |  | job + items + invoice + owed |
| `/api/jobs/board?limit=20` | Orders (board) | 5.5 | 63.4 | — |  | 7 lanes × 20 + counts |
| `/api/jobs/board?limit=20&q=decal` | Orders (board, search) | 5.8 | 35.0 | — |  |  |
| `/api/jobs?limit=25&offset=0` | Orders (list) | 1.6 | 15.9 | 25 of 2942 |  |  |
| `/api/jobs?limit=25&offset=0&q=zzzz-nohit` | Orders (list, no hit) | 2.4 | 0.0 | 0 of 0 |  | worst case: scans every job |
| `/api/reports/summary?from=2026-09-26T05%3A00%3A00.000Z` | Quick Order | 0.3 | 0.1 | — |  | today total, SQL range |
| `/api/payments?limit=12&offset=0` | Quick Order | 1.1 | 3.9 | 12 of 3577 |  |  |
| `/api/customers?q=Walk-in&limit=10&offset=0` | Quick Order | 0.5 | 0.0 | 0 of 0 |  |  |
| `/api/inventory?limit=8&offset=0&q=red` | Quick Order / POS | 1.7 | 3.4 | 8 of 99 |  | stock picker |
| `/api/drawer/current` | POS /pos | 0.4 | 0.0 | — |  |  |
| `/api/customers?q=smi&limit=10&offset=0` | POS /pos | 0.6 | 0.0 | 0 of 0 |  | customer picker |
| `/api/invoices?limit=25` | POS /pos/invoices | 0.9 | 10.2 | 25 |  | keyset |
| `/api/invoices?limit=25&from=2026-09-01&to=2026-09-26` | POS /pos/invoices (range) | 0.9 | 10.2 | 25 |  |  |
| `/api/invoices/000100` | POS /pos/invoices/:n | 0.9 | 1.0 | — |  | lines + void + returns + payments |
| `/api/returns?limit=25` | POS /pos/returns | 0.5 | 0.0 | 0 |  |  |
| `/api/drawer?limit=20` | POS /pos/drawer | 0.6 | 6.9 | 20 |  |  |
| `/api/drawer/1/z-report` | POS /pos/drawer/:id | 0.5 | 0.7 | — |  |  |
| `/api/payments?limit=20&offset=0` | Payments | 1.2 | 6.5 | 20 of 3577 |  |  |
| `/api/payments?limit=20&offset=0&q=smith` | Payments (search) | 2.7 | 0.0 | 0 of 0 |  |  |
| `/api/balances?limit=20&offset=0` | Payments | 4.7 | 3.5 | 20 of 330 |  |  |
| `/api/reports/summary?from=2026-09-26&to=2026-09-26` | Payments | 0.4 | 0.1 | — |  |  |
| `/api/customers?limit=25&offset=0` | Customers | 1.5 | 5.4 | 25 of 500 |  |  |
| `/api/customers?limit=25&offset=0&q=555` | Customers (search) | 2.0 | 5.4 | 25 of 500 |  |  |
| `/api/customers/1` | Customers /:id | 0.7 | 4.2 | — |  |  |
| `/api/invoices?customerId=1&limit=10` | Customers /:id | 0.6 | 2.1 | 5 |  |  |
| `/api/inventory?limit=50&offset=0&sort=name&dir=asc&group=material` | Inventory | 3.2 | 23.3 | 50 of 5000 |  | default: grouped by material |
| `/api/inventory?limit=50&offset=0&sort=name&dir=asc` | Inventory (no grouping) | 1.6 | 21.7 | 50 of 5000 |  |  |
| `/api/inventory?limit=50&offset=0&q=red&match=starts&sort=name&dir=asc&group=material` | Inventory (search) | 3.0 | 24.4 | 50 of 99 |  |  |
| `/api/inventory?limit=50&offset=0&sort=low&dir=asc&group=category` | Inventory (low first, by category) | 4.3 | 23.8 | 50 of 5000 |  |  |
| `/api/inventory?limit=50&offset=4950&sort=name&dir=asc&group=material` | Inventory (deep page) | 8.3 | 24.1 | 50 of 5000 |  | OFFSET cost |
| `/api/inventory/valuation` | Inventory | 1.7 | 0.5 | — |  |  |
| `/api/cycle-counts/next` | Inventory | 0.3 | 0.2 | — |  |  |
| `/api/categories?all=1&includeArchived=1` | Inventory | 0.3 | 1.7 | 8 | yes | config table |
| `/api/suppliers?all=1&includeArchived=1` | Inventory | 0.3 | 1.1 | 6 | yes | config table |
| `/api/inventory/1` | Inventory /:id | 0.5 | 0.4 | — |  |  |
| `/api/inventory/1/transactions?limit=25` | Inventory /:id | 0.4 | 1.2 | 4 |  |  |
| `/api/inventory/1/variances` | Inventory /:id | 0.5 | 0.0 | 0 |  |  |
| `/api/inventory/1/cost-history` | Inventory /:id | 0.3 | 0.0 | 0 |  |  |
| `/api/inventory/transactions?type=receipt&limit=10` | Inventory /receiving | 0.5 | 3.0 | 10 |  |  |
| `/api/cycle-counts?limit=25&offset=0` | Inventory /counts | 0.7 | 6.2 | 25 of 105 |  |  |
| `/api/cycle-counts/1` | Inventory /counts/:id | 0.4 | 0.3 | — |  |  |
| `/api/inventory/transactions?limit=50` | Inventory /adjustments | 0.8 | 14.8 | 50 |  |  |
| `/api/inventory/reorder?limit=50&offset=0` | Inventory /reorder | 1.8 | 14.0 | 50 of 308 |  |  |
| `/api/inventory/usage?limit=50&offset=0` | Inventory /reorder (usage) | 1.6 | 6.5 | 50 of 5000 |  |  |
| `/api/reports/summary?from=2026-09-01&to=2026-09-26` | Reports | 0.5 | 0.2 | — |  |  |
| `/api/reports/sales?from=2026-09-01&to=2026-09-26` | Reports | 0.6 | 0.4 | — |  | SQL sums (was: walk every invoice) |
| `/api/drawer?limit=10` | Reports | 0.5 | 3.5 | 10 |  |  |
| `/api/audit?limit=50` | Audit | 0.3 | 0.0 | 0 |  |  |
| `/api/approvals?limit=50` | Audit (approvals) | 0.4 | 0.0 | 0 |  |  |
| `/api/users?all=1` | Settings /users | 0.3 | 0.2 | 3 | yes | config table |
| `/api/materials?all=1&includeArchived=1` | Settings /materials | 0.5 | 4.1 | 14 | yes | config table |
| `/api/locations` | Settings /locations | 0.3 | 0.1 | 1 | yes | config table |
| `/api/settings/tax` | Settings / all | 0.3 | 0.0 | — |  |  |
| `/api/settings/inventory` | Settings / all | 0.3 | 0.1 | — |  |  |

Slowest: `/api/inventory?limit=50&offset=4950&sort=name&dir=asc&group=material` 8.3ms, `/api/jobs/board?limit=20&q=decal` 5.8ms, `/api/jobs/board?limit=20` 5.5ms, `/api/balances?limit=20&offset=0` 4.7ms, `/api/balances?limit=5` 4.4ms
Biggest: `/api/jobs/board?limit=20` 63KB, `/api/jobs/board?limit=20&q=decal` 35KB, `/api/inventory?limit=50&offset=0&q=red&match=starts&sort=name&dir=asc&group=material` 24KB, `/api/inventory?limit=50&offset=4950&sort=name&dir=asc&group=material` 24KB, `/api/inventory?limit=50&offset=0&sort=low&dir=asc&group=category` 24KB
