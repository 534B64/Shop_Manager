// Phase 4 (ADR 0008): backup and restore of the SQLite file. Real app, real
// ledger writes, temp dirs only. A backup is taken while another connection
// holds an open write transaction; the backup is restored somewhere fresh and
// compared row for row; the restored database must still reconcile.
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { TestUser } from './test-helpers.js';
import {
  backupDatabase, restoreBackup, planRotation, rotateBackups, inspectDb, backupConfigFromEnv,
  nextRunAt, backupFileName, type BackupResult,
} from './db/backup.js';
import {
  holdServerLock, lockPath, serverRunningProblem, holdRestoreLock, restoreLockPath, restoreInProgressProblem,
} from './db/server-lock.js';
import { markDataset } from './db/dataset.js';

const MIGRATIONS = path.join(path.dirname(new URL(import.meta.url).pathname), 'db', 'migrations');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dperp-backup-'));
const liveDb = path.join(root, 'live', 'dp-erp.db');
const backupDir = path.join(root, 'live', 'backups');
const freshDb = path.join(root, 'fresh', 'dp-erp.db');

let app: FastifyInstance;
let admin: TestUser;
let backup: BackupResult;
const uniq = () => Math.random().toString(36).slice(2, 8);
const inject = (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...admin.headers, ...(opts.headers ?? {}) } });

async function rows(file: string, sql: string) {
  const c = createClient({ url: `file:${file}` });
  try { return (await c.execute(sql)).rows.map((r) => ({ ...r })); } finally { c.close(); }
}
const sha = (file: string) => fs.readFileSync(file).toString('base64');

beforeAll(async () => {
  fs.mkdirSync(path.dirname(liveDb), { recursive: true });
  process.env.DB_PATH = liveDb;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
  const { setSetting } = await import('./modules/settings/index.js');
  await setSetting('dataset', 'production');

  // Realistic shop activity, all through the API (ledger triggers satisfied).
  for (let i = 0; i < 3; i++) {
    const job = (await inject({ method: 'POST', url: '/api/jobs', payload: {
      clientRef: `bk-${uniq()}`, type: 'decal', title: `Van decals ${i}`, status: 'acknowledged',
      finalPriceCents: 10000 + i * 2500, newCustomer: { name: `Customer ${i}`, email: `c${i}@shop.example` },
    } })).json();
    await inject({ method: 'POST', url: '/api/payments', payload: {
      clientRef: `bkp-${uniq()}`, jobId: job.id, amountCents: 4000, method: 'cash' } });
  }
  for (let i = 0; i < 3; i++) {
    const item = (await inject({ method: 'POST', url: '/api/inventory', payload: { name: `Blank ${i} ${uniq()}`, count: 10 } })).json();
    expect((await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`,
      payload: { delta: 6, reason: 'received', unitCostCents: 250 + i } })).statusCode).toBeLessThan(300);
    expect((await inject({ method: 'POST', url: `/api/inventory/${item.id}/adjust`,
      payload: { delta: -2, reason: 'used' } })).statusCode).toBeLessThan(300);
  }
});

afterAll(async () => {
  await app?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('health reports the dataset', () => {
  it('GET /api/health → dataset production (public)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json().dataset).toBe('production');
  });
});

describe('backup', () => {
  it('takes a verified backup while another connection holds an open write transaction', async () => {
    const other = createClient({ url: `file:${liveDb}` });
    await other.execute('BEGIN IMMEDIATE');
    await other.execute({ sql: 'INSERT INTO customers (name, created_at) VALUES (?, ?)', args: ['Mid-backup Co', new Date().toISOString()] });
    try {
      backup = await backupDatabase({ dbPath: liveDb, backupDir, now: new Date(2026, 8, 26, 2, 0, 0) });
    } finally {
      await other.execute('COMMIT');
      other.close();
    }
    expect(path.basename(backup.file)).toBe('dp-erp-2026-09-26_020000.db');
    expect(backup.dataset).toBe('production');
    expect(fs.existsSync(`${backup.file}.partial`)).toBe(false);
    expect(fs.existsSync(`${backup.file}-wal`)).toBe(false); // one self-contained file
    const copy = await inspectDb(backup.file);
    expect(copy.integrity).toBe('ok');
    // The uncommitted row is not in the backup; everything committed is.
    const live = await inspectDb(liveDb, { integrity: false });
    expect(copy.counts.customers).toBe(live.counts.customers - 1);
    for (const t of ['jobs', 'payments', 'inventory_items', 'inventory_adjustments', 'inventory_balances', 'users']) {
      expect(copy.counts[t], t).toBe(live.counts[t]);
    }
    expect(copy.counts.jobs).toBe(3);
    expect(copy.migrations).toEqual(live.migrations);
    // Verification covers the Phase 3 sales tables too.
    for (const t of ['invoices', 'invoice_lines', 'invoice_voids', 'returns', 'return_lines', 'drawer_sessions', 'number_sequences']) {
      expect(Object.keys(backup.counts), t).toContain(t);
    }
    expect(backup.counts.number_sequences).toBe(1);
  });

  it('refuses a database file that does not exist (never creates one)', async () => {
    const missing = path.join(root, 'nope', 'dp-erp.db');
    await expect(backupDatabase({ dbPath: missing, backupDir })).rejects.toThrow(/does not exist/);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('config: backups folder defaults next to the database; hour optional; bad values rejected', () => {
    expect(backupConfigFromEnv({}, '/app/data/dp-erp.db')).toEqual(
      { backupDir: '/app/data/backups', keepDaily: 14, keepWeekly: 8, hour: null });
    expect(backupConfigFromEnv({ BACKUP_DIR: '/b', BACKUP_HOUR: '2', BACKUP_KEEP_DAILY: '7' }, '/x/dp-erp.db'))
      .toEqual({ backupDir: '/b', keepDaily: 7, keepWeekly: 8, hour: 2 });
    expect(() => backupConfigFromEnv({ BACKUP_HOUR: '25' }, '/x/dp-erp.db')).toThrow();
    expect(nextRunAt(new Date(2026, 8, 26, 1, 30), 2)).toEqual(new Date(2026, 8, 26, 2, 0));
    expect(nextRunAt(new Date(2026, 8, 26, 2, 0), 2)).toEqual(new Date(2026, 8, 27, 2, 0));
  });
});

describe('restore', () => {
  it('restores into a fresh location with identical data', async () => {
    const r = await restoreBackup({ backupFile: backup.file, dbPath: freshDb });
    expect(r.setAside).toEqual([]);
    expect(r.backupDataset).toBe('production');
    expect(fs.existsSync(`${freshDb}.restoring`)).toBe(false);

    const q = {
      jobs: 'SELECT id, po, title, final_price_cents, customer_id FROM jobs ORDER BY id',
      payments: 'SELECT id, job_id, amount_cents, method FROM payments ORDER BY id',
      items: 'SELECT id, name, count, avg_cost_cents FROM inventory_items ORDER BY id',
      ledger: 'SELECT id, item_id, delta, txn_type, unit_cost_cents FROM inventory_adjustments ORDER BY id',
      users: 'SELECT id, name, role, pin_hash FROM users ORDER BY id',
    };
    for (const [name, sql] of Object.entries(q)) {
      expect(await rows(freshDb, sql), name).toEqual(await rows(liveDb, sql));
    }
    const restored = await inspectDb(freshDb);
    expect(restored.integrity).toBe('ok');
    expect(restored.counts).toEqual((await inspectDb(backup.file)).counts);
  });

  it('the restored database still reconciles through the real app (GET /api/inventory/reconcile)', async () => {
    vi.resetModules();
    process.env.DB_PATH = freshDb;
    const { buildApp } = await import('./app.js');
    const app2 = await buildApp();
    try {
      const { createUserWithToken } = await import('./test-helpers.js');
      const mgr = await createUserWithToken(app2, 'manager');
      const rec = await app2.inject({ method: 'GET', url: '/api/inventory/reconcile', headers: mgr.headers });
      expect(rec.statusCode).toBe(200);
      expect(rec.json()).toMatchObject({ ok: true, items: [], balances: [] });
      const jobs = await app2.inject({ method: 'GET', url: '/api/jobs', headers: mgr.headers });
      expect(jobs.json().length).toBe(3);
      expect((await app2.inject({ method: 'GET', url: '/api/health' })).json().dataset).toBe('production');
    } finally {
      await app2.close();
    }
  });

  it('moves the current database aside (never deletes it) before restoring over it', async () => {
    const before = await inspectDb(freshDb, { integrity: false });
    const r = await restoreBackup({ backupFile: backup.file, dbPath: freshDb, now: new Date(2026, 8, 27, 9, 30, 0) });
    const aside = path.join(path.dirname(freshDb), 'dp-erp.pre-restore-2026-09-27_093000.db');
    expect(r.setAside[0]).toBe(aside);
    expect(fs.existsSync(aside)).toBe(true);
    // The app had it open in WAL mode, so its -wal went along with it.
    expect(r.setAside).toContain(`${aside}-wal`);
    expect(fs.existsSync(`${freshDb}-wal`)).toBe(false);
    // The set-aside copy still opens and holds what was there (incl. the manager the last test added).
    const kept = await inspectDb(aside);
    expect(kept.integrity).toBe('ok');
    expect(kept.counts.users).toBe(before.counts.users);
    expect((await inspectDb(freshDb)).counts.users).toBe((await inspectDb(backup.file)).counts.users);
  });

  it('refuses a corrupt backup and leaves the current database untouched', async () => {
    const target = freshDb;
    const snapshot = sha(target);
    const garbage = path.join(root, 'garbage.db');
    fs.writeFileSync(garbage, Buffer.alloc(8192, 0x5a));
    await expect(restoreBackup({ backupFile: garbage, dbPath: target })).rejects.toThrow(/damaged/);

    const torn = path.join(root, 'torn.db');
    const buf = fs.readFileSync(backup.file);
    fs.writeFileSync(torn, buf.subarray(0, Math.floor(buf.length / 3)));
    await expect(restoreBackup({ backupFile: torn, dbPath: target })).rejects.toThrow(/damaged/);

    const scribbled = path.join(root, 'scribbled.db');
    const bad = Buffer.from(buf);
    for (let p = 4096 * 3; p < bad.length; p += 4096) bad.fill(0xff, p + 8, p + 200); // wreck page bodies
    fs.writeFileSync(scribbled, bad);
    await expect(restoreBackup({ backupFile: scribbled, dbPath: target })).rejects.toThrow(/damaged/);

    expect(sha(target)).toBe(snapshot);
    expect(fs.readdirSync(path.dirname(target)).filter((f) => /pre-restore-.*\.db$/.test(f))).toHaveLength(1); // only the earlier one
  });

  it('refuses while the server heartbeat is fresh; a stale lock does not block', async () => {
    const lock = holdServerLock(freshDb);
    try {
      expect(serverRunningProblem(freshDb)).toMatch(/app is running/);
      await expect(restoreBackup({ backupFile: backup.file, dbPath: freshDb })).rejects.toThrow(/app is running/);
    } finally {
      lock.release();
    }
    expect(fs.existsSync(lockPath(freshDb))).toBe(false);
    // Crash leftover: file still there but its heartbeat is 5 minutes old.
    fs.writeFileSync(lockPath(freshDb), JSON.stringify({ host: 'gone', pid: 1 }));
    const old = new Date(Date.now() - 5 * 60_000);
    fs.utimesSync(lockPath(freshDb), old, old);
    expect(serverRunningProblem(freshDb)).toBeNull();
    fs.rmSync(lockPath(freshDb));
  });

  it('refuses to put demo data over a production database', async () => {
    const demo = path.join(root, 'demo.db');
    const c = createClient({ url: `file:${demo}` });
    await migrate(drizzle(c), { migrationsFolder: MIGRATIONS });
    await markDataset(c, 'demo');
    c.close();
    await expect(restoreBackup({ backupFile: demo, dbPath: freshDb })).rejects.toThrow(/PRODUCTION/);
  });

  it('refuses demo data into dp-erp.db or over an unlabeled database with data; demo over demo is fine', async () => {
    const demo = path.join(root, 'demo.db');
    // A missing dp-erp.db: demo data never goes in the real shop file name.
    await expect(restoreBackup({ backupFile: demo, dbPath: path.join(root, 'd1', 'dp-erp.db') })).rejects.toThrow(/real shop database/);
    // An unlabeled database with data under another name.
    const unlabeled = path.join(root, 'd2', 'shop.db');
    fs.mkdirSync(path.dirname(unlabeled), { recursive: true });
    const c = createClient({ url: `file:${unlabeled}` });
    await migrate(drizzle(c), { migrationsFolder: MIGRATIONS });
    await c.execute({ sql: 'INSERT INTO customers (name, created_at) VALUES (?, ?)', args: ['Maybe real', '2026-09-01T00:00:00Z'] });
    c.close();
    const before = sha(unlabeled);
    await expect(restoreBackup({ backupFile: demo, dbPath: unlabeled })).rejects.toThrow(/has data/);
    expect(sha(unlabeled)).toBe(before);
    // Demo over demo.
    const demoTarget = path.join(root, 'd3', 'demo.db');
    fs.mkdirSync(path.dirname(demoTarget), { recursive: true });
    fs.copyFileSync(demo, demoTarget);
    await expect(restoreBackup({ backupFile: demo, dbPath: demoTarget })).resolves.toMatchObject({ backupDataset: 'demo' });
  });

  it('holds a restore lock while it runs; a fresh restore lock stops the server starting and a second restore', async () => {
    const target = path.join(root, 'locked', 'dp-erp.db');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    expect(restoreInProgressProblem(target)).toBeNull();
    const release = holdRestoreLock(target);
    try {
      expect(restoreInProgressProblem(target)).toMatch(/restore is replacing/);
      await expect(restoreBackup({ backupFile: backup.file, dbPath: target })).rejects.toThrow(/restore is replacing/);
    } finally {
      release();
    }
    expect(restoreInProgressProblem(target)).toBeNull();
    // A crashed restore's lock goes stale.
    fs.writeFileSync(restoreLockPath(target), '{}');
    const old = new Date(Date.now() - 11 * 60_000);
    fs.utimesSync(restoreLockPath(target), old, old);
    expect(restoreInProgressProblem(target)).toBeNull();
    fs.rmSync(restoreLockPath(target));
    // A real restore leaves no lock behind.
    await restoreBackup({ backupFile: backup.file, dbPath: target });
    expect(fs.existsSync(restoreLockPath(target))).toBe(false);
  });

  it('refuses a backup made by a newer app version', async () => {
    const newer = path.join(root, 'newer.db');
    fs.copyFileSync(backup.file, newer);
    const c = createClient({ url: `file:${newer}` });
    await c.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)");
    c.close();
    await expect(restoreBackup({ backupFile: newer, dbPath: path.join(root, 'x', 'dp-erp.db') })).rejects.toThrow(/NEWER/);
  });

  it('upgrades a backup from an older app version (runs the missing migrations)', async () => {
    // An "old version" = the migrations folder cut off before 0013 (roles).
    const oldFolder = path.join(root, 'old-migrations');
    fs.mkdirSync(path.join(oldFolder, 'meta'), { recursive: true });
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 13);
    fs.writeFileSync(path.join(oldFolder, 'meta', '_journal.json'), JSON.stringify(journal));
    for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(oldFolder, `${e.tag}.sql`));

    const oldDb = path.join(root, 'old.db');
    const c = createClient({ url: `file:${oldDb}` });
    await c.execute('PRAGMA foreign_keys = ON');
    await migrate(drizzle(c), { migrationsFolder: oldFolder });
    await c.execute({ sql: 'INSERT INTO customers (name, created_at) VALUES (?, ?)', args: ['Old Co', '2026-07-01T00:00:00Z'] });
    await c.execute({ sql: 'INSERT INTO inventory_items (name, count, created_at) VALUES (?, ?, ?)', args: ['Old blank', 7, '2026-07-01T00:00:00Z'] });
    c.close();

    // Unlabeled (pre-label era) → only into a file not named dp-erp.db (restore rule).
    await expect(restoreBackup({ backupFile: oldDb, dbPath: path.join(root, 'upgraded', 'dp-erp.db') })).rejects.toThrow(/real shop database/);
    const target = path.join(root, 'upgraded', 'shop.db');
    const r = await restoreBackup({ backupFile: oldDb, dbPath: target });
    expect(r.migrationsBefore).toBe(13);
    const fullJournal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
    expect(r.migrationsAfter).toBe(fullJournal.entries.length);
    expect(await rows(target, 'SELECT name FROM customers')).toEqual([{ name: 'Old Co' }]);
    // Migration 0015 gave the old item an opening ledger row matching its count.
    expect(await rows(target, 'SELECT count(*) AS n, sum(delta) AS s FROM inventory_adjustments')).toEqual([{ n: 1, s: 7 }]);
  });
});

describe('rotation', () => {
  const db = '/data/dp-erp.db';
  const name = (d: Date) => backupFileName(db, d);

  it('keeps the newest backup of each of the last 14 days and of each of the last 8 weeks', () => {
    const files: string[] = [];
    for (let i = 0; i < 70; i++) files.push(name(new Date(2026, 8, 26 - i, 2, 0, 0))); // one nightly for 70 days
    files.push(name(new Date(2026, 8, 26, 14, 5, 0))); // a manual one today
    files.push('dp-erp-2026-09-20_020000.db.partial', 'notes.txt', 'dp-erp.pre-restore-2026-09-01_100000.db', 'other-2026-09-26_020000.db');
    const plan = planRotation(db, files, 14, 8);

    // Days: today keeps only its newest (the manual one), plus the 13 days before.
    expect(plan.keep).toContain(name(new Date(2026, 8, 26, 14, 5, 0)));
    expect(plan.remove).toContain(name(new Date(2026, 8, 26, 2, 0, 0)));
    for (let i = 1; i < 14; i++) expect(plan.keep).toContain(name(new Date(2026, 8, 26 - i, 2, 0, 0)));
    // Weeks (Monday-start): the newest backup of each of the 8 most recent weeks.
    // 2026-09-26 is a Saturday, so earlier weeks end on Sundays 09-20, 09-13, … 08-09.
    for (let w = 1; w < 8; w++) expect(plan.keep).toContain(name(new Date(2026, 8, 27 - 7 * w, 2, 0, 0)));
    expect(plan.keep).not.toContain(name(new Date(2026, 7, 2, 2, 0, 0))); // week 9 — gone
    // Days 14+ that aren't a week's newest are removed.
    expect(plan.remove).toContain(name(new Date(2026, 8, 26 - 15, 2, 0, 0)));
    // 14 days (09-13..09-26) + the 5 older weeks' Sundays (09-06..08-09) = 19;
    // the 3 newest weeks' picks are already in the daily set.
    expect(plan.keep).toHaveLength(19);
    expect(plan.keep.length + plan.remove.length).toBe(71);
    // Anything that isn't this database's finished backup is never considered.
    for (const f of ['notes.txt', 'dp-erp-2026-09-20_020000.db.partial', 'dp-erp.pre-restore-2026-09-01_100000.db', 'other-2026-09-26_020000.db']) {
      expect(plan.keep).not.toContain(f);
      expect(plan.remove).not.toContain(f);
    }
  });

  it('always keeps the newest backup, even with keep counts of 0', () => {
    const files = [name(new Date(2026, 0, 1, 2)), name(new Date(2026, 0, 2, 2))];
    expect(planRotation(db, files, 0, 0).keep).toEqual([files[1]]);
  });

  it('deletes only the planned files on disk', () => {
    const dir = path.join(root, 'rot');
    fs.mkdirSync(dir);
    const files = Array.from({ length: 20 }, (_, i) => name(new Date(2026, 8, 26 - i, 2)));
    for (const f of [...files, 'keep-me.txt']) fs.writeFileSync(path.join(dir, f), '');
    const plan = rotateBackups(db, dir, 3, 1);
    expect(plan.keep).toHaveLength(3);
    expect(fs.readdirSync(dir).sort()).toEqual([...plan.keep, 'keep-me.txt'].sort());
  });
});
