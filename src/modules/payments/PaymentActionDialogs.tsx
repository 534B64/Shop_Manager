// Refund and Void on a recorded payment. Both need a manager (the shared
// approval dialog opens automatically); the server's refusals are shown as-is.
import { useState } from 'react';
import { Button, Dialog, TextField, showSnackbar } from '../../components/m3';
import { post } from '../../lib/api';
import { formatCents, parseDollarsToCents } from '../../lib/format';
import { errorText, isDrawerClosed } from '../pos/lib/errors';
import { newRef } from '../../lib/ref';
import PaymentMethods from '../pos/counter/PaymentMethods';
import { METHOD_LABELS, methodLabel, type PaymentRow } from '../pos/types';
import { PAYMENT_METHODS } from './logic';

const drawerMsg = 'Cash refunds need the cash drawer open (POS → Drawer). Or pick another method.';

export function RefundDialog({ p, onClose, onDone }: { p: PaymentRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState((p.amountCents / 100).toFixed(2));
  const [method, setMethod] = useState(p.method === 'credit' ? 'credit' : 'cash');
  const [note, setNote] = useState('');
  const [ref] = useState(newRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseDollarsToCents(amount);
  const bad = cents == null || cents <= 0;

  async function save() {
    if (bad || busy) return;
    setBusy(true); setError(null);
    try {
      await post('/api/payments', { clientRef: ref, jobId: p.jobId, amountCents: cents, method, kind: 'refund', ...(note.trim() ? { note: note.trim() } : {}) });
      showSnackbar(`Refund of ${formatCents(cents!)} recorded`);
      onDone();
    } catch (e) { setError(isDrawerClosed(e) ? drawerMsg : errorText(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} dismissOnScrim={false} title="Refund" className="max-w-lg"
      description={`${p.jobTitle ?? 'Job'} · ${p.customerName ?? '—'} · paid ${formatCents(p.amountCents)} by ${methodLabel(p.method)}. A manager approves.`}
      actions={<>
        <Button variant="text" touch onClick={onClose} disabled={busy}>Cancel</Button>
        <Button touch onClick={save} disabled={busy || bad}>{busy ? 'Saving…' : 'Record refund'}</Button>
      </>}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <TextField label="Refund amount $" inputMode="decimal" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)}
          error={amount.trim() && bad ? 'Enter an amount above $0.00' : null} />
        <PaymentMethods value={method} onChange={setMethod} methods={PAYMENT_METHODS} labels={METHOD_LABELS} />
        <TextField label="Reason (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        {error && <p role="alert" className="text-body-medium text-error">{error}</p>}
      </form>
    </Dialog>
  );
}

export function VoidPaymentDialog({ p, onClose, onDone }: { p: PaymentRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!reason.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await post(`/api/payments/${p.id}/void`, { reason: reason.trim() });
      showSnackbar(`${p.kind === 'refund' ? 'Refund' : 'Payment'} voided`);
      onDone();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} dismissOnScrim={false} title={`Void this ${p.kind}?`} className="max-w-lg"
      description={`${formatCents(p.amountCents)} ${methodLabel(p.method)} · ${p.jobTitle ?? 'Job'}. Void is for mistakes — the row stays, marked void. A manager approves.`}
      actions={<>
        <Button variant="text" touch onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" touch onClick={save} disabled={busy || !reason.trim()}>{busy ? 'Voiding…' : 'Void'}</Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <TextField label="Reason (required)" value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} />
        {error && (
          <p role="alert" className="mt-3 rounded-shape-small bg-error-container text-on-error-container px-3 py-2 text-body-medium">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
