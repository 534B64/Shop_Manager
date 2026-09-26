// Baseline endpoint timing. Builds the real app (server/app.ts — same factory as
// server/integration.test.ts) against DB_PATH and times every GET a page loads
// on first view, in-process via app.inject (no network, so this measures
// handler + DB + serialization, not wifi). Warm-up run discarded, then the
// median of 5. Prints a markdown table to stdout.
//
// Usage:  DB_PATH=/tmp/perf-test.db npm run perf:baseline
//         (seed it first: DB_PATH=/tmp/perf-test.db npm run db:seed:perf)
//
// Refuses to run unless DB_PATH is set explicitly and is not "dp-erp.db".
import { requireSafePerfDb } from '../server/db/perf-guard.js';

requireSafePerfDb('perf:baseline');

const RUNS = 5;

interface Probe {
  page: string;
  url: string;
  /** True when the handler returns a whole table with no LIMIT/paging. */
  unpaginated?: boolean;
  /** Free-form note shown in the table (caps, in-memory filtering, etc.). */
  note?: string;
}

// Paths verified against server/modules/*/routes.ts and the client fetches in src/.
const PROBES: Probe[] = [
  { page: 'Dashboard', url: '/api/dashboard', unpaginated: true, note: 'all inventory rows, filtered in memory' },
  { page: 'Dashboard / Orders', url: '/api/jobs?limit=200', note: 'LIMIT 200 (server cap 500)' },
  { page: 'Quotes', url: '/api/jobs?limit=50', note: 'LIMIT 50' },
  { page: 'Quotes (search)', url: '/api/jobs?limit=50&q=decal', note: 'LIKE over title/PO/tags/file/customer in SQL, before LIMIT (Phase 1b)' },
  { page: 'Quotes (search, no hit)', url: '/api/jobs?limit=50&q=zzzz-nohit', note: 'worst case: scans every job' },
  { page: '(max page size)', url: '/api/jobs?limit=500', note: 'server cap' },
  { page: 'Orders (detail)', url: '/api/jobs/1', note: 'one job + items' },
  { page: 'Customers', url: '/api/customers', note: 'LIMIT 200; group-by over all jobs' },
  { page: 'Quick Order', url: '/api/customers?q=Walk-in', note: 'loads up to 2000 rows, filters in memory' },
  { page: 'Inventory', url: '/api/inventory', unpaginated: true },
  { page: 'Inventory', url: '/api/inventory/reorder', unpaginated: true, note: 'full scan + in-memory sort' },
  { page: 'Inventory', url: '/api/inventory/usage', unpaginated: true, note: 'full scan + in-memory sort' },
  { page: 'Inventory', url: '/api/inventory/valuation', unpaginated: true, note: 'full scan, aggregated object' },
  { page: 'Inventory (item log)', url: '/api/inventory/1/history', note: 'LIMIT 50' },
  { page: 'Inventory / Quotes', url: '/api/roll-skus', unpaginated: true },
  { page: 'Inventory (cycle count)', url: '/api/cycle-counts/next' },
  { page: 'Materials / Quotes', url: '/api/materials', unpaginated: true },
  { page: 'Materials (admin)', url: '/api/materials?all=1', unpaginated: true },
  { page: 'Taxonomy / Inventory', url: '/api/categories', unpaginated: true },
  { page: 'Taxonomy / Inventory', url: '/api/suppliers', unpaginated: true },
  { page: 'Payments', url: '/api/payments', note: 'LIMIT 100' },
  { page: 'Payments', url: '/api/balances', unpaginated: true, note: 'every job, filtered to owing in memory' },
  { page: 'Reports', url: '/api/reports/summary', unpaginated: true, note: 'reads ALL payments, filters in memory' },
  { page: 'Reports (CSV)', url: '/api/reports/payments.csv', unpaginated: true },
  { page: 'Reports (CSV)', url: '/api/reports/jobs.csv', unpaginated: true },
  { page: 'Invoices (Phase 3)', url: '/api/invoices?limit=50', note: 'keyset page, void join + returned subquery' },
  { page: 'Invoices (Phase 3)', url: '/api/invoices?limit=50&from=2026-01-01&to=2026-03-31', note: 'date-range filter' },
  { page: 'Invoices (Phase 3)', url: '/api/invoices?number=000100', note: 'lookup by number (unique index)' },
  { page: 'Invoice detail (Phase 3)', url: '/api/invoices/000100', note: 'lines + void + returns + payments' },
  { page: 'Returns (Phase 3)', url: '/api/returns?limit=50' },
  { page: 'Drawer (Phase 3)', url: '/api/drawer?limit=50', note: 'session history' },
  { page: 'Drawer (Phase 3)', url: '/api/drawer/current' },
  { page: 'Drawer (Phase 3)', url: '/api/drawer/1/z-report', note: 'stored Z-report of a closed session' },
  { page: 'Settings / all', url: '/api/settings/tax' },
  { page: 'Settings / all', url: '/api/settings/inventory' },
  { page: 'Sign-in', url: '/api/users' },
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const { buildApp } = await import('../server/app.js');
const app = await buildApp();
// Every /api route needs a session (ADR 0004) — sign in as the first active admin.
const { db } = await import('../server/db/index.js');
const { users } = await import('../server/db/schema/index.js');
const { createSession } = await import('../server/modules/auth/index.js');
const admin = (await db.select().from(users)).find((u) => u.active && u.role === 'admin');
if (!admin) { console.error('perf:baseline: no active admin in this DB — seed it with db:seed:perf first.'); process.exit(1); }
const authHeader = { authorization: `Bearer ${await createSession(admin.id)}` };
await app.ready();

interface Result { probe: Probe; ms: number; kb: number; rows: string; status: number }
const results: Result[] = [];

for (const probe of PROBES) {
  const run = async () => {
    const t = performance.now();
    const res = await app.inject({ method: 'GET', url: probe.url, headers: authHeader });
    return { ms: performance.now() - t, res };
  };
  await run(); // warm-up (statement cache, JIT) — not counted
  const times: number[] = [];
  let last = (await run()).res;
  for (let i = 0; i < RUNS; i++) {
    const r = await run();
    times.push(r.ms);
    last = r.res;
  }
  const body = last.rawPayload;
  let rows = '—';
  if (probe.url.endsWith('.csv')) {
    rows = String(Math.max(body.toString('utf8').split('\n').filter(Boolean).length - 1, 0));
  } else {
    try {
      const j = JSON.parse(body.toString('utf8'));
      if (Array.isArray(j)) rows = String(j.length);
    } catch { /* not JSON */ }
  }
  results.push({ probe, ms: median(times), kb: body.length / 1024, rows, status: last.statusCode });
}
await app.close();

const dbPath = process.env.DB_PATH;
console.log(`Baseline against \`${dbPath}\` — median of ${RUNS} runs (after 1 warm-up), app.inject, in-process.\n`);
console.log('| Endpoint | Page | Median ms | Size KB | Rows | Unpaginated | Notes |');
console.log('|---|---|---:|---:|---:|:---:|---|');
for (const r of results) {
  const flag = r.status >= 400 ? ` **HTTP ${r.status}**` : '';
  console.log(`| \`${r.probe.url}\` | ${r.probe.page} | ${r.ms.toFixed(1)} | ${r.kb.toFixed(1)} | ${r.rows} | ${r.probe.unpaginated ? 'yes' : ''} | ${(r.probe.note ?? '') + flag} |`);
}
const byMs = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);
const byKb = [...results].sort((a, b) => b.kb - a.kb).slice(0, 5);
console.log('\nSlowest: ' + byMs.map((r) => `\`${r.probe.url}\` ${r.ms.toFixed(1)}ms`).join(', '));
console.log('Biggest: ' + byKb.map((r) => `\`${r.probe.url}\` ${r.kb.toFixed(0)}KB`).join(', '));
process.exit(0);
