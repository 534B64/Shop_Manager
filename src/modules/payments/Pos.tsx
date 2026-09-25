import { useEffect, useState } from 'react';
import { formatCents, parseDollarsToCents, formatDate } from '../../lib/format';
import { get, post } from '../../lib/api';
import { currentUser } from '../../lib/session';

interface Balance { jobId: number; title: string; status: string; customerName: string | null; finalPriceCents: number; paidCents: number; owedCents: number; }
interface Summary { count: number; paymentsCents: number; refundsCents: number; netCents: number; byMethod: Record<string, number>; }
interface PaymentRow { id: number; jobId: number; amountCents: number; method: string; kind: string; voidedAt: string | null; createdAt: string; jobTitle: string | null; customerName: string | null; }

const METHODS = ['cash', 'check', 'card', 'credit', 'other'];
const input = 'px-3 py-2.5 bg-bg border border-line rounded-token text-base';

export default function Pos() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [recent, setRecent] = useState<PaymentRow[]>([]);
  const [error, setError] = useState('');
  // payment form
  const [paying, setPaying] = useState<Balance | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [posSearch, setPosSearch] = useState('');

  const refresh = () => {
    get<Balance[]>('/api/balances').then(setBalances).catch(() => {});
    get<PaymentRow[]>('/api/payments').then(setRecent).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  async function recordPayment() {
    if (!paying) return;
    const cents = parseDollarsToCents(amount);
    if (cents === null || cents <= 0) return setError('Enter a valid amount.');
    // Overpayment guard — warn but allow (chosen policy 2026-07-02). Catches
    // typos without blocking a deliberate overpay; a future card processor
    // (Stripe etc.) would enforce a hard cap server-side instead.
    if (cents > paying.owedCents) {
      const over = formatCents(cents - paying.owedCents);
      const ok = confirm(`That's ${over} MORE than the ${formatCents(paying.owedCents)} owed on this job. Record it anyway?\n\n(If the customer meant to leave extra money on account, cancel and add store credit from their Customers page instead.)`);
      if (!ok) return;
    }
    setError('');
    try {
      await post('/api/payments', { clientRef: crypto.randomUUID(), jobId: paying.jobId, amountCents: cents, method, ...(currentUser() ? { createdBy: currentUser()! } : {}) });
      setPaying(null); setAmount(''); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }



  async function voidPayment(p: PaymentRow) {
    const reason = prompt(`Void this ${p.kind} of ${formatCents(p.amountCents)}? Reason:`);
    if (!reason) return;
    setError('');
    try { await post(`/api/payments/${p.id}/void`, { reason }); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function refund(p: PaymentRow) {
    const v = prompt('Refund amount ($):', (p.amountCents / 100).toFixed(2));
    if (!v) return;
    const cents = parseDollarsToCents(v);
    if (cents === null || cents <= 0) return setError('Invalid amount.');
    const m = prompt("Refund how? cash / check / card / credit (store credit)", p.method === 'credit' ? 'credit' : 'cash');
    if (!m || !METHODS.includes(m)) return setError('Invalid method.');
    setError('');
    try {
      await post('/api/payments', { clientRef: crypto.randomUUID(), jobId: p.jobId, amountCents: cents, method: m, kind: 'refund', ...(currentUser() ? { createdBy: currentUser()! } : {}) });
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  // ---- Reports (daily / weekly / monthly / custom) ----
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Summary | null>(null);

  function setRange(days: number) {
    const t = new Date();
    const f = new Date(Date.now() - (days - 1) * 86400000);
    setFrom(f.toISOString().slice(0, 10)); setTo(t.toISOString().slice(0, 10));
  }
  useEffect(() => {
    get<Summary>(`/api/reports/summary?from=${from}&to=${to}`).then(setSummary).catch(() => {});
  }, [from, to, recent]);

  const today = new Date().toISOString().slice(0, 10);
  const todays = recent.filter((p) => p.createdAt.startsWith(today) && !p.voidedAt);
  const todayTotal = todays.reduce((s, p) => s + (p.kind === 'refund' ? -p.amountCents : p.amountCents), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Payments</h1>
      <p className="text-muted mb-6">Record-only — cash, checks, and cards are handled outside the system.</p>
      {error && <p className="text-danger mb-3">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="bg-surface border border-line rounded-token p-5">
          <h2 className="font-semibold text-lg mb-1">Today</h2>
          <div className="text-3xl font-bold mb-1">{formatCents(todayTotal)}</div>
          <div className="text-sm text-muted mb-2">{todays.length} payment{todays.length === 1 ? '' : 's'} recorded today</div>
          <div className="flex gap-3 text-sm">
            <a className="text-accent underline" href="/api/reports/jobs.csv">all jobs.csv</a>
          </div>
        </section>
      </div>

      <section className="bg-surface border border-line rounded-token p-5 mt-6">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <h2 className="font-semibold text-lg mr-2">Reports</h2>
          <button onClick={() => setRange(1)} className="px-3 py-1.5 text-sm border border-line rounded-token hover:bg-bg">Today</button>
          <button onClick={() => setRange(7)} className="px-3 py-1.5 text-sm border border-line rounded-token hover:bg-bg">7 days</button>
          <button onClick={() => setRange(30)} className="px-3 py-1.5 text-sm border border-line rounded-token hover:bg-bg">30 days</button>
          <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted">to</span>
          <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} />
          <a className="text-accent underline text-sm ml-2" href={`/api/reports/payments.csv?from=${from}&to=${to}`}>download CSV</a>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-6">
            <div><div className="text-sm text-muted">Net</div><div className="text-2xl font-bold">{formatCents(summary.netCents)}</div></div>
            <div><div className="text-sm text-muted">Payments</div><div className="text-2xl font-bold text-ok">{formatCents(summary.paymentsCents)}</div></div>
            <div><div className="text-sm text-muted">Refunds</div><div className="text-2xl font-bold text-danger">{formatCents(summary.refundsCents)}</div></div>
            {Object.entries(summary.byMethod).map(([m, c]) => (
              <div key={m}><div className="text-sm text-muted">{m}</div><div className="text-xl font-semibold">{formatCents(c)}</div></div>
            ))}
            <div><div className="text-sm text-muted">Entries</div><div className="text-xl font-semibold">{summary.count}</div></div>
          </div>
        )}
      </section>

      <input className={`${input} w-full mt-8`} placeholder="Search payments by customer or job…"
        value={posSearch} onChange={(e) => setPosSearch(e.target.value)} />
      <h2 className="font-semibold text-lg mt-4 mb-3">Owed ({balances.length})</h2>
      <div className="bg-surface border border-line rounded-token divide-y divide-line">
        {balances.filter((b) => { const q = posSearch.trim().toLowerCase(); return !q || (b.title ?? '').toLowerCase().includes(q) || (b.customerName ?? '').toLowerCase().includes(q); }).map((b) => (
          <div key={b.jobId} className="px-4 py-3">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <span className="font-semibold">{b.title}</span>
                <span className="text-muted text-sm"> · {b.customerName ?? '—'}</span>
              </div>
              <div className="text-sm text-muted">paid {formatCents(b.paidCents)} of {formatCents(b.finalPriceCents)}</div>
              <div className="font-bold text-warn">{formatCents(b.owedCents)} due</div>
              <button onClick={() => { setPaying(b); setAmount((b.owedCents / 100).toFixed(2)); }}
                className="px-3 py-2 text-sm bg-accent text-accent-contrast rounded-token">Record payment</button>
            </div>
            {paying?.jobId === b.jobId && (
              <div className="flex gap-3 items-end mt-3 pl-2 border-l-2 border-accent">
                <div>
                  <label className="block text-sm text-muted mb-1">Amount ($)</label>
                  <input className={`${input} w-28`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Method</label>
                  <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
                    {METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <button onClick={recordPayment} className="px-4 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold">Save</button>
                <button onClick={() => setPaying(null)} className="px-4 py-2.5 border border-line rounded-token">Cancel</button>
              </div>
            )}
          </div>
        ))}
        {balances.length === 0 && <p className="text-muted p-4">Nothing owed. 🎉</p>}
      </div>

      <h2 className="font-semibold text-lg mt-8 mb-3">Recent payments</h2>
      <div className="bg-surface border border-line rounded-token divide-y divide-line">
        {recent.filter((p) => { const q = posSearch.trim().toLowerCase(); return !q || (p.jobTitle ?? '').toLowerCase().includes(q) || (p.customerName ?? '').toLowerCase().includes(q); }).slice(0, 20).map((p) => (
          <div key={p.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${p.voidedAt ? 'opacity-45 line-through' : ''}`}>
            <span className="flex-1 truncate">{p.jobTitle ?? '—'} <span className="text-muted">· {p.customerName ?? '—'} · {p.method}{p.kind === 'refund' ? ' · REFUND' : ''}{p.voidedAt ? ' · VOIDED' : ''}</span></span>
            <span className="text-muted">{formatDate(p.createdAt)}</span>
            <b className={p.kind === 'refund' ? 'text-danger' : ''}>{p.kind === 'refund' ? '−' : ''}{formatCents(p.amountCents)}</b>
            {!p.voidedAt && (
              <span className="flex gap-1.5">
                {p.kind === 'payment' && (
                  <button onClick={() => refund(p)} className="px-2 py-1 border border-line rounded-token hover:bg-bg">Refund</button>
                )}
                <button onClick={() => voidPayment(p)} className="px-2 py-1 border border-line rounded-token text-muted hover:bg-bg">Void</button>
              </span>
            )}
          </div>
        ))}
        {recent.length === 0 && <p className="text-muted p-4">No payments recorded yet.</p>}
      </div>
    </div>
  );
}
