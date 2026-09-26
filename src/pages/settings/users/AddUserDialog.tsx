import { useEffect, useState } from 'react';
import { Button, Dialog, Select, TextField, showSnackbar } from '../../../components/m3';
import { post } from '../../../lib/api';
import { errorText } from '../../../lib/errorText';
import type { Role } from '../../../lib/session';
import { ROLES, ROLE_HINT, ROLE_LABEL, newPinErrors } from '../logic';

/** Admin: new account (name, role, PIN). A deactivated same-name account is reactivated by the server. */
export default function AddUserDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('cashier');
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(''); setRole('cashier'); setPin(''); setRepeat(''); setTried(false); setError(null); } }, [open]);

  const pinErrs = tried ? newPinErrors(pin, repeat) : {};
  const nameErr = tried && !name.trim() ? 'Name is required.' : null;
  async function save() {
    setTried(true);
    if (!name.trim() || Object.keys(newPinErrors(pin, repeat)).length) return;
    setBusy(true); setError(null);
    try {
      await post('/api/users', { name: name.trim(), role, pin });
      showSnackbar(`Account added for ${name.trim()}`);
      onSaved(); onClose();
    } catch (e) { setError(errorText(e, 'Could not add the account')); }
    finally { setBusy(false); }
  }
  const pinProps = { type: 'password', inputMode: 'numeric' as const, autoComplete: 'off', maxLength: 12 };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} dismissOnScrim={false} title="Add user"
      actions={<>
        <Button variant="text" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Adding…' : 'Add user'}</Button>
      </>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={nameErr} maxLength={60} data-autofocus />
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} supportingText={ROLE_HINT[role]}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
        <TextField label="PIN" {...pinProps} value={pin} onChange={(e) => setPin(e.target.value)} error={pinErrs.next} supportingText="4–12 digits" />
        <TextField label="Repeat PIN" {...pinProps} value={repeat} onChange={(e) => setRepeat(e.target.value)} error={pinErrs.repeat} />
        <button type="submit" hidden />
      </form>
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
