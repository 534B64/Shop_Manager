// Quick lookup beside the quote form: newest jobs, searchable (server-side `q`).
import { useEffect, useState } from 'react';
import { Card, CardHeader, EmptyState, LinearProgress, List, ListItem, Pager, TextField } from '../../../components/m3';
import { usePaged } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import type { Job } from '../../../lib/types';
import { STATUS_LABELS, type JobStatus } from '../../../../shared/domain';
import { jobTotal } from '../types';

export default function RecentJobs() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const jobs = usePaged<Job>('/api/jobs', { q }, { pageSize: 6 });
  return (
    <Card variant="outlined" aria-labelledby="recent-jobs-h" padded={false} className="pt-4">
      <div className="px-4"><CardHeader id="recent-jobs-h" title="Recent jobs" /></div>
      <TextField className="px-4" label="Search title / PO / tag / customer" leadingIcon="search" value={text}
        onChange={(e) => setText(e.target.value)} />
      <div className="h-1 mt-2">{jobs.loading && <LinearProgress label="Loading recent jobs" />}</div>
      {jobs.error && <EmptyState tone="error" icon="warning" title="Couldn’t load">{jobs.error}</EmptyState>}
      {!jobs.error && !jobs.loading && jobs.rows.length === 0 && <EmptyState title="No jobs found" />}
      <List label="Recent jobs" className="py-0">
        {jobs.rows.map((j) => {
          const total = jobTotal(j);
          return (
            <ListItem key={j.id} to={`/quotes/${j.id}`} headline={j.title}
              supportingText={`${j.customerName ?? '—'} · ${j.po ?? ''} · ${STATUS_LABELS[j.status as JobStatus] ?? j.status}`}
              trailing={total != null ? formatCents(total) : '—'} />
          );
        })}
      </List>
      {jobs.total > jobs.pageSize && <Pager paging={jobs} />}
    </Card>
  );
}
