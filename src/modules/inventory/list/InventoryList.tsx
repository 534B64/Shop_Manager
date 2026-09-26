// /inventory — the item list: server-paged, filters/sort/page in the URL.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, DataTable, EmptyState, showSnackbar } from '../../../components/m3';
import type { InventoryItem } from '../../../lib/types';
import InventoryHeader from '../components/InventoryHeader';
import CountBanner from '../components/CountBanner';
import { useCategories, useSuppliers, useUnits } from '../components/lookups';
import { useUrlPaged } from '../components/useUrlPaged';
import { listApiParams, readListState, writeListState, type ListState } from '../logic';
import { itemColumns } from './columns';
import ListToolbar from './ListToolbar';
import MoreFiltersDialog from './MoreFiltersDialog';
import NewItemDialog from './NewItemDialog';
import ValuationSummary from './ValuationSummary';

const MATCH_LABEL = { contains: '', starts: 'Starts with', ends: 'Ends with', exact: 'Exact match' };

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
  const items = useUrlPaged<InventoryItem>('/api/inventory', listApiParams(s), s.page, (page) => update({ page }), { pageSize: 50 });

  const chips: { key: keyof ListState; label: string }[] = [];
  if (s.match !== 'contains') chips.push({ key: 'match', label: MATCH_LABEL[s.match] });
  if (s.categoryId) chips.push({ key: 'categoryId', label: s.categoryId === 'none' ? 'No category' : cats.name(Number(s.categoryId)) ?? 'Category' });
  if (s.supplierId) chips.push({ key: 'supplierId', label: sups.byId(Number(s.supplierId))?.name ?? 'Supplier' });
  if (s.materialId) chips.push({ key: 'materialId', label: 'Roll material' });
  if (s.color) chips.push({ key: 'color', label: s.color });
  if (s.widthIn) chips.push({ key: 'widthIn', label: `${s.widthIn}″ wide` });
  const filtered = !!(s.q || s.stock || s.kind || chips.length);
  const clearAll = () => setSp(new URLSearchParams());

  return (
    <div>
      <InventoryHeader title="Inventory" subtitle={<ValuationSummary />}
        actions={<>
          <Button icon="add" onClick={() => setAdding(true)}>New item</Button>
          <Button variant="tonal" to="/inventory/receiving">Receive stock</Button>
        </>} />
      <CountBanner quietWhenNotDue />
      <ListToolbar state={s} update={update} onMoreFilters={() => setFiltering(true)} activeChips={chips} />
      <DataTable label="Inventory items" columns={itemColumns(cats.name, sups.byId)} rows={items.rows} rowKey={(r) => r.id}
        loading={items.loading} error={items.error} onRetry={items.reload} paging={items}
        onRowClick={(r) => nav(`/inventory/${r.id}`)}
        empty={filtered
          ? <EmptyState icon="search" title="No items match these filters"
              action={<Button variant="outlined" onClick={clearAll}>Clear filters</Button>} />
          : <EmptyState icon="inventory" title="No items yet"
              action={<Button icon="add" onClick={() => setAdding(true)}>New item</Button>}>
              Add vinyl rolls, shirt blanks, magnet stock — anything the shop counts.
            </EmptyState>} />
      <MoreFiltersDialog open={filtering} onClose={() => setFiltering(false)} state={s} onApply={(f) => update(f)}
        categories={cats.live} suppliers={sups.live} />
      <NewItemDialog open={adding} onClose={() => setAdding(false)} categories={cats.live} suppliers={sups.live} units={units}
        onCreated={(item) => { setAdding(false); showSnackbar(`Added ${item.name}`); nav(`/inventory/${item.id}`); }} />
    </div>
  );
}
