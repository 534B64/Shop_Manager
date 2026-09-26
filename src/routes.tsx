// The one route table (ADR 0009, docs/UI-GUIDE.md). Every page is lazy-loaded,
// so a page's code only downloads when someone opens it. To add a page:
// lazy-import it, add a route below, and (if it's a top-level section) a NAV item.
import { lazy, type ReactElement } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import RoleGate from './components/RoleGate';
import type { Role } from './lib/session';
import type { NavItem } from './components/m3';

const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'));
const Quotes = lazy(() => import('./modules/jobs/Quotes'));
const Orders = lazy(() => import('./modules/jobs/Orders'));
const QuickOrder = lazy(() => import('./modules/jobs/QuickOrder'));
const Payments = lazy(() => import('./modules/payments/Pos'));
const CustomerList = lazy(() => import('./modules/customers/CustomerList'));
const CustomerDetail = lazy(() => import('./modules/customers/CustomerDetail'));
const Inventory = lazy(() => import('./modules/inventory/Inventory'));
const Account = lazy(() => import('./pages/settings/account/Account'));
const Users = lazy(() => import('./pages/settings/users/Users'));
const Shop = lazy(() => import('./pages/settings/shop/Shop'));
const Materials = lazy(() => import('./pages/settings/materials/Materials'));
const Taxonomy = lazy(() => import('./pages/settings/taxonomy/Taxonomy'));
const Suppliers = lazy(() => import('./pages/settings/suppliers/Suppliers'));
const Locations = lazy(() => import('./pages/settings/locations/Locations'));
const Reports = lazy(() => import('./pages/reports/Reports'));
const Audit = lazy(() => import('./pages/audit/Audit'));
const ComingSoon = lazy(() => import('./pages/ComingSoon'));
const NotFound = lazy(() => import('./pages/NotFound'));

/** Top-level sections, in rail order. `min` hides the item below that role. */
export const NAV: (NavItem & { min?: Role })[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/quotes', label: 'Quotes', icon: 'quote' },
  { to: '/orders', label: 'Orders', icon: 'orders' },
  { to: '/quick', label: 'Quick Order', icon: 'bolt' },
  // Points at the placeholder until the counter page takes over /pos.
  { to: '/pos/counter', label: 'POS', icon: 'cart' },
  { to: '/payments', label: 'Payments', icon: 'payments' },
  { to: '/customers', label: 'Customers', icon: 'people' },
  { to: '/inventory', label: 'Inventory', icon: 'inventory' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/audit', label: 'Audit', icon: 'shield', min: 'admin' },
];

const gate = (min: Role | undefined, el: ReactElement) => (min ? <RoleGate min={min}>{el}</RoleGate> : el);
const soon = (title: string, blurb: string, links?: { to: string; label: string }[]) =>
  <ComingSoon title={title} blurb={blurb} links={links} />;
const posLinks = [{ to: '/quick', label: 'Quick Order (counter sale today)' }, { to: '/payments', label: 'Payments' }];

interface Def { path: string; element: ReactElement; min?: Role }

const DEFS: Def[] = [
  { path: '/', element: <Dashboard /> },

  // Inventory — one page today; sub-routes let page builders split it without breaking links.
  { path: '/inventory', element: <Inventory /> },
  { path: '/inventory/receiving', element: <Inventory /> },
  { path: '/inventory/counts', element: <Inventory /> },
  { path: '/inventory/counts/:id', element: <Inventory /> },
  { path: '/inventory/adjustments', element: <Inventory /> },
  { path: '/inventory/reorder', element: <Inventory /> },
  { path: '/inventory/:id', element: <Inventory /> },

  // POS — filled in from the POS backend by a later builder.
  // /pos was the Payments page for years: it goes there until the counter page
  // exists. The POS builder moves the counter page from /pos/counter to /pos
  // and removes this redirect.
  { path: '/pos', element: <Navigate to="/payments" replace /> },
  { path: '/pos/counter', element: soon('Counter sale', 'The new point-of-sale screen is on its way. Until then, ring up counter sales in Quick Order and record payments in Payments.', posLinks) },
  { path: '/pos/invoices', element: soon('Invoices', 'Invoice list — coming with the POS.', posLinks) },
  { path: '/pos/invoices/:number', element: soon('Invoice', 'Invoice detail — coming with the POS.', posLinks) },
  { path: '/pos/returns/new', element: soon('New return', 'Returns — coming with the POS. Refunds are recorded in Payments for now.', posLinks) },
  { path: '/pos/drawer', element: soon('Cash drawer', 'Drawer open/close and counts — coming with the POS.', posLinks) },
  { path: '/payments', element: <Payments /> },

  // Jobs
  { path: '/quotes', element: <Navigate to="/quotes/new" replace /> },
  { path: '/quotes/new', element: <Quotes /> },
  { path: '/quotes/:id', element: <Quotes /> },
  { path: '/orders', element: <Orders /> },
  { path: '/quick', element: <QuickOrder /> },

  { path: '/customers', element: <CustomerList /> },
  { path: '/customers/:id', element: <CustomerDetail /> },

  { path: '/reports', element: <Reports /> },

  // Settings & admin
  { path: '/settings', element: <Account /> },
  { path: '/settings/users', element: <Users />, min: 'admin' },
  { path: '/settings/shop', element: <Shop />, min: 'admin' },
  { path: '/settings/materials', element: <Materials />, min: 'admin' },
  { path: '/settings/taxonomy', element: <Taxonomy />, min: 'manager' },
  { path: '/settings/suppliers', element: <Suppliers />, min: 'manager' },
  { path: '/settings/locations', element: <Locations />, min: 'admin' },
  { path: '/audit', element: <Audit />, min: 'admin' },

  // Old URLs → new homes, so bookmarks survive.
  { path: '/materials', element: <Navigate to="/settings/materials" replace /> },
  { path: '/taxonomy', element: <Navigate to="/settings/taxonomy" replace /> },

  { path: '*', element: <NotFound /> },
];

export const ROUTES: RouteObject[] = DEFS.map((d) => ({ path: d.path, element: gate(d.min, d.element) }));
