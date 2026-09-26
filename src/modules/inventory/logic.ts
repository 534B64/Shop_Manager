// Pure helpers for the inventory pages (tested in logic.test.ts).
import { ApiError } from '../../lib/api';
import type { Params } from '../../lib/query';
import { ADJUST_REASON_LABELS, TXN_TYPE_LABELS, type AdjustReason, type TxnType } from '../../../shared/domain';
import type { InventoryItem } from '../../lib/types';

export type StockStatus = 'ok' | 'low' | 'out';

/** Out at zero (or below), low at/below Min, else in stock — same rule as the server's stock filter. */
export function stockStatus(count: number, min: number): StockStatus {
  if (count <= 0) return 'out';
  return count <= min ? 'low' : 'ok';
}

export const factorOf = (i: Pick<InventoryItem, 'purchaseToCountFactor'>) =>
  (i.purchaseToCountFactor && i.purchaseToCountFactor > 0 ? i.purchaseToCountFactor : 1);

/** Cost per count unit: moving average, else last cost ÷ factor (the server's snapshot rule). */
export function costPerCountUnit(i: Pick<InventoryItem, 'avgCostCents' | 'lastCostCents' | 'purchaseToCountFactor'>): number | null {
  if (i.avgCostCents) return i.avgCostCents;
  return i.lastCostCents == null ? null : Math.round(i.lastCostCents / factorOf(i));
}

/** A whole number ≥ 0 typed by a person, else null. */
export function parseWhole(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Signed whole number ("-2", "+3", "3"); null when blank, zero, or not whole. */
export function parseDelta(text: string): number | null {
  const t = text.trim().replace(/^\+/, '');
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return n === 0 ? null : n;
}

/** Purchase-unit quantity × factor → count units (rounded), null when not a positive amount. */
export function receiptCountUnits(qtyText: string, factor: number): number | null {
  const q = Number(qtyText.trim());
  if (!qtyText.trim() || !Number.isFinite(q) || q <= 0) return null;
  const n = Math.round(q * factor);
  return n > 0 ? n : null;
}

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
export const reasonLabel = (code: string) => ADJUST_REASON_LABELS[code as AdjustReason] ?? code.replace(/_/g, ' ');
export const txnLabel = (t: string) => TXN_TYPE_LABELS[t as TxnType] ?? t;

/** Reasons a person can pick for a manual adjustment (receiving, sales and counts have their own screens). */
export const MANUAL_REASONS: AdjustReason[] = ['used', 'damaged', 'correction', 'production_use', 'waste_scrap', 'theft_loss', 'receiving_error', 'other'];
/** These need a note saying what happened. */
export const noteRequired = (reason: string) => reason === 'correction' || reason === 'other' || reason === 'theft_loss';

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const m = e.data.message ?? e.data.error;
    return typeof m === 'string' ? m : e.message;
  }
  if (e instanceof Error) return e.message === 'Failed to fetch' ? 'Can’t reach the server — check the wifi and try again.' : e.message;
  return 'Something went wrong';
}

// ---- Item list URL state (filters, sort, page live in the search params) ----

export type Match = 'contains' | 'starts' | 'ends' | 'exact';
export const SORTS = [
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'count:asc', label: 'On hand, lowest first' },
  { value: 'count:desc', label: 'On hand, highest first' },
  { value: 'threshold:desc', label: 'Min, highest first' },
  { value: 'value:desc', label: 'Value, highest first' },
  { value: 'created:desc', label: 'Newest first' },
] as const;

export interface ListState {
  q: string; match: Match; kind: '' | 'roll' | 'other'; stock: '' | StockStatus;
  categoryId: string; supplierId: string; materialId: string; color: string; widthIn: string;
  sort: string; page: number;
}

const FILTER_KEYS = ['q', 'match', 'kind', 'stock', 'categoryId', 'supplierId', 'materialId', 'color', 'widthIn', 'sort'] as const;
const pick = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
  (v != null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);

export function readListState(sp: URLSearchParams): ListState {
  const page = Number(sp.get('page'));
  return {
    q: sp.get('q') ?? '',
    match: pick(sp.get('match'), ['contains', 'starts', 'ends', 'exact'], 'contains'),
    kind: pick(sp.get('kind'), ['', 'roll', 'other'], ''),
    stock: pick(sp.get('stock'), ['', 'ok', 'low', 'out'], ''),
    categoryId: sp.get('categoryId') ?? '',
    supplierId: sp.get('supplierId') ?? '',
    materialId: sp.get('materialId') ?? '',
    color: sp.get('color') ?? '',
    widthIn: sp.get('widthIn') ?? '',
    sort: pick(sp.get('sort'), SORTS.map((s) => s.value), 'name:asc'),
    page: Number.isInteger(page) && page > 1 ? page - 1 : 0,
  };
}

/** New search params with `patch` applied. Changing any filter goes back to page 1 (page is 1-based in the URL). */
export function writeListState(sp: URLSearchParams, patch: Partial<ListState>): URLSearchParams {
  const next = new URLSearchParams(sp);
  for (const k of FILTER_KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k] as string;
    const isDefault = v === '' || (k === 'match' && v === 'contains') || (k === 'sort' && v === 'name:asc');
    if (isDefault) next.delete(k); else next.set(k, v);
  }
  if (patch.page !== undefined) {
    if (patch.page > 0) next.set('page', String(patch.page + 1)); else next.delete('page');
  } else if (FILTER_KEYS.some((k) => k in patch)) next.delete('page');
  return next;
}

/** Query params for GET /api/inventory from the URL state (paging added by usePaged). */
export function listApiParams(s: ListState): Params {
  const [sort, dir] = s.sort.split(':');
  return {
    q: s.q.trim(), match: s.q.trim() && s.match !== 'contains' ? s.match : '',
    kind: s.kind, stock: s.stock, categoryId: s.categoryId, supplierId: s.supplierId,
    materialId: s.materialId, color: s.color, widthIn: s.widthIn, sort, dir,
  };
}

/** How many of the "more filters" (dialog) are set — for the Filters button badge. */
export const moreFilterCount = (s: ListState) =>
  [s.categoryId, s.supplierId, s.materialId, s.color, s.widthIn].filter(Boolean).length + (s.match !== 'contains' ? 1 : 0);
