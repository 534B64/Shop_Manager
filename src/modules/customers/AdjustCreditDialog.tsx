import { useEffect, useState } from 'react';
import { Button, Dialog, TextField, showSnackbar } from '../../components/m3';
import { post } from '../../lib/api';
import { formatCents } from '../../lib/format';
import { errorText, approvalCancelled } from '../../lib/errorText';
import { creditDelta, type CustomerDetail } from './logic';

/** Add or reduce store credit. A cashier gets the manager-approval dialog (api.ts). */
export default function AdjustCreditDialog({ direction, onClose, customer, onSaved }: {
  direction: null | 'add' | 'reduce'; onClose: () => void; customer: CustomerDetail; onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (direction) { setAmount(''); setNote(''); setTried(false); setError(null); } }, [direction]);

  const parsed = creditDelta(amount, direction ?? 'add', customer.creditCents);
  const fieldErr = tried && 'error' in parsed ? parsed.error : null;

  async function save() {
    setTried(true);
    if ('error' in parsed) return;
    if (!note.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await post<{ creditCents: number }>(`/api/customers/${customer.id}/credit`,
        { deltaCents: parsed.cents, note: note.trim() });
      showSnackbar(`Store credit is now ${formatCents(r.creditCents)}`);
      onSaved(); onClose();
    } catch (e) { if (!approvalCancelled(e)) setError(errorText(e, 'Adjustment failed')); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={direction != null} onClose={() => !busy && onClose()} dismissOnScrim={false}
      title={direction === 'reduce' ? 'Reduce store credit' : 'Add store credit'}
      description={`Current balance ${formatCents(customer.creditCents)}.`}
      actions={<>
        <Button variant="text" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : direction === 'reduce' ? 'Reduce' : 'Add'}</Button>
      </>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <TextField label="Amount ($)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
          error={fieldErr} data-autofocus />
        <TextField label="Why?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
          error={tried && !note.trim() ? 'Say why — it goes on the ledger and the approval record.' : null}
          supportingText="e.g. goodwill, prepayment, correction" />
        <button type="submit" hidden />
      </form>
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
