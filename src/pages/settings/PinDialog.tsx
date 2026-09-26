import { useEffect, useState } from 'react';
import { Button, Dialog, TextField } from '../../components/m3';
import { errorText } from '../../lib/errorText';
import { newPinErrors } from './logic';

/**
 * New PIN (+ repeat) dialog. `askCurrent` adds the current-PIN field (changing
 * your own PIN). `onSubmit` gets the values; throw to show the server's error.
 */
export default function PinDialog({ open, onClose, title, description, askCurrent, submitLabel, onSubmit }: {
  open: boolean; onClose: () => void; title: string; description?: string; askCurrent?: boolean; submitLabel: string;
  onSubmit: (v: { current: string; next: string }) => Promise<void>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setCurrent(''); setNext(''); setRepeat(''); setTried(false); setError(null); } }, [open]);

  const errs = tried ? newPinErrors(next, repeat) : {};
  const currentErr = tried && askCurrent && !current ? 'Enter your current PIN.' : null;
  async function save() {
    setTried(true);
    if (Object.keys(newPinErrors(next, repeat)).length || (askCurrent && !current)) return;
    setBusy(true); setError(null);
    try { await onSubmit({ current, next }); onClose(); }
    catch (e) { setError(errorText(e, 'PIN change failed')); }
    finally { setBusy(false); }
  }
  const pin = { type: 'password', inputMode: 'numeric' as const, autoComplete: 'off', maxLength: 12 };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} dismissOnScrim={false} title={title} description={description}
      actions={<>
        <Button variant="text" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
      </>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        {askCurrent && <TextField label="Current PIN" {...pin} value={current} onChange={(e) => setCurrent(e.target.value)} error={currentErr} data-autofocus />}
        <TextField label="New PIN" {...pin} value={next} onChange={(e) => setNext(e.target.value)} error={errs.next}
          supportingText="4–12 digits" data-autofocus={askCurrent ? undefined : true} />
        <TextField label="Repeat new PIN" {...pin} value={repeat} onChange={(e) => setRepeat(e.target.value)} error={errs.repeat} />
        <button type="submit" hidden />
      </form>
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
