// /pos/invoices — every invoice, newest first; filters live in the URL.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, DataTable, EmptyState, Select, TextField, type Column } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import { parseInvoiceNumber } from '../../../../shared/invoice';
import PosHeader from '../PosHeader';
import KeysetPager from '../../../components/KeysetPager';
import CustomerPicker, { type PickedCustomer } from '../lib/CustomerPicker';
import { formatWhen } from '../lib/when';
import type { InvoiceHeader } from '../types';
import InvoiceStatus from './InvoiceStatus';
import { useKeyset } from '../../../lib/keysetPaging';

const COLS: Column<InvoiceHeader>[] = [
  { key: 'number', header: 'Invoice', width: 'w-28', render: (i) => (
    <Link className="text-primary underline tabular-nums" to={`/pos/invoices/${i.numberDisplay}`} onClick={(e) => e.stopPropagation()}>{i.numberDisplay}</Link>) },
  { key: 'createdAt', header: 'Date', render: (i) => formatWhen(i.createdAt) },
  { key: 'customer', header: 'Customer', render: (i) => i.customerName ?? 'Walk-in' },
  { key: 'title', header: 'For', render: (i) => i.title, hideOnNarrow: true },
  { key: 'total', header: 'Total', align: 'right', render: (i) => <span className="tabular-nums">{formatCents(i.totalCents)}</span> },
  { key: 'status', header: 'Status', render: (i) => <InvoiceStatus inv={i} /> },
];

export default function InvoicesPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const set = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const [numberText, setNumberText] = useState(get('number'));
  useEffect(() => {
    const t = setTimeout(() => set('number', parseInvoiceNumber(numberText.trim()) != null ? numberText.trim() : ''), 300);
    return () => clearTimeout(t);
  }, [numberText]); // eslint-disable-line react-hooks/exhaustive-deps
  const customer: PickedCustomer | null = get('customerId') ? { id: Number(get('customerId')), name: get('customerName') || `Customer #${get('customerId')}` } : null;
  const numberBad = numberText.trim() !== '' && parseInvoiceNumber(numberText.trim()) == null;

  const list = useKeyset<InvoiceHeader>('/api/invoices', {
    from: get('from'), to: get('to'), number: get('number'), status: get('status'), customerId: get('customerId'),
  }, 25);
  const filtered = ['from', 'to', 'number', 'status', 'customerId'].some((k) => sp.get(k));

  return (
    <div>
      <PosHeader title="Invoices" subtitle="Locked records of what each customer was charged." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3">
        <TextField label="Invoice number" inputMode="numeric" value={numberText} onChange={(e) => setNumberText(e.target.value)}
          error={numberBad ? 'Digits only' : null} />
        <Select label="Status" value={get('status')} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any</option><option value="issued">Issued</option><option value="voided">Voided</option>
        </Select>
        <TextField label="From" type="date" value={get('from')} onChange={(e) => set('from', e.target.value)} />
        <TextField label="To" type="date" value={get('to')} onChange={(e) => set('to', e.target.value)} />
      </div>
      <div className="max-w-xl mb-4">
        <CustomerPicker value={customer} emptyLabel="Any customer"
          onChange={(c) => setSp((p) => { const n = new URLSearchParams(p);
            if (c) { n.set('customerId', String(c.id)); n.set('customerName', c.name); } else { n.delete('customerId'); n.delete('customerName'); }
            return n; }, { replace: true })} />
      </div>
      {filtered && <Button variant="text" touch className="mb-2" onClick={() => { setNumberText(''); setSp(new URLSearchParams(), { replace: true }); }}>Clear filters</Button>}

      <DataTable label="Invoices" columns={COLS} rows={list.rows} rowKey={(i) => i.id}
        loading={list.loading} error={list.error} onRetry={list.reload}
        empty={<EmptyState title={filtered ? 'No invoices match' : 'No invoices yet'}>
          {filtered ? 'Try a wider date range or clear the filters.' : 'Counter sales and paid-up jobs get an invoice automatically.'}</EmptyState>}
        onRowClick={(i) => nav(`/pos/invoices/${i.numberDisplay}`)} />
      {(list.hasPrev || list.hasNext) && <KeysetPager paging={list} touch />}
    </div>
  );
}
