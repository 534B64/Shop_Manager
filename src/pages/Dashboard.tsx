// One screen answers: what's due, what's owed, what's low.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCents, formatDate } from '../lib/format';
import { get } from '../lib/api';
import { isCounterMode, savePrefs } from '../lib/session';
import { getPrefs, type Prefs } from '../lib/theme';
import { CUSTOM_ACCENTS } from '../../shared/domain';
import type { Job } from '../lib/types';

function tagColor(tag: string): string {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return CUSTOM_ACCENTS[h % CUSTOM_ACCENTS.length];
}

interface Balance { jobId: number; title: string; customerName: string | null; owedCents: number; }
interface LowItem { id: number; name: string; count: number; threshold: number; }

function Card({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-token p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-semibold text-lg">{title}</h2>
        <Link to={to} className="text-sm text-accent underline">open</Link>
      </div>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [low, setLow] = useState<LowItem[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(getPrefs);
  const cards = prefs.dashboard ?? { due: true, owed: true, low: true };
  function toggleCard(k: 'due' | 'owed' | 'low') {
    const next = { ...prefs, dashboard: { ...cards, [k]: !cards[k] } };
    setPrefs(next); savePrefs(next);
  }

  useEffect(() => {
    get<Job[]>('/api/jobs?limit=200').then(setJobs).catch(() => {});
    get<Balance[]>('/api/balances').then(setBalances).catch(() => {});
    get<{ lowStock: LowItem[] }>('/api/dashboard').then((d) => setLow(d.lowStock)).catch(() => {});
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const due = jobs
    .filter((j) => j.status !== 'picked_up' && j.status !== 'done' && j.dueDate && j.dueDate <= soon)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const owedTotal = balances.reduce((s, b) => s + b.owedCents, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-3 text-sm text-muted">
          {(['due', 'owed', 'low'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={cards[k]} onChange={() => toggleCard(k)} />
              {k === 'due' ? 'Due' : k === 'owed' ? 'Owed' : 'Low stock'}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {cards.due && <Card title="Due Soon" to="/orders">
          {due.length === 0 && <p className="text-muted">Nothing due in the next 7 days.</p>}
          <div className="space-y-2">
            {due.slice(0, 6).map((j) => (
              <div key={j.id} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{j.title}</span>
                  <span className={`shrink-0 ${j.dueDate! < today ? 'text-danger font-semibold' : 'text-warn'}`}>
                    {formatDate(j.dueDate)}
                  </span>
                </div>
                {j.tags && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {j.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-semibold"
                        style={{ background: tagColor(t) }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>}
        {!isCounterMode() && cards.owed && <Card title="Owed" to="/pos">
          <div className="text-3xl font-bold mb-2">{formatCents(owedTotal)}</div>
          <div className="space-y-2">
            {balances.slice(0, 5).map((b) => (
              <div key={b.jobId} className="flex justify-between gap-2 text-sm">
                <span className="truncate">{b.title} <span className="text-muted">· {b.customerName ?? '—'}</span></span>
                <span className="shrink-0 font-semibold">{formatCents(b.owedCents)}</span>
              </div>
            ))}
            {balances.length === 0 && <p className="text-muted text-sm">All paid up.</p>}
          </div>
        </Card>}
        {cards.low && <Card title="Low Stock" to="/inventory">
          {low.length === 0 && <p className="text-muted">Nothing at or below its threshold.</p>}
          <div className="space-y-2">
            {low.slice(0, 6).map((i) => (
              <div key={i.id} className="flex justify-between gap-2 text-sm">
                <span className="truncate">{i.name}</span>
                <span className="shrink-0 text-warn font-semibold">{i.count} left</span>
              </div>
            ))}
          </div>
        </Card>}
      </div>
    </div>
  );
}
