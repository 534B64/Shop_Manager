// Sales routes (Phase 3, ADR 0007): counter sale (moved here from payments,
// same path), invoices, invoice voids, returns, and the cash drawer.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, isNotNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import {
  jobs, payments, invoices, invoiceLines, invoiceVoids, salesReturns, salesReturnLines, drawerSessions,
} from '../../db/schema/index.js';
import { audit } from '../audit/index.js';
import { requireApproval, requireRole, approvalSchema } from '../auth/index.js';
import { taxRatePct, posSettings } from '../settings/index.js';
import { recordSale, recordReturn, InventoryError } from '../inventory/index.js';
import { recordPayment, paidNetCents, returnedCents, openDrawer, PaymentError } from '../payments/index.js';
import {
  SalesError, insertInvoice, invoiceJob, liveInvoiceForJob, invoiceHeader, invoiceDetail,
  computeZReport, drawerView, zReportCsv, type NewLine,
} from './service.js';
import {
  priceInvoice, returnLineRefund, refundDueCents, parseInvoiceNumber, TENDER_METHODS,
} from '../../../shared/invoice.js';

/** Run a write; a refused SalesError/PaymentError/InventoryError (thrown
 *  inside withTx, so it rolled back) becomes its HTTP status. */
async function refusable<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SalesError || e instanceof PaymentError || e instanceof InventoryError) {
      return reply.code(e.status).send({ error: e.message, ...(e instanceof PaymentError && e.code ? { code: e.code } : {}) });
    }
    throw e;
  }
}

const pageLimit = (v?: string) => Math.min(Math.max(Number(v) || 50, 1), 200);
const endOfDay = (to: string) => (to.length === 10 ? `${to}T99` : to);

const saleLineSchema = {
  type: 'object', required: ['description', 'qty', 'unitPriceCents'], additionalProperties: false,
  properties: {
    description: { type: 'string', minLength: 1, maxLength: 200 },
    qty: { type: 'integer', minimum: 1, maximum: 9999 },
    unitPriceCents: { type: 'integer', minimum: 0 },
    taxable: { type: 'boolean' },
    inventoryItemId: { type: 'integer' },
    // The estimator's/price book's suggested unit price, when there is one —
    // a different unitPriceCents is a price override (manager approval).
    suggestedUnitPriceCents: { type: 'integer', minimum: 0 },
  },
} as const;

interface SaleLineIn {
  description: string; qty: number; unitPriceCents: number; taxable?: boolean;
  inventoryItemId?: number; suggestedUnitPriceCents?: number;
}
interface SaleBody {
  clientRef: string; method: string; title?: string; amountCents?: number; customerId?: number;
  inventoryItemId?: number; stockQty?: number; taxable?: boolean; tenderedCents?: number; lines?: SaleLineIn[];
}

export async function salesRoutes(app: FastifyInstance) {
  // ---------------- Counter sale (Quick Order) ----------------
  // Job + invoice + stock deduction + payment + audit rows: one transaction.
  // Legacy body {title, amountCents, inventoryItemId?, stockQty?} is one line;
  // `lines` itemizes. Tax: `taxable` (per line or for the sale) defaults to
  // false — the counter has never added tax on top of the amount rung up.
  app.post('/api/pos/sale', {
    schema: {
      body: {
        type: 'object', required: ['clientRef', 'method'], additionalProperties: false,
        properties: {
          clientRef: { type: 'string', minLength: 8, maxLength: 64 },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          amountCents: { type: 'integer', minimum: 1 },
          method: { type: 'string', enum: ['cash', 'check', 'card', 'other'] },
          customerId: { type: 'integer' },
          // Optional "from stock" link (2026-07-07): qty is in COUNT units.
          inventoryItemId: { type: 'integer' },
          stockQty: { type: 'integer', minimum: 1, maximum: 9999 },
          taxable: { type: 'boolean' },
          tenderedCents: { type: 'integer', minimum: 0 },
          lines: { type: 'array', minItems: 1, maxItems: 50, items: saleLineSchema },
          approval: approvalSchema, // price override (ADR 0007)
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as SaleBody;
    return refusable(reply, () => withTx(async (tx) => {
      const [existing] = await tx.select().from(jobs).where(eq(jobs.clientRef, body.clientRef));
      if (existing) {
        const inv = await liveInvoiceForJob(existing.id, tx);
        const [pay] = await tx.select().from(payments).where(eq(payments.clientRef, `${body.clientRef}:pay`));
        return { ...existing, invoice: inv ? invoiceHeader(inv) : null, payment: pay ?? null };
      }
      const defaultTaxable = body.taxable ?? false;
      let raw: (SaleLineIn & { subtotalCents: number; stockWanted: number })[];
      if (body.lines?.length) {
        raw = body.lines.map((l) => ({ ...l, subtotalCents: l.qty * l.unitPriceCents, stockWanted: l.qty }));
        const stockIds = raw.filter((l) => l.inventoryItemId != null).map((l) => l.inventoryItemId);
        if (new Set(stockIds).size !== stockIds.length) throw new SalesError(400, 'Put each stock item on one line');
      } else {
        if (!body.title || body.amountCents == null) throw new SalesError(400, 'Description and amount (or lines) are required');
        const qty = body.inventoryItemId != null ? body.stockQty ?? 1 : 1;
        raw = [{ description: body.title, qty, unitPriceCents: Math.round(body.amountCents / qty),
          inventoryItemId: body.inventoryItemId, subtotalCents: body.amountCents, stockWanted: body.stockQty ?? 1 }];
      }
      const rate = await taxRatePct(tx);
      const priced = priceInvoice(raw.map((l) => ({ qty: l.qty, subtotalCents: l.subtotalCents, taxable: l.taxable ?? defaultTaxable })), rate, 0);
      if (priced.totalCents <= 0) throw new SalesError(400, 'A sale must be for more than $0.00');

      // Price override: a line rung up at something other than its suggested
      // price needs a manager — checked before anything is written.
      const overrides = raw.filter((l) => l.suggestedUnitPriceCents != null && l.suggestedUnitPriceCents !== l.unitPriceCents);
      let overrideApprovalId: number | null = null;
      if (overrides.length) {
        const approver = await requireApproval(req, reply, { action: 'price.override', entity: 'counter_sale', entityId: body.clientRef,
          details: { lines: overrides.map((l) => ({ description: l.description, suggestedUnitPriceCents: l.suggestedUnitPriceCents, unitPriceCents: l.unitPriceCents })) } });
        if (!approver) return reply;
        overrideApprovalId = approver.approvalId;
      }

      const title = body.title ?? (raw.length > 1 ? `${raw[0].description} + ${raw.length - 1} more` : raw[0].description);
      const [job] = await tx.insert(jobs).values({
        clientRef: body.clientRef, type: 'retail', title, status: 'picked_up',
        finalPriceCents: priced.subtotalCents, totalCents: priced.totalCents,
        taxable: priced.lines.some((l) => l.taxable), taxRatePct: rate,
        customerId: body.customerId ?? null, createdBy: req.user!.name,
      }).returning();
      await audit(tx, req, { action: 'job.create', entity: 'job', entityId: job.id,
        after: { ...job, source: 'pos.sale' }, approvalId: overrideApprovalId });

      // Counter-sale deduction — the ONE tracked-sale write into inventory
      // (weekly cycle counts reconcile everything else). After the idempotency
      // return above, so a wifi retry never deducts twice; clamps at zero and
      // never blocks the sale on stock levels. A DB error rolls it all back.
      const lines: NewLine[] = [];
      for (const [i, l] of raw.entries()) {
        let stockQty = 0;
        if (l.inventoryItemId != null) {
          const sale = await recordSale({ itemId: l.inventoryItemId, qty: l.stockWanted, title: l.description,
            jobId: job.id, createdBy: req.user!.name, userId: req.user!.id }, tx);
          stockQty = sale.applied;
          if (sale.adjustmentId != null) {
            await audit(tx, req, { action: 'inventory.sold', entity: 'inventory_item', entityId: l.inventoryItemId,
              before: { count: sale.countBefore }, after: { count: (sale.countBefore ?? 0) - sale.applied,
                adjustmentId: sale.adjustmentId, jobId: job.id } });
          }
        }
        lines.push({ ...priced.lines[i], description: l.description, unitPriceCents: l.unitPriceCents,
          suggestedCents: l.suggestedUnitPriceCents != null ? l.suggestedUnitPriceCents * l.qty : null,
          inventoryItemId: l.inventoryItemId ?? null, stockQty });
      }
      const drawer = await openDrawer(tx);
      const { invoice } = await insertInvoice(tx, req, { job, source: 'counter_sale', taxRatePct: rate, discountPct: 0,
        lines, drawerSessionId: drawer?.id ?? null });
      // Cash with no open drawer fails here — after the invoice took its
      // number — and the rollback hands the number back.
      const payment = await recordPayment(tx, req, { clientRef: `${body.clientRef}:pay`, jobId: job.id,
        customerId: job.customerId, amountCents: priced.totalCents, method: body.method, kind: 'payment',
        tenderedCents: body.tenderedCents ?? null });
      reply.code(201);
      return { ...job, invoice: invoiceHeader(invoice), payment };
    }));
  });

  // ---------------- Invoices ----------------
  // Keyset paging newest first: {rows, nextBefore}; pass ?before=<nextBefore>.
  app.get('/api/invoices', async (req, reply) => {
    const q = req.query as { from?: string; to?: string; customerId?: string; number?: string; jobId?: string;
      status?: string; limit?: string; before?: string };
    const limit = pageLimit(q.limit);
    const conds: SQL[] = [];
    if (q.from) conds.push(gte(invoices.createdAt, q.from));
    if (q.to) conds.push(lte(invoices.createdAt, endOfDay(q.to)));
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
  // original tender, or all to `refundMethod`). The job is archived (the sale
  // is cancelled) unless keepJob, which unlocks it for editing + re-invoicing.
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
      const approver = await requireApproval(req, reply, { action: 'invoice.void', entity: 'invoice', entityId: id,
        reason: body.reason, details: { number: inv.number, totalCents: inv.totalCents } });
      if (!approver) return reply;
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, inv.jobId));

      // Refund plan: what's been paid, back by the way it came in.
      const live = await tx.select().from(payments).where(and(eq(payments.jobId, inv.jobId), isNull(payments.voidedAt)));
      const paidNet = await paidNetCents(inv.jobId, tx);
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
      const drawer = await openDrawer(tx);
      const [v] = await tx.insert(invoiceVoids).values({
        invoiceId: id, reason: body.reason, refundCents, jobArchived: !body.keepJob,
        approvalId: approver.approvalId, drawerSessionId: drawer?.id ?? null,
        createdBy: req.user!.name, userId: req.user!.id,
      }).returning();

      const refunds = [];
      for (const p of plan) {
        refunds.push(await recordPayment(tx, req, { jobId: inv.jobId, customerId: job.customerId, amountCents: p.amountCents,
          method: p.method, kind: 'refund', note: `Void of invoice ${String(inv.number).padStart(6, '0')}: ${body.reason}`,
          invoiceVoidId: v.id, approvalId: approver.approvalId }));
      }

      // Stock back: what the sale deducted, less what returns already restocked.
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      const restocked = [];
      for (const l of lines) {
        if (l.inventoryItemId == null || l.stockQty <= 0) continue;
        const [{ back }] = await tx.select({ back: sql<number>`coalesce(sum(${salesReturnLines.restockedQty}), 0)` })
          .from(salesReturnLines).where(eq(salesReturnLines.invoiceLineId, l.id));
        const qty = l.stockQty - back;
        if (qty <= 0) continue;
        const r = await recordReturn({ itemId: l.inventoryItemId, qty, source: { type: 'invoice_void', id: v.id },
          note: `Void of invoice ${String(inv.number).padStart(6, '0')}`, user: { id: req.user!.id, name: req.user!.name } }, tx);
        await audit(tx, req, { action: 'inventory.return', entity: 'inventory_item', entityId: l.inventoryItemId,
          before: { count: r.before.count }, after: { count: r.item.count, txnId: r.txn.id, invoiceVoidId: v.id } });
        restocked.push({ inventoryItemId: l.inventoryItemId, qty });
      }

      if (!body.keepJob && !job.deletedAt) {
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

  // ---------------- Returns (RMA) ----------------
  app.post('/api/returns', {
    schema: { body: { type: 'object', required: ['clientRef', 'invoiceId', 'reason', 'lines'], additionalProperties: false,
      properties: {
        clientRef: { type: 'string', minLength: 8, maxLength: 64 },
        invoiceId: { type: 'integer' },
        reason: { type: 'string', minLength: 1, maxLength: 300 },
        lines: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object',
          required: ['invoiceLineId', 'qty'], additionalProperties: false,
          properties: {
            invoiceLineId: { type: 'integer' },
            qty: { type: 'integer', minimum: 1 },
            restock: { type: 'boolean' },
          } } },
        refundMethod: { type: 'string', enum: [...TENDER_METHODS] },
        approval: approvalSchema,
      } } },
  }, async (req, reply) => {
    const body = req.body as { clientRef: string; invoiceId: number; reason: string; refundMethod?: string;
      lines: { invoiceLineId: number; qty: number; restock?: boolean }[] };
    return refusable(reply, () => withTx(async (tx) => {
      const [dup] = await tx.select().from(salesReturns).where(eq(salesReturns.clientRef, body.clientRef));
      if (dup) return returnDetail(dup.id, tx);
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, body.invoiceId));
      if (!inv) throw new SalesError(404, 'Invoice not found');
      const [voided] = await tx.select().from(invoiceVoids).where(eq(invoiceVoids.invoiceId, inv.id));
      if (voided) throw new SalesError(409, 'Invoice is voided — nothing left to return');

      const invLines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
      const prior = invLines.length ? await tx.select().from(salesReturnLines)
        .where(inArray(salesReturnLines.invoiceLineId, invLines.map((l) => l.id))) : [];
      const seen = new Set<number>();
      const planned = body.lines.map((rl) => {
        const line = invLines.find((l) => l.id === rl.invoiceLineId);
        if (!line) throw new SalesError(400, `Line ${rl.invoiceLineId} is not on this invoice`);
        if (seen.has(line.id)) throw new SalesError(400, 'List each invoice line once');
        seen.add(line.id);
        const already = prior.filter((p) => p.invoiceLineId === line.id).reduce((s, p) => s + p.qty, 0);
        const value = returnLineRefund(line, already, rl.qty);
        if (!value) throw new SalesError(409, `Line ${line.lineNo}: can't return ${rl.qty} — ${line.qty - already} of ${line.qty} left to return`);
        if (rl.restock && line.inventoryItemId == null) throw new SalesError(400, `Line ${line.lineNo} isn't a stock item — it can't be restocked`);
        return { line, qty: rl.qty, restock: !!rl.restock, value };
      });
      const sum = (f: (p: typeof planned[number]) => number) => planned.reduce((s, p) => s + f(p), 0);
      const totalCents = sum((p) => p.value.totalCents);

      const [job] = await tx.select().from(jobs).where(eq(jobs.id, inv.jobId));
      const refundCents = refundDueCents({ returnCents: totalCents, invoiceTotalCents: inv.totalCents,
        returnedBeforeCents: await returnedCents(inv.jobId, tx), paidNetCents: await paidNetCents(inv.jobId, tx) });
      if (refundCents > 0 && !body.refundMethod) throw new SalesError(400, 'Pick how the refund goes back (refundMethod)');

      // Over the Settings threshold → manager approval; at or under → cashier alone.
      const { refundApprovalThresholdCents } = await posSettings(tx);
      let approvalId: number | null = null;
      if (totalCents > refundApprovalThresholdCents) {
        const approver = await requireApproval(req, reply, { action: 'return.refund', entity: 'invoice', entityId: inv.id,
          reason: body.reason, details: { number: inv.number, totalCents, refundCents, thresholdCents: refundApprovalThresholdCents } });
        if (!approver) return reply;
        approvalId = approver.approvalId;
      }

      const drawer = await openDrawer(tx);
      const [ret] = await tx.insert(salesReturns).values({
        clientRef: body.clientRef, invoiceId: inv.id, reason: body.reason,
        subtotalCents: sum((p) => p.value.subtotalCents), taxCents: sum((p) => p.value.taxCents),
        discountCents: sum((p) => p.value.discountCents), totalCents, refundCents,
        refundMethod: refundCents > 0 ? body.refundMethod! : null, approvalId, drawerSessionId: drawer?.id ?? null,
        createdBy: req.user!.name, userId: req.user!.id,
      }).returning();
      await tx.insert(salesReturnLines).values(planned.map((p) => ({
        returnId: ret.id, invoiceLineId: p.line.id, qty: p.qty, restock: p.restock, restockedQty: p.restock ? p.qty : 0,
        subtotalCents: p.value.subtotalCents, taxCents: p.value.taxCents, discountCents: p.value.discountCents,
        totalCents: p.value.totalCents,
      })));
      // Restock only the lines marked restockable (damaged goods stay off the shelf).
      for (const p of planned.filter((x) => x.restock)) {
        const r = await recordReturn({ itemId: p.line.inventoryItemId!, qty: p.qty, source: { type: 'return', id: ret.id },
          note: `Return #${ret.id} on invoice ${String(inv.number).padStart(6, '0')}`, user: { id: req.user!.id, name: req.user!.name } }, tx);
        await audit(tx, req, { action: 'inventory.return', entity: 'inventory_item', entityId: p.line.inventoryItemId,
          before: { count: r.before.count }, after: { count: r.item.count, txnId: r.txn.id, returnId: ret.id } });
      }
      if (refundCents > 0) {
        await recordPayment(tx, req, { jobId: inv.jobId, customerId: job.customerId, amountCents: refundCents,
          method: body.refundMethod!, kind: 'refund', note: `Return #${ret.id}: ${body.reason}`, returnId: ret.id, approvalId });
      }
      await audit(tx, req, { action: 'return.create', entity: 'return', entityId: ret.id,
        after: { ...ret, lines: planned.map((p) => ({ invoiceLineId: p.line.id, qty: p.qty, restock: p.restock })) }, approvalId });
      reply.code(201);
      return returnDetail(ret.id, tx);
    }));
  });

  app.get('/api/returns', async (req) => {
    const q = req.query as { invoiceId?: string; from?: string; to?: string; limit?: string; before?: string };
    const limit = pageLimit(q.limit);
    const conds: SQL[] = [];
    if (q.invoiceId) conds.push(eq(salesReturns.invoiceId, Number(q.invoiceId)));
    if (q.from) conds.push(gte(salesReturns.createdAt, q.from));
    if (q.to) conds.push(lte(salesReturns.createdAt, endOfDay(q.to)));
    if (q.before) conds.push(lt(salesReturns.id, Number(q.before)));
    const rows = await db.select({ ret: salesReturns, invoiceNumber: invoices.number }).from(salesReturns)
      .innerJoin(invoices, eq(salesReturns.invoiceId, invoices.id))
      .where(conds.length ? and(...conds) : undefined).orderBy(desc(salesReturns.id)).limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({ ...r.ret, invoiceNumber: String(r.invoiceNumber).padStart(6, '0') })),
      nextBefore: rows.length > limit ? page[page.length - 1].ret.id : null,
    };
  });

  app.get('/api/returns/:id', async (req, reply) => {
    const out = await returnDetail(Number((req.params as { id: string }).id));
    if (!out) return reply.code(404).send({ error: 'Return not found' });
    return out;
  });

  // ---------------- Cash drawer ----------------
  app.post('/api/drawer/open', {
    schema: { body: { type: 'object', required: ['openingFloatCents'], additionalProperties: false,
      properties: {
        openingFloatCents: { type: 'integer', minimum: 0, maximum: 10_000_000 },
        note: { type: 'string', maxLength: 300 },
      } } },
  }, async (req, reply) => {
    const body = req.body as { openingFloatCents: number; note?: string };
    return refusable(reply, () => withTx(async (tx) => {
      const current = await openDrawer(tx);
      if (current) throw new SalesError(409, `Drawer #${current.id} is already open — close it before opening another`);
      const [d] = await tx.insert(drawerSessions).values({
        openedBy: req.user!.id, openingFloatCents: body.openingFloatCents, openNote: body.note ?? null,
      }).returning();
      await audit(tx, req, { action: 'drawer.open', entity: 'drawer_session', entityId: d.id, after: d });
      reply.code(201);
      return drawerView(d, tx);
    }));
  });

  // The open session with a live Z-report preview, or {drawer: null}.
  app.get('/api/drawer/current', async () => {
    const d = await openDrawer();
    return { drawer: d ? await drawerView(d) : null };
  });

  // Close = count the drawer: expected vs counted cash (and checks), the
  // over/short, and the Z-report frozen onto the session. Manager or admin.
  app.post('/api/drawer/close', {
    schema: { body: { type: 'object', required: ['countedCashCents'], additionalProperties: false,
      properties: {
        countedCashCents: { type: 'integer', minimum: 0, maximum: 100_000_000 },
        countedChecksCents: { type: 'integer', minimum: 0, maximum: 100_000_000 },
        note: { type: 'string', maxLength: 500 },
      } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const body = req.body as { countedCashCents: number; countedChecksCents?: number; note?: string };
    return refusable(reply, () => withTx(async (tx) => {
      const d = await openDrawer(tx);
      if (!d) throw new SalesError(409, 'No drawer is open');
      const z = await computeZReport(d, { cash: body.countedCashCents, checks: body.countedChecksCents ?? null }, tx);
      const [closed] = await tx.update(drawerSessions).set({
        status: 'closed', closedAt: new Date().toISOString(), closedBy: req.user!.id,
        expectedCashCents: z.cash.expectedCents, countedCashCents: body.countedCashCents, overShortCents: z.cash.overShortCents,
        expectedChecksCents: z.checks.expectedCents, countedChecksCents: body.countedChecksCents ?? null,
        checksOverShortCents: z.checks.overShortCents, closeNote: body.note ?? null, zReportJson: JSON.stringify(z),
      }).where(eq(drawerSessions.id, d.id)).returning();
      await audit(tx, req, { action: 'drawer.close', entity: 'drawer_session', entityId: d.id, before: d, after: closed });
      return drawerView(closed, tx);
    }));
  });

  // History, newest first: {rows, nextBefore} (Z-report JSON left out).
  app.get('/api/drawer', async (req) => {
    const q = req.query as { limit?: string; before?: string };
    const limit = pageLimit(q.limit);
    const rows = await db.select().from(drawerSessions)
      .where(q.before ? lt(drawerSessions.id, Number(q.before)) : undefined)
      .orderBy(desc(drawerSessions.id)).limit(limit + 1);
    const page = rows.slice(0, limit).map(({ zReportJson: _z, ...rest }) => rest);
    return { rows: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null };
  });

  app.get('/api/drawer/:id', async (req, reply) => {
    const d = await drawerById(Number((req.params as { id: string }).id));
    if (!d) return reply.code(404).send({ error: 'Drawer session not found' });
    return drawerView(d);
  });

  app.get('/api/drawer/:id/z-report', async (req, reply) => {
    const d = await drawerById(Number((req.params as { id: string }).id));
    if (!d) return reply.code(404).send({ error: 'Drawer session not found' });
    const v = await drawerView(d);
    return { sessionId: v.id, status: v.status, final: v.final, openedAt: v.openedAt, openedByName: v.openedByName,
      closedAt: v.closedAt, closedByName: v.closedByName, ...v.zReport };
  });

  app.get('/api/drawer/:id/z-report.csv', async (req, reply) => {
    const d = await drawerById(Number((req.params as { id: string }).id));
    if (!d) return reply.code(404).send({ error: 'Drawer session not found' });
    reply.header('content-type', 'text/csv')
      .header('content-disposition', `attachment; filename="z-report-${d.id}.csv"`);
    return zReportCsv(await drawerView(d));
  });
}

async function drawerById(id: number) {
  const [d] = await db.select().from(drawerSessions).where(eq(drawerSessions.id, id));
  return d ?? null;
}

async function returnDetail(id: number, dbx = db) {
  const [ret] = await dbx.select().from(salesReturns).where(eq(salesReturns.id, id));
  if (!ret) return null;
  const lines = await dbx.select({ rl: salesReturnLines, lineNo: invoiceLines.lineNo, description: invoiceLines.description,
    inventoryItemId: invoiceLines.inventoryItemId })
    .from(salesReturnLines).innerJoin(invoiceLines, eq(salesReturnLines.invoiceLineId, invoiceLines.id))
    .where(eq(salesReturnLines.returnId, id)).orderBy(asc(invoiceLines.lineNo));
  const [inv] = await dbx.select({ number: invoices.number }).from(invoices).where(eq(invoices.id, ret.invoiceId));
  const refunds = await dbx.select().from(payments).where(eq(payments.returnId, id));
  return {
    ...ret, invoiceNumber: String(inv.number).padStart(6, '0'),
    lines: lines.map((l) => ({ ...l.rl, lineNo: l.lineNo, description: l.description, inventoryItemId: l.inventoryItemId })),
    refunds,
  };
}
