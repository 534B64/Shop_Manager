import { Link, useNavigate } from 'react-router-dom';
import { DataTable, EmptyState, type Column } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import KeysetPager from '../../../components/KeysetPager';
import { formatWhen } from '../lib/when';
import type { DrawerSession } from '../types';
import OverShortBadge from './OverShortBadge';
import { useKeyset } from '../../../lib/keysetPaging';

const COLS: Column<DrawerSession>[] = [
  { key: 'id', header: 'Drawer', render: (d) => <Link className="text-primary underline" to={`/pos/drawer/${d.id}`} onClick={(e) => e.stopPropagation()}>#{d.id}</Link>, width: 'w-24' },
  { key: 'openedAt', header: 'Opened', render: (d) => formatWhen(d.openedAt) },
  { key: 'closedAt', header: 'Closed', render: (d) => (d.status === 'open' ? 'Open now' : formatWhen(d.closedAt)), hideOnNarrow: true },
  { key: 'float', header: 'Float', align: 'right', render: (d) => formatCents(d.openingFloatCents), hideOnNarrow: true },
  { key: 'expected', header: 'Expected cash', align: 'right', render: (d) => (d.expectedCashCents != null ? formatCents(d.expectedCashCents) : '—'), hideOnNarrow: true },
  { key: 'counted', header: 'Counted', align: 'right', render: (d) => (d.countedCashCents != null ? formatCents(d.countedCashCents) : '—') },
  { key: 'os', header: 'Over / short', render: (d) => (d.status === 'open' ? '—' : <OverShortBadge cents={d.overShortCents} />) },
];

/** Past drawer sessions, newest first (keyset paged). Tap one for its Z-report. */
export default function DrawerHistory() {
  const nav = useNavigate();
  const list = useKeyset<DrawerSession>('/api/drawer', {}, 20);
  return (
    <div>
      <DataTable label="Drawer history" columns={COLS} rows={list.rows} rowKey={(d) => d.id}
        loading={list.loading} error={list.error} onRetry={list.reload}
        empty={<EmptyState title="No drawer sessions yet">Open the drawer to start the first one.</EmptyState>}
        onRowClick={(d) => nav(`/pos/drawer/${d.id}`)} />
      {(list.hasPrev || list.hasNext) && <KeysetPager paging={list} touch />}
    </div>
  );
}
