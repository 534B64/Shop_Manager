import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { setSession, type SessionUser } from '../lib/session';
import { applyPrefs, DEFAULT_PREFS, type Prefs } from '../lib/theme';

interface Account { id: number; name: string; }
interface Status { needsSetup: boolean; accounts: Account[] }
interface LoginResult { token: string; user: SessionUser & { prefs: Prefs | null } }

export default function SignIn({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  // First-run setup (no admin can sign in yet).
  const [setupName, setSetupName] = useState('');
  const [setupPin2, setSetupPin2] = useState('');

  useEffect(() => { get<Status>('/api/auth/status').then(setStatus).catch(() => setError('Server unreachable — check the server PC/NAS.')); }, []);

  function finish(r: LoginResult) {
    setSession(r.token, r.user);
    applyPrefs(r.user.prefs ? { ...DEFAULT_PREFS, ...r.user.prefs } : DEFAULT_PREFS);
    onDone();
  }

  async function login() {
    if (!picked) return;
    setError('');
    try { finish(await post<LoginResult>('/api/auth/login', { name: picked, pin })); }
    catch (e) { setError(e instanceof Error && e.message !== 'Wrong name or PIN' ? e.message : 'Wrong PIN.'); setPin(''); }
  }

  async function setup() {
    setError('');
    if (!setupName.trim()) return setError('Enter your name.');
    if (!/^\d{4,12}$/.test(pin)) return setError('PIN must be 4–12 digits.');
    if (pin !== setupPin2) return setError('PINs do not match.');
    try { finish(await post<LoginResult>('/api/auth/setup', { name: setupName.trim(), pin })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Setup failed'); }
  }

  const pinInput = 'flex-1 px-3 py-3 bg-bg border border-line rounded-token text-base';

  return (
    <div className="fixed inset-0 z-50 bg-bg flex items-center justify-center app-chrome">
      <div className="bg-surface border border-line rounded-token p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-1">Decals Plus — Shop Manager</h1>
        {status?.needsSetup ? (
          <>
            <p className="text-muted mb-5">First-time setup: create the owner (admin) account. Everyone else is added in Settings → Accounts.</p>
            <div className="space-y-2">
              <input autoFocus className="w-full px-3 py-3 bg-bg border border-line rounded-token text-base"
                placeholder="Your name" value={setupName} onChange={(e) => setSetupName(e.target.value)} />
              <div className="flex gap-2">
                <input type="password" inputMode="numeric" className={pinInput} placeholder="PIN (4+ digits)"
                  value={pin} onChange={(e) => setPin(e.target.value)} />
                <input type="password" inputMode="numeric" className={pinInput} placeholder="Repeat PIN"
                  value={setupPin2} onChange={(e) => setSetupPin2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setup()} />
              </div>
              <button onClick={setup} className="w-full px-5 py-3 bg-accent text-accent-contrast rounded-token font-semibold">Create admin &amp; sign in</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted mb-5">Sign in. Orders and payments are recorded under your name.</p>
            {status && status.accounts.length === 0 && (
              <p className="text-warn mb-4">No accounts can sign in yet — an admin must set a PIN in Settings → Accounts.</p>
            )}
            <div className="grid grid-cols-2 gap-2 mb-5">
              {(status?.accounts ?? []).map((u) => (
                <button key={u.id} onClick={() => { setPicked(u.name); setPin(''); setError(''); }}
                  className={`px-4 py-4 rounded-token font-semibold text-lg border ${
                    picked === u.name ? 'bg-accent text-accent-contrast border-accent' : 'border-line hover:bg-bg'
                  }`}>
                  {u.name}
                </button>
              ))}
            </div>
            {picked && (
              <div className="flex gap-2">
                <input type="password" inputMode="numeric" autoFocus className={pinInput}
                  placeholder={`PIN for ${picked}`} value={pin} onChange={(e) => setPin(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && login()} />
                <button onClick={login} className="px-5 py-3 bg-accent text-accent-contrast rounded-token font-semibold">Sign in</button>
              </div>
            )}
          </>
        )}
        {error && <p className="text-danger mt-3">{error}</p>}
      </div>
    </div>
  );
}
