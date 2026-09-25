import type { FastifyInstance } from 'fastify';
import { eq, desc, isNull, and, isNotNull, asc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { inventoryItems, inventoryAdjustments, cycleCounts, cycleCountLines, materials, materialColors, suppliers, categories } from '../../db/schema/index.js';
import { availabilityCheck, acrossFromDims, type StockLineQuery, type StockResult } from '../../../shared/stockCheck.js';
import { ADJUST_REASONS, VARIANCE_REASON_CODES } from '../../../shared/domain.js';
import { varianceFor, hasRepeatedVariance } from '../../../shared/countReview.js';
import { urgencyCompare, daysUntilStockout } from '../../../shared/reorder.js';
import { inventorySettings, recomputeAvgDailyUse } from './service.js';

/** Cost per COUNT unit — lastCostCents is per PURCHASE unit; the conversion
 *  factor bridges them. Null when the item has no recorded cost. */
function costPerCountUnit(item: { lastCostCents: number | null; purchaseToCountFactor: number }): number | null {
  if (item.lastCostCents == null) return null;
  const f = item.purchaseToCountFactor > 0 ? item.purchaseToCountFactor : 1;
  return Math.round(item.lastCostCents / f);
}

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
        // Inventory management pass (2026-07-07): supplier + UOM + Max.
        supplierId: { type: 'integer' },
        purchaseUnit: { type: 'string', maxLength: 24 },
        countUnit: { type: 'string', maxLength: 24 },
        purchaseToCountFactor: { type: 'number', exclusiveMinimum: 0 },
        reorderMaxQty: { type: 'integer', minimum: 0 },
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
        // Inventory management pass (2026-07-07): supplier + UOM + Max.
        supplierId: { type: ['integer', 'null'] },
        purchaseUnit: { type: ['string', 'null'], maxLength: 24 },
        countUnit: { type: ['string', 'null'], maxLength: 24 },
        purchaseToCountFactor: { type: 'number', exclusiveMinimum: 0 },
        reorderMaxQty: { type: ['integer', 'null'], minimum: 0 },
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
  // Receiving = reason 'received' with a delta in COUNT units (the client's
  // receiving form converts purchase units × factor); unitCostCents is the
  // cost paid per PURCHASE unit and is kept on the row — that per-receipt
  // history is what the cost-trend view reads. supplierId records who the
  // stock actually came from (may differ from the item's preferred supplier).
  app.post('/api/inventory/:id/adjust', {
    schema: { body: { type: 'object', required: ['delta', 'reason'], additionalProperties: false,
      properties: {
        delta: { type: 'integer' },
        reason: { type: 'string', enum: [...ADJUST_REASONS] },
        note: { type: 'string', maxLength: 300 },
        createdBy: { type: 'string', maxLength: 60 },
        unitCostCents: { type: 'integer', minimum: 0 },
        supplierId: { type: 'integer' },
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { delta, reason, note, createdBy, unitCostCents, supplierId } = req.body as { delta: number; reason: string; note?: string; createdBy?: string; unitCostCents?: number; supplierId?: number };
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    const next = item.count + delta;
    if (next < 0) return reply.code(409).send({ error: `Count cannot go below zero (have ${item.count})` });
    const isReceipt = reason === 'received';
    await db.insert(inventoryAdjustments).values({
      itemId: id, delta, reason, note: note ?? null, createdBy: createdBy ?? null,
      unitCostCents: isReceipt ? unitCostCents ?? null : null,
      supplierId: isReceipt ? supplierId ?? null : null,
    });
    const patch: Record<string, unknown> = { count: next };
    // Receiving with a cost updates "last cost paid" — the latest point of the
    // per-receipt history stored above.
    if (isReceipt && unitCostCents != null) patch.lastCostCents = unitCostCents;
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

  // Complete (v2, 2026-07-07 — blind count + variance review). The counted
  // values were entered blind (no system count shown); this endpoint is the
  // reconciliation. Every counted item gets an immutable cycle_count_lines
  // snapshot; any variance ABOVE the configured threshold must carry a reason
  // code (server-enforced with the same shared math the review screen uses) and
  // books under that reason; small drift books as plain 'cycle_count'. On-hand
  // resets to the counted value, the session locks (one-shot, 409 after), and
  // each item's rolling avg daily usage is recomputed from count-to-count
  // deltas + receipts — that rate drives the AUTO reorder-point suggestion.
  app.post('/api/cycle-counts/:id/complete', {
    schema: { body: { type: 'object', required: ['counts'], additionalProperties: false,
      properties: {
        counts: { type: 'array', items: { type: 'object', required: ['itemId', 'counted'],
          additionalProperties: false,
          properties: {
            itemId: { type: 'integer' },
            counted: { type: 'integer', minimum: 0 },
            reasonCode: { type: 'string', enum: [...VARIANCE_REASON_CODES] },
            note: { type: 'string', maxLength: 300 },
          } } },
        completedBy: { type: 'string', maxLength: 60 },
        nextScheduledFor: { type: 'string', minLength: 10, maxLength: 10 },
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { counts, completedBy, nextScheduledFor } = req.body as {
      counts: { itemId: number; counted: number; reasonCode?: string; note?: string }[];
      completedBy?: string; nextScheduledFor?: string;
    };
    const [cc] = await db.select().from(cycleCounts).where(eq(cycleCounts.id, id));
    if (!cc) return reply.code(404).send({ error: 'Cycle count not found' });
    if (cc.completedAt) return reply.code(409).send({ error: 'Already completed' });

    const t = await inventorySettings();
    const allItems = await db.select().from(inventoryItems);
    const byId = new Map(allItems.map((i) => [i.id, i]));

    // Pass 1 — validate against CURRENT counts (they may have moved since the
    // client's review screen; the server's math is the one that binds).
    const missingReason: { itemId: number; name: string }[] = [];
    for (const c of counts) {
      const item = byId.get(c.itemId);
      if (!item) continue;
      const v = varianceFor({ itemId: c.itemId, systemCount: item.count, counted: c.counted,
        unitCostCents: costPerCountUnit(item) }, t);
      if (v.aboveThreshold && !c.reasonCode) missingReason.push({ itemId: c.itemId, name: item.name });
    }
    if (missingReason.length > 0) {
      return reply.code(400).send({
        error: `Reason code required for ${missingReason.length} variance(s) above threshold`,
        items: missingReason,
      });
    }

    // Pass 2 — snapshot lines, book adjustments, reset counts.
    let drift = 0;
    const nowMs = Date.now();
    for (const c of counts) {
      const item = byId.get(c.itemId);
      if (!item) continue;
      const v = varianceFor({ itemId: c.itemId, systemCount: item.count, counted: c.counted,
        unitCostCents: costPerCountUnit(item) }, t);
      // A voluntarily-chosen reason on a small variance is kept — required
      // only above threshold, never discarded.
      await db.insert(cycleCountLines).values({
        cycleCountId: id, itemId: c.itemId, systemCount: item.count, countedQty: c.counted,
        unitCostCents: costPerCountUnit(item),
        reasonCode: v.delta !== 0 ? c.reasonCode ?? null : null,
        note: c.note ?? null,
      });
      if (v.delta !== 0) {
        drift++;
        await db.insert(inventoryAdjustments).values({
          itemId: c.itemId, delta: v.delta,
          reason: c.reasonCode ?? 'cycle_count',
          note: c.note ?? null, createdBy: completedBy ?? null, cycleCountId: id,
        });
        await db.update(inventoryItems).set({ count: c.counted }).where(eq(inventoryItems.id, c.itemId));
      }
    }
    await db.update(cycleCounts)
      .set({ completedAt: new Date().toISOString(), completedBy: completedBy ?? null,
        notes: `${counts.length} items counted, ${drift} adjusted` })
      .where(eq(cycleCounts.id, id));

    // Rolling avg daily usage — needs the session marked complete first so the
    // baseline lookup excludes this session's own lines by id.
    for (const c of counts) {
      if (byId.has(c.itemId)) await recomputeAvgDailyUse(c.itemId, c.counted, id, nowMs);
    }

    // Auto-reschedule: completing a count ALWAYS queues the next one (default
    // +7 days — the weekly rhythm the roll SKUs depend on). No human memory,
    // no external calendar (deliberate — see TASKS.md Phase 11).
    const next = nextScheduledFor
      ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await db.insert(cycleCounts).values({ scheduledFor: next });
    return { ok: true, itemsCounted: counts.length, itemsAdjusted: drift, nextScheduledFor: next };
  });

  // Needs-ordering view: every item at/below its reorder point (Min), sorted
  // by urgency — fewest days-until-stockout first (at the recorded usage
  // rate), rows without a rate ranked by how far below Min they sit. Order
  // quantity fills back to Max when one is set; the old 2×-threshold
  // heuristic stays as the fallback so items without a Max keep working.
  app.get('/api/inventory/reorder', async () => {
    const items = await db.select().from(inventoryItems);
    const sups = await db.select().from(suppliers);
    const supById = new Map(sups.map((s) => [s.id, s]));
    return items
      .filter((i) => i.active && i.count <= i.lowStockThreshold)
      .sort(urgencyCompare)
      .map((i) => {
        const sup = i.supplierId != null ? supById.get(i.supplierId) : undefined;
        return {
          id: i.id, name: i.name, count: i.count, threshold: i.lowStockThreshold,
          reorderMaxQty: i.reorderMaxQty,
          suggestedQty: i.reorderMaxQty != null
            ? Math.max(i.reorderMaxQty - i.count, 1)
            : Math.max(i.lowStockThreshold * 2 - i.count, 1),
          supplierId: i.supplierId, supplierName: sup?.name ?? i.vendor ?? null,
          leadTimeDays: sup?.leadTimeDays ?? null,
          lastCostCents: i.lastCostCents, purchaseUnit: i.purchaseUnit, countUnit: i.countUnit,
          avgDailyUse: i.avgDailyUse,
          daysUntilStockout: daysUntilStockout(i.count, i.avgDailyUse),
        };
      });
  });

  // Usage view — replaced the manual-tap monthly trends 2026-07-07. The rate
  // comes from count-to-count reconciliation (see recomputeAvgDailyUse), which
  // captures ALL consumption — tracked sales, production use, waste — because
  // two physical counts bracket it. Items with no rate yet (fewer than two
  // counts) are listed so the gap is visible rather than invisible.
  app.get('/api/inventory/usage', async () => {
    const items = await db.select().from(inventoryItems);
    return items
      .filter((i) => i.active)
      .map((i) => ({
        id: i.id, name: i.name, count: i.count, countUnit: i.countUnit,
        avgDailyUse: i.avgDailyUse,
        daysUntilStockout: daysUntilStockout(i.count, i.avgDailyUse),
      }))
      .sort((a, b) => (b.avgDailyUse ?? -1) - (a.avgDailyUse ?? -1));
  });

  // Inventory valuation: cash tied up on the shelf. Value per item =
  // on-hand ÷ factor (count units → purchase units) × last cost paid per
  // purchase unit. Items with no recorded cost are counted separately so the
  // total is honest about what it excludes.
  app.get('/api/inventory/valuation', async () => {
    const items = await db.select().from(inventoryItems);
    const cats = await db.select().from(categories);
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    let totalCents = 0, pricedItems = 0, unpricedItems = 0;
    const byCat = new Map<string, { valueCents: number; items: number }>();
    for (const i of items) {
      if (!i.active) continue;
      if (i.lastCostCents == null) { unpricedItems++; continue; }
      const f = i.purchaseToCountFactor > 0 ? i.purchaseToCountFactor : 1;
      const v = Math.round((i.count / f) * i.lastCostCents);
      totalCents += v;
      pricedItems++;
      const key = i.categoryId != null ? catName.get(i.categoryId) ?? 'Other' : 'Other';
      const cur = byCat.get(key) ?? { valueCents: 0, items: 0 };
      byCat.set(key, { valueCents: cur.valueCents + v, items: cur.items + 1 });
    }
    return {
      totalCents, pricedItems, unpricedItems,
      byCategory: [...byCat.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.valueCents - a.valueCents),
    };
  });

  // Cost trend per item: what was actually paid, receipt by receipt.
  app.get('/api/inventory/:id/cost-history', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const rows = await db.select({
      createdAt: inventoryAdjustments.createdAt,
      delta: inventoryAdjustments.delta,
      unitCostCents: inventoryAdjustments.unitCostCents,
      supplierName: suppliers.name,
    }).from(inventoryAdjustments)
      .leftJoin(suppliers, eq(inventoryAdjustments.supplierId, suppliers.id))
      .where(and(eq(inventoryAdjustments.itemId, id), eq(inventoryAdjustments.reason, 'received')))
      .orderBy(asc(inventoryAdjustments.createdAt));
    return rows.filter((r) => r.unitCostCents != null);
  });

  // Count-variance history per item, newest first, with the structural-problem
  // signal: 3+ of the last 4 counts above threshold means something systemic
  // (bad UOM factor, systematic miscounting, a supplier shorting orders) —
  // surfaced here instead of buried in raw logs.
  app.get('/api/inventory/:id/variances', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const t = await inventorySettings();
    const lines = await db.select().from(cycleCountLines)
      .where(eq(cycleCountLines.itemId, id))
      .orderBy(desc(cycleCountLines.createdAt)).limit(26); // ~half a year of weekly counts
    const rows = lines.map((l) => {
      const v = varianceFor({ itemId: id, systemCount: l.systemCount, counted: l.countedQty,
        unitCostCents: l.unitCostCents }, t);
      return { createdAt: l.createdAt, systemCount: l.systemCount, counted: l.countedQty,
        delta: v.delta, pct: v.pct, impactCents: v.impactCents,
        aboveThreshold: v.aboveThreshold, reasonCode: l.reasonCode, note: l.note };
    });
    return { rows, repeated: hasRepeatedVariance(rows.map((r) => r.aboveThreshold)) };
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
        // Whole rolls by decision — see CLAUDE.md.
        purchaseUnit: 'roll', countUnit: 'roll',
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
