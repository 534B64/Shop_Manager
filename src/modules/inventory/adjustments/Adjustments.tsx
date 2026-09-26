// /inventory/adjustments — the inventory ledger across items (manager+):
// every receipt, sale, adjustment, transfer and count posting, newest first.
import { useSearchParams } from 'react-router-dom';
import { Button, Select, TextField } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import type { InventoryItem } from '../../../lib/types';
import { TXN_TYPES } from '../../../../shared/domain';
import InventoryHeader from '../components/InventoryHeader';
import ItemPicker from '../components/ItemPicker';
import TxnTable from '../components/TxnTable';
import { useKeyset } from '../components/useKeyset';
import { txnLabel } from '../logic';
import type { Txn } from '../types';

const KEYS = ['type', 'from', 'to', 'item'] as const;

export default function Adjustments() {
  const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? ''])) as Record<(typeof KEYS)[number], string>;
  const set = (k: (typeof KEYS)[number], v: string) =>
    setSp((cur) => { const n = new URLSearchParams(cur); if (v) n.set(k, v); else n.delete(k); return n; });
  const itemQ = useQuery<InventoryItem>(f.item ? `/api/inventory/${f.item}` : null);
  const list = useKeyset<Txn>('/api/inventory/transactions', { type: f.type, from: f.from, to: f.to, itemId: f.item }, 50);
  const any = KEYS.some((k) => f[k]);

  return (
    <div>
      <InventoryHeader title="Adjustments & history"
        subtitle="Every stock change across items — who, when, why. Nothing here can be edited; a mistake is fixed with a new adjustment." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_11rem_11rem_auto] items-start mb-4">
        <ItemPicker label="Item (all items when empty)" value={itemQ.data && f.item ? itemQ.data : null}
          onChange={(i) => set('item', i ? String(i.id) : '')} />
        <Select label="Type" value={f.type} onChange={(e) => set('type', e.target.value)}>
          <option value="">All types</option>
          {TXN_TYPES.map((t) => <option key={t} value={t}>{txnLabel(t)}</option>)}
        </Select>
        <TextField label="From" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />
        <TextField label="To" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />
        {any && <Button variant="text" className="self-center" onClick={() => setSp(new URLSearchParams())}>Clear</Button>}
      </div>
      <TxnTable label="Inventory transactions" list={list} showItem showCost />
    </div>
  );
}
