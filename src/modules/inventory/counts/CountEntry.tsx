// Blind count entry: system counts are hidden so the shelf, not the app,
// decides. Walk the shop one category at a time; blank = skip this week.
import { useState, type Dispatch, type SetStateAction } from 'react';
import { Button, Card, Icon, TextField } from '../../../components/m3';
import { useQuery, type Page } from '../../../lib/query';
import type { InventoryItem } from '../../../lib/types';
import { formatDate } from '../../../lib/format';
import { useCategories } from '../components/lookups';
import { useDebounced } from '../components/ItemPicker';
import CountGroup from './CountGroup';
import { enteredIds, enteredIn, type Draft } from './draft';
import type { CycleCount } from '../types';

export default function CountEntry({ cc, draft, setDraft, onReview }: {
  cc: CycleCount; draft: Draft; setDraft: Dispatch<SetStateAction<Draft>>; onReview: () => void;
}) {
  const cats = useCategories();
  const total = useQuery<Page<InventoryItem>>('/api/inventory?limit=1&offset=0').data?.total;
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 300);
  const groups = [
    ...[...cats.all].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .map((c) => ({ key: String(c.id), label: c.name + (c.archivedAt || !c.active ? ' (inactive category)' : ''), catId: c.id as number | null })),
    { key: 'none', label: 'Other / uncategorized', catId: null },
  ];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const onCount = (i: InventoryItem, value: string) => setDraft((d) => ({
    ...d, lines: { ...d.lines, [i.id]: { counted: value, name: i.name, countUnit: i.countUnit ?? null, categoryId: i.categoryId ?? null } },
  }));
  const entered = enteredIds(draft).length;
  const sentBack = cc.notes?.startsWith('Sent back');

  return (
    <div>
      <Card variant="filled" className="mb-4">
        <p className="text-title-medium">Write down what you actually see</p>
        <p className="text-body-medium text-on-surface-variant">
          Count #{cc.id}, scheduled {formatDate(cc.scheduledFor)}. The system’s numbers stay hidden until review. Leave an item blank to skip it.
          What you type is saved on this device, so a dropped connection won’t lose it.
        </p>
        {sentBack && <p className="mt-2 text-body-medium text-warning inline-flex gap-1"><Icon name="warning" size={18} />{cc.notes}</p>}
      </Card>
      <TextField className="mb-4" label="Find an item" leadingIcon="search" type="search" value={search}
        onChange={(e) => setSearch(e.target.value)} placeholder="Jump straight to an item by name" />
      {term ? (
        <Card padded={false}>
          <CountGroup label={`Items matching ${term}`} filter={{ q: term }} draft={draft} onCount={onCount} />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const isOpen = open.has(g.key);
            const n = enteredIn(draft, g.catId);
            return (
              <Card key={g.key} padded={false} as="section" aria-label={g.label}>
                <button type="button" aria-expanded={isOpen} onClick={() => toggle(g.key)}
                  className="state-layer w-full flex items-center gap-3 min-h-14 px-4 text-left rounded-shape-medium">
                  <Icon name={isOpen ? 'dropDown' : 'chevronRight'} className="text-on-surface-variant" />
                  <span className="flex-1 text-title-medium">{g.label}</span>
                  {n > 0 && <span className="text-label-large text-primary">{n} entered</span>}
                </button>
                {isOpen && (
                  <div className="border-t border-outline-variant">
                    <CountGroup label={g.label} filter={{ categoryId: g.catId == null ? 'none' : String(g.catId) }} draft={draft} onCount={onCount} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <div className="sticky bottom-0 z-10 mt-4 rounded-shape-medium bg-surface-container shadow-elevation-2">
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
          <span className="flex-1 text-body-large" aria-live="polite">{entered} of {total ?? '…'} counted</span>
          <Button variant="text" touch to="/inventory/counts">Pause</Button>
          <Button touch disabled={entered === 0} onClick={onReview}>Review variances</Button>
        </div>
      </div>
    </div>
  );
}
