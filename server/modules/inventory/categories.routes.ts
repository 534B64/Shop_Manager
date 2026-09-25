import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { categories, categorySizes, categoryFields, inventoryItems } from '../../db/schema/index.js';
import { requireRole } from '../auth/index.js';

// ---- Smart categories (Phase 10, Slice 2) ----
// ORTHOGONAL to the roll-SKU/estimator path: categories are a new
// organizational layer on top of every inventory item. They never touch
// material_colors, nominalWidthIn, or the stock-check, and the estimator does
// not read them. Create/edit is manager+, delete is admin-only (ADR 0004).
const categoryBody = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    default_unit: { type: 'string', maxLength: 24 },
    tracks_color: { type: 'boolean' },
    default_vendor: { type: 'string', maxLength: 120 },
  },
} as const;

export async function categoryRoutes(app: FastifyInstance) {
  // ?all=1 includes deactivated categories (admin view)
  app.get('/api/categories', async (req) => {
    const all = (req.query as { all?: string }).all === '1';
    const rows = await db.select().from(categories);
    const filtered = all ? rows : rows.filter((c) => c.active);
    return filtered.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  });

  app.post('/api/categories', { schema: { body: categoryBody } }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const b = req.body as { name: string; default_unit?: string; tracks_color?: boolean; default_vendor?: string };
    const [row] = await db.insert(categories).values({
      name: b.name.trim(),
      defaultUnit: b.default_unit ?? null,
      tracksColor: b.tracks_color ?? false,
      defaultVendor: b.default_vendor ?? null,
    }).returning();
    reply.code(201);
    return row;
  });

  app.put('/api/categories/:id', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        defaultUnit: { type: ['string', 'null'], maxLength: 24 },
        tracksColor: { type: 'boolean' },
        defaultVendor: { type: ['string', 'null'], maxLength: 120 }, // legacy — UI writes defaultSupplierId now
        defaultSupplierId: { type: ['integer', 'null'] },
        active: { type: 'boolean' },
      } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const id = Number((req.params as { id: string }).id);
    const [row] = await db.update(categories).set(req.body as object).where(eq(categories.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Category not found' });
    return row;
  });

  // Hard delete, admin only. Referencing inventory items are kept — their
  // categoryId is cleared (they fall back to "Other / Consumables"). The category's
  // size list and custom-field defs are removed with it.
  app.delete('/api/categories/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    await db.update(inventoryItems).set({ categoryId: null }).where(eq(inventoryItems.categoryId, id));
    await db.delete(categorySizes).where(eq(categorySizes.categoryId, id));
    await db.delete(categoryFields).where(eq(categoryFields.categoryId, id));
    const [row] = await db.delete(categories).where(eq(categories.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Category not found' });
    return { ok: true };
  });

  // ---- Category sizes ----
  // An admin-managed size list per category (e.g. S/M/L/XL for apparel blanks).
  // Distinct from ROLL_SIZES / nominalWidthIn used by the roll-SKU path.
  app.get('/api/categories/:id/sizes', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return db.select().from(categorySizes).where(eq(categorySizes.categoryId, id))
      .orderBy(categorySizes.sort, categorySizes.label);
  });

  app.post('/api/categories/:id/sizes', {
    schema: { body: { type: 'object', required: ['label'], additionalProperties: false,
      properties: { label: { type: 'string', minLength: 1, maxLength: 60 } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const id = Number((req.params as { id: string }).id);
    const { label } = req.body as { label: string };
    const [category] = await db.select().from(categories).where(eq(categories.id, id));
    if (!category) return reply.code(404).send({ error: 'Category not found' });
    // No duplicate sizes on the same category (case-insensitive).
    const existing = await db.select().from(categorySizes).where(eq(categorySizes.categoryId, id));
    if (existing.some((s) => s.label.toLowerCase() === label.trim().toLowerCase())) {
      return reply.code(409).send({ error: 'That size already exists for this category' });
    }
    const [row] = await db.insert(categorySizes).values({ categoryId: id, label: label.trim() }).returning();
    reply.code(201);
    return row;
  });

  app.delete('/api/categories/:id/sizes/:sizeId', async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const sizeId = Number((req.params as { sizeId: string }).sizeId);
    const [row] = await db.delete(categorySizes).where(eq(categorySizes.id, sizeId)).returning();
    if (!row) return reply.code(404).send({ error: 'Size not found' });
    return { ok: true };
  });
}
