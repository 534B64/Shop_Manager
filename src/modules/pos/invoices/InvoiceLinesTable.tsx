import { formatCents } from '../../../lib/format';
import type { InvoiceDetail } from '../types';

/** The locked lines with per-line tax, discount share and returns, then the totals. */
export default function InvoiceLinesTable({ inv }: { inv: InvoiceDetail }) {
  const anyDiscount = inv.discountCents > 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-large border-collapse tabular-nums">
        <caption className="sr-only">Lines on invoice {inv.numberDisplay}</caption>
        <thead>
          <tr className="text-title-small text-on-surface-variant border-b border-outline-variant">
            <th scope="col" className="text-left py-2 pr-2">#</th>
            <th scope="col" className="text-left py-2 pr-2">Item</th>
            <th scope="col" className="text-right py-2 px-2">Qty</th>
            <th scope="col" className="text-right py-2 px-2 hidden md:table-cell">Each</th>
            <th scope="col" className="text-right py-2 px-2 hidden sm:table-cell">Subtotal</th>
            <th scope="col" className="text-right py-2 px-2">Tax</th>
            {anyDiscount && <th scope="col" className="text-right py-2 px-2 hidden md:table-cell">Discount</th>}
            <th scope="col" className="text-right py-2 pl-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id} className="border-b border-outline-variant align-top">
              <td className="py-2 pr-2 text-on-surface-variant">{l.lineNo}</td>
              <td className="py-2 pr-2">
                {l.description}
                <span className="block text-body-small text-on-surface-variant">
                  {l.inventoryItemId != null ? `From stock (${l.stockQty} taken off the shelf)` : 'Not a stock item'}
                  {l.returnedQty > 0 && ` · ${l.returnedQty} of ${l.qty} returned`}
                </span>
              </td>
              <td className="py-2 px-2 text-right">{l.qty}</td>
              <td className="py-2 px-2 text-right hidden md:table-cell">{formatCents(l.unitPriceCents)}</td>
              <td className="py-2 px-2 text-right hidden sm:table-cell">{formatCents(l.subtotalCents)}</td>
              <td className="py-2 px-2 text-right">{l.taxable ? <>{formatCents(l.taxCents)}<span className="block text-body-small text-on-surface-variant">{l.taxRatePct}%</span></> : 'none'}</td>
              {anyDiscount && <td className="py-2 px-2 text-right hidden md:table-cell">−{formatCents(l.discountCents)}</td>}
              <td className="py-2 pl-2 text-right">{formatCents(l.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 mt-3 ml-auto max-w-xs text-body-large tabular-nums">
        <dt className="text-on-surface-variant">Subtotal</dt><dd className="text-right">{formatCents(inv.subtotalCents)}</dd>
        <dt className="text-on-surface-variant">Tax</dt><dd className="text-right">{formatCents(inv.taxCents)}</dd>
        {anyDiscount && <><dt className="text-on-surface-variant">Discount ({inv.discountPct}%)</dt><dd className="text-right">−{formatCents(inv.discountCents)}</dd></>}
        <dt className="text-title-large">Total</dt><dd className="text-right text-title-large">{formatCents(inv.totalCents)}</dd>
        {inv.returnedCents > 0 && <><dt className="text-on-surface-variant">Returned</dt><dd className="text-right">−{formatCents(inv.returnedCents)}</dd></>}
      </dl>
    </div>
  );
}
