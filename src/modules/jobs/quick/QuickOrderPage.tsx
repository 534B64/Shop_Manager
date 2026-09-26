// /quick — counter sale in two fields and a tap. The full POS lives at /pos;
// this stays the simple path. Touch-sized (counter screen).
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Chip, Icon, TextField } from '../../../components/m3';
import { get, post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import type { Customer, InventoryItem } from '../../../lib/types';
import CustomerSearch from '../shared/CustomerSearch';
import { errorText, isDrawerClosed } from '../shared/errors';
import { METHODS, saleBody } from './sale';
import StockPicker from './StockPicker';
import TodaySales, { type PaymentRow } from './TodaySales';

const newRef = () => crypto.randomUUID();

export default function QuickOrderPage() {
  const payments = useQuery<PaymentRow[]>('/api/payments');
  const [custText, setCustText] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [stockItem, setStockItem] = useState<InventoryItem | null>(null);
  const [stockQty, setStockQty] = useState('1');
  // One clientRef per sale: a retry after a dropped connection can't ring it up twice.
  const [clientRef, setClientRef] = useState(newRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerClosed, setDrawerClosed] = useState(false);
  const [done, setDone] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  const pickCustomer = (c: Customer) => { setCustomer(c); setCustText(c.name); setTimeout(() => titleRef.current?.focus(), 0); };
  async function walkIn() {
    setError(null);
    try {
      const found = await get<Customer[]>('/api/customers?q=Walk-in');
      const w = found.find((c) => c.name.toLowerCase() === 'walk-in')
        ?? await post<Customer>('/api/customers', { name: 'Walk-in', notes: 'Generic walk-in counter customer' });
      pickCustomer(w);
    } catch (e) { setError(errorText(e, 'Couldn’t pick Walk-in.')); }
  }

  async function ring() {
    const r = saleBody({ clientRef, customerId: customer?.id ?? null, title, amount, method, stockItemId: stockItem?.id ?? null, stockQty });
    if ('error' in r) { setError(r.error); setDrawerClosed(false); return; }
    setBusy(true); setError(null); setDrawerClosed(false); setDone('');
    try {
      await post('/api/pos/sale', r.body);
      const cents = r.body.amountCents as number;
      setDone(`Rang up ${formatCents(cents)} — ${title.trim()}${stockItem ? ` (−${r.body.stockQty} ${stockItem.name})` : ''}`);
      setTitle(''); setAmount(''); setStockItem(null); setStockQty('1'); setClientRef(newRef());
      payments.reload();
      titleRef.current?.focus();
    } catch (e) {
      setDrawerClosed(isDrawerClosed(e));
      setError(isDrawerClosed(e) ? 'The cash drawer isn’t open — count the starting cash first, or take card/check.' : errorText(e, 'Sale failed — safe to retry.'));
    } finally { setBusy(false); }
  }

  const isWalkIn = customer?.name.toLowerCase() === 'walk-in';
  return (
    <div className="max-w-2xl">
      <h1 className="text-headline-medium">Quick Order</h1>
      <p className="text-body-medium text-on-surface-variant mb-4">Counter sales for stock items. For a full ticket use <Link className="text-primary underline" to="/pos">POS</Link>.</p>
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
          <div className="flex gap-2 items-start">
            <TextField label="Amount * ($)" inputMode="decimal" value={amount} className="w-40" onChange={(e) => setAmount(e.target.value)} />
            <Button type="submit" touch className="flex-1 mt-1" disabled={busy}>{busy ? 'Ringing up…' : 'Ring up'}</Button>
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-shape-small bg-error-container text-on-error-container px-3 py-2 text-body-medium">
              <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
              <span>{error}{drawerClosed && <> <Link to="/pos/drawer" className="underline font-semibold">Open the cash drawer</Link></>}</span>
            </p>
          )}
          {done && <p role="status" className="text-title-small text-success">{done}</p>}
        </form>
      </Card>
      <div className="mt-6"><TodaySales q={payments} /></div>
    </div>
  );
}
