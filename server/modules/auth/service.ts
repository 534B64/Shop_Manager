// Auth service (ADR 0004): sign-in, sessions, the role check, and manager
// approvals. The one implementation every other module consumes through
// index.ts — no route re-implements a credential or role check.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { db, withTx, type Db } from '../../db/index.js';
import { users, sessions, approvals, type UserRole } from '../../db/schema/index.js';
import { hashPin, verifyPin, newToken, hashToken } from './crypto.js';

export interface AuthUser { id: number; name: string; role: UserRole; prefs: unknown }

declare module 'fastify' {
  interface FastifyRequest { user: AuthUser | null }
}

export const SESSION_IDLE_MS = 12 * 3600_000; // slides with every request
export const SESSION_ABSOLUTE_MS = 7 * 86400_000; // hard cap from sign-in
const TOUCH_EVERY_MS = 60_000; // don't write last_seen_at on every request

const RANK: Record<UserRole, number> = { cashier: 0, manager: 1, admin: 2 };
export const atLeast = (role: UserRole, min: UserRole) => RANK[role] >= RANK[min];

function parsePrefs(raw: string | null): unknown {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// ---- Login rate limit: 10 failures per name per 5 minutes → 429 ----
// In-memory on purpose: one server process; a restart clearing it is fine.
const FAIL_WINDOW_MS = 5 * 60_000;
const MAX_FAILS = 10;
const failures = new Map<string, number[]>();

function recentFailures(name: string): number[] {
  const key = name.trim().toLowerCase();
  const now = Date.now();
  const list = (failures.get(key) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  failures.set(key, list);
  return list;
}
export function isRateLimited(name: string): boolean {
  return recentFailures(name).length >= MAX_FAILS;
}
function noteFailure(name: string) { recentFailures(name).push(Date.now()); }
function clearFailures(name: string) { failures.delete(name.trim().toLowerCase()); }
/** Test hook — the limiter is process-global. */
export function resetRateLimits() { failures.clear(); }

/** Verify name + PIN for an active account. Counts toward the rate limit.
 *  Returns null on any failure (callers never learn which part was wrong). */
export async function verifyCredentials(name: string, pin: string): Promise<AuthUser | null> {
  const [u] = await db.select().from(users).where(eq(users.name, name.trim()));
  const ok = await verifyPin(pin, u && u.active ? u.pinHash : null);
  if (!ok || !u) { noteFailure(name); return null; }
  clearFailures(name);
  return { id: u.id, name: u.name, role: u.role, prefs: parsePrefs(u.prefs) };
}

// ---- Sessions ----

export async function createSession(userId: number): Promise<string> {
  const token = newToken();
  const now = new Date();
  await withTx((tx) => tx.insert(sessions).values({
    tokenHash: hashToken(token), userId,
    createdAt: now.toISOString(), lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString(),
  }));
  return token;
}

export async function revokeSession(token: string): Promise<void> {
  await withTx((tx) => tx.update(sessions).set({ revokedAt: new Date().toISOString() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt))));
}

/** Revoke every live session a user has (deactivation, PIN reset, role change). */
export async function revokeUserSessions(userId: number, exceptToken?: string): Promise<void> {
  const keep = exceptToken ? hashToken(exceptToken) : null;
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    const rows = await tx.select().from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    for (const s of rows) {
      if (s.tokenHash !== keep) {
        await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.tokenHash, s.tokenHash));
      }
    }
  });
}

/** Resolve a bearer token to its user; slides the idle window. null = no
 *  valid session (unknown, revoked, idle-expired, past the absolute cap, or
 *  the account was deactivated). */
export async function resolveSession(token: string): Promise<AuthUser | null> {
  const [s] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  if (!s || s.revokedAt) return null;
  const now = Date.now();
  if (now >= Date.parse(s.expiresAt)) return null;
  if (now - Date.parse(s.lastSeenAt) >= SESSION_IDLE_MS) return null;
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!u || !u.active) return null;
  if (now - Date.parse(s.lastSeenAt) >= TOUCH_EVERY_MS) {
    await withTx((tx) => tx.update(sessions).set({ lastSeenAt: new Date(now).toISOString() })
      .where(eq(sessions.tokenHash, s.tokenHash)));
  }
  return { id: u.id, name: u.name, role: u.role, prefs: parsePrefs(u.prefs) };
}

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

// Paths reachable without a session. Everything else under /api/ needs one;
// non-/api paths (the built client, static files) are never gated.
const PUBLIC_API = new Set(['/api/health', '/api/auth/login', '/api/auth/status', '/api/auth/setup']);

/** Root onRequest hook: resolves req.user for every /api route, 401 otherwise. */
export async function authHook(req: FastifyRequest, reply: FastifyReply) {
  req.user = null;
  const path = req.url.split('?')[0];
  if (!path.startsWith('/api/')) return;
  const token = bearerToken(req);
  if (token) req.user = await resolveSession(token);
  if (PUBLIC_API.has(path)) return;
  if (!req.user) return reply.code(401).send({ error: 'Sign in required' });
}

// ---- Permissions ----

/** Role gate for configuration routes. Sends 403 and returns false when the
 *  signed-in user is below `min`; callers `return reply` on false. */
export function requireRole(req: FastifyRequest, reply: FastifyReply, min: UserRole): boolean {
  if (req.user && atLeast(req.user.role, min)) return true;
  reply.code(403).send({ error: `${min === 'admin' ? 'Admin' : 'Manager'} access required`, requiredRole: min });
  return false;
}

export interface ApprovalInput { name: string; pin: string; reason?: string }
export type Approver = AuthUser & { approvalId: number };
export interface ApprovalRequest {
  action: string; entity: string; entityId?: string | number | null;
  reason?: string | null; details?: unknown;
}

/** JSON-schema fragment every approval-gated route adds to its body schema. */
export const approvalSchema = {
  type: 'object', required: ['name', 'pin'], additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 60 },
    pin: { type: 'string', minLength: 1, maxLength: 100 },
    reason: { type: 'string', maxLength: 300 },
  },
} as const;

/**
 * Manager approval for a sensitive action. Passes (and logs an approvals row)
 * when the signed-in user is a manager/admin — approved_by = themselves — or
 * when the body carries `approval: {name, pin}` from an active manager/admin.
 * Otherwise replies 403 {error:'approval_required', action} (or 403
 * approval_invalid / 429 on a bad or rate-limited PIN) and returns null;
 * callers `return reply` on null. Returns the approver plus the approvals
 * row id (link it from the audit row) on success. Called inside the route's
 * transaction, the approvals row commits or rolls back with the action.
 */
export async function requireApproval(
  req: FastifyRequest, reply: FastifyReply, opts: ApprovalRequest,
): Promise<Approver | null> {
  const me = req.user;
  if (!me) { reply.code(401).send({ error: 'Sign in required' }); return null; }
  const given = (req.body as { approval?: ApprovalInput } | null)?.approval;
  let approver: AuthUser | null = null;
  if (atLeast(me.role, 'manager')) {
    approver = me;
  } else if (given) {
    if (isRateLimited(given.name)) {
      reply.code(429).send({ error: 'Too many wrong PINs — wait a few minutes.', action: opts.action });
      return null;
    }
    const u = await verifyCredentials(given.name, given.pin);
    if (!u || !atLeast(u.role, 'manager')) {
      reply.code(403).send({ error: 'approval_invalid', message: 'Wrong manager name or PIN.', action: opts.action });
      return null;
    }
    approver = u;
  } else {
    reply.code(403).send({ error: 'approval_required', action: opts.action });
    return null;
  }
  const [row] = await withTx((tx) => tx.insert(approvals).values({
    action: opts.action, entity: opts.entity,
    entityId: opts.entityId != null ? String(opts.entityId) : null,
    requestedBy: me.id, approvedBy: approver.id,
    reason: opts.reason ?? given?.reason ?? null,
    details: opts.details !== undefined ? JSON.stringify(opts.details) : null,
  }).returning({ id: approvals.id }));
  return { ...approver, approvalId: row.id };
}

// ---- Admin-count guard + startup upgrade ----

/** Active admins who can actually sign in. */
export async function activeAdminCount(dbx: Db = db): Promise<number> {
  const [row] = await dbx.select({ n: sql<number>`count(*)` }).from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true), isNotNull(users.pinHash)));
  return row.n;
}

/**
 * One-time (idempotent) upgrade run by buildApp: every user still holding a
 * pre-0013 plaintext password gets it hashed into pin_hash and the plaintext
 * NULLed. Users with a pin_hash already just lose the stale plaintext.
 */
export async function upgradePlaintextPasswords(): Promise<number> {
  const rows = await db.select().from(users).where(isNotNull(users.password));
  let upgraded = 0;
  for (const u of rows) {
    const pinHash = !u.pinHash && u.password ? await hashPin(u.password) : u.pinHash;
    if (pinHash !== u.pinHash) upgraded++;
    await withTx((tx) => tx.update(users).set({ pinHash, password: null }).where(eq(users.id, u.id)));
  }
  return upgraded;
}

export { hashPin };
