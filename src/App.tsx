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
import { useState } from 'react';
import { currentUser } from './lib/session';

export default function App() {
  const [signedIn, setSignedIn] = useState(!!currentUser());
  if (!signedIn) return <SignIn onDone={() => setSignedIn(true)} />;
  return (
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
  );
}
