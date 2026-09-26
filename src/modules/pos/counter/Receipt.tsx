import { useEffect, useRef } from 'react';
import { Button, Card, EmptyState, LinearProgress } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import { formatWhen } from '../lib/when';
import { methodLabel, type InvoiceDetail, type InvoiceHeader, type PaymentRow } from '../types';

export interface SaleResult { id: number; invoice: InvoiceHeader | null; payment: PaymentRow | null }

/** After Complete Sale: the invoice as the server saved it, the payment, and the change to hand back. */
export default function Receipt({ sale, onNewSale }: { sale: SaleResult; onNewSale: () => void }) {
  const number = sale.invoice?.numberDisplay;
  const q = useQuery<InvoiceDetail>(number ? `/api/invoices/${number}` : null);
  const inv = q.data;
  const pay = sale.payment;
  const newSale = useRef<HTMLButtonElement>(null);
  useEffect(() => { newSale.current?.focus(); }, []);

  return (
    <Card variant="outlined" className="max-w-2xl mx-auto" aria-labelledby="receipt-title">
      <div className="text-center mb-4">
        <p className="text-title-medium text-on-surface-variant">Sale complete</p>
        <h2 id="receipt-title" className="text-display-small tabular-nums">Invoice {number ?? '—'}</h2>
        {inv && <p className="text-body-medium text-on-surface-variant">{formatWhen(inv.createdAt)} · {inv.customerName ?? 'Walk-in'}</p>}
      </div>

      {pay?.changeCents != null && (
        <div className="rounded-shape-medium bg-success-container text-on-success-container text-center py-3 mb-4" aria-live="polite">
          <p className="text-title-medium">Change due</p>
          <p className="text-display-medium tabular-nums">{formatCents(pay.changeCents)}</p>
        </div>
      )}

      <div className="h-1">{q.loading && <LinearProgress label="Loading the invoice" />}</div>
      {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load the invoice lines"
        action={<Button variant="outlined" onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>}
      {inv && (
        <table className="w-full text-body-large border-collapse">
          <caption className="sr-only">Invoice lines</caption>
          <thead><tr className="text-title-small text-on-surface-variant border-b border-outline-variant">
            <th scope="col" className="text-left py-2">Item</th><th scope="col" className="text-right py-2">Qty</th>
            <th scope="col" className="text-right py-2 hidden sm:table-cell">Tax</th><th scope="col" className="text-right py-2">Total</th>
          </tr></thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-b border-outline-variant">
                <td className="py-2 pr-2">{l.description}<span className="block text-body-small text-on-surface-variant">{formatCents(l.unitPriceCents)} each</span></td>
                <td className="py-2 text-right tabular-nums">{l.qty}</td>
                <td className="py-2 text-right tabular-nums hidden sm:table-cell">{l.taxable ? formatCents(l.taxCents) : '—'}</td>
                <td className="py-2 text-right tabular-nums">{formatCents(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sale.invoice && (
        <dl className="grid grid-cols-2 gap-y-1 mt-3 text-body-large tabular-nums">
          <dt className="text-on-surface-variant">Subtotal</dt><dd className="text-right">{formatCents(sale.invoice.subtotalCents)}</dd>
          <dt className="text-on-surface-variant">
            Tax{sale.invoice.taxExempt ? ` (exempt: ${sale.invoice.taxExemptReason ?? '—'})` : ` (${sale.invoice.taxRatePct}%)`}
          </dt><dd className="text-right">{formatCents(sale.invoice.taxCents)}</dd>
          <dt className="text-title-large">Total</dt><dd className="text-right text-title-large">{formatCents(sale.invoice.totalCents)}</dd>
          {pay && <><dt className="text-on-surface-variant">Paid ({methodLabel(pay.method)})</dt><dd className="text-right">{formatCents(pay.amountCents)}</dd></>}
          {pay?.tenderedCents != null && <><dt className="text-on-surface-variant">Cash tendered</dt><dd className="text-right">{formatCents(pay.tenderedCents)}</dd></>}
          {pay?.changeCents != null && <><dt className="text-on-surface-variant">Change</dt><dd className="text-right">{formatCents(pay.changeCents)}</dd></>}
        </dl>
      )}

      <div className="flex flex-wrap justify-center gap-2 mt-6">
        <Button ref={newSale} touch icon="add" onClick={onNewSale}>New sale</Button>
        {number && <Button variant="outlined" touch to={`/pos/invoices/${number}`}>Open invoice</Button>}
      </div>
    </Card>
  );
}
