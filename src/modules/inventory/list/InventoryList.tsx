// /inventory — the item list: server-paged, filters/sort/page in the URL.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, DataTable, EmptyState, showSnackbar } from '../../../components/m3';
import { post } from '../../../lib/api';
import { approvalCancelled, errorText } from '../../../lib/errorText';
import type { InventoryItem } from '../../../lib/types';
import InventoryHeader from '../components/InventoryHeader';
import CountBanner from '../components/CountBanner';
import { useCategories, useLocations, useSuppliers, useUnits } from '../components/lookups';
import { useUrlPaged } from '../components/useUrlPaged';
import { listApiParams, readListState, toggleClosed, writeListState, type ListState } from '../logic';
import AdjustDialog from '../item/AdjustDialog';
import GroupHeader, { type GroupCount } from './GroupHeader';
import { itemColumns } from './columns';
import ListToolbar from './ListToolbar';
import MoreFiltersDialog from './MoreFiltersDialog';
import NewItemDialog from './NewItemDialog';
import ValuationSummary from './ValuationSummary';

const MATCH_LABEL = { contains: '', starts: 'Starts with', ends: 'Ends with', exact: 'Exact match' };

type Row = InventoryItem & { groupKey?: string; groupLabel?: string };

export default function InventoryList() {
  const [sp, setSp] = useSearchParams();
  const s = readListState(sp);
  const update = (patch: Partial<ListState>, replace = false) => setSp((cur) => writeListState(cur, patch), { replace });
  const nav = useNavigate();
  const cats = useCategories();
  const sups = useSuppliers();
  const units = useUnits();
  const [adding, setAdding] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const locations = useLocations();
  const items = useUrlPaged<Row>('/api/inventory', listApiParams(s), s.page, (page) => update({ page }), { pageSize: 50 });
  const groupCounts = (items.data?.groups ?? []) as GroupCount[];

  // One tap = one ledger row (−1 used / +1 received), like the old list's −/+ buttons.
  // A cashier's −1 gets the manager-approval prompt from lib/api like any adjustment.
  async function step(i: InventoryItem, delta: 1 | -1) {
    setBusy(i.id);
    try {
      await post(`/api/inventory/${i.id}/adjust`, { delta, reason: delta < 0 ? 'used' : 'received' });
      showSnackbar(`${i.name}: ${delta < 0 ? 'used 1' : 'received 1'}`);
      items.reload();
    } catch (e) { if (!approvalCancelled(e)) showSnackbar(errorText(e)); } finally { setBusy(null); }
  }

  const chips: { key: keyof ListState; label: string }[] = [];
  if (s.match !== 'contains') chips.push({ key: 'match', label: MATCH_LABEL[s.match] });
  if (s.categoryId) chips.push({ key: 'categoryId', label: s.categoryId === 'none' ? 'No category' : cats.name(Number(s.categoryId)) ?? 'Category' });
  if (s.supplierId) chips.push({ key: 'supplierId', label: sups.byId(Number(s.supplierId))?.name ?? 'Supplier' });
  if (s.materialId) chips.push({ key: 'materialId', label: 'Roll material' });
  if (s.color) chips.push({ key: 'color', label: s.color });
  if (s.widthIn) chips.push({ key: 'widthIn', label: `${s.widthIn}″ wide` });
  const filtered = !!(s.q || s.stock || s.kind || chips.length);
  const clearAll = () => setSp(writeListState(new URLSearchParams(), { group: s.group }));

  return (
    <div>
      <InventoryHeader title="Inventory" subtitle={<ValuationSummary />}
        actions={<>
          <Button icon="add" onClick={() => setAdding(true)}>New item</Button>
          <Button variant="tonal" to="/inventory/receiving">Receive stock</Button>
        </>} />
      <CountBanner quietWhenNotDue />
      <ListToolbar state={s} update={update} onMoreFilters={() => setFiltering(true)} activeChips={chips} />
      <DataTable label="Inventory items" rows={items.rows} rowKey={(r) => r.id}
        columns={itemColumns(cats.name, sups.byId, { step, adjust: setAdjusting, busy })}
        loading={items.loading} error={items.error} onRetry={items.reload} paging={items}
        onRowClick={(r) => nav(`/inventory/${r.id}`)}
        groupOf={(r) => r.groupKey} hideRow={(r) => !!r.groupKey && s.closed.includes(r.groupKey)}
        renderGroup={(r) => (
          <GroupHeader label={r.groupLabel ?? ''} closed={s.closed.includes(r.groupKey!)}
            counts={groupCounts.find((g) => g.key === r.groupKey)}
            onToggle={() => update({ closed: toggleClosed(s.closed, r.groupKey!) })} />
        )}
        empty={filtered
          ? <EmptyState icon="search" title="No items match these filters"
              action={<Button variant="outlined" onClick={clearAll}>Clear filters</Button>} />
          : <EmptyState icon="inventory" title="No items yet"
              action={<Button icon="add" onClick={() => setAdding(true)}>New item</Button>}>
              Add vinyl rolls, shirt blanks, magnet stock — anything the shop counts.
            </EmptyState>} />
      <MoreFiltersDialog open={filtering} onClose={() => setFiltering(false)} state={s} onApply={(f) => update(f)}
        categories={cats.live} suppliers={sups.live} />
      {adjusting && (
        <AdjustDialog open onClose={() => setAdjusting(null)} item={adjusting} locations={locations} presetReason="correction"
          onDone={(saved) => { setAdjusting(null); showSnackbar(`Adjusted ${saved.name}`); items.reload(); }} />
      )}
      <NewItemDialog open={adding} onClose={() => setAdding(false)} categories={cats.live} suppliers={sups.live} units={units}
        onCreated={(item) => { setAdding(false); showSnackbar(`Added ${item.name}`); nav(`/inventory/${item.id}`); }} />
    </div>
  );
}
