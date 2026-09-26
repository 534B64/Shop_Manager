import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, desc, isNull } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { payments, jobs, customers, customerCredits, drawerSessions } from '../../db/schema/index.js';
import { parsePage, PagingError, type PageQuery } from '../../lib/paging.js';
import { paymentPage, paymentColumns, balances } from './lists.js';
import { recordPayment, paidNetCents, PaymentError } from './service.js';
import { invoiceIfSettled, SalesError } from '../sales/index.js';
import { requireApproval, approvalSchema } from '../auth/index.js';
import { audit } from '../audit/index.js';
import { TENDER_METHODS } from '../../../shared/invoice.js';

export const PAYMENT_METHODS = TENDER_METHODS;

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The page asked for, null when unpaged, undefined after a 400 was sent. */
function pagedOr400(q: Record<string, unknown>, reply: FastifyReply): PageQuery | null | undefined {
  try { return parsePage(q); } catch (e) {
    if (!(e instanceof PagingError)) throw e;
    reply.code(400).send({ error: 'bad_paging', message: e.message });
    return undefined;
  }
}

export async function paymentRoutes(app: FastifyInstance) {
  // Newest 100 (old shape), or paged {rows,total,limit,offset} with limit/offset (+ q).
  app.get('/api/payments', async (req, reply) => {
    const query = req.query as { jobId?: string } & Record<string, unknown>;
    const page = pagedOr400(query, reply);
    if (page === undefined) return reply;
    if (page) return paymentPage(query, page);
    const q = db.select(paymentColumns).from(payments)
      .leftJoin(jobs, eq(payments.jobId, jobs.id))
      .leftJoin(customers, eq(jobs.customerId, customers.id));
    if (query.jobId) return q.where(eq(payments.jobId, Number(query.jobId))).orderBy(desc(payments.createdAt));
    return q.orderBy(desc(payments.createdAt)).limit(100);
  });

  // kind 'payment' reduces what's owed; kind 'refund' is money handed back.
  // method 'credit' draws down / restores the customer's credit balance.
  // Cash needs an open drawer (409); cash payments may send tenderedCents
  // (change is recorded). A payment that settles the job issues its invoice
  // in the same transaction (Phase 3, ADR 0007) — returned as `invoice`.
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
          tenderedCents: { type: 'integer', minimum: 0 },
          approval: approvalSchema, // refunds only (ADR 0004)
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { clientRef: string; jobId: number; amountCents: number; method: string; kind?: 'payment' | 'refund'; note?: string; tenderedCents?: number };
    const kind = body.kind ?? 'payment';
    // One transaction: the credit-ledger row, the payment, the invoice (when
    // this settles the job), and the audit rows commit together.
    try {
      return await withTx(async (tx) => {
        const [existing] = await tx.select().from(payments).where(eq(payments.clientRef, body.clientRef));
        if (existing) return existing;
        const [job] = await tx.select().from(jobs).where(eq(jobs.id, body.jobId));
        if (!job) return reply.code(400).send({ error: 'Unknown job' });
        if (body.method === 'credit' && !job.customerId) return reply.code(400).send({ error: 'Job has no customer — credit needs an account' });
        // Money going back out needs a manager (after the idempotency return, so a
        // wifi retry of an approved refund never asks twice or logs twice).
        let approvalId: number | null = null;
        if (kind === 'refund') {
          // Never hand back more than the job has actually been paid.
          const paid = await paidNetCents(job.id, tx);
          if (body.amountCents > paid) {
            return reply.code(409).send({ error: `Refund is more than was paid on this job (${(paid / 100).toFixed(2)})` });
          }
          const approver = await requireApproval(req, reply, { action: 'payment.refund', entity: 'job', entityId: job.id,
            reason: body.note ?? null, details: { amountCents: body.amountCents, method: body.method, clientRef: body.clientRef } });
          if (!approver) return reply;
          approvalId = approver.approvalId;
        }
        const row = await recordPayment(tx, req, { clientRef: body.clientRef, jobId: job.id, customerId: job.customerId,
          amountCents: body.amountCents, method: body.method, kind, note: body.note ?? null,
          tenderedCents: body.tenderedCents ?? null, approvalId });
        const invoice = kind === 'payment' ? await invoiceIfSettled(tx, req, job.id) : null;
        reply.code(201);
        return invoice ? { ...row, invoice: { id: invoice.id, number: invoice.number,
          numberDisplay: String(invoice.number).padStart(6, '0'), totalCents: invoice.totalCents } } : row;
      });
    } catch (e) {
      if (e instanceof PaymentError || e instanceof SalesError) {
        return reply.code(e.status).send({ error: e.message, ...(e instanceof PaymentError && e.code ? { code: e.code } : {}) });
      }
      throw e;
    }
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
      // A refund made by a return or an invoice void belongs to that record,
      // and money in a closed (counted) drawer is final — correct either with
      // a new refund/return instead.
      if (p.returnId != null || p.invoiceVoidId != null) {
        return reply.code(409).send({ error: 'This refund belongs to a return or invoice void — it can’t be voided; issue a refund/return instead' });
      }
      if (p.drawerSessionId != null) {
        const [d] = await tx.select({ status: drawerSessions.status }).from(drawerSessions).where(eq(drawerSessions.id, p.drawerSessionId));
        if (d?.status === 'closed') {
          return reply.code(409).send({ error: 'This payment is in a closed drawer — it can’t be voided; issue a refund/return instead' });
        }
      }
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

  // Balance = after-tax total − returned goods − live payments + live refunds.
  // Removed (archived) jobs — incl. sales cancelled by an invoice void — are left out.
  // Paged (+ q, largest first, with totalOwedCents) when limit/offset is sent.
  app.get('/api/balances', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const page = pagedOr400(query, reply);
    if (page === undefined) return reply;
    return balances(query, page);
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
  // POST /api/pos/sale moved to the sales module (Phase 3, same path).
}
