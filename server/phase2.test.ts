// Phase 2 (ADR 0006): the perpetual inventory ledger. On-hand only moves
// through inventory transactions (DB-enforced), locations + transfers, moving
// weighted-average cost, and the count → submit → approve/post flow.
// Own throwaway SQLite file.
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

const as = (u: TestUser) => (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...u.headers, ...(opts.headers ?? {}) } });
const inject = (opts: InjectOptions) => as(admin)(opts);
const uniq = () => Math.random().toString(36).slice(2, 8);
const tmpFiles: string[] = [];

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-2-${Date.now()}-${uniq()}.db`);
  tmpFiles.push(dbFile);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  dbm = await import('./db/index.js');
  orm = await import('drizzle-orm');
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
  manager = await createUserWithToken(app, 'manager');
  cashier = await createUserWithToken(app, 'cashier');
});

afterAll(async () => {
  await app.close();
  for (const f of tmpFiles) for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(f + s); } catch { /* ignore */ }
  }
});

type Item = { id: number; name: string; count: number; avgCostCents: number; lastCostCents: number | null };

async function makeItem(body: Record<string, unknown> = {}) {
  const res = await inject({ method: 'POST', url: '/api/inventory', payload: { name: `Item ${uniq()}`, ...body } });
  expect(res.statusCode).toBe(201);
  return res.json() as Item;
}

async function getItem(id: number) {
  const rows = await dbm.db.all<{ id: number; count: number; avg_cost_cents: number }>(
    orm.sql`select id, count, avg_cost_cents from inventory_items where id = ${id}`);
  return rows[0];
}

async function ledgerSum(itemId: number, locationId?: number) {
  const rows = await dbm.db.all<{ s: number }>(locationId == null
    ? orm.sql`select coalesce(sum(delta), 0) as s from inventory_adjustments where item_id = ${itemId}`
    : orm.sql`select coalesce(sum(delta), 0) as s from inventory_adjustments where item_id = ${itemId} and location_id = ${locationId}`);
  return Number(rows[0].s);
}

async function balance(itemId: number, locationId: number) {
  const rows = await dbm.db.all<{ on_hand: number }>(
    orm.sql`select on_hand from inventory_balances where item_id = ${itemId} and location_id = ${locationId}`);
  return rows[0]?.on_hand ?? 0;
}

const receive = (id: number, delta: number, unitCostCents?: number) =>
  inject({ method: 'POST', url: `/api/inventory/${id}/adjust`,
    payload: { delta, reason: 'received', ...(unitCostCents != null ? { unitCostCents } : {}) } });

const counterSale = (itemId: number, qty: number) =>
  inject({ method: 'POST', url: '/api/pos/sale', payload: {
    clientRef: crypto.randomUUID(), title: `Sale ${uniq()}`, amountCents: 500, method: 'cash',
    inventoryItemId: itemId, stockQty: qty } });

async function expectRaw(fn: () => Promise<unknown>, pattern: RegExp) {
  await expect(fn()).rejects.toThrow(pattern);
}

describe('on-hand only moves through the ledger', () => {
  it('a raw UPDATE of inventory_items.count is refused by the database', async () => {
    const item = await makeItem({ count: 5 });
    await expectRaw(() => dbm.db.run(orm.sql`update inventory_items set count = 99 where id = ${item.id}`),
      /inventory transactions/);
    expect((await getItem(item.id)).count).toBe(5);
  });

  it('a raw INSERT of an item with a non-zero count is refused', async () => {
    await expectRaw(() => dbm.db.run(orm.sql`insert into inventory_items (name, count, created_at) values ('sneaky', 3, '2026-01-01')`),
      /inventory transactions/);
  });

  it('a raw UPDATE of a balance is refused', async () => {
    const item = await makeItem({ count: 2 });
    await expectRaw(() => dbm.db.run(orm.sql`update inventory_balances set on_hand = 50 where item_id = ${item.id}`),
      /inventory transactions/);
  });

  it('ledger rows are append-only', async () => {
    const item = await makeItem({ count: 2 });
    await expectRaw(() => dbm.db.run(orm.sql`update inventory_adjustments set delta = 100 where item_id = ${item.id}`),
      /append-only/);
  });

  it('editing an item cannot change its count', async () => {
    const item = await makeItem({ count: 4 });
    const res = await inject({ method: 'PUT', url: `/api/inventory/${item.id}`, payload: { count: 10 } });
    expect(res.statusCode).toBe(400);
    expect((await getItem(item.id)).count).toBe(4);
    const ok = await inject({ method: 'PUT', url: `/api/inventory/${item.id}`, payload: { name: 'Renamed' } });
    expect(ok.statusCode).toBe(200);
  });

  it('creating an item with a starting count writes one opening transaction', async () => {
    const item = await makeItem({ count: 7 });
    expect(item.count).toBe(7);
    const res = await inject({ method: 'GET', url: `/api/inventory/${item.id}/transactions` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rows = (Array.isArray(body) ? body : body.transactions ?? body.rows) as { txnType: string; delta: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ txnType: 'opening', delta: 7 });
  });

  it('a mixed sequence keeps count == ledger sum == balances', async () => {
    const item = await makeItem({ count: 10 });
    expect((await receive(item.id, 5, 300)).statusCode).toBe(200);
    expect((await counterSale(item.id, 3)).statusCode).toBeLessThan(300);
    const adj = await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: -2, reason: 'damaged' } });
    expect(adj.statusCode).toBe(200);
    const loc = await inject({ method: 'POST', url: '/api/locations', payload: { name: `Van ${uniq()}` } });
    expect(loc.statusCode).toBe(201);
    const locId = loc.json().id as number;
    const tr = await inject({ method: 'POST', url: `/api/inventory/${item.id}/transfer`,
      payload: { fromLocationId: 1, toLocationId: locId, qty: 4 } });
    expect(tr.statusCode).toBe(200);

    const now = await getItem(item.id);
    expect(now.count).toBe(10 + 5 - 3 - 2);
    expect(await ledgerSum(item.id)).toBe(now.count);
    expect(await balance(item.id, 1) + await balance(item.id, locId)).toBe(now.count);
    expect(await balance(item.id, locId)).toBe(4);
    expect(await ledgerSum(item.id, locId)).toBe(4);

    const rec = await inject({ method: 'GET', url: '/api/inventory/reconcile' });
    expect(rec.statusCode).toBe(200);
    expect(rec.json().ok).toBe(true);
  });
});

describe('adjustments', () => {
  it('require a reason code', async () => {
    const item = await makeItem({ count: 3 });
    const res = await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: -1 } });
    expect(res.statusCode).toBe(400);
  });

  it('by a cashier need manager approval; receiving does not', async () => {
    const item = await makeItem({ count: 3 });
    const blocked = await as(cashier)({ method: 'POST', url: `/api/inventory/${item.id}/adjust`,
      payload: { delta: -1, reason: 'damaged' } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('approval_required');
    expect((await getItem(item.id)).count).toBe(3);

    const approved = await as(cashier)({ method: 'POST', url: `/api/inventory/${item.id}/adjust`,
      payload: { delta: -1, reason: 'damaged', approval: { name: manager.name, pin: manager.pin } } });
    expect(approved.statusCode).toBe(200);
    expect((await getItem(item.id)).count).toBe(2);

    const recv = await as(cashier)({ method: 'POST', url: `/api/inventory/${item.id}/adjust`,
      payload: { delta: 4, reason: 'received' } });
    expect(recv.statusCode).toBe(200);
    expect((await getItem(item.id)).count).toBe(6);
  });

  it('cannot take on-hand below zero', async () => {
    const item = await makeItem({ count: 1 });
    const res = await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: -5, reason: 'damaged' } });
    expect(res.statusCode).toBe(409);
  });
});

describe('transfers', () => {
  it('move stock between locations without changing the total, manager+ only', async () => {
    const item = await makeItem({ count: 6 });
    const loc = (await inject({ method: 'POST', url: '/api/locations', payload: { name: `Shelf ${uniq()}` } })).json();
    const denied = await as(cashier)({ method: 'POST', url: `/api/inventory/${item.id}/transfer`,
      payload: { fromLocationId: 1, toLocationId: loc.id, qty: 2 } });
    expect(denied.statusCode).toBe(403);
    const ok = await as(manager)({ method: 'POST', url: `/api/inventory/${item.id}/transfer`,
      payload: { fromLocationId: 1, toLocationId: loc.id, qty: 2 } });
    expect(ok.statusCode).toBe(200);
    expect((await getItem(item.id)).count).toBe(6);
    expect(await balance(item.id, 1)).toBe(4);
    expect(await balance(item.id, loc.id)).toBe(2);
    const tooMany = await inject({ method: 'POST', url: `/api/inventory/${item.id}/transfer`,
      payload: { fromLocationId: loc.id, toLocationId: 1, qty: 3 } });
    expect(tooMany.statusCode).toBe(409);
  });
});

describe('moving weighted-average cost', () => {
  it('converts purchase-unit cost by the UOM factor and averages receipts', async () => {
    // 1 box (purchase unit) = 10 each (count unit).
    const item = await makeItem({ purchaseToCountFactor: 10 });
    expect((await receive(item.id, 10, 1000)).statusCode).toBe(200); // $10/box → 100¢ each
    expect((await getItem(item.id)).avg_cost_cents).toBe(100);
    expect((await receive(item.id, 10, 2000)).statusCode).toBe(200); // 200¢ each
    expect((await getItem(item.id)).avg_cost_cents).toBe(150);
  });

  it('resets to the receipt cost when nothing was on hand', async () => {
    const item = await makeItem();
    expect((await receive(item.id, 4, 500)).statusCode).toBe(200);
    const down = await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: -4, reason: 'waste_scrap' } });
    expect(down.statusCode).toBe(200);
    expect((await receive(item.id, 2, 900)).statusCode).toBe(200);
    expect((await getItem(item.id)).avg_cost_cents).toBe(900);
  });

  it('stamps non-receipt transactions with the current average', async () => {
    const item = await makeItem();
    await receive(item.id, 5, 250);
    await counterSale(item.id, 1);
    const rows = await dbm.db.all<{ txn_type: string; unit_cost_cents: number }>(
      orm.sql`select txn_type, unit_cost_cents from inventory_adjustments where item_id = ${item.id} and txn_type = 'sale'`);
    expect(rows[0].unit_cost_cents).toBe(250);
  });
});

describe('cycle count: count → submit → approve/post', () => {
  async function openSession() {
    // Clear any session left open by an earlier test (posting queues the next one).
    const next = (await inject({ method: 'GET', url: '/api/cycle-counts/next' })).json();
    if (next) return next as { id: number };
    const res = await inject({ method: 'POST', url: '/api/cycle-counts', payload: { scheduledFor: '2026-10-01' } });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: number };
  }

  it('submit changes nothing; post applies the variance even after a later sale', async () => {
    const item = await makeItem({ count: 20 });
    const cc = await openSession();
    const sub = await as(cashier)({ method: 'POST', url: `/api/cycle-counts/${cc.id}/submit`,
      payload: { counts: [{ itemId: item.id, counted: 17, reasonCode: 'waste_scrap' }] } });
    expect(sub.statusCode).toBe(200);
    expect(sub.json().status).toBe('submitted');
    expect((await getItem(item.id)).count).toBe(20);

    // A sale happens between the count and the posting.
    expect((await counterSale(item.id, 2)).statusCode).toBeLessThan(300);
    expect((await getItem(item.id)).count).toBe(18);

    // A cashier can't post without a manager.
    const denied = await as(cashier)({ method: 'POST', url: `/api/cycle-counts/${cc.id}/post`, payload: {} });
    expect(denied.statusCode).toBe(403);
    expect((await getItem(item.id)).count).toBe(18);

    const posted = await as(manager)({ method: 'POST', url: `/api/cycle-counts/${cc.id}/post`, payload: {} });
    expect(posted.statusCode).toBe(200);
    // Variance was −3 (17 counted vs 20 at count time): 18 − 3 = 15, not 17.
    expect((await getItem(item.id)).count).toBe(15);
    expect(await ledgerSum(item.id)).toBe(15);

    const again = await as(manager)({ method: 'POST', url: `/api/cycle-counts/${cc.id}/post`, payload: {} });
    expect(again.statusCode).toBe(409);
  });

  it('a manager can send a submitted count back; a cashier cannot', async () => {
    const item = await makeItem({ count: 5 });
    const cc = await openSession();
    const sub = await as(cashier)({ method: 'POST', url: `/api/cycle-counts/${cc.id}/submit`,
      payload: { counts: [{ itemId: item.id, counted: 5 }] } });
    expect(sub.statusCode).toBe(200);
    const denied = await as(cashier)({ method: 'POST', url: `/api/cycle-counts/${cc.id}/send-back`, payload: {} });
    expect(denied.statusCode).toBe(403);
    const back = await as(manager)({ method: 'POST', url: `/api/cycle-counts/${cc.id}/send-back`, payload: { reason: 'recount aisle 2' } });
    expect(back.statusCode).toBe(200);
    expect(back.json().status).toBe('counting');
    // Re-submit and post in one step as a manager.
    const both = await as(manager)({ method: 'POST', url: `/api/cycle-counts/${cc.id}/submit`,
      payload: { counts: [{ itemId: item.id, counted: 6, reasonCode: 'correction' }], post: true } });
    expect(both.statusCode).toBe(200);
    expect(both.json().status).toBe('posted');
    expect((await getItem(item.id)).count).toBe(6);
  });

  it('reconcile is still clean after all of the above', async () => {
    const rec = await inject({ method: 'GET', url: '/api/inventory/reconcile' });
    expect(rec.json()).toMatchObject({ ok: true, items: [], balances: [] });
    const denied = await as(cashier)({ method: 'GET', url: '/api/inventory/reconcile' });
    expect(denied.statusCode).toBe(403);
  });
});

describe('migration 0015 on pre-ledger data', () => {
  it('backfills opening balances so every item satisfies the invariant', async () => {
    const { createClient } = await import('@libsql/client');
    const { drizzle } = await import('drizzle-orm/libsql');
    const { migrate } = await import('drizzle-orm/libsql/migrator');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const full = path.join(here, 'db', 'migrations');

    // A migrations folder that stops at 0014 — the schema as it was before Phase 2.
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'dperp-mig-'));
    fs.cpSync(full, old, { recursive: true });
    const journalPath = path.join(old, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0015');
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    for (const f of fs.readdirSync(old)) if (f.startsWith('0015')) fs.unlinkSync(path.join(old, f));

    const file = path.join(os.tmpdir(), `dperp-mig-${Date.now()}-${uniq()}.db`);
    tmpFiles.push(file);
    const client = createClient({ url: `file:${file}` });
    const odb = drizzle(client);
    await migrate(odb, { migrationsFolder: old });

    // Pre-ledger shop data: counts set directly, partial adjustment history.
    await client.execute(`insert into inventory_items (name, count, created_at) values ('Shirts', 12, '2026-01-01T00:00:00Z')`);
    await client.execute(`insert into inventory_items (name, count, created_at) values ('Magnets', 0, '2026-01-01T00:00:00Z')`);
    await client.execute(`insert into inventory_items (name, count, created_at) values ('Vinyl', 4, '2026-01-01T00:00:00Z')`);
    await client.execute(`insert into inventory_adjustments (item_id, delta, reason, created_at) values (1, 5, 'received', '2026-02-01T00:00:00Z')`);
    await client.execute(`insert into inventory_adjustments (item_id, delta, reason, created_at) values (3, 4, 'received', '2026-02-01T00:00:00Z')`);

    await migrate(odb, { migrationsFolder: full });

    const bad = await client.execute(`
      select i.id from inventory_items i
      where i.count <> coalesce((select sum(delta) from inventory_adjustments a where a.item_id = i.id), 0)
         or i.count <> coalesce((select sum(on_hand) from inventory_balances b where b.item_id = i.id), 0)`);
    expect(bad.rows).toHaveLength(0);
    const opening = await client.execute(`select item_id, delta from inventory_adjustments where txn_type = 'opening' order by item_id`);
    expect(opening.rows.map((r) => [Number(r.item_id), Number(r.delta)])).toEqual([[1, 7]]);
    const types = await client.execute(`select distinct txn_type from inventory_adjustments where reason = 'received'`);
    expect(types.rows.map((r) => r.txn_type)).toEqual(['receipt']);
    await expect(client.execute(`update inventory_items set count = 50 where id = 2`)).rejects.toThrow(/inventory transactions/);
    client.close();
    fs.rmSync(old, { recursive: true, force: true });
  });
});
