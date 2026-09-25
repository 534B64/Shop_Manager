// Inventory service — the pieces other modules are allowed to call (via
// index.ts) plus the avg-daily-usage recompute the count workflow uses.
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { db, type Db } from '../../db/index.js';
import { inventoryItems, inventoryAdjustments, cycleCountLines } from '../../db/schema/index.js';
import { getSetting } from '../settings/index.js';
import { avgDailyUse } from '../../../shared/reorder.js';
import {
  DEFAULT_VARIANCE_THRESHOLDS, type VarianceThresholds,
} from '../../../shared/countReview.js';

export interface InventorySettings extends VarianceThresholds {
  reorderBufferDays: number;
}

export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  ...DEFAULT_VARIANCE_THRESHOLDS,
  reorderBufferDays: 3,
};

export async function inventorySettings(dbx: Db = db): Promise<InventorySettings> {
  const raw = await getSetting('inventorySettings', dbx);
  if (!raw) return { ...DEFAULT_INVENTORY_SETTINGS };
  try { return { ...DEFAULT_INVENTORY_SETTINGS, ...JSON.parse(raw) }; }
  catch { return { ...DEFAULT_INVENTORY_SETTINGS }; }
}

/**
 * Counter-sale deduction (called by payments' POST /api/pos/sale). A sale must
 * NEVER be blocked by inventory — money beats count accuracy, and the weekly
 * cycle count reconciles whatever this couldn't. Deducts up to what's on hand
 * (clamped at zero, shortfall noted in the ledger row). Pass the caller's
 * transaction so the deduction commits or rolls back with the sale (ADR 0005)
 * — "never blocked" is about stock levels; a real DB error fails the whole
 * sale and the client's idempotent retry redoes it.
 */
export async function recordSale(opts: {
  itemId: number; qty: number; title: string; jobId: number; createdBy?: string | null;
}, dbx: Db = db): Promise<{ applied: number; adjustmentId: number | null; countBefore: number | null }> {
  const [item] = await dbx.select().from(inventoryItems).where(eq(inventoryItems.id, opts.itemId));
  if (!item || !item.active) return { applied: 0, adjustmentId: null, countBefore: null };
  const applied = Math.min(Math.max(opts.qty, 0), item.count);
  if (applied <= 0) return { applied: 0, adjustmentId: null, countBefore: item.count };
  const short = opts.qty - applied;
  const [adj] = await dbx.insert(inventoryAdjustments).values({
    itemId: item.id, delta: -applied, reason: 'sold',
    note: `Counter sale — ${opts.title} (job #${opts.jobId})${short > 0 ? ` — sale of ${opts.qty}, only ${applied} were on hand` : ''}`,
    createdBy: opts.createdBy ?? null,
  }).returning({ id: inventoryAdjustments.id });
  await dbx.update(inventoryItems).set({ count: item.count - applied }).where(eq(inventoryItems.id, item.id));
  return { applied, adjustmentId: adj.id, countBefore: item.count };
}

/**
 * Recompute an item's rolling average daily usage after a count session closes.
 * Baseline = the earliest prior count line within the last 28 days (or, when
 * none is that recent, the most recent older one), because two physical counts
 * are the only ground truth: usage = baseline + receipts since − counted now.
 * Receipts = positive adjustments that are NOT count-session reconciliations
 * (cycleCountId set) and not legacy 'cycle_count' rows. Returns the stored
 * rate, or null when there's no prior count to measure from.
 */
export async function recomputeAvgDailyUse(
  itemId: number, countedNow: number, currentCycleCountId: number, nowMs: number, dbx: Db = db,
): Promise<number | null> {
  const priorLines = await dbx.select().from(cycleCountLines)
    .where(and(eq(cycleCountLines.itemId, itemId), ne(cycleCountLines.cycleCountId, currentCycleCountId)))
    .orderBy(cycleCountLines.createdAt);
  if (priorLines.length === 0) return null;
  const cutoffIso = new Date(nowMs - 28 * 86400000).toISOString();
  const recent = priorLines.filter((l) => l.createdAt >= cutoffIso);
  const baseline = recent[0] ?? priorLines[priorLines.length - 1];

  const [{ inflows }] = await dbx.select({
    inflows: sql<number>`coalesce(sum(case when ${inventoryAdjustments.delta} > 0 then ${inventoryAdjustments.delta} else 0 end), 0)`,
  }).from(inventoryAdjustments).where(and(
    eq(inventoryAdjustments.itemId, itemId),
    gt(inventoryAdjustments.createdAt, baseline.createdAt),
    isNull(inventoryAdjustments.cycleCountId),
    ne(inventoryAdjustments.reason, 'cycle_count'),
  ));

  const days = (nowMs - Date.parse(baseline.createdAt)) / 86400000;
  const rate = avgDailyUse({
    baselineCounted: baseline.countedQty, inflowsSince: inflows, newCounted: countedNow, days,
  });
  if (rate == null) return null;
  const rounded = Math.round(rate * 100) / 100;
  await dbx.update(inventoryItems).set({ avgDailyUse: rounded }).where(eq(inventoryItems.id, itemId));
  return rounded;
}
