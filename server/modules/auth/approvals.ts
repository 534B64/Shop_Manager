// Approvals list (ADR 0004): who approved what, newest first, keyset-paged on
// id like the audit log. Admin only. Read-only — approvals are append-only.
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '../../db/index.js';
import { approvals, users } from '../../db/schema/index.js';
import { dateRangeConds } from '../../lib/dates.js';

export interface ApprovalQuery {
  action?: string; entity?: string; entityId?: string;
  userId?: number;           // requested OR approved by
  from?: string; to?: string; // inclusive; a bare date is the shop's local day
  before?: number; limit?: number;
}

const requester = alias(users, 'requester');
const approver = alias(users, 'approver');

function where(q: ApprovalQuery): SQL | undefined {
  const A = approvals;
  const conds: SQL[] = [];
  if (q.action) conds.push(eq(A.action, q.action));
  if (q.entity) conds.push(eq(A.entity, q.entity));
  if (q.entityId) conds.push(eq(A.entityId, q.entityId));
  if (q.userId != null) conds.push(or(eq(A.requestedBy, q.userId), eq(A.approvedBy, q.userId))!);
  conds.push(...dateRangeConds(A.createdAt, q.from, q.to));
  if (q.before != null) conds.push(lt(A.id, q.before));
  return conds.length ? and(...conds) : undefined;
}

export async function listApprovals(q: ApprovalQuery) {
  const limit = Math.min(Math.max(q.limit || 50, 1), 200);
  const rows = await db.select({
    id: approvals.id, createdAt: approvals.createdAt, action: approvals.action, entity: approvals.entity,
    entityId: approvals.entityId, reason: approvals.reason, details: approvals.details,
    requestedBy: approvals.requestedBy, requestedByName: requester.name,
    approvedBy: approvals.approvedBy, approvedByName: approver.name,
  }).from(approvals)
    .leftJoin(requester, eq(requester.id, approvals.requestedBy))
    .leftJoin(approver, eq(approver.id, approvals.approvedBy))
    .where(where(q)).orderBy(desc(approvals.id)).limit(limit);
  return { rows, nextBefore: rows.length === limit ? rows[rows.length - 1].id : null };
}

export function parseApprovalQuery(raw: Record<string, string | undefined>): ApprovalQuery {
  const num = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    action: raw.action || undefined, entity: raw.entity || undefined, entityId: raw.entityId || undefined,
    userId: num(raw.userId), from: raw.from || undefined, to: raw.to || undefined,
    before: num(raw.before), limit: num(raw.limit),
  };
}
