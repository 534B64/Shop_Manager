// Tags, notes, and the design-file reference (the SignLab file on the NAS, named after the PO).
import { useId, useState } from 'react';
import { Card, CardHeader, Chip, TextField } from '../../../components/m3';
import CopyPo from '../shared/CopyPo';
import { PRESET_TAGS } from '../../../../shared/domain';
import { COLOR_TAGS, ticketTags, type QuoteDraft } from './draft';

interface Props { draft: QuoteDraft; po: string | null; set: <K extends keyof QuoteDraft>(k: K, v: QuoteDraft[K]) => void }

export default function DetailsSection({ draft, po, set }: Props) {
  const notesId = useId();
  const [custom, setCustom] = useState('');
  const toggle = (t: string) => set('tags', draft.tags.includes(t) ? draft.tags.filter((x) => x !== t) : [...draft.tags, t]);
  const presets = PRESET_TAGS.filter((t) => !COLOR_TAGS.includes(t));
  const customTags = draft.tags.filter((t) => !(PRESET_TAGS as readonly string[]).includes(t));
  const lineColors = ticketTags(draft).filter((t) => COLOR_TAGS.includes(t));
  const addCustom = () => {
    const t = custom.trim().replace(/,/g, ' ');
    if (t && !draft.tags.includes(t)) set('tags', [...draft.tags, t]);
    setCustom('');
  };

  return (
    <Card variant="outlined" aria-labelledby="quote-details-h">
      <CardHeader id="quote-details-h" title="Details" />
      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Tags" className="flex flex-wrap items-center gap-2">
          {presets.map((t) => <Chip key={t} kind="filter" selected={draft.tags.includes(t)} onClick={() => toggle(t)}>{t}</Chip>)}
          {customTags.map((t) => (
            <Chip key={t} kind="filter" selected onClick={() => toggle(t)} aria-label={`Remove tag ${t}`}>{t}</Chip>
          ))}
          {lineColors.map((t) => (
            <span key={t} className="inline-flex items-center h-8 px-3 rounded-shape-small bg-surface-container-highest text-label-large text-on-surface-variant"
              title="Set by a line's color multiplier">{t} · from lines</span>
          ))}
        </div>
        <TextField label="Add a tag" value={custom} maxLength={40} supportingText="Type a tag and press Enter"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
        <div className="rounded-t-shape-extra-small bg-surface-container-highest border-b border-on-surface-variant focus-within:border-b-2 focus-within:border-primary px-4 pt-1.5 pb-2">
          <label htmlFor={notesId} className="block text-body-small text-on-surface-variant">Notes</label>
          <textarea id={notesId} rows={4} maxLength={2000} value={draft.notes} onChange={(e) => set('notes', e.target.value)}
            placeholder="Placement, colors, customer-supplied stock, anything the shop needs…"
            className="w-full bg-transparent text-body-large text-on-surface placeholder:text-on-surface-variant/70 outline-none resize-y" />
        </div>
        <div className="flex items-start gap-2">
          <TextField className="flex-1" label="Design file reference (NAS path / filename)" value={draft.fileRef} maxLength={400}
            placeholder={po ? `e.g. ${po}.slx` : 'filename on the NAS'}
            supportingText="Save the SignLab file on the NAS named after the PO — no upload needed."
            onChange={(e) => set('fileRef', e.target.value)} />
          <CopyPo po={po} className="mt-2" />
        </div>
      </div>
    </Card>
  );
}
