import { useEffect, useState } from 'react';
import { PRICE_MODES, PRICE_MODE_LABELS, type PriceMode } from '../../../../shared/domain';
import { Badge, Button, Card, Checkbox, Select, TextField, showSnackbar } from '../../../components/m3';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { del, post, put } from '../../../lib/api';
import { errorText } from '../../../lib/errorText';
import { formatCents, parseDollarsToCents } from '../../../lib/format';
import type { Material } from '../../../lib/types';
import { rateLabel } from '../logic';
import MaterialColors from './MaterialColors';

interface Draft { priceMode: string; rate: string; minQty: string; colorMultiplier: boolean; usesRoll: boolean; isAddon: boolean }
const draftOf = (m: Material): Draft => ({
  priceMode: m.priceMode, rate: (m.rateCents / 100).toFixed(2), minQty: String(m.minQty),
  colorMultiplier: m.colorMultiplier, usesRoll: m.usesRoll, isAddon: m.isAddon,
});

export default function MaterialCard({ material: m, showArchived, onChanged }: { material: Material; showArchived: boolean; onChanged: () => void }) {
  const [d, setD] = useState<Draft>(() => draftOf(m));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'archive' | 'restore'>(null);
  const saved = JSON.stringify(draftOf(m));
  useEffect(() => setD(draftOf(m)), [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const rateCents = parseDollarsToCents(d.rate);
  const minQty = Number(d.minQty);
  const priced = d.priceMode !== 'custom';
  const rateErr = priced && rateCents === null ? 'Enter dollars, e.g. 1.25' : null;
  const qtyErr = priced && (!Number.isInteger(minQty) || minQty < 1) ? 'Whole number, 1 or more' : null;
  const dirty = JSON.stringify(d) !== saved;

  const act = async (fn: () => Promise<unknown>, ok: string, fail: string) => {
    setBusy(true);
    try { await fn(); showSnackbar(ok); onChanged(); } catch (e) { showSnackbar(errorText(e, fail)); } finally { setBusy(false); }
  };
  const save = () => act(() => put(`/api/materials/${m.id}`, {
    priceMode: d.priceMode, rateCents: rateCents ?? 0, minQty: priced ? minQty : m.minQty,
    colorMultiplier: d.colorMultiplier, usesRoll: d.usesRoll, isAddon: d.isAddon,
  }), `${m.name} saved`, 'Save failed');

  const archived = !!m.archivedAt;
  return (
    <Card className={archived || !m.active ? 'bg-surface-container-low' : undefined}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="text-title-medium">{m.name}</h3>
        <span className="text-body-medium text-on-surface-variant">({m.unit})</span>
        {m.usesRoll && <Badge tone="neutral" className="!h-5 px-2">Roll</Badge>}
        {m.isAddon && <Badge tone="neutral" className="!h-5 px-2">Add-on</Badge>}
        {!m.active && <Badge tone="neutral" className="!h-5 px-2">Inactive</Badge>}
        {archived && <Badge tone="neutral" className="!h-5 px-2">Archived</Badge>}
        {m.priceMode !== 'custom' && m.rateCents > 0 && (
          <span className="text-body-medium text-on-surface-variant">{formatCents(m.rateCents)} {rateLabel(m.priceMode).replace('$ ', '')}</span>)}
        <span className="flex-1" />
        <Button variant="text" disabled={busy} onClick={() => act(() => put(`/api/materials/${m.id}`, { active: !m.active }),
          `${m.name} ${m.active ? 'deactivated' : 'reactivated'}`, 'Update failed')}>{m.active ? 'Deactivate' : 'Reactivate'}</Button>
        {archived
          ? <Button variant="text" disabled={busy} onClick={() => setConfirm('restore')}>Restore</Button>
          : <Button variant="text" className="!text-error" disabled={busy} onClick={() => setConfirm('archive')}>Archive</Button>}
      </div>
      <form className="flex flex-wrap items-start gap-3" onSubmit={(e) => { e.preventDefault(); if (!rateErr && !qtyErr) save(); }} noValidate>
        <Select label="Price rule" variant="outlined" className="w-56" value={d.priceMode}
          onChange={(e) => setD({ ...d, priceMode: e.target.value as PriceMode })}>
          {PRICE_MODES.map((p) => <option key={p} value={p}>{PRICE_MODE_LABELS[p]}</option>)}
        </Select>
        {priced && <>
          <TextField label={rateLabel(d.priceMode)} variant="outlined" inputMode="decimal" className="w-36"
            value={d.rate} onChange={(e) => setD({ ...d, rate: e.target.value })} error={rateErr} />
          <TextField label="Min qty" variant="outlined" inputMode="numeric" className="w-28"
            value={d.minQty} onChange={(e) => setD({ ...d, minQty: e.target.value })} error={qtyErr} />
          <Checkbox label="×2 / ×3 color" checked={d.colorMultiplier} onChange={(e) => setD({ ...d, colorMultiplier: e.target.checked })} className="mt-1 ml-1" />
        </>}
        <Checkbox label="Vinyl roll" checked={d.usesRoll} onChange={(e) => setD({ ...d, usesRoll: e.target.checked })} className="mt-1 ml-1" />
        <Checkbox label="Add-on" checked={d.isAddon} onChange={(e) => setD({ ...d, isAddon: e.target.checked })} className="mt-1 ml-1" />
        <span className="flex-1" />
        <Button type="submit" className="mt-2" disabled={busy || !dirty || !!rateErr || !!qtyErr}>{busy ? 'Saving…' : 'Save'}</Button>
      </form>
      {m.usesRoll && <MaterialColors material={m} includeArchived={showArchived} />}

      <ConfirmDialog open={confirm === 'archive'} onClose={() => setConfirm(null)} danger confirmLabel="Archive"
        title={`Archive “${m.name}”?`}
        onConfirm={async () => { await del(`/api/materials/${m.id}`); showSnackbar(`${m.name} archived`); onChanged(); }}>
        It’s hidden from the price book and new quotes; old jobs still show it. You can restore it later.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'restore'} onClose={() => setConfirm(null)} confirmLabel="Restore"
        title={`Restore “${m.name}”?`}
        onConfirm={async () => { await post(`/api/materials/${m.id}/unarchive`, {}); showSnackbar(`${m.name} restored`); onChanged(); }}>
        It shows up in the price book and item picker again.
      </ConfirmDialog>
    </Card>
  );
}
