// Inventory organization + search/filter view-model (Phase 10, Slice 1).
//
// Pure presentation logic: given the flat inventory list and the current
// filter/search/group/sort controls, produce the grouped, ordered view the
// page renders. No React/DOM/server imports — this mirrors shared/stockCheck.ts
// so it can be unit-tested without touching the app.
//
// Pipeline order is fixed: filter -> search -> group -> sort-within-group ->
// order-groups. Filtering and search both narrow the flat list before
// anything is grouped, so group counts/labels only ever reflect what's shown.

export interface InvViewItem {
  id: number;
  name: string;
  count: number;
  lowStockThreshold: number;
  vendor: string | null;
  color: string | null;
  nominalWidthIn: number | null;
  materialId: number | null;
  materialName: string | null;
  unit: string | null;
  // Phase 10, Slice 2 — smart categories. ORTHOGONAL to the roll-SKU fields
  // above: a category is a new organizational layer on every inventory item
  // (roll SKUs included) and has no effect on the stock-check/estimator.
  categoryId: number | null;
  categoryName: string | null;
}

export type SearchOp = 'contains' | 'starts_with' | 'ends_with' | 'equals';
export type GroupBy = 'material' | 'color' | 'size' | 'unit' | 'category';
export type SortBy = 'name' | 'size' | 'color' | 'count' | 'low_first';

export interface InvViewQuery {
  search: string;
  op: SearchOp;
  kind: 'all' | 'roll' | 'other';
  materialId: number | null;
  color: string | null;
  widthIn: number | null;
  lowOnly: boolean;
  groupBy: GroupBy;
  sortBy: SortBy;
  categoryId: number | null;
}

export interface InvGroup {
  key: string;
  label: string;
  items: InvViewItem[];
  count: number;
  lowCount: number;
}

export interface InvView {
  groups: InvGroup[];
  totalShown: number;
}

/** The catch-all bucket for items that don't have the grouped attribute set. */
const OTHER_KEY = 'other';
const OTHER_LABEL = 'Other / Consumables';

/**
 * Search applies to name + color + vendor COMBINED (one box, one operator) —
 * an item matches if ANY of those three fields matches. Empty/whitespace
 * search always matches (no filter applied). Comparison is case-insensitive
 * and trimmed; null fields are skipped rather than treated as a match.
 */
export function matchesSearch(item: InvViewItem, search: string, op: SearchOp): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;

  const fields = [item.name, item.color, item.vendor].filter((v): v is string => v != null);

  return fields.some((raw) => {
    const hay = raw.toLowerCase();
    switch (op) {
      case 'contains': return hay.includes(needle);
      case 'starts_with': return hay.startsWith(needle);
      case 'ends_with': return hay.endsWith(needle);
      case 'equals': return hay === needle;
      default: return false;
    }
  });
}

function passesFilters(item: InvViewItem, q: InvViewQuery): boolean {
  if (q.kind === 'roll' && item.materialId == null) return false;
  if (q.kind === 'other' && item.materialId != null) return false;
  if (q.materialId != null && item.materialId !== q.materialId) return false;
  if (q.color != null && (item.color ?? '').toLowerCase() !== q.color.toLowerCase()) return false;
  if (q.widthIn != null && item.nominalWidthIn !== q.widthIn) return false;
  if (q.lowOnly && !(item.count <= item.lowStockThreshold)) return false;
  if (q.categoryId != null && item.categoryId !== q.categoryId) return false;
  return true;
}

function groupKeyLabel(item: InvViewItem, groupBy: GroupBy): { key: string; label: string } {
  switch (groupBy) {
    case 'material':
      if (item.materialId == null || item.materialName == null) return { key: OTHER_KEY, label: OTHER_LABEL };
      return { key: `mat:${item.materialId}`, label: item.materialName };
    case 'color':
      if (item.color == null) return { key: OTHER_KEY, label: OTHER_LABEL };
      return { key: `color:${item.color}`, label: item.color };
    case 'size':
      if (item.nominalWidthIn == null) return { key: OTHER_KEY, label: OTHER_LABEL };
      return { key: `size:${item.nominalWidthIn}`, label: `${item.nominalWidthIn}in` };
    case 'unit':
      if (item.unit == null) return { key: OTHER_KEY, label: OTHER_LABEL };
      return { key: `unit:${item.unit}`, label: item.unit };
    case 'category':
      if (item.categoryId == null || item.categoryName == null) return { key: OTHER_KEY, label: OTHER_LABEL };
      return { key: `cat:${item.categoryId}`, label: item.categoryName };
    default:
      return { key: OTHER_KEY, label: OTHER_LABEL };
  }
}

function compareWithinGroup(a: InvViewItem, b: InvViewItem, sortBy: SortBy): number {
  switch (sortBy) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'size': {
      if (a.nominalWidthIn == null && b.nominalWidthIn == null) return 0;
      if (a.nominalWidthIn == null) return 1;
      if (b.nominalWidthIn == null) return -1;
      return a.nominalWidthIn - b.nominalWidthIn;
    }
    case 'color': {
      if (a.color == null && b.color == null) return 0;
      if (a.color == null) return 1;
      if (b.color == null) return -1;
      return a.color.localeCompare(b.color);
    }
    case 'count':
      return a.count - b.count;
    case 'low_first': {
      const aLow = a.count <= a.lowStockThreshold;
      const bLow = b.count <= b.lowStockThreshold;
      if (aLow !== bLow) return aLow ? -1 : 1;
      return a.name.localeCompare(b.name);
    }
    default:
      return 0;
  }
}

/** Numeric size key extracted from a `size:<w>` group key, for numeric ordering. */
function sizeGroupWidth(key: string): number | null {
  if (!key.startsWith('size:')) return null;
  const n = Number(key.slice('size:'.length));
  return Number.isFinite(n) ? n : null;
}

export function buildInventoryView(items: InvViewItem[], q: InvViewQuery): InvView {
  const filtered = items.filter((i) => passesFilters(i, q));
  const matched = filtered.filter((i) => matchesSearch(i, q.search, q.op));

  const groupMap = new Map<string, InvGroup>();
  for (const item of matched) {
    const { key, label } = groupKeyLabel(item, q.groupBy);
    let group = groupMap.get(key);
    if (!group) {
      group = { key, label, items: [], count: 0, lowCount: 0 };
      groupMap.set(key, group);
    }
    group.items.push(item);
  }

  const groups = [...groupMap.values()];

  // Sort within each group, then compute count/lowCount off the final list.
  for (const group of groups) {
    group.items.sort((a, b) => compareWithinGroup(a, b, q.sortBy));
    group.count = group.items.length;
    group.lowCount = group.items.filter((i) => i.count <= i.lowStockThreshold).length;
  }

  // Order groups: "Other / Consumables" always last; everything else ascending
  // by label, except size groups which order numerically by width.
  groups.sort((a, b) => {
    if (a.key === OTHER_KEY && b.key === OTHER_KEY) return 0;
    if (a.key === OTHER_KEY) return 1;
    if (b.key === OTHER_KEY) return -1;

    if (q.groupBy === 'size') {
      const aw = sizeGroupWidth(a.key);
      const bw = sizeGroupWidth(b.key);
      if (aw != null && bw != null) return aw - bw;
    }
    return a.label.localeCompare(b.label);
  });

  const totalShown = groups.reduce((sum, g) => sum + g.count, 0);

  return { groups, totalShown };
}
