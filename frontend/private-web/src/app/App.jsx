import { useCallback, useEffect, useState } from 'react';
import LoginPage from '../features/auth/LoginPage.jsx';
import { AUTH_EXPIRED_EVENT, login, logout, readSession } from '../features/auth/authService.js';
import { ROUTE_PATHS, resolveRoute } from '../features/auth/roleRouting.js';
import AppShell from '../features/shell/AppShell.jsx';
import ContractsShell from '../features/contracts/shell/ContractsShell.jsx';
import FinanceShell from '../features/finance/shell/FinanceShell.jsx';
import HumanResourcesShell from '../features/human-resources/HumanResourcesShell.jsx';

function useLocationVersion() {
  const [version, setVersion] = useState(0);

  const bumpLocationVersion = useCallback(() => {
    setVersion(current => current + 1);
  }, []);

  useEffect(() => {
    const handlePopState = () => setVersion(current => current + 1);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return [version, bumpLocationVersion];
}

function navigate(pathname, replace = false) {
  const historyMethod = replace ? 'replaceState' : 'pushState';
  window.history[historyMethod]({}, '', pathname);
}

function shellUserFromSession(session) {
  if (!session) return undefined;
  return { name: session.name, role: session.roleLabel };
}

export default function App() {
  const [session, setSession] = useState(() => readSession());
  const [, bumpLocationVersion] = useLocationVersion();
  const route = resolveRoute(window.location.pathname, session);

  useEffect(() => {
    if (route.pathname === window.location.pathname) return;
    navigate(route.pathname, true);
    bumpLocationVersion();
  }, [route.pathname, bumpLocationVersion]);

  useEffect(() => {
    const expireSession = () => {
      setSession(null);
      navigate(ROUTE_PATHS.LOGIN, true);
      bumpLocationVersion();
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, expireSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expireSession);
  }, [bumpLocationVersion]);

  async function handleLogin(credentials) {
    const nextSession = await login(credentials);
    setSession(nextSession);
    navigate(nextSession.homePath, true);
    bumpLocationVersion();
  }

  function handleLogout() {
    logout();
    setSession(null);
    navigate(ROUTE_PATHS.LOGIN, true);
    bumpLocationVersion();
  }

  if (!session || route.pathname === ROUTE_PATHS.LOGIN) {
    return <LoginPage onSubmit={handleLogin} />;
  }

  const user = shellUserFromSession(session);

  if (session.role === 'ADMIN_OCC') {
    return <AppShell user={user} onLogout={handleLogout} />;
  }

  if (session.role === 'GESTION_HUMANA') {
    return <HumanResourcesShell user={user} onLogout={handleLogout} />;
  }

  if (session.role === 'CONTRATOS') {
    return <ContractsShell user={user} onLogout={handleLogout} />;
  }

  if (session.role === 'FINANZAS') {
    return <FinanceShell user={user} onLogout={handleLogout} />;
  }

  return <LoginPage onSubmit={handleLogin} />;
}
