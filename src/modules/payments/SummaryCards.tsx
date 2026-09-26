// Today's total and the date-range report (+ CSV exports via the authenticated download).
import { useState } from 'react';
import { Button, Card, CardHeader, Chip, EmptyState, LinearProgress, TextField, showSnackbar } from '../../components/m3';
import { download } from '../../lib/api';
import { useQuery, withParams } from '../../lib/query';
import { formatCents } from '../../lib/format';
import { lastDays, todayIso } from '../pos/lib/when';
import { methodLabel } from '../pos/types';
import type { Summary } from './logic';
import { errorText } from '../../lib/errorText';

const save = (path: string, name: string) => download(path, name).catch((e) => showSnackbar(`Download failed: ${errorText(e)}`));

export function TodayCard({ version }: { version: number }) {
  const t = todayIso();
  const q = useQuery<Summary>(withParams('/api/reports/summary', { from: t, to: t, v: version || undefined }));
  return (
    <Card variant="outlined" aria-labelledby="today-title">
      <CardHeader id="today-title" title="Today" subtitle={q.data && `${q.data.count} entr${q.data.count === 1 ? 'y' : 'ies'} (payments − refunds)`}
        action={<Button variant="text" touch onClick={() => save('/api/reports/jobs.csv', 'jobs.csv')}>All jobs CSV</Button>} />
      <div className="h-1">{q.loading && <LinearProgress label="Loading today" />}</div>
      {q.error ? <EmptyState tone="error" icon="warning" title="Couldn’t load today" action={<Button variant="outlined" onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>
        : <p className="text-display-small tabular-nums">{q.data ? formatCents(q.data.netCents) : '—'}</p>}
    </Card>
  );
}

export function ReportsCard({ version }: { version: number }) {
  const [range, setRange] = useState(() => lastDays(1));
  const q = useQuery<Summary>(withParams('/api/reports/summary', { ...range, v: version || undefined }));
  const s = q.data;
  const Stat = ({ k, v, tone }: { k: string; v: string | number; tone?: string }) => (
    <div><p className="text-body-medium text-on-surface-variant">{k}</p><p className={`text-headline-small tabular-nums ${tone ?? ''}`}>{v}</p></div>
  );
  return (
    <Card variant="outlined" aria-labelledby="reports-title">
      <CardHeader id="reports-title" title="Reports"
        action={<Button variant="text" touch onClick={() => save(withParams('/api/reports/payments.csv', range), 'payments.csv')}>Payments CSV</Button>} />
      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Quick ranges">
        {[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([d, l]) => {
          const r = lastDays(d as number);
          return <Chip key={d} kind="filter" touch selected={r.from === range.from && r.to === range.to} onClick={() => setRange(r)}>{l}</Chip>;
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3 max-w-md">
        <TextField label="From" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <TextField label="To" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      </div>
      <div className="h-1">{q.loading && <LinearProgress label="Loading the report" />}</div>
      {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load the report" action={<Button variant="outlined" onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>}
      {s && (
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Stat k="Net" v={formatCents(s.netCents)} />
          <Stat k="Payments" v={formatCents(s.paymentsCents)} tone="text-success" />
          <Stat k="Refunds" v={`−${formatCents(s.refundsCents)}`} tone="text-error" />
          {Object.entries(s.byMethod).map(([m, c]) => <Stat key={m} k={methodLabel(m)} v={formatCents(c)} />)}
          <Stat k="Entries" v={s.count} />
        </div>
      )}
    </Card>
  );
}
