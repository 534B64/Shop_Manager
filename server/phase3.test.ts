// Phase 3 (ADR 0007): POS governance — locked invoices with a gap-free number,
// per-line tax, invoice voids, returns (RMAs), refund threshold, price
// overrides, and the cash drawer with its Z-report. Own throwaway SQLite file.
// Tests run in order: the first block runs with NO drawer open.
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
let dbm: typeof import('./db/index.js');
let orm: typeof import('drizzle-orm');
let schema: typeof import('./db/schema/index.js');

const as = (u: TestUser) => (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...u.headers, ...(opts.headers ?? {}) } });
const inject = (opts: InjectOptions) => as(admin)(opts);
const uniq = () => Math.random().toString(36).slice(2, 8);
const ref = () => crypto.randomUUID();

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-3-${Date.now()}-${uniq()}.db`);
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
  for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ }
  }
});

type InvoiceHeader = { id: number; number: number; numberDisplay: string; totalCents: number; taxCents: number;
  subtotalCents: number; discountCents: number; status: string; jobId: number };
type InvoiceLine = { id: number; lineNo: number; qty: number; subtotalCents: number; taxCents: number;
  discountCents: number; totalCents: number; taxRatePct: number; taxable: boolean; stockQty: number; inventoryItemId: number | null; returnedQty: number };
type InvoiceDetail = InvoiceHeader & { lines: InvoiceLine[]; void: { id: number } | null; returns: unknown[];
  payments: { kind: string; amountCents: number; method: string; invoiceVoidId: number | null }[] };

async function makeItem(count: number) {
  const res = await inject({ method: 'POST', url: '/api/inventory', payload: { name: `Item ${uniq()}`, count } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: number };
}
async function itemCount(id: number) {
  const rows = await dbm.db.all<{ count: number }>(orm.sql`select count from inventory_items where id = ${id}`);
  return rows[0].count;
}
async function nextInvoiceNumber() {
  const rows = await dbm.db.all<{ n: number }>(orm.sql`select next_value as n from number_sequences where name = 'invoice'`);
  return Number(rows[0].n);
}
const sale = (payload: Record<string, unknown>, u: TestUser = admin) =>
  as(u)({ method: 'POST', url: '/api/pos/sale', payload: { clientRef: ref(), title: `Sale ${uniq()}`, amountCents: 1000, method: 'card', ...payload } });
const detail = async (number: number) =>
  (await inject({ method: 'GET', url: `/api/invoices/${String(number).padStart(6, '0')}` })).json() as InvoiceDetail;

async function makeJob(over: Record<string, unknown> = {}, u: TestUser = admin) {
  const res = await as(u)({ method: 'POST', url: '/api/jobs', payload: {
    clientRef: ref(), type: 'decal', title: `Job ${uniq()}`, status: 'acknowledged', finalPriceCents: 10000, ...over,
  } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: number; totalCents: number | null };
}

describe('cash drawer rules (no drawer open yet)', () => {
  it('refuses a cash payment with no open drawer (409), card/check need no drawer', async () => {
    const job = await makeJob();
    const cash = await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 1000, method: 'cash' } });
    expect(cash.statusCode).toBe(409);
    expect(cash.json()).toMatchObject({ code: 'drawer_closed' });
    expect(cash.json().error).toMatch(/No cash drawer is open/);
    const card = await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 1000, method: 'card' } });
    expect(card.statusCode).toBe(201);
    expect(card.json().drawerSessionId).toBeNull();
  });

  it('a cash counter sale with no drawer rolls back entirely and gives its invoice number back', async () => {
    const before = await nextInvoiceNumber();
    const clientRef = ref();
    const res = await sale({ clientRef, method: 'cash' });
    expect(res.statusCode).toBe(409);
    expect(await nextInvoiceNumber()).toBe(before);
    const { jobs, invoices } = schema;
    expect(await dbm.db.select().from(jobs).where(orm.eq(jobs.clientRef, clientRef))).toHaveLength(0);
    expect(await dbm.db.select().from(invoices)).toHaveLength(0);
  });

  it('opens a drawer (any signed-in user); a second open is refused', async () => {
    const open = await as(cashier)({ method: 'POST', url: '/api/drawer/open', payload: { openingFloatCents: 10000 } });
    expect(open.statusCode).toBe(201);
    expect(open.json()).toMatchObject({ status: 'open', openingFloatCents: 10000, openedByName: cashier.name, final: false });
    const again = await inject({ method: 'POST', url: '/api/drawer/open', payload: { openingFloatCents: 5000 } });
    expect(again.statusCode).toBe(409);
    const cur = (await inject({ method: 'GET', url: '/api/drawer/current' })).json();
    expect(cur.drawer.id).toBe(open.json().id);
  });
});

describe('invoice numbers', () => {
  it('counter sales get consecutive numbers; the invoice is a locked snapshot', async () => {
    const a = (await sale({})).json();
    const b = (await sale({})).json();
    expect(a.invoice.number).toBe(1);
    expect(b.invoice.number).toBe(a.invoice.number + 1);
    expect(a.invoice.numberDisplay).toBe('000001');
    expect(a.payment.amountCents).toBe(1000);
  });

  it('a sale that fails partway rolls back fully: no job, invoice, payment, stock row — and no number consumed', async () => {
    const item = await makeItem(5);
    const before = await nextInvoiceNumber();
    await dbm.db.run(orm.sql.raw(`CREATE TRIGGER test_fail_pay BEFORE INSERT ON payments
      WHEN NEW.client_ref LIKE 'FAILPAY%' BEGIN SELECT RAISE(ABORT, 'forced failure'); END`));
    const clientRef = `FAILPAY-${ref()}`;
    try {
      const res = await sale({ clientRef, method: 'cash', inventoryItemId: item.id, stockQty: 2 });
      expect(res.statusCode).toBe(500);
    } finally {
      await dbm.db.run(orm.sql.raw('DROP TRIGGER test_fail_pay'));
    }
    const { jobs, payments, invoices, inventoryAdjustments } = schema;
    expect(await dbm.db.select().from(jobs).where(orm.eq(jobs.clientRef, clientRef))).toHaveLength(0);
    expect(await dbm.db.select().from(payments).where(orm.like(payments.clientRef, 'FAILPAY%'))).toHaveLength(0);
    expect(await dbm.db.select().from(invoices).where(orm.eq(invoices.number, before))).toHaveLength(0);
    const txns = await dbm.db.select().from(inventoryAdjustments).where(orm.eq(inventoryAdjustments.itemId, item.id));
    expect(txns.map((t) => t.txnType)).toEqual(['opening']);
    expect(await itemCount(item.id)).toBe(5);
    expect(await nextInvoiceNumber()).toBe(before);
    const ok = (await sale({ method: 'cash', inventoryItemId: item.id, stockQty: 2 })).json();
    expect(ok.invoice.number).toBe(before);
  });

  it('stays gap-free under concurrent sales', async () => {
    const start = await nextInvoiceNumber();
    const results = await Promise.all(Array.from({ length: 15 }, () => sale({})));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const nums = results.map((r) => r.json().invoice.number as number).sort((x, y) => x - y);
    expect(nums).toEqual(Array.from({ length: 15 }, (_, i) => start + i));
    const all = await dbm.db.all<{ number: number }>(orm.sql`select number from invoices order by number`);
    all.forEach((r, i) => expect(Number(r.number)).toBe(i + 1));
  });

  it('a wifi retry of a sale returns the same job + invoice, no second number', async () => {
    const clientRef = ref();
    const first = (await sale({ clientRef })).json();
    const before = await nextInvoiceNumber();
    const again = await sale({ clientRef });
    expect(again.statusCode).toBe(200);
    expect(again.json().invoice.number).toBe(first.invoice.number);
    expect(await nextInvoiceNumber()).toBe(before);
  });

  it('the database only lets the sequence step by one and only accepts the allocated number', async () => {
    await expect(dbm.db.run(orm.sql`update number_sequences set next_value = next_value + 5 where name = 'invoice'`)).rejects.toThrow(/step forward by one/);
    const [job] = await dbm.db.select().from(schema.jobs).limit(1);
    await expect(dbm.db.run(orm.sql`insert into invoices (number, job_id, title, source, tax_rate_pct, subtotal_cents, tax_cents, total_cents, created_at)
      values (999999, ${job.id}, 'x', 'job', 0, 0, 0, 0, '2026-01-01')`)).rejects.toThrow(/invoice sequence/);
  });
});

describe('per-line tax', () => {
  it('stores rate + tax per line and the invoice totals are line sums', async () => {
    const res = await sale({ title: 'Mixed ticket', lines: [
      { description: 'Decal 12in', qty: 3, unitPriceCents: 1234, taxable: true },
      { description: 'Squeegee', qty: 1, unitPriceCents: 999, taxable: true },
      { description: 'Tax-exempt labor', qty: 1, unitPriceCents: 500, taxable: false },
    ], amountCents: undefined });
    expect(res.statusCode).toBe(201);
    const inv = await detail(res.json().invoice.number);
    // 3702 × 8.25% = 305.415 → 305; 999 × 8.25% = 82.4175 → 82.
    expect(inv.lines.map((l) => l.taxCents)).toEqual([305, 82, 0]);
    expect(inv.lines.map((l) => l.taxRatePct)).toEqual([8.25, 8.25, 0]);
    expect(inv.subtotalCents).toBe(3702 + 999 + 500);
    expect(inv.taxCents).toBe(inv.lines.reduce((s, l) => s + l.taxCents, 0));
    expect(inv.totalCents).toBe(inv.lines.reduce((s, l) => s + l.totalCents, 0));
    expect(inv.totalCents).toBe(5201 + 387);
    expect(res.json().payment.amountCents).toBe(inv.totalCents);
  });

  it('a legacy counter sale (no taxable flag) charges exactly the amount rung up', async () => {
    const res = (await sale({ amountCents: 2500 })).json();
    expect(res.invoice).toMatchObject({ totalCents: 2500, taxCents: 0 });
  });

  it('paying a job in full issues its invoice, matching the job total incl. tax + discount', async () => {
    const job = await makeJob({ finalPriceCents: 12345, taxable: true, discountPct: 10, totalCents: 1 });
    expect(job.totalCents).toBe(12345 + 1018 - 1336); // tax 1018.46 → 1018, discount 1336.3 → 1336
    const part = await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 5000, method: 'card' } });
    expect(part.json().invoice).toBeUndefined();
    const rest = await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: job.totalCents! - 5000, method: 'check' } });
    expect(rest.statusCode).toBe(201);
    const inv = await detail(rest.json().invoice.number);
    expect(inv).toMatchObject({ jobId: job.id, subtotalCents: 12345, taxCents: 1018, discountCents: 1336, totalCents: job.totalCents, status: 'issued' });
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ taxRatePct: 8.25, taxCents: 1018, discountCents: 1336, totalCents: job.totalCents });
  });
});

describe('invoiced jobs are locked', () => {
  it('pickup issues the invoice; money edits then 409, other edits still save; removal refused', async () => {
    const job = await makeJob({ finalPriceCents: 4000 });
    await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'in_progress' } });
    await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'done' } });
    const up = await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'picked_up', override: true } });
    expect(up.statusCode).toBe(200);
    const list = (await inject({ method: 'GET', url: `/api/invoices?jobId=${job.id}` })).json();
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].totalCents).toBe(4000);

    const priceEdit = await inject({ method: 'PUT', url: `/api/jobs/${job.id}`, payload: { finalPriceCents: 3000 } });
    expect(priceEdit.statusCode).toBe(409);
    expect(priceEdit.json().fields).toEqual(['finalPriceCents']);
    const custEdit = await inject({ method: 'PUT', url: `/api/jobs/${job.id}`, payload: { taxable: false } });
    expect(custEdit.statusCode).toBe(409);
    const itemsEdit = await inject({ method: 'PUT', url: `/api/jobs/${job.id}`,
      payload: { items: [{ type: 'decal', title: 'Extra', qty: 1, priceCents: 100 }] } });
    expect(itemsEdit.statusCode).toBe(409);
    // The edit form re-sends the unchanged price with a notes change: fine.
    const notes = await inject({ method: 'PUT', url: `/api/jobs/${job.id}`, payload: { finalPriceCents: 4000, notes: 'Call when ready' } });
    expect(notes.statusCode).toBe(200);
    expect(notes.json()).toMatchObject({ notes: 'Call when ready', finalPriceCents: 4000 });

    const del = await inject({ method: 'DELETE', url: `/api/jobs/${job.id}`, payload: {} });
    expect(del.statusCode).toBe(409);
  });
});

describe('invoice void', () => {
  it('needs a manager; links a void record, never alters the invoice, restores stock, refunds, archives the job', async () => {
    const item = await makeItem(10);
    const s = (await sale({ method: 'cash', amountCents: 3000, inventoryItemId: item.id, stockQty: 3, tenderedCents: 5000 })).json();
    expect(s.payment).toMatchObject({ tenderedCents: 5000, changeCents: 2000 });
    expect(await itemCount(item.id)).toBe(7);
    const before = await detail(s.invoice.number);

    const denied = await as(cashier)({ method: 'POST', url: `/api/invoices/${s.invoice.id}/void`, payload: { reason: 'rang wrong item' } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe('approval_required');

    const ok = await as(cashier)({ method: 'POST', url: `/api/invoices/${s.invoice.id}/void`,
      payload: { reason: 'rang wrong item', approval: { name: manager.name, pin: manager.pin } } });
    expect(ok.statusCode).toBe(201);
    const v = ok.json();
    expect(v.void).toMatchObject({ invoiceId: s.invoice.id, reason: 'rang wrong item', refundCents: 3000, jobArchived: true });
    expect(v.refunds).toHaveLength(1);
    expect(v.refunds[0]).toMatchObject({ kind: 'refund', method: 'cash', amountCents: 3000, invoiceVoidId: v.void.id });
    expect(v.restocked).toEqual([{ inventoryItemId: item.id, qty: 3 }]);
    expect(await itemCount(item.id)).toBe(10);

    const after = await detail(s.invoice.number);
    const strip = (d: InvoiceDetail) => ({ ...d, status: undefined, void: undefined, payments: undefined });
    expect(strip(after)).toEqual(strip(before));
    expect(after.status).toBe('voided');
    expect(after.void!.id).toBe(v.void.id);

    const { approvals, jobs } = schema;
    const [ap] = await dbm.db.select().from(approvals).where(orm.eq(approvals.id, v.void.approvalId));
    expect(ap).toMatchObject({ action: 'invoice.void', requestedBy: cashier.id, approvedBy: manager.id });
    const [job] = await dbm.db.select().from(jobs).where(orm.eq(jobs.id, s.id));
    expect(job.deletedAt).toBeTruthy();
    const balances = (await inject({ method: 'GET', url: '/api/balances' })).json() as { jobId: number }[];
    expect(balances.find((b) => b.jobId === s.id)).toBeUndefined();

    expect((await inject({ method: 'POST', url: `/api/invoices/${s.invoice.id}/void`, payload: { reason: 'again' } })).statusCode).toBe(409);
    const ret = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'x', lines: [{ invoiceLineId: before.lines[0].id, qty: 1 }], refundMethod: 'cash' } });
    expect(ret.statusCode).toBe(409);
  });

  it('keepJob unlocks the job for editing and re-invoicing under a new number', async () => {
    const job = await makeJob({ finalPriceCents: 2000 });
    const pay = (await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 2000, method: 'card' } })).json();
    const v = await inject({ method: 'POST', url: `/api/invoices/${pay.invoice.id}/void`, payload: { reason: 'wrong price', keepJob: true } });
    expect(v.statusCode).toBe(201);
    expect(v.json().refunds[0]).toMatchObject({ method: 'card', amountCents: 2000 });
    const edit = await inject({ method: 'PUT', url: `/api/jobs/${job.id}`, payload: { finalPriceCents: 1800 } });
    expect(edit.statusCode).toBe(200);
    const newTotal = edit.json().totalCents as number; // an edit refreshes the after-tax total
    expect(newTotal).toBe(1800 + 149);
    const pay2 = (await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: newTotal, method: 'card' } })).json();
    expect(pay2.invoice.number).toBeGreaterThan(pay.invoice.number);
    expect(pay2.invoice.totalCents).toBe(newTotal);
  });
});

describe('returns (RMA)', () => {
  it('refunds per-line value incl. tax, restocks only restockable lines, never more than sold', async () => {
    const item = await makeItem(20);
    const s = (await sale({ title: 'Tees', lines: [
      { description: 'Tee', qty: 3, unitPriceCents: 1000, taxable: true, inventoryItemId: item.id },
      { description: 'Print', qty: 1, unitPriceCents: 500, taxable: true },
    ], amountCents: undefined })).json();
    expect(await itemCount(item.id)).toBe(17);
    const inv = await detail(s.invoice.number);
    const tee = inv.lines[0];
    expect(tee.taxCents).toBe(248); // 3000 × 8.25% = 247.5 → 248

    const r1 = await as(cashier)({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'wrong size', refundMethod: 'card', lines: [{ invoiceLineId: tee.id, qty: 1, restock: true }] } });
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toMatchObject({ subtotalCents: 1000, taxCents: 83, totalCents: 1083, refundCents: 1083 });
    expect(r1.json().refunds[0]).toMatchObject({ kind: 'refund', method: 'card', amountCents: 1083, returnId: r1.json().id });
    expect(await itemCount(item.id)).toBe(18);

    const tooMany = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'x', refundMethod: 'card', lines: [{ invoiceLineId: tee.id, qty: 3 }] } });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json().error).toMatch(/2 of 3 left/);

    const r2 = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'damaged', refundMethod: 'card', lines: [{ invoiceLineId: tee.id, qty: 2, restock: false }] } });
    expect(r2.statusCode).toBe(201);
    expect(await itemCount(item.id)).toBe(18); // damaged → not restocked
    expect(r1.json().taxCents + r2.json().taxCents).toBe(tee.taxCents);
    expect(r1.json().totalCents + r2.json().totalCents).toBe(tee.totalCents);

    const noStock = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'x', refundMethod: 'card', lines: [{ invoiceLineId: inv.lines[1].id, qty: 1, restock: true }] } });
    expect(noStock.statusCode).toBe(400);

    const after = await detail(s.invoice.number);
    expect(after.lines[0].returnedQty).toBe(3);
    expect(after.returns).toHaveLength(2);
  });

  it('a return on an unpaid invoice lowers the balance instead of refunding', async () => {
    const job = await makeJob({ finalPriceCents: 6000, quantity: 3 });
    for (const st of ['in_progress', 'done']) await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: st } });
    await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'picked_up', override: true } });
    const inv = (await inject({ method: 'GET', url: `/api/invoices?jobId=${job.id}` })).json().rows[0];
    const d = await detail(inv.number);
    const r = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: inv.id,
      reason: 'one was misprinted', lines: [{ invoiceLineId: d.lines[0].id, qty: 1 }] } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ totalCents: 2000, refundCents: 0 });
    const bal = (await inject({ method: 'GET', url: '/api/balances' })).json() as { jobId: number; owedCents: number }[];
    expect(bal.find((b) => b.jobId === job.id)!.owedCents).toBe(4000);
  });

  it('a refund over the Settings threshold needs a manager; at or under it a cashier can do it', async () => {
    const s = (await sale({ amountCents: 9000 })).json();
    const line = (await detail(s.invoice.number)).lines[0];
    const over = await as(cashier)({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'changed mind', refundMethod: 'card', lines: [{ invoiceLineId: line.id, qty: 1 }] } });
    expect(over.statusCode).toBe(403);
    expect(over.json()).toMatchObject({ error: 'approval_required', action: 'return.refund' });

    const small = (await sale({ amountCents: 5000 })).json();
    const smallLine = (await detail(small.invoice.number)).lines[0];
    const under = await as(cashier)({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: small.invoice.id,
      reason: 'changed mind', refundMethod: 'card', lines: [{ invoiceLineId: smallLine.id, qty: 1 }] } });
    expect(under.statusCode).toBe(201);
    expect(under.json().approvalId).toBeNull();

    // Admin-configurable: raise it to $100 and the $90 return goes through.
    expect((await as(cashier)({ method: 'PUT', url: '/api/settings/pos', payload: { refundApprovalThresholdCents: 10000 } })).statusCode).toBe(403);
    const set = await inject({ method: 'PUT', url: '/api/settings/pos', payload: { refundApprovalThresholdCents: 10000 } });
    expect(set.json()).toEqual({ refundApprovalThresholdCents: 10000 });
    const now = await as(cashier)({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'changed mind', refundMethod: 'card', lines: [{ invoiceLineId: line.id, qty: 1 }] } });
    expect(now.statusCode).toBe(201);
    await inject({ method: 'PUT', url: '/api/settings/pos', payload: { refundApprovalThresholdCents: 5000 } });
  });
});

describe('price override', () => {
  let materialId: number;
  beforeAll(async () => {
    const m = await inject({ method: 'POST', url: '/api/materials', payload: {
      name: `Plate ${uniq()}`, unit: 'each', costPerUnitCents: 500, priceMode: 'per_unit', rateCents: 2000 } });
    expect(m.statusCode).toBe(201);
    materialId = m.json().id;
  });

  it('saving a job at the suggested price needs nothing; a different price needs a manager', async () => {
    const match = await as(cashier)({ method: 'POST', url: '/api/jobs', payload: { clientRef: ref(), type: 'magnet',
      title: 'At suggestion', status: 'acknowledged', materialId, quantity: 1, finalPriceCents: 2000 } });
    expect(match.statusCode).toBe(201);
    expect(match.json().suggestedPriceCents).toBe(2000);

    const clientRef = ref();
    const email = `${uniq()}@override.example`;
    const body = { clientRef, type: 'magnet', title: 'Friend discount', status: 'acknowledged', materialId, quantity: 1,
      finalPriceCents: 1500, newCustomer: { name: 'Friend', email } };
    const blocked = await as(cashier)({ method: 'POST', url: '/api/jobs', payload: body });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: 'approval_required', action: 'price.override' });
    expect(await dbm.db.select().from(schema.jobs).where(orm.eq(schema.jobs.clientRef, clientRef))).toHaveLength(0);
    expect(await dbm.db.select().from(schema.customers).where(orm.eq(schema.customers.email, email))).toHaveLength(0);
    const ok = await as(cashier)({ method: 'POST', url: '/api/jobs', payload: { ...body, approval: { name: manager.name, pin: manager.pin } } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ suggestedPriceCents: 2000, finalPriceCents: 1500 });
    const aps = await dbm.db.select().from(schema.approvals).where(orm.eq(schema.approvals.action, 'price.override'));
    expect(aps.some((a) => a.entityId === clientRef && a.approvedBy === manager.id)).toBe(true);

    // Editing that job's notes doesn't re-ask; changing the price again does.
    const id = ok.json().id;
    expect((await as(cashier)({ method: 'PUT', url: `/api/jobs/${id}`, payload: { notes: 'ok', finalPriceCents: 1500 } })).statusCode).toBe(200);
    const again = await as(cashier)({ method: 'PUT', url: `/api/jobs/${id}`, payload: { finalPriceCents: 1400 } });
    expect(again.statusCode).toBe(403);
    // Back to the suggestion needs nothing.
    expect((await as(cashier)({ method: 'PUT', url: `/api/jobs/${id}`, payload: { finalPriceCents: 2000 } })).statusCode).toBe(200);
  });

  it('a counter-sale line rung up below its suggested price needs a manager', async () => {
    const lines = [{ description: 'Stock magnet', qty: 1, unitPriceCents: 1500, suggestedUnitPriceCents: 2000 }];
    const blocked = await sale({ lines, amountCents: undefined }, cashier);
    expect(blocked.statusCode).toBe(403);
    const ok = await sale({ lines, amountCents: undefined, approval: { name: manager.name, pin: manager.pin } }, cashier);
    expect(ok.statusCode).toBe(201);
    expect((await detail(ok.json().invoice.number)).lines[0]).toMatchObject({ subtotalCents: 1500 });
  });
});

describe('drawer close + Z-report', () => {
  it('a cashier cannot close; a manager close computes over/short and freezes the Z-report', async () => {
    // Start a clean session so the totals are exactly this test's.
    await as(manager)({ method: 'POST', url: '/api/drawer/close', payload: { countedCashCents: 0 } });
    const open = (await inject({ method: 'POST', url: '/api/drawer/open', payload: { openingFloatCents: 15000 } })).json();

    const s1 = (await sale({ method: 'cash', amountCents: 2000, tenderedCents: 2000 })).json();
    const s2 = (await sale({ method: 'card', amountCents: 4000 })).json();
    const s3 = (await sale({ method: 'cash', title: 'Taxed', lines: [{ description: 'Sign', qty: 1, unitPriceCents: 1000, taxable: true }], amountCents: undefined })).json();
    const job = await makeJob({ finalPriceCents: 500 });
    await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 500, method: 'check' } });
    const line = (await detail(s3.invoice.number)).lines[0];
    await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s3.invoice.id, reason: 'x',
      refundMethod: 'cash', lines: [{ invoiceLineId: line.id, qty: 1 }] } });
    await inject({ method: 'POST', url: `/api/invoices/${s2.invoice.id}/void`, payload: { reason: 'dup' } });

    const denied = await as(cashier)({ method: 'POST', url: '/api/drawer/close', payload: { countedCashCents: 17000 } });
    expect(denied.statusCode).toBe(403);

    // Expected cash = float 15000 + 2000 + 1083 − 1083 (return) = 17000. Counted 16950 → short 50.
    const closed = await as(manager)({ method: 'POST', url: '/api/drawer/close', payload: { countedCashCents: 16950, countedChecksCents: 500 } });
    expect(closed.statusCode).toBe(200);
    const c = closed.json();
    expect(c).toMatchObject({ id: open.id, status: 'closed', final: true, expectedCashCents: 17000, countedCashCents: 16950,
      overShortCents: -50, checksOverShortCents: 0, closedByName: manager.name });
    const z = c.zReport;
    expect(z.byMethod.cash).toMatchObject({ paymentsCents: 3083, refundsCents: 1083, netCents: 2000 });
    expect(z.byMethod.card).toMatchObject({ paymentsCents: 4000, refundsCents: 4000, netCents: 0 });
    expect(z.byMethod.check).toMatchObject({ netCents: 500 });
    expect(z.sales).toMatchObject({ invoiceCount: 4, taxCents: 83,
      firstNumber: String(s1.invoice.number).padStart(6, '0') });
    expect(z.voids).toMatchObject({ count: 1, totalCents: 4000, refundCents: 4000 });
    expect(z.returns).toMatchObject({ count: 1, totalCents: 1083, taxCents: 83, refundCents: 1083 });
    expect(z.netTaxCents).toBe(0);

    const got = (await inject({ method: 'GET', url: `/api/drawer/${open.id}/z-report` })).json();
    expect(got).toMatchObject({ sessionId: open.id, final: true, cash: { overShortCents: -50 } });
    const csv = await inject({ method: 'GET', url: `/api/drawer/${open.id}/z-report.csv` });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toMatch(/cash,over_short,-0\.50/);
    expect(csv.body).toMatch(/sales,invoices,4/);

    // Closed = frozen, and cash is refused again until a new drawer opens.
    await expect(dbm.db.run(orm.sql`update drawer_sessions set counted_cash_cents = 17000 where id = ${open.id}`)).rejects.toThrow(/only change once/);
    const cash = await sale({ method: 'cash' });
    expect(cash.statusCode).toBe(409);
    const hist = (await inject({ method: 'GET', url: '/api/drawer?limit=1' })).json();
    expect(hist.rows[0].id).toBe(open.id);
    expect(hist.nextBefore).toBe(open.id);
    expect((await inject({ method: 'GET', url: '/api/drawer/current' })).json().drawer).toBeNull();
  });
});

describe('listing + database guards', () => {
  it('pages invoices newest first and filters by number / customer', async () => {
    const p1 = (await inject({ method: 'GET', url: '/api/invoices?limit=3' })).json();
    expect(p1.rows).toHaveLength(3);
    expect(p1.rows[0].number).toBeGreaterThan(p1.rows[2].number);
    const p2 = (await inject({ method: 'GET', url: `/api/invoices?limit=3&before=${p1.nextBefore}` })).json();
    expect(p2.rows[0].number).toBe(p1.rows[2].number - 1);
    const one = (await inject({ method: 'GET', url: '/api/invoices?number=000002' })).json();
    expect(one.rows.map((r: InvoiceHeader) => r.number)).toEqual([2]);
    const voided = (await inject({ method: 'GET', url: '/api/invoices?status=voided' })).json();
    expect(voided.rows.every((r: InvoiceHeader) => r.status === 'voided')).toBe(true);
    expect((await inject({ method: 'GET', url: '/api/invoices/999999' })).statusCode).toBe(404);
  });

  it('refuses DELETE/UPDATE on invoices, lines, voids, returns', async () => {
    const { sql } = orm;
    await expect(dbm.db.run(sql`delete from invoices where number = 1`)).rejects.toThrow(/hard delete/);
    await expect(dbm.db.run(sql`update invoices set total_cents = 1 where number = 1`)).rejects.toThrow(/immutable/);
    await expect(dbm.db.run(sql`delete from invoice_lines`)).rejects.toThrow(/hard delete/);
    await expect(dbm.db.run(sql`update invoice_lines set tax_cents = 0`)).rejects.toThrow(/immutable/);
    await expect(dbm.db.run(sql`delete from invoice_voids`)).rejects.toThrow(/hard delete/);
    await expect(dbm.db.run(sql`update returns set total_cents = 0`)).rejects.toThrow(/append-only/);
    await expect(dbm.db.run(sql`delete from return_lines`)).rejects.toThrow(/hard delete/);
    await expect(dbm.db.run(sql`delete from drawer_sessions`)).rejects.toThrow(/hard delete/);
    await expect(dbm.db.run(sql`update payments set drawer_session_id = null where drawer_session_id is not null`)).rejects.toThrow(/immutable/);
  });
});

describe('wave 1 fixes: voids after returns, refund + payment-void guards', () => {
  const openFresh = async () => {
    await as(manager)({ method: 'POST', url: '/api/drawer/close', payload: { countedCashCents: 0 } });
    const open = await inject({ method: 'POST', url: '/api/drawer/open', payload: { openingFloatCents: 0 } });
    expect(open.statusCode).toBe(201);
    return open.json() as { id: number };
  };

  it('Z-report: a void after a return counts only what the void cancelled (net sales 0, net tax 0)', async () => {
    await openFresh();
    const s = (await sale({ title: 'Five signs', lines: [{ description: 'Sign', qty: 5, unitPriceCents: 2000, taxable: true }], amountCents: undefined })).json();
    const line = (await detail(s.invoice.number)).lines[0];
    expect(line).toMatchObject({ subtotalCents: 10000, taxCents: 825 });
    const r = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'one extra', refundMethod: 'card', lines: [{ invoiceLineId: line.id, qty: 1 }] } });
    expect(r.json()).toMatchObject({ totalCents: 2165, taxCents: 165 });
    const v = await inject({ method: 'POST', url: `/api/invoices/${s.invoice.id}/void`, payload: { reason: 'cancelled' } });
    expect(v.statusCode).toBe(201);
    expect(v.json().void).toMatchObject({ netTotalCents: 10825 - 2165, netTaxCents: 825 - 165, refundCents: 10825 - 2165 });
    const z = (await as(manager)({ method: 'POST', url: '/api/drawer/close', payload: { countedCashCents: 0 } })).json().zReport;
    expect(z.sales).toMatchObject({ totalCents: 10825, taxCents: 825 });
    expect(z.returns).toMatchObject({ totalCents: 2165, taxCents: 165 });
    expect(z.voids).toMatchObject({ totalCents: 8660, taxCents: 660 });
    expect(z.netSalesCents).toBe(0);
    expect(z.netTaxCents).toBe(0);
  });

  it('a void after a damaged (not restocked) return puts back only what the customer still had', async () => {
    await openFresh();
    const item = await makeItem(10);
    const s = (await sale({ title: 'Blanks', lines: [{ description: 'Blank', qty: 5, unitPriceCents: 500, inventoryItemId: item.id }], amountCents: undefined })).json();
    expect(await itemCount(item.id)).toBe(5);
    const line = (await detail(s.invoice.number)).lines[0];
    const r = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'damaged', refundMethod: 'card', lines: [{ invoiceLineId: line.id, qty: 2, restock: false }] } });
    expect(r.statusCode).toBe(201);
    expect(await itemCount(item.id)).toBe(5);
    const v = await inject({ method: 'POST', url: `/api/invoices/${s.invoice.id}/void`, payload: { reason: 'cancel rest' } });
    expect(v.json().restocked).toEqual([{ inventoryItemId: item.id, qty: 3 }]);
    expect(await itemCount(item.id)).toBe(8);
  });

  it('a return never restocks more than the sale took off the shelf', async () => {
    const item = await makeItem(2);
    const s = (await sale({ title: 'Short stock', lines: [{ description: 'Decal', qty: 5, unitPriceCents: 100, inventoryItemId: item.id }], amountCents: undefined })).json();
    expect(await itemCount(item.id)).toBe(0); // the sale clamped at zero: it took 2
    const line = (await detail(s.invoice.number)).lines[0];
    expect(line.stockQty).toBe(2);
    const r1 = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'x', refundMethod: 'card', lines: [{ invoiceLineId: line.id, qty: 3, restock: true }] } });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().lines[0]).toMatchObject({ qty: 3, restockedQty: 2 });
    expect(await itemCount(item.id)).toBe(2);
    const r2 = await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'x', refundMethod: 'card', lines: [{ invoiceLineId: line.id, qty: 2, restock: true }] } });
    expect(r2.json().lines[0]).toMatchObject({ qty: 2, restockedQty: 0 });
    expect(await itemCount(item.id)).toBe(2);
  });

  it('a $0 pickup takes no invoice number', async () => {
    const job = await makeJob({ finalPriceCents: 0 });
    for (const st of ['in_progress', 'done']) await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: st } });
    const before = await nextInvoiceNumber();
    const up = await inject({ method: 'PUT', url: `/api/jobs/${job.id}/status`, payload: { status: 'picked_up' } });
    expect(up.statusCode).toBe(200);
    expect(await nextInvoiceNumber()).toBe(before);
    expect((await inject({ method: 'GET', url: `/api/invoices?jobId=${job.id}` })).json().rows).toHaveLength(0);
  });

  it('POST /api/payments refuses a refund larger than what was paid', async () => {
    const job = await makeJob({ finalPriceCents: 5000 });
    await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 1000, method: 'card' } });
    const over = await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 1500, method: 'card', kind: 'refund' } });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toMatch(/more than was paid/);
    const ok = await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 1000, method: 'card', kind: 'refund' } });
    expect(ok.statusCode).toBe(201);
  });

  it('payment void refuses return/void refunds and payments in a closed drawer', async () => {
    await openFresh();
    const s = (await sale({ amountCents: 3000 })).json();
    const line = (await detail(s.invoice.number)).lines[0];
    const r = (await inject({ method: 'POST', url: '/api/returns', payload: { clientRef: ref(), invoiceId: s.invoice.id,
      reason: 'x', refundMethod: 'card', lines: [{ invoiceLineId: line.id, qty: 1 }] } })).json();
    const retVoid = await inject({ method: 'POST', url: `/api/payments/${r.refunds[0].id}/void`, payload: { reason: 'oops' } });
    expect(retVoid.statusCode).toBe(409);
    expect(retVoid.json().error).toMatch(/issue a refund\/return instead/);

    const s2 = (await sale({ amountCents: 1200 })).json();
    const v = (await inject({ method: 'POST', url: `/api/invoices/${s2.invoice.id}/void`, payload: { reason: 'dup' } })).json();
    expect((await inject({ method: 'POST', url: `/api/payments/${v.refunds[0].id}/void`, payload: { reason: 'oops' } })).statusCode).toBe(409);

    const job = await makeJob({ finalPriceCents: 5000 });
    const early = (await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 700, method: 'card' } })).json();
    const kept = (await inject({ method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 800, method: 'card' } })).json();
    expect(kept.drawerSessionId).not.toBeNull();
    // While the drawer is open a payment can still be voided.
    expect((await inject({ method: 'POST', url: `/api/payments/${early.id}/void`, payload: { reason: 'typo' } })).statusCode).toBe(200);
    await as(manager)({ method: 'POST', url: '/api/drawer/close', payload: { countedCashCents: 0 } });
    const late = await inject({ method: 'POST', url: `/api/payments/${kept.id}/void`, payload: { reason: 'typo' } });
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toMatch(/closed drawer/);
  });
});
