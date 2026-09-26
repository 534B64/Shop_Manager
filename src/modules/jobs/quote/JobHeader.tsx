// A saved job's header: PO, status + one-step moves, balance, print, remove.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Dialog, showSnackbar } from '../../../components/m3';
import { del } from '../../../lib/api';
import { formatCents, formatDate } from '../../../lib/format';
import { STATUS_LABELS, type JobStatus } from '../../../../shared/domain';
import CopyPo from '../shared/CopyPo';
import { errorText } from '../shared/errors';
import { jobMoves } from '../shared/jobLogic';
import { useMoveJob } from '../shared/useMoveJob';
import type { JobDetail } from '../types';

export default function JobHeader({ job, onChanged }: { job: JobDetail; onChanged: () => void }) {
  const navigate = useNavigate();
  const mover = useMoveJob(onChanged);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { back, forward } = jobMoves(job);
  const busy = mover.busyId === job.id;

  async function remove() {
    setRemoving(true);
    try {
      await del(`/api/jobs/${job.id}`, {});
      showSnackbar(`${job.title} removed — the record stays for the books`);
      navigate('/orders');
    } catch (e) { showSnackbar(errorText(e, 'Remove failed.')); setConfirmRemove(false); }
    finally { setRemoving(false); }
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-headline-medium flex flex-wrap items-center gap-3">
          <span>{job.po ?? `Job #${job.id}`}</span>
          <Badge tone={job.status === 'picked_up' ? 'neutral' : 'primary'} className="!h-7 px-3 text-label-large">
            {STATUS_LABELS[job.status as JobStatus] ?? job.status}
          </Badge>
        </h1>
        <p className="text-body-medium text-on-surface-variant">
          {job.useProofFlow ? 'Proof flow' : 'Simple flow'} · by {job.createdBy ?? '—'} · {formatDate(job.createdAt)}
          {job.owedCents > 0 && job.status !== 'quote' && <> · <span className="text-error">{formatCents(job.owedCents)} due</span></>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {back && <Button variant="outlined" disabled={busy} onClick={() => mover.move(job, back)}>← {STATUS_LABELS[back]}</Button>}
        {forward && <Button disabled={busy} onClick={() => mover.move(job, forward.to, forward.convert)}>{forward.label} →</Button>}
        {job.owedCents > 0 && job.status !== 'quote' && <Button variant="tonal" to="/payments">Take payment</Button>}
        <CopyPo po={job.po} />
        <Button variant="outlined" onClick={() => window.print()}>Print</Button>
        {!job.invoice && <Button variant="text" onClick={() => setConfirmRemove(true)}>Remove</Button>}
      </div>
      {mover.dialog}
      <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove this order?"
        description="It leaves the board and lists; the record stays for the books and can be restored. Needs a manager."
        actions={<>
          <Button variant="text" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          <Button variant="danger" disabled={removing} onClick={remove}>Remove</Button>
        </>} />
    </div>
  );
}
