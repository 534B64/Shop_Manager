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
const Payments = lazy(() => import('./modules/payments/PaymentsPage'));
const PosCounter = lazy(() => import('./modules/pos/counter/CounterPage'));
const PosDrawer = lazy(() => import('./modules/pos/drawer/DrawerPage'));
const PosZReport = lazy(() => import('./modules/pos/drawer/ZReportPage'));
const PosInvoices = lazy(() => import('./modules/pos/invoices/InvoicesPage'));
const PosInvoice = lazy(() => import('./modules/pos/invoices/InvoiceDetailPage'));
const PosReturns = lazy(() => import('./modules/pos/returns/ReturnsPage'));
const PosNewReturn = lazy(() => import('./modules/pos/returns/NewReturnPage'));
const PosReturn = lazy(() => import('./modules/pos/returns/ReturnDetailPage'));
const Customers = lazy(() => import('./modules/customers/Customers'));
const Inventory = lazy(() => import('./modules/inventory/Inventory'));
const Materials = lazy(() => import('./modules/materials/Materials'));
const Taxonomy = lazy(() => import('./modules/inventory/Taxonomy'));
const Settings = lazy(() => import('./pages/Settings'));
const ComingSoon = lazy(() => import('./pages/ComingSoon'));
const NotFound = lazy(() => import('./pages/NotFound'));

/** Top-level sections, in rail order. `min` hides the item below that role. */
export const NAV: (NavItem & { min?: Role })[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/quotes', label: 'Quotes', icon: 'quote' },
  { to: '/orders', label: 'Orders', icon: 'orders' },
  { to: '/quick', label: 'Quick Order', icon: 'bolt' },
  { to: '/pos', label: 'POS', icon: 'cart' },
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

  // POS (ADR 0007): counter sale, cash drawer + Z-reports, invoices, returns.
  { path: '/pos', element: <PosCounter /> },
  { path: '/pos/counter', element: <Navigate to="/pos" replace /> },
  { path: '/pos/drawer', element: <PosDrawer /> },
  { path: '/pos/drawer/:id', element: <PosZReport /> },
  { path: '/pos/invoices', element: <PosInvoices /> },
  { path: '/pos/invoices/:number', element: <PosInvoice /> },
  { path: '/pos/returns', element: <PosReturns /> },
  { path: '/pos/returns/new', element: <PosNewReturn /> },
  { path: '/pos/returns/:id', element: <PosReturn /> },
  { path: '/payments', element: <Payments /> },

  // Jobs
  { path: '/quotes', element: <Navigate to="/quotes/new" replace /> },
  { path: '/quotes/new', element: <Quotes /> },
  { path: '/quotes/:id', element: <Quotes /> },
  { path: '/orders', element: <Orders /> },
  { path: '/quick', element: <QuickOrder /> },

  { path: '/customers', element: <Customers /> },
  { path: '/customers/:id', element: <Customers /> },

  { path: '/reports', element: soon('Reports', 'Sales totals and CSV exports live on the Payments page for now.', [{ to: '/payments', label: 'Open Payments' }]) },

  // Settings & admin
  { path: '/settings', element: <Settings /> },
  { path: '/settings/users', element: <Settings />, min: 'admin' },
  { path: '/settings/materials', element: <Materials />, min: 'admin' },
  { path: '/settings/taxonomy', element: <Taxonomy />, min: 'manager' },
  { path: '/settings/suppliers', element: <Taxonomy />, min: 'manager' },
  { path: '/audit', element: soon('Audit log', 'A viewer for the audit log is coming. Admins can export it today via /api/audit.csv.'), min: 'admin' },

  // Old URLs → new homes, so bookmarks survive.
  { path: '/materials', element: <Navigate to="/settings/materials" replace /> },
  { path: '/taxonomy', element: <Navigate to="/settings/taxonomy" replace /> },

  { path: '*', element: <NotFound /> },
];

export const ROUTES: RouteObject[] = DEFS.map((d) => ({ path: d.path, element: gate(d.min, d.element) }));
