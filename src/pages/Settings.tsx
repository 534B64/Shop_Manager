import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { THEMES, CUSTOM_ACCENTS, DEFAULT_TAX_RATE_PCT, type Theme } from '../../shared/domain';
import { getPrefs, applyPrefs, type Prefs } from '../lib/theme';
import { savePrefs, hasRole, sessionUser, type Role } from '../lib/session';
import { get, put, post, del } from '../lib/api';
import RoleGate from '../components/RoleGate';

const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', minimal: 'High Contrast' };
const ROLES: Role[] = ['cashier', 'manager', 'admin'];
const ROLE_HINT: Record<Role, string> = {
  cashier: 'quotes, orders, payments; voids/refunds need a manager',
  manager: 'approves voids, refunds, overrides; runs inventory setup',
  admin: 'everything, incl. pricing, tax, and accounts',
};
const PIN_RE = /^\d{4,12}$/;
interface User { id: number; name: string; role: Role; active: boolean; hasPin: boolean; }

export default function Settings() {
  const [prefs, setPrefs] = useState<Prefs>(getPrefs);
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [levels, setLevels] = useState<Record<string, string>>({ 1: '5', 2: '10', 3: '15' });
  const [taxRate, setTaxRate] = useState(String(DEFAULT_TAX_RATE_PCT));
  const [users, setUsers] = useState<User[]>([]);
  const [saved, setSaved] = useState('');
  const [tErr, setTErr] = useState('');
  const [userSearch, setUserSearch] = useState('');
  // Inventory knobs (2026-07-07): count-variance threshold + reorder buffer.
  const [invPct, setInvPct] = useState('5');
  const [invUnits, setInvUnits] = useState('5');
  const [invBuffer, setInvBuffer] = useState('3');

  useEffect(() => {
    fetch('/api/health').then((r) => setHealth(r.ok ? 'ok' : 'down')).catch(() => setHealth('down'));
    get<Record<string, number>>('/api/settings/levels').then((l) => setLevels({ 1: String(l['1']), 2: String(l['2']), 3: String(l['3']) })).catch(() => {});
    get<{ ratePct: number }>('/api/settings/tax').then((t) => setTaxRate(String(t.ratePct))).catch(() => {});
    get<{ pctThreshold: number; unitThreshold: number; reorderBufferDays: number }>('/api/settings/inventory')
      .then((s) => { setInvPct(String(s.pctThreshold)); setInvUnits(String(s.unitThreshold)); setInvBuffer(String(s.reorderBufferDays)); })
      .catch(() => {});
    if (hasRole('admin')) refreshUsers();
  }, []);

  const refreshUsers = () => get<User[]>('/api/users?all=1').then(setUsers).catch(() => {});

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
      await put('/api/settings/inventory', {
        pctThreshold: Math.max(0, Number(invPct) || 0),
        unitThreshold: Math.max(0, Number(invUnits) || 0),
        reorderBufferDays: Math.max(0, Number(invBuffer) || 0),
      });
      setSaved('Saved. New quotes use these settings immediately.');
    } catch (e) { setTErr(e instanceof Error ? e.message : 'Save failed'); }
  }

  const fail = (e: unknown, fallback: string) => alert(e instanceof Error ? e.message : fallback);

  async function addUser() {
    const name = prompt('New account name:'); if (!name?.trim()) return;
    const pin = prompt(`PIN for ${name} (4–12 digits):`); if (!pin) return;
    if (!PIN_RE.test(pin)) return alert('PIN must be 4–12 digits.');
    try { await post('/api/users', { name: name.trim(), role: 'cashier', pin }); refreshUsers(); }
    catch (e) { fail(e, 'Could not add the account.'); }
  }

  async function setRole(u: User, role: Role) {
    try { await put(`/api/users/${u.id}`, { role }); refreshUsers(); }
    catch (e) { fail(e, 'Role change failed.'); refreshUsers(); }
  }

  async function resetPin(u: User) {
    const pin = prompt(`New PIN for ${u.name} (4–12 digits). They'll be signed out everywhere:`); if (!pin) return;
    if (!PIN_RE.test(pin)) return alert('PIN must be 4–12 digits.');
    try { await put(`/api/users/${u.id}/pin`, { pin }); alert(`PIN reset for ${u.name}.`); refreshUsers(); }
    catch (e) { fail(e, 'PIN reset failed.'); }
  }

  async function toggleActive(u: User) {
    if (u.active && !confirm(`Deactivate ${u.name}? They're signed out and can't sign in until reactivated. Their name stays on past orders.`)) return;
    try {
      if (u.active) await del(`/api/users/${u.id}`, {});
      else await put(`/api/users/${u.id}`, { active: true });
      refreshUsers();
    } catch (e) { fail(e, 'Update failed.'); }
  }

  async function changeMyPin() {
    const current = prompt('Your current PIN:'); if (current === null) return;
    const next = prompt('New PIN (4–12 digits):'); if (!next) return;
    if (!PIN_RE.test(next)) return alert('PIN must be 4–12 digits.');
    if (prompt('Repeat the new PIN:') !== next) return alert('PINs did not match — nothing changed.');
    try { await put('/api/users/me/pin', { current, next }); alert('PIN changed. Other PCs signed in as you were signed out.'); }
    catch (e) { fail(e, 'PIN change failed.'); }
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
        {(
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

      <section className="bg-surface border border-line rounded-token p-5 mb-4 max-w-lg">
        <h2 className="font-semibold text-lg mb-1">My account</h2>
        <p className="text-sm text-muted mb-3">Signed in as <b className="text-ink">{sessionUser()?.name}</b> ({sessionUser()?.role}).</p>
        <button onClick={changeMyPin} className="px-4 py-2 border border-line rounded-token text-sm hover:bg-bg">Change my PIN</button>
      </section>

      <RoleGate min="manager" quiet>
      <section className="bg-surface border border-line rounded-token p-5 mb-4 max-w-2xl">
        <h2 className="font-semibold text-lg mb-3">Admin</h2>
        {hasRole('admin') && (<>
          <Link to="/settings/materials" className="text-accent underline">Manage materials & costs</Link>
          <p className="text-sm text-muted mt-1 mb-3">Cost changes only affect future quotes.</p>
        </>)}
        <Link to="/settings/taxonomy" className="text-accent underline">Manage inventory categories, units & suppliers</Link>
        <p className="text-sm text-muted mt-1">Organizes inventory; never changes pricing or the stock check.</p>
      </section>
      </RoleGate>

      <div className="mb-4 max-w-2xl">
      <RoleGate min="admin" quiet>
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
        <div className="mt-5 pt-4 border-t border-line">
          <h3 className="font-semibold mb-1">Inventory</h3>
          <p className="text-sm text-muted mb-3">A cycle-count variance needs a reason when it beats either threshold. Buffer days pad the AUTO reorder point (usage/day × lead + buffer).</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <label className="block text-sm"><span className="text-muted">Variance threshold (%)</span>
              <input className={tIn} inputMode="decimal" value={invPct}
                onChange={(e) => setInvPct(e.target.value)} /></label>
            <label className="block text-sm"><span className="text-muted">Variance threshold (units)</span>
              <input className={tIn} inputMode="decimal" value={invUnits}
                onChange={(e) => setInvUnits(e.target.value)} /></label>
            <label className="block text-sm"><span className="text-muted">Reorder buffer (days)</span>
              <input className={tIn} inputMode="decimal" value={invBuffer}
                onChange={(e) => setInvBuffer(e.target.value)} /></label>
          </div>
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
            <div key={u.id} className={`flex flex-wrap items-center gap-2 border-b border-line pb-2 ${u.active ? '' : 'opacity-50'}`}>
              <span className="font-semibold flex-1 min-w-24">
                {u.name}
                {!u.hasPin && u.active && <span className="text-warn text-xs font-normal ml-2">no PIN — can't sign in</span>}
                {!u.active && <span className="text-muted text-xs font-normal ml-2">deactivated</span>}
              </span>
              <select value={u.role} onChange={(e) => setRole(u, e.target.value as Role)} disabled={!u.active}
                title={ROLE_HINT[u.role]} className="px-2 py-1.5 text-sm bg-bg border border-line rounded-token">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button onClick={() => resetPin(u)} className="px-3 py-1.5 text-sm border border-line rounded-token hover:bg-bg">{u.hasPin ? 'Reset PIN' : 'Set PIN'}</button>
              <button onClick={() => toggleActive(u)} className={`px-3 py-1.5 text-sm border border-line rounded-token hover:bg-bg ${u.active ? 'text-danger' : ''}`}>{u.active ? 'Deactivate' : 'Reactivate'}</button>
            </div>
          ))}
          {users.length === 0 && <p className="text-muted">No accounts yet — add the first one.</p>}
        </div>
        <p className="text-sm text-muted mb-3">New accounts start as cashier — pick a role after adding. Roles: {ROLES.map((r) => `${r} (${ROLE_HINT[r]})`).join('; ')}.</p>
        <button onClick={addUser} className="px-4 py-2 bg-accent text-accent-contrast rounded-token text-sm font-semibold">Add account</button>
      </section>

      </RoleGate>
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
