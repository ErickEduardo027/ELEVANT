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
export const createDepartmentAdministrator = (department, values) =>
  commercialApi(`${dept(department)}/administrators`, json('POST', values));
/** Super administrator: employee record and account in one step, without a Human Resources request. */
export const createInternalUser = (department, values) =>
  commercialApi(`${dept(department)}/internal-users`, json('POST', values));
export const createDepartmentUser = (department, values) =>
  commercialApi(`${dept(department)}/users`, json('POST', values));
export const updateDepartmentUser = (department, id, values) =>
  commercialApi(`${dept(department)}/users/${id}`, json('PUT', values));
export const setDepartmentUserStatus = (department, id, isActive, expectedVersion) =>
  commercialApi(`${dept(department)}/users/${id}/status`, json('POST', { isActive, expectedVersion }));
export const resetDepartmentUserPassword = (department, id, temporaryPassword) =>
  commercialApi(`${dept(department)}/users/${id}/password-reset`, json('POST', { temporaryPassword }));

export const listAccessProfiles = department => commercialApi(`${dept(department)}/access-profiles`);
export const saveAccessProfile = (department, id, values) => commercialApi(
  id ? `${dept(department)}/access-profiles/${id}` : `${dept(department)}/access-profiles`,
  json(id ? 'PUT' : 'POST', values));
export const deactivateAccessProfile = (department, id, expectedVersion) =>
  commercialApi(`${dept(department)}/access-profiles/${id}/deactivate`, json('POST', { expectedVersion }));

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
export const createClientUser = (organizationId, values) =>
  commercialApi(`/governance/clients/${organizationId}/users`, json('POST', values));
export const setClientUserStatus = (organizationId, id, isActive, expectedVersion) =>
  commercialApi(`/governance/clients/${organizationId}/users/${id}/status`, json('POST', { isActive, expectedVersion }));
export const resetClientUserPassword = (organizationId, id, temporaryPassword) =>
  commercialApi(`/governance/clients/${organizationId}/users/${id}/password-reset`, json('POST', { temporaryPassword }));

export const listLegacyRoles = () => commercialApi('/governance/legacy-roles');
export const convertLegacyRole = id => commercialApi(`/governance/legacy-roles/${id}/convert`, { method: 'POST' });
