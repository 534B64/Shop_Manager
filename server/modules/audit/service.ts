// Audit service (ADR 0005): one append-only row per mutation, written with
// the caller's transaction handle so the change and its audit row commit (or
// roll back) together.
import type { FastifyRequest } from 'fastify';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { db, type Db } from '../../db/index.js';
import { auditLog } from '../../db/schema/index.js';
import { dateRangeConds } from '../../lib/dates.js';

export interface AuditEntry {
  action: string;          // e.g. 'customer.archive'
  entity: string;          // e.g. 'customer'
  entityId?: string | number | null;
  before?: unknown;        // entity snapshot before the change (null on create)
  after?: unknown;         // entity snapshot after the change
  approvalId?: number | null;
  userId?: number | null;  // defaults to req.user (sign-in sets it explicitly)
}

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

export async function audit(tx: Db, req: FastifyRequest | null, e: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    userId: e.userId !== undefined ? e.userId : req?.user?.id ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId != null ? String(e.entityId) : null,
    beforeJson: json(e.before),
    afterJson: json(e.after),
    approvalId: e.approvalId ?? null,
    requestId: req ? String(req.id) : null,
  });
}

export interface AuditQuery {
  entity?: string; entityId?: string; userId?: number;
  from?: string; to?: string; // ISO dates/datetimes, inclusive
  before?: number;            // keyset cursor: rows with id < before
  limit?: number;
}

function where(q: AuditQuery): SQL | undefined {
  const conds: SQL[] = [];
  if (q.entity) conds.push(eq(auditLog.entity, q.entity));
  if (q.entityId) conds.push(eq(auditLog.entityId, q.entityId));
  if (q.userId != null) conds.push(eq(auditLog.userId, q.userId));
  // A bare date is the shop's local day (server/lib/dates.ts).
  conds.push(...dateRangeConds(auditLog.at, q.from, q.to));
  if (q.before != null) conds.push(lt(auditLog.id, q.before));
  return conds.length ? and(...conds) : undefined;
}

/** Newest first, keyset-paginated on id. */
export async function listAudit(q: AuditQuery) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const rows = await db.select().from(auditLog).where(where(q)).orderBy(desc(auditLog.id)).limit(limit);
  return { rows, nextBefore: rows.length === limit ? rows[rows.length - 1].id : null };
}

/** Every matching row, oldest first (CSV export). */
export async function allAudit(q: Omit<AuditQuery, 'before' | 'limit'>) {
  return db.select().from(auditLog).where(where(q)).orderBy(auditLog.id);
}
