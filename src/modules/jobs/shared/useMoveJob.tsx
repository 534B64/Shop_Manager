// One-step status moves (board cards and the job page). Picking up with a
// balance due asks first, then retries as an override — a cashier gets the
// shared manager-approval dialog from api.ts, the server logs who approved.
import { useState } from 'react';
import { Button, Dialog, showSnackbar } from '../../../components/m3';
import { ApiError, post, put } from '../../../lib/api';
import { formatCents } from '../../../lib/format';
import { STATUS_LABELS, type JobStatus } from '../../../../shared/domain';
import { errorText } from './errors';

interface Target { id: number; title: string }

export function useMoveJob(onDone: () => void) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [owed, setOwed] = useState<{ job: Target; cents: number } | null>(null);

  async function move(job: Target, to: JobStatus, convert = false) {
    setBusyId(job.id);
    try {
      if (convert) await post(`/api/jobs/${job.id}/convert`, {});
      else await put(`/api/jobs/${job.id}/status`, { status: to });
      showSnackbar(`${job.title} → ${STATUS_LABELS[to]}`);
      onDone();
    } catch (e) {
      if (to === 'picked_up' && e instanceof ApiError && e.status === 402) {
        setOwed({ job, cents: Number(e.data.owedCents) || 0 });
      } else showSnackbar(errorText(e, 'Couldn’t move it — try again.'));
    } finally { setBusyId(null); }
  }

  async function release() {
    if (!owed) return;
    const { job } = owed;
    setOwed(null); setBusyId(job.id);
    try {
      await put(`/api/jobs/${job.id}/status`, { status: 'picked_up', override: true });
      showSnackbar(`${job.title} released with a balance due`);
      onDone();
    } catch (e) { showSnackbar(errorText(e, 'Release failed.')); }
    finally { setBusyId(null); }
  }

  const dialog = (
    <Dialog open={!!owed} onClose={() => setOwed(null)} title="Balance due"
      description={owed ? `${owed.job.title} still owes ${formatCents(owed.cents)}.` : undefined}
      actions={<>
        <Button variant="text" onClick={() => setOwed(null)}>Keep it</Button>
        <Button variant="danger" onClick={release}>Release anyway</Button>
      </>}>
      <p className="text-body-medium">Take the payment first if you can. Releasing it unpaid needs a manager’s approval and is noted on the order.</p>
    </Dialog>
  );

  return { move, busyId, dialog };
}
