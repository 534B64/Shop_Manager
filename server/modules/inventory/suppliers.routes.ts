import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { suppliers } from '../../db/schema/index.js';
import { requireRole } from '../auth/index.js';
import { audit } from '../audit/index.js';

// ---- Suppliers (inventory management pass, 2026-07-07) ----
// The source of truth that replaces free-text vendor strings. leadTimeDays
// feeds the AUTO reorder-point suggestion (avg daily use × lead time + buffer).
// Create/edit is manager+ (same as categories); archive is admin-only
// (ADR 0004/0005). Archiving hides the supplier from lists and pickers; items,
// categories and receipts that point at it keep the reference and the name.

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Error && /unique/i.test(e.message);

export async function supplierRoutes(app: FastifyInstance) {
  // ?all=1 includes deactivated suppliers (admin view); ?includeArchived=1
  // also includes archived ones (ADR 0005).
  app.get('/api/suppliers', async (req) => {
    const { all, includeArchived } = req.query as { all?: string; includeArchived?: string };
    const rows = await db.select().from(suppliers);
    return rows.filter((s) => (all === '1' || s.active) && (includeArchived === '1' || !s.archivedAt))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  app.post('/api/suppliers', {
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        leadTimeDays: { type: 'integer', minimum: 0, maximum: 365 },
        contact: { type: 'string', maxLength: 200 },
        notes: { type: 'string', maxLength: 500 },
      } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const b = req.body as { name: string; leadTimeDays?: number; contact?: string; notes?: string };
    try {
      return await withTx(async (tx) => {
        const [row] = await tx.insert(suppliers).values({
          name: b.name.trim(), leadTimeDays: b.leadTimeDays ?? 7,
          contact: b.contact ?? null, notes: b.notes ?? null,
        }).returning();
        await audit(tx, req, { action: 'supplier.create', entity: 'supplier', entityId: row.id, after: row });
        reply.code(201);
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(409).send({ error: 'A supplier with that name already exists' });
      throw e;
    }
  });

  app.put('/api/suppliers/:id', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        leadTimeDays: { type: 'integer', minimum: 0, maximum: 365 },
        contact: { type: ['string', 'null'], maxLength: 200 },
        notes: { type: ['string', 'null'], maxLength: 500 },
        active: { type: 'boolean' },
      } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const id = Number((req.params as { id: string }).id);
    try {
      return await withTx(async (tx) => {
        const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, id));
        if (!before) return reply.code(404).send({ error: 'Supplier not found' });
        const [row] = await tx.update(suppliers).set(req.body as object).where(eq(suppliers.id, id)).returning();
        await audit(tx, req, { action: 'supplier.update', entity: 'supplier', entityId: id, before, after: row });
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(409).send({ error: 'A supplier with that name already exists' });
      throw e;
    }
  });

  // "Delete" = archive (ADR 0005), admin only. Receiving history, items and
  // category defaults keep pointing at it.
  app.delete('/api/suppliers/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, id));
      if (!before) return reply.code(404).send({ error: 'Supplier not found' });
      if (before.archivedAt) return { ok: true };
      const [row] = await tx.update(suppliers).set({ archivedAt: new Date().toISOString(), archivedBy: req.user!.id })
        .where(eq(suppliers.id, id)).returning();
      await audit(tx, req, { action: 'supplier.archive', entity: 'supplier', entityId: id, before, after: row });
      return { ok: true };
    });
  });

  app.post('/api/suppliers/:id/unarchive', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, id));
      if (!before) return reply.code(404).send({ error: 'Supplier not found' });
      if (!before.archivedAt) return before;
      const [row] = await tx.update(suppliers).set({ archivedAt: null, archivedBy: null })
        .where(eq(suppliers.id, id)).returning();
      await audit(tx, req, { action: 'supplier.unarchive', entity: 'supplier', entityId: id, before, after: row });
      return row;
    });
  });
}
