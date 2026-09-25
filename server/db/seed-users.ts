// Demo/dev accounts shared by the demo seed (seed.ts) and the perf seeder
// (seed-perf.ts). DEV ONLY — these PINs are public. See ADR 0004 for roles.
//   Josiah — admin   — PIN 1234
//   Amy    — manager — PIN 2222
//   Sam    — cashier — PIN 3333
import { db } from './index.js';
import { users } from './schema/index.js';
import { hashPin } from '../modules/auth/index.js';

export const DEMO_USERS = [
  { name: 'Josiah', role: 'admin', pin: '1234' },
  { name: 'Amy', role: 'manager', pin: '2222' },
  { name: 'Sam', role: 'cashier', pin: '3333' },
] as const;

/** Insert the demo accounts that don't exist yet (by name). Never touches an
 *  existing account's role or PIN. */
export async function seedDemoUsers(): Promise<number> {
  const existing = new Set((await db.select().from(users)).map((u) => u.name));
  let added = 0;
  for (const u of DEMO_USERS) {
    if (existing.has(u.name)) continue;
    await db.insert(users).values({ name: u.name, role: u.role, pinHash: await hashPin(u.pin) });
    added++;
  }
  return added;
}
