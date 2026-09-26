// Invoices (ADR 0007): list, by number, invoice a job by hand, and void.
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { jobs, payments, invoices, invoiceLines, invoiceVoids, salesReturns, salesReturnLines } from '../../db/schema/index.js';
import { audit } from '../audit/index.js';
import { requireApproval, approvalSchema } from '../auth/index.js';
import { recordReturn } from '../inventory/index.js';
import { recordPayment, paidNetCents, openDrawer, requireOpenDrawer } from '../payments/index.js';
import { SalesError, invoiceJob, invoiceHeader, invoiceDetail } from './service.js';
import { refusable, pageLimit } from './http.js';
import { dateRangeConds } from '../../lib/dates.js';
import { parseInvoiceNumber, TENDER_METHODS } from '../../../shared/invoice.js';

export async function invoiceRoutes(app: FastifyInstance) {
  // Keyset paging newest first: {rows, nextBefore}; pass ?before=<nextBefore>.
  app.get('/api/invoices', async (req, reply) => {
    const q = req.query as { from?: string; to?: string; customerId?: string; number?: string; jobId?: string;
      status?: string; limit?: string; before?: string };
    const limit = pageLimit(q.limit);
    const conds: SQL[] = [];
    conds.push(...dateRangeConds(invoices.createdAt, q.from, q.to));
    if (q.customerId) conds.push(eq(invoices.customerId, Number(q.customerId)));
    if (q.jobId) conds.push(eq(invoices.jobId, Number(q.jobId)));
    if (q.number) {
      const n = parseInvoiceNumber(q.number);
      if (n == null) return reply.code(400).send({ error: 'Invoice number must be digits' });
      conds.push(eq(invoices.number, n));
    }
    if (q.status === 'voided') conds.push(isNotNull(invoiceVoids.id));
    if (q.status === 'issued') conds.push(isNull(invoiceVoids.id));
    if (q.before) conds.push(lt(invoices.id, Number(q.before)));
    const rows = await db.select({
      inv: invoices, voidId: invoiceVoids.id,
      returnedCents: sql<number>`coalesce((select sum(r.total_cents) from returns r where r.invoice_id = ${invoices.id}), 0)`,
    }).from(invoices).leftJoin(invoiceVoids, eq(invoiceVoids.invoiceId, invoices.id))
      .where(conds.length ? and(...conds) : undefined).orderBy(desc(invoices.id)).limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => invoiceHeader(r.inv, { voided: r.voidId != null, returnedCents: r.returnedCents })),
      nextBefore: rows.length > limit ? page[page.length - 1].inv.id : null,
    };
  });

  // By invoice NUMBER ("000042" or "42").
  app.get('/api/invoices/:number', async (req, reply) => {
    const n = parseInvoiceNumber((req.params as { number: string }).number);
    if (n == null) return reply.code(400).send({ error: 'Invoice number must be digits' });
    const [inv] = await db.select().from(invoices).where(eq(invoices.number, n));
    if (!inv) return reply.code(404).send({ error: 'Invoice not found' });
    return invoiceDetail(inv);
  });

  // Invoice a job by hand (e.g. re-invoicing after a void with keepJob).
  // Idempotent: returns the job's live invoice (200) when it already has one.
  app.post('/api/invoices', {
    schema: { body: { type: 'object', required: ['jobId'], additionalProperties: false,
      properties: { jobId: { type: 'integer' } } } },
  }, async (req, reply) => {
    const { jobId } = req.body as { jobId: number };
    return refusable(reply, () => withTx(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
      if (!job || job.deletedAt) throw new SalesError(404, 'Job not found');
      const drawer = await openDrawer(tx);
      const out = await invoiceJob(tx, req, jobId, drawer?.id ?? null);
      if (out.created) reply.code(201);
      return invoiceDetail(out.invoice, tx);
    }));
  });

  // Void: cancels the whole invoice. The invoice and its lines are never
  // touched — a linked void record is written, the stock the sale deducted
  // goes back, and what the customer paid is refunded (one refund row per
  // original tender, or all to `refundMethod`). Default by source (D11): a
  // counter sale's job is archived (the sale is cancelled); a job invoice's job
  // stays open, unlocked, to be fixed and re-invoiced. `keepJob` overrides.
  // A void that refunds money needs the open drawer (D12).
  app.post('/api/invoices/:id/void', {
    schema: { body: { type: 'object', required: ['reason'], additionalProperties: false,
      properties: {
        reason: { type: 'string', minLength: 1, maxLength: 300 },
        refundMethod: { type: 'string', enum: [...TENDER_METHODS] },
        keepJob: { type: 'boolean' },
        approval: approvalSchema,
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { reason: string; refundMethod?: string; keepJob?: boolean };
    return refusable(reply, () => withTx(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id));
      if (!inv) throw new SalesError(404, 'Invoice not found');
      const [already] = await tx.select().from(invoiceVoids).where(eq(invoiceVoids.invoiceId, id));
      if (already) throw new SalesError(409, 'Invoice already voided');
      const paidNet = await paidNetCents(inv.jobId, tx);
      if (paidNet > 0) await requireOpenDrawer(tx);
      const keepJob = body.keepJob ?? inv.source === 'job';
      const approver = await requireApproval(req, reply, { action: 'invoice.void', entity: 'invoice', entityId: id,
        reason: body.reason, details: { number: inv.number, totalCents: inv.totalCents, keepJob } });
      if (!approver) return reply;
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, inv.jobId));

      // Refund plan: what's been paid, back by the way it came in.
      const live = await tx.select().from(payments).where(and(eq(payments.jobId, inv.jobId), isNull(payments.voidedAt)));
      const byMethod = new Map<string, number>();
      for (const p of live) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + (p.kind === 'refund' ? -p.amountCents : p.amountCents));
      let plan: { method: string; amountCents: number }[] = [];
      if (paidNet > 0) {
        const positive = [...byMethod.entries()].filter(([, v]) => v > 0).map(([method, amountCents]) => ({ method, amountCents }));
        const sumPos = positive.reduce((s, p) => s + p.amountCents, 0);
        if (body.refundMethod) plan = [{ method: body.refundMethod, amountCents: paidNet }];
        else if (sumPos === paidNet) plan = positive;
        else plan = [{ method: positive.sort((a, b) => b.amountCents - a.amountCents)[0].method, amountCents: paidNet }];
      }
      const refundCents = plan.reduce((s, p) => s + p.amountCents, 0);
      // What the void cancels = the invoice less returns already taken on it
      // (those count as returns in the Z-report — never subtract them twice).
      const rets = await tx.select({ total: salesReturns.totalCents, tax: salesReturns.taxCents })
        .from(salesReturns).where(eq(salesReturns.invoiceId, id));
      const netTotalCents = inv.totalCents - rets.reduce((s, r) => s + r.total, 0);
      const netTaxCents = inv.taxCents - rets.reduce((s, r) => s + r.tax, 0);
      const drawer = await openDrawer(tx);
      const [v] = await tx.insert(invoiceVoids).values({
        invoiceId: id, reason: body.reason, refundCents, netTotalCents, netTaxCents, jobArchived: !keepJob,
        approvalId: approver.approvalId, drawerSessionId: drawer?.id ?? null,
        createdBy: req.user!.name, userId: req.user!.id,
      }).returning();

      const refunds = [];
      for (const p of plan) {
        refunds.push(await recordPayment(tx, req, { jobId: inv.jobId, customerId: job.customerId, amountCents: p.amountCents,
          method: p.method, kind: 'refund', note: `Void of invoice ${String(inv.number).padStart(6, '0')}: ${body.reason}`,
          invoiceVoidId: v.id, approvalId: approver.approvalId }));
      }

      // Stock back: what the sale deducted, less every unit already returned —
      // restocked ones are back on the shelf, damaged ones stay off it.
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      const restocked = [];
      for (const l of lines) {
        if (l.inventoryItemId == null || l.stockQty <= 0) continue;
        const [{ returned }] = await tx.select({ returned: sql<number>`coalesce(sum(${salesReturnLines.qty}), 0)` })
          .from(salesReturnLines).where(eq(salesReturnLines.invoiceLineId, l.id));
        const qty = Math.max(0, l.stockQty - Number(returned));
        if (qty <= 0) continue;
        const r = await recordReturn({ itemId: l.inventoryItemId, qty, source: { type: 'invoice_void', id: v.id },
          note: `Void of invoice ${String(inv.number).padStart(6, '0')}`, user: { id: req.user!.id, name: req.user!.name } }, tx);
        await audit(tx, req, { action: 'inventory.return', entity: 'inventory_item', entityId: l.inventoryItemId,
          before: { count: r.before.count }, after: { count: r.item.count, txnId: r.txn.id, invoiceVoidId: v.id } });
        restocked.push({ inventoryItemId: l.inventoryItemId, qty });
      }

      if (!keepJob && !job.deletedAt) {
        const deletedAt = new Date().toISOString();
        await tx.update(jobs).set({ deletedAt }).where(eq(jobs.id, job.id));
        await audit(tx, req, { action: 'job.archive', entity: 'job', entityId: job.id,
          before: job, after: { ...job, deletedAt, reason: 'invoice void' }, approvalId: approver.approvalId });
      }
      await audit(tx, req, { action: 'invoice.void', entity: 'invoice', entityId: id,
        after: { void: v, refunds: refunds.map((r) => r.id), restocked }, approvalId: approver.approvalId });
      reply.code(201);
      return { void: v, refunds, restocked, invoice: await invoiceDetail(inv, tx) };
    }));
  });
}
