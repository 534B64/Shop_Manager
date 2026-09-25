import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Quotes from './modules/jobs/Quotes';
import Orders from './modules/jobs/Orders';
import Pos from './modules/payments/Pos';
import Customers from './modules/customers/Customers';
import QuickOrder from './modules/jobs/QuickOrder';
import Inventory from './modules/inventory/Inventory';
import Materials from './modules/materials/Materials';
import Taxonomy from './modules/inventory/Taxonomy';
import Settings from './pages/Settings';
import SignIn from './components/SignIn';
import ApprovalHost from './components/ApprovalDialog';
import { useEffect, useState } from 'react';
import { get, getToken, setUnauthorizedHandler } from './lib/api';
import { sessionUser, updateSessionUser, clearSession, type SessionUser } from './lib/session';

export default function App() {
  const [signedIn, setSignedIn] = useState(!!getToken() && !!sessionUser());
  // Bumped after /api/auth/me so role-dependent UI re-renders with the fresh role.
  const [, setMeVersion] = useState(0);

  useEffect(() => {
    // Any 401 (expired, revoked, deactivated) drops back to the sign-in screen.
    setUnauthorizedHandler(() => { clearSession(); setSignedIn(false); });
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    // Refresh name/role from the server — an admin may have changed it.
    get<{ user: SessionUser | null }>('/api/auth/me')
      .then((r) => { if (r.user) { updateSessionUser(r.user); setMeVersion((v) => v + 1); } })
      .catch(() => { /* offline: keep the cached role; the server still enforces */ });
  }, [signedIn]);

  if (!signedIn) return <SignIn onDone={() => setSignedIn(true)} />;
  return (
    <>
      <ApprovalHost />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="quotes" element={<Quotes />} />
          <Route path="orders" element={<Orders />} />
          <Route path="pos" element={<Pos />} />
          <Route path="quick" element={<QuickOrder />} />
          <Route path="customers" element={<Customers />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="materials" element={<Materials />} />
          <Route path="taxonomy" element={<Taxonomy />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </>
  );
}
