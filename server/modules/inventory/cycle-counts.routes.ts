// Cycle counts (blind count v2, 2026-07-07) with the Phase 2 approval flow
// (ADR 0006): counting → submitted → posted.
//
//   submit     — anyone. Snapshots each counted item's system on-hand at that
//                moment into cycle_count_lines (variance = counted − snapshot);
//                variances above the Settings threshold need a reason code.
//                On-hand does NOT change.
//   post       — manager approval ('cycle_count.post'). One 'count'
//                transaction per line with delta = the snapshotted variance
//                (not counted − current, so sales between count and post
//                aren't lost), then the avg-daily-usage recompute and the
//                auto-reschedule. A manager submitting can post in the same
//                request (`post: true`).
//   send-back  — manager+. Submitted → counting; the round's lines stay
//                (append-only) and are superseded by the next submission.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { db, withTx, type Db } from '../../db/index.js';
import { parsePage, PagingError } from '../../lib/paging.js';
import { cycleCounts, cycleCountLines, inventoryBalances, inventoryItems } from '../../db/schema/index.js';
import { VARIANCE_REASON_CODES } from '../../../shared/domain.js';
import { varianceFor } from '../../../shared/countReview.js';
import { countUnitCost } from '../../../shared/costing.js';
import {
  inventorySettings, postTransaction, recomputeAvgDailyUse, itemsById, DEFAULT_LOCATION_ID,
} from './service.js';
import { ledgerWrite, ReplySent } from './http.js';
import { requireApproval, requireRole, approvalSchema } from '../auth/index.js';
import { audit } from '../audit/index.js';

type CycleCount = typeof cycleCounts.$inferSelect;

/** Cost per COUNT unit for the dollar-impact snapshot: the moving average,
 *  else last cost ÷ factor, else unknown. */
function costPerCountUnit(item: { avgCostCents: number; lastCostCents: number | null; purchaseToCountFactor: number }): number | null {
  if (item.avgCostCents > 0) return item.avgCostCents;
  if (item.lastCostCents == null) return null;
  return Math.round(countUnitCost(item.lastCostCents, item.purchaseToCountFactor));
}

const currentLines = (cc: CycleCount, dbx: Db = db) =>
  dbx.select().from(cycleCountLines)
    .where(and(eq(cycleCountLines.cycleCountId, cc.id), eq(cycleCountLines.submission, cc.submission)))
    .orderBy(asc(cycleCountLines.id));

/** The session's current-round lines with item names — shown only once the
 *  blind entry is over (submitted or posted). */
const namedLines = (cc: CycleCount) =>
  db.select({
    itemId: cycleCountLines.itemId, name: inventoryItems.name, countUnit: inventoryItems.countUnit,
    systemCount: cycleCountLines.systemCount, countedQty: cycleCountLines.countedQty,
    unitCostCents: cycleCountLines.unitCostCents, reasonCode: cycleCountLines.reasonCode, note: cycleCountLines.note,
  }).from(cycleCountLines).innerJoin(inventoryItems, eq(cycleCountLines.itemId, inventoryItems.id))
    .where(and(eq(cycleCountLines.cycleCountId, cc.id), eq(cycleCountLines.submission, cc.submission)))
    .orderBy(asc(cycleCountLines.id));

/** Post a submitted session inside the caller's transaction. Without
 *  approval the 403 is already sent — throws ReplySent so the caller's whole
 *  transaction (a same-step submission included) rolls back and the client's
 *  approval retry finds the session as it was. */
async function postSession(req: FastifyRequest, reply: FastifyReply, cc: CycleCount, tx: Db, nextOverride?: string) {
  const approver = await requireApproval(req, reply, { action: 'cycle_count.post', entity: 'cycle_count', entityId: cc.id,
    details: { submittedBy: cc.submittedBy, submittedAt: cc.submittedAt } });
  if (!approver) throw new ReplySent();
  const lines = await currentLines(cc, tx);
  const changes: { itemId: number; variance: number; posted: number; reason: string }[] = [];
  for (const l of lines) {
    const variance = l.countedQty - l.systemCount;
    if (variance === 0) continue;
    // Variance-based: whatever moved since submission stays moved. Clamp so
    // the location never goes below zero (an oversell between count and post).
    const [bal] = await tx.select({ onHand: inventoryBalances.onHand }).from(inventoryBalances)
      .where(and(eq(inventoryBalances.itemId, l.itemId), eq(inventoryBalances.locationId, DEFAULT_LOCATION_ID)));
    const have = bal?.onHand ?? 0;
    const qty = variance < 0 ? Math.max(variance, -have) : variance;
    const reason = l.reasonCode ?? 'cycle_count';
    if (qty !== 0) {
      await postTransaction({
        itemId: l.itemId, locationId: DEFAULT_LOCATION_ID, type: 'count', qty, reason,
        note: [l.note, qty !== variance ? `variance ${variance}, only ${have} left to remove` : null].filter(Boolean).join(' — ') || null,
        source: { type: 'cycle_count', id: cc.id }, cycleCountId: cc.id,
        user: { id: approver.id, name: cc.submittedBy ?? approver.name },
      }, tx);
    }
    changes.push({ itemId: l.itemId, variance, posted: qty, reason });
  }
  const [closed] = await tx.update(cycleCounts).set({
    status: 'posted', completedAt: new Date().toISOString(), postedBy: approver.name,
    notes: `${lines.length} items counted, ${changes.length} adjusted`,
  }).where(eq(cycleCounts.id, cc.id)).returning();

  // Rolling avg daily usage, measured to when the count was taken — needs the
  // session marked posted first (the baseline lookup excludes it by id).
  const asOf = cc.submittedAt ? Date.parse(cc.submittedAt) : Date.now();
  for (const l of lines) await recomputeAvgDailyUse(l.itemId, l.countedQty, cc.id, asOf, tx);

  // Auto-reschedule: posting a count ALWAYS queues the next one (default +7
  // days — the weekly rhythm the roll SKUs depend on). No human memory, no
  // external calendar (deliberate — see TASKS.md Phase 11).
  const next = nextOverride ?? cc.nextScheduledFor
    ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [queued] = await tx.insert(cycleCounts).values({ scheduledFor: next }).returning();
  await audit(tx, req, { action: 'cycle_count.post', entity: 'cycle_count', entityId: cc.id,
    before: cc, after: { ...closed, changes, nextCycleCountId: queued.id }, approvalId: approver.approvalId });
  return { ok: true, status: 'posted', itemsCounted: lines.length, itemsAdjusted: changes.length, nextScheduledFor: next };
}

export async function cycleCountRoutes(app: FastifyInstance) {
  // The open session (counting or submitted), if any. A submitted one comes
  // with its lines — system counts are only revealed after the blind entry.
  app.get('/api/cycle-counts/next', async () => {
    const [pending] = await db.select().from(cycleCounts)
      .where(ne(cycleCounts.status, 'posted')).orderBy(cycleCounts.scheduledFor, cycleCounts.id).limit(1);
    if (!pending) return null;
    if (pending.status !== 'submitted') return pending;
    return { ...pending, lines: await namedLines(pending) };
  });

  // Count history, newest first: { rows, total, limit, offset } (default 25).
  app.get('/api/cycle-counts', async (req, reply) => {
    let page;
    try { page = parsePage(req.query as Record<string, unknown>) ?? { limit: 25, offset: 0 }; } catch (e) {
      if (!(e instanceof PagingError)) throw e;
      return reply.code(400).send({ error: 'bad_paging', message: e.message });
    }
    const rows = await db.select().from(cycleCounts).orderBy(desc(cycleCounts.id)).limit(page.limit).offset(page.offset);
    const [n] = await db.select({ n: sql<number>`count(*)` }).from(cycleCounts);
    return { rows, total: Number(n?.n ?? 0), ...page };
  });

  // One session. Lines only once submitted or posted — a count still being
  // taken stays blind.
  app.get('/api/cycle-counts/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [cc] = Number.isInteger(id) ? await db.select().from(cycleCounts).where(eq(cycleCounts.id, id)) : [];
    if (!cc) return reply.code(404).send({ error: 'Cycle count not found' });
    return { ...cc, lines: cc.status === 'counting' ? [] : await namedLines(cc) };
  });

  app.post('/api/cycle-counts', {
    schema: { body: { type: 'object', required: ['scheduledFor'], additionalProperties: false,
      properties: { scheduledFor: { type: 'string', minLength: 10, maxLength: 10 } } } },
  }, async (req, reply) => {
    return withTx(async (tx) => {
      const [row] = await tx.insert(cycleCounts).values(req.body as { scheduledFor: string }).returning();
      await audit(tx, req, { action: 'cycle_count.create', entity: 'cycle_count', entityId: row.id, after: row });
      reply.code(201);
      return row;
    });
  });

  app.post('/api/cycle-counts/:id/submit', {
    schema: { body: { type: 'object', required: ['counts'], additionalProperties: false,
      properties: {
        counts: { type: 'array', items: { type: 'object', required: ['itemId', 'counted'],
          additionalProperties: false,
          properties: {
            itemId: { type: 'integer' },
            counted: { type: 'integer', minimum: 0 },
            reasonCode: { type: 'string', enum: [...VARIANCE_REASON_CODES] },
            note: { type: 'string', maxLength: 300 },
          } } },
        nextScheduledFor: { type: 'string', minLength: 10, maxLength: 10 },
        // Manager shortcut: submit and post in one step (still approval-gated).
        post: { type: 'boolean' },
        approval: approvalSchema,
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const who = req.user!.name;
    const { counts, nextScheduledFor, post } = req.body as {
      counts: { itemId: number; counted: number; reasonCode?: string; note?: string }[];
      nextScheduledFor?: string; post?: boolean;
    };
    return ledgerWrite(reply, () => withTx(async (tx) => {
      const [cc] = await tx.select().from(cycleCounts).where(eq(cycleCounts.id, id));
      if (!cc) return reply.code(404).send({ error: 'Cycle count not found' });
      if (cc.status !== 'counting') return reply.code(409).send({ error: cc.status === 'posted' ? 'Already posted' : 'Already submitted — awaiting manager approval' });

      const t = await inventorySettings(tx);
      const byId = await itemsById(counts.map((c) => c.itemId), tx);

      // Validate against the on-hand right now — that's the snapshot the
      // variance is booked from (the server's math is the one that binds).
      const missingReason: { itemId: number; name: string }[] = [];
      for (const c of counts) {
        const item = byId.get(c.itemId);
        if (!item) continue;
        const v = varianceFor({ itemId: c.itemId, systemCount: item.count, counted: c.counted,
          unitCostCents: costPerCountUnit(item) }, t);
        if (v.aboveThreshold && !c.reasonCode) missingReason.push({ itemId: c.itemId, name: item.name });
      }
      if (missingReason.length > 0) {
        return reply.code(400).send({
          error: `Reason code required for ${missingReason.length} variance(s) above threshold`,
          items: missingReason,
        });
      }

      const submission = cc.submission + 1;
      let withVariance = 0;
      for (const c of counts) {
        const item = byId.get(c.itemId);
        if (!item) continue;
        const delta = c.counted - item.count;
        if (delta !== 0) withVariance++;
        // A voluntarily-chosen reason on a small variance is kept — required
        // only above threshold, never discarded.
        await tx.insert(cycleCountLines).values({
          cycleCountId: id, submission, itemId: c.itemId, systemCount: item.count, countedQty: c.counted,
          unitCostCents: costPerCountUnit(item),
          reasonCode: delta !== 0 ? c.reasonCode ?? null : null,
          note: c.note ?? null,
        });
      }
      const [submitted] = await tx.update(cycleCounts).set({
        status: 'submitted', submission, submittedAt: new Date().toISOString(), submittedBy: who,
        completedBy: who, nextScheduledFor: nextScheduledFor ?? cc.nextScheduledFor,
        notes: `${counts.length} items counted, ${withVariance} with a variance`,
      }).where(eq(cycleCounts.id, id)).returning();
      await audit(tx, req, { action: 'cycle_count.submit', entity: 'cycle_count', entityId: id,
        before: cc, after: { ...submitted, itemsCounted: counts.length, withVariance } });

      if (post) return postSession(req, reply, submitted, tx);
      return { ok: true, status: 'submitted', itemsCounted: counts.length, itemsWithVariance: withVariance };
    }));
  });

  app.post('/api/cycle-counts/:id/post', {
    schema: { body: { type: 'object', additionalProperties: false,
      properties: {
        nextScheduledFor: { type: 'string', minLength: 10, maxLength: 10 },
        approval: approvalSchema,
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { nextScheduledFor } = (req.body ?? {}) as { nextScheduledFor?: string };
    return ledgerWrite(reply, () => withTx(async (tx) => {
      const [cc] = await tx.select().from(cycleCounts).where(eq(cycleCounts.id, id));
      if (!cc) return reply.code(404).send({ error: 'Cycle count not found' });
      if (cc.status !== 'submitted') return reply.code(409).send({ error: cc.status === 'posted' ? 'Already posted' : 'Not submitted yet' });
      return postSession(req, reply, cc, tx, nextScheduledFor);
    }));
  });

  app.post('/api/cycle-counts/:id/send-back', {
    schema: { body: { type: 'object', additionalProperties: false,
      properties: { reason: { type: 'string', maxLength: 300 } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const id = Number((req.params as { id: string }).id);
    const { reason } = (req.body ?? {}) as { reason?: string };
    return withTx(async (tx) => {
      const [cc] = await tx.select().from(cycleCounts).where(eq(cycleCounts.id, id));
      if (!cc) return reply.code(404).send({ error: 'Cycle count not found' });
      if (cc.status !== 'submitted') return reply.code(409).send({ error: 'Only a submitted count can be sent back' });
      const [row] = await tx.update(cycleCounts).set({
        status: 'counting', notes: `Sent back by ${req.user!.name}${reason ? `: ${reason}` : ''}`,
      }).where(eq(cycleCounts.id, id)).returning();
      await audit(tx, req, { action: 'cycle_count.send_back', entity: 'cycle_count', entityId: id,
        before: cc, after: { ...row, reason: reason ?? null } });
      return row;
    });
  });
}
