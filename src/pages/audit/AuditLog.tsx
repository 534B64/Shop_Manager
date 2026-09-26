import { useEffect, useState } from 'react';
import { Button, DataTable, Select, TextField, showSnackbar, type Column } from '../../components/m3';
import DateRangeFields from '../../components/DateRangeFields';
import KeysetPager from '../../components/KeysetPager';
import { download } from '../../lib/api';
import { useKeyset } from '../../lib/keysetPaging';
import { withParams } from '../../lib/query';
import { errorText } from '../../lib/errorText';
import { ENTITIES, when, type AuditRow } from './logic';
import ChangeDialog from './ChangeDialog';
import type { UserName } from './Audit';

export default function AuditLog({ params, set, users, names }: {
  params: URLSearchParams; set: (p: Record<string, string>) => void; users: UserName[]; names: Map<number, string>;
}) {
  const f = { entity: params.get('entity') ?? '', entityId: params.get('entityId') ?? '', userId: params.get('userId') ?? '',
    from: params.get('from') ?? '', to: params.get('to') ?? '' };
  const [idText, setIdText] = useState(f.entityId);
  useEffect(() => {
    const t = setTimeout(() => { if (idText.trim() !== f.entityId) set({ entityId: idText.trim() }); }, 300);
    return () => clearTimeout(t);
  }, [idText]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = !!(f.from && f.to && f.from > f.to);
  const log = useKeyset<AuditRow>(bad ? null : '/api/audit', f, 50);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function csv() {
    setBusy(true);
    try { await download(withParams('/api/audit.csv', f), 'audit-log.csv'); }
    catch (e) { showSnackbar(errorText(e, 'Download failed')); }
    finally { setBusy(false); }
  }

  const cols: Column<AuditRow>[] = [
    { key: 'at', header: 'When', render: (r) => <span className="whitespace-nowrap">{when(r.at)}</span> },
    { key: 'user', header: 'Who', render: (r) => (r.userId == null ? 'System' : names.get(r.userId) ?? `User ${r.userId}`) },
    { key: 'action', header: 'Action', render: (r) => <span className="font-mono text-body-small">{r.action}</span> },
    { key: 'entity', header: 'Record', hideOnNarrow: true, render: (r) => `${r.entity}${r.entityId ? ` #${r.entityId}` : ''}` },
    { key: 'approval', header: 'Approval', hideOnNarrow: true, render: (r) => (r.approvalId ? `#${r.approvalId}` : '—') },
    { key: 'details', header: <span className="sr-only">Details</span>, align: 'right', render: (r) => (
      <Button variant="text" onClick={() => setOpen(r)} aria-label={`Before and after for change ${r.id}`}>Before / after</Button>) },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <Select label="Record type" variant="outlined" className="w-48" value={f.entity} onChange={(e) => set({ entity: e.target.value })}>
          <option value="">All</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </Select>
        <TextField label="Record #" variant="outlined" className="w-32" value={idText} onChange={(e) => setIdText(e.target.value)} />
        <Select label="Who" variant="outlined" className="w-48" value={f.userId} onChange={(e) => set({ userId: e.target.value })}>
          <option value="">Anyone</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <DateRangeFields value={{ from: f.from, to: f.to }} onChange={(r) => set({ from: r.from, to: r.to })} />
        <span className="flex-1" />
        <Button variant="tonal" onClick={csv} disabled={busy || bad} className="mt-2">{busy ? 'Downloading…' : 'Export CSV'}</Button>
      </div>
      <DataTable label="Audit log" columns={cols} rows={bad ? [] : log.rows} rowKey={(r) => r.id}
        loading={log.loading} error={bad ? '“From” is after “To”.' : log.error} onRetry={log.reload}
        empty={<p className="p-6 text-center text-body-medium text-on-surface-variant">No changes match these filters.</p>} />
      <KeysetPager paging={log} />
      <ChangeDialog row={open} onClose={() => setOpen(null)} who={open?.userId != null ? names.get(open.userId) : undefined} />
    </div>
  );
}
