import { useEffect, useState } from 'react';
import { Button, Dialog, Select, showSnackbar } from '../../components/m3';
import { put } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { errorText } from '../../lib/errorText';
import { LEVELS, type CustomerDetail } from './logic';

/** Manager: set the customer's discount level (0 = none). */
export default function LevelDialog({ open, onClose, customer, onSaved }: {
  open: boolean; onClose: () => void; customer: CustomerDetail; onSaved: () => void;
}) {
  const [level, setLevel] = useState(customer.level ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discounts = useQuery<Record<string, number>>(open ? '/api/settings/levels' : null);
  useEffect(() => { if (open) { setLevel(customer.level ?? 0); setError(null); } }, [open, customer.level]);
  const label = (l: number) => (l === 0 ? 'Level 0 — no discount'
    : `Level ${l}${discounts.data ? ` — ${discounts.data[String(l)]}% off` : ''}`);

  async function save() {
    setBusy(true); setError(null);
    try { await put(`/api/customers/${customer.id}/level`, { level }); showSnackbar(`Level set to ${level}`); onSaved(); onClose(); }
    catch (e) { setError(errorText(e, 'Level change failed')); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title="Customer level"
      description="Levels 1–3 get the shop’s level discount on new sales (set in Settings → Shop)."
      actions={<>
        <Button variant="text" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || level === customer.level}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}>
      <Select label="Level" value={level} onChange={(e) => setLevel(Number(e.target.value))} data-autofocus>
        {LEVELS.map((l) => <option key={l} value={l}>{label(l)}</option>)}
      </Select>
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
