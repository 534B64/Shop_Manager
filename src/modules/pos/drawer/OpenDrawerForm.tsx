import { useState } from 'react';
import { Button, TextField, showSnackbar } from '../../../components/m3';
import { post } from '../../../lib/api';
import { formatCents, parseDollarsToCents } from '../../../lib/format';
import { errorText } from '../lib/errors';

/** Count the starting cash and open the drawer. Used on the drawer page and inline at the counter. */
export default function OpenDrawerForm({ onOpened, compact }: { onOpened: () => void; compact?: boolean }) {
  const [float, setFloat] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseDollarsToCents(float);

  async function open() {
    if (cents == null) { setError('Enter the starting cash, e.g. 100 or 150.00 (0 is fine).'); return; }
    setBusy(true); setError(null);
    try {
      await post('/api/drawer/open', { openingFloatCents: cents, ...(note.trim() ? { note: note.trim() } : {}) });
      showSnackbar(`Drawer opened with ${formatCents(cents)}`);
      onOpened();
    } catch (e) {
      setError(errorText(e));
      onOpened(); // someone else may have opened it — refresh the status either way
    } finally { setBusy(false); }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void open(); }}>
      <TextField label="Starting cash (float) $" inputMode="decimal" value={float} autoComplete="off"
        onChange={(e) => setFloat(e.target.value)} error={error}
        supportingText="Count the cash in the drawer before the first sale." />
      {!compact && <TextField label="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}
      <Button type="submit" touch icon="check" disabled={busy}>{busy ? 'Opening…' : 'Open drawer'}</Button>
    </form>
  );
}
