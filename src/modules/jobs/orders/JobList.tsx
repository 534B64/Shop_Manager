// Every job as a server-paged table: search + status filter; a row opens the job.
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, EmptyState, Select, type Column } from '../../../components/m3';
import { usePaged } from '../../../lib/query';
import { formatCents, formatDate } from '../../../lib/format';
import type { Job } from '../../../lib/types';
import { PROOF_STATUSES, SIMPLE_STATUSES, STATUS_LABELS, type JobStatus } from '../../../../shared/domain';
import { jobTotal } from '../types';

const STATUSES = [...new Set<JobStatus>([...PROOF_STATUSES.slice(0, 3), ...SIMPLE_STATUSES])];

const columns: Column<Job>[] = [
  { key: 'po', header: 'PO', width: 'w-28', render: (j) => j.po ?? `#${j.id}` },
  { key: 'title', header: 'Job', render: (j) => <Link to={`/quotes/${j.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{j.title}</Link> },
  { key: 'customer', header: 'Customer', hideOnNarrow: true, render: (j) => j.customerName ?? '—' },
  { key: 'status', header: 'Status', render: (j) => STATUS_LABELS[j.status as JobStatus] ?? j.status },
  { key: 'due', header: 'Due', hideOnNarrow: true, render: (j) => formatDate(j.dueDate) },
  { key: 'total', header: 'Total', align: 'right', render: (j) => { const t = jobTotal(j); return t != null ? formatCents(t) : '—'; } },
];

export default function JobList({ q, status, onStatus }: { q: string; status: string; onStatus: (s: string) => void }) {
  const navigate = useNavigate();
  const jobs = usePaged<Job>('/api/jobs', { q, status }, { pageSize: 25 });
  return (
    <div className="flex flex-col gap-3">
      <Select label="Status" value={status} onChange={(e) => onStatus(e.target.value)} className="max-w-xs">
        <option value="">All statuses</option>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </Select>
      <DataTable label="Jobs" columns={columns} rows={jobs.rows} rowKey={(j) => j.id} loading={jobs.loading}
        error={jobs.error} onRetry={jobs.reload} paging={jobs} onRowClick={(j) => navigate(`/quotes/${j.id}`)}
        empty={<EmptyState title={q || status ? 'No jobs match' : 'No jobs yet'} />} />
    </div>
  );
}
