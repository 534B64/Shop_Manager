// A small editable list of chips (material colors, category sizes, unit
// types): add by typing + Enter, archive/remove with ×, restore archived ones.
import { useState } from 'react';
import { Button, IconButton, TextField, cx, showSnackbar } from '../../components/m3';
import { errorText } from '../../lib/errorText';

export interface ChipItem { key: string | number; label: string; archived?: boolean }

export default function ChipEditor({ label, items, onAdd, onRemove, onRestore, removeVerb = 'Archive', disabled }: {
  label: string; items: ChipItem[];
  onAdd: (text: string) => Promise<unknown>;
  onRemove: (item: ChipItem) => Promise<unknown>;
  onRestore?: (item: ChipItem) => Promise<unknown>;
  removeVerb?: string; disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, fail: string) => {
    setBusy(true);
    try { await fn(); return true; } catch (e) { showSnackbar(errorText(e, fail)); return false; } finally { setBusy(false); }
  };
  const add = async () => {
    const v = text.trim();
    if (!v) return;
    if (await run(() => onAdd(v), `Couldn’t add “${v}”`)) setText('');
  };
  const off = disabled || busy;

  return (
    <div>
      <ul aria-label={label} className="flex flex-wrap gap-2 mb-2">
        {items.map((it) => (
          <li key={it.key} className={cx('inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-shape-small border text-label-large',
            it.archived ? 'border-outline-variant text-on-surface-variant' : 'border-outline text-on-surface')}>
            {it.label}{it.archived && <span className="text-label-small">(archived)</span>}
            {it.archived
              ? onRestore && <Button variant="text" className="!h-8 !px-2" disabled={off} onClick={() => run(() => onRestore(it), 'Restore failed')}>Restore</Button>
              : <IconButton icon="close" label={`${removeVerb} ${it.label}`} className="!h-8 !w-8" disabled={off}
                  onClick={() => run(() => onRemove(it), `${removeVerb} failed`)} />}
          </li>
        ))}
        {items.length === 0 && <li className="text-body-medium text-on-surface-variant">None yet.</li>}
      </ul>
      <form className="flex items-start gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <TextField label={`Add ${label.toLowerCase()}`} variant="outlined" className="w-56" value={text}
          onChange={(e) => setText(e.target.value)} disabled={off} maxLength={60} />
        <Button type="submit" variant="outlined" className="mt-2" disabled={off || !text.trim()}>Add</Button>
      </form>
    </div>
  );
}
