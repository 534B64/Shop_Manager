// /pos/returns/new?invoice=<number> — pick lines + qty, restock, reason, refund method.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, CardHeader, EmptyState, LinearProgress, TextField } from '../../../components/m3';
import { post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import { parseInvoiceNumber, returnLineRefund, refundApprovalHint } from '../../../../shared/invoice';
import PosHeader from '../PosHeader';
import { newRef } from '../../../lib/ref';
import PaymentMethods from '../counter/PaymentMethods';
import { METHOD_LABELS, type InvoiceDetail, type ReturnRow } from '../types';
import { previewReturn, toReturnLines, canRestock, type ReturnPick } from './plan';
import ReturnLinePicker from './ReturnLinePicker';
import ReturnResult from './ReturnResult';
import { errorText, isDrawerClosed, isNetworkError } from '../../../lib/errorText';

const REFUND_METHODS = ['cash', 'card', 'check', 'credit', 'other'];

export default function NewReturnPage() {
  const [sp, setSp] = useSearchParams();
  const number = sp.get('invoice') ?? '';
  const [lookup, setLookup] = useState(number);
  const valid = parseInvoiceNumber(number) != null;
  const q = useQuery<InvoiceDetail>(valid ? `/api/invoices/${number}` : null);
  const pos = useQuery<{ refundApprovalThresholdCents: number }>('/api/settings/pos');
  const refunded = useQuery<{ refundedCents: number }>(q.data ? `/api/payments/refunded?jobId=${q.data.jobId}` : null).data?.refundedCents;
  const [picks, setPicks] = useState<Record<number, ReturnPick>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('');
  const [clientRef, setClientRef] = useState(newRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReturnRow | null>(null);

  const inv = q.data;
  const pickOf = (id: number, restockDefault: boolean) => picks[id] ?? { qty: 0, restock: restockDefault };
  const preview = inv ? previewReturn(inv, picks) : null;
  const threshold = pos.data?.refundApprovalThresholdCents;
  const hint = threshold != null && refunded != null && preview && preview.totalCents > 0
    ? refundApprovalHint(refunded, preview.totalCents, threshold, 'return') : null;
  const needsMethod = !!preview && preview.refundCents > 0;
  const blocked = !preview || preview.lines.length === 0 ? 'Pick at least one item coming back.'
    : preview.invalid ? 'A quantity is more than what’s left to return.'
    : !reason.trim() ? 'Enter the reason.' : needsMethod && !method ? 'Pick how the money goes back.' : null;

  function find(e: React.FormEvent) {
    e.preventDefault();
    setPicks({}); setDone(null); setError(null); setClientRef(newRef());
    setSp(lookup.trim() ? { invoice: lookup.trim() } : {});
  }

  async function submit() {
    if (!inv || !preview || blocked || busy) return;
    setBusy(true); setError(null);
    try {
      const ret = await post<ReturnRow>('/api/returns', { clientRef, invoiceId: inv.id, reason: reason.trim(),
        lines: toReturnLines(preview), ...(needsMethod ? { refundMethod: method } : {}) });
      setDone(ret);
    } catch (e) {
      if (isDrawerClosed(e)) setError('Refunds need the drawer open. Open it (POS → Drawer), then save the return again.');
      else if (isNetworkError(e)) setError('No answer from the server — check the wifi and tap Save return again. It won’t be recorded twice.');
      else setError(errorText(e));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PosHeader title="New return" subtitle="What came back, whether it goes back on the shelf, and any money owed back." />
      {done ? <ReturnResult ret={done} fresh /> : (
        <>
          <form onSubmit={find} className="flex flex-wrap items-start gap-2 mb-4 max-w-lg">
            <TextField label="Invoice number" inputMode="numeric" value={lookup} className="flex-1"
              onChange={(e) => setLookup(e.target.value)} error={lookup.trim() && parseInvoiceNumber(lookup.trim()) == null ? 'Digits only' : null} />
            <Button type="submit" variant="tonal" touch className="mt-1">Find</Button>
          </form>
          <div className="h-1 mb-2">{q.loading && <LinearProgress label="Loading the invoice" />}</div>
          {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load that invoice">{q.error}</EmptyState>}
          {!number && <EmptyState icon="search" title="Which invoice?">Enter the number from the receipt, or start from the invoice’s page.</EmptyState>}
          {inv && inv.status === 'voided' && <EmptyState icon="warning" title={`Invoice ${inv.numberDisplay} is voided`}>Nothing left to return.</EmptyState>}
          {inv && inv.status === 'issued' && preview && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
              <Card variant="outlined" aria-labelledby="lines-title">
                <CardHeader id="lines-title" title={`Invoice ${inv.numberDisplay}`} subtitle={`${inv.customerName ?? 'Walk-in'} · ${formatCents(inv.totalCents)}`} />
                <ul>
                  {inv.lines.map((l) => {
                    const p = pickOf(l.id, canRestock(l));
                    return <ReturnLinePicker key={l.id} line={l} pick={p}
                      valueCents={returnLineRefund(l, l.returnedQty, p.qty)?.totalCents ?? 0}
                      onChange={(np) => setPicks((all) => ({ ...all, [l.id]: np }))} />;
                  })}
                </ul>
              </Card>
              <Card variant="outlined" className="flex flex-col gap-4" aria-labelledby="refund-title">
                <CardHeader id="refund-title" title="Refund" />
                <TextField label="Reason (required)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-body-large tabular-nums">
                  <dt className="text-on-surface-variant">Return value</dt><dd className="text-right">{formatCents(preview.totalCents)}</dd>
                  <dt className="text-title-large">Money back</dt><dd className="text-right text-display-small">{formatCents(preview.refundCents)}</dd>
                </dl>
                {preview.totalCents > 0 && preview.refundCents === 0 && (
                  <p className="text-body-medium text-on-surface-variant">Nothing to hand back — the customer hadn’t paid past what they’ll owe. The return lowers their balance.</p>)}
                {needsMethod && <PaymentMethods value={method} onChange={setMethod} methods={REFUND_METHODS} labels={METHOD_LABELS} />}
                {hint && (
                  <p className="rounded-shape-small bg-warning-container text-on-warning-container px-3 py-2 text-body-medium">{hint}</p>)}
                {error && <p role="alert" className="rounded-shape-small bg-error-container text-on-error-container px-3 py-2 text-body-large">{error}</p>}
                <Button touch className="!h-16 !text-title-large" disabled={busy || !!blocked} onClick={submit}>{busy ? 'Saving…' : 'Save return'}</Button>
                {blocked && !busy && <p className="text-body-medium text-on-surface-variant text-center -mt-2">{blocked}</p>}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
