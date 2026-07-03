import { describe, it, expect } from 'vitest';
import { buildInventoryView, matchesSearch, type InvViewItem, type InvViewQuery } from './inventoryView';

// Base query with no filters applied — tests override only what they need.
const baseQuery: InvViewQuery = {
  search: '', op: 'contains', kind: 'all', materialId: null, color: null, widthIn: null,
  lowOnly: false, groupBy: 'material', sortBy: 'name', categoryId: null,
};

function item(overrides: Partial<InvViewItem> & { id: number; name: string }): InvViewItem {
  return {
    count: 10, lowStockThreshold: 2, vendor: null, color: null, nominalWidthIn: null,
    materialId: null, materialName: null, unit: null, categoryId: null, categoryName: null,
    ...overrides,
  };
}

describe('matchesSearch', () => {
  const i = item({ id: 1, name: 'Vinyl 651', color: 'Red', vendor: 'Fellers' });

  it('empty/whitespace search always matches', () => {
    expect(matchesSearch(i, '', 'contains')).toBe(true);
    expect(matchesSearch(i, '   ', 'contains')).toBe(true);
  });

  it('contains: positive and negative', () => {
    expect(matchesSearch(i, 'inyl', 'contains')).toBe(true);
    expect(matchesSearch(i, 'zzz', 'contains')).toBe(false);
  });

  it('starts_with: positive and negative', () => {
    expect(matchesSearch(i, 'Vinyl', 'starts_with')).toBe(true);
    expect(matchesSearch(i, '651', 'starts_with')).toBe(false);
  });

  it('ends_with: positive and negative', () => {
    expect(matchesSearch(i, '651', 'ends_with')).toBe(true);
    expect(matchesSearch(i, 'Vinyl', 'ends_with')).toBe(false);
  });

  it('equals: positive and negative', () => {
    expect(matchesSearch(i, 'red', 'equals')).toBe(true); // matches color field, case-insensitive
    expect(matchesSearch(i, 'Vinyl', 'equals')).toBe(false); // not an exact match on any field
  });

  it('is case-insensitive and trims the needle', () => {
    expect(matchesSearch(i, '  VINYL 651  ', 'equals')).toBe(true);
  });

  it('null color/vendor are skipped safely (no throw, no false match)', () => {
    const bare = item({ id: 2, name: 'Squeegee' });
    expect(matchesSearch(bare, 'fellers', 'contains')).toBe(false);
    expect(() => matchesSearch(bare, 'anything', 'equals')).not.toThrow();
  });

  it('matches on vendor field too', () => {
    expect(matchesSearch(i, 'fellers', 'contains')).toBe(true);
  });
});

describe('buildInventoryView — grouping', () => {
  it('groups by material; items with no material land in Other / Consumables', () => {
    const items = [
      item({ id: 1, name: 'Red 651', materialId: 1, materialName: '651 Vinyl' }),
      item({ id: 2, name: 'Squeegee', materialId: null, materialName: null }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'material' });
    expect(view.groups.map((g) => g.key)).toEqual(['mat:1', 'other']);
    expect(view.groups[0].label).toBe('651 Vinyl');
    expect(view.groups[1].label).toBe('Other / Consumables');
  });

  it('groups by material: materialId set but materialName null also falls to Other', () => {
    const items = [
      item({ id: 1, name: 'Orphan SKU', materialId: 9, materialName: null }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'material' });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].key).toBe('other');
  });

  it('groups by color; null color -> Other', () => {
    const items = [
      item({ id: 1, name: 'A', color: 'Red' }),
      item({ id: 2, name: 'B', color: 'Blue' }),
      item({ id: 3, name: 'C', color: null }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'color' });
    expect(view.groups.map((g) => g.key)).toEqual(['color:Blue', 'color:Red', 'other']);
  });

  it('groups by size numerically, not lexically (15 < 24 < 30 < 48)', () => {
    const items = [
      item({ id: 1, name: 'A', nominalWidthIn: 48 }),
      item({ id: 2, name: 'B', nominalWidthIn: 24 }),
      item({ id: 3, name: 'C', nominalWidthIn: 15 }),
      item({ id: 4, name: 'D', nominalWidthIn: 30 }),
      item({ id: 5, name: 'E', nominalWidthIn: null }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'size' });
    expect(view.groups.map((g) => g.key)).toEqual(['size:15', 'size:24', 'size:30', 'size:48', 'other']);
    expect(view.groups[0].label).toBe('15in');
  });

  it('groups by unit; null unit -> Other', () => {
    const items = [
      item({ id: 1, name: 'A', unit: 'sqft' }),
      item({ id: 2, name: 'B', unit: 'each' }),
      item({ id: 3, name: 'C', unit: null }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'unit' });
    expect(view.groups.map((g) => g.key)).toEqual(['unit:each', 'unit:sqft', 'other']);
  });

  it('groups by category; null category -> Other, sorted last', () => {
    const items = [
      item({ id: 1, name: 'A', categoryId: 2, categoryName: 'Vinyl' }),
      item({ id: 2, name: 'B', categoryId: 1, categoryName: 'Apparel' }),
      item({ id: 3, name: 'C', categoryId: null, categoryName: null }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'category' });
    expect(view.groups.map((g) => g.key)).toEqual(['cat:1', 'cat:2', 'other']);
    expect(view.groups[0].label).toBe('Apparel');
    expect(view.groups[1].label).toBe('Vinyl');
  });

  it('groups by category: categoryId set but categoryName null also falls to Other', () => {
    const items = [
      item({ id: 1, name: 'Orphan item', categoryId: 9, categoryName: null }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'category' });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].key).toBe('other');
  });

  it('Other / Consumables always sorts last regardless of label ordering', () => {
    const items = [
      item({ id: 1, name: 'A', color: 'Zebra' }),
      item({ id: 2, name: 'B', color: null }),
      item({ id: 3, name: 'C', color: 'Apple' }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'color' });
    expect(view.groups.map((g) => g.key)).toEqual(['color:Apple', 'color:Zebra', 'other']);
  });

  it('empty groups are omitted entirely', () => {
    const items = [item({ id: 1, name: 'A', materialId: 1, materialName: 'Only Mat' })];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'material' });
    expect(view.groups).toHaveLength(1);
  });

  it('count and lowCount are correct per group', () => {
    const items = [
      item({ id: 1, name: 'A', materialId: 1, materialName: 'M', count: 1, lowStockThreshold: 5 }),
      item({ id: 2, name: 'B', materialId: 1, materialName: 'M', count: 10, lowStockThreshold: 5 }),
      item({ id: 3, name: 'C', materialId: 1, materialName: 'M', count: 5, lowStockThreshold: 5 }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'material' });
    expect(view.groups[0].count).toBe(3);
    expect(view.groups[0].lowCount).toBe(2); // count<=threshold: 1<=5 and 5<=5
  });

  it('totalShown equals the sum of group counts', () => {
    const items = [
      item({ id: 1, name: 'A', materialId: 1, materialName: 'M' }),
      item({ id: 2, name: 'B', materialId: 2, materialName: 'N' }),
      item({ id: 3, name: 'C' }),
    ];
    const view = buildInventoryView(items, { ...baseQuery, groupBy: 'material' });
    const sum = view.groups.reduce((s, g) => s + g.count, 0);
    expect(view.totalShown).toBe(sum);
    expect(view.totalShown).toBe(3);
  });
});

describe('buildInventoryView — filters apply before grouping/search', () => {
  const items = [
    item({ id: 1, name: 'Red 651', materialId: 1, materialName: '651 Vinyl', color: 'Red', nominalWidthIn: 24, count: 1, lowStockThreshold: 5 }),
    item({ id: 2, name: 'Blue 651', materialId: 1, materialName: '651 Vinyl', color: 'Blue', nominalWidthIn: 24, count: 20, lowStockThreshold: 5 }),
    item({ id: 3, name: 'Squeegee', materialId: null, materialName: null, count: 3, lowStockThreshold: 1 }),
  ];

  it('kind=roll keeps only items with a materialId', () => {
    const view = buildInventoryView(items, { ...baseQuery, kind: 'roll' });
    expect(view.totalShown).toBe(2);
  });

  it('kind=other keeps only items without a materialId', () => {
    const view = buildInventoryView(items, { ...baseQuery, kind: 'other' });
    expect(view.totalShown).toBe(1);
  });

  it('materialId filter is exact', () => {
    const view = buildInventoryView(items, { ...baseQuery, materialId: 1 });
    expect(view.totalShown).toBe(2);
  });

  it('color filter is exact (case-insensitive)', () => {
    const view = buildInventoryView(items, { ...baseQuery, color: 'red' });
    expect(view.totalShown).toBe(1);
  });

  it('widthIn filter is exact', () => {
    const view = buildInventoryView(items, { ...baseQuery, widthIn: 24 });
    expect(view.totalShown).toBe(2);
  });

  it('categoryId filter is exact', () => {
    const withCats = [
      item({ id: 1, name: 'Red 651', categoryId: 1, categoryName: 'Vinyl' }),
      item({ id: 2, name: 'Blue 651', categoryId: 1, categoryName: 'Vinyl' }),
      item({ id: 3, name: 'Squeegee', categoryId: 2, categoryName: 'Tools' }),
    ];
    const view = buildInventoryView(withCats, { ...baseQuery, categoryId: 1 });
    expect(view.totalShown).toBe(2);
  });

  it('lowOnly filter keeps count<=threshold items', () => {
    const view = buildInventoryView(items, { ...baseQuery, lowOnly: true });
    expect(view.totalShown).toBe(1); // only Red 651 (1<=5)
  });

  it('filters narrow the set before search is applied', () => {
    const view = buildInventoryView(items, { ...baseQuery, kind: 'roll', search: 'Squeegee' });
    expect(view.totalShown).toBe(0);
  });

  it('a filter that excludes everything yields totalShown 0 and no groups', () => {
    const view = buildInventoryView(items, { ...baseQuery, materialId: 999 });
    expect(view.totalShown).toBe(0);
    expect(view.groups).toEqual([]);
  });
});

describe('buildInventoryView — sortBy within group', () => {
  const oneGroup = (items: InvViewItem[]) => items.map((i) => ({ ...i, materialId: 1, materialName: 'M' }));

  it('name: localeCompare ascending', () => {
    const items = oneGroup([
      item({ id: 1, name: 'Charlie' }),
      item({ id: 2, name: 'Alpha' }),
      item({ id: 3, name: 'Bravo' }),
    ]);
    const view = buildInventoryView(items, { ...baseQuery, sortBy: 'name' });
    expect(view.groups[0].items.map((i) => i.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('size: numeric ascending, nulls last', () => {
    const items = oneGroup([
      item({ id: 1, name: 'A', nominalWidthIn: 48 }),
      item({ id: 2, name: 'B', nominalWidthIn: null }),
      item({ id: 3, name: 'C', nominalWidthIn: 15 }),
    ]);
    const view = buildInventoryView(items, { ...baseQuery, sortBy: 'size' });
    expect(view.groups[0].items.map((i) => i.id)).toEqual([3, 1, 2]);
  });

  it('color: localeCompare ascending, nulls last', () => {
    const items = oneGroup([
      item({ id: 1, name: 'A', color: 'Zebra' }),
      item({ id: 2, name: 'B', color: null }),
      item({ id: 3, name: 'C', color: 'Apple' }),
    ]);
    const view = buildInventoryView(items, { ...baseQuery, sortBy: 'color' });
    expect(view.groups[0].items.map((i) => i.id)).toEqual([3, 1, 2]);
  });

  it('count: ascending', () => {
    const items = oneGroup([
      item({ id: 1, name: 'A', count: 10 }),
      item({ id: 2, name: 'B', count: 1 }),
      item({ id: 3, name: 'C', count: 5 }),
    ]);
    const view = buildInventoryView(items, { ...baseQuery, sortBy: 'count' });
    expect(view.groups[0].items.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it('low_first: low items first, then by name', () => {
    const items = oneGroup([
      item({ id: 1, name: 'Zulu', count: 10, lowStockThreshold: 2 }),
      item({ id: 2, name: 'Bravo', count: 1, lowStockThreshold: 2 }),
      item({ id: 3, name: 'Alpha', count: 1, lowStockThreshold: 2 }),
    ]);
    const view = buildInventoryView(items, { ...baseQuery, sortBy: 'low_first' });
    expect(view.groups[0].items.map((i) => i.id)).toEqual([3, 2, 1]);
  });
});

describe('buildInventoryView — edge cases', () => {
  it('empty input yields {groups: [], totalShown: 0}', () => {
    const view = buildInventoryView([], baseQuery);
    expect(view).toEqual({ groups: [], totalShown: 0 });
  });
});
