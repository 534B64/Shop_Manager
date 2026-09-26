// The one route table (ADR 0009, docs/UI-GUIDE.md). Every page is lazy-loaded,
// so a page's code only downloads when someone opens it. To add a page:
// lazy-import it, add a route below, and (if it's a top-level section) a NAV item.
import { lazy, type ReactElement } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import RoleGate from './components/RoleGate';
import type { Role } from './lib/session';
import type { NavItem } from './components/m3';

const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'));
const QuotePage = lazy(() => import('./modules/jobs/quote/QuotePage'));
const OrdersPage = lazy(() => import('./modules/jobs/orders/OrdersPage'));
const QuickOrderPage = lazy(() => import('./modules/jobs/quick/QuickOrderPage'));
const Payments = lazy(() => import('./modules/payments/PaymentsPage'));
const PosCounter = lazy(() => import('./modules/pos/counter/CounterPage'));
const PosDrawer = lazy(() => import('./modules/pos/drawer/DrawerPage'));
const PosZReport = lazy(() => import('./modules/pos/drawer/ZReportPage'));
const PosInvoices = lazy(() => import('./modules/pos/invoices/InvoicesPage'));
const PosInvoice = lazy(() => import('./modules/pos/invoices/InvoiceDetailPage'));
const PosReturns = lazy(() => import('./modules/pos/returns/ReturnsPage'));
const PosNewReturn = lazy(() => import('./modules/pos/returns/NewReturnPage'));
const PosReturn = lazy(() => import('./modules/pos/returns/ReturnDetailPage'));
const CustomerList = lazy(() => import('./modules/customers/CustomerList'));
const CustomerDetail = lazy(() => import('./modules/customers/CustomerDetail'));
const InventoryList = lazy(() => import('./modules/inventory/list/InventoryList'));
const InventoryItem = lazy(() => import('./modules/inventory/item/ItemDetail'));
const Receiving = lazy(() => import('./modules/inventory/receiving/Receiving'));
const Counts = lazy(() => import('./modules/inventory/counts/Counts'));
const CountSession = lazy(() => import('./modules/inventory/counts/CountSession'));
const Adjustments = lazy(() => import('./modules/inventory/adjustments/Adjustments'));
const Reorder = lazy(() => import('./modules/inventory/reorder/Reorder'));
const Account = lazy(() => import('./pages/settings/account/Account'));
const Users = lazy(() => import('./pages/settings/users/Users'));
const Shop = lazy(() => import('./pages/settings/shop/Shop'));
const Materials = lazy(() => import('./pages/settings/materials/Materials'));
const Taxonomy = lazy(() => import('./pages/settings/taxonomy/Taxonomy'));
const Suppliers = lazy(() => import('./pages/settings/suppliers/Suppliers'));
const Locations = lazy(() => import('./pages/settings/locations/Locations'));
const Reports = lazy(() => import('./pages/reports/Reports'));
const Audit = lazy(() => import('./pages/audit/Audit'));
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

interface Def { path: string; element: ReactElement; min?: Role }

const DEFS: Def[] = [
  { path: '/', element: <Dashboard /> },

  // Inventory — one page per workflow (src/modules/inventory/*).
  { path: '/inventory', element: <InventoryList /> },
  { path: '/inventory/receiving', element: <Receiving /> },
  { path: '/inventory/counts', element: <Counts /> },
  { path: '/inventory/counts/:id', element: <CountSession /> },
  { path: '/inventory/adjustments', element: <Adjustments />, min: 'manager' },
  { path: '/inventory/reorder', element: <Reorder /> },
  { path: '/inventory/:id', element: <InventoryItem /> },

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
  { path: '/quotes/new', element: <QuotePage /> },
  { path: '/quotes/:id', element: <QuotePage /> },
  { path: '/orders', element: <OrdersPage /> },
  { path: '/quick', element: <QuickOrderPage /> },

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
