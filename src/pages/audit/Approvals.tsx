import { DataTable, Select, type Column } from '../../components/m3';
import DateRangeFields from '../../components/DateRangeFields';
import KeysetPager from '../../components/KeysetPager';
import { useKeyset } from '../../lib/keysetPaging';
import { ACTION_LABELS } from '../../lib/approvalLabels';
import { prettyJson, when, type ApprovalRow } from './logic';
import type { UserName } from './Audit';

/** Who approved what — GET /api/approvals (admin). */
export default function Approvals({ params, set, users }: {
  params: URLSearchParams; set: (p: Record<string, string>) => void; users: UserName[];
}) {
  const f = { action: params.get('action') ?? '', userId: params.get('userId') ?? '',
    from: params.get('from') ?? '', to: params.get('to') ?? '' };
  const bad = !!(f.from && f.to && f.from > f.to);
  const list = useKeyset<ApprovalRow>('/api/approvals', f, 50);
  const self = (r: ApprovalRow) => r.requestedBy === r.approvedBy;

  const cols: Column<ApprovalRow>[] = [
    { key: 'at', header: 'When', render: (r) => <span className="whitespace-nowrap">{when(r.createdAt)}</span> },
    { key: 'action', header: 'What', render: (r) => (
      <span><span className="block">{ACTION_LABELS[r.action] ?? r.action}</span>
        <span className="block text-body-small text-on-surface-variant">{r.entity}{r.entityId ? ` #${r.entityId}` : ''}</span></span>) },
    { key: 'by', header: 'Approved by', render: (r) => (
      <span><span className="block">{r.approvedByName ?? `User ${r.approvedBy}`}</span>
        <span className="block text-body-small text-on-surface-variant">
          {self(r) ? 'on their own authority' : `for ${r.requestedByName ?? `user ${r.requestedBy}`}`}</span></span>) },
    { key: 'reason', header: 'Reason', hideOnNarrow: true, render: (r) => r.reason || '—' },
    { key: 'details', header: 'Details', hideOnNarrow: true, render: (r) => (r.details
      ? <pre className="font-mono text-body-small whitespace-pre-wrap break-all max-w-xs">{prettyJson(r.details)}</pre> : '—') },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <Select label="Action" variant="outlined" className="w-72" value={f.action} onChange={(e) => set({ action: e.target.value })}>
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label="Person (asked or approved)" variant="outlined" className="w-56" value={f.userId} onChange={(e) => set({ userId: e.target.value })}>
          <option value="">Anyone</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <DateRangeFields value={{ from: f.from, to: f.to }} onChange={(r) => set({ from: r.from, to: r.to })} />
      </div>
      <DataTable label="Approvals" columns={cols} rows={bad ? [] : list.rows} rowKey={(r) => r.id}
        loading={list.loading} error={bad ? '“From” is after “To”.' : list.error} onRetry={list.reload}
        empty={<p className="p-6 text-center text-body-medium text-on-surface-variant">No approvals match these filters.</p>} />
      <KeysetPager paging={list} />
    </div>
  );
}
