import type { ReactNode } from 'react';
import { Tabs, type TabItem } from '../../../components/m3';
import { hasRole } from '../../../lib/session';

/** Page title + actions, then the inventory sub-navigation (route tabs, so back/bookmarks work). */
export default function InventoryHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const tabs: TabItem[] = [
    { value: 'items', label: 'Items', to: '/inventory', end: true },
    { value: 'receiving', label: 'Receiving', to: '/inventory/receiving' },
    { value: 'counts', label: 'Cycle counts', to: '/inventory/counts' },
    ...(hasRole('manager') ? [{ value: 'adjustments', label: 'Adjustments', to: '/inventory/adjustments' }] : []),
    { value: 'reorder', label: 'Reorder', to: '/inventory/reorder' },
  ];
  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h1 className="text-headline-medium">{title}</h1>
          {subtitle && <div className="text-body-medium text-on-surface-variant">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <Tabs label="Inventory sections" items={tabs} />
    </header>
  );
}
