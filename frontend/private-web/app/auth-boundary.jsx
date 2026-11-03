'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../src/features/auth/AuthContext';
import LoginPage from '../src/features/auth/LoginPage';
import PasswordChangePage from '../src/features/auth/PasswordChangePage';
import { PasswordChangeRequiredError } from '../src/features/auth/authService';
import { getRoleHomePath, normalizeRole, ROUTE_PATHS } from '../src/features/auth/roleRouting';
import { useLogoutConfirmation } from '../src/features/auth/useLogoutConfirmation';
import LogoutConfirmation from '../src/features/auth/LogoutConfirmation';
import { getLanguage, subscribeLanguage } from '../src/i18n/languageStore';
import { useWebPresence } from '../src/features/chat/useWebPresence';

function SessionLoading() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'es');
  return <main className="min-h-screen bg-surface-light p-8 text-ink-900 dark:bg-surface-dark dark:text-text-primary-dark" role="status">{language === 'en' ? 'Checking session…' : 'Comprobando sesión…'}</main>;
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
  const normalizedRole = normalizeRole(session?.role);
  const allowed = normalizedRole === role;
  useWebPresence(session, ready && allowed);
  const confirmation = useLogoutConfirmation(session, logout);

  useEffect(() => {
    if (ready && !session) router.replace(ROUTE_PATHS.LOGIN);
    else if (ready && session && !allowed) router.replace(getRoleHomePath(session.role));
  }, [allowed, ready, router, session]);

  if (!hydrated || !ready || !session || !allowed) return <SessionLoading />;
  return <>{children({
    user: { name: session.name, role: session.roleLabel },
    onLogout: confirmation.request,
  })}<LogoutConfirmation {...confirmation} /></>;
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
      await login(credentials);
    } catch (error) {
      if (error instanceof PasswordChangeRequiredError) {
        setActivationEmail(credentials.email.trim());
        return;
      }
      throw error;
    }
  }} />;
}
