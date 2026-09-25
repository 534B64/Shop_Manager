// Inventory service — the pieces other modules are allowed to call (via
// index.ts) plus the avg-daily-usage recompute the count workflow uses.
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
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

export async function inventorySettings(): Promise<InventorySettings> {
  const raw = await getSetting('inventorySettings');
  if (!raw) return { ...DEFAULT_INVENTORY_SETTINGS };
  try { return { ...DEFAULT_INVENTORY_SETTINGS, ...JSON.parse(raw) }; }
  catch { return { ...DEFAULT_INVENTORY_SETTINGS }; }
}

/**
 * Counter-sale deduction (called by payments' POST /api/pos/sale). A sale must
 * NEVER be blocked by inventory — money beats count accuracy, and the weekly
 * cycle count reconciles whatever this couldn't. Deducts up to what's on hand
 * (clamped at zero, shortfall noted in the ledger row).
 */
export async function recordSale(opts: {
  itemId: number; qty: number; title: string; jobId: number; createdBy?: string | null;
}): Promise<{ applied: number }> {
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, opts.itemId));
  if (!item || !item.active) return { applied: 0 };
  const applied = Math.min(Math.max(opts.qty, 0), item.count);
  if (applied <= 0) return { applied: 0 };
  const short = opts.qty - applied;
  await db.insert(inventoryAdjustments).values({
    itemId: item.id, delta: -applied, reason: 'sold',
    note: `Counter sale — ${opts.title} (job #${opts.jobId})${short > 0 ? ` — sale of ${opts.qty}, only ${applied} were on hand` : ''}`,
    createdBy: opts.createdBy ?? null,
  });
  await db.update(inventoryItems).set({ count: item.count - applied }).where(eq(inventoryItems.id, item.id));
  return { applied };
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
  itemId: number, countedNow: number, currentCycleCountId: number, nowMs: number,
): Promise<number | null> {
  const priorLines = await db.select().from(cycleCountLines)
    .where(and(eq(cycleCountLines.itemId, itemId), ne(cycleCountLines.cycleCountId, currentCycleCountId)))
    .orderBy(cycleCountLines.createdAt);
  if (priorLines.length === 0) return null;
  const cutoffIso = new Date(nowMs - 28 * 86400000).toISOString();
  const recent = priorLines.filter((l) => l.createdAt >= cutoffIso);
  const baseline = recent[0] ?? priorLines[priorLines.length - 1];

  const [{ inflows }] = await db.select({
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
  await db.update(inventoryItems).set({ avgDailyUse: rounded }).where(eq(inventoryItems.id, itemId));
  return rounded;
}
