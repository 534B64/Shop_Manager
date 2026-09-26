import { NavLink, Outlet } from 'react-router-dom';
import { sessionUser, signOut } from '../lib/session';
import DemoBanner from './DemoBanner';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/quotes', label: 'Quotes' },
  { to: '/orders', label: 'Orders' },
  { to: '/quick', label: 'Quick Order' },
  { to: '/pos', label: 'Payments' },
  { to: '/customers', label: 'Customers' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const me = sessionUser();
  return (
    <div className="min-h-screen flex app-chrome">
      <aside className="w-52 shrink-0 border-r border-line bg-surface flex flex-col">
        <div className="px-4 py-5 border-b border-line">
          <div className="font-bold text-lg leading-tight">Decals Plus</div>
          <div className="text-muted text-sm">Shop Manager</div>
        </div>
        <nav className="flex-1 p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                // Touch-friendly: full-width, tall targets.
                `block px-3 py-3 rounded-token mb-1 text-base ${
                  isActive
                    ? 'bg-accent text-accent-contrast font-semibold'
                    : 'text-ink hover:bg-bg'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 text-xs text-muted border-t border-line">
          <div className="mb-1">Signed in: <b className="text-ink">{me?.name}</b>{me && <span> · {me.role}</span>}</div>
          <button className="underline" onClick={async () => { await signOut(); location.reload(); }}>Switch user</button>
          <div className="mt-2">v0.10.0</div>
        </div>
      </aside>
      {/* No max-width cap — pages size to the window. Dense pages go full
          width; forms/modals keep their own sane caps. */}
      <main className="flex-1 p-6 min-w-0">
        <DemoBanner />
        <Outlet />
      </main>
    </div>
  );
}
