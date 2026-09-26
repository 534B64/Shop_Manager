import { useState } from 'react';
import { Badge, Button, Card, CardHeader, showSnackbar } from '../../components/m3';
import ConfirmDialog from '../../components/ConfirmDialog';
import { del, post } from '../../lib/api';
import { hasRole } from '../../lib/session';
import { formatDate } from '../../lib/format';
import type { CustomerDetail } from './logic';
import CustomerFormDialog from './CustomerFormDialog';
import LevelDialog from './LevelDialog';

type Open = null | 'edit' | 'level' | 'archive' | 'restore';

export default function ProfileCard({ customer: c, onChanged }: { customer: CustomerDetail; onChanged: () => void }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const row = (label: string, value: string | null | undefined) => (
    <div className="grid grid-cols-[6rem_1fr] gap-2 py-1">
      <dt className="text-body-medium text-on-surface-variant">{label}</dt>
      <dd className="text-body-large break-words">{value || '—'}</dd>
    </div>
  );

  return (
    <Card>
      <CardHeader title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-headline-small">{c.name}</span>
          {c.archivedAt && <Badge tone="neutral" className="!h-6 px-2">Archived</Badge>}
          <Badge tone={c.level > 0 ? 'primary' : 'neutral'} className="!h-6 px-2">Level {c.level ?? 0}</Badge>
        </span>}
        subtitle={c.archivedAt ? `Archived ${formatDate(c.archivedAt)} — hidden from lists and pickers; history stays.` : undefined}
        action={<Button variant="text" icon="tune" onClick={() => setOpen('edit')}>Edit</Button>} />
      <dl>
        {row('Email', c.email)}
        {row('Phone', c.phone)}
        {row('Notes', c.notes)}
      </dl>
      <div className="flex flex-wrap gap-2 mt-4">
        {hasRole('manager') && <Button variant="tonal" onClick={() => setOpen('level')}>Change level</Button>}
        {c.archivedAt
          ? <Button variant="outlined" onClick={() => setOpen('restore')}>Restore customer</Button>
          : <Button variant="outlined" className="!text-error" onClick={() => setOpen('archive')}>Archive customer</Button>}
      </div>

      <CustomerFormDialog open={open === 'edit'} onClose={close} customer={c}
        onSaved={() => { showSnackbar('Customer saved'); onChanged(); }} />
      <LevelDialog open={open === 'level'} onClose={close} customer={c} onSaved={onChanged} />
      <ConfirmDialog open={open === 'archive'} onClose={close} danger confirmLabel="Archive"
        title={`Archive “${c.name}”?`}
        onConfirm={async () => { await del(`/api/customers/${c.id}`, {}); showSnackbar('Customer archived'); onChanged(); }}>
        They’re hidden from lists and pickers; their orders, payments and credit history stay. You can restore them later.
        A cashier needs a manager’s approval.
      </ConfirmDialog>
      <ConfirmDialog open={open === 'restore'} onClose={close} confirmLabel="Restore"
        title={`Restore “${c.name}”?`}
        onConfirm={async () => { await post(`/api/customers/${c.id}/unarchive`, {}); showSnackbar('Customer restored'); onChanged(); }}>
        They show up in lists and pickers again.
      </ConfirmDialog>
    </Card>
  );
}
