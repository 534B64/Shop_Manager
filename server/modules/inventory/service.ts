// Inventory service — the perpetual ledger (Phase 2, ADR 0006) plus the
// pieces other modules are allowed to call (via index.ts) and the
// avg-daily-usage recompute the count workflow uses.
//
// postTransaction() is the ONLY way on-hand changes. It appends one row to
// the ledger (inventory_adjustments); the database trigger applies the delta
// to inventory_balances and the inventory_items.count cache, and guard
// triggers reject any other write to either. Everything here takes an
// optional `dbx` so it runs inside the caller's withTx transaction.
import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { db, type Db } from '../../db/index.js';
import {
  inventoryItems, inventoryAdjustments, inventoryBalances, locations, cycleCounts, cycleCountLines,
} from '../../db/schema/index.js';
import { getSetting } from '../settings/index.js';
import { avgDailyUse } from '../../../shared/reorder.js';
import { averageAfterReceipt, countUnitCost } from '../../../shared/costing.js';
import {
  TXN_TYPES_NEEDING_REASON, ADJUST_REASONS, txnTypeForReason, type TxnType, type AdjustReason,
} from '../../../shared/domain.js';
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

/** "Shop" — seeded by migration 0015; every pre-Phase-2 count lives here, and
 *  it's where postings go when no location is given. */
export const DEFAULT_LOCATION_ID = 1;

/** A refused inventory write; routes map `status` straight to the reply. */
export class InventoryError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

type Item = typeof inventoryItems.$inferSelect;
type Txn = typeof inventoryAdjustments.$inferSelect;
export interface TxnUser { id: number | null; name: string | null }
export interface TxnSource { type: string; id?: string | number | null }

export interface PostTransactionInput {
  itemId: number;
  locationId?: number;
  type: TxnType;
  /** Signed quantity in COUNT units (non-zero integer). */
  qty: number;
  /** Required (a real reason code) for adjustment / count / production. */
  reason?: string | null;
  note?: string | null;
  /** Receipts only: cost per PURCHASE unit as entered (converted by the UOM
   *  factor, moves the average, becomes the item's last cost). */
  purchaseUnitCostCents?: number | null;
  supplierId?: number | null;
  source: TxnSource;
  user?: TxnUser | null;
  cycleCountId?: number | null;
  /** Skip the "location would go below zero" refusal (nothing uses it yet). */
  allowNegative?: boolean;
}

const DEFAULT_REASON: Partial<Record<TxnType, string>> = {
  receipt: 'received', sale: 'sold', return: 'returned',
  transfer_out: 'transfer', transfer_in: 'transfer', opening: 'opening balance',
};

async function locationOnHand(itemId: number, locationId: number, dbx: Db): Promise<number> {
  const [b] = await dbx.select({ onHand: inventoryBalances.onHand }).from(inventoryBalances)
    .where(and(eq(inventoryBalances.itemId, itemId), eq(inventoryBalances.locationId, locationId)));
  return b?.onHand ?? 0;
}

/**
 * The single write path for on-hand. Appends one ledger row (the DB trigger
 * applies it to the balance + item count), stamps it with a cost per count
 * unit — the receipt's cost on receipts, the item's current average cost on
 * everything else — and, for a costed receipt, moves the moving average.
 * Refuses (InventoryError) a missing reason where one is required, an unknown
 * item/location, or a withdrawal that would take a location below zero.
 */
export async function postTransaction(
  input: PostTransactionInput, dbx: Db = db,
): Promise<{ txn: Txn; item: Item; before: Item }> {
  const { itemId, type, qty } = input;
  if (!Number.isInteger(qty) || qty === 0) throw new InventoryError(400, 'Quantity must be a non-zero whole number of count units');
  const reason = input.reason?.trim() || null;
  if (TXN_TYPES_NEEDING_REASON.includes(type) && !reason) {
    throw new InventoryError(400, `A reason code is required for ${type} transactions`);
  }
  const [item] = await dbx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!item) throw new InventoryError(404, 'Item not found');
  const locationId = input.locationId ?? DEFAULT_LOCATION_ID;
  const [loc] = await dbx.select().from(locations).where(eq(locations.id, locationId));
  if (!loc) throw new InventoryError(404, 'Location not found');
  if (loc.archivedAt) throw new InventoryError(409, `${loc.name} is archived`);
  if (qty < 0 && !input.allowNegative) {
    const have = await locationOnHand(itemId, locationId, dbx);
    if (have + qty < 0) throw new InventoryError(409, `Count cannot go below zero (have ${have} at ${loc.name})`);
  }

  let unitCostCents = item.avgCostCents;
  let newAvg: number | null = null;
  if (type === 'receipt' && input.purchaseUnitCostCents != null) {
    const each = countUnitCost(input.purchaseUnitCostCents, item.purchaseToCountFactor);
    unitCostCents = Math.round(each);
    newAvg = averageAfterReceipt({ onHand: item.count, avgCostCents: item.avgCostCents, qty, unitCostCents: each });
  }

  const [txn] = await dbx.insert(inventoryAdjustments).values({
    itemId, delta: qty, txnType: type, locationId,
    reason: reason ?? DEFAULT_REASON[type] ?? type,
    note: input.note ?? null,
    createdBy: input.user?.name ?? null, userId: input.user?.id ?? null,
    unitCostCents,
    purchaseUnitCostCents: type === 'receipt' ? input.purchaseUnitCostCents ?? null : null,
    supplierId: type === 'receipt' ? input.supplierId ?? null : null,
    sourceType: input.source.type,
    sourceId: input.source.id != null ? String(input.source.id) : null,
    cycleCountId: input.cycleCountId ?? null,
  }).returning();
  if (newAvg != null) {
    await dbx.update(inventoryItems)
      .set({ avgCostCents: newAvg, lastCostCents: input.purchaseUnitCostCents })
      .where(eq(inventoryItems.id, itemId));
  }
  const [after] = await dbx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  return { txn, item: after, before: item };
}

/** Receiving: `qty` in COUNT units; cost is per PURCHASE unit as entered. */
export function receive(opts: {
  itemId: number; qty: number; purchaseUnitCostCents?: number | null; supplierId?: number | null;
  locationId?: number; note?: string | null; user?: TxnUser | null;
}, dbx: Db = db) {
  return postTransaction({ ...opts, type: 'receipt', source: { type: 'receipt' } }, dbx);
}

/** A manual quantity change with a reason code; the type follows the reason
 *  (used/production_use → production, sold → sale, else adjustment). */
export function adjust(opts: {
  itemId: number; qty: number; reason: AdjustReason; locationId?: number;
  note?: string | null; user?: TxnUser | null;
}, dbx: Db = db) {
  if (!(ADJUST_REASONS as readonly string[]).includes(opts.reason)) throw new InventoryError(400, 'Unknown reason code');
  if (opts.reason === 'received') throw new InventoryError(400, 'Use receive() for receipts');
  return postTransaction({ ...opts, type: txnTypeForReason(opts.reason), source: { type: 'manual' } }, dbx);
}

/** Move stock between locations: two rows (out, in) sharing one source id.
 *  Item total is unchanged; the out side refuses to go below zero. */
export async function transfer(opts: {
  itemId: number; fromLocationId: number; toLocationId: number; qty: number;
  note?: string | null; user?: TxnUser | null;
}, dbx: Db = db) {
  if (!Number.isInteger(opts.qty) || opts.qty <= 0) throw new InventoryError(400, 'Transfer quantity must be a positive whole number');
  if (opts.fromLocationId === opts.toLocationId) throw new InventoryError(400, 'Pick two different locations');
  const source = { type: 'transfer', id: randomUUID() };
  const base = { itemId: opts.itemId, note: opts.note ?? null, user: opts.user ?? null, source };
  const out = await postTransaction({ ...base, type: 'transfer_out', qty: -opts.qty, locationId: opts.fromLocationId }, dbx);
  const inn = await postTransaction({ ...base, type: 'transfer_in', qty: opts.qty, locationId: opts.toLocationId }, dbx);
  return { transferId: source.id, out: out.txn, in: inn.txn, item: inn.item };
}

/**
 * Counter-sale deduction (called by payments' POST /api/pos/sale). A sale must
 * NEVER be blocked by inventory — money beats count accuracy, and the weekly
 * cycle count reconciles whatever this couldn't. Deducts up to what's on hand
 * at the location (clamped at zero, shortfall noted in the ledger row).
 * Idempotent per job + item: a second call for the same job books nothing.
 * Pass the caller's transaction so the deduction commits or rolls back with
 * the sale (ADR 0005) — "never blocked" is about stock levels; a real DB
 * error fails the whole sale and the client's idempotent retry redoes it.
 */
export async function recordSale(opts: {
  itemId: number; qty: number; title: string; jobId: number; createdBy?: string | null;
  userId?: number | null; locationId?: number;
}, dbx: Db = db): Promise<{ applied: number; adjustmentId: number | null; countBefore: number | null }> {
  const [item] = await dbx.select().from(inventoryItems).where(eq(inventoryItems.id, opts.itemId));
  if (!item || !item.active) return { applied: 0, adjustmentId: null, countBefore: null };
  const [already] = await dbx.select({ id: inventoryAdjustments.id }).from(inventoryAdjustments).where(and(
    eq(inventoryAdjustments.itemId, item.id), eq(inventoryAdjustments.txnType, 'sale'),
    eq(inventoryAdjustments.sourceType, 'job'), eq(inventoryAdjustments.sourceId, String(opts.jobId))));
  if (already) return { applied: 0, adjustmentId: null, countBefore: item.count };
  const locationId = opts.locationId ?? DEFAULT_LOCATION_ID;
  const have = await locationOnHand(item.id, locationId, dbx);
  const applied = Math.min(Math.max(opts.qty, 0), have);
  if (applied <= 0) return { applied: 0, adjustmentId: null, countBefore: item.count };
  const short = opts.qty - applied;
  const { txn } = await postTransaction({
    itemId: item.id, locationId, type: 'sale', qty: -applied,
    note: `Counter sale — ${opts.title} (job #${opts.jobId})${short > 0 ? ` — sale of ${opts.qty}, only ${applied} were on hand` : ''}`,
    source: { type: 'job', id: opts.jobId },
    user: { id: opts.userId ?? null, name: opts.createdBy ?? null },
  }, dbx);
  return { applied, adjustmentId: txn.id, countBefore: item.count };
}

/** A customer return back onto the shelf at the current average cost
 *  (for Phase 3 — nothing calls it yet). */
export function recordReturn(opts: {
  itemId: number; qty: number; source: TxnSource; locationId?: number;
  note?: string | null; user?: TxnUser | null;
}, dbx: Db = db) {
  if (!Number.isInteger(opts.qty) || opts.qty <= 0) throw new InventoryError(400, 'Return quantity must be a positive whole number');
  return postTransaction({ ...opts, type: 'return', qty: opts.qty }, dbx);
}

/** Production consumption as a TYPE only — there is deliberately no
 *  production workflow or screen (the weekly cycle count reconciles
 *  untracked use). Available for a future caller; nothing calls it now. */
export function recordProduction(opts: {
  itemId: number; qty: number; reason?: string; source: TxnSource; locationId?: number;
  note?: string | null; user?: TxnUser | null;
}, dbx: Db = db) {
  if (!Number.isInteger(opts.qty) || opts.qty <= 0) throw new InventoryError(400, 'Production quantity must be a positive whole number');
  return postTransaction({ ...opts, type: 'production', qty: -opts.qty, reason: opts.reason ?? 'production_use' }, dbx);
}

/** Items / balances whose cache disagrees with the ledger — should always be
 *  empty (the triggers make it so). Pure SQL aggregation, nothing loaded
 *  into JS beyond the mismatches. */
export async function reconcile(dbx: Db = db) {
  const items = await dbx.all<{ itemId: number; name: string; count: number; ledger: number; balances: number }>(sql`
    SELECT i.id AS itemId, i.name AS name, i.count AS count,
      coalesce(l.s, 0) AS ledger, coalesce(b.s, 0) AS balances
    FROM inventory_items i
    LEFT JOIN (SELECT item_id, sum(delta) AS s FROM inventory_adjustments GROUP BY item_id) l ON l.item_id = i.id
    LEFT JOIN (SELECT item_id, sum(on_hand) AS s FROM inventory_balances GROUP BY item_id) b ON b.item_id = i.id
    WHERE i.count <> coalesce(l.s, 0) OR i.count <> coalesce(b.s, 0)`);
  const balances = await dbx.all<{ itemId: number; locationId: number; onHand: number; ledger: number }>(sql`
    SELECT k.item_id AS itemId, k.location_id AS locationId,
      coalesce(b.on_hand, 0) AS onHand, coalesce(l.s, 0) AS ledger
    FROM (SELECT item_id, location_id FROM inventory_balances
          UNION SELECT DISTINCT item_id, location_id FROM inventory_adjustments) k
    LEFT JOIN inventory_balances b ON b.item_id = k.item_id AND b.location_id = k.location_id
    LEFT JOIN (SELECT item_id, location_id, sum(delta) AS s FROM inventory_adjustments
               GROUP BY item_id, location_id) l ON l.item_id = k.item_id AND l.location_id = k.location_id
    WHERE coalesce(b.on_hand, 0) <> coalesce(l.s, 0)`);
  return { ok: items.length === 0 && balances.length === 0, items, balances };
}

/** Where-clause for count lines that actually count: the posted round of a
 *  posted session (a sent-back round's lines stay in the table, append-only). */
export const postedLine = sql`exists (select 1 from ${cycleCounts} cc
  where cc.id = ${cycleCountLines.cycleCountId} and cc.status = 'posted'
    and cc.submission = ${cycleCountLines.submission})`;

/**
 * Recompute an item's rolling average daily usage after a count session posts.
 * Baseline = the earliest prior posted count line within the last 28 days
 * (or, when none is that recent, the most recent older one), because two
 * physical counts are the only ground truth: usage = baseline + inflows since
 * − counted now, measured up to `asOfMs` (when the count was taken/submitted).
 * Inflows = positive ledger rows that are real stock arriving — not count
 * postings, opening balances, or transfers between locations. Returns the
 * stored rate, or null when there's no prior count to measure from.
 */
export async function recomputeAvgDailyUse(
  itemId: number, countedNow: number, currentCycleCountId: number, asOfMs: number, dbx: Db = db,
): Promise<number | null> {
  const priorLines = await dbx.select().from(cycleCountLines)
    .where(and(eq(cycleCountLines.itemId, itemId), ne(cycleCountLines.cycleCountId, currentCycleCountId), postedLine))
    .orderBy(cycleCountLines.createdAt);
  if (priorLines.length === 0) return null;
  const cutoffIso = new Date(asOfMs - 28 * 86400000).toISOString();
  const recent = priorLines.filter((l) => l.createdAt >= cutoffIso);
  const baseline = recent[0] ?? priorLines[priorLines.length - 1];

  const [{ inflows }] = await dbx.select({
    inflows: sql<number>`coalesce(sum(case when ${inventoryAdjustments.delta} > 0 then ${inventoryAdjustments.delta} else 0 end), 0)`,
  }).from(inventoryAdjustments).where(and(
    eq(inventoryAdjustments.itemId, itemId),
    gt(inventoryAdjustments.createdAt, baseline.createdAt),
    lte(inventoryAdjustments.createdAt, new Date(asOfMs).toISOString()),
    isNull(inventoryAdjustments.cycleCountId),
    ne(inventoryAdjustments.reason, 'cycle_count'),
    notInArray(inventoryAdjustments.txnType, ['count', 'opening', 'transfer_in', 'transfer_out']),
  ));

  const days = (asOfMs - Date.parse(baseline.createdAt)) / 86400000;
  const rate = avgDailyUse({
    baselineCounted: baseline.countedQty, inflowsSince: inflows, newCounted: countedNow, days,
  });
  if (rate == null) return null;
  const rounded = Math.round(rate * 100) / 100;
  await dbx.update(inventoryItems).set({ avgDailyUse: rounded }).where(eq(inventoryItems.id, itemId));
  return rounded;
}

/** Items by id (only the ones asked for). */
export async function itemsById(ids: number[], dbx: Db = db): Promise<Map<number, Item>> {
  if (ids.length === 0) return new Map();
  const rows = await dbx.select().from(inventoryItems).where(inArray(inventoryItems.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}
