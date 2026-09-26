// Pure report math (tested in logic.test.ts). Only adds up what the server
// already recorded — no new report formats (CPA requirements TBD).

export interface InvoiceHeader {
  id: number; subtotalCents: number; taxCents: number; discountCents: number; totalCents: number;
  status: 'issued' | 'voided'; returnedCents: number;
}

export interface SalesTotals {
  invoices: number; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number;
  voided: number; voidedCents: number; returnedCents: number; netCents: number;
}

/** Sum invoice headers: issued ones count as sales; voided ones are listed apart. */
export function salesTotals(rows: InvoiceHeader[]): SalesTotals {
  const t: SalesTotals = { invoices: 0, subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0,
    voided: 0, voidedCents: 0, returnedCents: 0, netCents: 0 };
  for (const r of rows) {
    if (r.status === 'voided') { t.voided++; t.voidedCents += r.totalCents; continue; }
    t.invoices++;
    t.subtotalCents += r.subtotalCents; t.discountCents += r.discountCents;
    t.taxCents += r.taxCents; t.totalCents += r.totalCents; t.returnedCents += r.returnedCents;
  }
  t.netCents = t.totalCents - t.returnedCents;
  return t;
}

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
