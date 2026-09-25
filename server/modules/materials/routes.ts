import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { materials, materialColors } from '../../db/schema/index.js';
import { PRICE_MODES } from '../../../shared/domain.js';
import { requireRole } from '../auth/index.js';
import { audit } from '../audit/index.js';

const materialBody = {
  type: 'object',
  required: ['name', 'unit', 'costPerUnitCents'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    // Phase 10: units are admin-managed (settings-backed list), not a fixed
    // enum — validate by length only. See /api/settings/units.
    unit: { type: 'string', minLength: 1, maxLength: 24 },
    costPerUnitCents: { type: 'integer', minimum: 0 },
    priceMode: { type: 'string', enum: [...PRICE_MODES] },
    rateCents: { type: 'integer', minimum: 0 },
    rate2Cents: { type: 'integer', minimum: 0 },
    minQty: { type: 'integer', minimum: 1 },
    colorMultiplier: { type: 'boolean' },
    usesRoll: { type: 'boolean' },
    isAddon: { type: 'boolean' },
  },
} as const;

export async function materialRoutes(app: FastifyInstance) {
  // ?all=1 includes deactivated materials (admin view); ?includeArchived=1
  // also includes archived ones (ADR 0005). Pickers use the default.
  app.get('/api/materials', async (req) => {
    const { all, includeArchived } = req.query as { all?: string; includeArchived?: string };
    const rows = await db.select().from(materials);
    return rows.filter((m) => (all === '1' || m.active) && (includeArchived === '1' || !m.archivedAt));
  });

  app.post('/api/materials', { schema: { body: materialBody } }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const body = req.body as { name: string; unit: string; costPerUnitCents: number };
    return withTx(async (tx) => {
      const [row] = await tx.insert(materials).values(body).returning();
      await audit(tx, req, { action: 'material.create', entity: 'material', entityId: row.id, after: row });
      reply.code(201);
      return row;
    });
  });

  app.put('/api/materials/:id', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          unit: { type: 'string', minLength: 1, maxLength: 24 },
          costPerUnitCents: { type: 'integer', minimum: 0 },
          priceMode: { type: 'string', enum: [...PRICE_MODES] },
          rateCents: { type: 'integer', minimum: 0 },
          rate2Cents: { type: ['integer', 'null'] },
          minQty: { type: 'integer', minimum: 1 },
          colorMultiplier: { type: 'boolean' },
          usesRoll: { type: 'boolean' },
          isAddon: { type: 'boolean' },
          active: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(materials).where(eq(materials.id, id));
      if (!before) return reply.code(404).send({ error: 'Material not found' });
      const [row] = await tx.update(materials).set(req.body as object).where(eq(materials.id, id)).returning();
      await audit(tx, req, { action: 'material.update', entity: 'material', entityId: id, before, after: row });
      return row;
    });
  });

  // "Delete" = archive (ADR 0005), admin only. Hidden from the price book and
  // new quotes; jobs that used it keep showing it (they join by id).
  app.delete('/api/materials/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(materials).where(eq(materials.id, id));
      if (!before) return reply.code(404).send({ error: 'Material not found' });
      if (before.archivedAt) return { ok: true };
      const [row] = await tx.update(materials).set({ archivedAt: new Date().toISOString(), archivedBy: req.user!.id })
        .where(eq(materials.id, id)).returning();
      await audit(tx, req, { action: 'material.archive', entity: 'material', entityId: id, before, after: row });
      return { ok: true };
    });
  });

  app.post('/api/materials/:id/unarchive', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(materials).where(eq(materials.id, id));
      if (!before) return reply.code(404).send({ error: 'Material not found' });
      if (!before.archivedAt) return before;
      const [row] = await tx.update(materials).set({ archivedAt: null, archivedBy: null })
        .where(eq(materials.id, id)).returning();
      await audit(tx, req, { action: 'material.unarchive', entity: 'material', entityId: id, before, after: row });
      return row;
    });
  });

  // ---- Material colors (Phase 8) ----
  // A color is a material *variant* (Red 651 vs Blue 651). It selects which roll
  // inventory to stock-check and never changes price. Admin-only, like every
  // other materials mutation (ADR 0004). Archived colors are hidden unless
  // ?includeArchived=1; existing roll SKUs keep their color text.
  app.get('/api/materials/:id/colors', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { includeArchived } = req.query as { includeArchived?: string };
    return db.select().from(materialColors)
      .where(includeArchived === '1'
        ? eq(materialColors.materialId, id)
        : and(eq(materialColors.materialId, id), isNull(materialColors.archivedAt)))
      .orderBy(materialColors.name);
  });

  app.post('/api/materials/:id/colors', {
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false,
      properties: { name: { type: 'string', minLength: 1, maxLength: 60 } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    const { name } = req.body as { name: string };
    return withTx(async (tx) => {
      const [material] = await tx.select().from(materials).where(eq(materials.id, id));
      if (!material) return reply.code(404).send({ error: 'Material not found' });
      // No duplicate colors on the same material (case-insensitive), archived included.
      const existing = await tx.select().from(materialColors).where(eq(materialColors.materialId, id));
      const dup = existing.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
      if (dup) {
        return reply.code(409).send({ error: dup.archivedAt
          ? 'That color is archived for this material — restore it instead'
          : 'That color already exists for this material' });
      }
      const [row] = await tx.insert(materialColors).values({ materialId: id, name: name.trim() }).returning();
      await audit(tx, req, { action: 'material_color.create', entity: 'material_color', entityId: row.id, after: row });
      reply.code(201);
      return row;
    });
  });

  app.delete('/api/materials/:id/colors/:colorId', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const colorId = Number((req.params as { colorId: string }).colorId);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(materialColors).where(eq(materialColors.id, colorId));
      if (!before) return reply.code(404).send({ error: 'Color not found' });
      if (before.archivedAt) return { ok: true };
      const [row] = await tx.update(materialColors).set({ archivedAt: new Date().toISOString(), archivedBy: req.user!.id })
        .where(eq(materialColors.id, colorId)).returning();
      await audit(tx, req, { action: 'material_color.archive', entity: 'material_color', entityId: colorId, before, after: row });
      return { ok: true };
    });
  });

  app.post('/api/materials/:id/colors/:colorId/unarchive', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const colorId = Number((req.params as { colorId: string }).colorId);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(materialColors).where(eq(materialColors.id, colorId));
      if (!before) return reply.code(404).send({ error: 'Color not found' });
      if (!before.archivedAt) return before;
      const [row] = await tx.update(materialColors).set({ archivedAt: null, archivedBy: null })
        .where(eq(materialColors.id, colorId)).returning();
      await audit(tx, req, { action: 'material_color.unarchive', entity: 'material_color', entityId: colorId, before, after: row });
      return row;
    });
  });
}
