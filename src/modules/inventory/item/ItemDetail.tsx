// /inventory/:id — one item: fields, stock by location, cost, count history,
// its transactions, and the Adjust / Transfer / Receive actions.
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, EmptyState, Icon, LinearProgress, showSnackbar } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import { hasRole } from '../../../lib/session';
import { formatCents } from '../../../lib/format';
import type { InventoryItem } from '../../../lib/types';
import StockStatus from '../components/StockStatus';
import TxnTable from '../components/TxnTable';
import { useCategories, useInvSettings, useLocations, useSuppliers, useUnits } from '../components/lookups';
import type { Txn } from '../types';
import ItemFieldsCard from './ItemFieldsCard';
import { BalancesCard, CostCard } from './StockCards';
import VarianceCard from './VarianceCard';
import AdjustDialog from './AdjustDialog';
import TransferDialog from './TransferDialog';
import { useKeysetMore } from '../../../lib/keysetPaging';

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-[7rem]">
      <div className="text-label-medium text-on-surface-variant">{label}</div>
      <div className="text-title-large tabular-nums">{children}</div>
    </div>
  );
}

export default function ItemDetail() {
  const { id } = useParams();
  const q = useQuery<InventoryItem>(`/api/inventory/${id}`);
  const cats = useCategories();
  const sups = useSuppliers();
  const units = useUnits();
  const settings = useInvSettings();
  const locations = useLocations();
  const [rev, setRev] = useState(0); // bumps after a stock change so the cards reload
  const [dialog, setDialog] = useState<'adjust' | 'transfer' | null>(null);
  const history = useKeysetMore<Txn>(`/api/inventory/${id}/transactions`, {}, 25);
  const manager = hasRole('manager');
  const item = q.data;

  const back = <Link to="/inventory" className="state-layer inline-flex items-center gap-1 h-10 pr-3 rounded-shape-full text-label-large text-primary mb-2">
    <Icon name="chevronLeft" />Inventory</Link>;
  if (!item) {
    return (
      <div>
        {back}
        {q.loading && <LinearProgress label="Loading item" />}
        {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t open this item"
          action={<Button variant="outlined" onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>}
      </div>
    );
  }

  const stockChanged = (saved: InventoryItem, msg: string) => {
    setDialog(null); q.setData(saved); setRev((r) => r + 1); history.reload(); showSnackbar(msg);
  };
  const days = item.avgDailyUse ? item.count / item.avgDailyUse : null;

  return (
    <div>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-headline-medium">{item.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-body-medium text-on-surface-variant">
            <StockStatus count={item.count} min={item.lowStockThreshold} />
            {!item.active && <span>Inactive</span>}
            {cats.name(item.categoryId) && <span>{cats.name(item.categoryId)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="tonal" to={`/inventory/receiving?item=${item.id}`}>Receive</Button>
          <Button variant="outlined" onClick={() => setDialog('adjust')}>Adjust</Button>
          {manager && <Button variant="outlined" onClick={() => setDialog('transfer')}>Transfer</Button>}
        </div>
      </div>

      <Card variant="filled" className="flex flex-wrap gap-6 mb-4">
        <Stat label="On hand">{item.count}<span className="text-body-medium"> {item.countUnit ?? ''}</span></Stat>
        <Stat label="Min / Max">{item.lowStockThreshold} / {item.reorderMaxQty ?? '—'}</Stat>
        <Stat label="Average cost">{item.avgCostCents ? formatCents(item.avgCostCents) : '—'}</Stat>
        <Stat label="Usage">{item.avgDailyUse ? `~${item.avgDailyUse.toFixed(1)}/day` : '—'}</Stat>
        <Stat label="Days left">{days != null ? `~${Math.floor(days)}` : '—'}</Stat>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr] mb-4">
        <ItemFieldsCard item={item} onSaved={q.setData} categories={cats} suppliers={sups} units={units}
          bufferDays={settings.reorderBufferDays} />
        <div className="flex flex-col gap-4">
          <BalancesCard key={`b${rev}`} item={item} />
          <CostCard key={`c${rev}`} item={item} />
        </div>
      </div>
      <div className="mb-4"><VarianceCard key={`v${rev}`} itemId={item.id} /></div>

      <h2 className="text-title-large mb-2">Transactions</h2>
      <TxnTable label={`Transactions for ${item.name}`} list={history} showCost={manager}
        locationName={(lid) => locations.find((l) => l.id === lid)?.name ?? null} />

      <AdjustDialog open={dialog === 'adjust'} onClose={() => setDialog(null)} item={item} locations={locations}
        onDone={(s) => stockChanged(s, 'Adjustment recorded')} />
      <TransferDialog open={dialog === 'transfer'} onClose={() => setDialog(null)} item={item} locations={locations}
        onDone={(s) => stockChanged(s, 'Transfer recorded')} />
    </div>
  );
}
