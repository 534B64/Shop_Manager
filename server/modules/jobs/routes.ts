import type { FastifyInstance } from 'fastify';
import { eq, desc, isNull, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { jobs, customers, materials, jobItems, settings } from '../../db/schema/index.js';
import { verifyUser } from '../../routes/users.js';
import { paidNetCents, livePaymentCount } from '../payments/index.js';
import { JOB_TYPES, type JobStatus } from '../../../shared/domain.js';
import { canTransition } from '../../../shared/statusFlow.js';
import { baseQuery } from './queries.js';
import { generatePo, verifyQuoteMath, type PriceCheck, type VerifyItemInput } from './service.js';

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
    createdBy: { type: 'string', maxLength: 60 },
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
  createdBy?: string;
  taxable?: boolean;
  discountPct?: number;
  totalCents?: number;
  items?: { type: string; title: string; materialId?: number; widthIn?: number; heightIn?: number; rollWidthIn?: number; colorMult?: number; qty: number; priceCents: number }[];
  materialId?: number;
  suggestedPriceCents?: number;
  finalPriceCents: number;
  notes?: string;
}

export async function jobRoutes(app: FastifyInstance) {
  app.get('/api/jobs', async (req) => {
    const { status, limit, q } = req.query as { status?: string; limit?: string; q?: string };
    const max = Math.min(Number(limit) || 50, 500);
    let rows = status
      ? await baseQuery().where(and(eq(jobs.status, status), isNull(jobs.deletedAt))).orderBy(desc(jobs.createdAt)).limit(max)
      : await baseQuery().where(isNull(jobs.deletedAt)).orderBy(desc(jobs.createdAt)).limit(max);
    if (q?.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((r) =>
        [r.title, r.po, r.tags, r.fileRef, r.customerName]
          .some((v) => v?.toLowerCase().includes(needle)));
    }
    return rows;
  });

  app.get('/api/jobs/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [row] = await baseQuery().where(eq(jobs.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'Job not found' });
    const items = await db.select().from(jobItems).where(eq(jobItems.jobId, id));
    return { ...row, items };
  });

  app.post('/api/jobs', { schema: { body: createBody } }, async (req, reply) => {
    const body = req.body as CreateJobBody;

    // Idempotency: same clientRef → return the already-created job (retry-safe).
    const [existing] = await baseQuery().where(eq(jobs.clientRef, body.clientRef)).limit(1);
    if (existing) return existing;

    const po = await generatePo();

    let customerId = body.customerId ?? null;
    if (!customerId && body.newCustomer) {
      const [c] = await db.insert(customers).values(body.newCustomer).returning();
      customerId = c.id;
    }

    // Snapshot the material cost at quote time — later cost edits never rewrite history.
    let materialCostSnapshotCents: number | null = null;
    if (body.materialId) {
      const [m] = await db.select().from(materials).where(eq(materials.id, body.materialId));
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
    });
    if (!verify.priceCheck.verified) {
      req.log.warn({ clientRef: body.clientRef, priceCheck: verify.priceCheck }, 'quote math mismatch — stored server-computed values');
    }

    const [row] = await db
      .insert(jobs)
      .values({
        clientRef: body.clientRef,
        po,
        customerId,
        type: body.type,
        tags: body.tags ?? null,
        fileRef: body.fileRef ?? null,
        createdBy: body.createdBy ?? null,
        taxable: body.taxable ?? true,
        discountPct: body.discountPct ?? null,
        // Server-computed total (only when the client derived one — callers
        // that never send totalCents keep the old finalPrice-as-balance path).
        totalCents: body.totalCents != null ? verify.totalCents : null,
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
        suggestedPriceCents: verify.suggestedCents ?? body.suggestedPriceCents ?? null,
        finalPriceCents: body.finalPriceCents,
        notes: body.notes ?? null,
      })
      .returning();

    if (body.items?.length) {
      await db.insert(jobItems).values(body.items.map((it) => ({
        jobId: row.id, type: it.type, title: it.title, qty: it.qty, priceCents: it.priceCents,
        materialId: it.materialId ?? null, widthIn: it.widthIn ?? null, heightIn: it.heightIn ?? null,
        rollWidthIn: it.rollWidthIn ?? null, colorMult: it.colorMult ?? 1,
      })));
    }
    const [created] = await baseQuery().where(eq(jobs.id, row.id)).limit(1);
    const items = await db.select().from(jobItems).where(eq(jobItems.jobId, row.id));
    reply.code(201);
    return { ...created, items, priceCheck: verify.priceCheck };
  });

  // Move a job along its lifecycle (one step forward or back).
  app.put('/api/jobs/:id/status', {
    schema: { body: { type: 'object', required: ['status'], additionalProperties: false,
      properties: {
        status: { type: 'string' },
        adminPassword: { type: 'string' },
        // Who used the override — the signed-in account name, so an unpaid
        // pickup is attributable to a person, not just "knew the admin password".
        overrideBy: { type: 'string', maxLength: 60 },
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const to = (req.body as { status: string }).status as JobStatus;
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    if (!canTransition(job.status as JobStatus, to, job.useProofFlow)) {
      return reply.code(409).send({ error: `Cannot move from '${job.status}' to '${to}'` });
    }
    const patch: Record<string, unknown> = { status: to };
    // No pickup without payment — unless an admin overrides.
    if (to === 'picked_up') {
      const paidNet = await paidNetCents(id);
      const owed = (job.totalCents ?? job.finalPriceCents ?? 0) - paidNet;
      if (owed > 0) {
        const { adminPassword: ap, overrideBy } = req.body as { adminPassword?: string; overrideBy?: string };
        const [pwRow] = await db.select().from(settings).where(eq(settings.key, 'adminPassword'));
        if (ap !== (pwRow?.value ?? 'admin')) {
          return reply.code(402).send({ error: `Balance due: $${(owed / 100).toFixed(2)}. Admin override required.` });
        }
        // Attributable audit line — appended to the job's notes so it's visible
        // wherever the job is, and survives in the same backup as the books.
        const who = overrideBy?.trim() || 'unknown account';
        const line = `[${new Date().toISOString().slice(0, 10)}] Picked up with $${(owed / 100).toFixed(2)} balance due — admin override by ${who}.`;
        patch.notes = job.notes ? `${job.notes}\n${line}` : line;
        req.log.warn({ jobId: id, owedCents: owed, overrideBy: who }, 'pickup-with-balance-due admin override');
      }
    }
    await db.update(jobs).set(patch).where(eq(jobs.id, id));
    const [row] = await baseQuery().where(eq(jobs.id, id)).limit(1);
    return row;
  });

  // Full edit — requires an account password. Items are replaced wholesale.
  app.put('/api/jobs/:id', {
    schema: { body: { type: 'object', required: ['editorName', 'editorPassword'], additionalProperties: true } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as Record<string, unknown> & { editorName: string; editorPassword: string };
    if (!(await verifyUser(b.editorName, b.editorPassword))) {
      return reply.code(401).send({ error: 'Wrong account password' });
    }
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!job || job.deletedAt) return reply.code(404).send({ error: 'Job not found' });

    const patch: Record<string, unknown> = {};
    const allowed = ['title', 'type', 'dueDate', 'quantity', 'widthIn', 'heightIn',
      'mainColorMult', 'rollWidthIn', 'tags', 'fileRef', 'notes', 'finalPriceCents', 'suggestedPriceCents',
      'taxable', 'discountPct', 'totalCents', 'useProofFlow', 'customerId'] as const;
    for (const k of allowed) if (k in b) patch[k] = b[k];
    if ('materialId' in b && typeof b.materialId === 'number') {
      const [m] = await db.select().from(materials).where(eq(materials.id, b.materialId));
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
        : await db.select().from(jobItems).where(eq(jobItems.jobId, id)));
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
      });
      if (verify.suggestedCents != null) patch.suggestedPriceCents = verify.suggestedCents;
      // Any money-relevant edit refreshes the stored after-tax total, so the
      // Orders board / balances never show a total computed from a stale price.
      patch.totalCents = verify.totalCents;
      priceCheck = verify.priceCheck;
      if (!priceCheck.verified) {
        req.log.warn({ jobId: id, priceCheck }, 'quote math mismatch on edit — stored server-computed values');
      }
    }

    if (Object.keys(patch).length) await db.update(jobs).set(patch).where(eq(jobs.id, id));
    if (Array.isArray(b.items)) {
      await db.delete(jobItems).where(eq(jobItems.jobId, id));
      const items = b.items as { type: string; title: string; materialId?: number; widthIn?: number; heightIn?: number; rollWidthIn?: number; colorMult?: number; qty: number; priceCents: number }[];
      if (items.length) await db.insert(jobItems).values(items.map((it) => ({
        jobId: id, type: it.type, title: it.title, qty: it.qty, priceCents: it.priceCents,
        materialId: it.materialId ?? null, widthIn: it.widthIn ?? null, heightIn: it.heightIn ?? null,
        rollWidthIn: it.rollWidthIn ?? null, colorMult: it.colorMult ?? 1,
      })));
    }
    const [row] = await baseQuery().where(eq(jobs.id, id)).limit(1);
    const items = await db.select().from(jobItems).where(eq(jobItems.jobId, id));
    return { ...row, items, ...(priceCheck ? { priceCheck } : {}) };
  });

  // Soft delete — picked-up jobs only, account password required. Payments stay.
  app.delete('/api/jobs/:id', {
    schema: { body: { type: 'object', required: ['editorName', 'editorPassword'], additionalProperties: false,
      properties: { editorName: { type: 'string' }, editorPassword: { type: 'string' } } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { editorName, editorPassword } = req.body as { editorName: string; editorPassword: string };
    if (!(await verifyUser(editorName, editorPassword))) return reply.code(401).send({ error: 'Wrong account password' });
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!job || job.deletedAt) return reply.code(404).send({ error: 'Job not found' });
    // Removable only while no money has been taken. Once a live (non-voided)
    // payment exists, the order is corrected by voiding/refunding — never deleted.
    if ((await livePaymentCount(id)) > 0) return reply.code(409).send({ error: 'This order has payments — void or refund them first, then remove.' });
    await db.update(jobs).set({ deletedAt: new Date().toISOString() }).where(eq(jobs.id, id));
    return { ok: true };
  });

  // Design files: no uploads (removed per ROADMAP §C — the shop saves files to
  // the NAS by SignLab-filename convention). `fileRef` on jobs/items is a plain
  // text reference (NAS path or filename), editable via the normal job edit.

  // Quote → Order. Phase 2 owns the full status board; this is the Phase 1 hand-off.
  app.post('/api/jobs/:id/convert', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    if (job.status !== 'quote') {
      return reply.code(409).send({ error: `Cannot convert a job in status '${job.status}'` });
    }
    // Proof-flow jobs go to 'approved' (design comes next); simple jobs go straight to 'order'.
    const next = job.useProofFlow ? 'approved' : 'acknowledged';
    await db.update(jobs).set({ status: next }).where(eq(jobs.id, id));
    const [row] = await baseQuery().where(eq(jobs.id, id)).limit(1);
    return row;
  });
}
