import type { FastifyInstance } from 'fastify';
import { eq, desc, isNull, and, isNotNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { inventoryItems, inventoryAdjustments, cycleCounts, materials, materialColors } from '../db/schema/index.js';
import { availabilityCheck, acrossFromDims, type StockLineQuery, type StockResult } from '../../shared/stockCheck.js';

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Error && /unique/i.test(e.message);

/** A SKU's color must be one of the material's admin-defined colors — a typo
 *  would otherwise create an orphan color the stock-check silently never finds. */
async function validateSkuColor(materialId: number, color: string): Promise<string | null> {
  const list = await db.select().from(materialColors).where(eq(materialColors.materialId, materialId));
  if (list.length === 0) return `This material has no colors set up — add '${color}' on the Materials page first.`;
  if (!list.some((c) => c.name.toLowerCase() === color.toLowerCase())) {
    return `'${color}' is not in this material's color list (${list.map((c) => c.name).join(', ')}). Add it on the Materials page first.`;
  }
  return null;
}

/** One advisory stock check: material + color + part dims → three-state result. */
async function stockCheckOne(materialId: number, color: string, acrossIn: number | null): Promise<StockResult & { message: string | null }> {
  const skus = await db.select().from(inventoryItems).where(and(
    eq(inventoryItems.active, true),
    eq(inventoryItems.materialId, materialId),
    isNotNull(inventoryItems.nominalWidthIn),
  ));
  const forColor = skus.filter((s) => (s.color ?? '').toLowerCase() === color.toLowerCase());
  const inStockWidths = forColor.filter((s) => s.count > 0 && s.nominalWidthIn != null).map((s) => s.nominalWidthIn as number);

  const result = availabilityCheck({ hasStockData: forColor.length > 0, inStockWidths, acrossIn });
  let message: string | null = null;
  if (result.state === 'suboptimal') {
    message = `Optimal ${result.optimalWidth}″ out of stock — using ${result.useWidth}″.`;
  } else if (result.state === 'out_of_stock') {
    const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
    message = `${material?.name ?? 'Material'} ${color} is out of stock — verify before promising.`;
  }
  return { ...result, message };
}

const UNKNOWN_STOCK: StockResult & { message: string | null } =
  { state: 'unknown', optimalWidth: null, useWidth: null, fittingInStock: [], message: null };

export async function inventoryRoutes(app: FastifyInstance) {
  app.get('/api/inventory', async () => {
    const rows = await db.select().from(inventoryItems);
    return rows.filter((r) => r.active);
  });

  app.post('/api/inventory', {
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        count: { type: 'integer', minimum: 0 },
        lowStockThreshold: { type: 'integer', minimum: 0 },
        vendor: { type: 'string', maxLength: 120 },
        lastCostCents: { type: 'integer', minimum: 0 },
        // Phase 10 taxonomy — orthogonal to the roll-SKU fields above. color
        // was previously roll-SKU-only; plain items may now set it too (e.g.
        // a non-roll material that still comes in colors).
        categoryId: { type: 'integer' },
        sizeText: { type: 'string', maxLength: 60 },
        color: { type: 'string', maxLength: 60 },
        orderNote: { type: 'string', maxLength: 300 },
      } } },
  }, async (req, reply) => {
    const [row] = await db.insert(inventoryItems).values(req.body as { name: string }).returning();
    reply.code(201);
    return row;
  });

  app.put('/api/inventory/:id', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        lowStockThreshold: { type: 'integer', minimum: 0 },
        vendor: { type: 'string', maxLength: 120 },
        lastCostCents: { type: 'integer', minimum: 0 },
        active: { type: 'boolean' },
        categoryId: { type: ['integer', 'null'] },
        sizeText: { type: ['string', 'null'], maxLength: 60 },
        color: { type: ['string', 'null'], maxLength: 60 },
        orderNote: { type: ['string', 'null'], maxLength: 300 },
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { color?: string | null; active?: boolean };
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    // Roll SKUs: a color change must stay within the material's color list
    // (same guard as SKU creation — see validateSkuColor).
    const isRollSku = item.materialId != null && item.nominalWidthIn != null;
    if (isRollSku && typeof b.color === 'string' && b.color.trim().toLowerCase() !== (item.color ?? '').toLowerCase()) {
      const colorError = await validateSkuColor(item.materialId as number, b.color.trim());
      if (colorError) return reply.code(400).send({ error: colorError });
    }
    try {
      const [row] = await db.update(inventoryItems).set(req.body as object).where(eq(inventoryItems.id, id)).returning();
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) {
        return reply.code(409).send({ error: 'That change would duplicate an existing roll SKU (same material, color, and width).' });
      }
      throw e;
    }
  });

  // All count changes go through adjustments — the log explains every number.
  app.post('/api/inventory/:id/adjust', {
    schema: { body: { type: 'object', required: ['delta', 'reason'], additionalProperties: false,
      properties: {
        delta: { type: 'integer' },
        reason: { type: 'string', enum: ['received', 'used', 'damaged', 'cycle_count', 'correction'] },
        note: { type: 'string', maxLength: 300 },
        createdBy: { type: 'string', maxLength: 60 },
        unitCostCents: { type: 'integer', minimum: 0 },
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { delta, reason, note, createdBy, unitCostCents } = req.body as { delta: number; reason: string; note?: string; createdBy?: string; unitCostCents?: number };
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    const next = item.count + delta;
    if (next < 0) return reply.code(409).send({ error: `Count cannot go below zero (have ${item.count})` });
    await db.insert(inventoryAdjustments).values({ itemId: id, delta, reason, note: note ?? null, createdBy: createdBy ?? null });
    const patch: Record<string, unknown> = { count: next };
    // Receiving with a cost updates "last cost paid" — lightweight vendor pricing history.
    if (reason === 'received' && unitCostCents != null) patch.lastCostCents = unitCostCents;
    const [row] = await db.update(inventoryItems).set(patch).where(eq(inventoryItems.id, id)).returning();
    return row;
  });

  app.get('/api/inventory/:id/history', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return db.select().from(inventoryAdjustments)
      .where(eq(inventoryAdjustments.itemId, id))
      .orderBy(desc(inventoryAdjustments.createdAt)).limit(50);
  });

  // ---- Cycle counts: schedule one, complete it with counted values ----
  app.get('/api/cycle-counts/next', async () => {
    const [pending] = await db.select().from(cycleCounts)
      .where(isNull(cycleCounts.completedAt)).orderBy(cycleCounts.scheduledFor).limit(1);
    return pending ?? null;
  });

  app.post('/api/cycle-counts', {
    schema: { body: { type: 'object', required: ['scheduledFor'], additionalProperties: false,
      properties: { scheduledFor: { type: 'string', minLength: 10, maxLength: 10 } } } },
  }, async (req, reply) => {
    const [row] = await db.insert(cycleCounts).values(req.body as { scheduledFor: string }).returning();
    reply.code(201);
    return row;
  });

  // Complete: counted values become 'cycle_count' adjustments for any drift.
  app.post('/api/cycle-counts/:id/complete', {
    schema: { body: { type: 'object', required: ['counts'], additionalProperties: false,
      properties: {
        counts: { type: 'array', items: { type: 'object', required: ['itemId', 'counted'],
          additionalProperties: false,
          properties: { itemId: { type: 'integer' }, counted: { type: 'integer', minimum: 0 } } } },
        nextScheduledFor: { type: 'string', minLength: 10, maxLength: 10 },
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { counts, nextScheduledFor } = req.body as { counts: { itemId: number; counted: number }[]; nextScheduledFor?: string };
    const [cc] = await db.select().from(cycleCounts).where(eq(cycleCounts.id, id));
    if (!cc) return reply.code(404).send({ error: 'Cycle count not found' });
    if (cc.completedAt) return reply.code(409).send({ error: 'Already completed' });

    let drift = 0;
    for (const { itemId, counted } of counts) {
      const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
      if (!item || counted === item.count) continue;
      const delta = counted - item.count;
      drift++;
      await db.insert(inventoryAdjustments).values({ itemId, delta, reason: 'cycle_count' });
      await db.update(inventoryItems).set({ count: counted }).where(eq(inventoryItems.id, itemId));
    }
    await db.update(cycleCounts)
      .set({ completedAt: new Date().toISOString(), notes: `${counts.length} items counted, ${drift} adjusted` })
      .where(eq(cycleCounts.id, id));
    // Auto-reschedule: completing a count ALWAYS queues the next one (default
    // +7 days — the weekly rhythm the roll SKUs depend on). No human memory,
    // no external calendar (deliberate — see TASKS.md Phase 11).
    const next = nextScheduledFor
      ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await db.insert(cycleCounts).values({ scheduledFor: next });
    return { ok: true, itemsCounted: counts.length, itemsAdjusted: drift, nextScheduledFor: next };
  });

  // Reorder report: what's low, how much to get, from whom. Printable.
  app.get('/api/inventory/reorder', async () => {
    const items = await db.select().from(inventoryItems);
    return items
      .filter((i) => i.active && i.count <= i.lowStockThreshold)
      .map((i) => ({
        id: i.id, name: i.name, count: i.count, threshold: i.lowStockThreshold,
        vendor: i.vendor, lastCostCents: i.lastCostCents,
        // Suggest restocking to 2× threshold — simple and predictable.
        suggestedQty: Math.max(i.lowStockThreshold * 2 - i.count, 1),
      }));
  });

  // Usage trends: units consumed per item per month (last 6 months).
  app.get('/api/inventory/trends', async () => {
    const since = new Date();
    since.setMonth(since.getMonth() - 6);
    const adj = await db.select().from(inventoryAdjustments);
    const items = await db.select().from(inventoryItems);
    const names = Object.fromEntries(items.map((i) => [i.id, i.name]));
    const out: Record<string, Record<string, number>> = {};
    for (const a of adj) {
      if (a.delta >= 0 || a.createdAt < since.toISOString()) continue; // consumption only
      if (a.reason === 'cycle_count') continue; // corrections aren't usage
      const month = a.createdAt.slice(0, 7);
      const name = names[a.itemId] ?? `#${a.itemId}`;
      out[name] = out[name] ?? {};
      out[name][month] = (out[name][month] ?? 0) + -a.delta;
    }
    return out;
  });

  // ---- Roll SKUs (Phase 8): inventory items tracked by material + color + width ----
  // A roll SKU is just an inventory_item with material_id/color/nominal_width_in
  // set, so the existing cycle-count + adjust + low-stock machinery maintains it.
  app.get('/api/roll-skus', async (req) => {
    const { materialId, color } = req.query as { materialId?: string; color?: string };
    const rows = await db.select().from(inventoryItems)
      .where(and(eq(inventoryItems.active, true), isNotNull(inventoryItems.materialId)));
    return rows.filter((r) =>
      (!materialId || r.materialId === Number(materialId)) &&
      (!color || (r.color ?? '').toLowerCase() === color.toLowerCase()));
  });

  app.post('/api/roll-skus', {
    schema: { body: { type: 'object', required: ['materialId', 'color', 'nominalWidthIn'], additionalProperties: false,
      properties: {
        materialId: { type: 'integer' },
        color: { type: 'string', minLength: 1, maxLength: 60 },
        nominalWidthIn: { type: 'integer', minimum: 1, maximum: 120 },
        count: { type: 'integer', minimum: 0 },
        lowStockThreshold: { type: 'integer', minimum: 0 },
        vendor: { type: 'string', maxLength: 120 },
        lastCostCents: { type: 'integer', minimum: 0 },
      } } },
  }, async (req, reply) => {
    const b = req.body as { materialId: number; color: string; nominalWidthIn: number; count?: number; lowStockThreshold?: number; vendor?: string; lastCostCents?: number };
    const [material] = await db.select().from(materials).where(eq(materials.id, b.materialId));
    if (!material) return reply.code(400).send({ error: 'Unknown material' });
    if (!material.usesRoll) return reply.code(400).send({ error: 'Roll SKUs are only for roll (vinyl) materials' });
    const color = b.color.trim();
    // The color must exist in the material's admin-defined list — a typo would
    // create an orphan SKU the quote-time stock check silently never finds.
    const colorError = await validateSkuColor(b.materialId, color);
    if (colorError) return reply.code(400).send({ error: colorError });
    // One SKU per material + color + width. The DB unique index (migration
    // 0011) is the real guard — the racy app-level pre-check is gone; a
    // constraint violation maps to the same friendly 409.
    try {
      const [row] = await db.insert(inventoryItems).values({
        name: `${material.name} · ${color} · ${b.nominalWidthIn}in`,
        materialId: b.materialId, color, nominalWidthIn: b.nominalWidthIn,
        count: b.count ?? 0, lowStockThreshold: b.lowStockThreshold ?? 0,
        vendor: b.vendor ?? null, lastCostCents: b.lastCostCents ?? null,
      }).returning();
      reply.code(201);
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) {
        return reply.code(409).send({ error: `A SKU for ${material.name} · ${color} · ${b.nominalWidthIn}in already exists` });
      }
      throw e;
    }
  });

  // Advisory stock CHECK for the estimator — a lookup, never consumption. Reads
  // the roll SKUs of the chosen material+color and returns one of:
  // unknown (no data → show nothing) / in_stock / suboptimal / out_of_stock.
  app.get('/api/stock-check', async (req) => {
    const q = req.query as { materialId?: string; color?: string; widthIn?: string; heightIn?: string };
    const materialId = Number(q.materialId);
    const color = (q.color ?? '').trim();
    if (!materialId || !color) return UNKNOWN_STOCK;
    return stockCheckOne(materialId, color, acrossFromDims(Number(q.widthIn) || null, Number(q.heightIn) || null));
  });

  // Batch stock check — one request covers every line of a multi-item quote
  // (main + additional items), so a flaky-wifi quote costs one round trip, not
  // N. Results come back in the same order as the lines sent. Lines without a
  // material/color return 'unknown' (show nothing) rather than erroring.
  app.post('/api/stock-check/batch', {
    schema: { body: { type: 'object', required: ['lines'], additionalProperties: false,
      properties: { lines: { type: 'array', maxItems: 31, items: { type: 'object',
        required: ['color'], additionalProperties: false,
        properties: {
          materialId: { type: ['integer', 'null'] },
          color: { type: 'string', maxLength: 60 },
          widthIn: { type: ['number', 'null'] },
          heightIn: { type: ['number', 'null'] },
        } } } } } },
  }, async (req) => {
    const { lines } = req.body as { lines: StockLineQuery[] };
    const results = [];
    for (const ln of lines) {
      const color = ln.color.trim();
      results.push(!ln.materialId || !color
        ? UNKNOWN_STOCK
        : await stockCheckOne(ln.materialId, color, acrossFromDims(ln.widthIn, ln.heightIn)));
    }
    return { results };
  });

  // Dashboard summary: due soon / owed / low stock in one small payload.
  app.get('/api/dashboard', async () => {
    const items = await db.select().from(inventoryItems);
    const low = items.filter((i) => i.active && i.count <= i.lowStockThreshold);
    return { lowStock: low.map((i) => ({ id: i.id, name: i.name, count: i.count, threshold: i.lowStockThreshold })) };
  });
}
