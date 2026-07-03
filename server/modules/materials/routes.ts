import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { materials, jobs, jobItems, materialColors } from '../../db/schema/index.js';
import { PRICE_MODES } from '../../../shared/domain.js';

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
  // ?all=1 includes deactivated materials (admin view)
  app.get('/api/materials', async (req) => {
    const all = (req.query as { all?: string }).all === '1';
    const rows = await db.select().from(materials);
    return all ? rows : rows.filter((m) => m.active);
  });

  app.post('/api/materials', { schema: { body: materialBody } }, async (req, reply) => {
    const body = req.body as { name: string; unit: string; costPerUnitCents: number };
    const [row] = await db.insert(materials).values(body).returning();
    reply.code(201);
    return row;
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
    const id = Number((req.params as { id: string }).id);
    const [row] = await db.update(materials).set(req.body as object).where(eq(materials.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Material not found' });
    return row;
  });

  // Hard delete — only allowed for a material never used on a job (or its line items),
  // so historical quotes never lose the material they reference. Referenced materials
  // must be deactivated instead (kept on the books, hidden from new quotes).
  app.delete('/api/materials/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [jobRef] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.materialId, id)).limit(1);
    const [itemRef] = await db.select({ id: jobItems.id }).from(jobItems).where(eq(jobItems.materialId, id)).limit(1);
    if (jobRef || itemRef) {
      return reply.code(409).send({ error: 'This material is used by existing jobs — deactivate it instead of removing.' });
    }
    const [row] = await db.delete(materials).where(eq(materials.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Material not found' });
    return { ok: true };
  });

  // ---- Material colors (Phase 8) ----
  // A color is a material *variant* (Red 651 vs Blue 651). It selects which roll
  // inventory to stock-check and never changes price. Page-level AdminGate guards
  // the UI, matching the other materials endpoints (no API password here).
  app.get('/api/materials/:id/colors', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return db.select().from(materialColors).where(eq(materialColors.materialId, id)).orderBy(materialColors.name);
  });

  app.post('/api/materials/:id/colors', {
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false,
      properties: { name: { type: 'string', minLength: 1, maxLength: 60 } } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { name } = req.body as { name: string };
    const [material] = await db.select().from(materials).where(eq(materials.id, id));
    if (!material) return reply.code(404).send({ error: 'Material not found' });
    // No duplicate colors on the same material (case-insensitive).
    const existing = await db.select().from(materialColors).where(eq(materialColors.materialId, id));
    if (existing.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) {
      return reply.code(409).send({ error: 'That color already exists for this material' });
    }
    const [row] = await db.insert(materialColors).values({ materialId: id, name: name.trim() }).returning();
    reply.code(201);
    return row;
  });

  app.delete('/api/materials/:id/colors/:colorId', async (req, reply) => {
    const colorId = Number((req.params as { colorId: string }).colorId);
    const [row] = await db.delete(materialColors).where(eq(materialColors.id, colorId)).returning();
    if (!row) return reply.code(404).send({ error: 'Color not found' });
    return { ok: true };
  });
}
