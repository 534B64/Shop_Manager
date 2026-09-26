// A submitted count (awaiting manager approval: Approve & Post / Send back)
// or a posted one (read-only record). Variances sorted by dollar impact.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Dialog, Icon, TextField, cx } from '../../../components/m3';
import { post } from '../../../lib/api';
import { hasRole } from '../../../lib/session';
import { formatCents, formatDate } from '../../../lib/format';
import { reviewCounts } from '../../../../shared/countReview';
import { useInvSettings } from '../components/lookups';
import { reasonLabel, signed } from '../logic';
import type { CycleCount } from '../types';
import { errorText } from '../../../lib/errorText';

export default function CountResult({ cc, onChanged }: { cc: CycleCount; onChanged: (msg: string) => void }) {
  const t = useInvSettings();
  const lines = cc.lines ?? [];
  const byId = new Map(lines.map((l) => [l.itemId, l]));
  const review = reviewCounts(lines.map((l) => ({ itemId: l.itemId, systemCount: l.systemCount, counted: l.countedQty, unitCostCents: l.unitCostCents })), t);
  const off = review.filter((v) => v.delta !== 0);
  const impact = off.reduce((s, v) => s + (v.impactCents ?? 0) * Math.sign(v.delta), 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendBack, setSendBack] = useState(false);
  const [why, setWhy] = useState('');
  const submitted = cc.status === 'submitted';

  async function act(path: string, body: object, msg: (r: { itemsAdjusted?: number; nextScheduledFor?: string }) => string) {
    setBusy(true); setError(null);
    try {
      const r = await post<{ itemsAdjusted?: number; nextScheduledFor?: string }>(`/api/cycle-counts/${cc.id}/${path}`, body);
      setSendBack(false);
      onChanged(msg(r));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card variant="filled" className={cx(submitted && '!bg-warning-container !text-on-warning-container')} role={submitted ? 'status' : undefined}>
        <div className="flex items-start gap-3">
          <Icon name={submitted ? 'warning' : 'check'} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-title-medium">{submitted ? 'Submitted — awaiting manager approval' : 'Posted'}</p>
            <p className="text-body-medium">
              Counted by {cc.submittedBy ?? 'unknown'}{cc.submittedAt ? ` on ${new Date(cc.submittedAt).toLocaleString()}` : ''}.
              {submitted
                ? ' On-hand doesn’t change until it’s posted. Posting books each difference as it was at count time, so sales since then aren’t lost.'
                : ` Posted${cc.postedBy ? ` by ${cc.postedBy}` : ''}${cc.completedAt ? ` on ${formatDate(cc.completedAt)}` : ''}. ${cc.notes ?? ''}`}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <p className="text-title-medium mb-1">{lines.length} item(s) counted · {off.length} with a difference</p>
        {off.length > 0 && <p className="text-body-medium text-on-surface-variant mb-2">Net value of the differences: {formatCents(impact)}</p>}
        {off.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-body-medium">
              <caption className="sr-only">Differences, biggest dollar impact first</caption>
              <thead><tr className="text-left text-on-surface-variant">
                <th scope="col" className="font-normal py-1">Item</th>
                <th scope="col" className="font-normal py-1 text-right">System → counted</th>
                <th scope="col" className="font-normal py-1 text-right">Difference</th>
                <th scope="col" className="font-normal py-1 text-right">Impact</th>
                <th scope="col" className="font-normal py-1 pl-3">Reason</th>
              </tr></thead>
              <tbody>
                {off.map((v) => {
                  const l = byId.get(v.itemId)!;
                  return (
                    <tr key={v.itemId} className="border-t border-outline-variant align-top">
                      <td className="py-2"><Link className="text-on-surface hover:underline" to={`/inventory/${v.itemId}`}>{l.name}</Link></td>
                      <td className="py-2 text-right tabular-nums whitespace-nowrap">{v.systemCount} → {v.counted}</td>
                      <td className="py-2 text-right tabular-nums whitespace-nowrap">{signed(v.delta)}{v.aboveThreshold && <span className="text-warning inline-flex align-middle ml-1"><Icon name="warning" size={14} title="Above threshold" /></span>}</td>
                      <td className="py-2 text-right tabular-nums">{v.impactCents != null ? formatCents(v.impactCents) : '—'}</td>
                      <td className="py-2 pl-3 text-on-surface-variant">{[l.reasonCode && reasonLabel(l.reasonCode), l.note].filter(Boolean).join(' — ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {off.length === 0 && <p className="text-body-medium text-on-surface-variant">No differences — everything matched.</p>}
      </Card>

      {submitted && (
        <div className="flex flex-wrap justify-end gap-2">
          {hasRole('manager') && <Button variant="outlined" touch disabled={busy} onClick={() => { setWhy(''); setSendBack(true); }}>Send back for recount</Button>}
          <Button touch disabled={busy} onClick={() => act('post', {}, (r) => `Count posted — ${r.itemsAdjusted} item(s) adjusted. Next count ${r.nextScheduledFor}.`)}>
            {busy ? 'Posting…' : 'Approve & post'}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-body-medium text-error text-right">{error}</p>}
      <Dialog open={sendBack} onClose={() => !busy && setSendBack(false)} title="Send back for a recount" dismissOnScrim={false}
        description="The count goes back to counting. What was submitted stays on record."
        actions={<>
          <Button variant="text" disabled={busy} onClick={() => setSendBack(false)}>Cancel</Button>
          <Button variant="text" disabled={busy} onClick={() => act('send-back', why.trim() ? { reason: why.trim() } : {}, () => 'Sent back for a recount')}>Send back</Button>
        </>}>
        <TextField label="Why? (optional)" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} data-autofocus />
      </Dialog>
    </div>
  );
}
