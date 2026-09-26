// /pos/invoices/:number — the locked invoice, its money, returns and void; Void / Start return.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, EmptyState, LinearProgress } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import PosHeader from '../PosHeader';
import { formatWhen } from '../lib/when';
import { remainingQty, paidNetCents } from '../returns/plan';
import type { InvoiceDetail } from '../types';
import InvoiceStatus from './InvoiceStatus';
import InvoiceLinesTable from './InvoiceLinesTable';
import InvoiceMoney from './InvoiceMoney';
import VoidDialog from './VoidDialog';

export default function InvoiceDetailPage() {
  const { number = '' } = useParams();
  const q = useQuery<InvoiceDetail>(`/api/invoices/${encodeURIComponent(number)}`);
  const [voiding, setVoiding] = useState(false);
  const inv = q.data;
  const returnable = inv && inv.status === 'issued' && inv.lines.some((l) => remainingQty(l) > 0);
  const balance = inv ? inv.totalCents - inv.returnedCents - paidNetCents(inv.payments) : 0;

  return (
    <div>
      <PosHeader title={`Invoice ${inv?.numberDisplay ?? number}`}
        subtitle={inv && <>{formatWhen(inv.createdAt)} · {inv.customerName ?? 'Walk-in'} · <InvoiceStatus inv={inv} /></>}
        action={inv && inv.status === 'issued' && (
          <div className="flex flex-wrap gap-2">
            {returnable && <Button variant="tonal" touch to={`/pos/returns/new?invoice=${inv.numberDisplay}`}>Start return</Button>}
            <Button variant="outlined" touch onClick={() => setVoiding(true)}>Void…</Button>
          </div>
        )} />
      <div className="h-1 mb-2">{q.loading && <LinearProgress label="Loading the invoice" />}</div>
      {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load this invoice"
        action={<div className="flex gap-2"><Button variant="outlined" touch onClick={q.reload}>Try again</Button><Button variant="text" touch to="/pos/invoices">All invoices</Button></div>}>
        {q.error}</EmptyState>}

      {inv && (
        <div className="flex flex-col gap-4">
          <Card variant="outlined">
            <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 mb-4 text-body-large">
              <div><dt className="text-body-small text-on-surface-variant">For</dt><dd>{inv.title}</dd></div>
              <div><dt className="text-body-small text-on-surface-variant">Source</dt><dd>{inv.source === 'counter_sale' ? 'Counter sale' : 'Order'} (job #{inv.jobId}){inv.jobPo ? ` · PO ${inv.jobPo}` : ''}</dd></div>
              <div><dt className="text-body-small text-on-surface-variant">Rung up by</dt><dd>{inv.createdBy ?? '—'}{inv.drawerSessionId ? ` · drawer #${inv.drawerSessionId}` : ''}</dd></div>
              <div><dt className="text-body-small text-on-surface-variant">Balance</dt>
                <dd className="tabular-nums">{inv.status === 'voided' ? '—' : balance > 0 ? `${formatCents(balance)} due` : 'Paid'}</dd></div>
            </dl>
            <InvoiceLinesTable inv={inv} />
          </Card>
          <InvoiceMoney inv={inv} />
          <VoidDialog inv={inv} open={voiding} onClose={() => setVoiding(false)} onDone={() => { setVoiding(false); q.reload(); }} />
        </div>
      )}
    </div>
  );
}
