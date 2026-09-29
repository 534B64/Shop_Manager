// Windows (and OneDrive, and antivirus) can hold a file for a moment: rename or
// delete then fails with EBUSY / EPERM / EACCES and works a second later. These
// helpers retry those errors with a short pause, then give a clear message.
import fs from 'node:fs';

export const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

export interface RetryOptions {
  tries?: number;                          // total attempts (default 10)
  delayMs?: number;                        // pause between attempts (default 1000 → ~10 s)
  sleep?: (ms: number) => Promise<void>;   // injectable for tests
  rename?: (from: string, to: string) => void; // injectable for tests
  unlink?: (file: string) => void;         // injectable for tests
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A file the OS would not let go of, after every retry. Plain-language message. */
export class FileLockedError extends Error {}

/** Run `op`, retrying while it fails with EBUSY/EPERM/EACCES. Other errors throw at once. */
export async function retryLocked<T>(what: string, op: () => T, o: RetryOptions = {}): Promise<T> {
  const tries = o.tries ?? 10;
  const delayMs = o.delayMs ?? 1000;
  const sleep = o.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !RETRY_CODES.has(code)) throw err;
      if (attempt >= tries) {
        throw new FileLockedError(`${what} failed after ${tries} tries (${code}): another program still has the file open `
          + '(OneDrive syncing, antivirus, or a leftover Shop Manager process). Wait a minute and run it again. '
          + `Original error: ${(err as Error).message}`);
      }
      await sleep(delayMs);
    }
  }
}

export function renameRetry(from: string, to: string, o: RetryOptions = {}): Promise<void> {
  const rename = o.rename ?? fs.renameSync;
  return retryLocked(`renaming ${from} -> ${to}`, () => rename(from, to), o);
}

/** Delete a file (already gone is fine). */
export function unlinkRetry(file: string, o: RetryOptions = {}): Promise<void> {
  const unlink = o.unlink ?? fs.unlinkSync;
  return retryLocked(`deleting ${file}`, () => {
    try { unlink(file); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  }, o);
}
