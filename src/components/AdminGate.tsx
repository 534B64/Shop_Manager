import { useState } from 'react';
import { post } from '../lib/api';
import { isAdminUnlocked, setAdminUnlocked } from '../lib/session';

// Wraps admin-only content behind the shop admin password (default: admin).
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(isAdminUnlocked());
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');

  async function unlock() {
    setError('');
    try {
      await post('/api/admin/login', { password: pw });
      setAdminUnlocked(true);
      setUnlocked(true);
    } catch { setError('Wrong password.'); }
  }

  if (unlocked) return <>{children}</>;
  return (
    <div className="bg-surface border border-line rounded-token p-5 max-w-md">
      <h2 className="font-semibold text-lg mb-2">Admin area</h2>
      <p className="text-muted text-sm mb-3">Pricing and configuration are locked.</p>
      <div className="flex gap-2">
        <input type="password" className="flex-1 px-3 py-2.5 bg-bg border border-line rounded-token"
          placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && unlock()} />
        <button onClick={unlock} className="px-5 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold">Unlock</button>
      </div>
      {error && <p className="text-danger mt-2">{error}</p>}
    </div>
  );
}
