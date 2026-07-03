import type { FastifyInstance } from 'fastify';
import { eq, desc, sql, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { payments, jobs, customers, customerCredits } from '../db/schema.js';

export const PAYMENT_METHODS = ['cash', 'check', 'card', 'credit', 'other'] as const;

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function creditBalanceCents(customerId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${customerCredits.deltaCents}), 0)` })
    .from(customerCredits)
    .where(eq(customerCredits.customerId, customerId));
  return row.total;
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
          createdBy: { type: 'string', maxLength: 60 },
          note: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { clientRef: string; jobId: number; amountCents: number; method: string; kind?: 'payment' | 'refund'; createdBy?: string; note?: string };
    const kind = body.kind ?? 'payment';
    const [existing] = await db.select().from(payments).where(eq(payments.clientRef, body.clientRef));
    if (existing) return existing;
    const [job] = await db.select().from(jobs).where(eq(jobs.id, body.jobId));
    if (!job) return reply.code(400).send({ error: 'Unknown job' });

    if (body.method === 'credit') {
      if (!job.customerId) return reply.code(400).send({ error: 'Job has no customer — credit needs an account' });
      if (kind === 'payment') {
        const bal = await creditBalanceCents(job.customerId);
        if (bal < body.amountCents) {
          return reply.code(409).send({ error: `Customer credit is ${(bal / 100).toFixed(2)} — not enough` });
        }
        await db.insert(customerCredits).values({
          customerId: job.customerId, deltaCents: -body.amountCents, note: `Applied to job #${job.id}`,
        });
      } else {
        // Refund-to-credit: store value on the account instead of handing back cash.
        await db.insert(customerCredits).values({
          customerId: job.customerId, deltaCents: body.amountCents, note: `Refund from job #${job.id}`,
        });
      }
    }

    const [row] = await db.insert(payments).values({ ...body, kind }).returning();
    reply.code(201);
    return row;
  });

  // Void = mistake correction. Row stays, balance ignores it, credit is restored.
  app.post('/api/payments/:id/void', {
    schema: { body: { type: 'object', required: ['reason'], additionalProperties: false,
      properties: { reason: { type: 'string', minLength: 1, maxLength: 300 } } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { reason } = req.body as { reason: string };
    const [p] = await db.select().from(payments).where(eq(payments.id, id));
    if (!p) return reply.code(404).send({ error: 'Payment not found' });
    if (p.voidedAt) return reply.code(409).send({ error: 'Already voided' });

    if (p.method === 'credit') {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, p.jobId));
      if (job?.customerId) {
        const delta = p.kind === 'payment' ? p.amountCents : -p.amountCents;
        await db.insert(customerCredits).values({
          customerId: job.customerId, deltaCents: delta, note: `Void of ${p.kind} #${p.id}`,
        });
      }
    }
    const [row] = await db.update(payments)
      .set({ voidedAt: new Date().toISOString(), voidReason: reason })
      .where(eq(payments.id, id)).returning();
    return row;
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
          createdBy: { type: 'string', maxLength: 60 },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { clientRef: string; title: string; amountCents: number; method: string; customerId?: number; createdBy?: string };
    const [existing] = await db.select().from(jobs).where(eq(jobs.clientRef, body.clientRef));
    if (existing) return existing;
    const [job] = await db.insert(jobs).values({
      clientRef: body.clientRef, type: 'retail', title: body.title,
      status: 'picked_up', finalPriceCents: body.amountCents, totalCents: body.amountCents,
      customerId: body.customerId ?? null, createdBy: body.createdBy ?? null,
    }).returning();
    await db.insert(payments).values({
      clientRef: body.clientRef + ':pay', jobId: job.id,
      amountCents: body.amountCents, method: body.method,
    });
    reply.code(201);
    return job;
  });
}
