import { EmptyState, LinearProgress, Pager } from '../../../components/m3';
import { usePaged } from '../../../lib/query';
import type { InventoryItem } from '../../../lib/types';
import { parseWhole } from '../logic';
import type { Draft } from './draft';

/** One shelf section of the blind count: item names + big number boxes, no system counts. */
export default function CountGroup({ label, filter, draft, onCount }: {
  label: string; filter: { categoryId?: string; q?: string }; draft: Draft;
  onCount: (item: InventoryItem, value: string) => void;
}) {
  const items = usePaged<InventoryItem>('/api/inventory', { ...filter, sort: 'name' }, { pageSize: 50 });
  return (
    <div>
      <div className="h-1">{items.loading && <LinearProgress label={`Loading ${label}`} />}</div>
      {items.error && (
        <EmptyState tone="error" icon="warning" title="Couldn’t load these items"
          action={<button type="button" className="text-primary text-label-large underline" onClick={items.reload}>Try again</button>}>{items.error}</EmptyState>
      )}
      {!items.loading && !items.error && items.rows.length === 0 && <p className="px-4 py-3 text-body-medium text-on-surface-variant">No items here.</p>}
      <ul aria-label={label} className="divide-y divide-outline-variant">
        {items.rows.map((i) => {
          const v = draft.lines[i.id]?.counted ?? '';
          const bad = v.trim() !== '' && parseWhole(v) == null;
          const id = `count-${i.id}`;
          return (
            <li key={i.id} className="flex items-center gap-4 px-4 py-2 min-h-[4.5rem]">
              <label htmlFor={id} className="flex-1 min-w-0">
                <span className="block text-title-medium text-on-surface">{i.name}</span>
                <span className="block text-body-medium text-on-surface-variant">
                  {bad ? <span className="text-error">Whole number, or leave blank</span> : i.countUnit ? `Count in ${i.countUnit}` : 'Count each'}
                </span>
              </label>
              <input id={id} inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={v} placeholder="—"
                aria-label={`Count of ${i.name}${i.countUnit ? ` (${i.countUnit})` : ''}`} aria-invalid={bad || undefined} onChange={(e) => onCount(i, e.target.value)}
                className={`h-14 w-28 shrink-0 px-3 text-center text-headline-small tabular-nums rounded-t-shape-extra-small bg-surface-container-highest text-on-surface border-b-2 focus:border-primary ${bad ? 'border-error' : 'border-on-surface-variant'}`} />
            </li>
          );
        })}
      </ul>
      {items.total > items.pageSize && <Pager paging={items} />}
    </div>
  );
}
