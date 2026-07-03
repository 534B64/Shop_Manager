// Integration tests for the highest-value flows: job creation (incl. idempotency
// + PO/customer side-effects), status-transition rules, and payment/void/refund
// balance math. Each run uses its own throwaway SQLite file, migrated fresh.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let dbFile: string;

// crypto.randomUUID() is 36 chars — satisfies the clientRef 8–64 length rule.
const ref = () => crypto.randomUUID();

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-it-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DB_PATH = dbFile; // set BEFORE importing the db singleton
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

async function createJob(over: Record<string, unknown> = {}) {
  const res = await app.inject({
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
    const res = await app.inject({
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
    const res = await app.inject({ method: 'POST', url: '/api/customers', payload: { name: 'Emailless Co' } });
    expect(res.statusCode).toBe(400);
    const bad = await app.inject({ method: 'POST', url: '/api/customers', payload: { name: 'Typo Co', email: 'not-an-email' } });
    expect(bad.statusCode).toBe(400);
  });

  it('accepts a customer with an email', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/customers', payload: { name: 'Mailed Co', email: 'shop@mailed.example' } });
    expect(res.statusCode).toBe(201);
  });

  it('exempts the generic Walk-in record (Quick Order path)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/customers',
      payload: { name: 'Walk-in', notes: 'Generic walk-in counter customer' } });
    expect(res.statusCode).toBe(201);
  });
});

describe('status transitions', () => {
  it('allows one step forward along the simple path', async () => {
    const job = (await createJob()).json();
    const res = await app.inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'in_progress' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('in_progress');
  });

  it('rejects a skip-ahead transition (acknowledged → done)', async () => {
    const job = (await createJob()).json();
    const res = await app.inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'done' } });
    expect(res.statusCode).toBe(409);
  });

  it('allows a step backward', async () => {
    const job = (await createJob()).json();
    await app.inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'in_progress' } });
    const back = await app.inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'acknowledged' } });
    expect(back.statusCode).toBe(200);
    expect(back.json().status).toBe('acknowledged');
  });

  it('blocks pickup with a balance due, then allows it with the admin override', async () => {
    const job = (await createJob()).json();
    for (const s of ['in_progress', 'done']) {
      await app.inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: s } });
    }
    const blocked = await app.inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'picked_up' } });
    expect(blocked.statusCode).toBe(402); // balance due, no override

    const overridden = await app.inject({
      method: 'PUT', url: `/api/jobs/${job.id}/status`,
      payload: { status: 'picked_up', adminPassword: 'admin' },
    });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json().status).toBe('picked_up');
  });
});

describe('payment / void / refund balance math', () => {
  async function owedFor(jobId: number): Promise<number | undefined> {
    const balances = (await app.inject({ method: 'GET', url: '/api/balances' })).json() as { jobId: number; owedCents: number }[];
    return balances.find((b) => b.jobId === jobId)?.owedCents;
  }

  it('reduces the balance by a payment and clears it when paid in full', async () => {
    const job = (await createJob()).json(); // owes 10000
    expect(await owedFor(job.id)).toBe(10000);

    await app.inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 4000, method: 'cash' } });
    expect(await owedFor(job.id)).toBe(6000);

    await app.inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 6000, method: 'cash' } });
    expect(await owedFor(job.id)).toBeUndefined(); // fully paid → drops off the owed list
  });

  it('restores the balance when a payment is voided (row kept, not deleted)', async () => {
    const job = (await createJob()).json();
    const pay = await app.inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 10000, method: 'cash' } });
    expect(await owedFor(job.id)).toBeUndefined();

    const paymentId = pay.json().id;
    const voided = await app.inject({ method: 'POST', url: `/api/payments/${paymentId}/void`, payload: { reason: 'rang up wrong' } });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().voidedAt).toBeTruthy();
    expect(await owedFor(job.id)).toBe(10000); // balance back

    // The voided row still exists on the books.
    const list = (await app.inject({ method: 'GET', url: `/api/payments?jobId=${job.id}` })).json() as unknown[];
    expect(list.length).toBe(1);
  });

  it('treats a refund as money back out — it raises the balance owed', async () => {
    const job = (await createJob()).json();
    await app.inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 10000, method: 'cash' } });
    expect(await owedFor(job.id)).toBeUndefined();

    await app.inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 3000, method: 'cash', kind: 'refund' } });
    expect(await owedFor(job.id)).toBe(3000); // price 10000 − 10000 paid + 3000 refunded
  });

  it('is idempotent on a payment clientRef', async () => {
    const job = (await createJob()).json();
    const clientRef = ref();
    const a = await app.inject({ method: 'POST', url: '/api/payments', payload: { clientRef, jobId: job.id, amountCents: 2500, method: 'cash' } });
    const b = await app.inject({ method: 'POST', url: '/api/payments', payload: { clientRef, jobId: job.id, amountCents: 2500, method: 'cash' } });
    expect(a.json().id).toBe(b.json().id);
    expect(await owedFor(job.id)).toBe(7500); // counted once
  });
});

describe('Phase 8: roll SKUs + advisory stock check', () => {
  // Roll material with its admin color list pre-registered (SKU colors must be
  // on the list since the Phase 11 integrity fix).
  async function rollMaterial(colors: string[] = ['Red', 'Blue', 'Green']) {
    const res = await app.inject({
      method: 'POST', url: '/api/materials',
      payload: { name: `651 Vinyl ${Math.random().toString(36).slice(2, 6)}`, unit: 'sqft', costPerUnitCents: 100, priceMode: 'per_sqft', rateCents: 600, usesRoll: true },
    });
    const m = res.json();
    for (const name of colors) {
      await app.inject({ method: 'POST', url: `/api/materials/${m.id}/colors`, payload: { name } });
    }
    return m;
  }
  async function stockCheck(materialId: number, color: string, widthIn: number, heightIn: number) {
    const res = await app.inject({ method: 'GET', url: `/api/stock-check?materialId=${materialId}&color=${encodeURIComponent(color)}&widthIn=${widthIn}&heightIn=${heightIn}` });
    return res.json();
  }

  it('manages a material color list and rejects duplicates', async () => {
    const m = await rollMaterial([]); // start with an empty color list
    const add = await app.inject({ method: 'POST', url: `/api/materials/${m.id}/colors`, payload: { name: 'Red' } });
    expect(add.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: `/api/materials/${m.id}/colors`, payload: { name: 'red' } });
    expect(dup.statusCode).toBe(409);
    const list = (await app.inject({ method: 'GET', url: `/api/materials/${m.id}/colors` })).json() as unknown[];
    expect(list.length).toBe(1);
  });

  it('refuses roll SKUs on non-roll materials', async () => {
    const flat = (await app.inject({ method: 'POST', url: '/api/materials', payload: { name: 'Magnet', unit: 'each', costPerUnitCents: 100, priceMode: 'flat', rateCents: 6500 } })).json();
    const res = await app.inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: flat.id, color: 'Red', nominalWidthIn: 24 } });
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
    const sku24 = (await app.inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 24, count: 5 } })).json();

    // Part 10×20 → optimal 15 (none in stock); 24 fits → suboptimal, use 24.
    let r = await stockCheck(m.id, 'Red', 10, 20);
    expect(r.state).toBe('suboptimal');
    expect(r.useWidth).toBe(24);

    // Add the optimal 15" roll → in_stock.
    const sku15 = (await app.inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 15, count: 3 } })).json();
    r = await stockCheck(m.id, 'Red', 10, 20);
    expect(r.state).toBe('in_stock');
    expect(r.useWidth).toBe(15);

    // Deplete both to zero → out_of_stock (red).
    await app.inject({ method: 'POST', url: `/api/inventory/${sku15.id}/adjust`, payload: { delta: -3, reason: 'used' } });
    await app.inject({ method: 'POST', url: `/api/inventory/${sku24.id}/adjust`, payload: { delta: -5, reason: 'used' } });
    r = await stockCheck(m.id, 'Red', 10, 20);
    expect(r.state).toBe('out_of_stock');
    expect(r.message).toMatch(/out of stock/i);
  });

  it('rejects a duplicate SKU (same material + color + width)', async () => {
    const m = await rollMaterial();
    await app.inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Blue', nominalWidthIn: 30, count: 1 } });
    const dup = await app.inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'blue', nominalWidthIn: 30, count: 9 } });
    expect(dup.statusCode).toBe(409);
  });

  it('is color-specific — a different color is independent', async () => {
    const m = await rollMaterial();
    await app.inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 24, count: 5 } });
    const r = await stockCheck(m.id, 'Green', 10, 20); // no Green SKU at all
    expect(r.state).toBe('unknown');
  });

  // ---- Phase 11 integrity: SKU colors must come from the material's list ----
  it('rejects a SKU whose color is not on the material color list (typo guard)', async () => {
    const m = await rollMaterial(['Red']);
    const typo = await app.inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Rde', nominalWidthIn: 24 } });
    expect(typo.statusCode).toBe(400);
    expect(typo.json().error).toMatch(/not in this material's color list/i);
  });

  it('rejects a SKU color edit that leaves the color list, allows one that stays on it', async () => {
    const m = await rollMaterial(['Red', 'Blue']);
    const sku = (await app.inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 24 } })).json();
    const bad = await app.inject({ method: 'PUT', url: `/api/inventory/${sku.id}`, payload: { color: 'Crimson' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PUT', url: `/api/inventory/${sku.id}`, payload: { color: 'Blue' } });
    expect(ok.statusCode).toBe(200);
  });

  it('answers every line of a multi-item quote in one batch stock-check call', async () => {
    const m = await rollMaterial();
    await app.inject({ method: 'POST', url: '/api/roll-skus', payload: { materialId: m.id, color: 'Red', nominalWidthIn: 15, count: 2 } });
    const res = await app.inject({ method: 'POST', url: '/api/stock-check/batch', payload: { lines: [
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
    return (await app.inject({ method: 'POST', url: '/api/materials',
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
    await app.inject({ method: 'POST', url: '/api/users', payload: { name: 'edit-tester', password: 'pw123', adminPassword: 'admin' } });
    const m = await flatMaterial();
    const job = (await createJob({ materialId: m.id, finalPriceCents: 6500, totalCents: 7036, taxable: true })).json();
    const res = await app.inject({ method: 'PUT', url: `/api/jobs/${job.id}`, payload: {
      editorName: 'edit-tester', editorPassword: 'pw123',
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
    const cc = (await app.inject({ method: 'POST', url: '/api/cycle-counts', payload: { scheduledFor: today } })).json();
    const done = await app.inject({ method: 'POST', url: `/api/cycle-counts/${cc.id}/complete`, payload: { counts: [] } });
    expect(done.statusCode).toBe(200);
    const expected = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    expect(done.json().nextScheduledFor).toBe(expected);
    const next = (await app.inject({ method: 'GET', url: '/api/cycle-counts/next' })).json();
    expect(next?.scheduledFor).toBe(expected);
    // Clean up the auto-created session so later runs of this suite start fresh.
    await app.inject({ method: 'POST', url: `/api/cycle-counts/${next.id}/complete`, payload: { counts: [], nextScheduledFor: '2099-01-01' } });
  });

  it('adjusts a count with a reason and refuses to go below zero', async () => {
    const item = (await app.inject({ method: 'POST', url: '/api/inventory', payload: { name: `Blanks ${Math.random().toString(36).slice(2, 6)}`, count: 5 } })).json();
    const ok = await app.inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: -3, reason: 'used' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().count).toBe(2);
    const under = await app.inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: -5, reason: 'used' } });
    expect(under.statusCode).toBe(409);
  });
});

describe('Phase 11: unpaid-pickup override is attributable', () => {
  it('appends who used the admin override to the job notes', async () => {
    const job = (await createJob()).json();
    for (const s of ['in_progress', 'done']) {
      await app.inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: s } });
    }
    const res = await app.inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`,
      payload: { status: 'picked_up', adminPassword: 'admin', overrideBy: 'Josiah' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().notes).toMatch(/admin override by Josiah/);
    expect(res.json().notes).toMatch(/balance due/);
  });
});

describe('Phase 11: design-file uploads are gone (fileRef only)', () => {
  it('has no upload endpoint anymore', async () => {
    const job = (await createJob()).json();
    const res = await app.inject({ method: 'POST', url: `/api/jobs/${job.id}/file`, payload: {} });
    expect(res.statusCode).toBe(404); // route no longer exists
  });
});
