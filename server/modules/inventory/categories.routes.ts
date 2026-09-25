import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { categories, categorySizes } from '../../db/schema/index.js';
import { requireRole } from '../auth/index.js';
import { audit } from '../audit/index.js';

// ---- Smart categories (Phase 10, Slice 2) ----
// ORTHOGONAL to the roll-SKU/estimator path: categories are a new
// organizational layer on top of every inventory item. They never touch
// material_colors, nominalWidthIn, or the stock-check, and the estimator does
// not read them. Create/edit is manager+, archive is admin-only (ADR 0004/0005).
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
  // ?all=1 includes deactivated categories (admin view); ?includeArchived=1
  // also includes archived ones — items still pointing at an archived
  // category use it to show the name (ADR 0005).
  app.get('/api/categories', async (req) => {
    const { all, includeArchived } = req.query as { all?: string; includeArchived?: string };
    const rows = await db.select().from(categories);
    const filtered = rows.filter((c) => (all === '1' || c.active) && (includeArchived === '1' || !c.archivedAt));
    return filtered.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  });

  app.post('/api/categories', { schema: { body: categoryBody } }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const b = req.body as { name: string; default_unit?: string; tracks_color?: boolean; default_vendor?: string };
    return withTx(async (tx) => {
      const [row] = await tx.insert(categories).values({
        name: b.name.trim(),
        defaultUnit: b.default_unit ?? null,
        tracksColor: b.tracks_color ?? false,
        defaultVendor: b.default_vendor ?? null,
      }).returning();
      await audit(tx, req, { action: 'category.create', entity: 'category', entityId: row.id, after: row });
      reply.code(201);
      return row;
    });
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
    return withTx(async (tx) => {
      const [before] = await tx.select().from(categories).where(eq(categories.id, id));
      if (!before) return reply.code(404).send({ error: 'Category not found' });
      const [row] = await tx.update(categories).set(req.body as object).where(eq(categories.id, id)).returning();
      await audit(tx, req, { action: 'category.update', entity: 'category', entityId: id, before, after: row });
      return row;
    });
  });

  // "Delete" = archive (ADR 0005), admin only. Items keep their categoryId
  // (they still show the archived name); the size list and custom-field defs
  // stay with it, so a restore brings everything back.
  app.delete('/api/categories/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(categories).where(eq(categories.id, id));
      if (!before) return reply.code(404).send({ error: 'Category not found' });
      if (before.archivedAt) return { ok: true };
      const [row] = await tx.update(categories).set({ archivedAt: new Date().toISOString(), archivedBy: req.user!.id })
        .where(eq(categories.id, id)).returning();
      await audit(tx, req, { action: 'category.archive', entity: 'category', entityId: id, before, after: row });
      return { ok: true };
    });
  });

  app.post('/api/categories/:id/unarchive', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(categories).where(eq(categories.id, id));
      if (!before) return reply.code(404).send({ error: 'Category not found' });
      if (!before.archivedAt) return before;
      const [row] = await tx.update(categories).set({ archivedAt: null, archivedBy: null })
        .where(eq(categories.id, id)).returning();
      await audit(tx, req, { action: 'category.unarchive', entity: 'category', entityId: id, before, after: row });
      return row;
    });
  });

  // ---- Category sizes ----
  // An admin-managed size list per category (e.g. S/M/L/XL for apparel blanks).
  // Distinct from ROLL_SIZES / nominalWidthIn used by the roll-SKU path.
  // Archived sizes are hidden unless ?includeArchived=1 (items store the size
  // as text, so nothing loses its label).
  app.get('/api/categories/:id/sizes', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { includeArchived } = req.query as { includeArchived?: string };
    return db.select().from(categorySizes)
      .where(includeArchived === '1'
        ? eq(categorySizes.categoryId, id)
        : and(eq(categorySizes.categoryId, id), isNull(categorySizes.archivedAt)))
      .orderBy(categorySizes.sort, categorySizes.label);
  });

  app.post('/api/categories/:id/sizes', {
    schema: { body: { type: 'object', required: ['label'], additionalProperties: false,
      properties: { label: { type: 'string', minLength: 1, maxLength: 60 } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const id = Number((req.params as { id: string }).id);
    const { label } = req.body as { label: string };
    return withTx(async (tx) => {
      const [category] = await tx.select().from(categories).where(eq(categories.id, id));
      if (!category) return reply.code(404).send({ error: 'Category not found' });
      // No duplicate sizes on the same category (case-insensitive), archived included.
      const existing = await tx.select().from(categorySizes).where(eq(categorySizes.categoryId, id));
      const dup = existing.find((s) => s.label.toLowerCase() === label.trim().toLowerCase());
      if (dup) {
        return reply.code(409).send({ error: dup.archivedAt
          ? 'That size is archived for this category — restore it instead'
          : 'That size already exists for this category' });
      }
      const [row] = await tx.insert(categorySizes).values({ categoryId: id, label: label.trim() }).returning();
      await audit(tx, req, { action: 'category_size.create', entity: 'category_size', entityId: row.id, after: row });
      reply.code(201);
      return row;
    });
  });

  app.delete('/api/categories/:id/sizes/:sizeId', async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const sizeId = Number((req.params as { sizeId: string }).sizeId);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(categorySizes).where(eq(categorySizes.id, sizeId));
      if (!before) return reply.code(404).send({ error: 'Size not found' });
      if (before.archivedAt) return { ok: true };
      const [row] = await tx.update(categorySizes).set({ archivedAt: new Date().toISOString(), archivedBy: req.user!.id })
        .where(eq(categorySizes.id, sizeId)).returning();
      await audit(tx, req, { action: 'category_size.archive', entity: 'category_size', entityId: sizeId, before, after: row });
      return { ok: true };
    });
  });

  app.post('/api/categories/:id/sizes/:sizeId/unarchive', async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const sizeId = Number((req.params as { sizeId: string }).sizeId);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(categorySizes).where(eq(categorySizes.id, sizeId));
      if (!before) return reply.code(404).send({ error: 'Size not found' });
      if (!before.archivedAt) return before;
      const [row] = await tx.update(categorySizes).set({ archivedAt: null, archivedBy: null })
        .where(eq(categorySizes.id, sizeId)).returning();
      await audit(tx, req, { action: 'category_size.unarchive', entity: 'category_size', entityId: sizeId, before, after: row });
      return row;
    });
  });
}
