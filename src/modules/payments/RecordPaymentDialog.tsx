import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Checkbox, Dialog, TextField, showSnackbar } from '../../components/m3';
import { post } from '../../lib/api';
import { formatCents } from '../../lib/format';
import { errorText, isDrawerClosed, isNetworkError } from '../pos/lib/errors';
import { newRef } from '../pos/lib/ref';
import OpenDrawerForm from '../pos/drawer/OpenDrawerForm';
import PaymentMethods from '../pos/counter/PaymentMethods';
import { METHOD_LABELS } from '../pos/types';
import { PAYMENT_METHODS, checkPayment, overpayCents, type Balance } from './logic';

/** Take a payment on a job with a balance. Cash can record tendered + change; cash needs the drawer. */
export default function RecordPaymentDialog({ job, onClose, onDone }: { job: Balance; onClose: () => void; onDone: () => void }) {
  const nav = useNavigate();
  const [amount, setAmount] = useState((job.owedCents / 100).toFixed(2));
  const [method, setMethod] = useState('');
  const [tendered, setTendered] = useState('');
  const [overOk, setOverOk] = useState(false);
  const [ref] = useState(newRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerClosed, setDrawerClosed] = useState(false);
  const check = checkPayment(amount, method, tendered);
  const over = check.amountCents != null ? overpayCents(check.amountCents, job.owedCents) : 0;
  const blocked = check.problem ?? (!method ? 'Pick a method.' : over > 0 && !overOk ? 'Confirm the overpayment.' : null);

  async function save() {
    if (blocked || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await post<{ invoice?: { numberDisplay: string } }>('/api/payments', { clientRef: ref, jobId: job.jobId,
        amountCents: check.amountCents, method, ...(check.tenderedCents != null ? { tenderedCents: check.tenderedCents } : {}) });
      const change = check.change ? ` — change ${formatCents(check.change)}` : '';
      if (res.invoice) {
        const n = res.invoice.numberDisplay;
        showSnackbar(`Payment recorded${change}. Paid in full: invoice ${n}`, { actionLabel: 'View', onAction: () => nav(`/pos/invoices/${n}`) });
      } else showSnackbar(`Payment recorded${change}`);
      onDone();
    } catch (e) {
      if (isDrawerClosed(e)) { setDrawerClosed(true); setError('The cash drawer is closed — open it below, then Save again.'); }
      else if (isNetworkError(e)) setError('No answer from the server — tap Save again. It won’t record twice.');
      else setError(errorText(e));
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} dismissOnScrim={false} title="Record payment" className="max-w-lg"
      description={`${job.title} · ${job.customerName ?? '—'} · ${formatCents(job.owedCents)} due`}
      actions={<>
        <Button variant="text" touch onClick={onClose} disabled={busy}>Cancel</Button>
        <Button touch onClick={save} disabled={busy || !!blocked}>{busy ? 'Saving…' : 'Save payment'}</Button>
      </>}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <TextField label="Amount $" inputMode="decimal" value={amount} autoFocus onChange={(e) => { setAmount(e.target.value); setOverOk(false); }}
          error={amount.trim() && check.amountCents == null ? check.problem : null} />
        <PaymentMethods value={method} onChange={(m) => { setMethod(m); setDrawerClosed(false); }} methods={PAYMENT_METHODS} labels={METHOD_LABELS} />
        {method === 'cash' && (
          <TextField label="Cash tendered $ (optional)" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)}
            error={tendered.trim() ? check.problem : null}
            supportingText="What the customer handed over, to work out change." />
        )}
        {check.change != null && <p className="text-headline-small text-center tabular-nums" aria-live="polite">Change {formatCents(check.change)}</p>}
        {over > 0 && (
          <div className="rounded-shape-small bg-warning-container text-on-warning-container px-3 py-2">
            <p className="text-body-medium">That’s {formatCents(over)} more than the {formatCents(job.owedCents)} owed. To leave money on account, add store credit from the customer’s page instead.</p>
            <Checkbox label="Record the overpayment anyway" checked={overOk} onChange={(e) => setOverOk(e.target.checked)} />
          </div>
        )}
        {error && <p role="alert" className="text-body-medium text-error">{error}</p>}
      </form>
        {drawerClosed && method === 'cash' && <div className="mt-3 rounded-shape-small border border-outline-variant p-3"><OpenDrawerForm compact onOpened={() => { setDrawerClosed(false); setError(null); }} /></div>}
    </Dialog>
  );
}
