// `npm run db:migrate` — applies all pending migrations to the SQLite file.
import { runMigrations } from './index.js';

await runMigrations();
console.log('Migrations applied.');
process.exit(0);
