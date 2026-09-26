import { useState } from 'react';
import { Button, Checkbox, Dialog, Select, TextField, showSnackbar } from '../../../components/m3';
import { post } from '../../../lib/api';
import { formatCents } from '../../../lib/format';
import { paidNetCents } from '../returns/plan';
import { METHOD_LABELS, type InvoiceDetail } from '../types';
import { errorText, isDrawerClosed } from '../../../lib/errorText';

/** Void = cancel the whole sale: refund what was paid, put stock back. Manager approval (the shared dialog). */
export default function VoidDialog({ inv, open, onClose, onDone }: {
  inv: InvoiceDetail; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('');
  const [keepJob, setKeepJob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paid = paidNetCents(inv.payments);

  async function submit() {
    if (!reason.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await post(`/api/invoices/${inv.id}/void`, { reason: reason.trim(), ...(method ? { refundMethod: method } : {}), ...(keepJob ? { keepJob: true } : {}) });
      showSnackbar(`Invoice ${inv.numberDisplay} voided`);
      onDone();
    } catch (e) {
      setError(isDrawerClosed(e) ? 'The refund includes cash and the drawer is closed. Open the drawer (POS → Drawer) or refund another way.' : errorText(e));
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} dismissOnScrim={false} title={`Void invoice ${inv.numberDisplay}?`}
      description="The invoice stays on record, marked void. Stock the sale took goes back on the shelf. A manager approves."
      actions={<>
        <Button variant="text" touch onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" touch onClick={submit} disabled={busy || !reason.trim()}>{busy ? 'Voiding…' : 'Void invoice'}</Button>
      </>}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <TextField label="Reason (required)" value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} />
        <p className="text-body-large">
          {paid > 0 ? <>Refund to the customer: <b className="tabular-nums">{formatCents(paid)}</b></> : 'Nothing was paid — no refund.'}
        </p>
        {paid > 0 && (
          <Select label="Refund how" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">The way they paid</option>
            {Object.entries(METHOD_LABELS).map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </Select>
        )}
        {inv.source === 'job' && (
          <Checkbox label="Keep the order open to fix and re-invoice (otherwise it’s cancelled)" checked={keepJob}
            onChange={(e) => setKeepJob(e.target.checked)} />
        )}
        {error && <p role="alert" className="text-body-medium text-error">{error}</p>}
      </form>
    </Dialog>
  );
}
