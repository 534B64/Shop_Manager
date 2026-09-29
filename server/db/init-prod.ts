// `npm run db:init-prod` — start a clean PRODUCTION database (ADR 0008).
//
// Target: DB_PATH (default ./data/dp-erp.db, the same file the server uses).
// Refuses unless the file is missing, empty, or a Shop Manager database nobody
// has entered anything into (the server creates one like that on first start).
// There is no "erase it anyway" flag — move the old file away yourself.
//
// Creates the schema (migrations, which also install the shop's price book,
// the default suppliers and the "Shop" location), ONE admin account, and the
// label `dataset = production`. No demo customers, jobs, stock or accounts.
//
// Admin name + PIN: prompted, or from INIT_ADMIN_NAME / INIT_ADMIN_PIN.
import readline from 'node:readline/promises';
import { createClient } from '@libsql/client';
import {
  fileState, type Dataset, prodInitProblem, prodInitAlreadySetUp, readDataset, hasBusinessData, isForeignDb,
} from './dataset.js';

const PIN_RE = /^[0-9]{4,12}$/;
const dbPath = process.env.DB_PATH ?? './data/dp-erp.db';

function fail(msg: string): never {
  console.error(`\ndb:init-prod: REFUSED — ${msg}\n`);
  process.exit(1);
}

// 1. Is the target safe to initialize? Decide before creating anything.
const file = fileState(dbPath);
let facts: { foreign?: boolean; dataset?: Dataset | null; hasData?: boolean } = {};
if (file.exists && file.size > 0) {
  const c = createClient({ url: `file:${dbPath}` });
  try {
    facts = { foreign: await isForeignDb(c), dataset: await readDataset(c), hasData: await hasBusinessData(c) };
  } catch (err) {
    fail(`${dbPath} could not be read as a database (${(err as Error).message}). Move it somewhere safe first.`);
  } finally {
    c.close();
  }
}
const problem = prodInitProblem({ dbPath, file, ...facts });
if (problem && process.env.INIT_SKIP_IF_SETUP === '1' && file.exists && file.size > 0 && prodInitAlreadySetUp(facts)) {
  console.log(`A shop database already exists at ${dbPath}. Leaving it exactly as it is.`);
  process.exit(0);
}
if (problem) fail(problem);

// 2. The first admin.
let name = process.env.INIT_ADMIN_NAME?.trim() ?? '';
let pin = process.env.INIT_ADMIN_PIN ?? '';
if (!name || !pin) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nSetting up the PRODUCTION database at ${dbPath}`);
  console.log('Create the first admin account (you can add everyone else in the app later).');
  console.log('Note: the PIN shows on screen while you type — make sure nobody is watching.\n');
  name = name || (await rl.question('Admin name: ')).trim();
  if (!pin) {
    pin = (await rl.question('Admin PIN (4-12 digits): ')).trim();
    const again = (await rl.question('Type the PIN again: ')).trim();
    if (again !== pin) { rl.close(); fail('the two PINs did not match. Nothing was created.'); }
  }
  rl.close();
}
if (!name || name.length > 60) fail('the admin name must be 1-60 characters. Nothing was created.');
if (!PIN_RE.test(pin)) fail('the PIN must be 4-12 digits. Nothing was created.');

// 3. Create it. server/db opens DB_PATH at import, so import only now.
process.env.DB_PATH = dbPath;
const { runMigrations, withTx } = await import('./index.js');
const { users, settings } = await import('./schema/index.js');
const { hashPin } = await import('../modules/auth/index.js');
const { audit } = await import('../modules/audit/index.js');

await runMigrations();
const pinHash = await hashPin(pin);
const createdAt = new Date().toISOString();
const admin = await withTx(async (tx) => {
  // Re-check inside the write lock in case the server's first-run page was used meanwhile.
  if ((await tx.select().from(users)).length > 0) return null;
  const [row] = await tx.insert(users).values({ name, role: 'admin', pinHash }).returning();
  await tx.insert(settings).values([
    { key: 'dataset', value: 'production' },
    { key: 'datasetCreatedAt', value: createdAt },
  ]);
  await audit(tx, null, { action: 'dataset.init_production', entity: 'setting', entityId: 'dataset',
    userId: row.id, after: { dataset: 'production', createdAt, admin: { id: row.id, name: row.name, role: row.role } } });
  return row;
});
if (!admin) fail('an account was created in this database while setup ran. Move the file away and start again.');

console.log(`
Production database ready: ${dbPath}
  dataset:  production (created ${createdAt})
  admin:    ${admin.name} (the only account)
Next: start the app, sign in as ${admin.name}, and add the rest of the crew in Settings -> Accounts.
`);
process.exit(0);
