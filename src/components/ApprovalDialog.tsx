import { useEffect, useRef, useState } from 'react';
import { setApprovalPrompt, type Approval } from '../lib/api';
import { ACTION_LABELS } from '../lib/approvalLabels';
import { Button, Dialog, TextField } from './m3';

// The one "Manager approval" dialog (ADR 0004). Mounted once in App; api.ts
// opens it whenever the server answers 403 approval_required, then retries the
// same request with the manager's name + PIN attached. Pages never build their
// own approval prompt.

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

  const close = (a: Approval | null) => { pending?.resolve(a); setPending(null); };
  const submit = () => {
    if (!name.trim() || !pin) return;
    close({ name: name.trim(), pin, ...(reason.trim() ? { reason: reason.trim() } : {}) });
  };
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') submit(); };

  return (
    <Dialog open={!!pending} onClose={() => close(null)} title="Manager approval" dismissOnScrim={false}
      description={`${ACTION_LABELS[pending?.action ?? ''] ?? 'This action'} needs a manager. They enter their own name and PIN — it's logged under them.`}
      actions={<>
        <Button variant="text" touch onClick={() => close(null)}>Cancel</Button>
        <Button touch onClick={submit} disabled={!name.trim() || !pin}>Approve</Button>
      </>}>
      <div className="space-y-3">
        <TextField label="Manager name" autoFocus autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
        <TextField ref={pinRef} label="Manager PIN" type="password" inputMode="numeric" autoComplete="off"
          value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={onEnter} error={pending?.error} />
        <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={onEnter} />
      </div>
    </Dialog>
  );
}
