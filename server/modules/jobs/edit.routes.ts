// Job edit, remove (archive) and restore.
import type { FastifyInstance } from 'fastify';
import { eq, isNull, and } from 'drizzle-orm';
import { withTx } from '../../db/index.js';
import { jobs, materials, jobItems } from '../../db/schema/index.js';
import { livePaymentCount } from '../payments/index.js';
import { liveInvoiceForJob } from '../sales/index.js';
import { requireApproval, approvalSchema } from '../auth/index.js';
import { audit } from '../audit/index.js';
import { baseQuery, liveItems } from './queries.js';
import { verifyQuoteMath, needsOverrideApproval, type PriceCheck, type VerifyItemInput } from './service.js';
import { LOCKED_KEYS, itemSig, itemRow, jobWithItems, type ItemInput } from './job-body.js';

export async function jobEditRoutes(app: FastifyInstance) {
  // Full edit — any signed-in account (the session is the attribution; it
  // replaced the per-edit account password, ADR 0004). Sending `items`
  // replaces the lines: the old ones are soft-deleted (kept for history,
  // ADR 0005) and the new set inserted.
  app.put('/api/jobs/:id', {
    schema: { body: { type: 'object', additionalProperties: true } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, unknown>;
    return withTx(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (!job || job.deletedAt) return reply.code(404).send({ error: 'Job not found' });
      const before = await jobWithItems(id, tx);

      // Invoiced → the money fields are locked (ADR 0007). Re-sending them
      // unchanged is fine (the edit form sends everything); a real change is 409.
      const invoice = await liveInvoiceForJob(id, tx);
      if (invoice) {
        const inputs = ['finalPriceCents', 'taxable', 'discountPct', 'customerId', 'materialId', 'widthIn', 'heightIn',
          'quantity', 'mainColorMult'] as const;
        const changed: string[] = inputs.filter((k) => k in b && (b[k] ?? null) !== ((job as Record<string, unknown>)[k] ?? null));
        if (Array.isArray(b.items) && itemSig(b.items as Record<string, unknown>[]) !== itemSig(before!.items as unknown as Record<string, unknown>[])) {
          changed.push('items');
        }
        if (changed.length) {
          const num = String(invoice.number).padStart(6, '0');
          return reply.code(409).send({ error: `This order is invoiced (#${num}) — price, tax, discount, customer and lines are locked. Void the invoice or take a return instead.`,
            invoiceNumber: num, fields: changed });
        }
        for (const k of [...LOCKED_KEYS, 'items']) delete b[k];
      }

      const patch: Record<string, unknown> = {};
      const allowed = ['title', 'type', 'dueDate', 'quantity', 'widthIn', 'heightIn',
        'mainColorMult', 'rollWidthIn', 'tags', 'fileRef', 'notes', 'finalPriceCents', 'suggestedPriceCents',
        'taxable', 'discountPct', 'totalCents', 'useProofFlow', 'customerId'] as const;
      for (const k of allowed) if (k in b) patch[k] = b[k];
      if ('materialId' in b && typeof b.materialId === 'number') {
        const [m] = await tx.select().from(materials).where(eq(materials.id, b.materialId));
        if (!m) return reply.code(400).send({ error: 'Unknown material' });
        patch.materialId = m.id;
        patch.materialCostSnapshotCents = m.costPerUnitCents; // re-snapshot on material change
      }
      // Re-verify the quote math when any money-relevant field changes. Server
      // values win; a mismatch is reported back, never blocks the edit.
      const moneyKeys = ['finalPriceCents', 'taxable', 'discountPct', 'totalCents', 'items',
        'materialId', 'widthIn', 'heightIn', 'quantity', 'mainColorMult'] as const;
      let priceCheck: PriceCheck | null = null;
      if (moneyKeys.some((k) => k in b)) {
        const merged = { ...job, ...patch } as typeof job;
        const itemsForVerify = (Array.isArray(b.items)
          ? (b.items as VerifyItemInput[])
          : await liveItems(id, tx));
        const verify = await verifyQuoteMath({
          materialId: merged.materialId, widthIn: merged.widthIn, heightIn: merged.heightIn,
          quantity: merged.quantity, mainColorMult: merged.mainColorMult,
          items: itemsForVerify.map((it) => ({
            materialId: it.materialId, widthIn: it.widthIn, heightIn: it.heightIn,
            qty: it.qty || 1, colorMult: it.colorMult,
          })),
          finalPriceCents: merged.finalPriceCents ?? 0, taxable: !!merged.taxable, discountPct: merged.discountPct,
          clientSuggestedCents: typeof b.suggestedPriceCents === 'number' ? b.suggestedPriceCents : null,
          clientTotalCents: typeof b.totalCents === 'number' ? b.totalCents : null,
        }, tx);
        if (verify.suggestedCents != null) patch.suggestedPriceCents = verify.suggestedCents;
        // Any money-relevant edit refreshes the stored after-tax total, so the
        // Orders board / balances never show a total computed from a stale price.
        patch.totalCents = verify.totalCents;
        patch.taxRatePct = verify.taxRatePct;
        priceCheck = verify.priceCheck;
        if (!priceCheck.verified) {
          req.log.warn({ jobId: id, priceCheck }, 'quote math mismatch on edit — stored server-computed values');
        }
      }
      // Price override created or changed by this edit → manager approval.
      let overrideApprovalId: number | null = null;
      const next = { ...job, ...patch } as typeof job;
      if (needsOverrideApproval({ suggested: job.suggestedPriceCents, final: job.finalPriceCents },
        { suggested: next.suggestedPriceCents, final: next.finalPriceCents })) {
        const approver = await requireApproval(req, reply, { action: 'price.override', entity: 'job', entityId: id,
          details: { suggestedPriceCents: next.suggestedPriceCents, finalPriceCents: next.finalPriceCents,
            previousFinalPriceCents: job.finalPriceCents } });
        if (!approver) return reply;
        overrideApprovalId = approver.approvalId;
      }

      if (Object.keys(patch).length) await tx.update(jobs).set(patch).where(eq(jobs.id, id));
      if (Array.isArray(b.items)) {
        await tx.update(jobItems).set({ deletedAt: new Date().toISOString() })
          .where(and(eq(jobItems.jobId, id), isNull(jobItems.deletedAt)));
        const items = b.items as ItemInput[];
        if (items.length) await tx.insert(jobItems).values(items.map((it) => itemRow(id, it)));
      }
      const after = (await jobWithItems(id, tx))!;
      await audit(tx, req, { action: 'job.update', entity: 'job', entityId: id, before, after, approvalId: overrideApprovalId });
      return { ...after, ...(priceCheck ? { priceCheck } : {}) };
    });
  });

  // Soft delete ("Remove") — manager approval (ADR 0004). Payments stay.
  app.delete('/api/jobs/:id', {
    schema: { body: { type: ['object', 'null'], additionalProperties: false,
      properties: { approval: approvalSchema } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (!job || job.deletedAt) return reply.code(404).send({ error: 'Job not found' });
      // Removable only while no money has been taken. Once a live (non-voided)
      // payment exists, the order is corrected by voiding/refunding — never deleted.
      if ((await livePaymentCount(id, tx)) > 0) return reply.code(409).send({ error: 'This order has payments — void or refund them first, then remove.' });
      if (await liveInvoiceForJob(id, tx)) return reply.code(409).send({ error: 'This order is invoiced — void the invoice instead.' });
      const approver = await requireApproval(req, reply, { action: 'job.delete', entity: 'job', entityId: id,
        details: { po: job.po, title: job.title } });
      if (!approver) return reply;
      const deletedAt = new Date().toISOString();
      await tx.update(jobs).set({ deletedAt }).where(eq(jobs.id, id));
      await audit(tx, req, { action: 'job.archive', entity: 'job', entityId: id,
        before: job, after: { ...job, deletedAt }, approvalId: approver.approvalId });
      return { ok: true };
    });
  });

  // Restore a removed order — same permission as removing it.
  app.post('/api/jobs/:id/unarchive', {
    schema: { body: { type: ['object', 'null'], additionalProperties: false,
      properties: { approval: approvalSchema } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      if (job.deletedAt) {
        const approver = await requireApproval(req, reply, { action: 'job.unarchive', entity: 'job', entityId: id,
          details: { po: job.po, title: job.title } });
        if (!approver) return reply;
        await tx.update(jobs).set({ deletedAt: null }).where(eq(jobs.id, id));
        await audit(tx, req, { action: 'job.unarchive', entity: 'job', entityId: id,
          before: job, after: { ...job, deletedAt: null }, approvalId: approver.approvalId });
      }
      const [row] = await baseQuery(tx).where(eq(jobs.id, id)).limit(1);
      return row;
    });
  });

  // Design files: no uploads (removed per ROADMAP §C — the shop saves files to
  // the NAS by SignLab-filename convention). `fileRef` on jobs/items is a plain
  // text reference (NAS path or filename), editable via the normal job edit.
}
