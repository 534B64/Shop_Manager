// /quick — counter sale in two fields and a tap. The full POS lives at /pos;
// this stays the simple path. Touch-sized (counter screen). The amount is the
// price before tax; the tax and what the customer pays show before ringing up
// (D10). Every sale needs the drawer open (D12) — it opens inline.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Chip, Icon, TextField } from '../../../components/m3';
import { get, post } from '../../../lib/api';
import { formatCents } from '../../../lib/format';
import { newRef } from '../../../lib/ref';
import { useQuery, type Page } from '../../../lib/query';
import type { Customer, InventoryItem } from '../../../lib/types';
import CustomerSearch from '../shared/CustomerSearch';
import OpenDrawerForm from '../../pos/drawer/OpenDrawerForm';
import TaxExemptField from '../../pos/lib/TaxExemptField';
import type { TaxExemption } from '../../pos/counter/cart';
import type { DrawerView } from '../../pos/types';
import { METHODS, quickTotals, saleBody } from './sale';
import StockPicker from './StockPicker';
import TodaySales, { useTodaySales } from './TodaySales';
import { errorText, isDrawerClosed } from '../../../lib/errorText';

const NO_EXEMPTION: TaxExemption = { on: false, reason: '' };

export default function QuickOrderPage() {
  const payments = useTodaySales();
  const taxQ = useQuery<{ ratePct: number }>('/api/settings/tax');
  const drawerQ = useQuery<{ drawer: DrawerView | null }>('/api/drawer/current');
  const [custText, setCustText] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [exempt, setExempt] = useState<TaxExemption>(NO_EXEMPTION);
  const [stockItem, setStockItem] = useState<InventoryItem | null>(null);
  const [stockQty, setStockQty] = useState('1');
  // One clientRef per sale: a retry after a dropped connection can't ring it up twice.
  const [clientRef, setClientRef] = useState(newRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  const rate = taxQ.data?.ratePct;
  const totals = rate != null ? quickTotals(amount, rate, exempt.on) : null;
  const drawerClosed = drawerQ.data != null && !drawerQ.data.drawer;

  const pickCustomer = (c: Customer) => { setCustomer(c); setCustText(c.name); setTimeout(() => titleRef.current?.focus(), 0); };
  async function walkIn() {
    setError(null);
    try {
      // Paged search (SQL LIKE) — the unpaged one only looked through 2000 rows.
      const found = (await get<Page<Customer>>('/api/customers?q=Walk-in&limit=10&offset=0')).rows;
      const w = found.find((c) => c.name.toLowerCase() === 'walk-in')
        ?? await post<Customer>('/api/customers', { name: 'Walk-in', notes: 'Generic walk-in counter customer' });
      pickCustomer(w);
    } catch (e) { setError(errorText(e, 'Couldn’t pick Walk-in.')); }
  }

  async function ring() {
    const r = saleBody({ clientRef, customerId: customer?.id ?? null, title, amount, method, stockItemId: stockItem?.id ?? null, stockQty, exempt });
    if ('error' in r) { setError(r.error); return; }
    if (drawerClosed) { setError('Open the drawer first (above) — every sale needs it.'); return; }
    setBusy(true); setError(null); setDone('');
    try {
      const res = await post<{ payment: { amountCents: number } | null; invoice: { taxCents: number } | null }>('/api/pos/sale', r.body);
      const paid = res.payment?.amountCents ?? totals?.totalCents ?? 0;
      const tax = res.invoice?.taxCents ?? 0;
      setDone(`Rang up ${formatCents(paid)}${tax ? ` (incl. ${formatCents(tax)} tax)` : exempt.on ? ' (tax exempt)' : ''} — ${title.trim()}${stockItem ? ` (−${r.body.stockQty} ${stockItem.name})` : ''}`);
      setTitle(''); setAmount(''); setStockItem(null); setStockQty('1'); setExempt(NO_EXEMPTION); setClientRef(newRef());
      payments.reload();
      titleRef.current?.focus();
    } catch (e) {
      if (isDrawerClosed(e)) { drawerQ.reload(); setError('The drawer isn’t open — count the starting cash above, then Ring up again.'); }
      else setError(errorText(e, 'Sale failed — safe to retry.'));
    } finally { setBusy(false); }
  }

  const isWalkIn = customer?.name.toLowerCase() === 'walk-in';
  return (
    <div className="max-w-2xl">
      <h1 className="text-headline-medium">Quick Order</h1>
      <p className="text-body-medium text-on-surface-variant mb-4">Counter sales for stock items. For a full ticket use <Link className="text-primary underline" to="/pos">POS</Link>.</p>
      {drawerClosed && (
        <section aria-labelledby="qo-drawer" className="rounded-shape-medium bg-warning-container text-on-warning-container p-4 mb-4">
          <p id="qo-drawer" className="text-title-medium mb-3">The drawer is closed — every sale (cash, card or check) needs it open. Count the starting cash:</p>
          <div className="rounded-shape-small bg-surface p-3"><OpenDrawerForm compact onOpened={() => { setError(null); drawerQ.reload(); }} /></div>
        </section>
      )}
      <Card variant="outlined">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (!busy) ring(); }}>
          <div className="flex gap-2 items-start">
            <CustomerSearch className="flex-1" value={custText} picked={!!customer} autoFocus label="Customer * (name or phone)"
              onText={(t) => { setCustText(t); setCustomer(null); }} onPick={pickCustomer} />
            <Button touch variant={isWalkIn ? 'filled' : 'outlined'} icon={isWalkIn ? 'check' : undefined} onClick={walkIn}>Walk-in</Button>
          </div>
          <TextField ref={titleRef} label="What is it? *" placeholder="Stock flag decal 5in" value={title} maxLength={200}
            onChange={(e) => setTitle(e.target.value)} />
          <StockPicker item={stockItem} qty={stockQty} onQty={setStockQty}
            onPick={(i) => { setStockItem(i); if (i && !title.trim()) setTitle(i.name); }} />
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Paid by">
            {METHODS.map((m) => <Chip key={m} kind="filter" touch selected={method === m} onClick={() => setMethod(m)}>{m}</Chip>)}
          </div>
          <TaxExemptField value={exempt} onChange={setExempt} />
          <div className="flex flex-wrap gap-3 items-start">
            <TextField label="Price before tax * ($)" inputMode="decimal" value={amount} className="w-44" onChange={(e) => setAmount(e.target.value)} />
            <dl className="flex-1 min-w-[12rem] grid grid-cols-2 gap-x-3 pt-2 text-body-large tabular-nums" aria-label="Sale total">
              <dt className="text-on-surface-variant">Tax{exempt.on ? ' (exempt)' : rate != null ? ` (${rate}%)` : ''}</dt>
              <dd className="text-right">{totals ? formatCents(totals.taxCents) : '—'}</dd>
              <dt className="text-title-medium">Customer pays</dt>
              <dd className="text-right text-title-large" aria-live="polite">{totals ? formatCents(totals.totalCents) : '—'}</dd>
            </dl>
          </div>
          {taxQ.error && <p role="alert" className="text-body-medium text-error">Couldn’t load the tax rate: {taxQ.error}</p>}
          <Button type="submit" touch className="w-full" disabled={busy || !taxQ.data || drawerClosed}>
            {busy ? 'Ringing up…' : totals ? `Ring up ${formatCents(totals.totalCents)}` : 'Ring up'}
          </Button>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-shape-small bg-error-container text-on-error-container px-3 py-2 text-body-medium">
              <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
          {done && <p role="status" className="text-title-small text-success">{done}</p>}
        </form>
      </Card>
      <div className="mt-6"><TodaySales q={payments} /></div>
    </div>
  );
}
