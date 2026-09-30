import { describe, expect, it } from 'vitest';
import { brandInitials, brandName, cleanCompanyName, printHeading } from './branding';

describe('branding', () => {
  it('shows "<Company> · Shop Manager", or just Shop Manager', () => {
    expect(brandName('Acme Signs')).toBe('Acme Signs · Shop Manager');
    expect(brandName('  Acme   Signs ')).toBe('Acme Signs · Shop Manager');
    expect(brandName('')).toBe('Shop Manager');
    expect(brandName(null)).toBe('Shop Manager');
    expect(brandName(undefined)).toBe('Shop Manager');
  });
  it('print headings use the company alone', () => {
    expect(printHeading('Acme Signs')).toBe('Acme Signs');
    expect(printHeading('  ')).toBe('Shop Manager');
  });
  it('makes initials', () => {
    expect(brandInitials('Decals Plus')).toBe('DP');
    expect(brandInitials('Acme')).toBe('AC');
    expect(brandInitials('')).toBe('SM');
  });
  it('cleans and caps names', () => {
    expect(cleanCompanyName(5)).toBe('');
    expect(cleanCompanyName('x'.repeat(200))).toHaveLength(80);
  });
});
