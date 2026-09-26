// Inventory read-outs: reorder, usage, valuation, cost trend, count variances, dashboard.
import type { FastifyInstance } from 'fastify';
import { eq, desc, and, asc, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { inventoryItems, inventoryAdjustments, cycleCountLines, suppliers, categories } from '../../db/schema/index.js';
import { varianceFor, hasRepeatedVariance } from '../../../shared/countReview.js';
import { daysUntilStockout } from '../../../shared/reorder.js';
import { inventorySettings, postedLine } from './service.js';
import { pagedOr400 } from './http.js';
import { reorderAll, reorderPage, usagePage, lowStockSummary } from './lists.js';

export async function inventoryReportRoutes(app: FastifyInstance) {
  // Needs-ordering view: every item at/below its reorder point (Min), sorted
  // by urgency — fewest days-until-stockout first (at the recorded usage
  // rate), rows without a rate ranked by how far below Min they sit. Order
  // quantity fills back to Max when one is set; the old 2×-threshold
  // heuristic stays as the fallback so items without a Max keep working.
  // Paged + filtered with limit/offset (lists.ts); same order either way.
  app.get('/api/inventory/reorder', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const page = pagedOr400(q, reply);
    if (page === undefined) return reply;
    return page ? reorderPage(q, page) : reorderAll();
  });

  // Usage view — replaced the manual-tap monthly trends 2026-07-07. The rate
  // comes from count-to-count reconciliation (see recomputeAvgDailyUse), which
  // captures ALL consumption — tracked sales, production use, waste — because
  // two physical counts bracket it. Items with no rate yet (fewer than two
  // counts) are listed so the gap is visible rather than invisible.
  app.get('/api/inventory/usage', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const page = pagedOr400(q, reply);
    if (page === undefined) return reply;
    if (page) return usagePage(q, page);
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
    // Summed per category in SQL (UI foundation) — same math as
    // extendedValueCents: max(on-hand, 0) × average cost, priced items only.
    const perCat = await db.select({
      categoryId: inventoryItems.categoryId,
      valueCents: sql<number>`coalesce(sum(case when ${inventoryItems.avgCostCents} > 0 then max(${inventoryItems.count}, 0) * ${inventoryItems.avgCostCents} end), 0)`,
      priced: sql<number>`sum(${inventoryItems.avgCostCents} > 0)`,
      unpriced: sql<number>`sum(${inventoryItems.avgCostCents} <= 0)`,
    }).from(inventoryItems).where(eq(inventoryItems.active, true)).groupBy(inventoryItems.categoryId);
    const cats = await db.select().from(categories);
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    let totalCents = 0, pricedItems = 0, unpricedItems = 0;
    const byCat = new Map<string, { valueCents: number; items: number }>();
    for (const c of perCat) {
      const v = Number(c.valueCents), n = Number(c.priced);
      unpricedItems += Number(c.unpriced);
      if (n === 0) continue;
      totalCents += v;
      pricedItems += n;
      const key = c.categoryId != null ? catName.get(c.categoryId) ?? 'Other' : 'Other';
      const cur = byCat.get(key) ?? { valueCents: 0, items: 0 };
      byCat.set(key, { valueCents: cur.valueCents + v, items: cur.items + n });
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

  // Dashboard summary: the most urgent low-stock items + the total, in SQL
  // (was a full-table read filtered in JS).
  app.get('/api/dashboard', async () => lowStockSummary());
}
