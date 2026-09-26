// Who it's for and what it is: customer, title, type, due date, proof flow.
import { useRef } from 'react';
import { Card, CardHeader, Select, Switch, TextField } from '../../../components/m3';
import { JOB_TYPES, JOB_TYPE_LABELS } from '../../../../shared/domain';
import CustomerField from './CustomerField';
import type { QuoteDraft } from './draft';

interface Props {
  draft: QuoteDraft;
  locked: boolean;
  /** Proof flow can only change while the job is still a quote. */
  proofEditable: boolean;
  autoFocus: boolean;
  set: <K extends keyof QuoteDraft>(k: K, v: QuoteDraft[K]) => void;
}

export default function JobSection({ draft, locked, proofEditable, autoFocus, set }: Props) {
  const title = useRef<HTMLInputElement>(null);
  return (
    <Card variant="outlined" aria-labelledby="quote-job-h">
      <CardHeader id="quote-job-h" title="Customer & job" />
      <div className="flex flex-col gap-3">
        <CustomerField customer={draft.customer} locked={locked} autoFocus={autoFocus} onChange={(c) => set('customer', c)}
          onPicked={() => title.current?.focus()} />
        <TextField ref={title} label="Job title *" value={draft.title} maxLength={200} placeholder="Van door decals ×2"
          onChange={(e) => set('title', e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Job type *" value={draft.type} onChange={(e) => set('type', e.target.value)}>
            {JOB_TYPES.map((t) => <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>)}
          </Select>
          <TextField label="Due date *" type="date" value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </div>
        <Switch className="text-left" checked={draft.useProofFlow} disabled={!proofEditable} onChange={(v) => set('useProofFlow', v)}
          label={<span>Needs design / proof approval
            <span className="block text-body-small text-on-surface-variant">
              {proofEditable ? 'Proof jobs start as quotes: Quote → Approved → Design → Production.' : 'Set when the job was quoted.'}
            </span></span>} />
      </div>
    </Card>
  );
}
