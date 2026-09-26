import { Button, Card, CardHeader } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import { formatWhen } from '../lib/when';
import { methodLabel, type ReturnRow } from '../types';

/** A saved return as the server recorded it: lines, restocks, value, and the money handed back. */
export default function ReturnResult({ ret, fresh }: { ret: ReturnRow; fresh?: boolean }) {
  return (
    <Card variant="outlined" className="max-w-2xl" aria-labelledby="ret-title">
      <CardHeader id="ret-title" title={`${fresh ? 'Return saved — ' : ''}Return #${ret.id}`}
        subtitle={`${formatWhen(ret.createdAt)} · by ${ret.createdBy ?? '—'} · invoice ${ret.invoiceNumber ?? ''}`} />
      {ret.refundCents > 0 ? (
        <div className="rounded-shape-medium bg-success-container text-on-success-container text-center py-3 mb-4">
          <p className="text-title-medium">Give back ({methodLabel(ret.refundMethod)})</p>
          <p className="text-display-small tabular-nums">{formatCents(ret.refundCents)}</p>
        </div>
      ) : (
        <p className="rounded-shape-medium bg-surface-container-highest text-on-surface px-4 py-3 mb-4 text-body-large">
          No money back — the return lowered what the customer still owes.
        </p>
      )}
      <p className="text-body-large mb-2">Reason: {ret.reason}</p>
      <ul className="divide-y divide-outline-variant mb-3">
        {(ret.lines ?? []).map((l) => (
          <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-body-large">
            <span className="flex-1 min-w-0">{l.lineNo}. {l.description} × {l.qty}
              <span className="block text-body-small text-on-surface-variant">
                {l.restockedQty > 0 ? `${l.restockedQty} back on the shelf` : l.restock ? 'Restock asked, but none was taken off the shelf' : 'Not restocked'}
              </span>
            </span>
            <span className="tabular-nums">−{formatCents(l.totalCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 max-w-xs ml-auto text-body-large tabular-nums">
        <dt className="text-on-surface-variant">Items</dt><dd className="text-right">{formatCents(ret.subtotalCents)}</dd>
        <dt className="text-on-surface-variant">Tax</dt><dd className="text-right">{formatCents(ret.taxCents)}</dd>
        {ret.discountCents > 0 && <><dt className="text-on-surface-variant">Discount</dt><dd className="text-right">−{formatCents(ret.discountCents)}</dd></>}
        <dt className="text-title-medium">Return value</dt><dd className="text-right text-title-medium">{formatCents(ret.totalCents)}</dd>
      </dl>
      <div className="flex flex-wrap gap-2 mt-4">
        {ret.invoiceNumber && <Button variant="outlined" touch to={`/pos/invoices/${ret.invoiceNumber}`}>Open invoice</Button>}
        <Button variant="text" touch to="/pos/returns">All returns</Button>
      </div>
    </Card>
  );
}
