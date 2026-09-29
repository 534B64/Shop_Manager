import { useEffect, useState } from 'react';
import { useRoutes } from 'react-router-dom';
import AppShell from './components/shell/AppShell';
import SignIn from './components/SignIn';
import ApprovalHost from './components/ApprovalDialog';
import StaleServerBanner from './components/StaleServerBanner';
import { ROUTES } from './routes';
import { get, getToken, setUnauthorizedHandler } from './lib/api';
import { sessionUser, updateSessionUser, clearSession, type SessionUser } from './lib/session';

function AppRoutes() {
  return useRoutes([{ element: <AppShell />, children: ROUTES }]);
}

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

  if (!signedIn) return <><StaleServerBanner /><SignIn onDone={() => setSignedIn(true)} /></>;
  return (
    <>
      <StaleServerBanner />
      <ApprovalHost />
      <AppRoutes />
    </>
  );
}
