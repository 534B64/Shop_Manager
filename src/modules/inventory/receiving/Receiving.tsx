// /inventory/receiving — book stock that arrived: qty in purchase units, cost
// per purchase unit, supplier. Shows the resulting average cost from the server.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, CardHeader, Icon, Select, TextField } from '../../../components/m3';
import { post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { hasRole } from '../../../lib/session';
import { formatCents, parseDollarsToCents } from '../../../lib/format';
import type { InventoryItem } from '../../../lib/types';
import { averageAfterReceipt, countUnitCost } from '../../../../shared/costing';
import InventoryHeader from '../components/InventoryHeader';
import ItemPicker from '../components/ItemPicker';
import TxnTable from '../components/TxnTable';
import { useSuppliers } from '../components/lookups';
import { factorOf, receiptCountUnits } from '../logic';
import type { Txn } from '../types';
import { errorText } from '../../../lib/errorText';
import { useKeysetMore } from '../../../lib/keysetPaging';

interface Result { before: InventoryItem; after: InventoryItem; added: number }

export default function Receiving() {
  const [sp, setSp] = useSearchParams();
  const itemId = sp.get('item');
  const q = useQuery<InventoryItem>(itemId ? `/api/inventory/${itemId}` : null);
  const item = itemId && q.data?.id === Number(itemId) ? q.data : null;
  const sups = useSuppliers();
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const manager = hasRole('manager');
  const recent = useKeysetMore<Txn>(manager ? '/api/inventory/transactions' : null, { type: 'receipt' }, 10);

  useEffect(() => { setSupplierId(item?.supplierId != null ? String(item.supplierId) : ''); }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (i: InventoryItem | null) => {
    setError(null);
    setSp((cur) => { const n = new URLSearchParams(cur); if (i) n.set('item', String(i.id)); else n.delete('item'); return n; }, { replace: true });
  };

  const factor = item ? factorOf(item) : 1;
  const units = item ? receiptCountUnits(qty, factor) : null;
  const cents = cost.trim() ? parseDollarsToCents(cost) : null;
  const costBad = cost.trim() !== '' && cents == null;
  const pu = item?.purchaseUnit || 'unit';
  const cu = item?.countUnit || 'units';
  const expectedAvg = item && units && cents ? averageAfterReceipt({
    onHand: item.count, avgCostCents: item.avgCostCents ?? 0, qty: units, unitCostCents: countUnitCost(cents, factor),
  }) : null;

  async function save() {
    if (!item || !units || costBad) return;
    setSaving(true); setError(null);
    try {
      const after = await post<InventoryItem>(`/api/inventory/${item.id}/adjust`, {
        delta: units, reason: 'received',
        ...(cents ? { unitCostCents: cents } : {}),
        ...(supplierId ? { supplierId: Number(supplierId) } : {}),
      });
      setResult({ before: item, after, added: units });
      q.setData(after);
      setQty(''); setCost('');
      recent.reload();
    } catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  }

  return (
    <div>
      <InventoryHeader title="Receiving" subtitle="Book stock that came in. The cost you paid updates the item’s average cost." />
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Card>
          <CardHeader title="Receive stock" />
          <div className="flex flex-col gap-3">
            <ItemPicker value={item} onChange={pick} autoFocus={!itemId} touch />
            {itemId && q.error && <p role="alert" className="text-body-medium text-error">{q.error}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={`Qty received (${pu})`} inputMode="decimal" value={qty} disabled={!item}
                onChange={(e) => setQty(e.target.value)} error={qty.trim() && item && !units ? 'Enter an amount above 0' : null}
                supportingText={item && units ? `${qty} ${pu} × ${factor} = +${units} ${cu}` : factor !== 1 ? `1 ${pu} = ${factor} ${cu}` : undefined} />
              <TextField label={`Cost paid per ${pu} ($)`} inputMode="decimal" value={cost} disabled={!item}
                onChange={(e) => setCost(e.target.value)} error={costBad ? 'Enter dollars and cents, e.g. 42.50' : null}
                supportingText={expectedAvg != null ? `Average cost becomes about ${formatCents(expectedAvg)} per ${cu}` : 'Optional, but it keeps the average cost right'} />
            </div>
            <Select label="Supplier" value={supplierId} disabled={!item} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {sups.live.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            {error && <p role="alert" className="text-body-medium text-error">{error}</p>}
            <div className="flex justify-end">
              <Button touch disabled={!item || !units || costBad || saving} onClick={save}>{saving ? 'Receiving…' : 'Receive'}</Button>
            </div>
          </div>
        </Card>
        {result && <ResultCard r={result} />}
      </div>
      {manager && (
        <section className="mt-6">
          <h2 className="text-title-large mb-2">Recent receipts</h2>
          <TxnTable label="Recent receipts" list={recent} showItem showCost />
        </section>
      )}
    </div>
  );
}

function ResultCard({ r }: { r: Result }) {
  const cu = r.after.countUnit || 'units';
  const avg = r.after.avgCostCents ?? 0;
  const was = r.before.avgCostCents ?? 0;
  return (
    <Card variant="filled" role="status" aria-live="polite">
      <div className="flex items-center gap-2 mb-2 text-success"><Icon name="check" /><span className="text-title-medium">Received</span></div>
      <p className="text-body-large">+{r.added} {cu} of <Link className="text-primary underline" to={`/inventory/${r.after.id}`}>{r.after.name}</Link></p>
      <p className="text-body-medium text-on-surface-variant">On hand {r.before.count} → <strong className="text-on-surface">{r.after.count}</strong> {cu}</p>
      <p className="text-body-medium text-on-surface-variant">
        Average cost {avg ? <>now <strong className="text-on-surface">{formatCents(avg)}</strong> per {cu}{was > 0 && was !== avg ? ` (was ${formatCents(was)})` : ''}</> : 'not set (no cost entered yet)'}
      </p>
    </Card>
  );
}
