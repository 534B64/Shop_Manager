/** "Sep 26, 3:04 PM" — local date + time for an ISO timestamp. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today as yyyy-mm-dd, the shop's LOCAL day — the server reads a date-only
 *  from/to as a local day too (server/lib/dates.ts). */
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** {from, to} for the last `days` local days ending today (1 = today only). */
export function lastDays(days: number, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from: todayIso(from), to: todayIso(now) };
}
