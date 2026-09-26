import { describe, it, expect } from 'vitest';
import { profileErrors, changedFields, isInactive, creditDelta, jobsTotal } from './logic';
import type { Job } from '../../lib/types';

const base = { name: 'Acme', email: 'a@acme.co', phone: '', notes: '' };

describe('profileErrors', () => {
  it('passes a valid profile', () => expect(profileErrors(base)).toEqual({}));
  it('requires a name and an email', () => {
    expect(profileErrors({ ...base, name: ' ' }).name).toBeTruthy();
    expect(profileErrors({ ...base, email: '' }).email).toMatch(/required/);
    expect(profileErrors({ ...base, email: 'nope' }).email).toMatch(/@/);
  });
  it('exempts the Walk-in record from the email rule', () => {
    expect(profileErrors({ ...base, name: 'Walk-in', email: '' })).toEqual({});
  });
  it('on an edit of a customer without an email, the email is optional unless touched', () => {
    const legacy = { ...base, email: '' };
    expect(profileErrors(legacy, false)).toEqual({});
    expect(profileErrors({ ...legacy, email: 'nope' }, false).email).toMatch(/@/);
    expect(profileErrors(legacy, true).email).toMatch(/required/);
  });
  it('an edit sends only the changed, trimmed fields', () => {
    expect(changedFields(base, { ...base, phone: ' 555-123-4567 ' })).toEqual({ phone: '555-123-4567' });
    expect(changedFields(base, { ...base, name: 'Acme ' })).toEqual({});
  });
  it('checks phone digits only when given', () => {
    expect(profileErrors({ ...base, phone: '555-1234' }).phone).toBeTruthy();
    expect(profileErrors({ ...base, phone: '(555) 123 - 4567' }).phone).toBeUndefined();
  });
});

describe('isInactive', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  it('flags never and >30 days', () => {
    expect(isInactive(null, now)).toBe(true);
    expect(isInactive('2026-08-01T00:00:00Z', now)).toBe(true);
    expect(isInactive('2026-09-20T00:00:00Z', now)).toBe(false);
  });
});

describe('creditDelta', () => {
  it('signs the amount and refuses nonsense', () => {
    expect(creditDelta('10', 'add', 0)).toEqual({ cents: 1000 });
    expect(creditDelta('2.50', 'reduce', 500)).toEqual({ cents: -250 });
    expect(creditDelta('0', 'add', 0)).toHaveProperty('error');
    expect(creditDelta('abc', 'add', 0)).toHaveProperty('error');
    expect(creditDelta('6', 'reduce', 500)).toHaveProperty('error');
  });
});

it('jobsTotal ignores unpriced jobs', () => {
  expect(jobsTotal([{ finalPriceCents: 500 }, { finalPriceCents: null }, { finalPriceCents: 250 }] as Job[])).toBe(750);
});
