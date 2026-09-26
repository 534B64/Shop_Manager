// /settings/taxonomy (manager+) — unit types and inventory categories (with
// sizes). Organizes inventory only: never changes pricing or the stock check.
import { useState } from 'react';
import { Button, Card, CardHeader, Checkbox, EmptyState, LinearProgress, TextField, showSnackbar } from '../../../components/m3';
import { post, put } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { errorText } from '../../../lib/errorText';
import type { Category, Supplier } from '../../../lib/types';
import SettingsFrame from '../SettingsFrame';
import ChipEditor from '../ChipEditor';
import { addUnique, visibleRows } from '../logic';
import CategoryCard from './CategoryCard';

export default function Taxonomy() {
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const units = useQuery<{ units: string[] }>('/api/settings/units');
  const cats = useQuery<Category[]>('/api/categories?all=1&includeArchived=1');
  // Archived suppliers too, so a category pointing at one still shows its name.
  const sups = useQuery<Supplier[]>('/api/suppliers?all=1&includeArchived=1');
  const rows = visibleRows(cats.data ?? [], showArchived, search)
    .sort((a, b) => Number(!a.active || !!a.archivedAt) - Number(!b.active || !!b.archivedAt));

  const saveUnits = async (next: string[]) => {
    const r = await put<{ units: string[] }>('/api/settings/units', { units: next });
    units.setData(r);
  };

  return (
    <SettingsFrame title="Categories & units" min="manager"
      subtitle="Unit types and smart categories organize inventory. None of it changes pricing or the estimator’s stock check.">
      <div className="grid gap-4">
        <Card>
          <CardHeader title="Unit types" subtitle="Used on Materials and inventory item entry. Editing the list doesn’t change anything already saved." />
          {units.error ? <p role="alert" className="text-error text-body-medium">{units.error}</p> : (
            <ChipEditor label="Unit" removeVerb="Remove" disabled={!units.data}
              items={(units.data?.units ?? []).map((u) => ({ key: u, label: u }))}
              onAdd={async (u) => { const cur = units.data?.units ?? []; const next = addUnique(cur, u); if (next !== cur) await saveUnits(next); }}
              onRemove={(it) => saveUnits((units.data?.units ?? []).filter((u) => u !== it.key))} />
          )}
        </Card>

        <Card>
          <CardHeader title="Categories"
            subtitle="Categories pre-fill the unit and supplier when adding inventory, and group items on the Inventory page. “Tracks color” here is separate from a material’s color list." />
          <AddCategory onAdded={cats.reload} />
          <div className="flex flex-wrap items-center gap-3 my-4">
            <TextField label="Search categories" leadingIcon="search" type="search" className="flex-1 min-w-60 max-w-md"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            <Checkbox label="Show archived categories & sizes" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          </div>
          <div className="h-1">{(cats.loading || sups.loading) && <LinearProgress label="Loading categories" />}</div>
          {cats.error && <EmptyState tone="error" icon="warning" title="Couldn’t load categories"
            action={<Button variant="outlined" onClick={cats.reload}>Try again</Button>}>{cats.error}</EmptyState>}
          {cats.data && rows.length === 0 && <EmptyState title={search ? 'No categories match' : 'No categories yet'} />}
          <div className="grid gap-3">
            {rows.map((c) => (
              <CategoryCard key={c.id} category={c} units={units.data?.units ?? []} suppliers={sups.data ?? []}
                showArchived={showArchived} onChanged={cats.reload} />
            ))}
          </div>
        </Card>
      </div>
    </SettingsFrame>
  );
}

function AddCategory({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    if (!name.trim()) { setError('Category name required.'); return; }
    setBusy(true); setError(null);
    try { await post('/api/categories', { name: name.trim() }); showSnackbar(`Added ${name.trim()}`); setName(''); onAdded(); }
    catch (e) { setError(errorText(e, 'Add category failed')); }
    finally { setBusy(false); }
  }
  return (
    <form className="flex flex-wrap items-start gap-3" onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
      <TextField label="New category" variant="outlined" className="flex-1 min-w-60 max-w-md" placeholder="Apparel blanks"
        value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={120} />
      <Button type="submit" icon="add" className="mt-2" disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
    </form>
  );
}
