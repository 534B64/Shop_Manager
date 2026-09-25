import { useEffect, useRef, useState } from 'react';
import { setApprovalPrompt, type Approval } from '../lib/api';

// The one "Manager approval" dialog (ADR 0004). Mounted once in App; api.ts
// opens it whenever the server answers 403 approval_required, then retries the
// same request with the manager's name + PIN attached. Pages never build their
// own approval prompt.

const ACTION_LABELS: Record<string, string> = {
  'payment.void': 'Void a payment',
  'payment.refund': 'Record a refund',
  'job.pickup_unpaid': 'Release an order with a balance due',
  'job.delete': 'Remove an order',
  'job.unarchive': 'Restore a removed order',
  'customer.delete': 'Archive a customer',
  'customer.unarchive': 'Restore an archived customer',
  'customer.credit_adjust': 'Adjust store credit',
  'inventory.adjust': 'Change a stock count',
};

interface Pending { action: string; error?: string; resolve: (a: Approval | null) => void }

export default function ApprovalHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setApprovalPrompt((action, error) => new Promise((resolve) => {
      setPin('');
      if (!error) { setName(''); setReason(''); }
      setPending({ action, error, resolve });
    }));
    return () => setApprovalPrompt(async () => null);
  }, []);
  useEffect(() => { if (pending?.error) pinRef.current?.focus(); }, [pending]);

  if (!pending) return null;
  const close = (a: Approval | null) => { pending.resolve(a); setPending(null); };
  const submit = () => {
    if (!name.trim() || !pin) return;
    close({ name: name.trim(), pin, ...(reason.trim() ? { reason: reason.trim() } : {}) });
  };
  const field = 'w-full px-3 py-2.5 bg-bg border border-line rounded-token text-base';

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => close(null)}>
      <div className="bg-surface border border-line rounded-token p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-xl mb-1">Manager approval</h2>
        <p className="text-muted text-sm mb-4">
          {ACTION_LABELS[pending.action] ?? 'This action'} needs a manager. They enter their own name and PIN — it's logged under them.
        </p>
        <div className="space-y-2">
          <input autoFocus className={field} placeholder="Manager name" value={name} onChange={(e) => setName(e.target.value)} />
          <input ref={pinRef} type="password" inputMode="numeric" className={field} placeholder="Manager PIN"
            value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <input className={field} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        {pending.error && <p className="text-danger text-sm mt-2">{pending.error}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={submit} className="flex-1 px-4 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold">Approve</button>
          <button onClick={() => close(null)} className="px-4 py-2.5 border border-line rounded-token">Cancel</button>
        </div>
      </div>
    </div>
  );
}
