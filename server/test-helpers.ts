// Test helper: create an account with a role + PIN and sign it in through the
// real /api/auth/login route. Import dynamically AFTER setting DB_PATH (it pulls
// in the db singleton).
import type { FastifyInstance } from 'fastify';
import { db } from './db/index.js';
import { users, type UserRole } from './db/schema/index.js';
import { hashPin } from './modules/auth/index.js';

export interface TestUser {
  id: number; name: string; role: UserRole; pin: string; token: string;
  headers: { authorization: string };
}

let n = 0;

export async function createUserWithToken(
  app: FastifyInstance, role: UserRole, opts: { name?: string; pin?: string } = {},
): Promise<TestUser> {
  const name = opts.name ?? `${role}-${Date.now().toString(36)}-${++n}`;
  const pin = opts.pin ?? String(1000 + Math.floor(Math.random() * 9000));
  const [u] = await db.insert(users).values({ name, role, pinHash: await hashPin(pin) }).returning();
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { name, pin } });
  if (res.statusCode !== 200) throw new Error(`test login failed for ${name}: ${res.statusCode} ${res.body}`);
  const token = res.json().token as string;
  return { id: u.id, name, role, pin, token, headers: { authorization: `Bearer ${token}` } };
}
