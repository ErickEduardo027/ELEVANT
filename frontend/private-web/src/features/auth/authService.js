import { ElevantApiError } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../../config/elevantApiClient';
import { getRoleHomePath, ROLE_KEYS } from './roleRouting';

export const AUTH_STORAGE_KEY = 'elevant-auth-session';
export const AUTH_EXPIRED_EVENT = 'elevant-auth-expired';
export const MOCK_PASSWORD = 'Elevant2026!';
export const PROTOTYPE_API_URL = String(
  import.meta.env.VITE_PROTOTYPE_API_URL || 'http://localhost:4310'
).replace(/\/$/, '');

const SUPPORTED_BACK_OFFICE_ROLES = new Set(Object.values(ROLE_KEYS));
const MOCK_SESSION_LIFETIME_MS = 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const GENERIC_AUTH_ERROR = 'No fue posible completar la autenticación.';
let sessionExpirationTimer = null;

export class PasswordChangeRequiredError extends Error {
  constructor() {
    super('Debes cambiar tu contraseña temporal para continuar.');
    this.name = 'PasswordChangeRequiredError';
  }
}

const MOCK_USERS = import.meta.env.MODE === 'test'
  ? {
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
    }
  : {};

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
  try {
    store.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Authentication still succeeds when browser storage is unavailable.
  }
}

function removeFrom(storage) {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // There is no local state to recover when browser storage is unavailable.
  }
}

function cancelSessionExpiration() {
  if (sessionExpirationTimer === null) return;
  globalThis.clearTimeout(sessionExpirationTimer);
  sessionExpirationTimer = null;
}

function expireActiveSession() {
  clearSession();
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

function scheduleSessionExpiration(session) {
  cancelSessionExpiration();
  const expiresAt = Date.parse(session?.expiresAt);
  if (!Number.isFinite(expiresAt)) return;

  const scheduleNextCheck = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      expireActiveSession();
      return;
    }

    sessionExpirationTimer = globalThis.setTimeout(() => {
      sessionExpirationTimer = null;
      scheduleNextCheck();
    }, Math.min(remaining, MAX_TIMEOUT_MS));
  };

  scheduleNextCheck();
}

function isFreshSupportedSession(session) {
  if (!session || typeof session !== 'object') return false;
  if (typeof session.token !== 'string' || !session.token) return false;
  if (typeof session.email !== 'string' || !session.email) return false;
  if (typeof session.name !== 'string' || !session.name) return false;
  if (!SUPPORTED_BACK_OFFICE_ROLES.has(session.role) && !session.role?.startsWith('CUSTOM_')) return false;

  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function readFreshFrom(storage) {
  const session = readFrom(storage);
  if (!session) return null;
  if (!isFreshSupportedSession(session)) {
    removeFrom(storage);
    return null;
  }
  return {
    ...session,
    homePath: getRoleHomePath(session.role),
  };
}

function mapApiSession(response) {
  const roles = Array.isArray(response?.actor?.roles) ? response.actor.roles : [];
  const role = roles.find(candidate =>
    candidate?.portal === 'back_office' &&
    (SUPPORTED_BACK_OFFICE_ROLES.has(candidate.code) || candidate.code?.startsWith('CUSTOM_'))
  );

  if (!role) {
    throw new Error('Esta cuenta no tiene acceso a AVIAM Web.');
  }

  return {
    token: response.accessToken,
    expiresAt: response.expiresAt,
    accountId: response.actor.accountId,
    email: response.actor.email,
    name: response.actor.displayName,
    role: role.code,
    roleLabel: role.name,
    homePath: getRoleHomePath(role.code),
    memberships: Array.isArray(response.actor.memberships) ? response.actor.memberships : [],
    stationScopes: Array.isArray(response.actor.stationScopes) ? response.actor.stationScopes : [],
  };
}

function createMockSession(email, password) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const testUser = MOCK_USERS[normalizedEmail];
  if (!testUser || password !== MOCK_PASSWORD) {
    throw new Error('Credenciales inválidas.');
  }

  return {
    token: 'test-session-token',
    expiresAt: new Date(Date.now() + MOCK_SESSION_LIFETIME_MS).toISOString(),
    accountId: `test-${testUser.role.toLowerCase()}`,
    email: testUser.email,
    name: testUser.name,
    role: testUser.role,
    roleLabel: testUser.roleLabel,
    homePath: getRoleHomePath(testUser.role),
    memberships: [],
    stationScopes: [],
  };
}

export function getMockUsers() {
  return Object.values(MOCK_USERS).map(({ email, name, roleLabel }) => ({ email, name, roleLabel }));
}

export function readSession() {
  const session = readFreshFrom(window.localStorage) ?? readFreshFrom(window.sessionStorage);
  if (session) scheduleSessionExpiration(session);
  else cancelSessionExpiration();
  return session;
}

export function persistSession(session, remember = false) {
  removeFrom(window.localStorage);
  removeFrom(window.sessionStorage);
  writeTo(remember ? window.localStorage : window.sessionStorage, session);
  scheduleSessionExpiration(session);
  return session;
}

export function clearSession() {
  cancelSessionExpiration();
  removeFrom(window.localStorage);
  removeFrom(window.sessionStorage);
}

export function handleUnauthorizedResponse(response) {
  if (response?.status !== 401) return false;
  clearSession();
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  return true;
}

export function logout() {
  clearSession();
}

export async function login({ email, password, remember = false }, injectedApiClient = null) {
  if (import.meta.env.MODE === 'test' && !injectedApiClient) {
    return persistSession(createMockSession(email, password), remember);
  }

  try {
    const apiClient = injectedApiClient ?? createPrivateWebApiClient();
    const response = await apiClient.createSession({
      email: String(email ?? '').trim(),
      password: String(password ?? ''),
    });
    const session = mapApiSession(response);

    if (!isFreshSupportedSession(session)) {
      clearSession();
      throw new Error(GENERIC_AUTH_ERROR);
    }

    return persistSession(session, remember);
  } catch (error) {
    clearSession();
    if (error instanceof ElevantApiError && error.status === 401) {
      throw new Error('Credenciales inválidas.');
    }
    if (error instanceof ElevantApiError && error.status === 409) {
      throw new PasswordChangeRequiredError();
    }
    if (error instanceof Error && error.message === 'Esta cuenta no tiene acceso a AVIAM Web.') {
      throw error;
    }
    throw new Error(GENERIC_AUTH_ERROR);
  }
}

export async function changePassword({ email, currentPassword, newPassword }, injectedApiClient = null) {
  try {
    const client = injectedApiClient ?? createPrivateWebApiClient();
    await client.changePassword({ email: String(email ?? '').trim(), currentPassword, newPassword });
  } catch (error) {
    if (error instanceof ElevantApiError && error.status === 401) {
      throw new Error('La contraseña actual no es válida.');
    }
    if (error instanceof ElevantApiError && error.status === 400) {
      throw new Error('La nueva contraseña no cumple la política: mínimo 14 caracteres, mayúscula, minúscula, número y símbolo.');
    }
    throw new Error(GENERIC_AUTH_ERROR);
  }
}
