import { Link } from 'react-router-dom';
import { Card, CardHeader, cx } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import { formatWhen } from '../lib/when';
import { methodLabel, type InvoiceDetail } from '../types';

/** Payments + refunds on the invoice's job, returns taken, and the void record. */
export default function InvoiceMoney({ inv }: { inv: InvoiceDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card variant="outlined" aria-labelledby="pays-title">
        <CardHeader id="pays-title" title="Payments & refunds" />
        {inv.payments.length === 0 ? <p className="text-body-large text-on-surface-variant">None recorded.</p> : (
          <ul className="divide-y divide-outline-variant">
            {inv.payments.map((p) => (
              <li key={p.id} className={cx('flex flex-wrap items-baseline gap-x-3 py-2 text-body-large', p.voidedAt && 'text-on-surface-variant')}>
                <span className="flex-1 min-w-0">
                  {p.kind === 'refund' ? 'Refund' : 'Payment'} · {methodLabel(p.method)}
                  <span className="block text-body-small text-on-surface-variant">
                    {formatWhen(p.createdAt)}
                    {p.tenderedCents != null && ` · tendered ${formatCents(p.tenderedCents)}, change ${formatCents(p.changeCents ?? 0)}`}
                    {p.voidedAt && ` · VOIDED: ${p.voidReason ?? ''}`}
                  </span>
                </span>
                <b className={cx('tabular-nums', p.voidedAt && 'line-through')}>{p.kind === 'refund' ? '−' : ''}{formatCents(p.amountCents)}</b>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card variant="outlined" aria-labelledby="rets-title">
        <CardHeader id="rets-title" title="Returns & void" />
        {inv.void && (
          <div className="rounded-shape-small bg-error-container text-on-error-container px-3 py-2 mb-3">
            <p className="text-title-medium">Voided {formatWhen(inv.void.createdAt)} by {inv.void.createdBy ?? '—'}</p>
            <p className="text-body-medium">Reason: {inv.void.reason}</p>
            <p className="text-body-medium">Refunded {formatCents(inv.void.refundCents)} · order {inv.void.jobArchived ? 'cancelled' : 'kept open to re-invoice'}</p>
          </div>
        )}
        {inv.returns.length === 0 ? (!inv.void && <p className="text-body-large text-on-surface-variant">No returns.</p>) : (
          <ul className="divide-y divide-outline-variant">
            {inv.returns.map((r) => (
              <li key={r.id} className="py-2 text-body-large">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <Link className="flex-1 text-primary underline" to={`/pos/returns/${r.id}`}>Return #{r.id}</Link>
                  <b className="tabular-nums">−{formatCents(r.totalCents)}</b>
                </div>
                <p className="text-body-small text-on-surface-variant">
                  {formatWhen(r.createdAt)} · {r.reason} · {r.refundCents > 0 ? `refunded ${formatCents(r.refundCents)} (${methodLabel(r.refundMethod)})` : 'no money back'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
