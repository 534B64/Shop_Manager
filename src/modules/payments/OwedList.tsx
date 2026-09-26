import { Button, DataTable, EmptyState, type Column } from '../../components/m3';
import { usePaged } from '../../lib/query';
import { formatCents } from '../../lib/format';
import type { Balance } from './logic';

/** Jobs with a balance, largest first (server-paged, searchable). */
export default function OwedList({ q, version, onPay }: { q: string; version: number; onPay: (b: Balance) => void }) {
  const list = usePaged<Balance>('/api/balances', { q, v: version || undefined }, { pageSize: 20 });
  const cols: Column<Balance>[] = [
    { key: 'title', header: 'Job', render: (b) => <>{b.title}<span className="block text-body-small text-on-surface-variant">{b.customerName ?? '—'}</span></> },
    { key: 'paid', header: 'Paid', align: 'right', hideOnNarrow: true,
      render: (b) => <span className="tabular-nums">{formatCents(b.paidCents)} of {formatCents(b.finalPriceCents ?? 0)}{b.returnedCents > 0 ? ` (−${formatCents(b.returnedCents)} returned)` : ''}</span> },
    { key: 'owed', header: 'Due', align: 'right', render: (b) => <b className="tabular-nums text-title-medium">{formatCents(b.owedCents)}</b> },
    { key: 'act', header: 'Actions', align: 'right',
      render: (b) => <Button touch variant="tonal" onClick={() => onPay(b)} aria-label={`Record payment on ${b.title}`}>Record payment</Button> },
  ];
  return (
    <DataTable label="Owed" columns={cols} rows={list.rows} rowKey={(b) => b.jobId} paging={list}
      loading={list.loading} error={list.error} onRetry={list.reload}
      empty={<EmptyState icon="check" title={q ? 'Nothing owed matches' : 'Nothing owed'}>{q ? 'Try another name.' : 'Every job is paid up.'}</EmptyState>} />
  );
}
