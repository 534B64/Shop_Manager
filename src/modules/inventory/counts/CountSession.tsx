// /inventory/counts/:id — one cycle count: blind entry → review (?step=review)
// while counting; the approval step once submitted; the record once posted.
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, EmptyState, LinearProgress, showSnackbar } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import { formatDate } from '../../../lib/format';
import InventoryHeader from '../components/InventoryHeader';
import type { CycleCount } from '../types';
import CountEntry from './CountEntry';
import CountReview from './CountReview';
import CountResult from './CountResult';
import { clearDraft } from './draft';
import { useDraft } from './useDraft';

export default function CountSession() {
  const { id } = useParams();
  const countId = Number(id);
  const [sp, setSp] = useSearchParams();
  const q = useQuery<CycleCount>(`/api/cycle-counts/${id}`);
  const [draft, setDraft] = useDraft(countId);
  const cc = q.data?.id === countId ? q.data : undefined;
  const step = sp.get('step') === 'review' ? 'review' : 'entry';
  const go = (s: 'entry' | 'review') => { setSp(s === 'review' ? { step: 'review' } : {}); window.scrollTo(0, 0); };
  const changed = (msg: string) => { showSnackbar(msg); q.reload(); };

  const title = cc ? `Cycle count #${cc.id}` : 'Cycle count';
  const subtitle = cc && `Scheduled ${formatDate(cc.scheduledFor)} · ${cc.status === 'counting' ? (step === 'review' ? 'Review' : 'Counting') : cc.status === 'submitted' ? 'Awaiting approval' : 'Posted'}`;
  return (
    <div>
      <InventoryHeader title={title} subtitle={subtitle} />
      {!cc && q.loading && <LinearProgress label="Loading cycle count" />}
      {!cc && q.error && <EmptyState tone="error" icon="warning" title="Couldn’t open this count"
        action={<Button variant="outlined" onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>}
      {cc?.status === 'counting' && (step === 'review'
        ? <CountReview cc={cc} draft={draft} setDraft={setDraft} onBack={() => go('entry')}
            onSubmitted={(msg) => { clearDraft(cc.id); setDraft({ lines: {}, reasons: {}, notes: {}, next: '' }); setSp({}, { replace: true }); changed(msg); }} />
        : <CountEntry cc={cc} draft={draft} setDraft={setDraft} onReview={() => go('review')} />)}
      {cc && cc.status !== 'counting' && <CountResult cc={cc} onChanged={changed} />}
    </div>
  );
}
