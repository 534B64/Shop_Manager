// The quote / order form. New quotes and edits share it; an invoiced job
// keeps its money fields read-only. Ctrl+Enter saves from anywhere.
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Icon, showSnackbar } from '../../../components/m3';
import type { JobDetail } from '../types';
import { draftFromJob, draftSig, newDraft, type QuoteDraft } from './draft';
import { quoteMath } from './math';
import { clearJobDraft, clearNewDraft, saveJobDraft, saveNewDraft } from './storage';
import { useQuoteRefs } from './useQuoteRefs';
import { useLineStock } from './useLineStock';
import { useSaveQuote } from './useSaveQuote';
import JobSection from './JobSection';
import LinesEditor from './LinesEditor';
import DetailsSection from './DetailsSection';
import PricePanel from './PricePanel';
import InvoiceBanner from './InvoiceBanner';
import RecentJobs from './RecentJobs';

interface Props { job: JobDetail | null; initial: QuoteDraft; onSaved: () => void }

export default function QuoteEditor({ job, initial, onSaved }: Props) {
  const navigate = useNavigate();
  const refs = useQuoteRefs();
  const [draft, setDraft] = useState<QuoteDraft>(initial);
  const [base, setBase] = useState(() => (job ? draftSig(draftFromJob(job)) : ''));
  const set = <K extends keyof QuoteDraft>(k: K, v: QuoteDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const saver = useSaveQuote(job, refs.materials, (c) => set('customer', c));
  const stock = useLineStock(draft.lines, refs.materials);
  const math = useMemo(() => quoteMath(draft, refs.materials, refs.taxRate, refs.levels), [draft, refs.materials, refs.taxRate, refs.levels]);
  const locked = !!job?.invoice;
  const dirty = job ? draftSig(draft) !== base : true;

  // Autosave: the new-quote form always; an edit only while it differs from what's saved.
  useEffect(() => {
    if (!job) saveNewDraft(draft);
    else if (dirty) saveJobDraft(job.id, draft);
    else clearJobDraft(job.id);
  }, [draft, job, dirty]);

  async function create(status: 'quote' | 'acknowledged') {
    const saved = await saver.save(draft, math, status);
    if (!saved) return;
    clearNewDraft();
    showSnackbar(`${status === 'quote' ? 'Quote' : 'Order'} ${saved.po ?? ''} saved`, { actionLabel: 'New quote', onAction: () => navigate('/quotes/new') });
    navigate(`/quotes/${saved.id}`);
  }
  async function saveEdit() {
    if (!job) return;
    const saved = await saver.save(draft, math);
    if (!saved) return;
    const fresh = draftFromJob({ ...job, ...saved });
    setDraft(fresh); setBase(draftSig(fresh)); clearJobDraft(job.id);
    showSnackbar('Changes saved');
    onSaved();
  }
  const primary = () => (job ? saveEdit() : create(draft.useProofFlow ? 'quote' : 'acknowledged'));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !saver.saving) { e.preventDefault(); primary(); }
  };

  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={onKeyDown} noValidate>
      {job?.invoice && <InvoiceBanner number={job.invoice.number} />}
      {refs.error && <p role="alert" className="text-error mb-3">Couldn’t load materials: {refs.error} <button type="button" className="underline" onClick={refs.reload}>Retry</button></p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <JobSection draft={draft} locked={locked} autoFocus={!job} set={set}
            proofEditable={!job || job.status === 'quote'} />
          <LinesEditor lines={draft.lines} jobType={draft.type} materials={refs.materials} suggestions={math.lineSuggestions}
            stock={stock} locked={locked} onLines={(lines) => set('lines', lines)} />
          <DetailsSection draft={draft} po={job?.po ?? null} set={set} />
        </div>
        <div className="flex flex-col gap-4 xl:sticky xl:top-4">
          <Card variant="elevated" aria-label="Price and save">
            <PricePanel draft={draft} math={math} taxRate={refs.taxRate} levels={refs.levels} locked={locked} set={set} />
            {saver.error && (
              <p role="alert" className="mt-3 flex items-start gap-2 text-body-medium text-error">
                <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
                <span>{saver.error}{saver.lockedBy && <> <Link className="underline" to={`/pos/invoices/${saver.lockedBy}`}>Open invoice #{saver.lockedBy}</Link></>}</span>
              </p>
            )}
            {saver.notice && (
              <p role="status" className="mt-3 text-body-medium text-warning">
                {saver.notice} <button type="button" className="underline" onClick={saver.clearNotice}>Dismiss</button>
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              {job ? (
                <Button className="flex-1" disabled={saver.saving || !dirty} onClick={saveEdit}>{saver.saving ? 'Saving…' : 'Save changes'}</Button>
              ) : (<>
                <Button variant={draft.useProofFlow ? 'filled' : 'outlined'} className="flex-1" disabled={saver.saving}
                  onClick={() => create('quote')}>Save as quote</Button>
                {!draft.useProofFlow && (
                  <Button className="flex-1" disabled={saver.saving} onClick={() => create('acknowledged')}>{saver.saving ? 'Saving…' : 'Create order'}</Button>
                )}
              </>)}
            </div>
            <p className="mt-2 text-body-small text-on-surface-variant">
              {job ? (dirty ? 'Unsaved changes are kept on this PC until you save.' : 'All changes saved.')
                : draft.useProofFlow ? 'Proof jobs start as quotes — approve after the customer signs off.' : 'Ctrl+Enter creates the order.'}
            </p>
            {!job && (
              <Button variant="text" className="mt-1 -ml-3" onClick={() => { const before = draft; setDraft(newDraft()); showSnackbar('Form cleared', { actionLabel: 'Undo', onAction: () => setDraft(before) }); }}>Clear form</Button>
            )}
          </Card>
          {!job && <RecentJobs />}
        </div>
      </div>
    </form>
  );
}
