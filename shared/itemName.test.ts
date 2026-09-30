import { describe, expect, it } from 'vitest';
import { canBuildItemName, formatSize, itemDisplayName } from './itemName';

describe('itemDisplayName', () => {
  it('builds color + category + size', () => {
    expect(itemDisplayName({ color: 'Red', categoryName: '651', sizeText: '15' })).toBe('Red 651 15″');
    expect(itemDisplayName({ color: 'White', categoryName: 'Reflective', sizeText: '30' })).toBe('White Reflective 30″');
    expect(itemDisplayName({ categoryName: 'T-shirt blank', sizeText: 'L' })).toBe('T-shirt blank L');
  });
  it('uses the material name for roll SKUs', () => {
    expect(itemDisplayName({ materialName: 'Calendered vinyl (651-type)', color: 'Red', nominalWidthIn: 24 }))
      .toBe('Red Calendered vinyl (651-type) 24″');
  });
  it('normalizes inch spellings and keeps other sizes as typed', () => {
    expect(formatSize('24in')).toBe('24″');
    expect(formatSize('24 "')).toBe('24″');
    expect(formatSize('15.5 inches')).toBe('15.5″');
    expect(formatSize('12x18')).toBe('12x18');
    expect(formatSize('XL')).toBe('XL');
    expect(formatSize(null, 30)).toBe('30″');
    expect(formatSize('  ', null)).toBe('');
  });
  it('prefers sizeText over the roll width', () => {
    expect(itemDisplayName({ color: 'Red', sizeText: '15', nominalWidthIn: 24 })).toBe('Red 15″');
  });
  it('skips blanks with no stray spaces or separators', () => {
    expect(itemDisplayName({ color: '  ', categoryName: '651', sizeText: '' })).toBe('651');
    expect(itemDisplayName({ color: ' Red ', categoryName: null, sizeText: '15' })).toBe('Red 15″');
    expect(itemDisplayName({ color: 'Matte   Black', categoryName: 'Cast' })).toBe('Matte Black Cast');
    expect(itemDisplayName({})).toBe('');
  });
  it('drops repeated words between parts', () => {
    expect(itemDisplayName({ color: 'Red', categoryName: 'red' })).toBe('Red');
  });
  it('adds the count unit only when there is no category or material', () => {
    expect(itemDisplayName({ color: 'Red', sizeText: '15', countUnit: 'roll' })).toBe('Red 15″ roll');
    expect(itemDisplayName({ color: 'Red', categoryName: '651', sizeText: '15', countUnit: 'roll' })).toBe('Red 651 15″');
    expect(itemDisplayName({ color: 'Red', countUnit: 'each' })).toBe('Red');
    expect(itemDisplayName({ countUnit: 'roll' })).toBe('');
  });
  it('knows whether a name can be built', () => {
    expect(canBuildItemName({})).toBe(false);
    expect(canBuildItemName({ color: ' ', countUnit: 'roll' })).toBe(false);
    expect(canBuildItemName({ sizeText: 'L' })).toBe(true);
    expect(canBuildItemName({ nominalWidthIn: 24 })).toBe(true);
    expect(canBuildItemName({ categoryName: 'Cast' })).toBe(true);
  });
});
