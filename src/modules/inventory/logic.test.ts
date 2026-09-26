import { describe, it, expect } from 'vitest';
import {
  stockStatus, costPerCountUnit, parseWhole, parseDelta, receiptCountUnits, signed, noteRequired,
  readListState, writeListState, listApiParams, moreFilterCount, toggleClosed,
} from './logic';
import { startsGroup } from '../../lib/query';
import { enteredIds, enteredIn, submitCounts, chunks, emptyDraft, type Draft } from './counts/draft';

describe('stock status', () => {
  it('out at zero or below, low at/below Min, else in stock', () => {
    expect(stockStatus(0, 5)).toBe('out');
    expect(stockStatus(-1, 0)).toBe('out');
    expect(stockStatus(5, 5)).toBe('low');
    expect(stockStatus(6, 5)).toBe('ok');
    expect(stockStatus(1, 0)).toBe('ok');
  });
});

describe('numbers people type', () => {
  it('parseWhole takes whole numbers ≥ 0 only', () => {
    expect(parseWhole(' 12 ')).toBe(12);
    expect(parseWhole('0')).toBe(0);
    for (const bad of ['', '-1', '1.5', 'abc', '1e3']) expect(parseWhole(bad)).toBeNull();
  });
  it('parseDelta takes signed non-zero whole numbers', () => {
    expect(parseDelta('-2')).toBe(-2);
    expect(parseDelta('+3')).toBe(3);
    for (const bad of ['0', '', '2.5', '--1']) expect(parseDelta(bad)).toBeNull();
    expect(signed(3)).toBe('+3');
    expect(signed(-3)).toBe('-3');
  });
  it('receipts convert purchase units × factor into count units', () => {
    expect(receiptCountUnits('2', 12)).toBe(24);
    expect(receiptCountUnits('1.5', 1)).toBe(2);
    expect(receiptCountUnits('0', 12)).toBeNull();
    expect(receiptCountUnits('', 1)).toBeNull();
    expect(receiptCountUnits('0.01', 1)).toBeNull(); // rounds to nothing
  });
  it('cost per count unit prefers the average, else last cost ÷ factor', () => {
    expect(costPerCountUnit({ avgCostCents: 250, lastCostCents: 9000, purchaseToCountFactor: 12 })).toBe(250);
    expect(costPerCountUnit({ avgCostCents: 0, lastCostCents: 1200, purchaseToCountFactor: 12 })).toBe(100);
    expect(costPerCountUnit({ avgCostCents: 0, lastCostCents: null, purchaseToCountFactor: 1 })).toBeNull();
  });
  it('corrections, theft and other need a note', () => {
    expect(noteRequired('correction')).toBe(true);
    expect(noteRequired('damaged')).toBe(false);
  });
});

describe('item list URL state', () => {
  it('reads defaults from an empty URL and ignores junk', () => {
    const s = readListState(new URLSearchParams('stock=nope&sort=password&page=-4'));
    expect(s).toMatchObject({ q: '', match: 'contains', stock: '', sort: 'name:asc', page: 0 });
  });
  it('round-trips filters; page is 1-based in the URL; a filter change resets the page', () => {
    let sp = writeListState(new URLSearchParams(), { q: 'red', stock: 'low', sort: 'count:desc' });
    sp = writeListState(sp, { page: 2 });
    expect(sp.get('page')).toBe('3');
    const s = readListState(sp);
    expect(s).toMatchObject({ q: 'red', stock: 'low', sort: 'count:desc', page: 2 });
    sp = writeListState(sp, { categoryId: '4' });
    expect(sp.get('page')).toBeNull();
    sp = writeListState(sp, { stock: '', sort: 'name:asc' });
    expect(sp.toString()).toBe('q=red&categoryId=4');
  });
  it('builds API params; match is sent only with a search', () => {
    const s = readListState(new URLSearchParams('match=starts&sort=value:desc&categoryId=none'));
    expect(listApiParams(s)).toMatchObject({ q: '', match: '', sort: 'value', dir: 'desc', categoryId: 'none' });
    expect(listApiParams({ ...s, q: 'tape' }).match).toBe('starts');
    expect(moreFilterCount(s)).toBe(2);
  });
  it('groups by material by default; group=none sends no group; new sorts are accepted', () => {
    expect(readListState(new URLSearchParams()).group).toBe('material');
    expect(listApiParams(readListState(new URLSearchParams())).group).toBe('material');
    const none = readListState(new URLSearchParams('group=none&sort=low:asc'));
    expect(listApiParams(none)).toMatchObject({ group: '', sort: 'low', dir: 'asc' });
    expect(readListState(new URLSearchParams('sort=size:asc')).sort).toBe('size:asc');
    expect(readListState(new URLSearchParams('group=junk')).group).toBe('material');
  });
  it('collapsed groups live in the URL, keep the page, and reset when the grouping changes', () => {
    let sp = writeListState(new URLSearchParams('page=3'), { closed: toggleClosed([], 'mat:4') });
    expect(readListState(sp)).toMatchObject({ closed: ['mat:4'], page: 2 });
    sp = writeListState(sp, { closed: toggleClosed(['mat:4'], 'other') });
    expect(sp.getAll('closed')).toEqual(['mat:4', 'other']);
    expect(toggleClosed(['mat:4', 'other'], 'mat:4')).toEqual(['other']);
    sp = writeListState(sp, { group: 'color' });
    expect(sp.getAll('closed')).toEqual([]);
    expect(sp.get('group')).toBe('color');
    expect(writeListState(sp, { group: 'material' }).get('group')).toBeNull();
  });
  it('a header row starts each group on the page', () => {
    const keys = ['a', 'a', 'b', 'other', 'other'];
    expect(keys.map((_, i) => startsGroup(keys, i))).toEqual([true, false, true, true, false]);
    expect(startsGroup([undefined, undefined], 0)).toBe(false);
  });
});

describe('count draft', () => {
  const d: Draft = {
    ...emptyDraft(),
    lines: {
      1: { counted: '4', name: 'A', countUnit: null, categoryId: 7 },
      2: { counted: '', name: 'B', countUnit: null, categoryId: 7 },
      3: { counted: '0', name: 'C', countUnit: null, categoryId: null },
      4: { counted: '2.5', name: 'D', countUnit: null, categoryId: null },
    },
    reasons: { 1: 'waste_scrap' },
    notes: { 1: '  torn roll ', 3: '   ' },
  };
  it('counts only valid entries (blank = skipped)', () => {
    expect(enteredIds(d)).toEqual([1, 3]);
    expect(enteredIn(d, 7)).toBe(1);
    expect(enteredIn(d, null)).toBe(1);
  });
  it('builds the submit payload with reasons and trimmed notes', () => {
    expect(submitCounts(d)).toEqual([
      { itemId: 1, counted: 4, reasonCode: 'waste_scrap', note: 'torn roll' },
      { itemId: 3, counted: 0 },
    ]);
  });
  it('chunks ids for the 200-id list filter', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([])).toEqual([]);
  });
});
