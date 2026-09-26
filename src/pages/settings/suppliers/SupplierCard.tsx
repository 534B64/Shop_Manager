import { useEffect, useState } from 'react';
import { Badge, Button, Card, TextField, showSnackbar } from '../../../components/m3';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { del, post, put } from '../../../lib/api';
import { errorText } from '../../../lib/errorText';
import { hasRole } from '../../../lib/session';
import type { Supplier } from '../../../lib/types';
import { numberIn } from '../logic';

interface Draft { name: string; lead: string; contact: string }
const draftOf = (s: Supplier): Draft => ({ name: s.name, lead: String(s.leadTimeDays), contact: s.contact ?? '' });

export default function SupplierCard({ supplier: s, onChanged }: { supplier: Supplier; onChanged: () => void }) {
  const saved = JSON.stringify(draftOf(s));
  const [d, setD] = useState<Draft>(() => draftOf(s));
  useEffect(() => setD(draftOf(s)), [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'archive' | 'restore'>(null);
  const lead = numberIn(d.lead, 0, 365);
  const leadErr = lead === null || !Number.isInteger(lead) ? 'Whole days, 0–365' : null;
  const nameErr = !d.name.trim() ? 'Name is required.' : null;

  const act = async (fn: () => Promise<unknown>, ok: string, fail: string) => {
    setBusy(true);
    try { await fn(); showSnackbar(ok); onChanged(); } catch (e) { showSnackbar(errorText(e, fail)); } finally { setBusy(false); }
  };
  const save = () => act(() => put(`/api/suppliers/${s.id}`, { name: d.name.trim(), leadTimeDays: lead, contact: d.contact.trim() || null }),
    `${d.name.trim()} saved`, 'Save failed');
  const archived = !!s.archivedAt;

  return (
    <Card className={archived || !s.active ? 'bg-surface-container-low' : undefined}>
      <form className="flex flex-wrap items-start gap-3" onSubmit={(e) => { e.preventDefault(); if (!nameErr && !leadErr) save(); }} noValidate>
        <TextField label="Name" variant="outlined" className="flex-1 min-w-52" value={d.name} error={nameErr}
          onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={120} />
        <TextField label="Lead time (days)" variant="outlined" inputMode="numeric" className="w-40" value={d.lead} error={leadErr}
          onChange={(e) => setD({ ...d, lead: e.target.value })} />
        <TextField label="Contact (phone / email / rep)" variant="outlined" className="w-64" value={d.contact}
          onChange={(e) => setD({ ...d, contact: e.target.value })} maxLength={200} />
        <Button type="submit" className="mt-2" disabled={busy || !!nameErr || !!leadErr || JSON.stringify(d) === saved}>{busy ? 'Saving…' : 'Save'}</Button>
      </form>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {!s.active && <Badge tone="neutral" className="!h-5 px-2">Inactive</Badge>}
        {archived && <Badge tone="neutral" className="!h-5 px-2">Archived</Badge>}
        <span className="flex-1" />
        <Button variant="text" disabled={busy} onClick={() => act(() => put(`/api/suppliers/${s.id}`, { active: !s.active }),
          `${s.name} ${s.active ? 'deactivated' : 'reactivated'}`, 'Update failed')}>{s.active ? 'Deactivate' : 'Reactivate'}</Button>
        {hasRole('admin') && (archived
          ? <Button variant="text" disabled={busy} onClick={() => setConfirm('restore')}>Restore</Button>
          : <Button variant="text" className="!text-error" disabled={busy} onClick={() => setConfirm('archive')}>Archive</Button>)}
      </div>
      <ConfirmDialog open={confirm === 'archive'} onClose={() => setConfirm(null)} danger confirmLabel="Archive"
        title={`Archive “${s.name}”?`}
        onConfirm={async () => { await del(`/api/suppliers/${s.id}`, {}); showSnackbar(`${s.name} archived`); onChanged(); }}>
        It’s hidden from lists and pickers; receiving history and items that use it keep it. You can restore it later.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'restore'} onClose={() => setConfirm(null)} confirmLabel="Restore"
        title={`Restore “${s.name}”?`}
        onConfirm={async () => { await post(`/api/suppliers/${s.id}/unarchive`, {}); showSnackbar(`${s.name} restored`); onChanged(); }}>
        It shows up in lists and pickers again.
      </ConfirmDialog>
    </Card>
  );
}
