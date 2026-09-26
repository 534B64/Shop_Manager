// Runtime smoke test. Boots the REAL API (server/app.ts) on a throwaway SQLite
// file, runs migrations, listens on a test port, and exercises the key flows
// over real HTTP — health, first-run setup + sessions (ADR 0004), the Phase 8
// stock check, the cash drawer rule, and job balance + invoicing. Prints PASS/FAIL per check and exits non-zero on any failure.
// Run via: npx tsx batch/smoke.ts   (invoked by 7-Runtime-Test.bat)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `dperp-smoke-${Date.now()}.db`);
process.env.DB_PATH = dbFile;            // set BEFORE importing the db/app modules
const PORT = Number(process.env.SMOKE_PORT ?? 3987);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? `  (${extra})` : ''}`); }
}
const json = async (res: { json: () => Promise<unknown> }) => res.json() as Promise<any>;
// Session token from first-run setup; every /api call after that carries it.
let token = '';
const auth = () => (token ? { authorization: `Bearer ${token}` } : {});
const post = (url: string, body: unknown) =>
  fetch(`${BASE}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth() }, body: JSON.stringify(body) });
const getJ = (url: string) => fetch(`${BASE}${url}`, { headers: auth() }).then(json);

const { buildApp } = await import('../server/app.js');
const app = await buildApp();
await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`\nBooted API on ${BASE}`);
console.log(`Throwaway DB: ${dbFile}\n`);

try {
  // --- Boot + health ---
  const health = await getJ('/api/health');
  check('GET /api/health → ok', health.ok === true);

  // --- Auth (Phase 1a, ADR 0004): locked without a session, first-run setup ---
  const locked = await fetch(`${BASE}/api/jobs`);
  check('GET /api/jobs without a session → 401', locked.status === 401);
  const status = await getJ('/api/auth/status');
  check('GET /api/auth/status on a fresh DB → needsSetup', status.needsSetup === true);
  const setup = await json(await post('/api/auth/setup', { name: 'Smoke Admin', pin: '1234' }));
  token = setup.token ?? '';
  check('POST /api/auth/setup → admin session', !!token && setup.user?.role === 'admin');
  const me = await getJ('/api/auth/me');
  check('GET /api/auth/me → the admin', me.user?.name === 'Smoke Admin');

  // --- Phase 8: roll material + color + SKUs + stock check ---
  const mat = await json(await post('/api/materials', {
    name: `Smoke 651 ${Date.now()}`, unit: 'sqft', costPerUnitCents: 100,
    priceMode: 'per_sqft', rateCents: 600, usesRoll: true,
  }));
  check('POST /api/materials (roll) → created', !!mat.id);

  const colorRes = await post(`/api/materials/${mat.id}/colors`, { name: 'Red' });
  check('POST material color → 201', colorRes.status === 201);

  const u = await getJ(`/api/stock-check?materialId=${mat.id}&color=Red&widthIn=10&heightIn=20`);
  check('stock-check with no SKUs → unknown (no false alarm)', u.state === 'unknown');

  const sku24 = await json(await post('/api/roll-skus', { materialId: mat.id, color: 'Red', nominalWidthIn: 24, count: 5 }));
  check('POST roll SKU 24in → created', !!sku24.id);

  const sub = await getJ(`/api/stock-check?materialId=${mat.id}&color=Red&widthIn=10&heightIn=20`);
  check('stock-check (10x20, only 24 in stock) → suboptimal, use 24', sub.state === 'suboptimal' && sub.useWidth === 24, JSON.stringify(sub));

  await post('/api/roll-skus', { materialId: mat.id, color: 'Red', nominalWidthIn: 15, count: 3 });
  const inStock = await getJ(`/api/stock-check?materialId=${mat.id}&color=Red&widthIn=10&heightIn=20`);
  check('stock-check after adding 15in → in_stock, use 15', inStock.state === 'in_stock' && inStock.useWidth === 15, JSON.stringify(inStock));

  const other = await getJ(`/api/stock-check?materialId=${mat.id}&color=Green&widthIn=10&heightIn=20`);
  check('stock-check for an unstocked color → unknown', other.state === 'unknown');

  // --- Jobs + balance math (Phase 7) ---
  const clientRef = (globalThis.crypto?.randomUUID?.() ?? `smoke-${Date.now()}-${Math.random()}`);
  const job = await json(await post('/api/jobs', {
    clientRef, type: 'decal', title: 'Smoke job', status: 'acknowledged',
    finalPriceCents: 10000, newCustomer: { name: 'Smoke Co', email: 'smoke@example.com' },
  }));
  check('POST /api/jobs → created with 9-digit PO', !!job.id && /^\d{9}$/.test(job.po ?? ''), job.po);

  const bals = await getJ('/api/balances');
  const owed = bals.find((b: any) => b.jobId === job.id)?.owedCents;
  check('GET /api/balances → owes 10000', owed === 10000);

  // Cash needs an open drawer (Phase 3, ADR 0007).
  const noDrawer = await post('/api/payments', { clientRef: `${clientRef}-early`, jobId: job.id, amountCents: 100, method: 'cash' });
  check('cash with no drawer open → 409', noDrawer.status === 409);
  const drawer = await post('/api/drawer/open', { openingFloatCents: 10000 });
  check('POST /api/drawer/open → 201', drawer.status === 201);
  const payRes = await post('/api/payments', { clientRef: `${clientRef}-pay`, jobId: job.id, amountCents: 10000, method: 'cash' });
  const pay = await json(payRes);
  check('full cash payment → 201 + invoice 000001', payRes.status === 201 && pay.invoice?.numberDisplay === '000001', JSON.stringify(pay));
  const bals2 = await getJ('/api/balances');
  check('after full payment → drops off the owed list', !bals2.some((b: any) => b.jobId === job.id));
} catch (err) {
  fail++;
  console.log(`\n  ERROR during smoke test: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await app.close();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
}

console.log(`\n${fail === 0 ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
