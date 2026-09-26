// "Is the server using this database right now?" (ADR 0008).
// The running server keeps a small lock file next to the database and touches
// it every 30 s. Restore refuses while that heartbeat is fresh (< 90 s old).
// A heartbeat, not a PID check, because the server and the restore command
// usually run in different containers (different PID namespaces, different
// host names) that only share the data folder. A crash leaves the file
// behind, but its heartbeat goes stale on its own — no manual cleanup.
import fs from 'node:fs';
import os from 'node:os';

export const HEARTBEAT_MS = 30_000;
export const STALE_MS = 90_000;

export const lockPath = (dbPath: string) => `${dbPath}.server-lock`;

/** Why a restore must wait, or null when no live server holds the database. */
export function serverRunningProblem(dbPath: string, now = Date.now()): string | null {
  const file = lockPath(dbPath);
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  const age = now - stat.mtimeMs;
  if (age >= STALE_MS) return null;
  let who = '';
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8')) as { host?: string; pid?: number };
    who = ` (host ${info.host}, pid ${info.pid})`;
  } catch { /* unreadable lock still counts */ }
  return `the app is running on this database${who} — its heartbeat is ${Math.round(age / 1000)} s old. `
    + `Stop the app first. If it is really stopped, wait ${Math.ceil(STALE_MS / 1000)} seconds and try again.`;
}

/** Take the lock for this server process. Returns a release function. */
export function holdServerLock(dbPath: string): { release: () => void; replacedLive: boolean } {
  const file = lockPath(dbPath);
  const replacedLive = serverRunningProblem(dbPath) != null;
  const me = { host: os.hostname(), pid: process.pid, startedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(me));
  const beat = setInterval(() => {
    const t = new Date();
    try { fs.utimesSync(file, t, t); } catch { try { fs.writeFileSync(file, JSON.stringify(me)); } catch { /* next beat */ } }
  }, HEARTBEAT_MS);
  beat.unref();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(beat);
    try {
      const cur = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof me;
      if (cur.host === me.host && cur.pid === me.pid) fs.unlinkSync(file);
    } catch { /* already gone */ }
  };
  return { release, replacedLive };
}
