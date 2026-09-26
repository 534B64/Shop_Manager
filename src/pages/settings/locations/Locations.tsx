// /settings/locations (admin) — places stock sits (ADR 0006). Archiving is
// refused for the default Shop location and while stock is still there.
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, DataTable, Dialog, TextField, showSnackbar, type Column } from '../../../components/m3';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { del, post, put } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { errorText } from '../../../lib/errorText';
import { formatDate } from '../../../lib/format';
import SettingsFrame from '../SettingsFrame';

interface Location { id: number; name: string; archivedAt: string | null; createdAt?: string }
type Open = null | { kind: 'rename' | 'archive' | 'restore'; loc: Location };

export default function Locations() {
  const [showArchived, setShowArchived] = useState(false);
  const q = useQuery<Location[]>(`/api/locations${showArchived ? '?includeArchived=1' : ''}`);
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const loc = open?.loc;

  const cols: Column<Location>[] = [
    { key: 'name', header: 'Name', render: (l) => (
      <span className="flex items-center gap-2"><span className="text-title-small">{l.name}</span>
        {l.id === 1 && <Badge tone="neutral" className="!h-5 px-2">Default</Badge>}
        {l.archivedAt && <Badge tone="neutral" className="!h-5 px-2">Archived {formatDate(l.archivedAt)}</Badge>}</span>
    ) },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', render: (l) => (
      <span className="inline-flex gap-1">
        <Button variant="text" onClick={() => setOpen({ kind: 'rename', loc: l })}>Rename</Button>
        {l.archivedAt
          ? <Button variant="text" onClick={() => setOpen({ kind: 'restore', loc: l })}>Restore</Button>
          : l.id !== 1 && <Button variant="text" className="!text-error" onClick={() => setOpen({ kind: 'archive', loc: l })}>Archive</Button>}
      </span>
    ) },
  ];

  return (
    <SettingsFrame title="Locations" min="admin"
      subtitle="Where stock sits. On-hand is kept per location; a transfer moves stock between them without changing the item’s total.">
      <AddLocation onAdded={q.reload} />
      <Checkbox label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="my-3" />
      <DataTable label="Locations" columns={cols} rows={q.data ?? []} rowKey={(l) => l.id}
        loading={q.loading} error={q.error} onRetry={q.reload} className="max-w-3xl" />

      <RenameDialog loc={open?.kind === 'rename' ? loc! : null} onClose={close} onSaved={q.reload} />
      <ConfirmDialog open={open?.kind === 'archive'} onClose={close} danger confirmLabel="Archive"
        title={`Archive “${loc?.name ?? ''}”?`}
        onConfirm={async () => { await del(`/api/locations/${loc!.id}`); showSnackbar(`${loc!.name} archived`); q.reload(); }}>
        It’s hidden from pickers. Stock must be transferred out first; history stays.
      </ConfirmDialog>
      <ConfirmDialog open={open?.kind === 'restore'} onClose={close} confirmLabel="Restore"
        title={`Restore “${loc?.name ?? ''}”?`}
        onConfirm={async () => { await post(`/api/locations/${loc!.id}/unarchive`, {}); showSnackbar(`${loc!.name} restored`); q.reload(); }}>
        It shows up in pickers again.
      </ConfirmDialog>
    </SettingsFrame>
  );
}

function AddLocation({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(null);
    try { await post('/api/locations', { name: name.trim() }); showSnackbar(`Added ${name.trim()}`); setName(''); onAdded(); }
    catch (e) { setError(errorText(e, 'Add failed')); }
    finally { setBusy(false); }
  }
  return (
    <Card variant="filled" className="max-w-3xl">
      <form className="flex flex-wrap items-start gap-3" onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
        <TextField label="New location" variant="outlined" className="flex-1 min-w-52" placeholder="Back room"
          value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={60} />
        <Button type="submit" icon="add" className="mt-2" disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
      </form>
    </Card>
  );
}

function RenameDialog({ loc, onClose, onSaved }: { loc: Location | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (loc) { setName(loc.name); setError(null); } }, [loc]);
  async function save() {
    if (!loc) return;
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(null);
    try { await put(`/api/locations/${loc.id}`, { name: name.trim() }); showSnackbar('Location renamed'); onSaved(); onClose(); }
    catch (e) { setError(errorText(e, 'Rename failed')); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={!!loc} onClose={() => !busy && onClose()} title="Rename location"
      actions={<>
        <Button variant="text" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={60} data-autofocus />
      </form>
    </Dialog>
  );
}
