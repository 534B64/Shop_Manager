import { Button } from '../../components/m3';
import type { DateRange } from '../../components/DateRangeFields';
import { useQuery, withParams } from '../../lib/query';
import { formatCents } from '../../lib/format';
import ReportCard, { Figures } from './ReportCard';

interface Part { count: number; totalCents: number; taxCents: number; refundCents: number }
export interface SalesReport {
  sales: { invoiceCount: number; firstNumber: string | null; lastNumber: string | null;
    subtotalCents: number; taxCents: number; discountCents: number; totalCents: number };
  voids: Part; returns: Part; netSalesCents: number; netTaxCents: number;
}

/** Sales & tax for the range — one SQL-added call (GET /api/reports/sales, manager+), the Z-report's rule. */
export default function SalesCard({ range }: { range: DateRange }) {
  const q = useQuery<SalesReport>(withParams('/api/reports/sales', { from: range.from, to: range.to }));
  const r = q.data;
  const invLink = withParams('/pos/invoices', { from: range.from, to: range.to });
  return (
    <ReportCard title="Sales & tax (invoices)" loading={q.loading} error={q.error} onRetry={q.reload}
      subtitle="Invoices issued in the range with the tax kept on each line, less voids and returns made in the range — the same rule as the Z-report."
      action={<Button variant="text" to={invLink}>Invoices</Button>}>
      {r && <>
        <Figures rows={[
          ['Invoices', `${r.sales.invoiceCount.toLocaleString()}${r.sales.firstNumber ? ` (#${r.sales.firstNumber}–#${r.sales.lastNumber})` : ''}`],
          ['Subtotal', formatCents(r.sales.subtotalCents)],
          ['Discounts', `−${formatCents(r.sales.discountCents)}`],
          ['Sales tax', formatCents(r.sales.taxCents)],
          ['Invoice totals', formatCents(r.sales.totalCents), true],
          [`Voids (${r.voids.count})`, `−${formatCents(r.voids.totalCents)}`],
          [`Returns (${r.returns.count})`, `−${formatCents(r.returns.totalCents)}`],
          ['Net sales', formatCents(r.netSalesCents), true],
          ['Net sales tax', formatCents(r.netTaxCents), true],
        ]} />
        <p className="mt-3 text-body-small text-on-surface-variant">
          A void or return counts on the day it happened, whatever day the invoice was issued.
        </p>
      </>}
    </ReportCard>
  );
}
