// /inventory/counts — the open cycle count (schedule / start / continue /
// review) and the history of past counts.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, CardHeader, DataTable, Dialog, EmptyState, LinearProgress, TextField, showSnackbar, type Column } from '../../../components/m3';
import { post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { formatDate } from '../../../lib/format';
import InventoryHeader from '../components/InventoryHeader';
import CountBanner, { todayIso } from '../components/CountBanner';
import { useUrlPaged } from '../components/useUrlPaged';
import type { CycleCount } from '../types';
import { enteredIds, loadDraft } from './draft';
import { errorText } from '../../../lib/errorText';

const STATUS = { counting: 'Counting', submitted: 'Awaiting approval', posted: 'Posted' } as const;

const COLS: Column<CycleCount>[] = [
  { key: 'id', header: 'Count', render: (c) => <Link to={`/inventory/counts/${c.id}`} onClick={(e) => e.stopPropagation()} className="text-title-small text-on-surface hover:underline">#{c.id}</Link> },
  { key: 'when', header: 'Scheduled', render: (c) => formatDate(c.scheduledFor) },
  { key: 'status', header: 'Status', render: (c) => STATUS[c.status] ?? c.status },
  { key: 'by', header: 'Counted by', hideOnNarrow: true, render: (c) => c.submittedBy ?? '—' },
  { key: 'posted', header: 'Posted', hideOnNarrow: true, render: (c) => (c.completedAt ? `${formatDate(c.completedAt)}${c.postedBy ? ` · ${c.postedBy}` : ''}` : '—') },
  { key: 'notes', header: 'Notes', hideOnNarrow: true, render: (c) => <span className="text-on-surface-variant">{c.notes ?? ''}</span> },
];

export default function Counts() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const page = Math.max(0, (Number(sp.get('page')) || 1) - 1);
  const next = useQuery<CycleCount | null>('/api/cycle-counts/next');
  const history = useUrlPaged<CycleCount>('/api/cycle-counts', {}, page, (p) => setSp(p > 0 ? { page: String(p + 1) } : {}), { pageSize: 25 });
  const [scheduling, setScheduling] = useState(false);
  const cc = next.data;
  const draftCount = cc ? enteredIds(loadDraft(cc.id)).length : 0;

  return (
    <div>
      <InventoryHeader title="Cycle counts"
        subtitle="The weekly recount: count blind, review the differences, and a manager posts it." />
      <Card className="mb-6">
        <CardHeader title="Current count" />
        <div className="h-1 -mt-1 mb-2">{next.loading && <LinearProgress label="Loading current count" />}</div>
        {next.error && <p role="alert" className="text-body-medium text-error">{next.error}</p>}
        {next.data === null && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-body-large">No count is scheduled.</p>
            <Button onClick={() => setScheduling(true)}>Schedule a count</Button>
          </div>
        )}
        {cc && cc.status !== 'counting' && <CountBanner />}
        {cc && cc.status === 'counting' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-body-large">
              Count #{cc.id} · {cc.scheduledFor <= todayIso() ? 'due now' : `scheduled ${formatDate(cc.scheduledFor)}`}
              {draftCount > 0 && <span className="block text-body-medium text-on-surface-variant">{draftCount} item(s) already counted on this device</span>}
              {cc.notes?.startsWith('Sent back') && <span className="block text-body-medium text-warning">{cc.notes}</span>}
            </p>
            <Button touch to={`/inventory/counts/${cc.id}`}>{draftCount > 0 ? 'Continue counting' : 'Start counting'}</Button>
          </div>
        )}
      </Card>

      <h2 className="text-title-large mb-2">History</h2>
      <DataTable label="Past cycle counts" columns={COLS} rows={history.rows} rowKey={(c) => c.id}
        loading={history.loading} error={history.error} onRetry={history.reload} paging={history}
        onRowClick={(c) => nav(`/inventory/counts/${c.id}`)}
        empty={<EmptyState title="No counts yet">Schedule the first one above.</EmptyState>} />
      <ScheduleDialog open={scheduling} onClose={() => setScheduling(false)}
        onDone={(c) => { setScheduling(false); showSnackbar(`Count scheduled for ${formatDate(c.scheduledFor)}`); next.reload(); history.reload(); }} />
    </div>
  );
}

function ScheduleDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (c: CycleCount) => void }) {
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setSaving(true); setError(null);
    try { onDone(await post<CycleCount>('/api/cycle-counts', { scheduledFor: date })); } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }
  return (
    <Dialog open={open} onClose={() => !saving && onClose()} title="Schedule a cycle count"
      actions={<>
        <Button variant="text" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button variant="text" disabled={saving || !/^\d{4}-\d{2}-\d{2}$/.test(date)} onClick={save}>{saving ? 'Scheduling…' : 'Schedule'}</Button>
      </>}>
      <TextField label="Count on" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-autofocus />
      <p className="mt-2 text-body-small text-on-surface-variant">After a count is posted, the next one is scheduled automatically (a week later unless you pick a date).</p>
      {error && <p role="alert" className="mt-2 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
