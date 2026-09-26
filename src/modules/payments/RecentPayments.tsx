import { Button, DataTable, EmptyState, cx, type Column } from '../../components/m3';
import { usePaged } from '../../lib/query';
import { formatCents } from '../../lib/format';
import { formatWhen } from '../pos/lib/when';
import { methodLabel, type PaymentRow } from '../pos/types';

/** Payment + refund rows, newest first (server-paged, searchable), with Refund / Void. */
export default function RecentPayments({ q, version, onRefund, onVoid }: {
  q: string; version: number; onRefund: (p: PaymentRow) => void; onVoid: (p: PaymentRow) => void;
}) {
  const list = usePaged<PaymentRow>('/api/payments', { q, v: version || undefined }, { pageSize: 20 });
  const cols: Column<PaymentRow>[] = [
    { key: 'job', header: 'Job', render: (p) => (
      <span className={cx(p.voidedAt && 'line-through text-on-surface-variant')}>
        {p.jobTitle ?? '—'}
        <span className="block text-body-small text-on-surface-variant no-underline">
          {p.customerName ?? '—'} · {methodLabel(p.method)}{p.kind === 'refund' ? ' · REFUND' : ''}{p.voidedAt ? ` · VOIDED${p.voidReason ? `: ${p.voidReason}` : ''}` : ''}
          {p.tenderedCents != null ? ` · tendered ${formatCents(p.tenderedCents)}, change ${formatCents(p.changeCents ?? 0)}` : ''}
        </span>
      </span>) },
    { key: 'when', header: 'When', render: (p) => formatWhen(p.createdAt), hideOnNarrow: true },
    { key: 'amt', header: 'Amount', align: 'right', render: (p) => (
      <b className={cx('tabular-nums', p.kind === 'refund' && !p.voidedAt && 'text-error', p.voidedAt && 'line-through text-on-surface-variant')}>
        {p.kind === 'refund' ? '−' : ''}{formatCents(p.amountCents)}</b>) },
    { key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', render: (p) => !p.voidedAt && (
      <span className="inline-flex gap-1">
        {p.kind === 'payment' && <Button variant="outlined" touch onClick={() => onRefund(p)} aria-label={`Refund ${formatCents(p.amountCents)} on ${p.jobTitle ?? 'job'}`}>Refund</Button>}
        <Button variant="text" touch onClick={() => onVoid(p)} aria-label={`Void ${p.kind} of ${formatCents(p.amountCents)}`}>Void</Button>
      </span>) },
  ];
  return (
    <DataTable label="Recent payments" columns={cols} rows={list.rows} rowKey={(p) => p.id} paging={list}
      loading={list.loading} error={list.error} onRetry={list.reload}
      empty={<EmptyState title={q ? 'No payments match' : 'No payments recorded yet'} />} />
  );
}
