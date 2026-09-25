import { useEffect, useState } from 'react';
import { STATUS_LABELS, JOB_TYPE_LABELS, type JobStatus } from '../../../shared/domain';
import { nextStatus, prevStatus } from '../../../shared/statusFlow';
import { formatCents, formatDate, parseDollarsToCents } from '../../lib/format';
import { get, put, del, ApiError } from '../../lib/api';
import CopyButton from '../../components/CopyButton';
import type { Job, JobItem } from '../../lib/types';

const PROOF_COLUMNS: JobStatus[] = ['quote', 'approved', 'design'];
// The four steps are always visible, even when empty.
const MAIN_COLUMNS: JobStatus[] = ['acknowledged', 'in_progress', 'done', 'picked_up'];

// Color barrier per phase — instantly see where each column starts.
const STATUS_COLORS: Record<string, string> = {
  quote: '#8a8a8a', approved: '#0e8a8a', design: '#6d3bbf',
  acknowledged: '#2456c4', in_progress: '#d98a06', done: '#1a7a3a', picked_up: '#555555',
};

function dueClass(dueDate: string | null): string {
  if (!dueDate) return 'text-muted';
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return 'text-danger font-semibold';
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  if (dueDate <= soon) return 'text-warn font-semibold';
  return 'text-muted';
}

export default function Orders() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<(Job & { items?: JobItem[] }) | null>(null);
  const [editable, setEditable] = useState(false);

  const refresh = () => get<Job[]>('/api/jobs?limit=200').then(setJobs).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function move(j: Job, to: JobStatus) {
    setError('');
    try {
      await put(`/api/jobs/${j.id}/status`, { status: to });
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Move failed';
      // Unpaid pickup (402) → confirm, then retry as an override. A cashier
      // gets the shared Manager-approval dialog (api.ts); the server records
      // who approved it on the job's notes and in the approvals log.
      if (to === 'picked_up' && e instanceof ApiError && e.status === 402) {
        if (!confirm(`${msg}\n\nRelease it anyway?`)) return;
        try { await put(`/api/jobs/${j.id}/status`, { status: to, override: true }); refresh(); }
        catch (e2) { setError(e2 instanceof Error ? e2.message : 'Override failed'); }
      } else setError(msg);
    }
  }

  async function openDetail(j: Job) {
    setEditable(false);
    const full = await get<Job & { items: JobItem[] }>(`/api/jobs/${j.id}`);
    setDetail(full);
  }

  // Remove an order — allowed only while no payment has been taken (server
  // enforces; if a live payment exists it returns a "void or refund first" error).
  // Needs a manager: a cashier gets the approval dialog (api.ts).
  async function removeJob(j: { id: number }) {
    if (!confirm('Remove this order? It is hidden from the board; the record stays for the books.')) return;
    try {
      await del(`/api/jobs/${j.id}`, {});
      setDetail(null); setEditable(false); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Remove failed'); }
  }

  function startEdit() {
    setEditable(true); // the session is the edit attribution (ADR 0004)
  }

  async function saveDetail() {
    if (!detail || !editable) return;
    try {
      await put(`/api/jobs/${detail.id}`, {
        title: detail.title, type: detail.type, dueDate: detail.dueDate,
        quantity: detail.quantity, tags: detail.tags, notes: detail.notes,
        finalPriceCents: detail.finalPriceCents, taxable: detail.taxable,
        fileRef: detail.fileRef ?? '',
      });
      setDetail(null); setEditable(false); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  }

  const active = jobs.filter((j) => j.status !== 'picked_up');
  const history = jobs.filter((j) => j.status === 'picked_up');
  // Proof columns are all-or-nothing: if ANY active job is in the proof flow,
  // show all three so advancing a job visibly moves its card to the next zone
  // (previously only occupied proof columns rendered, so the card stayed put
  // and just the header label changed). When no proof jobs exist the group
  // collapses and the simple 5-column board returns.
  const hasProofJobs = active.some((j) => PROOF_COLUMNS.includes(j.status as JobStatus));
  const columns = [
    ...(hasProofJobs
      ? PROOF_COLUMNS.map((s) => ({ status: s, items: active.filter((j) => j.status === s) }))
      : []),
    ...MAIN_COLUMNS.filter((s) => s !== 'picked_up')
      .map((s) => ({ status: s, items: active.filter((j) => j.status === s) })),
  ];

  const ro = !editable; // detail fields read-only until unlocked
  const dIn = `w-full px-3 py-2 border border-line rounded-token text-base ${ro ? 'bg-bg text-muted' : 'bg-surface'}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <button onClick={() => setShowHistory(!showHistory)}
          className="px-3 py-2 text-sm border border-line rounded-token hover:bg-bg">
          {showHistory ? 'Hide' : 'Show'} picked up ({history.length})
        </button>
      </div>
      {error && <p className="text-danger mb-3">{error}</p>}


      {/* Responsive board: every column shares the width evenly, so the whole
          pipeline fits on screen with no horizontal scrolling. */}
      <div className="grid gap-3 pb-4 items-start"
        style={{ gridTemplateColumns: `repeat(${columns.length + 1}, minmax(0, 1fr))` }}>
        {columns.map(({ status, items }) => (
          <div key={status} className="min-w-0">
            <div className="rounded-token mb-2 px-3 py-2 font-semibold text-white"
              style={{ background: STATUS_COLORS[status] }}>
              {STATUS_LABELS[status]} <span className="opacity-80 font-normal">({items.length})</span>
            </div>
            <div className="space-y-2 border-l-4 pl-2" style={{ borderColor: STATUS_COLORS[status] }}>
              {items.map((j) => {
                const fwd = nextStatus(j.status as JobStatus, j.useProofFlow);
                const back = prevStatus(j.status as JobStatus, j.useProofFlow);
                return (
                  <div key={j.id} className="bg-surface border border-line rounded-token p-3 cursor-pointer hover:border-accent"
                    onClick={() => openDetail(j)}>
                    <div className="font-semibold leading-snug mb-1">{j.title}</div>
                    <div className="text-sm text-muted">{j.customerName ?? '—'} · {j.po ?? ''}</div>
                    <div className="flex justify-between items-baseline mt-1 mb-2">
                      <span className={`text-sm ${dueClass(j.dueDate)}`}>due {formatDate(j.dueDate)}</span>
                      {/* After-tax total when the server computed one; pre-tax price as fallback. */}
                      <span className="font-bold">{(j.totalCents ?? j.finalPriceCents) != null ? formatCents((j.totalCents ?? j.finalPriceCents)!) : '—'}</span>
                    </div>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      {back && (
                        <button onClick={() => move(j, back)}
                          className="px-2.5 py-1.5 text-sm border border-line rounded-token hover:bg-bg">←</button>
                      )}
                      {fwd && (
                        <button onClick={() => move(j, fwd)}
                          className="flex-1 px-2.5 py-1.5 text-sm bg-accent text-accent-contrast rounded-token">
                          {STATUS_LABELS[fwd]} →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="min-w-0">
          <div className="rounded-token mb-2 px-3 py-2 font-semibold text-white" style={{ background: STATUS_COLORS.picked_up }}>
            Picked Up <span className="opacity-80 font-normal">({history.length})</span>
          </div>
          <div className="border-l-4 pl-2 space-y-2" style={{ borderColor: STATUS_COLORS.picked_up }}>
            {history.slice(0, 6).map((j) => (
              <div key={j.id} className="bg-surface border border-line rounded-token p-3 opacity-70 cursor-pointer hover:opacity-100"
                onClick={() => openDetail(j)}>
                <div className="font-semibold leading-snug">{j.title}</div>
                <div className="text-sm text-muted">{j.customerName ?? '—'} · {formatCents(j.totalCents ?? j.finalPriceCents ?? 0)}</div>
              </div>
            ))}
            {history.length > 6 && (
              <button onClick={() => setShowHistory(true)} className="text-sm text-accent underline px-1">show all…</button>
            )}
            {history.length === 0 && <p className="text-sm text-muted px-1">None yet.</p>}
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="mt-6">
          <h2 className="font-semibold mb-2">Picked up</h2>
          <div className="bg-surface border border-line rounded-token divide-y divide-line">
            {history.map((j) => (
              <div key={j.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1 cursor-pointer hover:underline" onClick={() => openDetail(j)}>
                  {j.title} <span className="text-muted">· {j.customerName ?? '—'} · {j.po ?? ''}</span>
                </span>
                <span className="font-semibold">{(j.totalCents ?? j.finalPriceCents) != null ? formatCents((j.totalCents ?? j.finalPriceCents)!) : '—'}</span>
                <button onClick={() => removeJob(j)}
                  className="px-2.5 py-1.5 border border-line rounded-token text-danger hover:bg-bg">Remove</button>
              </div>
            ))}
            {history.length === 0 && <p className="text-muted p-4">Nothing picked up yet.</p>}
          </div>
        </div>
      )}

      {/* ---- Detail modal: grayed out until Edit is pressed ---- */}
      {detail && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
          onClick={() => { setDetail(null); setEditable(false); }}>
          <div className="bg-surface border border-line rounded-token p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-xl">{detail.po ?? `Job #${detail.id}`}</h2>
                {detail.po && <CopyButton text={detail.po} label="Copy PO" className="py-1" />}
              </div>
              <div className="flex gap-2">
                {ro && (
                  <button onClick={startEdit} className="px-4 py-2 bg-accent text-accent-contrast rounded-token text-sm font-semibold">Edit</button>
                )}
                {!ro && (
                  <button onClick={saveDetail} className="px-4 py-2 bg-ok text-white rounded-token text-sm font-semibold">Save</button>
                )}
                <button onClick={() => removeJob(detail)}
                  className="px-3 py-2 border border-line rounded-token text-sm text-danger hover:bg-bg">Remove</button>
                <button onClick={() => { setDetail(null); setEditable(false); }}
                  className="px-3 py-2 border border-line rounded-token text-sm">Close</button>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-muted mb-1">Title</label>
                <input className={dIn} disabled={ro} value={detail.title}
                  onChange={(e) => setDetail({ ...detail, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-muted mb-1">Type</label>
                  <select className={dIn} disabled={ro} value={detail.type}
                    onChange={(e) => setDetail({ ...detail, type: e.target.value })}>
                    {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Customer</label>
                  <input className={dIn} disabled value={detail.customerName ?? '—'} />
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Due date</label>
                  <input type="date" className={dIn} disabled={ro} value={detail.dueDate ?? ''}
                    onChange={(e) => setDetail({ ...detail, dueDate: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Qty</label>
                  <input className={dIn} disabled={ro} inputMode="numeric" value={detail.quantity}
                    onChange={(e) => setDetail({ ...detail, quantity: Number(e.target.value) || 1 })} />
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Price ($)</label>
                  <input className={dIn} disabled={ro}
                    value={detail.finalPriceCents != null ? (detail.finalPriceCents / 100).toFixed(2) : ''}
                    onChange={(e) => {
                      const c = parseDollarsToCents(e.target.value);
                      setDetail({ ...detail, finalPriceCents: c ?? detail.finalPriceCents });
                    }} />
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Status</label>
                  <input className={dIn} disabled value={STATUS_LABELS[detail.status as never] ?? detail.status} />
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Total (with tax)</label>
                  <input className={dIn} disabled
                    value={detail.totalCents != null ? (detail.totalCents / 100).toFixed(2) : '—'} />
                  {!ro && <p className="text-xs text-muted mt-1">Recomputed on save if the price changes.</p>}
                </div>
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">Tags</label>
                <input className={dIn} disabled={ro} value={detail.tags ?? ''}
                  onChange={(e) => setDetail({ ...detail, tags: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">Notes</label>
                <textarea className={dIn} disabled={ro} rows={2} value={detail.notes ?? ''}
                  onChange={(e) => setDetail({ ...detail, notes: e.target.value })} />
              </div>
              {(detail.items?.length ?? 0) > 0 && (
                <div>
                  <label className="block text-sm text-muted mb-1">Items</label>
                  {detail.items!.map((it) => (
                    <div key={it.id} className="flex justify-between text-sm py-1 border-b border-line">
                      <span>{it.title} <span className="text-muted">× {it.qty}</span></span>
                      <span>{formatCents(it.priceCents * it.qty)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <label className="block text-sm text-muted mb-1">Design file reference (NAS path / filename)</label>
                <div className="flex gap-2">
                  <input className={dIn} disabled={ro} value={detail.fileRef ?? ''}
                    placeholder={detail.po ? `e.g. ${detail.po}.slx` : 'filename on the NAS'}
                    onChange={(e) => setDetail({ ...detail, fileRef: e.target.value })} />
                  {detail.po && <CopyButton text={detail.po} label="Copy PO" />}
                </div>
                <p className="text-xs text-muted mt-1">Save the SignLab file on the NAS named after the PO — no upload needed.</p>
              </div>
              <div className="text-sm text-muted text-right">
                by {detail.createdBy ?? '—'} · {formatDate(detail.createdAt)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
