import { useEffect, useState } from 'react';
import { Button, Dialog, TextField } from '../../components/m3';
import { post, put } from '../../lib/api';
import { formatPhone } from '../../lib/format';
import { errorText } from '../../lib/errorText';
import { profileErrors, WALK_IN, type ProfileInput } from './logic';
import type { Customer } from '../../lib/types';

const blank: ProfileInput = { name: '', email: '', phone: '', notes: '' };
const fromCustomer = (c: Customer): ProfileInput =>
  ({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', notes: c.notes ?? '' });

/** New customer (no `customer`) or edit profile. Calls onSaved with the server's row. */
export default function CustomerFormDialog({ open, onClose, customer, onSaved }: {
  open: boolean; onClose: () => void; customer?: Customer; onSaved: (c: Customer) => void;
}) {
  const [form, setForm] = useState<ProfileInput>(blank);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setForm(customer ? fromCustomer(customer) : blank); setTried(false); setError(null); }
  }, [open, customer]);

  const errs = tried ? profileErrors(form) : {};
  const set = (k: keyof ProfileInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: k === 'phone' ? formatPhone(e.target.value) : e.target.value });

  async function save() {
    setTried(true);
    if (Object.keys(profileErrors(form)).length) return;
    setBusy(true); setError(null);
    const body = { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), notes: form.notes.trim() };
    try {
      const row = customer
        ? await put<Customer>(`/api/customers/${customer.id}`, body)
        : await post<Customer>('/api/customers', Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '')));
      onSaved(row);
      onClose();
    } catch (e) { setError(errorText(e, 'Save failed')); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} dismissOnScrim={false}
      title={customer ? 'Edit customer' : 'New customer'}
      description={form.name.trim() === WALK_IN ? 'The Walk-in counter record may go without an email.' : 'Email is required for every customer except Walk-in.'}
      actions={<>
        <Button variant="text" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <TextField label="Name" value={form.name} onChange={set('name')} error={errs.name} maxLength={120} data-autofocus required />
        <TextField label="Email" type="email" value={form.email} onChange={set('email')} error={errs.email} maxLength={120} />
        <TextField label="Phone" inputMode="tel" value={form.phone} onChange={set('phone')} error={errs.phone} supportingText="10 digits" />
        <TextField label="Notes" value={form.notes} onChange={set('notes')} maxLength={2000} />
        <button type="submit" hidden />
      </form>
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
