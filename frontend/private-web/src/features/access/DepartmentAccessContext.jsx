'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getMyDepartmentAccess } from '../../services/departmentGovernanceService';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';

const DepartmentAccessContext = createContext(null);

/** Resources whose change can alter what the signed-in account may do. */
const ACCESS_RESOURCES = ['department_users', 'access_requests'];

export function buildAccess(data) {
  const permissions = new Set(data?.permissions ?? []);
  return {
    kind: data?.kind ?? null,
    department: data?.department ?? null,
    permissions,
    stations: data?.stations ?? [],
    isSuperAdministrator: data?.kind === 'SuperAdministrator',
    isAdministrator: data?.kind === 'Administrator',
    canManageDepartmentUsers: Boolean(data?.canManageDepartmentUsers),
    canValidateAccessRequests: Boolean(data?.canValidateAccessRequests),
    can: code => permissions.has(code),
  };
}

/**
 * Loads the server-resolved department access once per session. The server
 * remains the authority: this only decides which modules and actions to show.
 */
export function DepartmentAccessProvider({ children, load = getMyDepartmentAccess, observe = true, initialAccess = null }) {
  const [state, setState] = useState(() => (initialAccess
    ? { status: 'ready', access: buildAccess(initialAccess), error: '' }
    : { status: 'loading', access: null, error: '' }));
  const refresh = useCallback(async () => {
    try {
      const data = await load();
      setState({ status: 'ready', access: buildAccess(data), error: '' });
    } catch (error) {
      setState(current => current.access
        ? current
        : { status: 'error', access: null, error: error?.message ?? 'No se pudieron cargar los permisos.' });
    }
  }, [load]);

  useEffect(() => { if (!initialAccess) void refresh(); }, [initialAccess, refresh]);

  useEffect(() => {
    if (!observe || process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => ACCESS_RESOURCES.includes(resource))) void refresh();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [observe, refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [refresh, state]);
  return <DepartmentAccessContext.Provider value={value}>{children}</DepartmentAccessContext.Provider>;
}

/** Access when a provider is present; null in isolated pages and tests. */
export function useOptionalDepartmentAccess() {
  return useContext(DepartmentAccessContext)?.access ?? null;
}

export function useDepartmentAccess() {
  const context = useContext(DepartmentAccessContext);
  if (!context) throw new Error('useDepartmentAccess must be used inside DepartmentAccessProvider');
  return context;
}

/** Keeps the navigation items whose `permission` the account holds; items without one are always shown. */
export function allowedNavigation(items, access) {
  if (!access) return [];
  return items.filter(item =>
    (!item.permission || access.can(item.permission)) &&
    (!item.administratorsOnly || access.canManageDepartmentUsers) &&
    (!item.validatorsOnly || access.canValidateAccessRequests));
}

export function AccessGate({ children }) {
  const { status, error, refresh } = useDepartmentAccess();
  if (status === 'loading') {
    return <main className="min-h-screen bg-surface-light p-8 text-ink-900 dark:bg-surface-dark dark:text-text-primary-dark" role="status">Cargando permisos…</main>;
  }
  if (status === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-light p-6 dark:bg-surface-dark">
        <div role="alert" className="max-w-md rounded-2xl border border-status-danger/30 bg-white p-6 text-sm text-ink-900 dark:bg-surface-dark-card dark:text-text-primary-dark">
          <p className="font-semibold">No se pudieron cargar sus permisos.</p>
          <p className="mt-1 text-text-secondary-light dark:text-text-secondary-dark">{error}</p>
          <button type="button" onClick={() => void refresh()} className="mt-4 rounded-lg bg-accent-600 px-3 py-2 font-medium text-white">Reintentar</button>
        </div>
      </main>
    );
  }
  return children;
}

/** Administrator access over every module of a department, for tests and previews. */
export function administratorAccess(department, permissions) {
  return { kind: 'Administrator', department, permissions, stations: [], canManageDepartmentUsers: true,
    canValidateAccessRequests: false };
}
