import { useEffect, useState } from 'react';
import { Button, Chip, Select, TextField } from '../../../components/m3';
import { GROUPS, SORTS, moreFilterCount, type Group, type ListState } from '../logic';
import { useDebounced } from '../components/ItemPicker';

type Update = (patch: Partial<ListState>, replace?: boolean) => void;

const STOCK = [['ok', 'In stock'], ['low', 'Low or out'], ['out', 'Out']] as const;
const KIND = [['roll', 'Vinyl rolls'], ['other', 'Other stock']] as const;

/** Search, quick filter chips, sort, and the "more filters" button. All state is in the URL. */
export default function ListToolbar({ state, update, onMoreFilters, activeChips }: {
  state: ListState; update: Update; onMoreFilters: () => void;
  /** Removable chips for the dialog filters that are set. */
  activeChips: { key: keyof ListState; label: string }[];
}) {
  const [text, setText] = useState(state.q);
  const term = useDebounced(text, 300);
  // URL → field (back/forward), field → URL (debounced, replace so typing isn't history).
  useEffect(() => { setText(state.q); }, [state.q]);
  useEffect(() => { if (term !== state.q) update({ q: term }, true); }, [term]); // eslint-disable-line react-hooks/exhaustive-deps
  const more = moreFilterCount(state);

  return (
    <div className="flex flex-col gap-3 mb-4">
      <div className="flex flex-wrap gap-3 items-start">
        <TextField className="flex-1 min-w-[16rem]" label="Search items" leadingIcon="search" type="search"
          value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, color or vendor" />
        <Select className="w-44" label="Group by" value={state.group} onChange={(e) => update({ group: e.target.value as Group })}>
          {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </Select>
        <Select className="w-60" label="Sort" value={state.sort} onChange={(e) => update({ sort: e.target.value })}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        {STOCK.map(([v, label]) => (
          <Chip key={v} kind="filter" selected={state.stock === v}
            onClick={() => update({ stock: state.stock === v ? '' : v })}>{label}</Chip>
        ))}
        <span className="w-px h-6 bg-outline-variant mx-1" aria-hidden />
        {KIND.map(([v, label]) => (
          <Chip key={v} kind="filter" selected={state.kind === v}
            onClick={() => update({ kind: state.kind === v ? '' : v })}>{label}</Chip>
        ))}
        {activeChips.map((c) => (
          <Chip key={c.key} kind="filter" selected aria-label={`Remove filter: ${c.label}`}
            onClick={() => update({ [c.key]: c.key === 'match' ? 'contains' : '' })}>{c.label} ✕</Chip>
        ))}
        <Button variant="text" icon="tune" onClick={onMoreFilters}>More filters{more ? ` (${more})` : ''}</Button>
      </div>
    </div>
  );
}
