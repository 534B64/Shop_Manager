import { useEffect, useState } from 'react';
import { Button, Card, CardHeader, Select, Switch, TextField, showSnackbar } from '../../../components/m3';
import { put } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import type { Category, InventoryItem, Material, Supplier } from '../../../lib/types';
import { itemDisplayName } from '../../../../shared/itemName';
import { suggestedMin } from '../../../../shared/reorder';
import { factorOf, parseWhole } from '../logic';
import { errorText } from '../../../lib/errorText';

const fromItem = (i: InventoryItem) => ({
  name: i.nameIsCustom === false ? '' : i.name, categoryId: i.categoryId != null ? String(i.categoryId) : '', sizeText: i.sizeText ?? '', color: i.color ?? '',
  supplierId: i.supplierId != null ? String(i.supplierId) : '', purchaseUnit: i.purchaseUnit ?? '', countUnit: i.countUnit ?? '',
  factor: String(factorOf(i)), min: String(i.lowStockThreshold), max: i.reorderMaxQty != null ? String(i.reorderMaxQty) : '',
  orderNote: i.orderNote ?? '', active: i.active,
});
type Form = ReturnType<typeof fromItem>;

/** Keep the current value selectable even if it was archived / removed from the list. */
const withCurrent = <T extends { id: number }>(live: T[], all: T[], id: string) =>
  (id && !live.some((x) => String(x.id) === id) ? [...live, ...all.filter((x) => String(x.id) === id)] : live);

/** The item's editable fields. On-hand is deliberately not here — it only moves through transactions. */
export default function ItemFieldsCard({ item, onSaved, categories, suppliers, units, bufferDays }: {
  item: InventoryItem; onSaved: (i: InventoryItem) => void;
  categories: { live: Category[]; all: Category[] }; suppliers: { live: Supplier[]; all: Supplier[] };
  units: string[]; bufferDays: number;
}) {
  const [f, setF] = useState<Form>(fromItem(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setF(fromItem(item)); }, [item]);
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(f) !== JSON.stringify(fromItem(item));

  const sup = suppliers.all.find((s) => String(s.id) === f.supplierId) ?? null;
  const autoMin = sup ? suggestedMin(item.avgDailyUse, sup.leadTimeDays, bufferDays) : null;
  const materials = useQuery<Material[]>(item.materialId != null ? '/api/materials?all=1&includeArchived=1' : null).data;
  const autoName = itemDisplayName({
    color: f.color, sizeText: f.sizeText, nominalWidthIn: item.nominalWidthIn, countUnit: f.countUnit,
    categoryName: categories.all.find((c) => String(c.id) === f.categoryId)?.name,
    materialName: materials?.find((m) => m.id === item.materialId)?.name,
  });
  const unitOpts =[...new Set([...units, f.purchaseUnit, f.countUnit].filter(Boolean))];

  async function save() {
    const factor = Number(f.factor);
    const min = parseWhole(f.min);
    const max = f.max.trim() ? parseWhole(f.max) : null;
    if (!f.name.trim() && !autoName) return setError('Give the item a category, color or size — or type a custom name.');
    if (!(factor > 0)) return setError('The factor must be more than 0 (count units in one purchase unit).');
    if (min == null || (f.max.trim() && max == null)) return setError('Min and Max must be whole numbers (0 or more).');
    setSaving(true); setError(null);
    try {
      const saved = await put<InventoryItem>(`/api/inventory/${item.id}`, {
        name: f.name.trim(), categoryId: f.categoryId ? Number(f.categoryId) : null,
        sizeText: f.sizeText.trim() || null, color: f.color.trim() || null,
        supplierId: f.supplierId ? Number(f.supplierId) : null,
        purchaseUnit: f.purchaseUnit || null, countUnit: f.countUnit || null, purchaseToCountFactor: factor,
        lowStockThreshold: min, reorderMaxQty: max, orderNote: f.orderNote.trim() || null, active: f.active,
      });
      onSaved(saved);
      showSnackbar('Item saved');
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader title="Details" subtitle="On hand isn’t edited here — stock changes go through receiving, adjustments, transfers and cycle counts, so every change has a record." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Category" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
          <option value="">None</option>
          {withCurrent(categories.live, categories.all, f.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}{c.archivedAt ? ' (archived)' : ''}</option>)}
        </Select>
        <Select label="Supplier" value={f.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
          <option value="">None</option>
          {withCurrent(suppliers.live, suppliers.all, f.supplierId).map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.leadTimeDays}d lead){s.archivedAt || !s.active ? ' (inactive)' : ''}</option>
          ))}
        </Select>
        <TextField label="Size" value={f.sizeText} onChange={(e) => set({ sizeText: e.target.value })} />
        <TextField label="Color" value={f.color} onChange={(e) => set({ color: e.target.value })}
          supportingText={item.materialId != null ? 'Must be on the material’s color list' : undefined} />
        <TextField className="sm:col-span-2" label="Custom name (optional)" value={f.name} maxLength={120}
          onChange={(e) => set({ name: e.target.value })}
          supportingText={autoName ? `Leave blank to use: ${autoName}` : 'Leave blank to build the name from category, color and size'} />
        <Select label="Bought as" value={f.purchaseUnit} onChange={(e) => set({ purchaseUnit: e.target.value })}>
          <option value="">—</option>
          {unitOpts.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
        <Select label="Counted as" value={f.countUnit} onChange={(e) => set({ countUnit: e.target.value })}>
          <option value="">—</option>
          {unitOpts.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
        <TextField label="Factor" inputMode="decimal" value={f.factor} onChange={(e) => set({ factor: e.target.value })}
          supportingText={`1 ${f.purchaseUnit || 'purchase unit'} = ${f.factor || '?'} ${f.countUnit || 'count units'}`} />
        <div />
        <TextField label="Min (reorder at)" inputMode="numeric" value={f.min} onChange={(e) => set({ min: e.target.value })}
          supportingText={autoMin != null
            ? `Suggested ${autoMin}: ~${item.avgDailyUse?.toFixed(1)}/day × (${sup!.leadTimeDays}d lead + ${bufferDays}d buffer)`
            : 'A suggestion needs a usage rate (two cycle counts) and a supplier'}
          trailing={<Button variant="text" disabled={autoMin == null} onClick={() => set({ min: String(autoMin) })}
            aria-label={autoMin != null ? `Use suggested Min ${autoMin}` : 'No suggested Min yet'}>AUTO</Button>} />
        <TextField label="Max (order up to)" inputMode="numeric" value={f.max} placeholder="None"
          onChange={(e) => set({ max: e.target.value })} />
        <TextField className="sm:col-span-2" label="Order note" value={f.orderNote} onChange={(e) => set({ orderNote: e.target.value })} />
        <Switch className="sm:col-span-2" checked={f.active} onChange={(v) => set({ active: v })}
          label={f.active ? 'Active — shows in lists and counts' : 'Inactive — hidden from lists and counts (history kept)'} />
      </div>
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="text" disabled={!dirty || saving} onClick={() => { setF(fromItem(item)); setError(null); }}>Discard</Button>
        <Button disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Card>
  );
}
