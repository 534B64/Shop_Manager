// Owner decisions 2026-09-26 (ADR 0007): D10 counter sales taxed by default
// with a logged tax exemption, D11 void defaults by invoice source, D12 every
// payment needs an open drawer, D13 one refund threshold. Own SQLite file;
// the first block runs with NO drawer open.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { TestUser } from './test-helpers.js';
import { priceCounterSale } from '../shared/invoice.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
let manager: TestUser;
let cashier: TestUser;
let dbm: typeof import('./db/index.js');
let orm: typeof import('drizzle-orm');
let schema: typeof import('./db/schema/index.js');

const as = (u: TestUser) => (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...u.headers, ...(opts.headers ?? {}) } });
const inject = (opts: InjectOptions) => as(admin)(opts);
const ref = () => `od-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const sale = (payload: Record<string, unknown>, u: TestUser = admin) =>
  as(u)({ method: 'POST', url: '/api/pos/sale', payload: { clientRef: ref(), method: 'card', ...payload } });
const pay = (payload: Record<string, unknown>, u: TestUser = admin) =>
  as(u)({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), ...payload } });
const invoice = async (number: number) =>
  (await inject({ method: 'GET', url: `/api/invoices/${number}` })).json();
async function makeJob(finalPriceCents = 10000) {
  const res = await inject({ method: 'POST', url: '/api/jobs', payload: {
    clientRef: ref(), type: 'decal', title: `Job ${ref()}`, status: 'acknowledged', finalPriceCents } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: number; totalCents: number | null; finalPriceCents: number };
}
async function auditFor(action: string, entityId: number) {
  const { auditLog } = schema;
  return dbm.db.select().from(auditLog).where(orm.and(orm.eq(auditLog.action, action), orm.eq(auditLog.entityId, String(entityId))));
}
const nextNumber = async () =>
  Number((await dbm.db.all<{ n: number }>(orm.sql`select next_value as n from number_sequences where name = 'invoice'`))[0].n);

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-od-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  dbm = await import('./db/index.js');
  orm = await import('drizzle-orm');
  schema = await import('./db/schema/index.js');
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
  manager = await createUserWithToken(app, 'manager');
  cashier = await createUserWithToken(app, 'cashier');
});

afterAll(async () => {
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ } }
});

describe('D12: every payment needs an open drawer (none open yet)', () => {
  it('refuses payments of every method, refunds, and counter sales with 409 drawer_closed', async () => {
    const job = await makeJob();
    for (const method of ['cash', 'card', 'check', 'other']) {
      const res = await pay({ jobId: job.id, amountCents: 500, method });
      expect(res.statusCode, method).toBe(409);
      expect(res.json()).toMatchObject({ code: 'drawer_closed' });
    }
    const refund = await pay({ jobId: job.id, amountCents: 500, method: 'card', kind: 'refund' });
    expect(refund.json()).toMatchObject({ code: 'drawer_closed' });
    const before = await nextNumber();
    const card = await sale({ title: 'Card sale', amountCents: 1000 });
    expect(card.statusCode).toBe(409);
    expect(card.json()).toMatchObject({ code: 'drawer_closed' });
    expect(await nextNumber()).toBe(before); // no invoice number consumed
    const { payments } = schema;
    expect(await dbm.db.select().from(payments)).toHaveLength(0);
  });

  it('store credit needs the drawer too', async () => {
    const c = (await inject({ method: 'POST', url: '/api/customers', payload: { name: 'Credit Co', email: 'c@example.com' } })).json();
    const job = (await inject({ method: 'POST', url: '/api/jobs', payload: { clientRef: ref(), type: 'decal', title: 'Credit job',
      status: 'acknowledged', finalPriceCents: 1000, customerId: c.id } })).json();
    const res = await pay({ jobId: job.id, amountCents: 100, method: 'credit' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'drawer_closed' });
  });

  it('once open, card/check payments attach to the drawer and the Z-report counts them', async () => {
    const open = (await inject({ method: 'POST', url: '/api/drawer/open', payload: { openingFloatCents: 0 } })).json();
    const job = await makeJob();
    const card = (await pay({ jobId: job.id, amountCents: 700, method: 'card' })).json();
    const check = (await pay({ jobId: job.id, amountCents: 300, method: 'check' })).json();
    expect(card.drawerSessionId).toBe(open.id);
    expect(check.drawerSessionId).toBe(open.id);
    const z = (await inject({ method: 'GET', url: `/api/drawer/${open.id}/z-report` })).json();
    expect(z.byMethod.card.paymentsCents).toBe(700);
    expect(z.byMethod.check.paymentsCents).toBe(300);
  });
});

describe('D10: counter sales are taxed by default; a tax exemption is logged', () => {
  it('lines without a taxable flag are taxed; the preview (priceCounterSale) equals the server', async () => {
    const lines = [
      { description: 'Decal', qty: 3, unitPriceCents: 1234 },
      { description: 'Labor', qty: 1, unitPriceCents: 500, taxable: false },
    ];
    const res = await sale({ lines });
    expect(res.statusCode).toBe(201);
    const inv = await invoice(res.json().invoice.number);
    const preview = priceCounterSale(lines.map((l) => ({ qty: l.qty, subtotalCents: l.qty * l.unitPriceCents, taxable: l.taxable })), 8.25);
    expect(inv.lines.map((l: { taxCents: number }) => l.taxCents)).toEqual(preview.lines.map((l) => l.taxCents));
    expect(inv.lines.map((l: { taxCents: number }) => l.taxCents)).toEqual([305, 0]);
    expect({ sub: inv.subtotalCents, tax: inv.taxCents, total: inv.totalCents })
      .toEqual({ sub: preview.subtotalCents, tax: preview.taxCents, total: preview.totalCents });
    expect(inv.taxExempt).toBe(false);
    expect(res.json().payment.amountCents).toBe(preview.totalCents);
  });

  it('the legacy body treats amountCents as the pre-tax price and adds tax', async () => {
    const res = (await sale({ title: 'Flag decal', amountCents: 1250 })).json();
    expect(res.invoice).toMatchObject({ subtotalCents: 1250, taxCents: 103, totalCents: 1353 });
    expect(res.payment.amountCents).toBe(1353);
    expect(priceCounterSale([{ qty: 1, subtotalCents: 1250 }], 8.25).totalCents).toBe(1353);
  });

  it('a tax-exempt sale needs a short reason (400 without one)', async () => {
    for (const extra of [{}, { taxExemptReason: '  ' }, { taxExemptReason: 'no' }]) {
      const res = await sale({ title: 'Exempt', amountCents: 1000, taxExempt: true, ...extra });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/reason/);
    }
  });

  it('records taxExempt + reason on the invoice and in the audit rows; nothing is taxed', async () => {
    const res = await sale({ taxExempt: true, taxExemptReason: ' Resale certificate ',
      lines: [{ description: 'Vinyl roll', qty: 2, unitPriceCents: 4000, taxable: true }] });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.invoice).toMatchObject({ taxExempt: true, taxExemptReason: 'Resale certificate', taxCents: 0, totalCents: 8000 });
    expect(body.payment.amountCents).toBe(8000);
    expect(priceCounterSale([{ qty: 2, subtotalCents: 8000, taxable: true }], 8.25, { taxExempt: true }).totalCents).toBe(8000);
    const [jobAudit] = await auditFor('job.create', body.id);
    expect(JSON.parse(jobAudit.afterJson!)).toMatchObject({ taxExempt: true, taxExemptReason: 'Resale certificate' });
    const [invAudit] = await auditFor('invoice.create', body.invoice.id);
    expect(JSON.parse(invAudit.afterJson!)).toMatchObject({ taxExempt: true, taxExemptReason: 'Resale certificate' });
  });

  it('a reason sent without taxExempt is ignored (the sale is taxed)', async () => {
    const res = (await sale({ title: 'Taxed', amountCents: 1000, taxExemptReason: 'Nonprofit' })).json();
    expect(res.invoice).toMatchObject({ taxExempt: false, taxExemptReason: null, taxCents: 83 });
  });
});

describe('D11: void defaults by invoice source', () => {
  it('a counter-sale void archives its job by default', async () => {
    const s = (await sale({ title: 'Oops', amountCents: 1000 })).json();
    const v = await as(cashier)({ method: 'POST', url: `/api/invoices/${s.invoice.id}/void`,
      payload: { reason: 'rang twice', approval: { name: manager.name, pin: manager.pin } } });
    expect(v.statusCode).toBe(201);
    expect(v.json().void.jobArchived).toBe(true);
    const [job] = await dbm.db.select().from(schema.jobs).where(orm.eq(schema.jobs.id, s.id));
    expect(job.deletedAt).toBeTruthy();
  });

  it('a job-invoice void keeps the job open by default (editable, re-invoiceable)', async () => {
    const job = await makeJob(2000);
    const p = (await pay({ jobId: job.id, amountCents: job.totalCents ?? 2000, method: 'card' })).json();
    const v = await inject({ method: 'POST', url: `/api/invoices/${p.invoice.id}/void`, payload: { reason: 'wrong price' } });
    expect(v.statusCode).toBe(201);
    expect(v.json().void.jobArchived).toBe(false);
    expect((await inject({ method: 'GET', url: `/api/jobs/${job.id}` })).json().invoice).toBeNull();
    const [row] = await dbm.db.select().from(schema.jobs).where(orm.eq(schema.jobs.id, job.id));
    expect(row.deletedAt).toBeNull();
    expect((await inject({ method: 'PUT', url: `/api/jobs/${job.id}`, payload: { finalPriceCents: 1800 } })).statusCode).toBe(200);
  });

  it('keepJob overrides the default either way', async () => {
    const s = (await sale({ title: 'Keep me', amountCents: 1000 })).json();
    const kept = (await inject({ method: 'POST', url: `/api/invoices/${s.invoice.id}/void`, payload: { reason: 'fix', keepJob: true } })).json();
    expect(kept.void.jobArchived).toBe(false);
    const job = await makeJob(3000);
    const p = (await pay({ jobId: job.id, amountCents: job.totalCents ?? 3000, method: 'card' })).json();
    const gone = (await inject({ method: 'POST', url: `/api/invoices/${p.invoice.id}/void`, payload: { reason: 'cancelled', keepJob: false } })).json();
    expect(gone.void.jobArchived).toBe(true);
  });

  it('a manager always approves an invoice void, even $1', async () => {
    const s = (await sale({ title: 'Tiny', amountCents: 100, taxable: false })).json();
    const denied = await as(cashier)({ method: 'POST', url: `/api/invoices/${s.invoice.id}/void`, payload: { reason: 'x' } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'approval_required', action: 'invoice.void' });
  });
});

describe('D13: one refund threshold (Settings, default $50)', () => {
  it('a cashier refunds up to the threshold alone; over it needs a manager; the cap still holds', async () => {
    const job = await makeJob(10000);
    await pay({ jobId: job.id, amountCents: 9000, method: 'card' });
    const under = await pay({ jobId: job.id, amountCents: 4000, method: 'card', kind: 'refund' }, cashier);
    expect(under.statusCode).toBe(201);
    const [a] = await auditFor('payment.refund', under.json().id);
    expect(a.approvalId).toBeNull();
    const at = await pay({ jobId: job.id, amountCents: 5000, method: 'card', kind: 'refund' }, cashier);
    expect(at.statusCode).toBe(201); // at the threshold: no approval

    const job2 = await makeJob(10000);
    await pay({ jobId: job2.id, amountCents: 9000, method: 'card' });
    const over = await pay({ jobId: job2.id, amountCents: 6000, method: 'card', kind: 'refund' }, cashier);
    expect(over.statusCode).toBe(403);
    expect(over.json()).toMatchObject({ error: 'approval_required', action: 'payment.refund' });
    const ok = await pay({ jobId: job2.id, amountCents: 6000, method: 'card', kind: 'refund',
      approval: { name: manager.name, pin: manager.pin } }, cashier);
    expect(ok.statusCode).toBe(201);
    const [b] = await auditFor('payment.refund', ok.json().id);
    expect(b.approvalId).not.toBeNull();
    const cap = await pay({ jobId: job2.id, amountCents: 3100, method: 'card', kind: 'refund' }, cashier);
    expect(cap.statusCode).toBe(409);
  });

  it('follows the Settings threshold', async () => {
    await inject({ method: 'PUT', url: '/api/settings/pos', payload: { refundApprovalThresholdCents: 1000 } });
    const job = await makeJob(10000);
    await pay({ jobId: job.id, amountCents: 5000, method: 'card' });
    const res = await pay({ jobId: job.id, amountCents: 2000, method: 'card', kind: 'refund' }, cashier);
    expect(res.statusCode).toBe(403);
    await inject({ method: 'PUT', url: '/api/settings/pos', payload: { refundApprovalThresholdCents: 5000 } });
  });

  it('voiding a payment always needs a manager, however small', async () => {
    const job = await makeJob(10000);
    const p = (await pay({ jobId: job.id, amountCents: 100, method: 'card' })).json();
    const res = await as(cashier)({ method: 'POST', url: `/api/payments/${p.id}/void`, payload: { reason: 'typo' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'approval_required', action: 'payment.void' });
  });
});

describe('D12: refunds from voids and returns need the drawer too', () => {
  it('refuses a paid void and a refunding return while the drawer is closed; an unpaid void is fine', async () => {
    const paid = (await sale({ title: 'Paid', amountCents: 1000, taxable: false })).json();
    const paid2 = (await sale({ title: 'Paid 2', amountCents: 1000, taxable: false })).json();
    const line = (await invoice(paid2.invoice.number)).lines[0];
    const job = await makeJob(1500);
    await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'in_progress' } });
    await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'done' } });
    const pickedUp = await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'picked_up', override: true } });
    expect(pickedUp.statusCode).toBe(200); // unpaid pickup (admin approves) → an unpaid invoice
    const unpaidInv = (await inject({ method: 'GET', url: `/api/invoices?jobId=${job.id}` })).json().rows[0];

    expect((await as(manager)({ method: 'POST', url: '/api/drawer/close', payload: { countedCashCents: 0 } })).statusCode).toBe(200);
    const v = await inject({ method: 'POST', url: `/api/invoices/${paid.invoice.id}/void`, payload: { reason: 'x' } });
    expect(v.statusCode).toBe(409);
    expect(v.json()).toMatchObject({ code: 'drawer_closed' });
    const r = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: paid2.invoice.id,
      reason: 'x', refundMethod: 'card', lines: [{ invoiceLineId: line.id, qty: 1 }] } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'drawer_closed' });
    const unpaid = await inject({ method: 'POST', url: `/api/invoices/${unpaidInv.id}/void`, payload: { reason: 'no refund due' } });
    expect(unpaid.statusCode).toBe(201);
    expect(unpaid.json().refunds).toHaveLength(0);
  });
});
