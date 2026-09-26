import { useEffect, useState } from 'react';
import { Button, Dialog, Select, TextField } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import type { Category, Material, MaterialColor, Supplier } from '../../../lib/types';
import { ROLL_SIZES } from '../../../../shared/domain';
import type { ListState, Match } from '../logic';

type Fields = Pick<ListState, 'match' | 'categoryId' | 'supplierId' | 'materialId' | 'color' | 'widthIn'>;
const pickFields = (s: ListState): Fields =>
  ({ match: s.match, categoryId: s.categoryId, supplierId: s.supplierId, materialId: s.materialId, color: s.color, widthIn: s.widthIn });
const CLEARED: Fields = { match: 'contains', categoryId: '', supplierId: '', materialId: '', color: '', widthIn: '' };

/** Less-used filters: search mode, category, supplier, roll material / color / width. */
export default function MoreFiltersDialog({ open, onClose, state, onApply, categories, suppliers }: {
  open: boolean; onClose: () => void; state: ListState; onApply: (f: Fields) => void;
  categories: Category[]; suppliers: Supplier[];
}) {
  const [f, setF] = useState<Fields>(pickFields(state));
  useEffect(() => { if (open) setF(pickFields(state)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const mats = (useQuery<Material[]>(open ? '/api/materials' : null).data ?? []).filter((m) => m.usesRoll);
  const colors = useQuery<MaterialColor[]>(open && f.materialId ? `/api/materials/${f.materialId}/colors` : null).data;
  const set = (patch: Partial<Fields>) => setF((x) => ({ ...x, ...patch }));

  return (
    <Dialog open={open} onClose={onClose} title="More filters" dismissOnScrim={false}
      actions={<>
        <Button variant="text" onClick={() => { onApply(CLEARED); onClose(); }}>Clear all</Button>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="text" onClick={() => { onApply(f); onClose(); }}>Apply</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <Select label="Search matches" value={f.match} onChange={(e) => set({ match: e.target.value as Match })}
          supportingText="How the search text is compared to name, color and vendor">
          <option value="contains">Contains</option>
          <option value="starts">Starts with</option>
          <option value="ends">Ends with</option>
          <option value="exact">Exactly</option>
        </Select>
        <Select label="Category" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
          <option value="">Any category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">No category</option>
        </Select>
        <Select label="Supplier" value={f.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
          <option value="">Any supplier</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        {mats.length > 0 && (
          <Select label="Roll material" value={f.materialId} onChange={(e) => set({ materialId: e.target.value, color: '' })}>
            <option value="">Any material</option>
            {mats.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        )}
        {f.materialId && colors ? (
          <Select label="Color" value={f.color} onChange={(e) => set({ color: e.target.value })}>
            <option value="">Any color</option>
            {colors.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
        ) : (
          <TextField label="Color" value={f.color} onChange={(e) => set({ color: e.target.value })}
            supportingText="Exact color name, e.g. Red" />
        )}
        <Select label="Roll width" value={f.widthIn} onChange={(e) => set({ widthIn: e.target.value })}>
          <option value="">Any width</option>
          {ROLL_SIZES.map((w) => <option key={w} value={w}>{w}″</option>)}
        </Select>
      </div>
    </Dialog>
  );
}
