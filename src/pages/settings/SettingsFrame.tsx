// Shared header + route tabs for every /settings/* page. Tabs below the
// viewer's role are hidden (the server re-checks every write).
import type { ReactNode } from 'react';
import { Tabs, type TabItem } from '../../components/m3';
import RoleGate from '../../components/RoleGate';
import { hasRole, type Role } from '../../lib/session';

const TABS: (TabItem & { min?: Role })[] = [
  { value: 'account', label: 'My account', to: '/settings', end: true },
  { value: 'users', label: 'Users', to: '/settings/users', min: 'admin' },
  { value: 'shop', label: 'Shop', to: '/settings/shop', min: 'admin' },
  { value: 'materials', label: 'Materials', to: '/settings/materials', min: 'admin' },
  { value: 'taxonomy', label: 'Categories & units', to: '/settings/taxonomy', min: 'manager' },
  { value: 'suppliers', label: 'Suppliers', to: '/settings/suppliers', min: 'manager' },
  { value: 'locations', label: 'Locations', to: '/settings/locations', min: 'admin' },
];

export default function SettingsFrame({ title, subtitle, min, actions, children }: {
  title: string; subtitle?: ReactNode; min?: Role; actions?: ReactNode; children: ReactNode;
}) {
  const tabs = TABS.filter((t) => !t.min || hasRole(t.min));
  return (
    <div>
      <h1 className="text-headline-medium">Settings</h1>
      {tabs.length > 1 && <Tabs label="Settings sections" items={tabs} className="mt-2 mb-6" />}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-headline-small">{title}</h2>
          {subtitle && <p className="text-body-medium text-on-surface-variant max-w-3xl">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {min ? <RoleGate min={min}>{children}</RoleGate> : children}
    </div>
  );
}
