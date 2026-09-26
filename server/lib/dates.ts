// Date-range filters for list/report endpoints. Timestamps are stored as UTC
// ISO strings; a bare YYYY-MM-DD in `from` / `to` means the SHOP's local day
// (the server runs with TZ set — America/Chicago in the Dockerfile), so an
// 8 pm sale counts on the day it was rung up, not on the next UTC day.
import { and, gte, lt, lte, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local midnight at the start of a YYYY-MM-DD day, as a UTC ISO timestamp. */
export function localDayStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

/** Local midnight at the start of the day AFTER `day` (the exclusive end). */
export function localDayEnd(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d + 1).toISOString();
}

export interface DayRange { from: string | null; to: string | null; toExclusive: boolean }

/**
 * UTC ISO bounds for `from` / `to`. A date-only value is a local day: `from`
 * starts at its local midnight, `to` ends before the next one (exclusive). A
 * full timestamp is used as given (inclusive). Empty → no bound.
 */
export function localDayRange(from?: string | null, to?: string | null): DayRange {
  return {
    from: from ? (DAY_RE.test(from) ? localDayStart(from) : from) : null,
    to: to ? (DAY_RE.test(to) ? localDayEnd(to) : to) : null,
    toExclusive: !!to && DAY_RE.test(to),
  };
}

/** SQL conditions on a timestamp column for `from` / `to` (see localDayRange). */
export function dateRangeConds(col: SQLiteColumn, from?: string | null, to?: string | null): SQL[] {
  const r = localDayRange(from, to);
  const conds: SQL[] = [];
  if (r.from) conds.push(gte(col, r.from));
  if (r.to) conds.push(r.toExclusive ? lt(col, r.to) : lte(col, r.to));
  return conds;
}

/** The same as one condition (undefined when there are no bounds). */
export const dateRange = (col: SQLiteColumn, from?: string | null, to?: string | null): SQL | undefined => {
  const conds = dateRangeConds(col, from, to);
  return conds.length ? and(...conds) : undefined;
};
