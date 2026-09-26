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
import { requireSafePerfDb, refuseProductionDb } from '../server/db/perf-guard.js';

requireSafePerfDb('perf:baseline');
await refuseProductionDb('perf:baseline');

const RUNS = 5;

interface Probe {
  page: string;
  url: string;
  /** True when the handler returns a whole table with no LIMIT/paging. */
  unpaginated?: boolean;
  /** Free-form note shown in the table (caps, in-memory filtering, etc.). */
  note?: string;
}

// Every page's real first-load URLs (wave 2 pages, as src/ fetches them). The
// few "unpaginated" rows are small configuration tables (materials, categories,
// suppliers, locations, users) — no page loads a big table whole any more.
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;
const midnight = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
const PROBES: Probe[] = [
  // Dashboard
  { page: 'Dashboard', url: '/api/dashboard', note: 'low-stock top 20 + count in SQL' },
  { page: 'Dashboard', url: `/api/jobs/due-soon?days=7&limit=6&today=${today}` },
  { page: 'Dashboard', url: '/api/balances?limit=5', note: 'owed, largest first, SQL' },
  // Jobs
  { page: 'Quotes /quotes/new', url: '/api/jobs?limit=6&offset=0', note: 'recent jobs' },
  { page: 'Quotes /quotes/new', url: '/api/materials', unpaginated: true, note: 'config table' },
  { page: 'Quotes /quotes/:id', url: '/api/jobs/1', note: 'job + items + invoice + owed' },
  { page: 'Orders (board)', url: '/api/jobs/board?limit=20', note: '7 lanes × 20 + counts' },
  { page: 'Orders (board, search)', url: '/api/jobs/board?limit=20&q=decal' },
  { page: 'Orders (list)', url: '/api/jobs?limit=25&offset=0' },
  { page: 'Orders (list, no hit)', url: '/api/jobs?limit=25&offset=0&q=zzzz-nohit', note: 'worst case: scans every job' },
  { page: 'Quick Order', url: `/api/reports/summary?from=${encodeURIComponent(midnight)}`, note: 'today total, SQL range' },
  { page: 'Quick Order', url: '/api/payments?limit=12&offset=0' },
  { page: 'Quick Order', url: '/api/customers?q=Walk-in&limit=10&offset=0' },
  { page: 'Quick Order / POS', url: '/api/inventory?limit=8&offset=0&q=red', note: 'stock picker' },
  // POS
  { page: 'POS /pos', url: '/api/drawer/current' },
  { page: 'POS /pos', url: '/api/customers?q=smi&limit=10&offset=0', note: 'customer picker' },
  { page: 'POS /pos/invoices', url: '/api/invoices?limit=25', note: 'keyset' },
  { page: 'POS /pos/invoices (range)', url: `/api/invoices?limit=25&from=${monthStart}&to=${today}` },
  { page: 'POS /pos/invoices/:n', url: '/api/invoices/000100', note: 'lines + void + returns + payments' },
  { page: 'POS /pos/returns', url: '/api/returns?limit=25' },
  { page: 'POS /pos/drawer', url: '/api/drawer?limit=20' },
  { page: 'POS /pos/drawer/:id', url: '/api/drawer/1/z-report' },
  { page: 'Payments', url: '/api/payments?limit=20&offset=0' },
  { page: 'Payments (search)', url: '/api/payments?limit=20&offset=0&q=smith' },
  { page: 'Payments', url: '/api/balances?limit=20&offset=0' },
  { page: 'Payments', url: `/api/reports/summary?from=${today}&to=${today}` },
  // Customers
  { page: 'Customers', url: '/api/customers?limit=25&offset=0' },
  { page: 'Customers (search)', url: '/api/customers?limit=25&offset=0&q=555' },
  { page: 'Customers /:id', url: '/api/customers/1' },
  { page: 'Customers /:id', url: '/api/invoices?customerId=1&limit=10' },
  // Inventory
  { page: 'Inventory', url: '/api/inventory?limit=50&offset=0&sort=name&dir=asc&group=material', note: 'default: grouped by material' },
  { page: 'Inventory (no grouping)', url: '/api/inventory?limit=50&offset=0&sort=name&dir=asc' },
  { page: 'Inventory (search)', url: '/api/inventory?limit=50&offset=0&q=red&match=starts&sort=name&dir=asc&group=material' },
  { page: 'Inventory (low first, by category)', url: '/api/inventory?limit=50&offset=0&sort=low&dir=asc&group=category' },
  { page: 'Inventory (deep page)', url: '/api/inventory?limit=50&offset=4950&sort=name&dir=asc&group=material', note: 'OFFSET cost' },
  { page: 'Inventory', url: '/api/inventory/valuation' },
  { page: 'Inventory', url: '/api/cycle-counts/next' },
  { page: 'Inventory', url: '/api/categories?all=1&includeArchived=1', unpaginated: true, note: 'config table' },
  { page: 'Inventory', url: '/api/suppliers?all=1&includeArchived=1', unpaginated: true, note: 'config table' },
  { page: 'Inventory /:id', url: '/api/inventory/1' },
  { page: 'Inventory /:id', url: '/api/inventory/1/transactions?limit=25' },
  { page: 'Inventory /:id', url: '/api/inventory/1/variances' },
  { page: 'Inventory /:id', url: '/api/inventory/1/cost-history' },
  { page: 'Inventory /receiving', url: '/api/inventory/transactions?type=receipt&limit=10' },
  { page: 'Inventory /counts', url: '/api/cycle-counts?limit=25&offset=0' },
  { page: 'Inventory /counts/:id', url: '/api/cycle-counts/1' },
  { page: 'Inventory /adjustments', url: '/api/inventory/transactions?limit=50' },
  { page: 'Inventory /reorder', url: '/api/inventory/reorder?limit=50&offset=0' },
  { page: 'Inventory /reorder (usage)', url: '/api/inventory/usage?limit=50&offset=0' },
  // Reports, audit, settings
  { page: 'Reports', url: `/api/reports/summary?from=${monthStart}&to=${today}` },
  { page: 'Reports', url: `/api/reports/sales?from=${monthStart}&to=${today}`, note: 'SQL sums (was: walk every invoice)' },
  { page: 'Reports', url: '/api/drawer?limit=10' },
  { page: 'Audit', url: '/api/audit?limit=50' },
  { page: 'Audit (approvals)', url: '/api/approvals?limit=50' },
  { page: 'Settings /users', url: '/api/users?all=1', unpaginated: true, note: 'config table' },
  { page: 'Settings /materials', url: '/api/materials?all=1&includeArchived=1', unpaginated: true, note: 'config table' },
  { page: 'Settings /locations', url: '/api/locations', unpaginated: true, note: 'config table' },
  { page: 'Settings / all', url: '/api/settings/tax' },
  { page: 'Settings / all', url: '/api/settings/inventory' },
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
      else if (Array.isArray(j?.rows)) rows = j.total != null ? `${j.rows.length} of ${j.total}` : String(j.rows.length);
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
