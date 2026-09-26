// /settings/suppliers (manager+) — who stock comes from, with lead times
// that feed the automatic reorder point. Archive/restore is admin-only.
import { useState } from 'react';
import { Button, Card, Checkbox, EmptyState, LinearProgress, TextField, showSnackbar } from '../../../components/m3';
import { post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { errorText } from '../../../lib/errorText';
import type { Supplier } from '../../../lib/types';
import SettingsFrame from '../SettingsFrame';
import { numberIn, visibleRows } from '../logic';
import SupplierCard from './SupplierCard';

export default function Suppliers() {
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const q = useQuery<Supplier[]>('/api/suppliers?all=1&includeArchived=1');
  const rows = visibleRows(q.data ?? [], showArchived, search);
  return (
    <SettingsFrame title="Suppliers" min="manager"
      subtitle="Lead time feeds the automatic reorder point on the Inventory page (usage per day × lead time + buffer). Receipts record which supplier stock came from.">
      <AddSupplier onAdded={q.reload} />
      <div className="flex flex-wrap items-center gap-3 my-4">
        <TextField label="Search suppliers" leadingIcon="search" type="search" className="flex-1 min-w-60 max-w-md"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <Checkbox label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
      </div>
      <div className="h-1">{q.loading && <LinearProgress label="Loading suppliers" />}</div>
      {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load suppliers"
        action={<Button variant="outlined" onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>}
      {q.data && rows.length === 0 && <EmptyState title={search ? 'No suppliers match' : 'No suppliers yet — add the first one above'} />}
      <div className="grid gap-3">
        {rows.map((s) => <SupplierCard key={s.id} supplier={s} onChanged={q.reload} />)}
      </div>
    </SettingsFrame>
  );
}

function AddSupplier({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [lead, setLead] = useState('7');
  const [contact, setContact] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leadN = numberIn(lead, 0, 365);
  const leadErr = tried && (leadN === null || !Number.isInteger(leadN)) ? 'Whole days, 0–365' : null;
  const nameErr = tried && !name.trim() ? 'Supplier name required.' : null;
  async function add() {
    setTried(true);
    if (!name.trim() || leadN === null || !Number.isInteger(leadN)) return;
    setBusy(true); setError(null);
    try {
      await post('/api/suppliers', { name: name.trim(), leadTimeDays: leadN, ...(contact.trim() ? { contact: contact.trim() } : {}) });
      showSnackbar(`Added ${name.trim()}`);
      setName(''); setLead('7'); setContact(''); setTried(false); onAdded();
    } catch (e) { setError(errorText(e, 'Add supplier failed')); }
    finally { setBusy(false); }
  }
  return (
    <Card variant="filled">
      <form className="flex flex-wrap items-start gap-3" onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
        <TextField label="New supplier" variant="outlined" className="flex-1 min-w-52" placeholder="Fellers"
          value={name} onChange={(e) => setName(e.target.value)} error={nameErr} maxLength={120} />
        <TextField label="Lead time (days)" variant="outlined" inputMode="numeric" className="w-40"
          value={lead} onChange={(e) => setLead(e.target.value)} error={leadErr} />
        <TextField label="Contact (optional)" variant="outlined" className="w-60"
          value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} />
        <Button type="submit" icon="add" className="mt-2" disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-body-medium text-error">{error}</p>}
    </Card>
  );
}
