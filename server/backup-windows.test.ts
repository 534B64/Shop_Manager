// Windows backup fix: a file that is open cannot be renamed there, so (1) rename/delete
// retry while the OS says "busy", (2) backup closes every client it opened before it
// renames, and never opens the .partial copy inside its own process, (3) old .partial
// leftovers are cleaned up. Temp dirs only.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Track every libsql client this process opens: which files, and how many are still open.
const tracker = vi.hoisted(() => ({ opened: [] as string[], open: 0, events: [] as string[] }));
vi.mock('@libsql/client', async (orig) => {
  const real = await orig<typeof import('@libsql/client')>();
  return {
    ...real,
    createClient: (cfg: Parameters<typeof real.createClient>[0]) => {
      const c = real.createClient(cfg);
      tracker.opened.push(String(cfg.url));
      tracker.open++;
      const close = c.close.bind(c);
      c.close = () => { tracker.open--; tracker.events.push('close'); close(); };
      return c;
    },
  };
});

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { renameRetry, unlinkRetry, retryLocked, FileLockedError } from './db/fs-retry.js';
import { backupDatabase, cleanStalePartials, BackupError } from './db/backup.js';

const noSleep = async () => undefined;
const err = (code: string) => Object.assign(new Error(`${code}: busy`), { code });

describe('retry helper', () => {
  it('renameRetry: fails N times with EBUSY, then succeeds', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    await renameRetry('a', 'b', {
      delayMs: 5, sleep: async (ms) => { sleeps.push(ms); },
      rename: () => { if (++calls <= 3) throw err(calls === 1 ? 'EBUSY' : calls === 2 ? 'EPERM' : 'EACCES'); },
    });
    expect(calls).toBe(4);
    expect(sleeps).toEqual([5, 5, 5]);
  });

  it('gives up after `tries` with a plain-language message', async () => {
    let calls = 0;
    const p = renameRetry('x.partial', 'x.db', { tries: 4, sleep: noSleep, rename: () => { calls++; throw err('EBUSY'); } });
    await expect(p).rejects.toBeInstanceOf(FileLockedError);
    await expect(renameRetry('x.partial', 'x.db', { tries: 2, sleep: noSleep, rename: () => { throw err('EBUSY'); } }))
      .rejects.toThrow(/another program still has the file open/);
    expect(calls).toBe(4);
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(retryLocked('op', () => { calls++; throw err('ENOENT'); }, { sleep: noSleep })).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });

  it('unlinkRetry retries busy files and accepts a file that is already gone', async () => {
    let calls = 0;
    await unlinkRetry('f', { sleep: noSleep, unlink: () => { if (++calls < 3) throw err('EBUSY'); } });
    expect(calls).toBe(3);
    await unlinkRetry('f', { sleep: noSleep, unlink: () => { throw err('ENOENT'); } });
  });
});

describe('backup on a machine that locks open files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dperp-winbk-'));
  const dbPath = path.join(root, 'dp-erp.db');
  const backupDir = path.join(root, 'backups');
  const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db', 'migrations');

  beforeAll(async () => {
    const c = createClient({ url: `file:${dbPath}` });
    await migrate(drizzle(c), { migrationsFolder: migrations });
    c.close();
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('closes every client before the rename, never opens the .partial in-process, and retries a busy rename', async () => {
    tracker.opened.length = 0;
    const renames: { from: string; to: string; openClients: number }[] = [];
    let busyLeft = 2;
    const r = await backupDatabase({
      dbPath, backupDir, now: new Date(2026, 8, 28, 2, 0, 0),
      retry: {
        sleep: noSleep,
        rename: (from, to) => {
          renames.push({ from, to, openClients: tracker.open });
          if (busyLeft-- > 0) throw err('EBUSY');
          fs.renameSync(from, to);
        },
      },
    });
    expect(renames).toHaveLength(3); // two busy answers, then it went through
    expect(renames.every((x) => x.openClients === 0)).toBe(true); // nothing of ours was open at rename time
    expect(renames[0].from).toMatch(/\.db\.partial$/);
    expect(renames[2].to).toBe(r.file);
    expect(tracker.opened.some((u) => u.includes('.partial'))).toBe(false); // the copy is checked in another process
    expect(fs.existsSync(r.file)).toBe(true);
    expect(fs.readdirSync(backupDir).some((f) => f.endsWith('.partial'))).toBe(false);
  });

  it('a rename that stays busy fails with a clear message and leaves the checked copy', async () => {
    await expect(backupDatabase({
      dbPath, backupDir, now: new Date(2026, 8, 29, 2, 0, 0),
      retry: { tries: 3, sleep: noSleep, rename: () => { throw err('EBUSY'); } },
    })).rejects.toThrow(/could not be finished.*another program still has the file open/s);
    expect(fs.readdirSync(backupDir).some((f) => f.endsWith('2026-09-29_020000.db.partial'))).toBe(true);
    expect(fs.readdirSync(backupDir).some((f) => f === 'dp-erp-2026-09-29_020000.db')).toBe(false);
  });

  it('removes .partial files older than a day at the start of a run, and only those', async () => {
    const dir = path.join(root, 'stale');
    fs.mkdirSync(dir);
    const mk = (n: string, ageH: number) => {
      const f = path.join(dir, n); fs.writeFileSync(f, 'x');
      const t = new Date(Date.now() - ageH * 3600_000); fs.utimesSync(f, t, t);
    };
    mk('dp-erp-2026-09-20_020000.db.partial', 30);   // stale -> removed
    mk('dp-erp-2026-09-28_020000.db.partial', 2);    // recent (maybe a backup running now) -> kept
    mk('dp-erp-2026-09-19_020000.db', 500);          // a finished backup, however old -> kept
    mk('other-2026-09-20_020000.db.partial', 30);    // another database's -> kept
    const removed = await cleanStalePartials(dbPath, dir);
    expect(removed).toEqual(['dp-erp-2026-09-20_020000.db.partial']);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'dp-erp-2026-09-19_020000.db', 'dp-erp-2026-09-28_020000.db.partial', 'other-2026-09-20_020000.db.partial']);
  });

  it('backupDatabase runs the stale cleanup first', async () => {
    const dir = path.join(root, 'backups2');
    fs.mkdirSync(dir);
    const old = path.join(dir, 'dp-erp-2026-09-01_020000.db.partial');
    fs.writeFileSync(old, 'x');
    const t = new Date(Date.now() - 48 * 3600_000); fs.utimesSync(old, t, t);
    await backupDatabase({ dbPath, backupDir: dir, now: new Date(2026, 8, 28, 3, 0, 0) });
    expect(fs.existsSync(old)).toBe(false);
  });

  it('a missing database is still a BackupError', async () => {
    await expect(backupDatabase({ dbPath: path.join(root, 'nope.db'), backupDir })).rejects.toBeInstanceOf(BackupError);
  });
});
