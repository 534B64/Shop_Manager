import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, Select, TextField, showSnackbar } from '../../../components/m3';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { del, post, put } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { errorText } from '../../../lib/errorText';
import { hasRole } from '../../../lib/session';
import type { Category, CategorySize, Supplier } from '../../../lib/types';
import ChipEditor from '../ChipEditor';

interface Draft { name: string; defaultUnit: string; tracksColor: boolean; defaultSupplierId: string }
const draftOf = (c: Category): Draft => ({ name: c.name, defaultUnit: c.defaultUnit ?? '', tracksColor: c.tracksColor,
  defaultSupplierId: c.defaultSupplierId != null ? String(c.defaultSupplierId) : '' });

export default function CategoryCard({ category: c, units, suppliers, showArchived, onChanged }: {
  category: Category; units: string[]; suppliers: Supplier[]; showArchived: boolean; onChanged: () => void;
}) {
  const saved = JSON.stringify(draftOf(c));
  const [d, setD] = useState<Draft>(() => draftOf(c));
  useEffect(() => setD(draftOf(c)), [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'archive' | 'restore'>(null);
  const sizes = useQuery<CategorySize[]>(`/api/categories/${c.id}/sizes${showArchived ? '?includeArchived=1' : ''}`);
  const nameErr = !d.name.trim() ? 'Name is required.' : null;

  const act = async (fn: () => Promise<unknown>, ok: string, fail: string) => {
    setBusy(true);
    try { await fn(); showSnackbar(ok); onChanged(); } catch (e) { showSnackbar(errorText(e, fail)); } finally { setBusy(false); }
  };
  const save = () => act(() => put(`/api/categories/${c.id}`, {
    // defaultVendor (free text) is retired — defaultSupplierId is the source of truth.
    name: d.name.trim(), defaultUnit: d.defaultUnit || null, tracksColor: d.tracksColor,
    defaultSupplierId: d.defaultSupplierId ? Number(d.defaultSupplierId) : null,
  }), `${d.name.trim()} saved`, 'Save failed');
  const sizeAfter = async (p: Promise<unknown>) => { await p; sizes.reload(); };
  const supplierOptions = suppliers.filter((s) => (s.active && !s.archivedAt) || s.id === c.defaultSupplierId);
  const unitOptions = d.defaultUnit && !units.includes(d.defaultUnit) ? [d.defaultUnit, ...units] : units;
  const archived = !!c.archivedAt;

  return (
    <Card className={archived || !c.active ? 'bg-surface-container-low' : undefined}>
      <form className="flex flex-wrap items-start gap-3" onSubmit={(e) => { e.preventDefault(); if (!nameErr) save(); }} noValidate>
        <TextField label="Name" variant="outlined" className="flex-1 min-w-52" value={d.name} error={nameErr}
          onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={120} />
        <Select label="Default unit" variant="outlined" className="w-40" value={d.defaultUnit} onChange={(e) => setD({ ...d, defaultUnit: e.target.value })}>
          <option value="">—</option>
          {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
        <Select label="Default supplier" variant="outlined" className="w-52" value={d.defaultSupplierId}
          onChange={(e) => setD({ ...d, defaultSupplierId: e.target.value })}>
          <option value="">—</option>
          {supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.archivedAt ? ' (archived)' : ''}</option>)}
        </Select>
        <Checkbox label="Tracks color" checked={d.tracksColor} onChange={(e) => setD({ ...d, tracksColor: e.target.checked })} className="mt-1 ml-1" />
        <Button type="submit" className="mt-2" disabled={busy || !!nameErr || JSON.stringify(d) === saved}>{busy ? 'Saving…' : 'Save'}</Button>
      </form>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {!c.active && <Badge tone="neutral" className="!h-5 px-2">Inactive</Badge>}
        {archived && <Badge tone="neutral" className="!h-5 px-2">Archived</Badge>}
        <span className="flex-1" />
        <Button variant="text" disabled={busy} onClick={() => act(() => put(`/api/categories/${c.id}`, { active: !c.active }),
          `${c.name} ${c.active ? 'deactivated' : 'reactivated'}`, 'Update failed')}>{c.active ? 'Deactivate' : 'Reactivate'}</Button>
        {hasRole('admin') && (archived
          ? <Button variant="text" disabled={busy} onClick={() => setConfirm('restore')}>Restore</Button>
          : <Button variant="text" className="!text-error" disabled={busy} onClick={() => setConfirm('archive')}>Archive</Button>)}
      </div>
      <div className="mt-2 pt-3 border-t border-outline-variant">
        <h4 className="text-title-small mb-2">Sizes {sizes.error && <span className="text-error text-body-small">— {sizes.error}</span>}</h4>
        <ChipEditor label="Size" disabled={!sizes.data}
          items={(sizes.data ?? []).map((s) => ({ key: s.id, label: s.label, archived: !!s.archivedAt }))}
          onAdd={(label) => sizeAfter(post(`/api/categories/${c.id}/sizes`, { label }))}
          onRemove={(s) => sizeAfter(del(`/api/categories/${c.id}/sizes/${s.key}`))}
          onRestore={(s) => sizeAfter(post(`/api/categories/${c.id}/sizes/${s.key}/unarchive`, {}))} />
      </div>

      <ConfirmDialog open={confirm === 'archive'} onClose={() => setConfirm(null)} danger confirmLabel="Archive"
        title={`Archive “${c.name}”?`}
        onConfirm={async () => { await del(`/api/categories/${c.id}`, {}); showSnackbar(`${c.name} archived`); onChanged(); }}>
        It’s hidden from lists and pickers; items keep it and still show its name. You can restore it later.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'restore'} onClose={() => setConfirm(null)} confirmLabel="Restore"
        title={`Restore “${c.name}”?`}
        onConfirm={async () => { await post(`/api/categories/${c.id}/unarchive`, {}); showSnackbar(`${c.name} restored`); onChanged(); }}>
        It shows up in lists and pickers again, with its sizes.
      </ConfirmDialog>
    </Card>
  );
}
