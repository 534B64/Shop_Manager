// Pure rules for the Settings pages (tested in logic.test.ts).
import type { Role } from '../../lib/session';

export const PIN_RE = /^\d{4,12}$/;
export const pinError = (pin: string) => (PIN_RE.test(pin) ? null : 'PIN must be 4–12 digits.');

/** New-PIN + repeat check shared by "change my PIN" and admin reset. */
export function newPinErrors(next: string, repeat: string): { next?: string; repeat?: string } {
  const e: { next?: string; repeat?: string } = {};
  const bad = pinError(next);
  if (bad) e.next = bad;
  else if (repeat !== next) e.repeat = 'The PINs don’t match.';
  return e;
}

/** A number typed into a settings field: null when blank/invalid/out of range. */
export function numberIn(v: string, min: number, max: number): number | null {
  const t = v.trim();
  if (!t || !/^\d*\.?\d*$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export const rangeMsg = (min: number, max: number) => `Enter a number from ${min} to ${max}.`;

export const ROLES: Role[] = ['cashier', 'manager', 'admin'];
export const ROLE_LABEL: Record<Role, string> = { cashier: 'Cashier', manager: 'Manager', admin: 'Admin' };
export const ROLE_HINT: Record<Role, string> = {
  cashier: 'Quotes, orders, payments; voids and refunds need a manager.',
  manager: 'Approves voids, refunds, overrides; runs inventory setup.',
  admin: 'Everything, including pricing, tax, and accounts.',
};

/** The price-rule input's label for a material's price mode. */
export function rateLabel(mode: string): string {
  switch (mode) {
    case 'per_inch_max': return '$ per inch';
    case 'per_sqft': return '$ per sq ft';
    case 'per_unit': return '$ per unit';
    case 'flat': return '$ base';
    default: return '$';
  }
}

/** Case-insensitive add to a list; unchanged when blank or already there. */
export function addUnique(list: string[], value: string): string[] {
  const v = value.trim();
  return !v || list.some((x) => x.toLowerCase() === v.toLowerCase()) ? list : [...list, v];
}

/** Rows to show: archived only when asked, matching a search on `name`. */
export function visibleRows<T extends { name: string; archivedAt?: string | null }>(rows: T[], showArchived: boolean, search = ''): T[] {
  const s = search.trim().toLowerCase();
  return rows.filter((r) => (showArchived || !r.archivedAt) && (!s || r.name.toLowerCase().includes(s)));
}
