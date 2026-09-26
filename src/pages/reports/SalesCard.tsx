import { useEffect, useState } from 'react';
import { Button } from '../../components/m3';
import type { DateRange } from '../../components/DateRangeFields';
import { get } from '../../lib/api';
import { withParams } from '../../lib/query';
import { errorText } from '../../lib/errorText';
import { formatCents } from '../../lib/format';
import type { KeysetPage } from '../../lib/keysetPaging';
import { salesTotals, type InvoiceHeader, type SalesTotals } from './logic';
import ReportCard, { Figures } from './ReportCard';

const MAX_PAGES = 50; // 10,000 invoices — far beyond a month for this shop

/** Sales & tax from invoice headers in the range (walks the keyset pages). */
export default function SalesCard({ range }: { range: DateRange }) {
  const [t, setT] = useState<SalesTotals | null>(null);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true); setError(null);
      const rows: InvoiceHeader[] = [];
      let before: number | null = null;
      try {
        for (let i = 0; i < MAX_PAGES; i++) {
          const p: KeysetPage<InvoiceHeader> = await get(withParams('/api/invoices', { from: range.from, to: range.to, limit: 200, before }));
          rows.push(...p.rows);
          before = p.nextBefore;
          if (before == null) break;
        }
        if (live) { setT(salesTotals(rows)); setPartial(before != null); }
      } catch (e) { if (live) setError(errorText(e)); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [range.from, range.to, tick]);

  const invLink = withParams('/pos/invoices', { from: range.from, to: range.to });
  return (
    <ReportCard title="Sales & tax (invoices)" loading={loading} error={error} onRetry={() => setTick((n) => n + 1)}
      subtitle="From the locked invoices issued in the range, with the tax kept on each line at the time of sale."
      action={<Button variant="text" to={invLink}>Invoices</Button>}>
      {t && <>
        <Figures rows={[
          ['Invoices', t.invoices.toLocaleString()],
          ['Subtotal', formatCents(t.subtotalCents)],
          ['Discounts', `−${formatCents(t.discountCents)}`],
          ['Sales tax', formatCents(t.taxCents), true],
          ['Invoice totals', formatCents(t.totalCents), true],
          ['Returns against these invoices', `−${formatCents(t.returnedCents)}`],
          ['Net after returns', formatCents(t.netCents), true],
          [`Voided invoices (${t.voided})`, formatCents(t.voidedCents)],
        ]} />
        {partial && <p role="alert" className="mt-2 text-body-small text-error">Only the newest 10,000 invoices were added up — narrow the range.</p>}
        <p className="mt-3 text-body-small text-on-surface-variant">
          Voided invoices are left out of the totals. Returns are counted against the invoice they came from, whatever day they happened.
        </p>
      </>}
    </ReportCard>
  );
}
