import type { ReactNode } from 'react';
import { Tabs } from '../../components/m3';

const TABS = [
  { label: 'Counter', value: 'counter', to: '/pos', end: true },
  { label: 'Drawer', value: 'drawer', to: '/pos/drawer' },
  { label: 'Invoices', value: 'invoices', to: '/pos/invoices' },
  { label: 'Returns', value: 'returns', to: '/pos/returns' },
];

/** Page title + the POS section tabs (route tabs, so back/bookmarks work). */
export default function PosHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4">
      <Tabs items={TABS} label="Point of sale" className="mb-4 -mx-1" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-headline-medium">{title}</h1>
          {subtitle && <p className="text-body-medium text-on-surface-variant">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
