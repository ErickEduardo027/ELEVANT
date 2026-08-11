import { getRoleHomePath, ROLE_KEYS } from './roleRouting';

export const AUTH_STORAGE_KEY = 'elevant-auth-session';
export const MOCK_PASSWORD = 'Elevant2026!';

const MOCK_USERS = {
  'admin@elevant.test': {
    email: 'admin@elevant.test',
    name: 'Laisha Ramírez',
    role: ROLE_KEYS.ADMIN_OCC,
    roleLabel: 'Administrador OCC',
  },
  'gestionhumana@elevant.test': {
    email: 'gestionhumana@elevant.test',
    name: 'Camila Reyes',
    role: ROLE_KEYS.GESTION_HUMANA,
    roleLabel: 'Gestión Humana',
  },
  'contratos@elevant.test': {
    email: 'contratos@elevant.test',
    name: 'Marcos Silva',
    role: ROLE_KEYS.CONTRATOS,
    roleLabel: 'Contratos',
  },
  'finanzas@elevant.test': {
    email: 'finanzas@elevant.test',
    name: 'Elena Rojas',
    role: ROLE_KEYS.FINANZAS,
    roleLabel: 'Finanzas',
  },
};

function safeStorage(storage) {
  try {
    return storage ?? null;
  } catch {
    return null;
  }
}

function readFrom(storage) {
  const store = safeStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeTo(storage, session) {
  const store = safeStorage(storage);
  if (!store) return;
  store.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function removeFrom(storage) {
  const store = safeStorage(storage);
  if (!store) return;
  store.removeItem(AUTH_STORAGE_KEY);
}

export function getMockUsers() {
  return Object.values(MOCK_USERS).map(({ email, name, roleLabel }) => ({ email, name, roleLabel }));
}

export function readSession() {
  return readFrom(window.localStorage) ?? readFrom(window.sessionStorage);
}

export function persistSession(session, remember = false) {
  removeFrom(window.localStorage);
  removeFrom(window.sessionStorage);
  writeTo(remember ? window.localStorage : window.sessionStorage, session);
  return session;
}

export function clearSession() {
  removeFrom(window.localStorage);
  removeFrom(window.sessionStorage);
}

export async function mockLogin({ email, password, remember = false }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const user = MOCK_USERS[normalizedEmail];
  if (!user || password !== MOCK_PASSWORD) {
    throw new Error('Credenciales inválidas. Verifica el correo mock y la contraseña compartida.');
  }

  const session = {
    email: user.email,
    name: user.name,
    role: user.role,
    roleLabel: user.roleLabel,
    homePath: getRoleHomePath(user.role),
  };

  return persistSession(session, remember);
}
