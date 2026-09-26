import type { FastifyInstance } from 'fastify';
import { eq, desc, sql, and, isNull } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { payments, jobs, customers, customerCredits } from '../../db/schema/index.js';
import { creditBalanceCents } from './service.js';
import { recordSale } from '../inventory/index.js';
import { requireApproval, approvalSchema } from '../auth/index.js';
import { audit } from '../audit/index.js';

export const PAYMENT_METHODS = ['cash', 'check', 'card', 'credit', 'other'] as const;

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function paymentRoutes(app: FastifyInstance) {
  app.get('/api/payments', async (req) => {
    const { jobId } = req.query as { jobId?: string };
    const q = db
      .select({
        id: payments.id, jobId: payments.jobId, amountCents: payments.amountCents,
        method: payments.method, kind: payments.kind, voidedAt: payments.voidedAt,
        voidReason: payments.voidReason, note: payments.note, createdAt: payments.createdAt,
        jobTitle: jobs.title, customerName: customers.name,
      })
      .from(payments)
      .leftJoin(jobs, eq(payments.jobId, jobs.id))
      .leftJoin(customers, eq(jobs.customerId, customers.id));
    if (jobId) return q.where(eq(payments.jobId, Number(jobId))).orderBy(desc(payments.createdAt));
    return q.orderBy(desc(payments.createdAt)).limit(100);
  });

  // kind 'payment' reduces what's owed; kind 'refund' is money handed back.
  // method 'credit' draws down / restores the customer's credit balance.
  app.post('/api/payments', {
    schema: {
      body: {
        type: 'object',
        required: ['clientRef', 'jobId', 'amountCents', 'method'],
        additionalProperties: false,
        properties: {
          clientRef: { type: 'string', minLength: 8, maxLength: 64 },
          jobId: { type: 'integer' },
          amountCents: { type: 'integer', minimum: 1 },
          method: { type: 'string', enum: [...PAYMENT_METHODS] },
          kind: { type: 'string', enum: ['payment', 'refund'] },
          note: { type: 'string', maxLength: 500 },
          approval: approvalSchema, // refunds only (ADR 0004)
        },
      },
    },
  }, async (req, reply) => {
    const { approval: _approval, ...body } = req.body as { clientRef: string; jobId: number; amountCents: number; method: string; kind?: 'payment' | 'refund'; note?: string; approval?: unknown };
    const kind = body.kind ?? 'payment';
    // One transaction: the credit-ledger row, the payment, and the audit row
    // commit together; the balance check reads through the same transaction.
    return withTx(async (tx) => {
      const [existing] = await tx.select().from(payments).where(eq(payments.clientRef, body.clientRef));
      if (existing) return existing;
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, body.jobId));
      if (!job) return reply.code(400).send({ error: 'Unknown job' });
      if (body.method === 'credit') {
        if (!job.customerId) return reply.code(400).send({ error: 'Job has no customer — credit needs an account' });
        if (kind === 'payment') {
          const bal = await creditBalanceCents(job.customerId, tx);
          if (bal < body.amountCents) {
            return reply.code(409).send({ error: `Customer credit is ${(bal / 100).toFixed(2)} — not enough` });
          }
        }
      }
      // Money going back out needs a manager (after the idempotency return, so a
      // wifi retry of an approved refund never asks twice or logs twice).
      let approvalId: number | null = null;
      if (kind === 'refund') {
        const approver = await requireApproval(req, reply, { action: 'payment.refund', entity: 'job', entityId: job.id,
          reason: body.note ?? null, details: { amountCents: body.amountCents, method: body.method, clientRef: body.clientRef } });
        if (!approver) return reply;
        approvalId = approver.approvalId;
      }

      let creditDeltaCents: number | null = null;
      if (body.method === 'credit' && job.customerId) {
        // Payment by credit draws the account down; refund-to-credit stores
        // value on the account instead of handing back cash.
        creditDeltaCents = kind === 'payment' ? -body.amountCents : body.amountCents;
        await tx.insert(customerCredits).values({
          customerId: job.customerId, deltaCents: creditDeltaCents,
          note: kind === 'payment' ? `Applied to job #${job.id}` : `Refund from job #${job.id}`,
        });
      }

      const [row] = await tx.insert(payments).values({ ...body, kind, createdBy: req.user!.name }).returning();
      await audit(tx, req, { action: kind === 'refund' ? 'payment.refund' : 'payment.create', entity: 'payment',
        entityId: row.id, after: { ...row, creditDeltaCents, customerId: job.customerId }, approvalId });
      reply.code(201);
      return row;
    });
  });

  // Void = mistake correction. Row stays, balance ignores it, credit is restored.
  // Manager approval (ADR 0004).
  app.post('/api/payments/:id/void', {
    schema: { body: { type: 'object', required: ['reason'], additionalProperties: false,
      properties: { reason: { type: 'string', minLength: 1, maxLength: 300 }, approval: approvalSchema } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { reason } = req.body as { reason: string };
    return withTx(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, id));
      if (!p) return reply.code(404).send({ error: 'Payment not found' });
      if (p.voidedAt) return reply.code(409).send({ error: 'Already voided' });
      const approver = await requireApproval(req, reply, { action: 'payment.void', entity: 'payment', entityId: p.id,
        reason, details: { jobId: p.jobId, amountCents: p.amountCents, kind: p.kind, method: p.method } });
      if (!approver) return reply;

      let creditDeltaCents: number | null = null;
      if (p.method === 'credit') {
        const [job] = await tx.select().from(jobs).where(eq(jobs.id, p.jobId));
        if (job?.customerId) {
          creditDeltaCents = p.kind === 'payment' ? p.amountCents : -p.amountCents;
          await tx.insert(customerCredits).values({
            customerId: job.customerId, deltaCents: creditDeltaCents, note: `Void of ${p.kind} #${p.id}`,
          });
        }
      }
      const [row] = await tx.update(payments)
        .set({ voidedAt: new Date().toISOString(), voidReason: reason })
        .where(eq(payments.id, id)).returning();
      await audit(tx, req, { action: 'payment.void', entity: 'payment', entityId: id,
        before: p, after: { ...row, creditDeltaCents }, approvalId: approver.approvalId });
      return row;
    });
  });

  // Balance = final price − (live payments) + (live refunds).
  app.get('/api/balances', async () => {
    const live = db.$with('live').as(
      db.select({
        jobId: payments.jobId,
        net: sql<number>`sum(case when ${payments.kind} = 'refund' then -${payments.amountCents} else ${payments.amountCents} end)`.as('net'),
      }).from(payments).where(isNull(payments.voidedAt)).groupBy(payments.jobId),
    );
    const rows = await db.with(live)
      .select({
        jobId: jobs.id, title: jobs.title, status: jobs.status,
        customerName: customers.name, finalPriceCents: sql<number | null>`coalesce(${jobs.totalCents}, ${jobs.finalPriceCents})`,
        paidCents: sql<number>`coalesce(${live.net}, 0)`,
      })
      .from(jobs)
      .leftJoin(live, eq(live.jobId, jobs.id))
      .leftJoin(customers, eq(jobs.customerId, customers.id));
    return rows
      .filter((r) => (r.finalPriceCents ?? 0) - r.paidCents > 0)
      .map((r) => ({ ...r, owedCents: (r.finalPriceCents ?? 0) - r.paidCents }));
  });

  // Date-range summary: daily/weekly/monthly/custom reports come from here.
  app.get('/api/reports/summary', async (req) => {
    const { from, to } = req.query as { from?: string; to?: string };
    let rows = await db.select().from(payments).where(isNull(payments.voidedAt));
    if (from) rows = rows.filter((r) => r.createdAt >= from);
    if (to) rows = rows.filter((r) => r.createdAt <= to + 'T99');
    const byMethod: Record<string, number> = {};
    let paymentsCents = 0, refundsCents = 0;
    for (const r of rows) {
      const signed = r.kind === 'refund' ? -r.amountCents : r.amountCents;
      byMethod[r.method] = (byMethod[r.method] ?? 0) + signed;
      if (r.kind === 'refund') refundsCents += r.amountCents; else paymentsCents += r.amountCents;
    }
    return { from: from ?? null, to: to ?? null, count: rows.length,
      paymentsCents, refundsCents, netCents: paymentsCents - refundsCents, byMethod };
  });

  app.get('/api/reports/payments.csv', async (req, reply) => {
    const { from, to } = req.query as { from?: string; to?: string };
    let rows = await db
      .select({
        id: payments.id, createdAt: payments.createdAt, amountCents: payments.amountCents,
        method: payments.method, kind: payments.kind, voidedAt: payments.voidedAt,
        voidReason: payments.voidReason, note: payments.note, jobTitle: jobs.title,
        jobType: jobs.type, customerName: customers.name,
      })
      .from(payments)
      .leftJoin(jobs, eq(payments.jobId, jobs.id))
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .orderBy(payments.createdAt);
    if (from) rows = rows.filter((r) => r.createdAt >= from);
    if (to) rows = rows.filter((r) => r.createdAt <= to + 'T99');
    const header = 'id,date,amount_dollars,kind,method,customer,job,job_type,voided,void_reason,note';
    const lines = rows.map((r) =>
      [r.id, r.createdAt, (r.amountCents / 100).toFixed(2), r.kind, r.method, csvEscape(r.customerName),
       csvEscape(r.jobTitle), r.jobType, r.voidedAt ? 'yes' : '', csvEscape(r.voidReason), csvEscape(r.note)].join(','));
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="payments.csv"');
    return [header, ...lines].join('\n');
  });

  app.get('/api/reports/jobs.csv', async (req, reply) => {
    const rows = await db
      .select({
        id: jobs.id, createdAt: jobs.createdAt, title: jobs.title, type: jobs.type,
        status: jobs.status, customerName: customers.name,
        suggestedPriceCents: jobs.suggestedPriceCents, finalPriceCents: jobs.finalPriceCents,
        dueDate: jobs.dueDate,
      })
      .from(jobs)
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .orderBy(jobs.createdAt);
    const header = 'id,created,title,type,status,customer,suggested_dollars,final_dollars,due';
    const lines = rows.map((r) =>
      [r.id, r.createdAt, csvEscape(r.title), r.type, r.status, csvEscape(r.customerName),
       r.suggestedPriceCents != null ? (r.suggestedPriceCents / 100).toFixed(2) : '',
       r.finalPriceCents != null ? (r.finalPriceCents / 100).toFixed(2) : '',
       r.dueDate ?? ''].join(','));
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="jobs.csv"');
    return [header, ...lines].join('\n');
  });

  app.post('/api/pos/sale', {
    schema: {
      body: {
        type: 'object',
        required: ['clientRef', 'title', 'amountCents', 'method'],
        additionalProperties: false,
        properties: {
          clientRef: { type: 'string', minLength: 8, maxLength: 64 },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          amountCents: { type: 'integer', minimum: 1 },
          method: { type: 'string', enum: ['cash', 'check', 'card', 'other'] },
          customerId: { type: 'integer' },
          // Optional "from stock" link (2026-07-07): when the counter sale is
          // a stocked item, deduct it from inventory. qty is in COUNT units.
          inventoryItemId: { type: 'integer' },
          stockQty: { type: 'integer', minimum: 1, maximum: 9999 },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { clientRef: string; title: string; amountCents: number; method: string; customerId?: number; inventoryItemId?: number; stockQty?: number };
    // One transaction: job + payment + stock deduction + audit rows commit
    // together or not at all (ADR 0005) — never a paid job with no payment row.
    return withTx(async (tx) => {
      const [existing] = await tx.select().from(jobs).where(eq(jobs.clientRef, body.clientRef));
      if (existing) return existing;
      const [job] = await tx.insert(jobs).values({
        clientRef: body.clientRef, type: 'retail', title: body.title,
        status: 'picked_up', finalPriceCents: body.amountCents, totalCents: body.amountCents,
        customerId: body.customerId ?? null, createdBy: req.user!.name,
      }).returning();
      await audit(tx, req, { action: 'job.create', entity: 'job', entityId: job.id, after: { ...job, source: 'pos.sale' } });
      const [pay] = await tx.insert(payments).values({
        clientRef: body.clientRef + ':pay', jobId: job.id,
        amountCents: body.amountCents, method: body.method, createdBy: req.user!.name,
      }).returning();
      await audit(tx, req, { action: 'payment.create', entity: 'payment', entityId: pay.id, after: pay });
      // Counter-sale deduction — the ONE tracked-sale write into inventory
      // (weekly cycle counts reconcile everything else). Sits after the
      // idempotency return above, so a wifi retry never deducts twice; clamps
      // at zero and never blocks the sale on stock levels — money beats count
      // accuracy. A DB error here rolls the whole sale back (client retries).
      if (body.inventoryItemId != null) {
        const sale = await recordSale({ itemId: body.inventoryItemId, qty: body.stockQty ?? 1,
          title: body.title, jobId: job.id, createdBy: req.user!.name }, tx);
        if (sale.adjustmentId != null) {
          await audit(tx, req, { action: 'inventory.sold', entity: 'inventory_item', entityId: body.inventoryItemId,
            before: { count: sale.countBefore }, after: { count: (sale.countBefore ?? 0) - sale.applied,
              adjustmentId: sale.adjustmentId, jobId: job.id } });
        }
      }
      reply.code(201);
      return job;
    });
  });
}
