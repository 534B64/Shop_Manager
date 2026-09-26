// Pure report math (tested in logic.test.ts). Only adds up what the server
// already recorded — no new report formats (CPA requirements TBD).

/** First day of this month and today, local, as YYYY-MM-DD. */
export function monthToDate(now = new Date()): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
}

/** "payments-2026-09-01-to-2026-09-26.csv" (open ends say "start"/"today"). */
export const csvName = (kind: string, from: string, to: string) =>
  `${kind}${from || to ? `-${from || 'start'}-to-${to || 'today'}` : ''}.csv`;

export const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', check: 'Check', credit: 'Store credit', other: 'Other',
};
