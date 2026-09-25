// Safety rail for the perf tooling (seed-perf.ts, scripts/perf-baseline.ts).
// Both write to / hammer a database, so they only run against a DB_PATH that was
// set explicitly and is NOT the real production file.
import path from 'node:path';

const PROD_DB_NAME = 'dp-erp.db';

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
