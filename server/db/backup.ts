// Backup and restore for the SQLite file (ADR 0008). Used by `npm run
// db:backup`, `npm run db:restore` and the server's daily backup. Opens its own
// connections by path and never imports server/db/index.ts, so a restore does
// not hold the database it is replacing open.
//
// Backup = `VACUUM INTO` a new file: SQLite's own consistent snapshot, safe
// while the app is running and writing in WAL mode. The copy is a single
// self-contained file (no -wal/-shm) and is verified before it counts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { execFile } from 'node:child_process';
import { DATA_TABLES, restoreDatasetProblem, type Dataset } from './dataset.js';
import { serverRunningProblem, restoreInProgressProblem, holdRestoreLock } from './server-lock.js';
import { renameRetry, unlinkRetry, type RetryOptions } from './fs-retry.js';

const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Tables compared between the live database and a backup. None of them can
 *  lose rows (ADR 0005 triggers), so a backup taken during writes must land
 *  between the live counts read just before and just after it. */
export const KEY_TABLES = ['users', 'customers', 'jobs', 'job_items', 'payments', 'customer_credits',
  'materials', 'inventory_items', 'inventory_adjustments', 'inventory_balances', 'cycle_counts',
  'cycle_count_lines', 'approvals', 'audit_log',
  // Phase 3 (ADR 0007) — all append-only.
  'invoices', 'invoice_lines', 'invoice_voids', 'returns', 'return_lines', 'drawer_sessions', 'number_sequences'];

export const DEFAULT_KEEP_DAILY = 14;
export const DEFAULT_KEEP_WEEKLY = 8;

export class BackupError extends Error {}

// ---------------- config ----------------

export interface BackupConfig { backupDir: string; keepDaily: number; keepWeekly: number; hour: number | null }

function intEnv(v: string | undefined, fallback: number, min: number, max: number): number {
  if (v == null || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BackupError(`bad setting "${v}" (expected ${min}-${max})`);
  return n;
}

/** BACKUP_DIR (default: a `backups` folder next to the database),
 *  BACKUP_KEEP_DAILY / BACKUP_KEEP_WEEKLY, BACKUP_HOUR (0-23; unset = no
 *  in-app schedule). */
export function backupConfigFromEnv(env: NodeJS.ProcessEnv, dbPath: string): BackupConfig {
  return {
    backupDir: env.BACKUP_DIR?.trim() || path.join(path.dirname(dbPath), 'backups'),
    keepDaily: intEnv(env.BACKUP_KEEP_DAILY, DEFAULT_KEEP_DAILY, 0, 3650),
    keepWeekly: intEnv(env.BACKUP_KEEP_WEEKLY, DEFAULT_KEEP_WEEKLY, 0, 520),
    hour: env.BACKUP_HOUR?.trim() ? intEnv(env.BACKUP_HOUR, 0, 0, 23) : null,
  };
}

// ---------------- file names + rotation ----------------

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const baseName = (dbPath: string) => path.basename(dbPath).replace(/\.db$/i, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Local-time stamp, e.g. 2026-09-26_021500 — sorts chronologically. */
export function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export const backupFileName = (dbPath: string, now: Date) => `${baseName(dbPath)}-${stamp(now)}.db`;

/** The date part of a backup made for this database, or null for any other file. */
export function backupDay(dbPath: string, fileName: string): string | null {
  const m = new RegExp(`^${escapeRe(baseName(dbPath))}-(\\d{4}-\\d{2}-\\d{2})_\\d{6}\\.db$`).exec(fileName);
  return m ? m[1] : null;
}

/** Monday of the day's week — the weekly bucket. */
function weekOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/**
 * Which backups to keep: the newest one of each of the last `keepDaily` days
 * that have a backup, plus the newest one of each of the last `keepWeekly`
 * weeks. The newest backup is always kept. Everything else is removed.
 */
export function planRotation(dbPath: string, fileNames: string[], keepDaily: number, keepWeekly: number) {
  const ours = fileNames.filter((f) => backupDay(dbPath, f)).sort().reverse(); // newest first
  const keep = new Set<string>(ours.slice(0, 1));
  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const f of ours) {
    const day = backupDay(dbPath, f) as string;
    if (!days.has(day) && days.size < keepDaily) { days.add(day); keep.add(f); }
    const wk = weekOf(day);
    if (!weeks.has(wk) && weeks.size < keepWeekly) { weeks.add(wk); keep.add(f); }
  }
  return { keep: ours.filter((f) => keep.has(f)), remove: ours.filter((f) => !keep.has(f)) };
}

/** Apply planRotation to the backup folder. Only ever touches this database's backup files. */
export async function rotateBackups(
  dbPath: string, backupDir: string, keepDaily: number, keepWeekly: number, retry: RetryOptions = {},
) {
  const plan = planRotation(dbPath, fs.readdirSync(backupDir), keepDaily, keepWeekly);
  for (const f of plan.remove) await unlinkRetry(path.join(backupDir, f), retry);
  return plan;
}

export const STALE_PARTIAL_MS = 24 * 3600_000;

/** Delete this database's `.partial` files older than a day: leftovers of a backup that
 *  died half way. Finished backups (no .partial) are never touched. Returns the names removed. */
export async function cleanStalePartials(
  dbPath: string, backupDir: string, now = Date.now(), retry: RetryOptions = {},
): Promise<string[]> {
  if (!fs.existsSync(backupDir)) return [];
  const re = new RegExp(`^${escapeRe(baseName(dbPath))}-\\d{4}-\\d{2}-\\d{2}_\\d{6}\\.db\\.partial$`);
  const removed: string[] = [];
  for (const f of fs.readdirSync(backupDir).filter((n) => re.test(n))) {
    const stat = fs.statSync(path.join(backupDir, f), { throwIfNoEntry: false });
    if (!stat || now - stat.mtimeMs < STALE_PARTIAL_MS) continue;
    try { await unlinkRetry(path.join(backupDir, f), retry); removed.push(f); } catch { /* still locked: next run tries again */ }
  }
  return removed;
}

/** Newest backup of this database in the folder, or null. */
export function newestBackup(dbPath: string, backupDir: string): string | null {
  if (!fs.existsSync(backupDir)) return null;
  const ours = fs.readdirSync(backupDir).filter((f) => backupDay(dbPath, f)).sort();
  return ours.length ? path.join(backupDir, ours[ours.length - 1]) : null;
}

// ---------------- inspecting a database file ----------------

export interface DbFacts {
  integrity: string;                 // 'ok' or SQLite's first complaint
  counts: Record<string, number>;    // KEY_TABLES that exist
  migrations: string[];              // applied migration hashes, oldest first
  lastMigrationAt: number;           // folderMillis of the newest applied migration
  dataset: Dataset | null;
}

function open(file: string, mustExist = true): Client {
  if (mustExist && !fs.existsSync(file)) throw new BackupError(`${file} does not exist`);
  return createClient({ url: `file:${file}` });
}

async function counts(c: Client): Promise<Record<string, number>> {
  const tables = new Set((await c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) => String(r.name)));
  const out: Record<string, number> = {};
  for (const t of KEY_TABLES) {
    if (tables.has(t)) out[t] = Number((await c.execute(`SELECT count(*) AS c FROM "${t}"`)).rows[0].c);
  }
  return out;
}

async function migrationsOf(c: Client): Promise<{ hashes: string[]; last: number }> {
  const has = await c.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'");
  if (has.rows.length === 0) return { hashes: [], last: 0 };
  const rows = (await c.execute('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, id')).rows;
  return { hashes: rows.map((r) => String(r.hash)), last: rows.length ? Number(rows[rows.length - 1].created_at) : 0 };
}

const CHILD_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db-child.mjs');
const CHILD_TIMEOUT_MS = 5 * 60_000;

/** Run db-child.mjs (its own process — see the note there) and return its JSON reply. */
function runChild<T>(req: Record<string, unknown>): Promise<T> {
  const arg = Buffer.from(JSON.stringify(req)).toString('base64');
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [CHILD_SCRIPT, arg], { timeout: CHILD_TIMEOUT_MS, maxBuffer: 10_000_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr.trim() || err.message));
        try { resolve(JSON.parse(stdout.trim().split('\n').pop() ?? '')); } catch { reject(new Error('no answer from the checker process')); }
      });
  });
}

/** Read-only look at a database file: integrity, row counts, migrations, label.
 *  Any failure to read it (not a database, torn file) comes back as integrity text.
 *  Done in a separate process so this process never holds the file open (Windows
 *  cannot rename an open file). `hasData` is filled in when `data: true`. */
export async function inspectDb(file: string, opts: { integrity?: boolean; data?: boolean } = {}): Promise<DbFacts & { hasData: boolean }> {
  if (!fs.existsSync(file)) throw new BackupError(`${file} does not exist`);
  try {
    return await runChild({ op: 'inspect', file, integrity: opts.integrity !== false, keyTables: KEY_TABLES,
      dataTables: opts.data ? DATA_TABLES : [] });
  } catch (err) {
    return { integrity: `unreadable: ${(err as Error).message}`, counts: {}, migrations: [], lastMigrationAt: 0, dataset: null, hasData: false };
  }
}

// ---------------- backup ----------------

export interface BackupResult {
  file: string; bytes: number; ms: number;
  counts: Record<string, number>; migrations: number; dataset: Dataset | null;
  kept: string[]; removed: string[];
}

/** Take a verified backup, then rotate. Throws BackupError on any failure;
 *  a failed copy is removed and rotation does not run. */
export async function backupDatabase(o: {
  dbPath: string; backupDir: string; keepDaily?: number; keepWeekly?: number; now?: Date; retry?: RetryOptions;
}): Promise<BackupResult> {
  const t0 = Date.now();
  const retry = o.retry ?? {};
  if (!fs.existsSync(o.dbPath)) throw new BackupError(`database ${o.dbPath} does not exist`);
  fs.mkdirSync(o.backupDir, { recursive: true });
  await cleanStalePartials(o.dbPath, o.backupDir, Date.now(), retry);
  const final = path.join(o.backupDir, backupFileName(o.dbPath, o.now ?? new Date()));
  const partial = `${final}.partial`;
  if (fs.existsSync(final)) throw new BackupError(`${final} already exists — wait a second and run it again`);

  const src = open(o.dbPath);
  let before: Record<string, number>; let after: Record<string, number>;
  let srcMigrations: string[];
  try {
    await src.execute('PRAGMA busy_timeout = 10000');
    before = await counts(src);
    srcMigrations = (await migrationsOf(src)).hashes;
    await src.execute({ sql: 'VACUUM INTO ?', args: [partial] });
    after = await counts(src);
    const again = (await migrationsOf(src)).hashes;
    if (again.join() !== srcMigrations.join()) throw new BackupError('the database was upgraded during the backup — run it again');
  } catch (err) {
    src.close();
    await unlinkRetry(partial, retry).catch(() => undefined);
    throw err instanceof BackupError ? err : new BackupError(`copy failed: ${(err as Error).message}`);
  }
  src.close(); // every client is closed before the copy is checked and renamed

  const copy = await inspectDb(partial); // in a separate process: nothing here holds the copy open
  const problems: string[] = [];
  if (copy.integrity !== 'ok') problems.push(`integrity_check: ${copy.integrity}`);
  if (copy.migrations.join() !== srcMigrations.join()) {
    problems.push(`migration journal differs (copy ${copy.migrations.length}, live ${srcMigrations.length})`);
  }
  for (const t of Object.keys(before)) {
    const n = copy.counts[t];
    if (n == null || n < before[t] || n > after[t]) {
      problems.push(`${t}: copy has ${n ?? 'no table'}, live had ${before[t]}${after[t] !== before[t] ? `-${after[t]}` : ''}`);
    }
  }
  if (problems.length) {
    await unlinkRetry(partial, retry).catch(() => undefined);
    throw new BackupError(`verification failed — ${problems.join('; ')}`);
  }
  await renameRetry(partial, final, retry).catch((err) => {
    throw new BackupError(`the backup was made and checked but could not be finished: ${(err as Error).message} `
      + `The checked copy is still there as ${partial}.`);
  });

  const plan = await rotateBackups(o.dbPath, o.backupDir, o.keepDaily ?? DEFAULT_KEEP_DAILY, o.keepWeekly ?? DEFAULT_KEEP_WEEKLY, retry);
  return {
    file: final, bytes: fs.statSync(final).size, ms: Date.now() - t0,
    counts: copy.counts, migrations: copy.migrations.length, dataset: copy.dataset,
    kept: plan.keep, removed: plan.remove,
  };
}

// ---------------- restore ----------------

export interface RestoreResult {
  dbPath: string; from: string; setAside: string[];
  backupDataset: Dataset | null; migrationsBefore: number; migrationsAfter: number;
  counts: Record<string, number>;
}

/** The app's migrations as folderMillis, oldest first. */
function appMigrationTimes(folder: string): number[] {
  return readMigrationFiles({ migrationsFolder: folder }).map((m) => m.folderMillis);
}

/**
 * Replace the database with a backup. Order, so a failure never leaves the
 * shop without a working database:
 *   1. refuse while the server's heartbeat is fresh (server-lock.ts); then
 *      hold a restore lock so the server refuses to start until we're done
 *      (the heartbeat is checked once more right before step 4)
 *   2. check the backup: integrity, a Shop Manager database, not from a newer
 *      app version, not demo data over a production database
 *   3. copy it to `<db>.restoring` and run migrations on that copy (an older
 *      backup upgrades here), check integrity again
 *   4. move the current database (+ -wal / -shm) aside to
 *      `<name>.pre-restore-<stamp>.db` — never deleted
 *   5. rename the prepared copy into place
 */
export async function restoreBackup(o: {
  backupFile: string; dbPath: string; now?: Date; migrationsFolder?: string; retry?: RetryOptions;
}): Promise<RestoreResult> {
  const folder = o.migrationsFolder ?? MIGRATIONS_FOLDER;
  const backupFile = path.resolve(o.backupFile);
  const dbPath = path.resolve(o.dbPath);
  if (backupFile === dbPath) throw new BackupError('the backup file IS the database — pick a file from the backups folder');

  const running = serverRunningProblem(dbPath);
  if (running) throw new BackupError(running);
  const busy = restoreInProgressProblem(dbPath);
  if (busy) throw new BackupError(busy);

  // From here to the swap the server refuses to start (restore lock).
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const releaseRestoreLock = holdRestoreLock(dbPath);
  try {
    return await restoreLocked(backupFile, dbPath, folder, o.now ?? new Date(), o.retry ?? {});
  } finally {
    releaseRestoreLock();
  }
}

async function restoreLocked(backupFile: string, dbPath: string, folder: string, now: Date, retry: RetryOptions): Promise<RestoreResult> {
  if (!fs.existsSync(backupFile)) throw new BackupError(`${backupFile} does not exist`);
  if (fs.existsSync(`${backupFile}-wal`)) {
    throw new BackupError(`${backupFile}-wal exists next to it, so it is a live database copy, not a finished backup. `
      + 'Restore a file from the backups folder instead.');
  }
  const b = await inspectDb(backupFile);
  if (b.integrity !== 'ok') throw new BackupError(`the backup is damaged (${b.integrity}). Try an older backup.`);
  if (b.migrations.length === 0) throw new BackupError('that file is not a Shop Manager database');
  const appTimes = appMigrationTimes(folder);
  if (b.lastMigrationAt > appTimes[appTimes.length - 1]) {
    throw new BackupError('that backup was made by a NEWER version of the app. Update the app first, then restore.');
  }
  let currentDataset: Dataset | null = null;
  let currentHasData = false;
  if (fs.existsSync(dbPath)) {
    // Looked at in a separate process so this one never holds the current database open when it is renamed.
    const cur = await inspectDb(dbPath, { integrity: false, data: true });
    if (cur.integrity.startsWith('unreadable')) throw new BackupError(`the current database cannot be read (${cur.integrity}); nothing was changed`);
    currentDataset = cur.dataset; currentHasData = cur.hasData;
  }
  const datasetProblem = restoreDatasetProblem({ dbPath, current: currentDataset, currentHasData, backup: b.dataset });
  if (datasetProblem) throw new BackupError(datasetProblem);

  // 3. Prepare the copy. Rollback-journal mode while migrating, so the
  //    prepared file is one self-contained file (the server turns WAL on at start).
  const restoring = `${dbPath}.restoring`;
  for (const s of ['', '-journal', '-wal', '-shm']) await unlinkRetry(restoring + s, retry);
  fs.copyFileSync(backupFile, restoring);
  const setAside: string[] = [];
  try {
    await runChild({ op: 'migrate', file: restoring, folder }); // separate process, see db-child.mjs
    const after = await inspectDb(restoring);
    if (after.integrity !== 'ok') throw new BackupError(`integrity_check after upgrade: ${after.integrity}`);
    if (after.migrations.length !== appTimes.length) {
      throw new BackupError(`upgrade incomplete (${after.migrations.length} of ${appTimes.length} migrations)`);
    }

    // Last look before anything moves: a server that started anyway (old app
    // version without the restore-lock check) stops the restore here.
    const lateStart = serverRunningProblem(dbPath);
    if (lateStart) throw new BackupError(lateStart);

    // 4. Current database aside, all companions together so it stays openable.
    const aside = path.join(path.dirname(dbPath), `${baseName(dbPath)}.pre-restore-${stamp(now)}.db`);
    for (const s of ['', '-wal', '-shm']) {
      if (!fs.existsSync(dbPath + s)) continue;
      if (fs.existsSync(aside + s)) throw new BackupError(`${aside + s} already exists — wait a second and run it again`);
      await renameRetry(dbPath + s, aside + s, retry);
      setAside.push(aside + s);
    }
    // 5. Into place.
    await renameRetry(restoring, dbPath, retry);
    return {
      dbPath, from: backupFile, setAside, backupDataset: b.dataset,
      migrationsBefore: b.migrations.length, migrationsAfter: after.migrations.length, counts: after.counts,
    };
  } catch (err) {
    // Put anything already moved aside back, so the shop keeps its database.
    if (!fs.existsSync(dbPath)) {
      for (const f of setAside) await renameRetry(f, dbPath + f.slice(f.lastIndexOf('.db') + 3), retry).catch(() => undefined);
    }
    await unlinkRetry(restoring, retry).catch(() => undefined);
    throw err instanceof BackupError ? err : new BackupError(`restore failed, nothing was changed: ${(err as Error).message}`);
  }
}

// ---------------- in-app daily schedule ----------------

export interface BackupLog { info: (msg: string) => void; error: (msg: string) => void }

/** Next time the clock reads `hour`:00 local time, strictly after `now`. */
export function nextRunAt(now: Date, hour: number): Date {
  const t = new Date(now);
  t.setHours(hour, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t;
}

/**
 * Run a backup every day at `hour`:00 (server local time; set TZ in the
 * container). If the newest backup is more than 26 hours old at startup (the
 * NAS was off at backup time), one runs a minute after start. Returns a stop
 * function. Timers are unref'd so they never keep the process alive.
 */
export function scheduleDailyBackups(o: { dbPath: string; config: BackupConfig; log: BackupLog }): () => void {
  const { hour, backupDir, keepDaily, keepWeekly } = o.config;
  if (hour == null) return () => {};
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    try {
      const r = await backupDatabase({ dbPath: o.dbPath, backupDir, keepDaily, keepWeekly });
      o.log.info(`backup OK: ${r.file} (${(r.bytes / 1e6).toFixed(1)} MB, ${r.ms} ms; removed ${r.removed.length} old)`);
    } catch (err) {
      o.log.error(`BACKUP FAILED: ${(err as Error).message}`);
    }
  };
  const planNext = () => {
    const at = nextRunAt(new Date(), hour);
    timer = setTimeout(async () => { await run(); planNext(); }, at.getTime() - Date.now());
    timer.unref();
  };
  const newest = newestBackup(o.dbPath, backupDir);
  const age = newest ? Date.now() - fs.statSync(newest).mtimeMs : Infinity;
  if (age > 26 * 3600_000) {
    const catchUp = setTimeout(run, 60_000);
    catchUp.unref();
  }
  planNext();
  o.log.info(`daily backup scheduled at ${pad(hour)}:00 into ${backupDir} (keep ${keepDaily} daily, ${keepWeekly} weekly)`);
  return () => clearTimeout(timer);
}
