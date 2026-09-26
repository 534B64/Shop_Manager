import type { FastifyInstance } from 'fastify';
import { eq, isNull, and } from 'drizzle-orm';
import { withTx, type Db } from '../../db/index.js';
import { jobs, customers, materials, jobItems } from '../../db/schema/index.js';
import { owedCents, livePaymentCount, openDrawer } from '../payments/index.js';
import { invoiceJob, liveInvoiceForJob } from '../sales/index.js';
import { requireApproval, approvalSchema } from '../auth/index.js';
import { audit } from '../audit/index.js';
import { JOB_TYPES, type JobStatus } from '../../../shared/domain.js';
import { canTransition } from '../../../shared/statusFlow.js';
import { baseQuery, liveItems } from './queries.js';
import { jobListRoutes } from './lists.js';
import {
  generatePo, verifyQuoteMath, needsOverrideApproval, type PriceCheck, type VerifyItemInput,
} from './service.js';

/** Fields an invoice snapshots: once a job is invoiced they can't change
 *  (void or return instead — ADR 0007). */
const LOCKED_KEYS = ['finalPriceCents', 'suggestedPriceCents', 'taxable', 'discountPct', 'totalCents', 'customerId',
  'materialId', 'widthIn', 'heightIn', 'quantity', 'mainColorMult'] as const;
const ITEM_KEYS = ['type', 'title', 'qty', 'priceCents', 'materialId', 'widthIn', 'heightIn', 'colorMult'] as const;
const itemSig = (items: Record<string, unknown>[]) =>
  JSON.stringify(items.map((it) => ITEM_KEYS.map((k) => it[k] ?? (k === 'colorMult' ? 1 : null))));

const createBody = {
  type: 'object',
  required: ['clientRef', 'type', 'title', 'status', 'finalPriceCents'],
  additionalProperties: false,
  properties: {
    clientRef: { type: 'string', minLength: 8, maxLength: 64 },
    customerId: { type: 'integer' },
    newCustomer: {
      type: 'object',
      // Email is required for every new customer entered by a person
      // (2026-07-02). The generic Walk-in record is created via
      // POST /api/customers, which carries the exemption.
      required: ['name', 'email'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        phone: { type: 'string', maxLength: 40 },
        email: { type: 'string', minLength: 3, maxLength: 120, pattern: '^\\S+@\\S+\\.\\S+$' },
      },
    },
    type: { type: 'string', enum: [...JOB_TYPES] },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    status: { type: 'string', enum: ['quote', 'acknowledged'] },
    useProofFlow: { type: 'boolean' },
    dueDate: { type: 'string', maxLength: 10 },
    quantity: { type: 'integer', minimum: 1 },
    widthIn: { type: 'number', exclusiveMinimum: 0 },
    heightIn: { type: 'number', exclusiveMinimum: 0 },
    mainColorMult: { type: 'integer', minimum: 1, maximum: 3 },
    rollWidthIn: { type: 'number', exclusiveMinimum: 0 },
    tags: { type: 'string', maxLength: 300 },
    fileRef: { type: 'string', maxLength: 400 },
    taxable: { type: 'boolean' },
    discountPct: { type: 'number', minimum: 0, maximum: 100 },
    totalCents: { type: 'integer', minimum: 0 },
    items: { type: 'array', maxItems: 30, items: { type: 'object',
      required: ['type', 'title', 'qty', 'priceCents'], additionalProperties: false,
      properties: {
        type: { type: 'string', enum: [...JOB_TYPES] },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        materialId: { type: 'integer' },
        widthIn: { type: 'number', exclusiveMinimum: 0 },
        heightIn: { type: 'number', exclusiveMinimum: 0 },
        rollWidthIn: { type: 'number', exclusiveMinimum: 0 },
        colorMult: { type: 'integer', minimum: 1, maximum: 3 },
        qty: { type: 'integer', minimum: 1 },
        priceCents: { type: 'integer', minimum: 0 },
      } } },
    materialId: { type: 'integer' },
    suggestedPriceCents: { type: 'integer', minimum: 0 },
    finalPriceCents: { type: 'integer', minimum: 0 },
    notes: { type: 'string', maxLength: 2000 },
    approval: approvalSchema, // price override (ADR 0007)
  },
} as const;

interface CreateJobBody {
  clientRef: string;
  customerId?: number;
  newCustomer?: { name: string; phone?: string; email: string };
  type: string;
  title: string;
  status: 'quote' | 'acknowledged';
  useProofFlow?: boolean;
  dueDate?: string;
  quantity?: number;
  widthIn?: number;
  heightIn?: number;
  mainColorMult?: number;
  rollWidthIn?: number;
  tags?: string;
  fileRef?: string;
  taxable?: boolean;
  discountPct?: number;
  totalCents?: number;
  items?: { type: string; title: string; materialId?: number; widthIn?: number; heightIn?: number; rollWidthIn?: number; colorMult?: number; qty: number; priceCents: number }[];
  materialId?: number;
  suggestedPriceCents?: number;
  finalPriceCents: number;
  notes?: string;
}

type ItemInput = NonNullable<CreateJobBody['items']>[number];

const itemRow = (jobId: number, it: ItemInput) => ({
  jobId, type: it.type, title: it.title, qty: it.qty, priceCents: it.priceCents,
  materialId: it.materialId ?? null, widthIn: it.widthIn ?? null, heightIn: it.heightIn ?? null,
  rollWidthIn: it.rollWidthIn ?? null, colorMult: it.colorMult ?? 1,
});

/** The job as every endpoint returns it (read-model + live lines). */
async function jobWithItems(id: number, dbx: Db) {
  const [row] = await baseQuery(dbx).where(eq(jobs.id, id)).limit(1);
  return row ? { ...row, items: await liveItems(id, dbx) } : null;
}

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

  // Move a job along its lifecycle (one step forward or back).
  app.put('/api/jobs/:id/status', {
    schema: { body: { type: 'object', required: ['status'], additionalProperties: false,
      properties: {
        status: { type: 'string' },
        // Unpaid pickup: the client first gets a 402 with the balance, confirms,
        // then retries with override:true (+ approval when a cashier asks).
        override: { type: 'boolean' },
        approval: approvalSchema,
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const to = (req.body as { status: string }).status as JobStatus;
    return withTx(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      if (!canTransition(job.status as JobStatus, to, job.useProofFlow)) {
        return reply.code(409).send({ error: `Cannot move from '${job.status}' to '${to}'` });
      }
      const patch: Record<string, unknown> = { status: to };
      let approvalId: number | null = null;
      // No pickup without payment — unless a manager approves the override.
      if (to === 'picked_up') {
        const owed = await owedCents(job, tx);
        if (owed > 0) {
          const { override } = req.body as { override?: boolean };
          if (!override) {
            return reply.code(402).send({ error: `Balance due: ${(owed / 100).toFixed(2)}. Manager override required.`, owedCents: owed });
          }
          const approver = await requireApproval(req, reply, { action: 'job.pickup_unpaid', entity: 'job', entityId: id,
            details: { owedCents: owed } });
          if (!approver) return reply;
          approvalId = approver.approvalId;
          // Attributable line — appended to the job's notes so it's visible
          // wherever the job is, and survives in the same backup as the books.
          // The approvals row is the authoritative record.
          const who = approver.id === req.user!.id ? approver.name : `${approver.name} (for ${req.user!.name})`;
          const line = `[${new Date().toISOString().slice(0, 10)}] Picked up with ${(owed / 100).toFixed(2)} balance due — manager override by ${who}.`;
          patch.notes = job.notes ? `${job.notes}\n${line}` : line;
          req.log.warn({ jobId: id, owedCents: owed, approvedBy: approver.name }, 'pickup-with-balance-due manager override');
        }
      }
      await tx.update(jobs).set(patch).where(eq(jobs.id, id));
      await audit(tx, req, { action: 'job.status', entity: 'job', entityId: id,
        before: { status: job.status }, after: patch, approvalId });
      // Picked up = sold: issue the invoice now if paying in full hasn't already.
      // A $0 job (warranty redo, freebie) takes no invoice number.
      if (to === 'picked_up' && (job.totalCents ?? job.finalPriceCents ?? 0) > 0) {
        const drawer = await openDrawer(tx);
        await invoiceJob(tx, req, id, drawer?.id ?? null);
      }
      const [row] = await baseQuery(tx).where(eq(jobs.id, id)).limit(1);
      return row;
    });
  });

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

  // Quote → Order. Phase 2 owns the full status board; this is the Phase 1 hand-off.
  app.post('/api/jobs/:id/convert', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      if (job.status !== 'quote') {
        return reply.code(409).send({ error: `Cannot convert a job in status '${job.status}'` });
      }
      // Proof-flow jobs go to 'approved' (design comes next); simple jobs go straight to 'order'.
      const next = job.useProofFlow ? 'approved' : 'acknowledged';
      await tx.update(jobs).set({ status: next }).where(eq(jobs.id, id));
      await audit(tx, req, { action: 'job.convert', entity: 'job', entityId: id,
        before: { status: job.status }, after: { status: next } });
      const [row] = await baseQuery(tx).where(eq(jobs.id, id)).limit(1);
      return row;
    });
  });
}
