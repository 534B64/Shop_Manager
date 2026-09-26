import type { FastifyInstance } from 'fastify';
import { eq, desc, sql, isNull, and } from 'drizzle-orm';
import { parsePage, PagingError } from '../../lib/paging.js';
import { db, withTx } from '../../db/index.js';
import { payments, jobs, customers, customerCredits, invoices, invoiceVoids, salesReturns, drawerSessions } from '../../db/schema/index.js';
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

export async function paymentRoutes(app: FastifyInstance) {
  app.get('/api/payments', async (req) => {
    const { jobId } = req.query as { jobId?: string };
    const q = db
      .select({
        id: payments.id, jobId: payments.jobId, amountCents: payments.amountCents,
        method: payments.method, kind: payments.kind, voidedAt: payments.voidedAt,
        voidReason: payments.voidReason, note: payments.note, createdAt: payments.createdAt,
        drawerSessionId: payments.drawerSessionId, tenderedCents: payments.tenderedCents,
        changeCents: payments.changeCents, returnId: payments.returnId, invoiceVoidId: payments.invoiceVoidId,
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
  // With ?limit= (and optional offset) it answers one page, largest balance
  // first, plus the count and the total owed — all in SQL (the dashboard).
  app.get('/api/balances', async (req, reply) => {
    let page;
    try { page = parsePage(req.query as Record<string, unknown>); } catch (e) {
      if (e instanceof PagingError) return reply.code(400).send({ error: 'bad_paging', message: e.message });
      throw e;
    }
    const live = db.$with('live').as(
      db.select({
        jobId: payments.jobId,
        net: sql<number>`sum(case when ${payments.kind} = 'refund' then -${payments.amountCents} else ${payments.amountCents} end)`.as('net'),
      }).from(payments).where(isNull(payments.voidedAt)).groupBy(payments.jobId),
    );
    const ret = db.$with('ret').as(
      db.select({ jobId: invoices.jobId, total: sql<number>`sum(${salesReturns.totalCents})`.as('total') })
        .from(salesReturns).innerJoin(invoices, eq(salesReturns.invoiceId, invoices.id))
        .leftJoin(invoiceVoids, eq(invoiceVoids.invoiceId, invoices.id))
        .where(isNull(invoiceVoids.id)).groupBy(invoices.jobId),
    );
    if (page) {
      const owed = sql<number>`coalesce(${jobs.totalCents}, ${jobs.finalPriceCents}, 0) - coalesce(${ret.total}, 0) - coalesce(${live.net}, 0)`;
      const from = () => db.with(live, ret);
      const where = and(isNull(jobs.deletedAt), sql`${owed} > 0`);
      const rows = await from()
        .select({ jobId: jobs.id, title: jobs.title, status: jobs.status, customerName: customers.name, owedCents: owed })
        .from(jobs).leftJoin(live, eq(live.jobId, jobs.id)).leftJoin(ret, eq(ret.jobId, jobs.id))
        .leftJoin(customers, eq(jobs.customerId, customers.id))
        .where(where).orderBy(desc(owed), jobs.id).limit(page.limit).offset(page.offset);
      const [agg] = await from()
        .select({ n: sql<number>`count(*)`, sum: sql<number>`coalesce(sum(${owed}), 0)` })
        .from(jobs).leftJoin(live, eq(live.jobId, jobs.id)).leftJoin(ret, eq(ret.jobId, jobs.id)).where(where);
      return { rows, total: agg.n, totalOwedCents: agg.sum, ...page };
    }
    const rows = await db.with(live, ret)
      .select({
        jobId: jobs.id, title: jobs.title, status: jobs.status,
        customerName: customers.name, finalPriceCents: sql<number | null>`coalesce(${jobs.totalCents}, ${jobs.finalPriceCents})`,
        paidCents: sql<number>`coalesce(${live.net}, 0)`,
        returnedCents: sql<number>`coalesce(${ret.total}, 0)`,
      })
      .from(jobs)
      .leftJoin(live, eq(live.jobId, jobs.id))
      .leftJoin(ret, eq(ret.jobId, jobs.id))
      .leftJoin(customers, eq(jobs.customerId, customers.id))
      .where(isNull(jobs.deletedAt));
    return rows
      .map((r) => ({ ...r, owedCents: (r.finalPriceCents ?? 0) - r.returnedCents - r.paidCents }))
      .filter((r) => r.owedCents > 0);
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
