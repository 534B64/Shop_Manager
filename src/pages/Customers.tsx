import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_LABELS } from '../../shared/domain';
import { formatCents, formatDate, parseDollarsToCents, formatPhone, isValidPhone, isValidEmail } from '../lib/format';
import { get, post, put, del } from '../lib/api';
import type { Customer, Job } from '../lib/types';

interface CreditEntry { id: number; deltaCents: number; note: string | null; createdAt: string; }
interface CustomerDetail extends Customer { creditCents: number; jobs: Job[]; creditLedger: CreditEntry[]; }
const input = 'px-3 py-2.5 bg-bg border border-line rounded-token text-base';

export default function Customers() {
  const [list, setList] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (printing) {
      const t = setTimeout(() => { window.print(); setPrinting(false); }, 60);
      return () => clearTimeout(t);
    }
  }, [printing]);

  const refreshList = (query = '') =>
    get<Customer[]>(`/api/customers${query ? `?q=${encodeURIComponent(query)}` : ''}`).then(setList).catch(() => {});
  const open = (id: number) => get<CustomerDetail>(`/api/customers/${id}`).then(setSel).catch(() => {});

  useEffect(() => { refreshList(); }, []);
  useEffect(() => {
    const t = setTimeout(() => refreshList(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  async function adjustCredit(sign: 1 | -1) {
    if (!sel) return;
    const v = prompt(`${sign > 0 ? 'Add' : 'Reduce'} credit by ($):`, '10.00');
    if (!v) return;
    const cents = parseDollarsToCents(v);
    if (cents === null || cents <= 0) return setError('Invalid amount.');
    const note = prompt('Note (why?):') ?? undefined;
    setError('');
    try {
      await post(`/api/customers/${sel.id}/credit`, { deltaCents: sign * cents, ...(note ? { note } : {}) });
      open(sel.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function editField(field: 'phone' | 'email' | 'notes') {
    if (!sel) return;
    const v = prompt(`${field}:`, (sel[field] as string) ?? '');
    if (v === null) return;
    if (field === 'phone' && v && !isValidPhone(v)) return setError('Phone must be 10 digits.');
    if (field === 'email' && v && !isValidEmail(v)) return setError('Email must contain @ and a dot.');
    await put(`/api/customers/${sel.id}`, { [field]: field === 'phone' ? formatPhone(v) : v });
    open(sel.id);
  }

  async function setLevel() {
    if (!sel) return;
    const v = prompt(`Customer level for ${sel.name} (0–3):`, String(sel.level ?? 0));
    if (v === null) return;
    const level = Number(v);
    if (![0, 1, 2, 3].includes(level)) return setError('Level must be 0, 1, 2, or 3.');
    const ap = prompt('Admin password (levels are admin-assigned):');
    if (ap === null) return;
    try { await put(`/api/customers/${sel.id}/level`, { level, adminPassword: ap }); open(sel.id); }
    catch { setError('Wrong admin password.'); }
  }

  async function removeCustomer() {
    if (!sel) return;
    if (sel.jobs.length > 0) return setError('This customer has order history — it cannot be removed (the books stay intact).');
    const ap = prompt(`Admin password to remove "${sel.name}"?`);
    if (ap === null) return;
    setError('');
    try {
      await del(`/api/customers/${sel.id}`, { adminPassword: ap });
      setSel(null);
      refreshList(q.trim());
    } catch (e) { setError(e instanceof Error ? e.message : 'Remove failed (wrong admin password?)'); }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Customers</h1>
      {error && <p className="text-danger mb-3">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <section>
          <input className={`${input} w-full mb-3`} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="bg-surface border border-line rounded-token divide-y divide-line">
            {list.map((c) => {
              const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
              const inactive = !c.lastJobAt || c.lastJobAt < cutoff;
              return (
                <button key={c.id} onClick={() => open(c.id)}
                  className={`block w-full text-left px-4 py-3 hover:bg-bg ${sel?.id === c.id ? 'bg-bg' : ''}`}>
                  <div className="font-semibold flex items-center gap-2">
                    {c.name}
                    {inactive && <span className="text-[10px] px-1.5 py-0.5 rounded-token border border-line text-muted">INACTIVE</span>}
                  </div>
                  <div className="text-sm text-muted">
                    {c.phone ?? '—'} · last purchase {c.lastJobAt ? formatDate(c.lastJobAt) : 'never'}
                  </div>
                </button>
              );
            })}
            {list.length === 0 && <p className="text-muted p-4">No customers found.</p>}
          </div>
        </section>

        <section>
          {!sel && <p className="text-muted">Select a customer to see their account.</p>}
          {sel && (
            <div className="space-y-4">
              <div className="bg-surface border border-line rounded-token p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold">{sel.name}</h2>
                    <p className="text-muted text-sm mt-1">
                      {sel.phone ?? 'no phone'} · {sel.email ?? 'no email'}
                      <button onClick={() => editField('phone')} className="ml-2 text-accent underline">edit phone</button>
                      <button onClick={() => editField('email')} className="ml-2 text-accent underline">edit email</button>
                    </p>
                    {sel.notes && <p className="text-sm mt-2">{sel.notes}</p>}
                    <button onClick={() => editField('notes')} className="text-sm text-accent underline">edit notes</button>
                  </div>
                  <div className="text-right">
                    <button onClick={setLevel}
                      className={`mb-2 px-3 py-1 rounded-token text-sm font-semibold border ${(sel.level ?? 0) > 0 ? 'bg-accent text-accent-contrast border-accent' : 'border-line text-muted hover:bg-bg'}`}>
                      Level {sel.level ?? 0}
                    </button>
                    <div className="text-sm text-muted">Store credit</div>
                    <div className={`text-2xl font-bold ${sel.creditCents > 0 ? 'text-ok' : ''}`}>{formatCents(sel.creditCents)}</div>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => adjustCredit(1)} className="px-3 py-1.5 text-sm bg-accent text-accent-contrast rounded-token">Add</button>
                      <button onClick={() => adjustCredit(-1)} className="px-3 py-1.5 text-sm border border-line rounded-token hover:bg-bg">Reduce</button>
                    </div>
                    <button onClick={removeCustomer} className="mt-2 px-3 py-1.5 text-sm border border-line rounded-token text-danger hover:bg-bg">Remove customer</button>
                  </div>
                </div>
              </div>

              <div className="bg-surface border border-line rounded-token">
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                  <h3 className="font-semibold">Jobs ({sel.jobs.length})</h3>
                  <button onClick={() => setPrinting(true)} className="text-sm text-accent underline">Print order history (PDF)</button>
                </div>
                <div className="divide-y divide-line">
                  {sel.jobs.map((j) => (
                    <div key={j.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="truncate">{j.title}</span>
                      <span className="shrink-0 text-muted">{STATUS_LABELS[j.status as never] ?? j.status} · {formatDate(j.createdAt)}</span>
                      <span className="shrink-0 font-semibold">{j.finalPriceCents != null ? formatCents(j.finalPriceCents) : '—'}</span>
                    </div>
                  ))}
                  {sel.jobs.length === 0 && <p className="text-muted px-4 pb-4">No jobs yet.</p>}
                </div>
              </div>

              {sel.creditLedger.length > 0 && (
                <div className="bg-surface border border-line rounded-token">
                  <h3 className="font-semibold px-4 pt-4 pb-2">Credit history</h3>
                  <div className="divide-y divide-line">
                    {sel.creditLedger.map((e) => (
                      <div key={e.id} className="flex justify-between gap-3 px-4 py-2 text-sm">
                        <span className="text-muted">{formatDate(e.createdAt)} · {e.note ?? '—'}</span>
                        <span className={`font-semibold ${e.deltaCents > 0 ? 'text-ok' : 'text-danger'}`}>
                          {e.deltaCents > 0 ? '+' : ''}{formatCents(e.deltaCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      {printing && sel && createPortal(
        <div className="print-sheet">
          <h1 style={{ fontSize: 22, marginBottom: 2 }}>Decals Plus — Order History</h1>
          <p style={{ margin: '0 0 4px', color: '#555' }}>{sel.name} · {sel.phone ?? ''} · printed {new Date().toLocaleDateString()}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 10 }}>
            <thead>
              <tr>{['Date', 'PO', 'Job', 'Status', 'Price'].map((h) => (
                <th key={h} style={{ border: '1px solid #ccc', padding: '5px 8px', textAlign: 'left', background: '#f3f3f3' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {sel.jobs.map((j) => (
                <tr key={j.id}>
                  <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>{formatDate(j.createdAt)}</td>
                  <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>{j.po ?? j.id}</td>
                  <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>{j.title}</td>
                  <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>{STATUS_LABELS[j.status as never] ?? j.status}</td>
                  <td style={{ border: '1px solid #ccc', padding: '5px 8px' }}>{j.finalPriceCents != null ? formatCents(j.finalPriceCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 10, fontWeight: 700 }}>
            Total: {formatCents(sel.jobs.reduce((s, j) => s + (j.finalPriceCents ?? 0), 0))} across {sel.jobs.length} jobs
          </p>
        </div>,
        document.body,
      )}
    </div>
  );
}
