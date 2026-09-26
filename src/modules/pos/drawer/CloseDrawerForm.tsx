import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, TextField, showSnackbar } from '../../../components/m3';
import { post } from '../../../lib/api';
import { formatCents, parseDollarsToCents } from '../../../lib/format';
import { errorText } from '../lib/errors';
import type { DrawerView } from '../types';
import OverShortBadge from './OverShortBadge';
import { previewOverShort } from './overShort';

const cents = (s: string) => (s.trim() === '' ? null : parseDollarsToCents(s));

/** Count the drawer and close it (manager+). The Z-report freezes on close — confirm first. */
export default function CloseDrawerForm({ drawer, onClosed }: { drawer: DrawerView; onClosed: () => void }) {
  const nav = useNavigate();
  const [cash, setCash] = useState('');
  const [checks, setChecks] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cashC = cents(cash);
  const checksC = cents(checks);
  const z = drawer.zReport;
  const cashOs = previewOverShort(z.cash.expectedCents, cashC);
  const checksOs = previewOverShort(z.checks.expectedCents, checksC);
  const cashBad = cash.trim() !== '' && cashC == null;
  const checksBad = checks.trim() !== '' && checksC == null;

  async function close() {
    setBusy(true); setError(null);
    try {
      await post('/api/drawer/close', { countedCashCents: cashC, ...(checksC != null ? { countedChecksCents: checksC } : {}),
        ...(note.trim() ? { note: note.trim() } : {}) });
      showSnackbar(`Drawer #${drawer.id} closed`);
      setConfirm(false);
      onClosed();
      nav(`/pos/drawer/${drawer.id}`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (cashC != null && !checksBad) setConfirm(true); }}>
      <TextField label="Counted cash $" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} autoComplete="off"
        error={cashBad ? 'Not an amount' : null} supportingText={`Expected ${formatCents(z.cash.expectedCents)} (float + cash in − cash out)`} />
      {cashOs != null && <OverShortBadge cents={cashOs} label="Cash" large />}
      <TextField label="Counted checks $ (optional)" inputMode="decimal" value={checks} onChange={(e) => setChecks(e.target.value)} autoComplete="off"
        error={checksBad ? 'Not an amount' : null} supportingText={`Expected ${formatCents(z.checks.expectedCents)}`} />
      {checksOs != null && <OverShortBadge cents={checksOs} label="Checks" large />}
      <TextField label="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" touch disabled={cashC == null || checksBad}>Close drawer…</Button>

      <Dialog open={confirm} onClose={() => !busy && setConfirm(false)} title={`Close drawer #${drawer.id}?`} dismissOnScrim={false}
        description="Closing freezes today’s Z-report. It can’t be reopened or changed, and cash is refused until a drawer is opened again."
        actions={<>
          <Button variant="text" touch onClick={() => setConfirm(false)} disabled={busy}>Keep open</Button>
          <Button touch onClick={close} disabled={busy}>{busy ? 'Closing…' : 'Close drawer'}</Button>
        </>}>
        <dl className="grid grid-cols-2 gap-y-1 text-body-large tabular-nums mb-3">
          <dt className="text-on-surface-variant">Expected cash</dt><dd className="text-right">{formatCents(z.cash.expectedCents)}</dd>
          <dt className="text-on-surface-variant">Counted cash</dt><dd className="text-right">{cashC != null ? formatCents(cashC) : '—'}</dd>
          {checksC != null && <><dt className="text-on-surface-variant">Counted checks</dt><dd className="text-right">{formatCents(checksC)}</dd></>}
        </dl>
        <OverShortBadge cents={cashOs} label="Cash" large />
        <p className="text-body-small text-on-surface-variant mt-2">The server recomputes expected cash at the moment you close; the Z-report shows the final numbers.</p>
        {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
      </Dialog>
    </form>
  );
}
