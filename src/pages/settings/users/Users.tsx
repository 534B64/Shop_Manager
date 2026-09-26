// /settings/users (admin) — accounts: add, role, reset PIN, deactivate/reactivate.
// The server refuses anything that would leave no active admin; its message shows as-is.
import { useState } from 'react';
import { Badge, Button, Checkbox, DataTable, Select, TextField, showSnackbar, type Column } from '../../../components/m3';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { del, put } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { errorText } from '../../../lib/errorText';
import { sessionUser, type Role } from '../../../lib/session';
import SettingsFrame from '../SettingsFrame';
import PinDialog from '../PinDialog';
import { ROLES, ROLE_HINT, ROLE_LABEL, visibleRows } from '../logic';
import AddUserDialog from './AddUserDialog';

export interface User { id: number; name: string; role: Role; active: boolean; hasPin: boolean }
type Open = null | { kind: 'add' } | { kind: 'pin' | 'deactivate' | 'reactivate'; user: User };

export default function Users() {
  const q = useQuery<User[]>('/api/users?all=1');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const me = sessionUser();
  const rows = visibleRows((q.data ?? []).map((u) => ({ ...u, archivedAt: u.active ? null : 'inactive' })), showInactive, search);

  async function setRole(u: User, role: Role) {
    setBusyId(u.id);
    try { await put(`/api/users/${u.id}`, { role }); showSnackbar(`${u.name} is now ${ROLE_LABEL[role].toLowerCase()}`); }
    catch (e) { showSnackbar(errorText(e, 'Role change failed')); }
    finally { setBusyId(null); q.reload(); }
  }

  const cols: Column<User>[] = [
    { key: 'name', header: 'Name', render: (u) => (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-title-small">{u.name}</span>
        {u.id === me?.id && <Badge tone="neutral" className="!h-5 px-2">You</Badge>}
        {!u.active && <Badge tone="neutral" className="!h-5 px-2">Deactivated</Badge>}
        {u.active && !u.hasPin && <Badge tone="warning" className="!h-5 px-2">No PIN — can’t sign in</Badge>}
      </span>
    ) },
    { key: 'role', header: 'Role', width: 'w-48', render: (u) => (
      <Select label={`Role for ${u.name}`} className="w-40" variant="outlined" value={u.role} disabled={!u.active || busyId === u.id}
        title={ROLE_HINT[u.role]} onChange={(e) => setRole(u, e.target.value as Role)}>
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </Select>
    ) },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', render: (u) => (
      <span className="inline-flex flex-wrap justify-end gap-1">
        <Button variant="text" onClick={() => setOpen({ kind: 'pin', user: u })}>{u.hasPin ? 'Reset PIN' : 'Set PIN'}</Button>
        {u.active
          ? <Button variant="text" className="!text-error" onClick={() => setOpen({ kind: 'deactivate', user: u })}>Deactivate</Button>
          : <Button variant="text" onClick={() => setOpen({ kind: 'reactivate', user: u })}>Reactivate</Button>}
      </span>
    ) },
  ];

  const target = open && open.kind !== 'add' ? open.user : null;
  const close = () => setOpen(null);
  return (
    <SettingsFrame title="Users" min="admin"
      subtitle="New accounts start with the role you pick. Deactivated people can’t sign in; their name stays on past orders."
      actions={<Button icon="add" onClick={() => setOpen({ kind: 'add' })}>Add user</Button>}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <TextField label="Search users" leadingIcon="search" type="search" className="flex-1 min-w-60 max-w-md"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <Checkbox label="Show deactivated" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
      </div>
      <DataTable label="Users" columns={cols} rows={rows} rowKey={(u) => u.id} loading={q.loading} error={q.error} onRetry={q.reload} />
      <ul className="mt-4 text-body-medium text-on-surface-variant list-disc pl-6">
        {ROLES.map((r) => <li key={r}><span className="text-on-surface">{ROLE_LABEL[r]}</span> — {ROLE_HINT[r]}</li>)}
      </ul>

      <AddUserDialog open={open?.kind === 'add'} onClose={close} onSaved={q.reload} />
      <PinDialog open={open?.kind === 'pin'} onClose={close} submitLabel="Save PIN"
        title={target ? `${target.hasPin ? 'Reset' : 'Set'} PIN for ${target.name}` : 'PIN'}
        description="They’ll be signed out everywhere and sign in with the new PIN."
        onSubmit={async ({ next }) => { await put(`/api/users/${target!.id}/pin`, { pin: next }); showSnackbar(`PIN saved for ${target!.name}`); q.reload(); }} />
      <ConfirmDialog open={open?.kind === 'deactivate'} onClose={close} danger confirmLabel="Deactivate"
        title={`Deactivate ${target?.name ?? ''}?`}
        onConfirm={async () => { await del(`/api/users/${target!.id}`, {}); showSnackbar(`${target!.name} deactivated`); q.reload(); }}>
        They’re signed out and can’t sign in until reactivated. Their name stays on past orders.
        The last active admin can’t be deactivated.
      </ConfirmDialog>
      <ConfirmDialog open={open?.kind === 'reactivate'} onClose={close} confirmLabel="Reactivate"
        title={`Reactivate ${target?.name ?? ''}?`}
        onConfirm={async () => { await put(`/api/users/${target!.id}`, { active: true }); showSnackbar(`${target!.name} reactivated`); q.reload(); }}>
        They can sign in again with their existing PIN{target && !target.hasPin ? ' (set one first — they have none)' : ''}.
      </ConfirmDialog>
    </SettingsFrame>
  );
}
