import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { withTx } from '../../db/index.js';
import { jobs, customers, materials, jobItems } from '../../db/schema/index.js';
import { owedCents } from '../payments/index.js';
import { liveInvoiceForJob } from '../sales/index.js';
import { requireApproval } from '../auth/index.js';
import { audit } from '../audit/index.js';
import { baseQuery, liveItems } from './queries.js';
import { jobListRoutes } from './lists.js';
import { jobStatusRoutes } from './status.routes.js';
import { jobEditRoutes } from './edit.routes.js';
import { generatePo, verifyQuoteMath, needsOverrideApproval } from './service.js';
import { createBody, itemRow, jobWithItems, type CreateJobBody } from './job-body.js';

export async function jobRoutes(app: FastifyInstance) {
  await jobListRoutes(app); // GET /api/jobs, /api/jobs/board, /api/jobs/due-soon

  app.get('/api/jobs/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [row] = await baseQuery().where(eq(jobs.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'Job not found' });
    // The live invoice (if any) tells the edit page which fields are locked.
    const inv = await liveInvoiceForJob(id);
    return {
      ...row, items: await liveItems(id),
      invoice: inv ? { id: inv.id, number: String(inv.number).padStart(6, '0') } : null,
      owedCents: await owedCents(row),
    };
  });

  app.post('/api/jobs', { schema: { body: createBody } }, async (req, reply) => {
    const body = req.body as CreateJobBody;

    // One transaction: PO, new customer, job, lines, and audit rows commit
    // together — a failure midway leaves no half-created order (ADR 0005).
    return withTx(async (tx) => {
      // Idempotency: same clientRef → return the already-created job (retry-safe).
      const [existing] = await baseQuery(tx).where(eq(jobs.clientRef, body.clientRef)).limit(1);
      if (existing) return existing;

      // Snapshot the material cost at quote time — later cost edits never rewrite history.
      let materialCostSnapshotCents: number | null = null;
      if (body.materialId) {
        const [m] = await tx.select().from(materials).where(eq(materials.id, body.materialId));
        if (!m) return reply.code(400).send({ error: 'Unknown material' });
        materialCostSnapshotCents = m.costPerUnitCents;
      }

      // Recompute the quote math server-side; the server's answer is what gets
      // stored. Advisory — a mismatch warns, it never blocks the save.
      const verify = await verifyQuoteMath({
        materialId: body.materialId, widthIn: body.widthIn, heightIn: body.heightIn,
        quantity: body.quantity, mainColorMult: body.mainColorMult,
        items: body.items,
        finalPriceCents: body.finalPriceCents, taxable: body.taxable ?? true, discountPct: body.discountPct,
        clientSuggestedCents: body.suggestedPriceCents, clientTotalCents: body.totalCents,
      }, tx);
      if (!verify.priceCheck.verified) {
        req.log.warn({ clientRef: body.clientRef, priceCheck: verify.priceCheck }, 'quote math mismatch — stored server-computed values');
      }
      // Price override: final ≠ the estimator's suggestion → manager approval.
      // Checked before anything is written, so a 403 leaves nothing behind.
      const suggestedPriceCents = verify.suggestedCents ?? body.suggestedPriceCents ?? null;
      let overrideApprovalId: number | null = null;
      if (needsOverrideApproval(null, { suggested: suggestedPriceCents, final: body.finalPriceCents })) {
        const approver = await requireApproval(req, reply, { action: 'price.override', entity: 'job', entityId: body.clientRef,
          details: { title: body.title, suggestedPriceCents, finalPriceCents: body.finalPriceCents } });
        if (!approver) return reply;
        overrideApprovalId = approver.approvalId;
      }

      const po = await generatePo(tx);

      let customerId = body.customerId ?? null;
      if (!customerId && body.newCustomer) {
        const [c] = await tx.insert(customers).values(body.newCustomer).returning();
        await audit(tx, req, { action: 'customer.create', entity: 'customer', entityId: c.id, after: c });
        customerId = c.id;
      }

      const [row] = await tx
        .insert(jobs)
        .values({
          clientRef: body.clientRef,
          po,
          customerId,
          type: body.type,
          tags: body.tags ?? null,
          fileRef: body.fileRef ?? null,
          createdBy: req.user!.name, // attribution is the session, never the body
          taxable: body.taxable ?? true,
          discountPct: body.discountPct ?? null,
          // Server-computed total (only when the client derived one — callers
          // that never send totalCents keep the old finalPrice-as-balance path).
          totalCents: body.totalCents != null ? verify.totalCents : null,
          taxRatePct: body.totalCents != null ? verify.taxRatePct : null,
          title: body.title,
          status: body.status,
          useProofFlow: body.useProofFlow ?? false,
          dueDate: body.dueDate ?? null,
          quantity: body.quantity ?? 1,
          widthIn: body.widthIn ?? null,
          heightIn: body.heightIn ?? null,
          mainColorMult: body.mainColorMult ?? 1,
          rollWidthIn: body.rollWidthIn ?? null,
          materialId: body.materialId ?? null,
          materialCostSnapshotCents,
          suggestedPriceCents,
          finalPriceCents: body.finalPriceCents,
          notes: body.notes ?? null,
        })
        .returning();

      if (body.items?.length) {
        await tx.insert(jobItems).values(body.items.map((it) => itemRow(row.id, it)));
      }
      const created = (await jobWithItems(row.id, tx))!;
      await audit(tx, req, { action: 'job.create', entity: 'job', entityId: row.id, after: created, approvalId: overrideApprovalId });
      reply.code(201);
      return { ...created, priceCheck: verify.priceCheck };
    });
  });

  await jobStatusRoutes(app); // PUT /api/jobs/:id/status, POST /api/jobs/:id/convert
  await jobEditRoutes(app);   // PUT/DELETE /api/jobs/:id, POST /api/jobs/:id/unarchive
}
