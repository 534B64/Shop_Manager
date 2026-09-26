// GET /api/reports/sales — date-range sales & tax in SQL, same rule as the Z-report.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { TestUser } from './test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
let manager: TestUser;
let cashier: TestUser;

const as = (u: TestUser) => (opts: InjectOptions) => app.inject({ ...opts, headers: { ...u.headers } });
const ref = () => `ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const sale = async (payload: Record<string, unknown>) => {
  const r = await as(admin)({ method: 'POST', url: '/api/pos/sale',
    payload: { clientRef: ref(), title: 'Sale', amountCents: 1000, method: 'card', ...payload } });
  expect(r.statusCode).toBe(201);
  return r.json() as { invoice: { id: number; number: number } };
};

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-salesrep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
  manager = await createUserWithToken(app, 'manager');
  cashier = await createUserWithToken(app, 'cashier');
});

afterAll(async () => {
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ } }
});

describe('GET /api/reports/sales', () => {
  it('is manager+ and checks its dates', async () => {
    expect((await as(cashier)({ method: 'GET', url: '/api/reports/sales' })).statusCode).toBe(403);
    expect((await as(manager)({ method: 'GET', url: '/api/reports/sales?from=yesterday' })).statusCode).toBe(400);
  });

  it('matches the Z-report of a session holding the same sales, void and return', async () => {
    const open = (await as(admin)({ method: 'POST', url: '/api/drawer/open', payload: { openingFloatCents: 10000 } })).json();
    const s1 = await sale({ method: 'cash', amountCents: 2000, tenderedCents: 2000 });
    const s2 = await sale({ amountCents: 4000 });
    const s3 = await sale({ method: 'cash', title: 'Taxed', amountCents: undefined,
      lines: [{ description: 'Sign', qty: 2, unitPriceCents: 1000, taxable: true }] });
    const inv3 = (await as(admin)({ method: 'GET', url: `/api/invoices/${s3.invoice.number}` })).json();
    const ret = await as(admin)({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s3.invoice.id,
      reason: 'x', refundMethod: 'cash', lines: [{ invoiceLineId: inv3.lines[0].id, qty: 1 }] } });
    expect(ret.statusCode).toBe(201);
    expect((await as(admin)({ method: 'POST', url: `/api/invoices/${s2.invoice.id}/void`, payload: { reason: 'dup' } })).statusCode).toBe(201);
    const closed = (await as(manager)({ method: 'POST', url: '/api/drawer/close', payload: { countedCashCents: 0 } })).json();
    const z = closed.zReport;
    expect(closed.id).toBe(open.id);

    const today = new Date().toISOString().slice(0, 10);
    const r = (await as(manager)({ method: 'GET', url: `/api/reports/sales?from=${today}&to=${today}` })).json();
    expect(r.sales).toEqual(z.sales);
    expect(r.voids).toEqual(z.voids);
    expect(r.returns).toEqual(z.returns);
    expect(r.netSalesCents).toBe(z.netSalesCents);
    expect(r.netTaxCents).toBe(z.netTaxCents);
    expect(r.sales).toMatchObject({ invoiceCount: 3, firstNumber: String(s1.invoice.number).padStart(6, '0') });
    expect(r.voids).toMatchObject({ count: 1, totalCents: 4000 });

    const none = (await as(manager)({ method: 'GET', url: '/api/reports/sales?to=2000-01-01' })).json();
    expect(none).toMatchObject({ sales: { invoiceCount: 0, totalCents: 0, firstNumber: null }, netSalesCents: 0 });
  });
});
