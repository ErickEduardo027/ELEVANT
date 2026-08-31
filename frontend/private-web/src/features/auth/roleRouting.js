export const ROUTE_PATHS = {
  LOGIN: '/login',
  ADMIN_OCC: '/admin-occ',
  GESTION_HUMANA: '/gestion-humana',
  CONTRATOS: '/contratos',
  FINANZAS: '/finanzas',
};

export const ROLE_KEYS = {
  ADMIN_OCC: 'ADMIN_OCC',
  GESTION_HUMANA: 'GESTION_HUMANA',
  CONTRATOS: 'CONTRATOS',
  FINANZAS: 'FINANZAS',
};

const ENTRY_REDIRECTS = {
  '/': ROUTE_PATHS.LOGIN,
  '/index.html': ROUTE_PATHS.LOGIN,
  '/dashboard.html': ROUTE_PATHS.ADMIN_OCC,
  '/contracts.html': ROUTE_PATHS.CONTRATOS,
  '/finance.html': ROUTE_PATHS.FINANZAS,
};

const ROLE_HOME_PATHS = {
  [ROLE_KEYS.ADMIN_OCC]: ROUTE_PATHS.ADMIN_OCC,
  [ROLE_KEYS.GESTION_HUMANA]: ROUTE_PATHS.GESTION_HUMANA,
  [ROLE_KEYS.CONTRATOS]: ROUTE_PATHS.CONTRATOS,
  [ROLE_KEYS.FINANZAS]: ROUTE_PATHS.FINANZAS,
};

export function normalizePathname(pathname = '/') {
  const withoutQuery = pathname.split('?')[0].split('#')[0];
  const trimmed = withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
  return ENTRY_REDIRECTS[trimmed] ?? trimmed ?? ROUTE_PATHS.LOGIN;
}

export function getRoleHomePath(role) {
  return ROLE_HOME_PATHS[role] ?? ROUTE_PATHS.LOGIN;
}

export function getRoleFromPath(pathname) {
  const normalized = normalizePathname(pathname);
  return Object.entries(ROLE_HOME_PATHS).find(([, basePath]) => normalized === basePath || normalized.startsWith(`${basePath}/`))?.[0] ?? null;
}

export function resolveRoute(pathname, session) {
  const normalized = normalizePathname(pathname);
  if (!session) {
    return { kind: 'public', pathname: ROUTE_PATHS.LOGIN, role: null };
  }

  const homePath = getRoleHomePath(session.role);
  if (normalized === ROUTE_PATHS.LOGIN) {
    return { kind: 'redirect', pathname: homePath, role: session.role };
  }

  const routeRole = getRoleFromPath(normalized);
  if (!routeRole || routeRole !== session.role) {
    return { kind: 'redirect', pathname: homePath, role: session.role };
  }

  return { kind: 'private', pathname: normalized, role: routeRole };
}
