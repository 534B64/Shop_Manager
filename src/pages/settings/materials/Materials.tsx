// /settings/materials (admin) — the price book: each material's price rule,
// roll/add-on flags and color list; deactivate, archive, restore.
import { useState } from 'react';
import { MATERIAL_UNITS } from '../../../../shared/domain';
import { Button, Card, Checkbox, EmptyState, LinearProgress, Select, TextField, showSnackbar } from '../../../components/m3';
import { post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { errorText } from '../../../lib/errorText';
import type { Material } from '../../../lib/types';
import SettingsFrame from '../SettingsFrame';
import { visibleRows } from '../logic';
import MaterialCard from './MaterialCard';

export default function Materials() {
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const q = useQuery<Material[]>(`/api/materials?all=1${showArchived ? '&includeArchived=1' : ''}`);
  const units = useQuery<{ units: string[] }>('/api/settings/units');
  const unitList = units.data?.units.length ? units.data.units : [...MATERIAL_UNITS];
  const rows = visibleRows(q.data ?? [], showArchived, search);

  return (
    <SettingsFrame title="Materials & price book" min="admin"
      subtitle="Each material carries its price rule. “2 color” doubles and “3 color” triples when enabled. Changes affect new quotes only.">
      <AddMaterial units={unitList} onAdded={q.reload} />
      <div className="flex flex-wrap items-center gap-3 my-4">
        <TextField label="Search materials" leadingIcon="search" type="search" className="flex-1 min-w-60 max-w-md"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <Checkbox label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
      </div>
      <div className="h-1">{q.loading && <LinearProgress label="Loading materials" />}</div>
      {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load materials"
        action={<Button variant="outlined" onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>}
      {q.data && rows.length === 0 && <EmptyState title={search ? 'No materials match' : 'No materials yet'} />}
      <div className="grid gap-3">
        {rows.map((m) => <MaterialCard key={m.id} material={m} showArchived={showArchived} onChanged={q.reload} />)}
      </div>
    </SettingsFrame>
  );
}

function AddMaterial({ units, onAdded }: { units: string[]; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('sqft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(null);
    try {
      await post('/api/materials', { name: name.trim(), unit, costPerUnitCents: 0, priceMode: 'custom', rateCents: 0 });
      showSnackbar(`Added ${name.trim()} — set its price rule below`);
      setName(''); onAdded();
    } catch (e) { setError(errorText(e, 'Add failed')); }
    finally { setBusy(false); }
  }
  return (
    <Card variant="filled">
      <form className="flex flex-wrap items-start gap-3" onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
        <TextField label="New material" variant="outlined" className="flex-1 min-w-60" placeholder="Reflective vinyl"
          value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={120} />
        <Select label="Unit" variant="outlined" className="w-40" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {(units.includes(unit) ? units : [unit, ...units]).map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
        <Button type="submit" icon="add" className="mt-2" disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
      </form>
    </Card>
  );
}
