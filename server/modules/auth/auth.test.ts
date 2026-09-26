// Phase 1a (ADR 0004): sign-in, sessions, roles, manager approvals, the
// last-admin guard, and the plaintext-password upgrade. Own throwaway DB.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { TestUser } from '../../test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
let manager: TestUser;
let cashier: TestUser;
let createUserWithToken: typeof import('../../test-helpers.js').createUserWithToken;
let dbm: typeof import('../../db/index.js');
let schema: typeof import('../../db/schema/index.js');
let auth: typeof import('./index.js');
let orm: typeof import('drizzle-orm');

const ref = () => crypto.randomUUID();
const as = (u: TestUser | null, opts: InjectOptions) =>
  app.inject({ ...opts, headers: u ? u.headers : {} });

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DB_PATH = dbFile; // BEFORE importing the db singleton
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
  await app.ready();
  ({ createUserWithToken } = await import('../../test-helpers.js'));
  dbm = await import('../../db/index.js');
  schema = await import('../../db/schema/index.js');
  auth = await import('./index.js');
  orm = await import('drizzle-orm');
  admin = await createUserWithToken(app, 'admin', { name: 'Owner', pin: '1234' });
  // Cash needs an open drawer (Phase 3, ADR 0007).
  await app.inject({ method: 'POST', url: '/api/drawer/open', headers: admin.headers, payload: { openingFloatCents: 0 } });
  manager = await createUserWithToken(app, 'manager', { name: 'Mgr', pin: '2222' });
  cashier = await createUserWithToken(app, 'cashier', { name: 'Cash', pin: '3333' });
});

afterAll(async () => {
  await app.close();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

async function approvalsFor(action: string, entityId: string | number) {
  const { approvals } = schema;
  const rows = await dbm.db.select().from(approvals).where(orm.eq(approvals.action, action));
  return rows.filter((r) => r.entityId === String(entityId));
}

async function paidJob(amountCents = 5000) {
  const job = (await as(cashier, { method: 'POST', url: '/api/jobs', payload: {
    clientRef: ref(), type: 'decal', title: 'Auth test', status: 'acknowledged', finalPriceCents: amountCents,
  } })).json();
  const pay = (await as(cashier, { method: 'POST', url: '/api/payments', payload: {
    clientRef: ref(), jobId: job.id, amountCents, method: 'cash',
  } })).json();
  return { job, pay };
}

describe('sign-in', () => {
  it('logs in with name + PIN and returns a token, role, and prefs', async () => {
    const res = await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: 'Mgr', pin: '2222' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.json().user).toMatchObject({ name: 'Mgr', role: 'manager' });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${res.json().token}` } });
    expect(me.json().user).toMatchObject({ name: 'Mgr', role: 'manager' });
  });

  it('rejects a wrong PIN and an unknown name with the same 401', async () => {
    const bad = await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: 'Mgr', pin: '9999' } });
    const unknown = await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: 'Nobody', pin: '2222' } });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().error).toBe(unknown.json().error);
  });

  it('rate-limits after 10 failures per name (429), then recovers on reset', async () => {
    const u = await createUserWithToken(app, 'cashier', { pin: '4444' });
    for (let i = 0; i < 10; i++) {
      await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: u.name, pin: '0000' } });
    }
    const limited = await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: u.name, pin: '4444' } });
    expect(limited.statusCode).toBe(429); // even the right PIN, until the window passes
    auth.resetRateLimits();
    const ok = await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: u.name, pin: '4444' } });
    expect(ok.statusCode).toBe(200);
  });

  it('needs no setup once an admin exists, and lists sign-in accounts publicly', async () => {
    const st = await as(null, { method: 'GET', url: '/api/auth/status' });
    expect(st.statusCode).toBe(200);
    expect(st.json().needsSetup).toBe(false);
    expect(st.json().accounts.map((a: { name: string }) => a.name)).toContain('Mgr');
    const setup = await as(null, { method: 'POST', url: '/api/auth/setup', payload: { name: 'Intruder', pin: '1111' } });
    expect(setup.statusCode).toBe(409);
  });
});

describe('sessions', () => {
  it('401s every /api route without a token; health stays public', async () => {
    expect((await as(null, { method: 'GET', url: '/api/jobs' })).statusCode).toBe(401);
    expect((await as(null, { method: 'GET', url: '/api/settings/tax' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/jobs', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await as(null, { method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });

  it('logout revokes the session', async () => {
    const u = await createUserWithToken(app, 'cashier');
    expect((await as(u, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(200);
    await as(u, { method: 'POST', url: '/api/auth/logout' });
    expect((await as(u, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
  });

  it('expires after 12h idle and at the 7-day absolute cap', async () => {
    const { sessions } = schema;
    const idle = await createUserWithToken(app, 'cashier');
    await dbm.db.update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - auth.SESSION_IDLE_MS - 1000).toISOString() })
      .where(orm.eq(sessions.userId, idle.id));
    expect((await as(idle, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);

    const old = await createUserWithToken(app, 'cashier');
    await dbm.db.update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() }) // last_seen is fresh
      .where(orm.eq(sessions.userId, old.id));
    expect((await as(old, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
  });

  it('slides the idle window on use', async () => {
    const { sessions } = schema;
    const u = await createUserWithToken(app, 'cashier');
    const stale = new Date(Date.now() - 11 * 3600_000).toISOString(); // 11h idle — still valid
    await dbm.db.update(sessions).set({ lastSeenAt: stale }).where(orm.eq(sessions.userId, u.id));
    expect((await as(u, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(200);
    const [s] = await dbm.db.select().from(sessions).where(orm.eq(sessions.userId, u.id));
    expect(s.lastSeenAt > stale).toBe(true);
  });

  it('stores only a hash of the token', async () => {
    const { sessions } = schema;
    const rows = await dbm.db.select().from(sessions).where(orm.eq(sessions.userId, admin.id));
    expect(rows.some((r) => r.tokenHash === admin.token)).toBe(false);
  });
});

describe('roles', () => {
  it('blocks a cashier from admin configuration', async () => {
    expect((await as(cashier, { method: 'PUT', url: '/api/settings/tax', payload: { ratePct: 1 } })).statusCode).toBe(403);
    expect((await as(cashier, { method: 'POST', url: '/api/materials', payload: { name: 'X', unit: 'each', costPerUnitCents: 1 } })).statusCode).toBe(403);
    expect((await as(cashier, { method: 'POST', url: '/api/users', payload: { name: 'Sneaky', role: 'admin', pin: '1111' } })).statusCode).toBe(403);
    expect((await as(cashier, { method: 'POST', url: '/api/suppliers', payload: { name: 'X Supply' } })).statusCode).toBe(403);
    // A manager can run inventory taxonomy but not shop settings.
    expect((await as(manager, { method: 'POST', url: '/api/suppliers', payload: { name: `Mgr Supply ${ref()}` } })).statusCode).toBe(201);
    expect((await as(manager, { method: 'PUT', url: '/api/settings/tax', payload: { ratePct: 1 } })).statusCode).toBe(403);
    // Reads stay open to every signed-in account (the quote page needs them).
    expect((await as(cashier, { method: 'GET', url: '/api/settings/tax' })).statusCode).toBe(200);
  });

  it('takes attribution from the session, never the body', async () => {
    // A typed createdBy is stripped by the schema; the session name wins.
    const res = await as(cashier, { method: 'POST', url: '/api/pos/sale', payload: {
      clientRef: ref(), title: 'Sticker', amountCents: 300, method: 'cash', createdBy: 'Someone Else',
    } });
    expect(res.statusCode).toBe(201);
    expect(res.json().createdBy).toBe('Cash');
  });
});

describe('manager approval', () => {
  it('cashier void → 403 approval_required, nothing changes', async () => {
    const { pay } = await paidJob();
    const res = await as(cashier, { method: 'POST', url: `/api/payments/${pay.id}/void`, payload: { reason: 'wrong amount' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'approval_required', action: 'payment.void' });
    const [p] = await dbm.db.select().from(schema.payments).where(orm.eq(schema.payments.id, pay.id));
    expect(p.voidedAt).toBeNull();
    expect(await approvalsFor('payment.void', pay.id)).toHaveLength(0);
  });

  it('cashier void succeeds with a manager PIN and logs requested/approved by', async () => {
    const { pay } = await paidJob();
    const res = await as(cashier, { method: 'POST', url: `/api/payments/${pay.id}/void`,
      payload: { reason: 'wrong amount', approval: { name: 'Mgr', pin: '2222' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().voidedAt).toBeTruthy();
    const rows = await approvalsFor('payment.void', pay.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: 'payment', requestedBy: cashier.id, approvedBy: manager.id, reason: 'wrong amount' });
    expect(JSON.parse(rows[0].details!)).toMatchObject({ amountCents: 5000 });
  });

  it('a manager acting alone logs an approval with themselves as approver', async () => {
    const { pay } = await paidJob();
    const res = await as(manager, { method: 'POST', url: `/api/payments/${pay.id}/void`, payload: { reason: 'dup' } });
    expect(res.statusCode).toBe(200);
    const rows = await approvalsFor('payment.void', pay.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestedBy: manager.id, approvedBy: manager.id });
  });

  it('rejects a wrong manager PIN, and a cashier trying to approve', async () => {
    const { pay } = await paidJob();
    const wrong = await as(cashier, { method: 'POST', url: `/api/payments/${pay.id}/void`,
      payload: { reason: 'x', approval: { name: 'Mgr', pin: '0000' } } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe('approval_invalid');
    const peer = await createUserWithToken(app, 'cashier', { pin: '5555' });
    const selfish = await as(cashier, { method: 'POST', url: `/api/payments/${pay.id}/void`,
      payload: { reason: 'x', approval: { name: peer.name, pin: '5555' } } });
    expect(selfish.statusCode).toBe(403);
    expect(await approvalsFor('payment.void', pay.id)).toHaveLength(0);
  });

  it('gates refunds over the threshold, unpaid pickup, job removal, and manual stock changes', async () => {
    const { job } = await paidJob(); // $50 paid; a refund over $50 (the default threshold) needs a manager
    await as(cashier, { method: 'POST', url: '/api/payments', payload: { clientRef: ref(), jobId: job.id, amountCents: 2000, method: 'cash' } });
    const refund = await as(cashier, { method: 'POST', url: '/api/payments', payload: {
      clientRef: ref(), jobId: job.id, amountCents: 6000, method: 'cash', kind: 'refund' } });
    expect(refund.json().error).toBe('approval_required');

    const owing = (await as(cashier, { method: 'POST', url: '/api/jobs', payload: {
      clientRef: ref(), type: 'decal', title: 'Owes', status: 'acknowledged', finalPriceCents: 900 } })).json();
    for (const s of ['in_progress', 'done']) {
      await as(cashier, { method: 'PUT', url: `/api/jobs/${owing.id}/status`, payload: { status: s } });
    }
    const p1 = await as(cashier, { method: 'PUT', url: `/api/jobs/${owing.id}/status`, payload: { status: 'picked_up' } });
    expect(p1.statusCode).toBe(402); // balance shown first
    const p2 = await as(cashier, { method: 'PUT', url: `/api/jobs/${owing.id}/status`, payload: { status: 'picked_up', override: true } });
    expect(p2.json().error).toBe('approval_required');
    const p3 = await as(cashier, { method: 'PUT', url: `/api/jobs/${owing.id}/status`,
      payload: { status: 'picked_up', override: true, approval: { name: 'Mgr', pin: '2222' } } });
    expect(p3.statusCode).toBe(200);
    expect(p3.json().notes).toMatch(/manager override by Mgr \(for Cash\)/);
    expect(await approvalsFor('job.pickup_unpaid', owing.id)).toHaveLength(1);

    const fresh = (await as(cashier, { method: 'POST', url: '/api/jobs', payload: {
      clientRef: ref(), type: 'decal', title: 'Mistake', status: 'acknowledged', finalPriceCents: 100 } })).json();
    expect((await as(cashier, { method: 'DELETE', url: `/api/jobs/${fresh.id}`, payload: {} })).json().error).toBe('approval_required');
    expect((await as(manager, { method: 'DELETE', url: `/api/jobs/${fresh.id}`, payload: {} })).statusCode).toBe(200);

    const item = (await as(cashier, { method: 'POST', url: '/api/inventory', payload: { name: `Auth item ${ref()}`, count: 5 } })).json();
    const shrink = await as(cashier, { method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: -2, reason: 'damaged' } });
    expect(shrink.json().error).toBe('approval_required');
    const receive = await as(cashier, { method: 'POST', url: `/api/inventory/${item.id}/adjust`, payload: { delta: 4, reason: 'received' } });
    expect(receive.statusCode).toBe(200); // receiving is day-to-day, no approval
  });

  it('keeps the approvals log append-only', async () => {
    const { approvals } = schema;
    await expect(dbm.db.update(approvals).set({ reason: 'edited' })).rejects.toThrow(/append-only/);
    await expect(dbm.db.delete(approvals)).rejects.toThrow(/append-only/);
  });
});

describe('users admin', () => {
  it('creates users with a role + PIN (min 4 digits) and resets a PIN', async () => {
    const short = await as(admin, { method: 'POST', url: '/api/users', payload: { name: 'Shorty', role: 'cashier', pin: '12' } });
    expect(short.statusCode).toBe(400);
    const made = await as(admin, { method: 'POST', url: '/api/users', payload: { name: 'Newbie', role: 'cashier', pin: '7777' } });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ name: 'Newbie', role: 'cashier', hasPin: true });
    const login = await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: 'Newbie', pin: '7777' } });
    expect(login.statusCode).toBe(200);
    await as(admin, { method: 'PUT', url: `/api/users/${made.json().id}/pin`, payload: { pin: '8888' } });
    // Reset signs them out everywhere.
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${login.json().token}` } })).statusCode).toBe(401);
    expect((await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: 'Newbie', pin: '8888' } })).statusCode).toBe(200);
  });

  it('lets a user change their own PIN only with the current PIN', async () => {
    const u = await createUserWithToken(app, 'cashier', { pin: '6060' });
    expect((await as(u, { method: 'PUT', url: '/api/users/me/pin', payload: { current: '0000', next: '6161' } })).statusCode).toBe(401);
    expect((await as(u, { method: 'PUT', url: '/api/users/me/pin', payload: { current: '6060', next: '6161' } })).statusCode).toBe(200);
    expect((await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: u.name, pin: '6161' } })).statusCode).toBe(200);
  });

  it('deactivation signs the user out and blocks sign-in', async () => {
    const u = await createUserWithToken(app, 'cashier', { pin: '9090' });
    expect((await as(admin, { method: 'DELETE', url: `/api/users/${u.id}` })).statusCode).toBe(200);
    expect((await as(u, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: u.name, pin: '9090' } })).statusCode).toBe(401);
  });

  it('refuses to demote or deactivate the last active admin', async () => {
    // Owner is the only admin in this DB.
    const demote = await as(admin, { method: 'PUT', url: `/api/users/${admin.id}`, payload: { role: 'manager' } });
    expect(demote.statusCode).toBe(409);
    const deact = await as(admin, { method: 'DELETE', url: `/api/users/${admin.id}` });
    expect(deact.statusCode).toBe(409);
    // With a second admin it's allowed.
    const second = await createUserWithToken(app, 'admin');
    expect((await as(admin, { method: 'PUT', url: `/api/users/${second.id}`, payload: { role: 'manager' } })).statusCode).toBe(200);
    expect((await as(admin, { method: 'PUT', url: `/api/users/${admin.id}`, payload: { role: 'manager' } })).statusCode).toBe(409);
  });
});

describe('plaintext password upgrade', () => {
  it('hashes a legacy plaintext password into pin_hash, NULLs it, and is idempotent', async () => {
    const { users } = schema;
    const [legacy] = await dbm.db.insert(users).values({ name: `Legacy ${ref().slice(0, 6)}`, password: 'oldpw', role: 'admin' }).returning();
    const [nopw] = await dbm.db.insert(users).values({ name: `NoPw ${ref().slice(0, 6)}`, role: 'cashier' }).returning();
    expect(await auth.upgradePlaintextPasswords()).toBe(1);
    const [after] = await dbm.db.select().from(users).where(orm.eq(users.id, legacy.id));
    expect(after.password).toBeNull();
    expect(after.pinHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await auth.upgradePlaintextPasswords()).toBe(0);
    // The old password still signs in (now checked against the hash) …
    const ok = await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: legacy.name, pin: 'oldpw' } });
    expect(ok.statusCode).toBe(200);
    // … and an account with neither has no login until an admin sets a PIN.
    const [np] = await dbm.db.select().from(users).where(orm.eq(users.id, nopw.id));
    expect(np.pinHash).toBeNull();
    expect((await as(null, { method: 'POST', url: '/api/auth/login', payload: { name: nopw.name, pin: '' } })).statusCode).toBe(400);
  });
});
