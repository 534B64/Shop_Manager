import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { settings } from '../../db/schema/index.js';
import { DEFAULT_UNIT_TYPES } from '../../../shared/domain.js';
import { taxRatePct } from './service.js';

async function getJson<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (!row) return fallback;
  try { return { ...fallback, ...JSON.parse(row.value) }; } catch { return fallback; }
}
async function setJson(key: string, value: unknown) {
  const v = JSON.stringify(value);
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (row) await db.update(settings).set({ value: v }).where(eq(settings.key, key));
  else await db.insert(settings).values({ key, value: v });
}

export const DEFAULT_LEVEL_DISCOUNTS = { 1: 5, 2: 10, 3: 15 } as Record<string, number>;

export async function settingsRoutes(app: FastifyInstance) {
  // Sales tax — default 8.25%, totals default to tax ON.
  app.get('/api/settings/tax', async () => ({ ratePct: await taxRatePct() }));
  app.put('/api/settings/tax', {
    schema: { body: { type: 'object', required: ['ratePct'], additionalProperties: false,
      properties: { ratePct: { type: 'number', minimum: 0, maximum: 30 } } } },
  }, async (req) => {
    const { ratePct } = req.body as { ratePct: number };
    const [row] = await db.select().from(settings).where(eq(settings.key, 'taxRatePct'));
    if (row) await db.update(settings).set({ value: String(ratePct) }).where(eq(settings.key, 'taxRatePct'));
    else await db.insert(settings).values({ key: 'taxRatePct', value: String(ratePct) });
    return { ratePct };
  });

  // /api/settings/pricing (complexity max + step) was removed 2026-07-02 along
  // with the complexity surcharge itself. Any stale `pricingSettings` row in
  // the DB is simply ignored.

  // Unit types (Phase 10) — admin-managed list replacing the old MATERIAL_UNITS
  // enum. materials.ts now validates `unit` as a free string; this list just
  // drives the dropdowns (Materials, Inventory Settings, Inventory item form).
  app.get('/api/settings/units', async () => getJson('unitTypes', { units: [...DEFAULT_UNIT_TYPES] }));
  app.put('/api/settings/units', {
    schema: { body: { type: 'object', required: ['units'], additionalProperties: false,
      properties: {
        units: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 24 } },
      } } },
  }, async (req) => {
    const { units } = req.body as { units: string[] };
    // Dedupe (case-sensitive exact match — "sqft" and "Sqft" are kept distinct
    // on purpose; the admin can merge by editing the chip text directly).
    const deduped = [...new Set(units.map((u) => u.trim()).filter(Boolean))];
    await setJson('unitTypes', { units: deduped });
    return { units: deduped };
  });

  // Discount % per customer level (1–3). Level 0 never sees discounts.
  app.get('/api/settings/levels', async () => getJson('levelDiscounts', DEFAULT_LEVEL_DISCOUNTS));
  app.put('/api/settings/levels', {
    schema: { body: { type: 'object', additionalProperties: false,
      properties: {
        '1': { type: 'number', minimum: 0, maximum: 100 },
        '2': { type: 'number', minimum: 0, maximum: 100 },
        '3': { type: 'number', minimum: 0, maximum: 100 },
      } } },
  }, async (req) => {
    const next = { ...(await getJson('levelDiscounts', DEFAULT_LEVEL_DISCOUNTS)), ...(req.body as object) };
    await setJson('levelDiscounts', next);
    return next;
  });
}
