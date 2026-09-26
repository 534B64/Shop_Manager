// POST /api/pos/sale — the counter sale (Quick Order and /pos), ADR 0007.
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { withTx } from '../../db/index.js';
import { jobs, payments } from '../../db/schema/index.js';
import { audit } from '../audit/index.js';
import { requireApproval, approvalSchema } from '../auth/index.js';
import { taxRatePct } from '../settings/index.js';
import { recordSale } from '../inventory/index.js';
import { recordPayment, requireOpenDrawer } from '../payments/index.js';
import { SalesError, insertInvoice, liveInvoiceForJob, invoiceHeader, type NewLine } from './service.js';
import { refusable } from './http.js';
import { priceCounterSale, taxExemptReason, TAX_EXEMPT_REASON_MAX } from '../../../shared/invoice.js';

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
  taxExempt?: boolean; taxExemptReason?: string;
}

export async function saleRoutes(app: FastifyInstance) {
  // ---------------- Counter sale (Quick Order) ----------------
  // Job + invoice + stock deduction + payment + audit rows: one transaction.
  // Legacy body {title, amountCents, inventoryItemId?, stockQty?} is one line;
  // `lines` itemizes. Tax (owner decision D10): every line is taxed unless it
  // (or the sale) says `taxable: false` — the legacy `amountCents` is the
  // pre-tax price and tax is added on top. `taxExempt` + a short reason rings
  // the whole sale up untaxed; both are kept on the invoice and audited.
  // Every tender needs an open drawer (D12) — checked before anything else.
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
          taxExempt: { type: 'boolean' },
          taxExemptReason: { type: 'string', maxLength: TAX_EXEMPT_REASON_MAX },
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
      const drawer = await requireOpenDrawer(tx);
      const exemptReason = body.taxExempt ? taxExemptReason(body.taxExemptReason) : null;
      if (body.taxExempt && !exemptReason) {
        throw new SalesError(400, 'A tax-exempt sale needs a short reason (e.g. resale certificate, nonprofit)');
      }
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
      const priced = priceCounterSale(raw, rate, { taxExempt: !!body.taxExempt, defaultTaxable: body.taxable ?? true });
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
        after: { ...job, source: 'pos.sale', taxExempt: !!body.taxExempt, taxExemptReason: exemptReason },
        approvalId: overrideApprovalId });

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
      const { invoice } = await insertInvoice(tx, req, { job, source: 'counter_sale', taxRatePct: rate, discountPct: 0,
        lines, drawerSessionId: drawer.id, taxExempt: !!body.taxExempt, taxExemptReason: exemptReason });
      const payment = await recordPayment(tx, req, { clientRef: `${body.clientRef}:pay`, jobId: job.id,
        customerId: job.customerId, amountCents: priced.totalCents, method: body.method, kind: 'payment',
        tenderedCents: body.tenderedCents ?? null });
      reply.code(201);
      return { ...job, invoice: invoiceHeader(invoice), payment };
    }));
  });
}
