import { useState, type ReactNode } from 'react';
import { Button, Dialog } from './m3';
import { errorText, approvalCancelled } from '../lib/errorText';

/**
 * Yes/no dialog that replaces window.confirm(). `onConfirm` runs with the
 * button disabled; a failure shows inline and keeps the dialog open.
 */
export default function ConfirmDialog({ open, onClose, title, children, confirmLabel, danger, onConfirm }: {
  open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode;
  confirmLabel: string; danger?: boolean; onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { if (!busy) { setError(null); onClose(); } };
  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm(); setBusy(false); onClose(); }
    catch (e) { setBusy(false); if (!approvalCancelled(e)) setError(errorText(e)); }
  }
  return (
    <Dialog open={open} onClose={close} title={title}
      actions={<>
        <Button variant="text" onClick={close} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'filled'} onClick={go} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Button>
      </>}>
      {children && <div className="text-body-medium text-on-surface-variant">{children}</div>}
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
