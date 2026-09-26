// Inventory list reads with filtering / sorting / paging in SQL (UI foundation,
// ADR 0009). The filters mirror shared/inventoryView.ts so the Inventory page
// can move its client-side filters to the server one-for-one.
import { and, asc, desc, eq, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { inventoryItems, suppliers } from '../../db/schema/index.js';
import { daysUntilStockout, urgencyCompare } from '../../../shared/reorder.js';
import { likePattern, parseDir, parseSort, type Page, type PageQuery } from '../../lib/paging.js';

type Q = Record<string, unknown>;
const I = inventoryItems;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(n) ? n : null;
};

/** WHERE for the item filters: q, kind, materialId, color, widthIn, categoryId, supplierId, stock/low. */
export function itemFilters(q: Q): SQL[] {
  const conds: SQL[] = [eq(I.active, true)];
  const search = str(q.q);
  if (search) {
    const p = likePattern(search);
    conds.push(or(...[I.name, I.color, I.vendor].map((c) => sql`${c} LIKE ${p} ESCAPE '\\'`))!);
  }
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

const ITEM_SORTS = ['name', 'count', 'threshold', 'created', 'value'] as const;

async function total(where: SQL | undefined): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(I).where(where);
  return Number(r?.n ?? 0);
}

/** GET /api/inventory?limit=… — one page of active items. */
export async function itemPage(q: Q, page: PageQuery): Promise<Page<typeof I.$inferSelect>> {
  const where = and(...itemFilters(q));
  const dir = parseDir(q.dir) === 'desc' ? desc : asc;
  const key = parseSort(q.sort, ITEM_SORTS, 'name');
  const col = {
    name: sql`${I.name} COLLATE NOCASE`, count: I.count, threshold: I.lowStockThreshold,
    created: I.createdAt, value: sql`${I.count} * ${I.avgCostCents}`,
  }[key];
  const rows = await db.select().from(I).where(where)
    .orderBy(dir(col), asc(I.id)).limit(page.limit).offset(page.offset);
  return { rows, total: await total(where), ...page };
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
