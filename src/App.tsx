import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Quotes from './pages/Quotes';
import Orders from './pages/Orders';
import Pos from './pages/Pos';
import Customers from './pages/Customers';
import QuickOrder from './pages/QuickOrder';
import Inventory from './pages/Inventory';
import Materials from './pages/Materials';
import Taxonomy from './pages/Taxonomy';
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
