import { useEffect, useState } from 'react';
import { Button, Dialog, Select, TextField } from '../../../components/m3';
import { post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import type { InventoryItem } from '../../../lib/types';
import { parseWhole } from '../logic';
import type { Balance, Location } from '../types';
import { errorText } from '../../../lib/errorText';

/** Move stock between locations (manager+). The item's total doesn't change. */
export default function TransferDialog({ open, onClose, item, locations, onDone }: {
  open: boolean; onClose: () => void; item: InventoryItem; locations: Location[]; onDone: (i: InventoryItem) => void;
}) {
  const balances = useQuery<Balance[]>(open ? `/api/inventory/${item.id}/balances` : null).data ?? [];
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setFrom(''); setTo(''); setQty(''); setNote(''); setError(null); } }, [open]);

  const have = (id: string) => balances.find((b) => String(b.locationId) === id)?.onHand ?? 0;
  const n = parseWhole(qty);
  const tooMany = !!from && !!n && n > have(from);
  const ready = !!from && !!to && from !== to && !!n && !tooMany;

  async function save() {
    if (!ready) return;
    setSaving(true); setError(null);
    try {
      const r = await post<{ item: InventoryItem }>(`/api/inventory/${item.id}/transfer`, {
        fromLocationId: Number(from), toLocationId: Number(to), qty: n, ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone(r.item);
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} title={`Transfer ${item.name}`} dismissOnScrim={false}
      actions={<>
        <Button variant="text" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="text" onClick={save} disabled={!ready || saving}>{saving ? 'Moving…' : 'Transfer'}</Button>
      </>}>
      {locations.length < 2 ? (
        <p className="text-body-medium">There’s only one location. An admin can add more in Settings → Locations.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Select label="From" value={from} onChange={(e) => setFrom(e.target.value)} data-autofocus>
            <option value="">Pick a location…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({have(String(l.id))} on hand)</option>)}
          </Select>
          <Select label="To" value={to} onChange={(e) => setTo(e.target.value)}
            error={from && to && from === to ? 'Pick a different location' : null}>
            <option value="">Pick a location…</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <TextField label={`Quantity (${item.countUnit || 'units'})`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)}
            error={tooMany ? `Only ${have(from)} there` : qty && !n ? 'Enter a whole number above 0' : null} />
          <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
