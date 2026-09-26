// Imported FIRST by server/index.ts, before anything opens the database:
// refuse to start while `npm run db:restore` is replacing it (ADR 0008).
import path from 'node:path';
import { restoreInProgressProblem } from './db/server-lock.js';

const problem = restoreInProgressProblem(path.resolve(process.env.DB_PATH ?? './data/dp-erp.db'));
if (problem) {
  console.error(`\nSERVER NOT STARTED — ${problem}\n`);
  process.exit(1);
}
