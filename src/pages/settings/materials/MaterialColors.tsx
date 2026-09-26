import { del, post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import type { Material, MaterialColor } from '../../../lib/types';
import ChipEditor from '../ChipEditor';

/** A roll material's color list (a variant — never changes price). */
export default function MaterialColors({ material: m, includeArchived }: { material: Material; includeArchived?: boolean }) {
  const q = useQuery<MaterialColor[]>(`/api/materials/${m.id}/colors${includeArchived ? '?includeArchived=1' : ''}`);
  const items = (q.data ?? []).map((c) => ({ key: c.id, label: c.name, archived: !!c.archivedAt }));
  const after = async (p: Promise<unknown>) => { await p; q.reload(); };
  return (
    <div className="mt-3 pt-3 border-t border-outline-variant">
      <h4 className="text-title-small mb-2">Colors {q.error && <span className="text-error text-body-small">— {q.error}</span>}</h4>
      <ChipEditor label="Color" items={items} disabled={q.loading && !q.data}
        onAdd={(name) => after(post(`/api/materials/${m.id}/colors`, { name }))}
        onRemove={(c) => after(del(`/api/materials/${m.id}/colors/${c.key}`))}
        onRestore={(c) => after(post(`/api/materials/${m.id}/colors/${c.key}/unarchive`, {}))} />
    </div>
  );
}
