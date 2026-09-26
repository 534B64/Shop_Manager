// Returns / RMAs (ADR 0007).
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lt, lte, type SQL } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { jobs, payments, invoices, invoiceLines, invoiceVoids, salesReturns, salesReturnLines } from '../../db/schema/index.js';
import { audit } from '../audit/index.js';
import { requireApproval, approvalSchema } from '../auth/index.js';
import { posSettings } from '../settings/index.js';
import { recordReturn } from '../inventory/index.js';
import { recordPayment, paidNetCents, returnedCents, openDrawer } from '../payments/index.js';
import { SalesError } from './service.js';
import { refusable, pageLimit, endOfDay } from './http.js';
import { returnLineRefund, refundDueCents, TENDER_METHODS } from '../../../shared/invoice.js';

export async function returnRoutes(app: FastifyInstance) {
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
        // Never restock more than the sale took off the shelf (a sale clamps at
        // zero stock, so stockQty can be below qty) less what came back before.
        const restockQty = rl.restock ? Math.min(rl.qty, Math.max(0, line.stockQty - already)) : 0;
        return { line, qty: rl.qty, restock: !!rl.restock, restockQty, value };
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
        returnId: ret.id, invoiceLineId: p.line.id, qty: p.qty, restock: p.restock, restockedQty: p.restockQty,
        subtotalCents: p.value.subtotalCents, taxCents: p.value.taxCents, discountCents: p.value.discountCents,
        totalCents: p.value.totalCents,
      })));
      // Restock only the lines marked restockable (damaged goods stay off the shelf).
      for (const p of planned.filter((x) => x.restockQty > 0)) {
        const r = await recordReturn({ itemId: p.line.inventoryItemId!, qty: p.restockQty, source: { type: 'return', id: ret.id },
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
