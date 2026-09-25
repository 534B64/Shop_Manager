// Counter sales: stock items out the door in two fields and a tap.
import { useEffect, useState } from 'react';
import { formatCents, parseDollarsToCents, formatDate } from '../../lib/format';
import { get, post } from '../../lib/api';
import type { Customer, InventoryItem } from '../../lib/types';

interface PaymentRow { id: number; amountCents: number; method: string; kind: string; voidedAt: string | null; createdAt: string; jobTitle: string | null; }
const METHODS = ['cash', 'check', 'card', 'other'];
const input = 'px-3 py-3 bg-bg border border-line rounded-token text-lg';

export default function QuickOrder() {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [recent, setRecent] = useState<PaymentRow[]>([]);
  const [custQuery, setCustQuery] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [matches, setMatches] = useState<Customer[]>([]);

  useEffect(() => {
    const q = custQuery.trim();
    if (q.length < 2 || customer) { setMatches([]); return; }
    const t = setTimeout(() => get<Customer[]>(`/api/customers?q=${encodeURIComponent(q)}`).then(setMatches).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [custQuery, customer]);

  async function pickWalkIn() {
    const found = await get<Customer[]>('/api/customers?q=Walk-in');
    let w = found.find((c) => c.name.toLowerCase() === 'walk-in');
    if (!w) w = await post<Customer>('/api/customers', { name: 'Walk-in', notes: 'Generic walk-in counter customer' });
    setCustomer(w); setCustQuery('Walk-in'); setMatches([]);
  }
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // Optional "from stock" link (2026-07-07): picking an inventory item makes
  // the sale deduct it on the server. Free-text sales stay exactly as before —
  // the weekly cycle count reconciles whatever isn't linked.
  const [stock, setStock] = useState<InventoryItem[]>([]);
  const [stockQuery, setStockQuery] = useState('');
  const [stockItem, setStockItem] = useState<InventoryItem | null>(null);
  const [stockQty, setStockQty] = useState('1');

  const refresh = () => get<PaymentRow[]>('/api/payments').then(setRecent).catch(() => {});
  useEffect(() => {
    refresh();
    get<InventoryItem[]>('/api/inventory').then(setStock).catch(() => {});
  }, []);

  const stockMatches = stockQuery.trim().length >= 2 && !stockItem
    ? stock.filter((i) => i.name.toLowerCase().includes(stockQuery.trim().toLowerCase())).slice(0, 8)
    : [];

  async function ring() {
    const cents = parseDollarsToCents(amount);
    if (!customer) return setError('Pick a customer — use Walk-in if none.');
    if (!title.trim() || cents === null || cents <= 0) return setError('Description and a valid amount required.');
    const qty = Math.max(1, Math.round(Number(stockQty)) || 1);
    setError(''); setDone('');
    try {
      await post('/api/pos/sale', {
        clientRef: crypto.randomUUID(), title: title.trim(), amountCents: cents, method,
        customerId: customer.id,
        ...(stockItem ? { inventoryItemId: stockItem.id, stockQty: qty } : {}),
      });
      setDone(`Rang up ${formatCents(cents)} — ${title.trim()}${stockItem ? ` (−${qty} ${stockItem.name})` : ''}`);
      setTitle(''); setAmount(''); setStockItem(null); setStockQuery(''); setStockQty('1');
      refresh();
      get<InventoryItem[]>('/api/inventory').then(setStock).catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todays = recent.filter((p) => p.createdAt.startsWith(today) && !p.voidedAt && p.kind === 'payment');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Quick Order</h1>
      <p className="text-muted mb-6">Counter sales for stock items — no customer record needed.</p>

      <div className="bg-surface border border-line rounded-token p-6 max-w-xl">
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input className={`${input} w-full`} placeholder="Customer (name or phone) *"
                value={custQuery}
                onChange={(e) => { setCustQuery(e.target.value); setCustomer(null); }} />
              {matches.length > 0 && (
                <div className="absolute z-10 left-0 right-0 bg-surface border border-line rounded-token mt-1 shadow">
                  {matches.map((c) => (
                    <button key={c.id} type="button" className="block w-full text-left px-3 py-2 hover:bg-bg"
                      onClick={() => { setCustomer(c); setCustQuery(c.name); setMatches([]); }}>
                      {c.name} <span className="text-muted text-sm">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={pickWalkIn}
              className={`px-4 rounded-token border font-semibold ${customer?.name === 'Walk-in' ? 'bg-accent text-accent-contrast border-accent' : 'border-line hover:bg-bg'}`}>
              Walk-in
            </button>
          </div>
          <input className={`${input} w-full`} placeholder="What is it? (Stock flag decal 5in)"
            value={title} onChange={(e) => setTitle(e.target.value)} />
          {/* Optional: link the sale to a stocked item so it deducts on ring-up. */}
          {stockItem ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 px-3 py-2 bg-bg border border-accent rounded-token text-sm">
                From stock: <b>{stockItem.name}</b> <span className="text-muted">({stockItem.count} on hand)</span>
              </span>
              <input className={`${input} w-20 text-base py-2`} inputMode="numeric" value={stockQty}
                onChange={(e) => setStockQty(e.target.value)} title="Quantity to deduct" />
              <button type="button" onClick={() => { setStockItem(null); setStockQuery(''); }}
                className="px-3 py-2 border border-line rounded-token text-sm hover:bg-bg">×</button>
            </div>
          ) : (
            <div className="relative">
              <input className={`${input} w-full text-base py-2`} placeholder="From stock? (optional — start typing an inventory item)"
                value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} />
              {stockMatches.length > 0 && (
                <div className="absolute z-10 left-0 right-0 bg-surface border border-line rounded-token mt-1 shadow">
                  {stockMatches.map((i) => (
                    <button key={i.id} type="button" className="block w-full text-left px-3 py-2 hover:bg-bg text-sm"
                      onClick={() => { setStockItem(i); setStockQuery(i.name); if (!title.trim()) setTitle(i.name); }}>
                      {i.name} <span className="text-muted">({i.count} on hand)</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3">
            <input className={`${input} w-32`} placeholder="$" inputMode="decimal"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ring()} />
            <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
            <button onClick={ring} className="flex-1 py-3 bg-accent text-accent-contrast rounded-token font-bold text-lg">Ring up</button>
          </div>
        </div>
        {error && <p className="text-danger mt-3">{error}</p>}
        {done && <p className="text-ok mt-3 font-semibold">{done}</p>}
      </div>

      <h2 className="font-semibold text-lg mt-8 mb-3">Today ({todays.length})</h2>
      <div className="bg-surface border border-line rounded-token divide-y divide-line max-w-xl">
        {todays.slice(0, 12).map((p) => (
          <div key={p.id} className="flex justify-between px-4 py-2.5 text-sm">
            <span>{p.jobTitle ?? '—'} <span className="text-muted">· {p.method}</span></span>
            <b>{formatCents(p.amountCents)}</b>
          </div>
        ))}
        {todays.length === 0 && <p className="text-muted p-4">No sales yet today.</p>}
      </div>
    </div>
  );
}
