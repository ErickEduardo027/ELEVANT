import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

const origin = String(import.meta.env.VITE_ELEVANT_API_URL || '').replace(/\/$/, '');

export async function commercialApi(path, options = {}) {
  if (!origin) throw new Error('No está configurado el API de ELEVANT.');
  const token = readSession()?.token;
  if (!token) throw new Error('La sesión expiró. Vuelva a iniciar sesión.');
  let response;
  try {
    response = await fetch(`${origin}/api/v1${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  } catch {
    throw new Error('No hay conexión con ELEVANT. Intente de nuevo.');
  }
  handleUnauthorizedResponse(response);
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const title = typeof problem.title === 'string' ? problem.title : 'No se pudo completar la acción.';
    throw new Error(title);
  }
  if (response.status === 204) return null;
  return response.json();
}

export const getGovernance = () => commercialApi('/governance');
export const getMyPermissions = () => commercialApi('/governance/me/permissions');
export const getProvisioning = () => commercialApi('/governance/provisioning');
export const provisionAirline = (requestId, email, temporaryPassword) => commercialApi(`/governance/provisioning/${requestId}`, {
  method: 'POST', body: JSON.stringify({ email, temporaryPassword }),
});
export const createRole = values => commercialApi('/governance/roles', {
  method: 'POST', body: JSON.stringify(values),
});
export const updateRole = (id, values) => commercialApi(`/governance/roles/${id}`, {
  method: 'PUT', body: JSON.stringify(values),
});
export const deactivateRole = id => commercialApi(`/governance/roles/${id}`, { method: 'DELETE' });
export const createUser = values => commercialApi('/governance/users', {
  method: 'POST', body: JSON.stringify(values),
});
export const updateUser = (id, values) => commercialApi(`/governance/users/${id}`, {
  method: 'PUT', body: JSON.stringify(values),
});
export const deactivateUser = id => commercialApi(`/governance/users/${id}`, { method: 'DELETE' });
export const resetUserPassword = (id, temporaryPassword) => commercialApi(`/governance/users/${id}/password-reset`, {
  method: 'POST', body: JSON.stringify({ temporaryPassword }),
});
export const getCommercialRequests = () => commercialApi('/contracts/commercial-requests');
export const getCommercialStations = () => commercialApi('/contracts/commercial-requests/stations');
export const verifyCommercialAirline = (profileId, values) => commercialApi(`/contracts/commercial-requests/airlines/${profileId}/verification`, {
  method: 'PUT', body: JSON.stringify(values),
});
export const decideCommercialRequest = (id, values) => commercialApi(`/contracts/commercial-requests/${id}/decision`, {
  method: 'POST', body: JSON.stringify(values),
});
export const getManagedServices = () => commercialApi('/contracts/catalog/services');
export const saveManagedService = (id, values) => commercialApi(id ? `/contracts/catalog/services/${id}` : '/contracts/catalog/services', {
  method: id ? 'PUT' : 'POST', body: JSON.stringify(values),
});
export const deleteManagedService = (id, version) => commercialApi(`/contracts/catalog/services/${id}?version=${encodeURIComponent(version)}`, {
  method: 'DELETE',
});
export const getManagedDrafts = () => commercialApi('/contracts/drafts');
export const updateManagedDraft = (id, values) => commercialApi(`/contracts/drafts/${id}`, {
  method: 'PUT', body: JSON.stringify(values),
});
export const activateManagedDraft = id => commercialApi(`/contracts/drafts/${id}/activate`, {
  method: 'POST',
});
