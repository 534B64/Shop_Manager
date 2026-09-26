// Phase 1b (ADR 0005): archive instead of delete, DB-level hard-delete and
// immutability triggers, the audit log, transactions (rollback), job-line
// soft delete, and the SQL-side jobs search. Own throwaway SQLite file.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { TestUser } from './test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
let dbm: typeof import('./db/index.js');
let schema: typeof import('./db/schema/index.js');
let orm: typeof import('drizzle-orm');

const inject = (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { authorization: `Bearer ${admin.token}`, ...(opts.headers ?? {}) } });
const ref = () => crypto.randomUUID();
const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-1b-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  dbm = await import('./db/index.js');
  schema = await import('./db/schema/index.js');
  orm = await import('drizzle-orm');
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
  // Cash needs an open drawer (Phase 3, ADR 0007).
  await app.inject({ method: 'POST', url: '/api/drawer/open', headers: admin.headers, payload: { openingFloatCents: 0 } });
});

afterAll(async () => {
  await app.close();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

async function makeCustomer(name = `Cust ${uniq()}`) {
  const res = await inject({ method: 'POST', url: '/api/customers', payload: { name, email: `${uniq()}@x.example` } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: number; name: string };
}

async function makeJob(over: Record<string, unknown> = {}) {
  const res = await inject({ method: 'POST', url: '/api/jobs', payload: {
    clientRef: ref(), type: 'decal', title: `Job ${uniq()}`, status: 'acknowledged', finalPriceCents: 10000, ...over,
  } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: number; po: string; items: { id: number; title: string }[] };
}

async function pay(jobId: number, amountCents = 1000) {
  const res = await inject({ method: 'POST', url: '/api/payments',
    payload: { clientRef: ref(), jobId, amountCents, method: 'cash' } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: number };
}

async function auditRows(entity: string, entityId: number | string) {
  const { auditLog } = schema;
  return dbm.db.select().from(auditLog)
    .where(orm.and(orm.eq(auditLog.entity, entity), orm.eq(auditLog.entityId, String(entityId))))
    .orderBy(auditLog.id);
}

describe('archive instead of delete', () => {
  it('DELETE customer archives it and keeps its credit ledger', async () => {
    const c = await makeCustomer();
    const credit = await inject({ method: 'POST', url: `/api/customers/${c.id}/credit`, payload: { deltaCents: 500, note: 'goodwill' } });
    expect(credit.statusCode).toBe(200);

    const del = await inject({ method: 'DELETE', url: `/api/customers/${c.id}`, payload: {} });
    expect(del.statusCode).toBe(200);

    const { customers, customerCredits } = schema;
    const [row] = await dbm.db.select().from(customers).where(orm.eq(customers.id, c.id));
    expect(row.archivedAt).toBeTruthy();
    expect(row.archivedBy).toBe(admin.id);
    const credits = await dbm.db.select().from(customerCredits).where(orm.eq(customerCredits.customerId, c.id));
    expect(credits).toHaveLength(1);
    // The account view still opens (old orders link to it) with its balance.
    const detail = (await inject({ method: 'GET', url: `/api/customers/${c.id}` })).json();
    expect(detail.creditCents).toBe(500);
  });

  it('hides archived customers from the list, shows them with includeArchived, and unarchive restores', async () => {
    const c = await makeCustomer(`Archivable ${uniq()}`);
    await inject({ method: 'DELETE', url: `/api/customers/${c.id}`, payload: {} });

    const ids = async (url: string) => ((await inject({ method: 'GET', url })).json() as { id: number }[]).map((r) => r.id);
    expect(await ids('/api/customers')).not.toContain(c.id);
    expect(await ids(`/api/customers?q=${encodeURIComponent(c.name)}`)).not.toContain(c.id); // picker search
    expect(await ids('/api/customers?includeArchived=1')).toContain(c.id);

    const un = await inject({ method: 'POST', url: `/api/customers/${c.id}/unarchive`, payload: {} });
    expect(un.statusCode).toBe(200);
    expect(un.json().archivedAt).toBeNull();
    expect(await ids('/api/customers')).toContain(c.id);
  });

  it('a cashier needs manager approval to archive or restore a customer', async () => {
    const { createUserWithToken } = await import('./test-helpers.js');
    const cashier = await createUserWithToken(app, 'cashier');
    const c = await makeCustomer();
    const res = await inject({ method: 'DELETE', url: `/api/customers/${c.id}`, payload: {}, headers: cashier.headers });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('approval_required');
  });

  it('archived materials leave the picker but old jobs still show them', async () => {
    const m = (await inject({ method: 'POST', url: '/api/materials',
      payload: { name: `Mat ${uniq()}`, unit: 'sqft', costPerUnitCents: 100 } })).json();
    const job = await makeJob({ materialId: m.id });
    expect((await inject({ method: 'DELETE', url: `/api/materials/${m.id}` })).statusCode).toBe(200);

    const picker = (await inject({ method: 'GET', url: '/api/materials' })).json() as { id: number }[];
    expect(picker.some((x) => x.id === m.id)).toBe(false);
    const admin_ = (await inject({ method: 'GET', url: '/api/materials?all=1&includeArchived=1' })).json() as { id: number }[];
    expect(admin_.some((x) => x.id === m.id)).toBe(true);
    const j = (await inject({ method: 'GET', url: `/api/jobs/${job.id}` })).json();
    expect(j.materialName).toBe(m.name);

    expect((await inject({ method: 'POST', url: `/api/materials/${m.id}/unarchive` })).json().archivedAt).toBeNull();
  });

  it('archives categories without touching their items or sizes', async () => {
    const cat = (await inject({ method: 'POST', url: '/api/categories', payload: { name: `Cat ${uniq()}` } })).json();
    const size = (await inject({ method: 'POST', url: `/api/categories/${cat.id}/sizes`, payload: { label: 'XL' } })).json();
    const item = (await inject({ method: 'POST', url: '/api/inventory', payload: { name: `It ${uniq()}`, categoryId: cat.id } })).json();
    expect((await inject({ method: 'DELETE', url: `/api/categories/${cat.id}` })).statusCode).toBe(200);

    const items = (await inject({ method: 'GET', url: '/api/inventory' })).json() as { id: number; categoryId: number }[];
    expect(items.find((i) => i.id === item.id)!.categoryId).toBe(cat.id);
    const sizes = (await inject({ method: 'GET', url: `/api/categories/${cat.id}/sizes` })).json() as { id: number }[];
    expect(sizes.map((s) => s.id)).toContain(size.id);
    const cats = (await inject({ method: 'GET', url: '/api/categories?all=1' })).json() as { id: number }[];
    expect(cats.some((c) => c.id === cat.id)).toBe(false);
  });
});

describe('database refuses hard deletes and money edits', () => {
  it('raw DELETE on payments, customers, and audit_log throws', async () => {
    const job = await makeJob();
    const p = await pay(job.id);
    const c = await makeCustomer();
    const { sql } = orm;
    await expect(dbm.db.run(sql`DELETE FROM payments WHERE id = ${p.id}`)).rejects.toThrow(/hard delete not allowed/);
    await expect(dbm.db.run(sql`DELETE FROM customers WHERE id = ${c.id}`)).rejects.toThrow(/hard delete not allowed/);
    await expect(dbm.db.run(sql`DELETE FROM jobs WHERE id = ${job.id}`)).rejects.toThrow(/hard delete not allowed/);
    await expect(dbm.db.run(sql`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
  });

  it('UPDATE of a payment amount throws, but voiding works (once)', async () => {
    const job = await makeJob();
    const p = await pay(job.id, 2500);
    const { sql } = orm;
    await expect(dbm.db.run(sql`UPDATE payments SET amount_cents = 1 WHERE id = ${p.id}`)).rejects.toThrow(/immutable/);
    await expect(dbm.db.run(sql`UPDATE payments SET method = 'card' WHERE id = ${p.id}`)).rejects.toThrow(/immutable/);

    const v = await inject({ method: 'POST', url: `/api/payments/${p.id}/void`, payload: { reason: 'wrong job' } });
    expect(v.statusCode).toBe(200);
    expect(v.json().voidedAt).toBeTruthy();
    // No un-voiding behind the app's back.
    await expect(dbm.db.run(sql`UPDATE payments SET voided_at = NULL WHERE id = ${p.id}`)).rejects.toThrow(/immutable/);
  });

  it('audit_log and inventory_adjustments rows cannot be updated', async () => {
    const { sql } = orm;
    await makeCustomer(); // guarantees at least one audit row
    await expect(dbm.db.run(sql`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/append-only/);
    const item = (await inject({ method: 'POST', url: '/api/inventory', payload: { name: `It ${uniq()}`, count: 1 } })).json();
    await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: 2, reason: 'received' } });
    await expect(dbm.db.run(sql`UPDATE inventory_adjustments SET delta = 99 WHERE item_id = ${item.id}`)).rejects.toThrow(/append-only/);
  });
});

describe('audit log', () => {
  it('a mutating route writes exactly one audit row with before/after and the user', async () => {
    const c = await makeCustomer('Before Name');
    const n0 = (await auditRows('customer', c.id)).length;
    const res = await inject({ method: 'PUT', url: `/api/customers/${c.id}`, payload: { name: 'After Name' } });
    expect(res.statusCode).toBe(200);
    const rows = await auditRows('customer', c.id);
    expect(rows).toHaveLength(n0 + 1);
    const row = rows[rows.length - 1];
    expect(row.action).toBe('customer.update');
    expect(row.userId).toBe(admin.id);
    expect(row.requestId).toBeTruthy();
    expect(JSON.parse(row.beforeJson!).name).toBe('Before Name');
    expect(JSON.parse(row.afterJson!).name).toBe('After Name');
    expect(row.approvalId).toBeNull();
  });

  it('an approval-gated action links the approvals row', async () => {
    const { createUserWithToken } = await import('./test-helpers.js');
    const cashier = await createUserWithToken(app, 'cashier');
    const manager = await createUserWithToken(app, 'manager');
    const job = await makeJob();
    const p = await pay(job.id);
    const res = await inject({ method: 'POST', url: `/api/payments/${p.id}/void`, headers: cashier.headers,
      payload: { reason: 'typo', approval: { name: manager.name, pin: manager.pin } } });
    expect(res.statusCode).toBe(200);

    const [row] = (await auditRows('payment', p.id)).filter((r) => r.action === 'payment.void');
    expect(row.userId).toBe(cashier.id);
    expect(row.approvalId).toBeTruthy();
    const { approvals } = schema;
    const [ap] = await dbm.db.select().from(approvals).where(orm.eq(approvals.id, row.approvalId!));
    expect(ap).toMatchObject({ action: 'payment.void', requestedBy: cashier.id, approvedBy: manager.id });
    expect(JSON.parse(row.beforeJson!).voidedAt).toBeNull();
    expect(JSON.parse(row.afterJson!).voidedAt).toBeTruthy();
  });

  it('GET /api/audit is admin-only, filters, and pages with a before cursor; CSV exports', async () => {
    const { createUserWithToken } = await import('./test-helpers.js');
    const manager = await createUserWithToken(app, 'manager');
    expect((await inject({ method: 'GET', url: '/api/audit', headers: manager.headers })).statusCode).toBe(403);

    const c = await makeCustomer();
    for (const name of ['A', 'B', 'C']) {
      await inject({ method: 'PUT', url: `/api/customers/${c.id}`, payload: { name: `${name} ${uniq()}` } });
    }
    const page1 = (await inject({ method: 'GET', url: `/api/audit?entity=customer&entityId=${c.id}&limit=2` })).json();
    expect(page1.rows).toHaveLength(2);
    expect(page1.rows[0].id).toBeGreaterThan(page1.rows[1].id); // newest first
    const page2 = (await inject({ method: 'GET', url: `/api/audit?entity=customer&entityId=${c.id}&limit=2&before=${page1.nextBefore}` })).json();
    expect(page2.rows).toHaveLength(2); // 3 updates + the create
    expect(page2.rows[1].action).toBe('customer.create');
    const byUser = (await inject({ method: 'GET', url: `/api/audit?userId=${manager.id}` })).json();
    expect(byUser.rows.every((r: { userId: number }) => r.userId === manager.id)).toBe(true);
    const capped = (await inject({ method: 'GET', url: '/api/audit?limit=5000' })).json();
    expect(capped.rows.length).toBeLessThanOrEqual(200);

    const csv = await inject({ method: 'GET', url: `/api/audit.csv?entity=customer&entityId=${c.id}` });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body.split('\n')).toHaveLength(5); // header + 4 rows
  });
});

describe('transactions', () => {
  it('rolls back the whole counter sale when the inventory step fails midway', async () => {
    const { sql } = orm;
    const item = (await inject({ method: 'POST', url: '/api/inventory', payload: { name: `It ${uniq()}`, count: 5 } })).json();
    // Test-only trigger (throwaway DB): the stock-deduction insert fails AFTER
    // the job and payment rows were written in the same transaction.
    await dbm.db.run(sql.raw(`CREATE TRIGGER test_fail_sold BEFORE INSERT ON inventory_adjustments
      WHEN NEW.note LIKE '%ROLLBACK-TEST%' BEGIN SELECT RAISE(ABORT, 'forced failure'); END`));
    try {
      const clientRef = ref();
      const res = await inject({ method: 'POST', url: '/api/pos/sale',
        payload: { clientRef, title: 'ROLLBACK-TEST', amountCents: 900, method: 'cash', inventoryItemId: item.id, stockQty: 2 } });
      expect(res.statusCode).toBe(500);

      const { jobs, payments, inventoryAdjustments, inventoryItems, auditLog } = schema;
      expect(await dbm.db.select().from(jobs).where(orm.eq(jobs.clientRef, clientRef))).toHaveLength(0);
      expect(await dbm.db.select().from(payments).where(orm.eq(payments.clientRef, `${clientRef}:pay`))).toHaveLength(0);
      // Only the opening-balance transaction from creating the item (ADR 0006).
      const txns = await dbm.db.select().from(inventoryAdjustments).where(orm.eq(inventoryAdjustments.itemId, item.id));
      expect(txns.map((t) => t.txnType)).toEqual(['opening']);
      const [it] = await dbm.db.select().from(inventoryItems).where(orm.eq(inventoryItems.id, item.id));
      expect(it.count).toBe(5);
      const audits = await dbm.db.select().from(auditLog).where(orm.like(auditLog.afterJson, '%ROLLBACK-TEST%'));
      expect(audits).toHaveLength(0);
    } finally {
      await dbm.db.run(sql.raw('DROP TRIGGER test_fail_sold'));
    }
    // The writer is healthy afterwards.
    const ok = await inject({ method: 'POST', url: '/api/pos/sale',
      payload: { clientRef: ref(), title: 'After rollback', amountCents: 900, method: 'cash', inventoryItemId: item.id, stockQty: 2 } });
    expect(ok.statusCode).toBe(201);
  });

  it('serializes concurrent writes without SQLITE_BUSY', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => makeCustomer()));
    expect(new Set(results.map((r) => r.id)).size).toBe(20);
  });
});

describe('job lines are soft-deleted on edit', () => {
  it('keeps replaced lines as deleted rows and hides them from readers', async () => {
    const job = await makeJob({ items: [
      { type: 'decal', title: 'Line A', qty: 1, priceCents: 500 },
      { type: 'decal', title: 'Line B', qty: 2, priceCents: 700 },
    ] });
    expect(job.items).toHaveLength(2);
    const edit = await inject({ method: 'PUT', url: `/api/jobs/${job.id}`,
      payload: { items: [{ type: 'decal', title: 'Line C', qty: 1, priceCents: 900 }] } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().items.map((i: { title: string }) => i.title)).toEqual(['Line C']);

    const got = (await inject({ method: 'GET', url: `/api/jobs/${job.id}` })).json();
    expect(got.items.map((i: { title: string }) => i.title)).toEqual(['Line C']);

    const { jobItems } = schema;
    const all = await dbm.db.select().from(jobItems).where(orm.eq(jobItems.jobId, job.id)).orderBy(jobItems.id);
    expect(all).toHaveLength(3);
    expect(all.filter((r) => r.deletedAt).map((r) => r.title)).toEqual(['Line A', 'Line B']);

    const [row] = (await auditRows('job', job.id)).filter((r) => r.action === 'job.update');
    expect(JSON.parse(row.beforeJson!).items).toHaveLength(2);
    expect(JSON.parse(row.afterJson!).items).toHaveLength(1);
  });
});

describe('jobs search', () => {
  it('finds an old job beyond the row limit (filter runs in SQL before LIMIT)', async () => {
    const needle = `Needle-${uniq()}`;
    const old = await makeJob({ title: `${needle} banner` });
    for (let i = 0; i < 55; i++) await makeJob({ title: `Filler ${i}` });

    const page = (await inject({ method: 'GET', url: '/api/jobs' })).json() as { id: number }[];
    expect(page).toHaveLength(50);
    expect(page.some((j) => j.id === old.id)).toBe(false); // pushed off the default page

    const hit = (await inject({ method: 'GET', url: `/api/jobs?q=${encodeURIComponent(needle.toLowerCase())}` })).json() as { id: number }[];
    expect(hit.map((j) => j.id)).toEqual([old.id]);
    // PO search still works, and LIKE wildcards in the text are literal.
    const byPo = (await inject({ method: 'GET', url: `/api/jobs?q=${old.po}` })).json() as { id: number }[];
    expect(byPo.map((j) => j.id)).toContain(old.id);
    expect((await inject({ method: 'GET', url: '/api/jobs?q=%25%25' })).json()).toEqual([]);
  });
});
