import { useEffect, useState } from 'react';
import { Button, Chip, Dialog, Select, TextField } from '../../../components/m3';
import { post } from '../../../lib/api';
import { hasRole } from '../../../lib/session';
import type { InventoryItem } from '../../../lib/types';
import { MANUAL_REASONS, errorText, noteRequired, parseWhole, reasonLabel } from '../logic';
import type { Location } from '../types';

/** Correct on-hand outside receiving/sales/counts. Needs a reason; a cashier gets the manager-approval prompt. */
export default function AdjustDialog({ open, onClose, item, locations, onDone }: {
  open: boolean; onClose: () => void; item: InventoryItem; locations: Location[]; onDone: (i: InventoryItem) => void;
}) {
  const [dir, setDir] = useState<'remove' | 'add'>('remove');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [loc, setLoc] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setDir('remove'); setQty(''); setReason(''); setNote(''); setLoc(''); setError(null); } }, [open]);

  const n = parseWhole(qty);
  const needNote = noteRequired(reason);
  const ready = !!n && !!reason && (!needNote || note.trim() !== '');
  const unit = item.countUnit || 'units';

  async function save() {
    if (!ready || !n) return;
    setSaving(true); setError(null);
    try {
      const saved = await post<InventoryItem>(`/api/inventory/${item.id}/adjust`, {
        delta: dir === 'add' ? n : -n, reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(loc ? { locationId: Number(loc) } : {}),
      });
      onDone(saved);
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} title={`Adjust ${item.name}`} dismissOnScrim={false}
      description={hasRole('manager') ? 'Records an adjustment transaction with your name.' : 'A manager will be asked to approve this with their name and PIN.'}
      actions={<>
        <Button variant="text" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="text" onClick={save} disabled={!ready || saving}>{saving ? 'Saving…' : 'Record adjustment'}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2" role="group" aria-label="Direction">
          <Chip kind="filter" selected={dir === 'remove'} onClick={() => setDir('remove')}>Remove stock</Chip>
          <Chip kind="filter" selected={dir === 'add'} onClick={() => setDir('add')}>Add stock</Chip>
        </div>
        <TextField label={`Quantity (${unit})`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-autofocus
          error={qty && !n ? 'Enter a whole number above 0' : null}
          supportingText={n ? `On hand ${item.count} → ${item.count + (dir === 'add' ? n : -n)}` : `On hand now: ${item.count}`} />
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required>
          <option value="">Pick a reason…</option>
          {MANUAL_REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
        </Select>
        <TextField label={needNote ? 'What happened? (required)' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        {locations.length > 1 && (
          <Select label="Location" value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">{locations[0]?.name ?? 'Shop'} (default)</option>
            {locations.slice(1).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}
        <p className="text-body-small text-on-surface-variant">Stock that arrived from a supplier goes through Receiving instead, so its cost is recorded.</p>
      </div>
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
