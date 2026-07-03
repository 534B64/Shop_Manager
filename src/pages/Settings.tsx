import { useEffect, useState } from 'react';
import { THEMES, CUSTOM_ACCENTS, DEFAULT_TAX_RATE_PCT, type Theme } from '../../shared/domain';
import { getPrefs, applyPrefs, type Prefs } from '../lib/theme';
import { savePrefs } from '../lib/session';
import { get, put, post } from '../lib/api';
import AdminGate from '../components/AdminGate';

const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', minimal: 'High Contrast' };
interface User { id: number; name: string; }

export default function Settings() {
  const [prefs, setPrefs] = useState<Prefs>(getPrefs);
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [levels, setLevels] = useState<Record<string, string>>({ 1: '5', 2: '10', 3: '15' });
  const [taxRate, setTaxRate] = useState(String(DEFAULT_TAX_RATE_PCT));
  const [users, setUsers] = useState<User[]>([]);
  const [saved, setSaved] = useState('');
  const [tErr, setTErr] = useState('');
  const [userSearch, setUserSearch] = useState('');

  useEffect(() => {
    fetch('/api/health').then((r) => setHealth(r.ok ? 'ok' : 'down')).catch(() => setHealth('down'));
    get<Record<string, number>>('/api/settings/levels').then((l) => setLevels({ 1: String(l['1']), 2: String(l['2']), 3: String(l['3']) })).catch(() => {});
    get<{ ratePct: number }>('/api/settings/tax').then((t) => setTaxRate(String(t.ratePct))).catch(() => {});
    refreshUsers();
  }, []);

  const refreshUsers = () => get<User[]>('/api/users').then(setUsers).catch(() => {});

  // Theme changes save to the signed-in account.
  function pickTheme(t: Theme) {
    const next: Prefs = { ...prefs, theme: t };
    setPrefs(next);
    savePrefs(next);
  }
  function pickAccent(accent: string) {
    const next: Prefs = { ...prefs, accent };
    setPrefs(next);
    savePrefs(next);
  }

  async function saveTuning() {
    setTErr(''); setSaved('');
    try {
      await put('/api/settings/tax', { ratePct: Number(taxRate) || 0 });
      await put('/api/settings/levels', { 1: Number(levels['1']) || 0, 2: Number(levels['2']) || 0, 3: Number(levels['3']) || 0 });
      setSaved('Saved. New quotes use these settings immediately.');
    } catch (e) { setTErr(e instanceof Error ? e.message : 'Save failed'); }
  }

  async function addUser() {
    const name = prompt('New account name:'); if (!name?.trim()) return;
    const password = prompt(`Password for ${name}:`); if (!password) return;
    const ap = prompt('Admin password (to authorize):'); if (ap === null) return;
    try { await post('/api/users', { name: name.trim(), password, adminPassword: ap }); refreshUsers(); }
    catch { alert('Admin password wrong or name invalid.'); }
  }

  async function removeUser(u: User) {
    const ap = prompt(`Admin password (to remove ${u.name}):`); if (ap === null) return;
    try {
      await fetch(`/api/users/${u.id}`, {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adminPassword: ap }),
      }).then((r) => { if (!r.ok) throw new Error(); });
      refreshUsers();
    } catch { alert('Admin password wrong.'); }
  }

  const tIn = 'w-28 px-3 py-2 bg-bg border border-line rounded-token text-base';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <section className="bg-surface border border-line rounded-token p-5 mb-4 max-w-lg">
        <h2 className="font-semibold text-lg mb-1">Theme</h2>
        <p className="text-sm text-muted mb-3">Saved to your account — follows you to any PC.</p>
        <div className="flex gap-2 flex-wrap">
          {THEMES.map((t) => (
            <button key={t} onClick={() => pickTheme(t)}
              className={`px-5 py-3 rounded-token border text-base ${
                prefs.theme === t ? 'bg-accent text-accent-contrast border-accent font-semibold' : 'border-line hover:bg-bg'
              }`}>
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
        {(prefs.theme === 'light' || prefs.theme === 'dark') && (
          <div className="flex gap-3 mt-4 items-center">
            <span className="text-sm text-muted">Accent color:</span>
            {CUSTOM_ACCENTS.map((c) => (
              <button key={c} onClick={() => pickAccent(c)}
                className={`w-10 h-10 rounded-full border-4 ${prefs.accent === c ? 'border-ink' : 'border-line'}`}
                style={{ background: c }} aria-label={c} />
            ))}
          </div>
        )}
      </section>

      <div className="mb-4 max-w-2xl">
      <AdminGate>
      <section className="bg-surface border border-line rounded-token p-5 mb-4 max-w-2xl">
        <h2 className="font-semibold text-lg mb-1">Pricing, tax & customer levels</h2>
        <p className="text-sm text-muted mb-4">Per-material rates live on the Materials page. Level discounts apply after tax.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <label className="block text-sm"><span className="text-muted">Tax rate (%)</span>
            <input className={tIn} inputMode="decimal" value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)} /></label>
          {(['1', '2', '3'] as const).map((l) => (
            <label key={l} className="block text-sm"><span className="text-muted">Level {l} discount (%)</span>
              <input className={tIn} inputMode="decimal" value={levels[l]}
                onChange={(e) => setLevels({ ...levels, [l]: e.target.value })} /></label>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={saveTuning} className="px-5 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold">Save</button>
          {saved && <span className="text-ok text-sm">{saved}</span>}
          {tErr && <span className="text-danger text-sm">{tErr}</span>}
        </div>
      </section>

      <section className="bg-surface border border-line rounded-token p-5 mb-4 max-w-2xl">
        <h2 className="font-semibold text-lg mb-3">Accounts</h2>
        <input className="w-full px-3 py-2 bg-bg border border-line rounded-token text-sm mb-3"
          placeholder="Search accounts…" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
        <div className="space-y-2 mb-3">
          {users.filter((u) => u.name.toLowerCase().includes(userSearch.trim().toLowerCase())).map((u) => (
            <div key={u.id} className="flex items-center justify-between border-b border-line pb-2">
              <span className="font-semibold">{u.name}</span>
              <button onClick={() => removeUser(u)} className="px-3 py-1.5 text-sm border border-line rounded-token text-danger hover:bg-bg">Remove</button>
            </div>
          ))}
          {users.length === 0 && <p className="text-muted">No accounts yet — add the first one.</p>}
        </div>
        <button onClick={addUser} className="px-4 py-2 bg-accent text-accent-contrast rounded-token text-sm font-semibold">Add account</button>
      </section>

      <section className="bg-surface border border-line rounded-token p-5 mb-4 max-w-2xl">
        <h2 className="font-semibold text-lg mb-3">Admin</h2>
        <a href="/materials" className="text-accent underline">Manage materials & costs</a>
        <p className="text-sm text-muted mt-1 mb-3">Cost changes only affect future quotes.</p>
        <a href="/taxonomy" className="text-accent underline">Manage inventory categories & units</a>
        <p className="text-sm text-muted mt-1 mb-3">Organizes inventory; never changes pricing or the stock check.</p>
        <button onClick={async () => {
          const cur = prompt('Current admin password:'); if (cur === null) return;
          const next = prompt('New admin password:'); if (!next) return;
          try { await put('/api/admin/password', { current: cur, next }); alert('Password changed.'); }
          catch { alert('Wrong current password.'); }
        }} className="px-4 py-2 border border-line rounded-token text-sm hover:bg-bg">Change admin password</button>
      </section>

      </AdminGate>
      </div>

      <section className="bg-surface border border-line rounded-token p-5 max-w-lg">
        <h2 className="font-semibold text-lg mb-3">Server</h2>
        <p>
          {health === 'checking' && <span className="text-muted">Checking…</span>}
          {health === 'ok' && <span className="text-ok font-semibold">Connected</span>}
          {health === 'down' && (
            <span className="text-danger font-semibold">Unreachable — check the server PC/NAS</span>
          )}
        </p>
      </section>
    </div>
  );
}
