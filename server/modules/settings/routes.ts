import type { FastifyInstance } from 'fastify';
import { withTx, type Db } from '../../db/index.js';
import { DEFAULT_UNIT_TYPES } from '../../../shared/domain.js';
import { taxRatePct, getSetting, setSetting, DEFAULT_POS_SETTINGS } from './service.js';
import { cleanCompanyName } from '../../../shared/branding.js';
import { getCompanyName, COMPANY_KEY } from './company.js';
import { requireRole } from '../auth/index.js';
import { audit } from '../audit/index.js';

async function getJson<T>(key: string, fallback: T, dbx?: Db): Promise<T> {
  const raw = await getSetting(key, dbx);
  if (raw == null) return fallback;
  try { return { ...fallback, ...JSON.parse(raw) }; } catch { return fallback; }
}

/** Upsert a JSON setting inside a transaction, with its audit row. */
async function saveJson(req: Parameters<typeof audit>[1], key: string, fallback: object, patch: object) {
  return withTx(async (tx) => {
    const before = await getJson(key, fallback, tx);
    const next = { ...before, ...patch };
    await setSetting(key, JSON.stringify(next), tx);
    await audit(tx, req, { action: 'settings.update', entity: 'setting', entityId: key, before, after: next });
    return next;
  });
}

export const DEFAULT_LEVEL_DISCOUNTS = { 1: 5, 2: 10, 3: 15 } as Record<string, number>;
const DEFAULT_INVENTORY = { pctThreshold: 5, unitThreshold: 5, reorderBufferDays: 3 };

export async function settingsRoutes(app: FastifyInstance) {
  // Sales tax — default 8.25%, totals default to tax ON.
  app.get('/api/settings/tax', async () => ({ ratePct: await taxRatePct() }));
  app.put('/api/settings/tax', {
    schema: { body: { type: 'object', required: ['ratePct'], additionalProperties: false,
      properties: { ratePct: { type: 'number', minimum: 0, maximum: 30 } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const { ratePct } = req.body as { ratePct: number };
    await withTx(async (tx) => {
      const before = await taxRatePct(tx);
      await setSetting('taxRatePct', String(ratePct), tx);
      await audit(tx, req, { action: 'settings.update', entity: 'setting', entityId: 'taxRatePct',
        before: { ratePct: before }, after: { ratePct } });
    });
    return { ratePct };
  });

  // Company name (2026-09-29) — shown next to "Shop Manager" everywhere. Anyone signed in
  // can read it (the sign-in screen gets it from /api/auth/status); only an admin changes it.
  // Blank is allowed: the app then shows just "Shop Manager".
  app.get('/api/settings/company', async () => ({ companyName: await getCompanyName() }));
  app.put('/api/settings/company', {
    schema: { body: { type: 'object', required: ['companyName'], additionalProperties: false,
      properties: { companyName: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const companyName = cleanCompanyName((req.body as { companyName: string }).companyName);
    await withTx(async (tx) => {
      const before = await getCompanyName(tx);
      await setSetting(COMPANY_KEY, companyName, tx);
      await audit(tx, req, { action: 'settings.update', entity: 'setting', entityId: COMPANY_KEY,
        before: { companyName: before }, after: { companyName } });
    });
    return { companyName };
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
  }, async (req, reply) => {
    // Manager, not admin: the unit list is inventory taxonomy (Taxonomy page).
    if (!requireRole(req, reply, 'manager')) return reply;
    const { units } = req.body as { units: string[] };
    // Dedupe (case-sensitive exact match — "sqft" and "Sqft" are kept distinct
    // on purpose; the admin can merge by editing the chip text directly).
    const deduped = [...new Set(units.map((u) => u.trim()).filter(Boolean))];
    await saveJson(req, 'unitTypes', { units: [...DEFAULT_UNIT_TYPES] }, { units: deduped });
    return { units: deduped };
  });

  // Inventory management knobs (2026-07-07): the cycle-count variance
  // threshold (a variance flags when it beats EITHER the % or the flat-unit
  // limit) and the reorder buffer days added on top of supplier lead time in
  // the AUTO Min suggestion. Defaults live in modules/inventory/service.ts.
  app.get('/api/settings/inventory', async () => getJson('inventorySettings', DEFAULT_INVENTORY));
  app.put('/api/settings/inventory', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1,
      properties: {
        pctThreshold: { type: 'number', minimum: 0, maximum: 100 },
        unitThreshold: { type: 'number', minimum: 0 },
        reorderBufferDays: { type: 'number', minimum: 0, maximum: 60 },
      } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    return saveJson(req, 'inventorySettings', DEFAULT_INVENTORY, req.body as object);
  });

  // POS knobs (Phase 3): the refund amount above which a return needs a manager.
  app.get('/api/settings/pos', async () => getJson('posSettings', DEFAULT_POS_SETTINGS));
  app.put('/api/settings/pos', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1,
      properties: { refundApprovalThresholdCents: { type: 'integer', minimum: 0, maximum: 10_000_000 } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    return saveJson(req, 'posSettings', DEFAULT_POS_SETTINGS, req.body as object);
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
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    return saveJson(req, 'levelDiscounts', DEFAULT_LEVEL_DISCOUNTS, req.body as object);
  });
}
