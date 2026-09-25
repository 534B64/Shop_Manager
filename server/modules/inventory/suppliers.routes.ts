import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { suppliers, inventoryItems, inventoryAdjustments, categories } from '../../db/schema/index.js';
import { requireRole } from '../auth/index.js';

// ---- Suppliers (inventory management pass, 2026-07-07) ----
// The source of truth that replaces free-text vendor strings. leadTimeDays
// feeds the AUTO reorder-point suggestion (avg daily use × lead time + buffer).
// Create/edit is manager+ (same as categories); delete is admin-only and is
// blocked while receipts reference the supplier (deactivate instead — history
// stays). ADR 0004.

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Error && /unique/i.test(e.message);

export async function supplierRoutes(app: FastifyInstance) {
  // ?all=1 includes deactivated suppliers (admin view)
  app.get('/api/suppliers', async (req) => {
    const all = (req.query as { all?: string }).all === '1';
    const rows = await db.select().from(suppliers);
    return (all ? rows : rows.filter((s) => s.active))
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
      const [row] = await db.insert(suppliers).values({
        name: b.name.trim(), leadTimeDays: b.leadTimeDays ?? 7,
        contact: b.contact ?? null, notes: b.notes ?? null,
      }).returning();
      reply.code(201);
      return row;
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
      const [row] = await db.update(suppliers).set(req.body as object).where(eq(suppliers.id, id)).returning();
      if (!row) return reply.code(404).send({ error: 'Supplier not found' });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(409).send({ error: 'A supplier with that name already exists' });
      throw e;
    }
  });

  // Hard delete, admin only — only when no receipts reference it
  // (receipt rows are money-adjacent history; never orphan them). Items and
  // categories that pointed at it just lose the reference.
  app.delete('/api/suppliers/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    const [{ n }] = await db.select({ n: sql<number>`count(*)` })
      .from(inventoryAdjustments).where(eq(inventoryAdjustments.supplierId, id));
    if (n > 0) {
      return reply.code(409).send({ error: 'This supplier has receiving history — deactivate it instead of deleting.' });
    }
    await db.update(inventoryItems).set({ supplierId: null }).where(eq(inventoryItems.supplierId, id));
    await db.update(categories).set({ defaultSupplierId: null }).where(eq(categories.defaultSupplierId, id));
    const [row] = await db.delete(suppliers).where(eq(suppliers.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Supplier not found' });
    return { ok: true };
  });
}
