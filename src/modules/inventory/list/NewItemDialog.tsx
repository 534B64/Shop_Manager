import { useState } from 'react';
import { Button, Dialog, Select, TextField } from '../../../components/m3';
import { post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import type { Category, CategorySize, InventoryItem, Supplier } from '../../../lib/types';
import { parseWhole } from '../logic';
import { itemDisplayName } from '../../../../shared/itemName';
import { errorText } from '../../../lib/errorText';

const BLANK = { name: '', categoryId: '', unit: '', color: '', size: '', sizeCustom: '', count: '', min: '', supplierId: '', orderNote: '' };

/** Create a stock item. A starting count is booked as its opening balance (a transaction), not typed onto the item. */
export default function NewItemDialog({ open, onClose, onCreated, categories, suppliers, units }: {
  open: boolean; onClose: () => void; onCreated: (item: InventoryItem) => void;
  categories: Category[]; suppliers: Supplier[]; units: string[];
}) {
  const [f, setF] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cat = categories.find((c) => c.id === Number(f.categoryId));
  const sizes = useQuery<CategorySize[]>(f.categoryId ? `/api/categories/${f.categoryId}/sizes` : null).data ?? [];
  const set = (patch: Partial<typeof BLANK>) => setF((x) => ({ ...x, ...patch }));
  const sizeText = (f.size === '__custom__' || sizes.length === 0 ? f.sizeCustom : f.size).trim();
  const autoName = itemDisplayName({ color: f.color, categoryName: cat?.name, sizeText, countUnit: f.unit });

  // A category pre-fills its unit and (if none picked yet) its supplier.
  const pickCategory = (id: string) => {
    const c = categories.find((x) => x.id === Number(id));
    set({ categoryId: id, color: '', size: '', sizeCustom: '',
      ...(c?.defaultUnit ? { unit: c.defaultUnit } : {}),
      ...(c?.defaultSupplierId && !f.supplierId ? { supplierId: String(c.defaultSupplierId) } : {}) });
  };

  const close = () => { if (!saving) { setF(BLANK); setError(null); onClose(); } };
  async function save() {
    const name = f.name.trim();
    if (!name && !autoName) return setError('Pick a category, color or size — or type a custom name.');
    const count = f.count.trim() ? parseWhole(f.count) : 0;
    const min = f.min.trim() ? parseWhole(f.min) : 0;
    if (count == null || min == null) return setError('On hand and Min must be whole numbers (0 or more).');
    setSaving(true); setError(null);
    try {
      const item = await post<InventoryItem>('/api/inventory', {
        ...(name ? { name } : {}), count, lowStockThreshold: min,
        ...(f.supplierId ? { supplierId: Number(f.supplierId) } : {}),
        ...(f.categoryId ? { categoryId: Number(f.categoryId) } : {}),
        ...(f.unit ? { countUnit: f.unit, purchaseUnit: f.unit } : {}),
        ...(sizeText ? { sizeText } : {}),
        ...(f.color.trim() ? { color: f.color.trim() } : {}),
        ...(f.orderNote.trim() ? { orderNote: f.orderNote.trim() } : {}),
      });
      setF(BLANK);
      onCreated(item);
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onClose={close} title="New item" dismissOnScrim={false} className="max-w-lg"
      description="After this, stock changes go through receiving, adjustments and cycle counts."
      actions={<>
        <Button variant="text" onClick={close} disabled={saving}>Cancel</Button>
        <Button variant="text" onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add item'}</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Category" value={f.categoryId} onChange={(e) => pickCategory(e.target.value)} data-autofocus>
          <option value="">None</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select label="Unit (counted as)" value={f.unit} onChange={(e) => set({ unit: e.target.value })}>
          <option value="">—</option>
          {units.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
        {cat?.tracksColor && <TextField label="Color" value={f.color} onChange={(e) => set({ color: e.target.value })} placeholder="Red" />}
        {sizes.length > 0 ? (
          <Select label="Size" value={f.size} onChange={(e) => set({ size: e.target.value })}>
            <option value="">—</option>
            {sizes.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
            <option value="__custom__">Other size…</option>
          </Select>
        ) : <TextField label="Size" value={f.sizeCustom} onChange={(e) => set({ sizeCustom: e.target.value })} placeholder="24in" />}
        {sizes.length > 0 && f.size === '__custom__' && (
          <TextField label="Other size" value={f.sizeCustom} onChange={(e) => set({ sizeCustom: e.target.value })} />
        )}
        <TextField label="On hand now" inputMode="numeric" value={f.count} onChange={(e) => set({ count: e.target.value })}
          supportingText="Booked as the opening balance" />
        <TextField label="Min (low-stock at)" inputMode="numeric" value={f.min} onChange={(e) => set({ min: e.target.value })} />
        <Select label="Supplier" value={f.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
          <option value="">—</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <TextField className="sm:col-span-2" label="Custom name (optional)" value={f.name} maxLength={120}
          onChange={(e) => set({ name: e.target.value })}
          supportingText={autoName ? `Leave blank to use: ${autoName}` : 'Leave blank to build the name from category, color and size'} />
        <TextField className="sm:col-span-2" label="Order note (optional)" value={f.orderNote}
          onChange={(e) => set({ orderNote: e.target.value })} />
      </div>
      {error && <p role="alert" className="mt-3 text-body-medium text-error">{error}</p>}
    </Dialog>
  );
}
