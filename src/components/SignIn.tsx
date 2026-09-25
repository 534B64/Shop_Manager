import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { setSession } from '../lib/session';
import { applyPrefs, DEFAULT_PREFS, type Prefs } from '../lib/theme';

interface User { id: number; name: string; }

export default function SignIn({ onDone }: { onDone: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { get<User[]>('/api/users').then(setUsers).catch(() => {}); }, []);

  async function login() {
    if (!picked) return;
    setError('');
    try {
      const r = await post<{ ok: boolean; prefs: Prefs | null }>('/api/users/verify', { name: picked, password: pw });
      setSession(picked, pw);
      applyPrefs(r.prefs ? { ...DEFAULT_PREFS, ...r.prefs } : DEFAULT_PREFS);
      onDone();
    } catch { setError('Wrong password.'); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg flex items-center justify-center app-chrome">
      <div className="bg-surface border border-line rounded-token p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-1">Decals Plus — Shop Manager</h1>
        <p className="text-muted mb-5">Sign in. Orders and payments are recorded under your name.</p>
        {users.length === 0 && (
          <p className="text-warn mb-4">No accounts yet — an admin must add accounts in Settings → Accounts. (Tip: the server seeds nothing; ask the owner.)</p>
        )}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {users.map((u) => (
            <button key={u.id} onClick={() => { setPicked(u.name); setPw(''); setError(''); }}
              className={`px-4 py-4 rounded-token font-semibold text-lg border ${
                picked === u.name ? 'bg-accent text-accent-contrast border-accent' : 'border-line hover:bg-bg'
              }`}>
              {u.name}
            </button>
          ))}
        </div>
        {picked && (
          <div className="flex gap-2">
            <input type="password" autoFocus className="flex-1 px-3 py-3 bg-bg border border-line rounded-token text-base"
              placeholder={`Password for ${picked}`} value={pw} onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()} />
            <button onClick={login} className="px-5 py-3 bg-accent text-accent-contrast rounded-token font-semibold">Sign in</button>
          </div>
        )}
        {error && <p className="text-danger mt-3">{error}</p>}
      </div>
    </div>
  );
}
