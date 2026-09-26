import { Suspense, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { NavigationRail, NavigationDrawer, TopAppBar, IconButton, SnackbarHost, LinearProgress } from '../m3';
import { hasRole } from '../../lib/session';
import { NAV } from '../../routes';
import AccountMenu from './AccountMenu';

const Brand = () => (
  <span className="flex items-center justify-center h-12 w-12 rounded-shape-large bg-primary-container text-on-primary-container text-title-medium" aria-label="Decals Plus">DP</span>
);

/**
 * App chrome (ADR 0009): navigation rail at ≥ 768px, modal drawer below;
 * top app bar with the account menu; every page renders into <Outlet/>
 * behind one Suspense boundary (pages are lazy-loaded).
 */
export default function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const items = NAV.filter((n) => !n.min || hasRole(n.min));
  return (
    <div className="app-chrome min-h-screen flex bg-surface text-on-surface">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:bg-primary focus:text-on-primary focus:px-4 focus:py-2 focus:rounded-shape-full">
        Skip to content
      </a>
      <NavigationRail items={items} header={<Brand />} className="hidden md:flex sticky top-0 h-screen" />
      <NavigationDrawer open={drawer} onClose={() => setDrawer(false)} items={items}
        header={<span className="text-title-medium">Decals Plus</span>} />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopAppBar
          leading={<IconButton icon="menu" label="Open menu" className="md:hidden" onClick={() => setDrawer(true)} touch />}
          title={<span className="text-title-medium text-on-surface-variant">Decals Plus · Shop Manager</span>}
          trailing={<AccountMenu />}
        />
        {/* No max-width cap — dense pages go full width; forms keep their own caps. */}
        <main id="main" tabIndex={-1} className="flex-1 min-w-0 px-4 pb-8 md:px-6 outline-none">
          <Suspense fallback={<LinearProgress label="Loading page" className="mt-2" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <SnackbarHost />
    </div>
  );
}
