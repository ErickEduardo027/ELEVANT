import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { commercialApi } from './commercialGovernanceApi';

/** Department keys used by the governance API. */
export const DEPARTMENTS = {
  HUMAN_RESOURCES: 'human-resources',
  CONTRACTS: 'contracts',
  OPERATIONS: 'operations',
  FINANCE: 'finance',
};

export const DEPARTMENT_LABELS = {
  [DEPARTMENTS.HUMAN_RESOURCES]: 'Gestión Humana',
  [DEPARTMENTS.CONTRACTS]: 'Contratos',
  [DEPARTMENTS.OPERATIONS]: 'Centro de Operaciones',
  [DEPARTMENTS.FINANCE]: 'Finanzas',
};

const json = (method, body) => ({ method, body: JSON.stringify(body) });
/**
 * 2-N39: the governance commands take the intent's Idempotency-Key (optional for the API while older clients exist);
 * a retry after an uncertain answer sends the same key and body and gets the first result.
 */
const keyed = (method, body, idempotencyKey) => ({
  ...json(method, body), ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
});
const query = params => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
};
const dept = department => `/governance/departments/${encodeURIComponent(department)}`;

export const getMyDepartmentAccess = () => commercialApi('/governance/me/access');
export const getPermissionCatalog = () => commercialApi('/governance/catalog');
export const getDepartmentsOverview = () => commercialApi('/governance/departments/summary');
export const getDepartmentSummary = department => commercialApi(`${dept(department)}/summary`);

export const getDepartmentOptions = department => commercialApi(`${dept(department)}/options`);
export const listDepartmentUsers = (department, filters = {}) =>
  commercialApi(`${dept(department)}/users${query({ page: 1, limit: 25, ...filters })}`);
export const createDepartmentAdministrator = (department, values, idempotencyKey) =>
  commercialApi(`${dept(department)}/administrators`, keyed('POST', values, idempotencyKey));
/** Super administrator: employee record and account in one step, without a Human Resources request. */
export const createInternalUser = (department, values, idempotencyKey) =>
  commercialApi(`${dept(department)}/internal-users`, keyed('POST', values, idempotencyKey));
export const createDepartmentUser = (department, values) =>
  commercialApi(`${dept(department)}/users`, json('POST', values));
/**
 * Edits access with the user `version` on screen. An employee's stations come from its record
 * (`stations_outside_employee`); a transferred account belongs to its new department (`employee_transferred`).
 */
export const updateDepartmentUser = (department, id, values, idempotencyKey) =>
  commercialApi(`${dept(department)}/users/${id}`, keyed('PUT', values, idempotencyKey));
export const setDepartmentUserStatus = (department, id, isActive, expectedVersion, idempotencyKey) =>
  commercialApi(`${dept(department)}/users/${id}/status`, keyed('POST', { isActive, expectedVersion }, idempotencyKey));
export const resetDepartmentUserPassword = (department, id, temporaryPassword) =>
  commercialApi(`${dept(department)}/users/${id}/password-reset`, json('POST', { temporaryPassword }));

export const listAccessProfiles = department => commercialApi(`${dept(department)}/access-profiles`);
export const saveAccessProfile = (department, id, values, idempotencyKey) => commercialApi(
  id ? `${dept(department)}/access-profiles/${id}` : `${dept(department)}/access-profiles`,
  keyed(id ? 'PUT' : 'POST', values, idempotencyKey));
export const deactivateAccessProfile = (department, id, expectedVersion, idempotencyKey) =>
  commercialApi(`${dept(department)}/access-profiles/${id}/deactivate`, keyed('POST', { expectedVersion }, idempotencyKey));

export const requestDepartmentUserAccess = (department, values) =>
  commercialApi(`${dept(department)}/access-requests`, json('POST', values));
export const listAccessRequests = (filters = {}) =>
  commercialApi(`/governance/access-requests${query({ page: 1, limit: 25, ...filters })}`);
export const cancelAccessRequest = (id, expectedVersion) =>
  commercialApi(`/governance/access-requests/${id}/cancel`, json('POST', { expectedVersion }));
export const validateAccessRequest = (id, temporaryPassword, expectedVersion) =>
  commercialApi(`/governance/access-requests/${id}/validate`, json('POST', { temporaryPassword, expectedVersion }));
export const rejectAccessRequest = (id, reason, expectedVersion) =>
  commercialApi(`/governance/access-requests/${id}/reject`, json('POST', { reason, expectedVersion }));

export const listClientAirlines = () => commercialApi('/governance/clients');
export const listClientUsers = organizationId => commercialApi(`/governance/clients/${organizationId}/users`);
export const createClientUser = (organizationId, values, idempotencyKey) =>
  commercialApi(`/governance/clients/${organizationId}/users`, keyed('POST', values, idempotencyKey));
export const setClientUserStatus = (organizationId, id, isActive, expectedVersion, idempotencyKey) =>
  commercialApi(`/governance/clients/${organizationId}/users/${id}/status`,
    keyed('POST', { isActive, expectedVersion }, idempotencyKey));
/**
 * Designates a representative (manages the airline's portal users and signs) or a signer (signs contracts and submits
 * the JAC permit) with the account `version` on screen (2-N20). The key is required; the last active representative
 * keeps the role (`last_representative`).
 */
export const setClientUserPortalRole = (organizationId, id, values, idempotencyKey) =>
  commercialApi(`/governance/clients/${organizationId}/users/${id}/portal-role`, keyed('POST', values, idempotencyKey));
/**
 * Sets a temporary password with the user `version` on screen and the intent's Idempotency-Key. On a pending
 * invitation the API closes it: its links stop working and its queued email is discarded (1-N12).
 */
export async function resetClientUserPassword(organizationId, id, temporaryPassword, expectedVersion, idempotencyKey) {
  try {
    return await createPrivateWebApiClient({ getAccessToken: () => readSession()?.token })
      .resetClientUserPassword(organizationId, id, { temporaryPassword, expectedVersion }, idempotencyKey);
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

export const listLegacyRoles = () => commercialApi('/governance/legacy-roles');
/** Converts a legacy role with its `version` on screen; the members already edited keep their permissions (2-N19). */
export const convertLegacyRole = (id, expectedVersion, idempotencyKey) =>
  commercialApi(`/governance/legacy-roles/${id}/convert`, keyed('POST', { expectedVersion }, idempotencyKey));

/** Email deliveries of the system sender (no bodies) and whether SMTP is configured (ADR-0022). */
export const listEmailDeliveries = () => commercialApi('/governance/email/deliveries');
/** Super administrator smoke test: queues one email to check the no-reply sender. */
export const sendTestEmail = to => commercialApi('/governance/email/test', json('POST', { to }));
