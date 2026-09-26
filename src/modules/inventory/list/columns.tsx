import { Link } from 'react-router-dom';
import type { Column } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import type { InventoryItem, Supplier } from '../../../lib/types';
import StockStatus from '../components/StockStatus';

export const sizeLabel = (i: InventoryItem) => i.sizeText || (i.nominalWidthIn != null ? `${i.nominalWidthIn}″` : null);

/** Item list columns. The name is a real link, so rows are keyboard-reachable. */
export function itemColumns(categoryName: (id: number | null | undefined) => string | null,
  supplier: (id: number | null | undefined) => Supplier | null): Column<InventoryItem>[] {
  return [
    {
      key: 'name', header: 'Item', width: 'min-w-[12rem]', render: (i) => {
        const meta = [categoryName(i.categoryId), i.materialId != null ? 'Roll' : null, i.color, sizeLabel(i)].filter(Boolean);
        return (
          <div className="min-w-0 py-1">
            <Link to={`/inventory/${i.id}`} onClick={(e) => e.stopPropagation()}
              className="text-title-small text-on-surface hover:underline underline-offset-2">{i.name}</Link>
            {meta.length > 0 && <div className="text-body-small text-on-surface-variant">{meta.join(' · ')}</div>}
          </div>
        );
      },
    },
    {
      key: 'count', header: 'On hand', align: 'right', render: (i) => (
        <span className="whitespace-nowrap"><span className="text-title-medium tabular-nums">{i.count}</span>
          {i.countUnit && <span className="text-body-small text-on-surface-variant"> {i.countUnit}</span>}</span>
      ),
    },
    { key: 'status', header: 'Status', render: (i) => <StockStatus count={i.count} min={i.lowStockThreshold} /> },
    {
      key: 'minmax', header: 'Min / Max', hideOnNarrow: true, render: (i) => (
        <span className="whitespace-nowrap tabular-nums">{i.lowStockThreshold} / {i.reorderMaxQty ?? '—'}</span>
      ),
    },
    { key: 'supplier', header: 'Supplier', hideOnNarrow: true, render: (i) => supplier(i.supplierId)?.name ?? i.vendor ?? '—' },
    {
      key: 'cost', header: 'Avg cost', align: 'right', hideOnNarrow: true,
      render: (i) => (i.avgCostCents ? formatCents(i.avgCostCents) : '—'),
    },
    {
      key: 'use', header: 'Usage', align: 'right', hideOnNarrow: true,
      render: (i) => (i.avgDailyUse ? `~${Number(i.avgDailyUse.toFixed(1))}/day` : '—'),
    },
  ];
}
