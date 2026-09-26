// Safety rail for the perf tooling (seed-perf.ts, scripts/perf-baseline.ts).
// Both write to / hammer a database, so they only run against a DB_PATH that was
// set explicitly and is NOT the real production file.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { PROD_DB_NAME, readDataset } from './dataset.js';

/** Returns an error message when DB_PATH is unsafe for perf tooling, else null. */
export function perfDbPathProblem(dbPath: string | undefined): string | null {
  if (!dbPath || !dbPath.trim()) {
    return 'DB_PATH is not set. Set it explicitly, e.g. DB_PATH=./data/perf-test.db';
  }
  if (path.resolve(dbPath).includes(PROD_DB_NAME) || dbPath.includes(PROD_DB_NAME)) {
    return `DB_PATH "${dbPath}" contains "${PROD_DB_NAME}" (the real production filename). Refusing.`;
  }
  return null;
}

/** Print the problem and exit 1 if DB_PATH is unsafe. Call BEFORE importing server/db. */
export function requireSafePerfDb(tool: string): string {
  const problem = perfDbPathProblem(process.env.DB_PATH);
  if (problem) {
    console.error(`${tool}: ${problem}`);
    process.exit(1);
  }
  return process.env.DB_PATH as string;
}

/** Exit 1 if the DB at DB_PATH is labeled production (ADR 0008), whatever its
 *  name. Call after requireSafePerfDb and BEFORE importing server/db. */
export async function refuseProductionDb(tool: string): Promise<void> {
  const dbPath = process.env.DB_PATH as string;
  if (!fs.existsSync(dbPath)) return;
  const c = createClient({ url: `file:${dbPath}` });
  try {
    if ((await readDataset(c)) === 'production') {
      console.error(`${tool}: ${dbPath} is labeled PRODUCTION (real shop data). Refusing.`);
      process.exit(1);
    }
  } finally {
    c.close();
  }
}
