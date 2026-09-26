// Inventory list reads with filtering / sorting / grouping / paging in SQL (UI
// foundation, ADR 0009) — the old Inventory page's client-side filters, search
// modes, group-by and sorts, one-for-one.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { categories, inventoryAdjustments, inventoryItems, locations, materials, suppliers } from '../../db/schema/index.js';
import { TXN_TYPES } from '../../../shared/domain.js';
import { daysUntilStockout, urgencyCompare } from '../../../shared/reorder.js';
import { likePattern, parseDir, parseSort, type Page, type PageQuery } from '../../lib/paging.js';

type Q = Record<string, unknown>;
const I = inventoryItems;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(n) ? n : null;
};

/** LIKE pattern for `q` by match mode: contains (default), starts, ends, exact. */
function searchPattern(search: string, match: unknown): string {
  const p = likePattern(search);
  if (match === 'starts') return p.slice(1);
  if (match === 'ends') return p.slice(0, -1);
  if (match === 'exact') return p.slice(1, -1);
  return p;
}

/** `ids=1,2,3` → up to 200 ids (an empty list matches nothing); null when absent. */
function idList(v: unknown): number[] | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
}

/** WHERE for the item filters: q (+ match), ids, kind, materialId, color, widthIn, categoryId, supplierId, stock/low. */
export function itemFilters(q: Q): SQL[] {
  const conds: SQL[] = [eq(I.active, true)];
  const search = str(q.q);
  if (search) {
    const p = searchPattern(search, q.match);
    conds.push(or(...[I.name, I.color, I.vendor].map((c) => sql`${c} LIKE ${p} ESCAPE '\\'`))!);
  }
  const ids = idList(q.ids);
  if (ids) conds.push(ids.length ? inArray(I.id, ids) : sql`0`);
  if (q.kind === 'roll') conds.push(isNotNull(I.materialId));
  if (q.kind === 'other') conds.push(isNull(I.materialId));
  const mat = int(q.materialId);
  if (mat != null) conds.push(eq(I.materialId, mat));
  const color = str(q.color);
  if (color) conds.push(sql`lower(${I.color}) = lower(${color})`);
  const width = int(q.widthIn);
  if (width != null) conds.push(eq(I.nominalWidthIn, width));
  if (q.categoryId === 'none') conds.push(isNull(I.categoryId));
  else if (int(q.categoryId) != null) conds.push(eq(I.categoryId, int(q.categoryId)!));
  const sup = int(q.supplierId);
  if (sup != null) conds.push(eq(I.supplierId, sup));
  if (q.low === '1' || q.low === 'true' || q.stock === 'low') conds.push(lte(I.count, I.lowStockThreshold));
  if (q.stock === 'out') conds.push(lte(I.count, 0));
  if (q.stock === 'ok') conds.push(sql`${I.count} > ${I.lowStockThreshold}`);
  return conds;
}

const ITEM_SORTS = ['name', 'count', 'threshold', 'created', 'value', 'size', 'color', 'low'] as const;
export const ITEM_GROUPS = ['material', 'color', 'size', 'unit', 'category'] as const;
export type ItemGroup = typeof ITEM_GROUPS[number];

async function total(where: SQL | undefined): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(I).where(where);
  return Number(r?.n ?? 0);
}

const M = materials;
const C = categories;
const sizeText = sql`nullif(trim(${I.sizeText}), '')`;

/**
 * Group-by (the old Inventory page's Group by): the key + label per row and the
 * ORDER BY that keeps each group contiguous. Rows without the attribute share
 * the null key and sort last ("Other").
 */
function groupSql(g: ItemGroup): { key: SQL; label: SQL; order: SQL[] } {
  switch (g) {
    case 'material': return {
      key: sql`'mat:' || ${M.id}`, label: sql`${M.name}`,
      order: [sql`${M.id} IS NULL`, sql`${M.name} COLLATE NOCASE`, sql`${M.id}`],
    };
    case 'color': return {
      key: sql`'color:' || lower(${I.color})`, label: sql`${I.color}`,
      order: [sql`${I.color} IS NULL`, sql`lower(${I.color})`],
    };
    case 'size': return {
      key: sql`'size:' || coalesce(${sizeText}, ${I.nominalWidthIn} || 'in')`,
      label: sql`coalesce(${sizeText}, ${I.nominalWidthIn} || '″')`,
      // Plain widths numerically first, then free-text sizes alphabetically.
      order: [sql`coalesce(${sizeText}, ${I.nominalWidthIn}) IS NULL`, sql`${sizeText} IS NOT NULL`,
        sql`${I.nominalWidthIn}`, sql`${sizeText} COLLATE NOCASE`],
    };
    case 'unit': return {
      key: sql`'unit:' || lower(nullif(${I.countUnit}, ''))`, label: sql`nullif(${I.countUnit}, '')`,
      order: [sql`nullif(${I.countUnit}, '') IS NULL`, sql`lower(${I.countUnit})`],
    };
    case 'category': return {
      key: sql`'cat:' || ${C.id}`, label: sql`${C.name}`,
      order: [sql`${C.id} IS NULL`, sql`${C.sort}`, sql`${C.name} COLLATE NOCASE`, sql`${C.id}`],
    };
  }
}

export const OTHER_GROUP = { key: 'other', label: 'Other / Consumables' };
export type ItemRow = typeof I.$inferSelect & { groupKey?: string; groupLabel?: string };
export interface GroupCount { key: string; label: string; count: number; low: number }

/**
 * GET /api/inventory?limit=… — one page of active items. With `group=` the rows
 * come ordered by the group first (then the chosen sort) with groupKey/groupLabel
 * on each row, plus `groups` (count + low count per group over the whole filter).
 */
export async function itemPage(q: Q, page: PageQuery): Promise<Page<ItemRow> & { groups?: GroupCount[] }> {
  const where = and(...itemFilters(q));
  const dir = parseDir(q.dir) === 'desc' ? desc : asc;
  const key = parseSort(q.sort, ITEM_SORTS, 'name');
  const name = sql`${I.name} COLLATE NOCASE`;
  const order: SQL[] = {
    name: [dir(name)], count: [dir(I.count)], threshold: [dir(I.lowStockThreshold)],
    created: [dir(I.createdAt)], value: [dir(sql`${I.count} * ${I.avgCostCents}`)],
    size: [sql`${I.nominalWidthIn} IS NULL`, dir(I.nominalWidthIn), sql`${sizeText} COLLATE NOCASE`, asc(name)],
    color: [sql`${I.color} IS NULL`, dir(sql`lower(${I.color})`), asc(name)],
    low: [desc(sql`${I.count} <= ${I.lowStockThreshold}`), asc(name)],
  }[key];
  const group = (ITEM_GROUPS as readonly string[]).includes(q.group as string) ? q.group as ItemGroup : null;
  if (!group) {
    const rows = await db.select().from(I).where(where)
      .orderBy(...order, asc(I.id)).limit(page.limit).offset(page.offset);
    return { rows, total: await total(where), ...page };
  }
  const g = groupSql(group);
  const raw = await db.select({ item: I, groupKey: sql<string | null>`${g.key}`, groupLabel: sql<string | null>`${g.label}` })
    .from(I).leftJoin(M, eq(I.materialId, M.id)).leftJoin(C, eq(I.categoryId, C.id))
    .where(where).orderBy(...g.order, ...order, asc(I.id)).limit(page.limit).offset(page.offset);
  const counts = await db.select({
    key: sql<string | null>`${g.key}`, label: sql<string | null>`min(${g.label})`,
    count: sql<number>`count(*)`, low: sql<number>`sum(${I.count} <= ${I.lowStockThreshold})`,
  }).from(I).leftJoin(M, eq(I.materialId, M.id)).leftJoin(C, eq(I.categoryId, C.id))
    .where(where).groupBy(g.key);
  const rows = raw.map((r) => ({ ...r.item, groupKey: r.groupKey ?? OTHER_GROUP.key, groupLabel: r.groupLabel ?? OTHER_GROUP.label }));
  const groups = counts.map((c) => ({ key: c.key ?? OTHER_GROUP.key, label: c.label ?? OTHER_GROUP.label, count: Number(c.count), low: Number(c.low ?? 0) }));
  return { rows, total: await total(where), ...page, groups };
}

// Needs-ordering urgency (shared/reorder.ts urgencyCompare) as SQL: rows with
// a usage rate first by days-until-stockout, then deepest below Min, then id.
const hasRate = sql`${I.avgDailyUse} > 0`;
const URGENCY = [
  sql`CASE WHEN ${hasRate} THEN 0 ELSE 1 END`,
  sql`CASE WHEN ${hasRate} THEN ${I.count} * 1.0 / ${I.avgDailyUse} END`,
  sql`(${I.lowStockThreshold} - ${I.count}) DESC`,
  asc(I.id),
];

const reorderSelect = () => db.select({ item: I, supplierName: suppliers.name, leadTimeDays: suppliers.leadTimeDays })
  .from(I).leftJoin(suppliers, eq(I.supplierId, suppliers.id));

type ReorderSrc = Awaited<ReturnType<ReturnType<typeof reorderSelect>['where']>>[number];

function reorderRow({ item: i, supplierName, leadTimeDays }: ReorderSrc) {
  return {
    id: i.id, name: i.name, count: i.count, threshold: i.lowStockThreshold,
    reorderMaxQty: i.reorderMaxQty,
    suggestedQty: i.reorderMaxQty != null
      ? Math.max(i.reorderMaxQty - i.count, 1)
      : Math.max(i.lowStockThreshold * 2 - i.count, 1),
    supplierId: i.supplierId, supplierName: supplierName ?? i.vendor ?? null,
    leadTimeDays: i.supplierId != null ? leadTimeDays ?? null : null,
    lastCostCents: i.lastCostCents, purchaseUnit: i.purchaseUnit, countUnit: i.countUnit,
    avgDailyUse: i.avgDailyUse,
    daysUntilStockout: daysUntilStockout(i.count, i.avgDailyUse),
  };
}
export type ReorderRow = ReturnType<typeof reorderRow>;

/** GET /api/inventory/reorder — every item at/below Min, most urgent first. */
export async function reorderAll(): Promise<ReorderRow[]> {
  const rows = await reorderSelect().where(and(eq(I.active, true), lte(I.count, I.lowStockThreshold)));
  return rows.sort((a, b) => urgencyCompare(a.item, b.item)).map(reorderRow);
}

/** GET /api/inventory/reorder?limit=… — same order, paged in SQL (+ item filters). */
export async function reorderPage(q: Q, page: PageQuery): Promise<Page<ReorderRow>> {
  const where = and(...itemFilters(q), lte(I.count, I.lowStockThreshold));
  const rows = await reorderSelect().where(where).orderBy(...URGENCY).limit(page.limit).offset(page.offset);
  return { rows: rows.map(reorderRow), total: await total(where), ...page };
}

function usageRow(i: typeof I.$inferSelect) {
  return {
    id: i.id, name: i.name, count: i.count, countUnit: i.countUnit,
    avgDailyUse: i.avgDailyUse, daysUntilStockout: daysUntilStockout(i.count, i.avgDailyUse),
  };
}

/** GET /api/inventory/usage?limit=… — fastest movers first; items without a rate last. */
export async function usagePage(q: Q, page: PageQuery) {
  const where = and(...itemFilters(q));
  const rows = await db.select().from(I).where(where)
    .orderBy(sql`${I.avgDailyUse} IS NULL`, desc(I.avgDailyUse), asc(I.id))
    .limit(page.limit).offset(page.offset);
  return { rows: rows.map(usageRow), total: await total(where), ...page };
}

/** GET /api/dashboard — the most urgent low-stock items plus the full count, in SQL. */
export async function lowStockSummary(show = 20) {
  const where = and(eq(I.active, true), lte(I.count, I.lowStockThreshold));
  const rows = await db.select({ id: I.id, name: I.name, count: I.count, threshold: I.lowStockThreshold })
    .from(I).where(where).orderBy(...URGENCY).limit(show);
  return { lowStock: rows, lowStockCount: await total(where) };
}

const A = inventoryAdjustments;
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * GET /api/inventory/transactions — the ledger across items, newest first,
 * keyset-paged on id (?before=<id>&limit=<n ≤ 200>, default 50). Filters:
 * type (txn type), itemId, from / to (yyyy-mm-dd, inclusive, UTC dates).
 */
export async function transactionPage(q: Q) {
  const limit = Math.min(Math.max(int(q.limit) ?? 50, 1), 200);
  const conds: SQL[] = [];
  const before = int(q.before);
  if (before != null) conds.push(lt(A.id, before));
  const type = str(q.type);
  if (type && (TXN_TYPES as readonly string[]).includes(type)) conds.push(eq(A.txnType, type));
  const item = int(q.itemId);
  if (item != null) conds.push(eq(A.itemId, item));
  const from = day(q.from), to = day(q.to);
  if (from) conds.push(gte(A.createdAt, from));
  if (to) conds.push(sql`${A.createdAt} < date(${to}, '+1 day')`);
  const rows = await db.select({
    id: A.id, itemId: A.itemId, itemName: I.name, delta: A.delta, txnType: A.txnType, reason: A.reason,
    note: A.note, createdBy: A.createdBy, createdAt: A.createdAt, locationId: A.locationId,
    locationName: locations.name, unitCostCents: A.unitCostCents, countUnit: I.countUnit,
    sourceType: A.sourceType, sourceId: A.sourceId,
  }).from(A).innerJoin(I, eq(A.itemId, I.id)).leftJoin(locations, eq(A.locationId, locations.id))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(A.id)).limit(limit);
  return { rows, nextBefore: rows.length === limit ? rows[rows.length - 1].id : null };
}
