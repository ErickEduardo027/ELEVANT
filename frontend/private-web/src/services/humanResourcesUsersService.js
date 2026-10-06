import {
  USERS_MOCK,
  ROLES_MOCK,
  AIRLINES_MOCK,
  getAccountHistory as getMockAccountHistory,
} from '../features/human-resources/users/usersMock';
import { CURRENT_USER_MOCK } from '../features/human-resources/mockData';
import { handleUnauthorizedResponse, PROTOTYPE_API_URL, readSession } from '../features/auth/authService';

const USE_BACKEND = process.env.NODE_ENV !== 'test';

async function apiRequest(path, options = {}) {
  const session = readSession();
  let response;
  try {
    response = await fetch(`${PROTOTYPE_API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('No fue posible conectar con el backend del prototipo.');
  }
  const payload = await response.json().catch(() => ({}));
  handleUnauthorizedResponse(response);
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la solicitud.');
  return payload;
}

// Adaptador stub para el dominio "Gestión de usuarios y cuentas": hoy
// resuelve contra un store en memoria (mock), mañana contra el backend
// real. Los hooks/componentes que llaman a estas funciones NO deben
// cambiar cuando se conecten a HTTP real — solo el cuerpo de cada función
// cambia (de leer/mutar el arreglo en memoria a hacer fetch/POST/PATCH).
//
// CONTRATO PROVISIONAL — no existe todavía OpenAPI/backend para este
// dominio. Las rutas listadas abajo son NOMBRES PROVISIONALES para dejar
// claro dónde debe conectarse cada función; no son un contrato definitivo:
//
//   getUsers               -> GET    /api/hr/users                        (provisional)
//   getUserById            -> GET    /api/hr/users/:id                    (provisional)
//   createUser             -> POST   /api/hr/users                        (provisional)
//   updateUser             -> PATCH  /api/hr/users/:id                    (provisional)
//   activateAccount        -> POST   /api/hr/users/:id/activate           (provisional)
//   deactivateAccount      -> POST   /api/hr/users/:id/deactivate         (provisional)
//   resendInvitation       -> POST   /api/hr/users/:id/invitations/resend (provisional)
//   resetAccess            -> POST   /api/hr/users/:id/access/reset       (provisional)
//   bulkActivateAccounts   -> POST   /api/hr/users/bulk-activate          (provisional)
//   bulkDeactivateAccounts -> POST   /api/hr/users/bulk-deactivate        (provisional)
//   getRoles               -> GET    /api/hr/roles                        (provisional)
//   getPermissionsByRole   -> GET    /api/hr/roles/:id/permissions        (provisional)
//   getUserHistory         -> GET    /api/hr/users/:id/history            (provisional)
//   getAirlines            -> GET    /api/contracts/airlines              (PROVISIONAL — el catálogo
//                                     real pertenece al módulo Contratos; sustituir por su servicio
//                                     compartido cuando exista, no duplicar aerolíneas aquí)
//
// El futuro cliente HTTP debe vivir en src/lib (ver README de esa carpeta)
// y ser inyectado aquí sin tocar la firma pública de estas funciones.
//
// SEGURIDAD: ninguna función de este archivo transporta, muestra ni
// almacena contraseñas. `createUser` únicamente puede disparar el envío de
// una invitación; el mecanismo de credenciales lo define el backend.

let usersStore = structuredClone(USERS_MOCK);
let historyStore = new Map(USERS_MOCK.map(record => [record.identity.id, structuredClone(getMockAccountHistory(record.identity.id))]));

function delay(ms = 220) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findRecordOrThrow(userId) {
  const record = usersStore.find(item => item.identity.id === userId);
  if (!record) throw new Error(`Usuario no encontrado: ${userId}`);
  return record;
}

function appendHistory(userId, action, detail) {
  const events = historyStore.get(userId) ?? [];
  events.push({
    id: `h-${userId}-${events.length + 1}-${action}`,
    action,
    actorName: CURRENT_USER_MOCK.name,
    occurredAt: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  });
  historyStore.set(userId, events);
}

function nextUserId() {
  const maxSuffix = usersStore.reduce((max, item) => {
    const suffix = Number(item.identity.id.split('-')[1]);
    return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
  }, 0);
  return `u-${maxSuffix + 1}`;
}

function roleOrThrow(roleId) {
  const role = ROLES_MOCK.find(item => item.id === roleId);
  if (!role) throw new Error(`Rol no encontrado: ${roleId}`);
  return role;
}

/** @returns {Promise<import('../types/humanResourcesUsers').UserRecord[]>} */
export async function getUsers() {
  if (USE_BACKEND) return apiRequest('/api/hr/users');
  await delay();
  return structuredClone(usersStore);
}

/** @returns {Promise<import('../types/humanResourcesUsers').UserRecord|null>} */
export async function getUserById(userId) {
  if (USE_BACKEND) {
    const users = await apiRequest('/api/hr/users');
    return users.find(item => item.identity.id === userId) ?? null;
  }
  await delay(120);
  const record = usersStore.find(item => item.identity.id === userId);
  return record ? structuredClone(record) : null;
}

/** @returns {Promise<import('../types/humanResourcesUsers').Role[]>} */
export async function getRoles() {
  if (USE_BACKEND) return apiRequest('/api/hr/roles');
  await delay(120);
  return structuredClone(ROLES_MOCK);
}

/** @returns {Promise<string[]>} */
export async function getPermissionsByRole(roleId) {
  if (USE_BACKEND) {
    const roles = await apiRequest('/api/hr/roles');
    return roles.find(item => item.id === roleId)?.permissions ?? [];
  }
  await delay(120);
  return structuredClone(roleOrThrow(roleId).permissions);
}

/**
 * PROVISIONAL: sustituir por el catálogo compartido del módulo Contratos
 * cuando exista (ver comentario de contrato arriba).
 * @returns {Promise<import('../types/humanResourcesUsers').Airline[]>}
 */
export async function getAirlines() {
  if (USE_BACKEND) return [];
  await delay(120);
  return structuredClone(AIRLINES_MOCK);
}

/** @returns {Promise<import('../types/humanResourcesUsers').AccountHistoryEvent[]>} */
export async function getUserHistory(userId) {
  if (USE_BACKEND) return apiRequest(`/api/hr/users/${encodeURIComponent(userId)}/history`);
  await delay(150);
  return structuredClone(historyStore.get(userId) ?? []);
}

/**
 * Crea identidad + cuenta + acceso. Solo admite `sendInvitation: true`: este
 * frontend nunca recibe ni transmite una contraseña.
 * @param {import('../types/humanResourcesUsers').CreateUserPayload} payload
 * @returns {Promise<import('../types/humanResourcesUsers').UserRecord>}
 */
export async function createUser(payload) {
  if (USE_BACKEND) {
    return apiRequest('/api/hr/users', { method: 'POST', body: JSON.stringify(payload) });
  }
  await delay(320);
  const id = nextUserId();
  const role = roleOrThrow(payload.access.roleId);
  const now = new Date().toISOString();

  const record = {
    identity: { id, avatarUrl: null, ...payload.identity },
    account: {
      id: `acc-${id}`,
      userId: id,
      status: 'invitation_sent',
      createdAt: now,
      lastLoginAt: null,
      invitationStatus: 'sent',
      invitationSentAt: now,
    },
    access: { portal: role.portal, roleId: role.id, roleName: role.name, permissions: role.permissions },
    userType: payload.userType,
    ...(payload.backOffice ? { backOffice: payload.backOffice } : {}),
    ...(payload.rampAgent ? { rampAgent: payload.rampAgent } : {}),
    ...(payload.airlineClient ? { airlineClient: payload.airlineClient } : {}),
  };

  usersStore = [record, ...usersStore];
  historyStore.set(id, []);
  appendHistory(id, 'account_created');
  appendHistory(id, 'invitation_sent');

  return structuredClone(record);
}

/**
 * @param {string} userId
 * @param {import('../types/humanResourcesUsers').UpdateUserPayload} payload
 * @returns {Promise<import('../types/humanResourcesUsers').UserRecord>}
 */
export async function updateUser(userId, payload) {
  if (USE_BACKEND) {
    return apiRequest(`/api/hr/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }
  await delay(280);
  const record = findRecordOrThrow(userId);
  const previousRoleName = record.access.roleName;
  const previousPortal = record.access.portal;

  if (payload.identity) record.identity = { ...record.identity, ...payload.identity };
  if (payload.backOffice) record.backOffice = { ...record.backOffice, ...payload.backOffice };
  if (payload.rampAgent) record.rampAgent = { ...record.rampAgent, ...payload.rampAgent };
  if (payload.airlineClient) record.airlineClient = { ...record.airlineClient, ...payload.airlineClient };

  if (payload.access?.roleId && payload.access.roleId !== record.access.roleId) {
    const role = roleOrThrow(payload.access.roleId);
    record.access = { portal: role.portal, roleId: role.id, roleName: role.name, permissions: role.permissions };
    if (role.name !== previousRoleName) {
      appendHistory(userId, 'role_changed', `${previousRoleName} → ${role.name}`);
    }
    if (role.portal !== previousPortal) {
      appendHistory(userId, 'portal_changed', `${previousPortal} → ${role.portal}`);
    }
  }

  return structuredClone(record);
}

export async function activateAccount(userId) {
  if (USE_BACKEND) return apiRequest(`/api/hr/users/${encodeURIComponent(userId)}/activate`, { method: 'POST', body: '{}' });
  await delay(260);
  const record = findRecordOrThrow(userId);
  const wasDisabled = record.account.status === 'disabled' || record.account.status === 'blocked';
  record.account.status = 'active';
  record.account.invitationStatus = 'accepted';
  appendHistory(userId, wasDisabled ? 'account_reactivated' : 'account_activated');
  return structuredClone(record);
}

/** @param {string} userId @param {import('../types/humanResourcesUsers').DeactivateAccountPayload} [payload] */
export async function deactivateAccount(userId, payload = {}) {
  if (USE_BACKEND) {
    return apiRequest(`/api/hr/users/${encodeURIComponent(userId)}/deactivate`, { method: 'POST', body: JSON.stringify(payload) });
  }
  await delay(260);
  const record = findRecordOrThrow(userId);
  record.account.status = 'disabled';
  appendHistory(userId, 'account_disabled', payload.reason);
  return structuredClone(record);
}

export async function resendInvitation(userId) {
  if (USE_BACKEND) return apiRequest(`/api/hr/users/${encodeURIComponent(userId)}/resend-invitation`, { method: 'POST', body: '{}' });
  await delay(260);
  const record = findRecordOrThrow(userId);
  record.account.invitationStatus = 'sent';
  record.account.invitationSentAt = new Date().toISOString();
  if (record.account.status !== 'active') record.account.status = 'invitation_sent';
  appendHistory(userId, 'invitation_sent');
  return structuredClone(record);
}

export async function resetAccess(userId) {
  if (USE_BACKEND) return apiRequest(`/api/hr/users/${encodeURIComponent(userId)}/reset-access`, { method: 'POST', body: '{}' });
  await delay(260);
  const record = findRecordOrThrow(userId);
  appendHistory(userId, 'access_reset');
  return structuredClone(record);
}

export async function bulkActivateAccounts(userIds) {
  const results = [];
  for (const userId of userIds) {
    results.push(await activateAccount(userId));
  }
  return results;
}

export async function bulkDeactivateAccounts(userIds, payload = {}) {
  const results = [];
  for (const userId of userIds) {
    results.push(await deactivateAccount(userId, payload));
  }
  return results;
}

// Únicamente para pruebas: restablece el store en memoria a su estado
// inicial (mismo patrón que __resetReviewStoreForTests en feat/adminocc).
export function __resetUsersStoreForTests() {
  usersStore = structuredClone(USERS_MOCK);
  historyStore = new Map(USERS_MOCK.map(record => [record.identity.id, structuredClone(getMockAccountHistory(record.identity.id))]));
}
