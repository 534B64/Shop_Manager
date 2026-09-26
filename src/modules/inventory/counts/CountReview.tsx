// Review step: system counts revealed, biggest dollar discrepancies first,
// reason codes required above the Settings threshold, then submit.
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Button, Card, EmptyState, LinearProgress, Select, TextField, cx } from '../../../components/m3';
import { get, post } from '../../../lib/api';
import { withParams, type Page } from '../../../lib/query';
import { hasRole } from '../../../lib/session';
import { formatCents } from '../../../lib/format';
import type { InventoryItem } from '../../../lib/types';
import { reviewCounts } from '../../../../shared/countReview';
import { VARIANCE_REASON_CODES } from '../../../../shared/domain';
import { useInvSettings } from '../components/lookups';
import { costPerCountUnit, errorText, parseWhole, reasonLabel, signed } from '../logic';
import { chunks, enteredIds, submitCounts, type Draft } from './draft';
import type { CycleCount } from '../types';

const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export default function CountReview({ cc, draft, setDraft, onBack, onSubmitted }: {
  cc: CycleCount; draft: Draft; setDraft: Dispatch<SetStateAction<Draft>>;
  onBack: () => void; onSubmitted: (msg: string) => void;
}) {
  const t = useInvSettings();
  const ids = enteredIds(draft);
  const idKey = ids.join(',');
  const [items, setItems] = useState<Map<number, InventoryItem> | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh system counts for exactly the entered items (≤ 200 ids per request).
  useEffect(() => {
    let live = true;
    setLoadError(null);
    Promise.all([
      ...chunks(ids).map((c) => get<Page<InventoryItem>>(withParams('/api/inventory', { ids: c.join(','), limit: 200, offset: 0 }))),
      get<Page<InventoryItem>>('/api/inventory?limit=1&offset=0'),
    ]).then((pages) => {
      if (!live) return;
      const all = pages.pop()!;
      setTotal(all.total);
      setItems(new Map(pages.flatMap((p) => p.rows).map((i) => [i.id, i])));
    }).catch((e) => { if (live) setLoadError(errorText(e)); });
    return () => { live = false; };
  }, [idKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const review = useMemo(() => (items ? reviewCounts(ids.filter((id) => items.has(id)).map((id) => {
    const i = items.get(id)!;
    return { itemId: id, systemCount: i.count, counted: parseWhole(draft.lines[id].counted)!, unitCostCents: costPerCountUnit(i) };
  }), t) : []), [items, idKey, draft.lines, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const off = review.filter((v) => v.delta !== 0);
  const matched = review.length - off.length;
  const missing = off.filter((v) => v.aboveThreshold && !draft.reasons[v.itemId]);
  const manager = hasRole('manager');
  const next = draft.next || plusDays(7);
  const setReason = (id: number, r: string) => setDraft((d) => ({ ...d, reasons: { ...d.reasons, [id]: r } }));
  const setNote = (id: number, n: string) => setDraft((d) => ({ ...d, notes: { ...d.notes, [id]: n } }));

  async function submit() {
    setSaving(true); setError(null);
    try {
      const r = await post<{ status: string; itemsAdjusted?: number; nextScheduledFor?: string }>(`/api/cycle-counts/${cc.id}/submit`, {
        counts: submitCounts({ ...draft, lines: Object.fromEntries(Object.entries(draft.lines).filter(([id]) => items?.has(Number(id)))) }),
        nextScheduledFor: next, ...(manager ? { post: true } : {}),
      });
      onSubmitted(r.status === 'posted'
        ? `Count posted — ${r.itemsAdjusted} item(s) adjusted. Next count ${r.nextScheduledFor}.`
        : 'Count submitted — a manager needs to approve & post it before on-hand changes.');
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }

  if (loadError) return <EmptyState tone="error" icon="warning" title="Couldn’t load the system counts"
    action={<Button variant="outlined" onClick={() => setTick((x) => x + 1)}>Try again</Button>}>{loadError}</EmptyState>;
  if (!items) return <LinearProgress label="Loading system counts" />;

  return (
    <div>
      <Card variant="filled" className="mb-4">
        <p className="text-title-medium">Review — biggest discrepancies first</p>
        <p className="text-body-medium text-on-surface-variant">
          Differences beyond ±{t.pctThreshold}% or ±{t.unitThreshold} units need a reason (set in Settings).
          {total != null && total > review.length && ` ${total - review.length} item(s) not counted — they stay as they are.`}
          {ids.length > review.length && ` ${ids.length - review.length} counted item(s) are no longer active and were left out.`}
        </p>
      </Card>
      {off.length === 0 && <EmptyState icon="check" title="Everything matches">All {matched} counted items agree with the system.</EmptyState>}
      <ul className="flex flex-col gap-3 mb-4" aria-label="Variances">
        {off.map((v) => {
          const i = items.get(v.itemId)!;
          const flag = v.aboveThreshold;
          return (
            <li key={v.itemId}>
              <Card className={cx(flag && '!border-warning border-2')}>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="flex-1 min-w-[12rem] text-title-medium">{i.name}</span>
                  <span className="text-body-large tabular-nums">system {v.systemCount} → counted {v.counted}</span>
                  <span className={cx('text-title-medium tabular-nums', flag ? 'text-warning' : 'text-on-surface')}>
                    {signed(v.delta)}{v.pct != null && ` (${signed(Math.round(v.pct))}%)`}
                  </span>
                  <span className="text-body-large tabular-nums">{v.impactCents != null ? formatCents(v.impactCents) : 'no cost'}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 mt-3">
                  {flag && (
                    <Select label="Reason (required)" value={draft.reasons[v.itemId] ?? ''} onChange={(e) => setReason(v.itemId, e.target.value)}
                      error={draft.reasons[v.itemId] ? null : 'Above threshold — pick a reason'}>
                      <option value="">Pick a reason…</option>
                      {VARIANCE_REASON_CODES.map((c) => <option key={c} value={c}>{reasonLabel(c)}</option>)}
                    </Select>
                  )}
                  <TextField label="Note (optional)" value={draft.notes[v.itemId] ?? ''} maxLength={300}
                    onChange={(e) => setNote(v.itemId, e.target.value)} className={flag ? '' : 'sm:col-span-2'} />
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      {off.length > 0 && matched > 0 && <p className="text-body-medium text-on-surface-variant mb-4">{matched} more item(s) matched exactly.</p>}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <TextField className="w-56" label="Schedule next count" type="date" value={next}
            onChange={(e) => setDraft((d) => ({ ...d, next: e.target.value }))} />
          <span className="flex-1" />
          <Button variant="outlined" touch onClick={onBack} disabled={saving}>Back to counting</Button>
          <Button touch onClick={submit} disabled={saving || missing.length > 0 || review.length === 0}>
            {saving ? 'Submitting…' : manager ? 'Submit & post count' : 'Submit for approval'}
          </Button>
        </div>
        {missing.length > 0 && <p className="mt-2 text-body-medium text-warning">Pick a reason for {missing.length} flagged difference(s) to submit.</p>}
        {error && <p role="alert" className="mt-2 text-body-medium text-error">{error}</p>}
      </Card>
    </div>
  );
}
