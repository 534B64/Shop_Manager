// /quotes/new and /quotes/:id — quote a job, or open a saved one by id.
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, EmptyState, LinearProgress } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import type { JobDetail } from '../types';
import { draftFromJob, draftSig, type QuoteDraft } from './draft';
import { clearJobDraft, loadJobDraft, loadNewDraft } from './storage';
import QuoteEditor from './QuoteEditor';
import JobHeader from './JobHeader';
import PrintSheet from './PrintSheet';

export default function QuotePage() {
  const { id } = useParams();
  if (id === undefined) return <NewQuote />;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return <Missing />;
  return <SavedJob key={jobId} jobId={jobId} />;
}

function NewQuote() {
  const initial = useMemo(loadNewDraft, []);
  return (
    <div>
      <h1 className="text-headline-medium">New quote</h1>
      <p className="text-body-medium text-on-surface-variant mb-4">Pick the material, size and qty per line — the estimator suggests, you set the price.</p>
      <QuoteEditor job={null} initial={initial} onSaved={() => {}} />
    </div>
  );
}

function SavedJob({ jobId }: { jobId: number }) {
  const q = useQuery<JobDetail>(`/api/jobs/${jobId}`);
  const [restored, setRestored] = useState<QuoteDraft | null>(null);
  const [asked, setAsked] = useState(false);
  const job = q.data;
  const stored = useMemo(() => (job ? loadJobDraft(jobId) : null), [job, jobId]);
  const serverDraft = useMemo(() => (job ? draftFromJob(job) : null), [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job) {
    if (q.error) return <Missing message={q.error} onRetry={q.reload} />;
    return <LinearProgress label="Loading the job" />;
  }
  const offerRestore = !asked && !restored && stored && serverDraft && draftSig(stored) !== draftSig(serverDraft);
  return (
    <div>
      <JobHeader job={job} onChanged={q.reload} />
      {offerRestore && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-shape-medium bg-tertiary-container text-on-tertiary-container p-4 mb-4">
          <p className="flex-1 text-body-medium">This PC has unsaved changes to this job from earlier.</p>
          <Button variant="text" className="!text-on-tertiary-container" onClick={() => { clearJobDraft(jobId); setAsked(true); }}>Discard</Button>
          <Button onClick={() => { setRestored(stored); setAsked(true); }}>Restore</Button>
        </div>
      )}
      <QuoteEditor key={restored ? 'restored' : 'server'} job={job} initial={restored ?? serverDraft!} onSaved={q.reload} />
      <PrintSheet job={job} />
    </div>
  );
}

function Missing({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState tone={message ? 'error' : 'neutral'} icon="warning" title="Couldn’t open this job"
      action={<div className="flex gap-2">{onRetry && <Button variant="outlined" onClick={onRetry}>Try again</Button>}<Button to="/orders">Go to Orders</Button></div>}>
      {message ?? 'That job number doesn’t look right.'}
    </EmptyState>
  );
}
