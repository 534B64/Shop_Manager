/** "Sep 26, 3:04 PM" — local date + time for an ISO timestamp. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Today as yyyy-mm-dd (UTC, matching how the server stores and filters timestamps). */
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

/** {from, to} for the last `days` days ending today (1 = today only). */
export function lastDays(days: number, now = new Date()) {
  const from = new Date(now.getTime() - (days - 1) * 86_400_000);
  return { from: todayIso(from), to: todayIso(now) };
}
