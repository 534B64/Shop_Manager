import type { FastifyInstance } from 'fastify';
import { eq, desc, isNull, and, isNotNull, asc, lt } from 'drizzle-orm';
import { db, withTx, type Db } from '../../db/index.js';
import { inventoryItems, inventoryAdjustments, inventoryBalances, locations, cycleCountLines, materials, materialColors, suppliers, categories } from '../../db/schema/index.js';
import { availabilityCheck, acrossFromDims, type StockLineQuery, type StockResult } from '../../../shared/stockCheck.js';
import { ADJUST_REASONS, type AdjustReason } from '../../../shared/domain.js';
import { varianceFor, hasRepeatedVariance } from '../../../shared/countReview.js';
import { urgencyCompare, daysUntilStockout } from '../../../shared/reorder.js';
import { countUnitCost, extendedValueCents } from '../../../shared/costing.js';
import {
  inventorySettings, postTransaction, receive, adjust, transfer, reconcile, postedLine,
} from './service.js';
import { ledgerWrite, txnUser } from './http.js';
import { requireApproval, requireRole, approvalSchema } from '../auth/index.js';
import { audit } from '../audit/index.js';

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Error && /unique/i.test(e.message);

const COUNT_IS_LEDGER = 'On-hand can\'t be edited directly — every quantity change is an inventory transaction. Use Receive stock, an adjustment (POST /api/inventory/:id/adjust), a transfer, or the cycle count.';

/** Average cost for a brand-new item: its last cost (per purchase unit)
 *  converted to count units, else 0 (unknown until the first costed receipt). */
function initialAvgCost(lastCostCents: number | null | undefined, factor: number | null | undefined): number {
  return lastCostCents != null ? Math.round(countUnitCost(lastCostCents, factor)) : 0;
}

/** A SKU's color must be one of the material's admin-defined (non-archived)
 *  colors — a typo would otherwise create an orphan color the stock-check
 *  silently never finds. */
async function validateSkuColor(materialId: number, color: string, dbx: Db = db): Promise<string | null> {
  const list = await dbx.select().from(materialColors)
    .where(and(eq(materialColors.materialId, materialId), isNull(materialColors.archivedAt)));
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
    // A starting count is not written to the item — the item is created at 0
    // and the count arrives as an 'opening' transaction (ADR 0006).
    const { count, ...fields } = req.body as { name: string; count?: number; lastCostCents?: number; purchaseToCountFactor?: number };
    return ledgerWrite(reply, () => withTx(async (tx) => {
      let [row] = await tx.insert(inventoryItems).values({
        ...fields, avgCostCents: initialAvgCost(fields.lastCostCents, fields.purchaseToCountFactor),
      }).returning();
      let opening = null;
      if (count) {
        const r = await postTransaction({ itemId: row.id, type: 'opening', qty: count,
          reason: 'opening balance', source: { type: 'manual' }, user: txnUser(req) }, tx);
        row = r.item; opening = r.txn;
      }
      await audit(tx, req, { action: 'inventory_item.create', entity: 'inventory_item', entityId: row.id, after: { ...row, opening } });
      reply.code(201);
      return row;
    }));
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
        // Listed only so it isn't silently stripped — it is always refused.
        count: {},
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { color?: string | null; active?: boolean; count?: unknown; lastCostCents?: number };
    if ('count' in b) return reply.code(400).send({ error: COUNT_IS_LEDGER });
    try {
      return await withTx(async (tx) => {
        const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
        if (!item) return reply.code(404).send({ error: 'Item not found' });
        // Roll SKUs: a color change must stay within the material's color list
        // (same guard as SKU creation — see validateSkuColor).
        const isRollSku = item.materialId != null && item.nominalWidthIn != null;
        if (isRollSku && typeof b.color === 'string' && b.color.trim().toLowerCase() !== (item.color ?? '').toLowerCase()) {
          const colorError = await validateSkuColor(item.materialId as number, b.color.trim(), tx);
          if (colorError) return reply.code(400).send({ error: colorError });
        }
        const patch: Record<string, unknown> = { ...b };
        // An item that has never had a costed receipt has no average yet —
        // seed it from a last cost entered by hand (same rule as migration 0015).
        if (item.avgCostCents === 0 && b.lastCostCents != null) {
          const f = (b as { purchaseToCountFactor?: number }).purchaseToCountFactor ?? item.purchaseToCountFactor;
          patch.avgCostCents = initialAvgCost(b.lastCostCents, f);
        }
        const [row] = await tx.update(inventoryItems).set(patch).where(eq(inventoryItems.id, id)).returning();
        await audit(tx, req, { action: 'inventory_item.update', entity: 'inventory_item', entityId: id, before: item, after: row });
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return reply.code(409).send({ error: 'That change would duplicate an existing roll SKU (same material, color, and width).' });
      }
      throw e;
    }
  });

  // All count changes go through the ledger (ADR 0006) — this route is the
  // manual entry point. Receiving = reason 'received' with a delta in COUNT
  // units (the client's receiving form converts purchase units × factor);
  // unitCostCents is the cost paid per PURCHASE unit and is kept on the row —
  // that per-receipt history is what the cost-trend view reads — and moves the
  // moving-average cost. supplierId records who the stock actually came from.
  // Every other reason books as an adjustment / production / sale transaction
  // (see txnTypeForReason) and needs a manager.
  app.post('/api/inventory/:id/adjust', {
    schema: { body: { type: 'object', required: ['delta', 'reason'], additionalProperties: false,
      properties: {
        delta: { type: 'integer' },
        reason: { type: 'string', enum: [...ADJUST_REASONS] },
        note: { type: 'string', maxLength: 300 },
        unitCostCents: { type: 'integer', minimum: 0 },
        supplierId: { type: 'integer' },
        locationId: { type: 'integer' },
        approval: approvalSchema,
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { delta, reason, note, unitCostCents, supplierId, locationId } = req.body as {
      delta: number; reason: AdjustReason; note?: string; unitCostCents?: number; supplierId?: number; locationId?: number;
    };
    // One transaction: the approval, the ledger row (its trigger moves the
    // count), the cost update, and the audit row.
    return ledgerWrite(reply, () => withTx(async (tx) => {
      const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
      if (!item) return reply.code(404).send({ error: 'Item not found' });
      if (item.count + delta < 0) return reply.code(409).send({ error: `Count cannot go below zero (have ${item.count})` });
      const isReceipt = reason === 'received';
      // Receiving is day-to-day work; every other manual count change is an
      // override of the books and needs a manager (ADR 0004). The weekly cycle
      // count has its own approval step at posting.
      let approvalId: number | null = null;
      if (!isReceipt) {
        const approver = await requireApproval(req, reply, { action: 'inventory.adjust', entity: 'inventory_item', entityId: id,
          reason: note ?? null, details: { delta, reason, name: item.name, before: item.count } });
        if (!approver) return reply;
        approvalId = approver.approvalId;
      }
      const base = { itemId: id, qty: delta, note: note ?? null, locationId, user: txnUser(req) };
      const r = isReceipt
        ? await receive({ ...base, purchaseUnitCostCents: unitCostCents ?? null, supplierId: supplierId ?? null }, tx)
        : await adjust({ ...base, reason }, tx);
      await audit(tx, req, { action: isReceipt ? 'inventory.receive' : 'inventory.adjust', entity: 'inventory_item',
        entityId: id, before: { count: r.before.count, lastCostCents: r.before.lastCostCents, avgCostCents: r.before.avgCostCents },
        after: { count: r.item.count, lastCostCents: r.item.lastCostCents, avgCostCents: r.item.avgCostCents, transaction: r.txn }, approvalId });
      return r.item;
    }));
  });

  // Move stock between locations (manager+). Item total is unchanged.
  app.post('/api/inventory/:id/transfer', {
    schema: { body: { type: 'object', required: ['fromLocationId', 'toLocationId', 'qty'], additionalProperties: false,
      properties: {
        fromLocationId: { type: 'integer' },
        toLocationId: { type: 'integer' },
        qty: { type: 'integer', minimum: 1 },
        note: { type: 'string', maxLength: 300 },
      } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { fromLocationId: number; toLocationId: number; qty: number; note?: string };
    return ledgerWrite(reply, () => withTx(async (tx) => {
      const r = await transfer({ itemId: id, ...b, user: txnUser(req) }, tx);
      await audit(tx, req, { action: 'inventory.transfer', entity: 'inventory_item', entityId: id,
        after: { transferId: r.transferId, from: b.fromLocationId, to: b.toLocationId, qty: b.qty, out: r.out.id, in: r.in.id } });
      return { transferId: r.transferId, item: r.item, transactions: [r.out, r.in] };
    }));
  });

  // An item's inventory transactions, newest first, keyset-paginated on id
  // (?before=<id>&limit=<n ≤ 200>).
  app.get('/api/inventory/:id/transactions', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const q = req.query as { before?: string; limit?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const before = q.before != null && q.before !== '' ? Number(q.before) : null;
    const rows = await db.select().from(inventoryAdjustments)
      .where(and(eq(inventoryAdjustments.itemId, id), before != null ? lt(inventoryAdjustments.id, before) : undefined))
      .orderBy(desc(inventoryAdjustments.id)).limit(limit);
    return { rows, nextBefore: rows.length === limit ? rows[rows.length - 1].id : null };
  });

  // On-hand per location for one item.
  app.get('/api/inventory/:id/balances', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return db.select({ locationId: inventoryBalances.locationId, locationName: locations.name, onHand: inventoryBalances.onHand })
      .from(inventoryBalances).innerJoin(locations, eq(inventoryBalances.locationId, locations.id))
      .where(eq(inventoryBalances.itemId, id)).orderBy(locations.id);
  });

  // Integrity check: items / balances whose cached on-hand disagrees with the
  // ledger. The triggers make this impossible, so it should always be empty.
  app.get('/api/inventory/reconcile', async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    return reconcile();
  });

  app.get('/api/inventory/:id/history', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return db.select().from(inventoryAdjustments)
      .where(eq(inventoryAdjustments.itemId, id))
      .orderBy(desc(inventoryAdjustments.createdAt), desc(inventoryAdjustments.id)).limit(50);
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

  // Inventory valuation: cash tied up on the shelf at moving-average cost
  // (ADR 0006): on-hand × average cost per count unit. Items with no average
  // yet (never received with a cost, no last cost) are counted separately so
  // the total is honest about what it excludes.
  app.get('/api/inventory/valuation', async () => {
    const items = await db.select().from(inventoryItems);
    const cats = await db.select().from(categories);
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    let totalCents = 0, pricedItems = 0, unpricedItems = 0;
    const byCat = new Map<string, { valueCents: number; items: number }>();
    for (const i of items) {
      if (!i.active) continue;
      if (i.avgCostCents <= 0) { unpricedItems++; continue; }
      const v = extendedValueCents(i.count, i.avgCostCents);
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
      // Per PURCHASE unit, as entered (the API name predates Phase 2).
      unitCostCents: inventoryAdjustments.purchaseUnitCostCents,
      supplierName: suppliers.name,
    }).from(inventoryAdjustments)
      .leftJoin(suppliers, eq(inventoryAdjustments.supplierId, suppliers.id))
      .where(and(eq(inventoryAdjustments.itemId, id), eq(inventoryAdjustments.txnType, 'receipt')))
      .orderBy(asc(inventoryAdjustments.createdAt), asc(inventoryAdjustments.id));
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
      .where(and(eq(cycleCountLines.itemId, id), postedLine))
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
    const color = b.color.trim();
    // One SKU per material + color + width. The DB unique index (migration
    // 0011) is the real guard — the racy app-level pre-check is gone; a
    // constraint violation maps to the same friendly 409.
    let materialName = '';
    try {
      return await withTx(async (tx) => {
        const [material] = await tx.select().from(materials).where(eq(materials.id, b.materialId));
        if (!material) return reply.code(400).send({ error: 'Unknown material' });
        if (!material.usesRoll) return reply.code(400).send({ error: 'Roll SKUs are only for roll (vinyl) materials' });
        materialName = material.name;
        // The color must exist in the material's admin-defined list — a typo would
        // create an orphan SKU the quote-time stock check silently never finds.
        const colorError = await validateSkuColor(b.materialId, color, tx);
        if (colorError) return reply.code(400).send({ error: colorError });
        let [row] = await tx.insert(inventoryItems).values({
          name: `${material.name} · ${color} · ${b.nominalWidthIn}in`,
          materialId: b.materialId, color, nominalWidthIn: b.nominalWidthIn,
          lowStockThreshold: b.lowStockThreshold ?? 0,
          vendor: b.vendor ?? null, lastCostCents: b.lastCostCents ?? null,
          avgCostCents: initialAvgCost(b.lastCostCents, 1),
          // Whole rolls by decision — see CLAUDE.md.
          purchaseUnit: 'roll', countUnit: 'roll',
        }).returning();
        // Starting count = an 'opening' transaction (ADR 0006).
        let opening = null;
        if (b.count) {
          const r = await postTransaction({ itemId: row.id, type: 'opening', qty: b.count,
            reason: 'opening balance', source: { type: 'manual' }, user: txnUser(req) }, tx);
          row = r.item; opening = r.txn;
        }
        await audit(tx, req, { action: 'inventory_item.create', entity: 'inventory_item', entityId: row.id, after: { ...row, opening } });
        reply.code(201);
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return reply.code(409).send({ error: `A SKU for ${materialName} · ${color} · ${b.nominalWidthIn}in already exists` });
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
