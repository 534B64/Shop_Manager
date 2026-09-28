// Integration tests for the highest-value flows: job creation (incl. idempotency
// + PO/customer side-effects), status-transition rules, and payment/void/refund
// balance math. Each run uses its own throwaway SQLite file, migrated fresh.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { TestUser } from './test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
// Every /api route needs a session (ADR 0004). `inject` signs requests as the
// admin "Josiah" unless the test passes its own headers.
let admin: TestUser;
const inject = (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { authorization: `Bearer ${admin.token}`, ...(opts.headers ?? {}) } });

// crypto.randomUUID() is 36 chars — satisfies the clientRef 8–64 length rule.
const ref = () => crypto.randomUUID();

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-it-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DB_PATH = dbFile; // set BEFORE importing the db singleton
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin', { name: 'Josiah', pin: '1234' });
  // Cash needs an open drawer (Phase 3, ADR 0007).
  await app.inject({ method: 'POST', url: '/api/drawer/open', headers: admin.headers, payload: { openingFloatCents: 0 } });
});

afterAll(async () => {
  await app.close();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

async function createJob(over: Record<string, unknown> = {}) {
  const res = await inject({
    method: 'POST', url: '/api/jobs',
    payload: {
      clientRef: ref(), type: 'decal', title: 'Test decal',
      status: 'acknowledged', finalPriceCents: 10000,
      newCustomer: { name: 'Acme Co', phone: '(555) 010 - 2030', email: 'orders@acme.example' },
      ...over,
    },
  });
  return res;
}

describe('job creation', () => {
  it('creates a job, a customer, and a PO; returns 201', async () => {
    const res = await createJob();
    expect(res.statusCode).toBe(201);
    const job = res.json();
    expect(job.id).toBeGreaterThan(0);
    expect(job.customerName).toBe('Acme Co');
    expect(job.po).toMatch(/^\d{9}$/); // MMDDYY + 3-digit sequence
    expect(job.finalPriceCents).toBe(10000);
    expect(job.status).toBe('acknowledged');
  });

  it('is idempotent on clientRef — a retry returns the same job, not a duplicate', async () => {
    const clientRef = ref();
    const first = await createJob({ clientRef });
    const second = await createJob({ clientRef });
    expect(first.json().id).toBe(second.json().id);
    expect(second.statusCode).not.toBe(201); // existing row returned, not re-created
  });

  it('rejects a job with no finalPriceCents', async () => {
    const res = await inject({
      method: 'POST', url: '/api/jobs',
      payload: { clientRef: ref(), type: 'decal', title: 'x', status: 'acknowledged' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a new customer without an email (2026-07-02 rule)', async () => {
    const res = await createJob({ newCustomer: { name: 'No Email Co', phone: '(555) 010 - 2030' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('customer creation email rule', () => {
  it('rejects POST /api/customers without a valid email', async () => {
    const res = await inject({ method: 'POST', url: '/api/customers', payload: { name: 'Emailless Co' } });
    expect(res.statusCode).toBe(400);
    const bad = await inject({ method: 'POST', url: '/api/customers', payload: { name: 'Typo Co', email: 'not-an-email' } });
    expect(bad.statusCode).toBe(400);
  });

  it('accepts a customer with an email', async () => {
    const res = await inject({ method: 'POST', url: '/api/customers', payload: { name: 'Mailed Co', email: 'shop@mailed.example' } });
    expect(res.statusCode).toBe(201);
  });

  it('exempts a customer named Walk-in from the email requirement', async () => {
    const res = await inject({ method: 'POST', url: '/api/customers',
      payload: { name: 'Walk-in', notes: 'Generic walk-in counter customer' } });
    expect(res.statusCode).toBe(201);
  });
});

describe('status transitions', () => {
  it('allows one step forward along the simple path', async () => {
    const job = (await createJob()).json();
    const res = await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'in_progress' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('in_progress');
  });

  it('rejects a skip-ahead transition (acknowledged → done)', async () => {
    const job = (await createJob()).json();
    const res = await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'done' } });
    expect(res.statusCode).toBe(409);
  });

  it('allows a step backward', async () => {
    const job = (await createJob()).json();
    await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'in_progress' } });
    const back = await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'acknowledged' } });
    expect(back.statusCode).toBe(200);
    expect(back.json().status).toBe('acknowledged');
  });

  it('blocks pickup with a balance due, then allows it with the manager override', async () => {
    const job = (await createJob()).json();
    for (const s of ['in_progress', 'done']) {
      await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: s } });
    }
    const blocked = await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'picked_up' } });
    expect(blocked.statusCode).toBe(402); // balance due, no override

    const overridden = await inject({
      method: 'PUT', url: `/api/jobs/${job.id}/status`,
      payload: { status: 'picked_up', override: true },
    });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json().status).toBe('picked_up');
  });
});

describe('payment / void / refund balance math', () => {
  async function owedFor(jobId: number): Promise<number | undefined> {
    const balances = (await inject({ method: 'GET', url: '/api/balances' })).json() as { jobId: number; owedCents: number }[];
    return balances.find((b) => b.jobId === jobId)?.owedCents;
  }

  it('reduces the balance by a payment and clears it when paid in full', async () => {
    const job = (await createJob()).json(); // owes 10000
    expect(await owedFor(job.id)).toBe(10000);

    await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 4000, method: 'cash' } });
    expect(await owedFor(job.id)).toBe(6000);

    await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 6000, method: 'cash' } });
    expect(await owedFor(job.id)).toBeUndefined(); // fully paid → drops off the owed list
  });

  it('restores the balance when a payment is voided (row kept, not deleted)', async () => {
    const job = (await createJob()).json();
    const pay = await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 10000, method: 'cash' } });
    expect(await owedFor(job.id)).toBeUndefined();

    const paymentId = pay.json().id;
    const voided = await inject({ method: 'POST', url: `/api/payments/${paymentId}/void`, payload: { reason: 'rang up wrong' } });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().voidedAt).toBeTruthy();
    expect(await owedFor(job.id)).toBe(10000); // balance back

    // The voided row still exists on the books.
    const list = (await inject({ method: 'GET', url: `/api/payments?jobId=${job.id}` })).json() as unknown[];
    expect(list.length).toBe(1);
  });

  it('treats a refund as money back out — it raises the balance owed', async () => {
    const job = (await createJob()).json();
    await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 10000, method: 'cash' } });
    expect(await owedFor(job.id)).toBeUndefined();

    await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 3000, method: 'cash', kind: 'refund' } });
    expect(await owedFor(job.id)).toBe(3000); // price 10000 − 10000 paid + 3000 refunded
  });

  it('is idempotent on a payment clientRef', async () => {
    const job = (await createJob()).json();
    const clientRef = ref();
    const a = await inject({ method: 'POST', url: '/api/payments', payload: { clientRef, jobId: job.id, amountCents: 2500, method: 'cash' } });
    const b = await inject({ method: 'POST', url: '/api/payments', payload: { clientRef, jobId: job.id, amountCents: 2500, method: 'cash' } });
    expect(a.json().id).toBe(b.json().id);
    expect(await owedFor(job.id)).toBe(7500); // counted once
  });
});

describe('Phase 8: roll SKUs + advisory stock check', () => {
  // Roll material with its admin color list pre-registered (SKU colors must be
  // on the list since the Phase 11 integrity fix).
  async function rollMaterial(colors: string[] = ['Red', 'Blue', 'Green']) {
    const res = await inject({
      method: 'POST', url: '/api/materials',
      payload: { name: `651 Vinyl ${Math.random().toString(36).slice(2, 6)}`, unit: 'sqft', costPerUnitCents: 100, priceMode: 'per_sqft', rateCents: 600, usesRoll: true },
    });
    const m = res.json();
    for (const name of colors) {
      await inject({ method: 'POST', url: `/api/materials/${m.id}/colors`, payload: { name } });
    }
    return m;
  }
  async function stockCheck(materialId: number, color: string, widthIn: number, heightIn: number) {
    const res = await inject({ method: 'GET', url: `/api/stock-check?materialId=${materialId}&color=${encodeURIComponent(color)}&widthIn=${widthIn}&heightIn=${heightIn}` });
    return res.json();
  }

  it('manages a material color list and rejects duplicates', async () => {
    const m = await rollMaterial([]); // start with an empty color list
    const add = await inject({ method: 'POST', url: `/api/materials/${m.id}/colors`, payload: { name: 'Red' } });
    expect(add.statusCode).toBe(201);
    const dup = await inject({ method: 'POST', url: `/api/materials/${m.id}/colors`, payload: { name: 'red' } });
    expect(dup.statusCode).toBe(409);
    const list = (await inject({ method: 'GET', url: `/api/materials/${m.id}/colors` })).json() as unknown[];
    expect(list.length).toBe(1);
  });

  it('refuses roll SKUs on non-roll materials', async () => {
    const flat = (await inject({ method: 'POST', url: '/api/materials', payload: { name: 'Magnet', unit: 'each', costPerUnitCents: 100, priceMode: 'flat', rateCents: 6500 } })).json();
    const res = await inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: flat.id, color: 'Red', nominalWidthIn: 24 } });
    expect(res.statusCode).toBe(400);
  });

  it('shows nothing (unknown) when no SKUs are set up — no false alarm', async () => {
    const m = await rollMaterial();
    const r = await stockCheck(m.id, 'Red', 10, 20);
    expect(r.state).toBe('unknown');
    expect(r.message).toBeNull();
  });

  it('walks in_stock → suboptimal → out_of_stock as stock changes', async () => {
    const m = await rollMaterial();
    const sku24 = (await inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 24, count: 5 } })).json();

    // Part 10×20 → optimal 15 (none in stock); 24 fits → suboptimal, use 24.
    let r = await stockCheck(m.id, 'Red', 10, 20);
    expect(r.state).toBe('suboptimal');
    expect(r.useWidth).toBe(24);

    // Add the optimal 15" roll → in_stock.
    const sku15 = (await inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 15, count: 3 } })).json();
    r = await stockCheck(m.id, 'Red', 10, 20);
    expect(r.state).toBe('in_stock');
    expect(r.useWidth).toBe(15);

    // Deplete both to zero → out_of_stock (red).
    await inject({ method: 'POST', url: `/api/inventory/${sku15.id}/adjust`, payload: { delta: -3, reason: 'used' } });
    await inject({ method: 'POST', url: `/api/inventory/${sku24.id}/adjust`, payload: { delta: -5, reason: 'used' } });
    r = await stockCheck(m.id, 'Red', 10, 20);
    expect(r.state).toBe('out_of_stock');
    expect(r.message).toMatch(/out of stock/i);
  });

  it('rejects a duplicate SKU (same material + color + width)', async () => {
    const m = await rollMaterial();
    await inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Blue', nominalWidthIn: 30, count: 1 } });
    const dup = await inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'blue', nominalWidthIn: 30, count: 9 } });
    expect(dup.statusCode).toBe(409);
  });

  it('is color-specific — a different color is independent', async () => {
    const m = await rollMaterial();
    await inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 24, count: 5 } });
    const r = await stockCheck(m.id, 'Green', 10, 20); // no Green SKU at all
    expect(r.state).toBe('unknown');
  });

  // ---- Phase 11 integrity: SKU colors must come from the material's list ----
  it('rejects a SKU whose color is not on the material color list (typo guard)', async () => {
    const m = await rollMaterial(['Red']);
    const typo = await inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Rde', nominalWidthIn: 24 } });
    expect(typo.statusCode).toBe(400);
    expect(typo.json().error).toMatch(/not in this material's color list/i);
  });

  it('rejects a SKU color edit that leaves the color list, allows one that stays on it', async () => {
    const m = await rollMaterial(['Red', 'Blue']);
    const sku = (await inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 24 } })).json();
    const bad = await inject({ method: 'PUT', url: `/api/inventory/${sku.id}`, payload: { color: 'Crimson' } });
    expect(bad.statusCode).toBe(400);
    const ok = await inject({ method: 'PUT', url: `/api/inventory/${sku.id}`, payload: { color: 'Blue' } });
    expect(ok.statusCode).toBe(200);
  });

  it('answers every line of a multi-item quote in one batch stock-check call', async () => {
    const m = await rollMaterial();
    await inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 15, count: 2 } });
    const res = await inject({ method: 'POST', url: '/api/stock-check/batch', payload: { lines: [
      { materialId: m.id, color: 'Red', widthIn: 10, heightIn: 20 },   // 15″ optimal, in stock
      { materialId: m.id, color: 'Green', widthIn: 10, heightIn: 20 }, // no Green SKUs → unknown
      { materialId: null, color: '' },                                  // line without a roll material
    ] } });
    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results.map((r: { state: string }) => r.state)).toEqual(['in_stock', 'unknown', 'unknown']);
    expect(results[0].useWidth).toBe(15);
  });
});

describe('Phase 11: server-side quote-math verification', () => {
  async function flatMaterial(rateCents = 6500) {
    return (await inject({ method: 'POST', url: '/api/materials',
      payload: { name: `Magnet ${Math.random().toString(36).slice(2, 6)}`, unit: 'each', costPerUnitCents: 1000, priceMode: 'flat', rateCents } })).json();
  }

  it('stores server-recomputed suggested + total and flags a stale client', async () => {
    const m = await flatMaterial(); // flat $65, default tax 8.25%
    const res = await createJob({
      materialId: m.id, quantity: 1,
      finalPriceCents: 6500,
      suggestedPriceCents: 9999, // wrong on purpose (stale tab)
      totalCents: 6500,          // wrong: forgot tax
      taxable: true,
    });
    const job = res.json();
    expect(res.statusCode).toBe(201);          // never blocks the save
    expect(job.priceCheck.verified).toBe(false);
    expect(job.suggestedPriceCents).toBe(6500); // server's answer wins
    expect(job.totalCents).toBe(6500 + Math.round(6500 * 8.25 / 100)); // 7036
  });

  it('verifies clean when the client math matches', async () => {
    const m = await flatMaterial();
    const total = 6500 + Math.round(6500 * 8.25 / 100);
    const res = await createJob({
      materialId: m.id, quantity: 1,
      finalPriceCents: 6500, suggestedPriceCents: 6500, totalCents: total, taxable: true,
    });
    expect(res.json().priceCheck.verified).toBe(true);
    expect(res.json().totalCents).toBe(total);
  });

  it('leaves totalCents null for callers that never derived one', async () => {
    const res = await createJob({ finalPriceCents: 10000 }); // no totalCents sent
    expect(res.json().totalCents).toBeNull(); // balance falls back to finalPriceCents
  });

  it('re-verifies on edit and returns the corrected total', async () => {
    const m = await flatMaterial();
    const job = (await createJob({ materialId: m.id, finalPriceCents: 6500, totalCents: 7036, taxable: true })).json();
    const res = await inject({ method: 'PUT', url: `/api/jobs/${job.id}`, payload: {
      finalPriceCents: 10000, taxable: true, totalCents: 9999, // stale client total
    } });
    expect(res.statusCode).toBe(200);
    expect(res.json().priceCheck.verified).toBe(false);
    expect(res.json().totalCents).toBe(10000 + Math.round(10000 * 8.25 / 100)); // 10825
  });
});

describe('Phase 11: cycle-count auto-reschedule + inventory adjust routes', () => {
  it('completing a count always queues the next one (default +7 days)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cc = (await inject({ method: 'POST', url: '/api/cycle-counts', payload: { scheduledFor: today } })).json();
    const done = await inject({ method: 'POST', url: `/api/cycle-counts/${cc.id}/submit`, payload: { counts: [], post: true } });
    expect(done.statusCode).toBe(200);
    const expected = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    expect(done.json().nextScheduledFor).toBe(expected);
    const next = (await inject({ method: 'GET', url: '/api/cycle-counts/next' })).json();
    expect(next?.scheduledFor).toBe(expected);
    // Clean up the auto-created session so later runs of this suite start fresh.
    await inject({ method: 'POST', url: `/api/cycle-counts/${next.id}/submit`, payload: { counts: [], nextScheduledFor: '2099-01-01', post: true } });
  });

  it('adjusts a count with a reason and refuses to go below zero', async () => {
    const item = (await inject({ method: 'POST', url: '/api/inventory', payload: { name: `Blanks ${Math.random().toString(36).slice(2, 6)}`, count: 5 } })).json();
    const ok = await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: -3, reason: 'used' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().count).toBe(2);
    const under = await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: -5, reason: 'used' } });
    expect(under.statusCode).toBe(409);
  });
});

describe('Phase 11: unpaid-pickup override is attributable', () => {
  it('appends who approved the override to the job notes', async () => {
    const job = (await createJob()).json();
    for (const s of ['in_progress', 'done']) {
      await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: s } });
    }
    const res = await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`,
      payload: { status: 'picked_up', override: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().notes).toMatch(/manager override by Josiah/);
    expect(res.json().notes).toMatch(/balance due/);
  });
});

describe('Phase 11: design-file uploads are gone (fileRef only)', () => {
  it('has no upload endpoint anymore', async () => {
    const job = (await createJob()).json();
    const res = await inject({ method: 'POST', url: `/api/jobs/${job.id}/file`, payload: {} });
    expect(res.statusCode).toBe(404); // route no longer exists
  });
});

// ---- Inventory management pass (2026-07-07) ----

const uniq = () => Math.random().toString(36).slice(2, 8);

async function makeSupplier(over: Record<string, unknown> = {}) {
  return (await inject({ method: 'POST', url: '/api/suppliers',
    payload: { name: `Supplier ${uniq()}`, leadTimeDays: 5, ...over } })).json();
}
async function makeItem(over: Record<string, unknown> = {}) {
  return (await inject({ method: 'POST', url: '/api/inventory',
    payload: { name: `Item ${uniq()}`, count: 10, ...over } })).json();
}

describe('suppliers', () => {
  it('creates, rejects duplicate names (case-insensitive), and edits lead time', async () => {
    const s = await makeSupplier({ name: `Fellers ${uniq()}` });
    expect(s.leadTimeDays).toBe(5);
    const dup = await inject({ method: 'POST', url: '/api/suppliers', payload: { name: s.name.toUpperCase() } });
    expect(dup.statusCode).toBe(409);
    const upd = await inject({ method: 'PUT', url: `/api/suppliers/${s.id}`, payload: { leadTimeDays: 12 } });
    expect(upd.json().leadTimeDays).toBe(12);
  });

  it('delete archives (admin-only) even with receiving history; references and receipts stay', async () => {
    const used = await makeSupplier();
    const item = await makeItem({ supplierId: used.id });
    await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`,
      payload: { delta: 5, reason: 'received', unitCostCents: 250, supplierId: used.id } });

    const { createUserWithToken } = await import('./test-helpers.js');
    const manager = await createUserWithToken(app, 'manager');
    const notAdmin = await inject({ method: 'DELETE', url: `/api/suppliers/${used.id}`, payload: {}, headers: manager.headers });
    expect(notAdmin.statusCode).toBe(403); // archive is admin-only
    const ok = await inject({ method: 'DELETE', url: `/api/suppliers/${used.id}`, payload: {} });
    expect(ok.statusCode).toBe(200);

    const list = (await inject({ method: 'GET', url: '/api/suppliers?all=1' })).json() as { id: number }[];
    expect(list.some((s) => s.id === used.id)).toBe(false);
    const withArchived = (await inject({ method: 'GET', url: '/api/suppliers?all=1&includeArchived=1' })).json() as { id: number; archivedAt: string | null }[];
    expect(withArchived.find((s) => s.id === used.id)!.archivedAt).toBeTruthy();
    const items = (await inject({ method: 'GET', url: '/api/inventory' })).json() as { id: number; supplierId: number | null }[];
    expect(items.find((i) => i.id === item.id)!.supplierId).toBe(used.id); // reference kept
    const costs = (await inject({ method: 'GET', url: `/api/inventory/${item.id}/cost-history` })).json() as { supplierName: string }[];
    expect(costs[0].supplierName).toBe(used.name);

    const restored = await inject({ method: 'POST', url: `/api/suppliers/${used.id}/unarchive`, payload: {} });
    expect(restored.json().archivedAt).toBeNull();
  });
});

describe('receiving keeps a per-receipt cost history', () => {
  it('stores cost + supplier on each receipt and updates last cost paid', async () => {
    const s = await makeSupplier();
    const item = await makeItem({ count: 0 });
    await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`,
      payload: { delta: 10, reason: 'received', unitCostCents: 300, supplierId: s.id } });
    await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`,
      payload: { delta: 10, reason: 'received', unitCostCents: 350, supplierId: s.id } });

    const items = (await inject({ method: 'GET', url: '/api/inventory' })).json() as { id: number; count: number; lastCostCents: number }[];
    const fresh = items.find((i) => i.id === item.id)!;
    expect(fresh.count).toBe(20);
    expect(fresh.lastCostCents).toBe(350); // latest receipt wins

    const hist = (await inject({ method: 'GET', url: `/api/inventory/${item.id}/cost-history` })).json() as { unitCostCents: number; supplierName: string }[];
    expect(hist.map((h) => h.unitCostCents)).toEqual([300, 350]); // full trend retained
    expect(hist[0].supplierName).toBe(s.name);
  });
});

describe('cycle count v2: blind count, variance reasons, lock, snapshot', () => {
  async function openSession() {
    // The auto-reschedule keeps a pending session around from earlier tests —
    // reuse it (there is only ever one "next"), or create one if none.
    const next = (await inject({ method: 'GET', url: '/api/cycle-counts/next' })).json();
    if (next) return next;
    return (await inject({ method: 'POST', url: '/api/cycle-counts',
      payload: { scheduledFor: new Date().toISOString().slice(0, 10) } })).json();
  }

  it('demands a reason code for variances above threshold, then books them under it', async () => {
    const big = await makeItem({ count: 10, lastCostCents: 500 }); // → counted 4 = -60%
    const small = await makeItem({ count: 100 });                  // → counted 99 = -1%, 1 unit
    const cc = await openSession();

    const missing = await inject({ method: 'POST', url: `/api/cycle-counts/${cc.id}/submit`,
      payload: { counts: [{ itemId: big.id, counted: 4 }, { itemId: small.id, counted: 99 }] } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().items.map((i: { itemId: number }) => i.itemId)).toEqual([big.id]);

    const done = await inject({ method: 'POST', url: `/api/cycle-counts/${cc.id}/submit`,
      payload: { post: true, counts: [
        { itemId: big.id, counted: 4, reasonCode: 'production_use', note: 'banner job used it' },
        { itemId: small.id, counted: 99 },
      ] } });
    expect(done.statusCode).toBe(200);
    expect(done.json().itemsAdjusted).toBe(2);

    // Counts reset to the counted values.
    const items = (await inject({ method: 'GET', url: '/api/inventory' })).json() as { id: number; count: number }[];
    expect(items.find((i) => i.id === big.id)!.count).toBe(4);
    expect(items.find((i) => i.id === small.id)!.count).toBe(99);

    // Ledger: flagged variance books under its reason code with attribution;
    // small drift stays plain 'cycle_count'.
    const bigHist = (await inject({ method: 'GET', url: `/api/inventory/${big.id}/history` })).json() as { reason: string; createdBy: string }[];
    expect(bigHist[0].reason).toBe('production_use');
    expect(bigHist[0].createdBy).toBe('Josiah');
    const smallHist = (await inject({ method: 'GET', url: `/api/inventory/${small.id}/history` })).json() as { reason: string }[];
    expect(smallHist[0].reason).toBe('cycle_count');

    // Immutable snapshot behind the variance-trend view.
    const vari = (await inject({ method: 'GET', url: `/api/inventory/${big.id}/variances` })).json();
    expect(vari.rows.length).toBe(1);
    expect(vari.rows[0]).toMatchObject({ systemCount: 10, counted: 4, delta: -6, reasonCode: 'production_use', aboveThreshold: true });
    expect(vari.rows[0].impactCents).toBe(3000); // 6 × $5.00

    // Session locked (one-shot) and the next one auto-queued.
    const again = await inject({ method: 'POST', url: `/api/cycle-counts/${cc.id}/submit`,
      payload: { counts: [] } });
    expect(again.statusCode).toBe(409);
    const next = (await inject({ method: 'GET', url: '/api/cycle-counts/next' })).json();
    expect(next).not.toBeNull();

    // One count session is not enough for a usage rate — no invented numbers.
    const usage = (await inject({ method: 'GET', url: '/api/inventory/usage' })).json() as { id: number; avgDailyUse: number | null }[];
    expect(usage.find((u) => u.id === big.id)!.avgDailyUse).toBeNull();
  });
});

describe('needs-ordering view and valuation', () => {
  it('fills back to Max when set, includes supplier lead time', async () => {
    const s = await makeSupplier({ leadTimeDays: 9 });
    const low = await makeItem({ count: 2, lowStockThreshold: 5, reorderMaxQty: 20, supplierId: s.id });
    const rows = (await inject({ method: 'GET', url: '/api/inventory/reorder' })).json() as
      { id: number; suggestedQty: number; supplierName: string; leadTimeDays: number; daysUntilStockout: number | null }[];
    const mine = rows.find((r) => r.id === low.id)!;
    expect(mine.suggestedQty).toBe(18); // 20 − 2
    expect(mine.supplierName).toBe(s.name);
    expect(mine.leadTimeDays).toBe(9);
    expect(mine.daysUntilStockout).toBeNull(); // no usage rate yet
  });

  it('values stock as count ÷ factor × last cost per purchase unit', async () => {
    const catName = `Valuation ${uniq()}`;
    const cat = (await inject({ method: 'POST', url: '/api/categories', payload: { name: catName } })).json();
    // Bought by the box of 12, counted each: 24 on hand = 2 boxes × $6.00.
    await makeItem({ count: 24, categoryId: cat.id, lastCostCents: 600, purchaseUnit: 'box', countUnit: 'each', purchaseToCountFactor: 12 });
    const val = (await inject({ method: 'GET', url: '/api/inventory/valuation' })).json();
    const bucket = val.byCategory.find((b: { name: string }) => b.name === catName);
    expect(bucket.valueCents).toBe(1200);
    expect(val.totalCents).toBeGreaterThanOrEqual(1200);
  });
});

describe('counter-sale deduction (POS → inventory)', () => {
  it('deducts on sale, is idempotent on retry, and books reason "sold"', async () => {
    const item = await makeItem({ count: 5 });
    const clientRef = ref();
    const sale = await inject({ method: 'POST', url: '/api/pos/sale',
      payload: { clientRef, title: 'Flag decal', amountCents: 800, method: 'cash', inventoryItemId: item.id, stockQty: 2 } });
    expect(sale.statusCode).toBe(201);

    const after = () => inject({ method: 'GET', url: '/api/inventory' })
      .then((r) => (r.json() as { id: number; count: number }[]).find((i) => i.id === item.id)!.count);
    expect(await after()).toBe(3);

    // Sketchy-wifi retry: same clientRef must not deduct twice.
    await inject({ method: 'POST', url: '/api/pos/sale',
      payload: { clientRef, title: 'Flag decal', amountCents: 800, method: 'cash', inventoryItemId: item.id, stockQty: 2 } });
    expect(await after()).toBe(3);

    const hist = (await inject({ method: 'GET', url: `/api/inventory/${item.id}/history` })).json() as { reason: string; delta: number; createdBy: string }[];
    expect(hist[0]).toMatchObject({ reason: 'sold', delta: -2, createdBy: 'Josiah' });
  });

  it('clamps at zero on oversell — the sale never fails', async () => {
    const item = await makeItem({ count: 3 });
    const sale = await inject({ method: 'POST', url: '/api/pos/sale',
      payload: { clientRef: ref(), title: 'Bulk decals', amountCents: 5000, method: 'card', inventoryItemId: item.id, stockQty: 10 } });
    expect(sale.statusCode).toBe(201);
    const items = (await inject({ method: 'GET', url: '/api/inventory' })).json() as { id: number; count: number }[];
    expect(items.find((i) => i.id === item.id)!.count).toBe(0);
    const hist = (await inject({ method: 'GET', url: `/api/inventory/${item.id}/history` })).json() as { note: string }[];
    expect(hist[0].note).toMatch(/only 3 were on hand/);
  });
});

describe('inventory settings knobs', () => {
  it('serves defaults and persists changes', async () => {
    const def = (await inject({ method: 'GET', url: '/api/settings/inventory' })).json();
    expect(def).toMatchObject({ pctThreshold: 5, unitThreshold: 5, reorderBufferDays: 3 });
    const upd = await inject({ method: 'PUT', url: '/api/settings/inventory', payload: { pctThreshold: 10, reorderBufferDays: 5 } });
    expect(upd.json()).toMatchObject({ pctThreshold: 10, unitThreshold: 5, reorderBufferDays: 5 });
    // Put it back so other tests keep the default threshold behavior.
    await inject({ method: 'PUT', url: '/api/settings/inventory', payload: { pctThreshold: 5, reorderBufferDays: 3 } });
  });
});
