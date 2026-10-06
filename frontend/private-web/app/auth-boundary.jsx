'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../src/features/auth/AuthContext';
import LoginPage from '../src/features/auth/LoginPage';
import PasswordChangePage from '../src/features/auth/PasswordChangePage';
import { PasswordChangeRequiredError } from '../src/features/auth/authService';
import { getRoleHomePath, ROLE_KEYS, ROUTE_PATHS } from '../src/features/auth/roleRouting';

function SessionLoading() {
  return <main className="min-h-screen bg-surface-light p-8 text-ink-900 dark:bg-surface-dark dark:text-text-primary-dark" role="status">Comprobando sesión…</main>;
}

function useRouteHydration() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setHydrated(true);
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);
  return hydrated;
}

export function ProtectedRole({ role, children }) {
  const { session, ready, logout } = useAuth();
  const router = useRouter();
  const hydrated = useRouteHydration();
  const normalizedRole = session?.role?.startsWith('CUSTOM_') ? ROLE_KEYS.CUSTOM : session?.role;
  const allowed = normalizedRole === role;

  useEffect(() => {
    if (ready && !session) router.replace(ROUTE_PATHS.LOGIN);
    else if (ready && session && !allowed) router.replace(getRoleHomePath(session.role));
  }, [allowed, ready, router, session]);

  if (!hydrated || !ready || !session || !allowed) return <SessionLoading />;
  return children({
    user: { name: session.name, role: session.roleLabel },
    onLogout: () => {
      logout();
      router.replace(ROUTE_PATHS.LOGIN);
    },
  });
}

export function LoginRoute() {
  const { session, ready, login, changePassword } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useRouteHydration();
  const [activationEmail, setActivationEmail] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (ready && session) router.replace(getRoleHomePath(session.role));
    else if (ready && pathname !== ROUTE_PATHS.LOGIN) router.replace(ROUTE_PATHS.LOGIN);
  }, [pathname, ready, router, session]);

  if (!hydrated || !ready || session) return <SessionLoading />;
  if (activationEmail) {
    return <PasswordChangePage
      email={activationEmail}
      onCancel={() => setActivationEmail(null)}
      onSubmit={async credentials => {
        await changePassword(credentials);
        setActivationEmail(null);
        setNotice('password_updated');
      }}
    />;
  }

  return <LoginPage notice={notice} onSubmit={async credentials => {
    try {
      const nextSession = await login(credentials);
      router.replace(nextSession.homePath);
    } catch (error) {
      if (error instanceof PasswordChangeRequiredError) {
        setActivationEmail(credentials.email.trim());
        return;
      }
      throw error;
    }
  }} />;
}
