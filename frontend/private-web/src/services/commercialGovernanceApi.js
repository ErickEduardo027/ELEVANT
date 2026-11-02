import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { createPrivateWebApiClient } from '../config/elevantApiClient';

const origin = String(process.env.NEXT_PUBLIC_ELEVANT_API_URL || '').replace(/\/$/, '');

export async function commercialApi(path, options = {}) {
  if (!origin) throw new Error('No está configurado el API de ELEVANT.');
  const token = readSession()?.token;
  if (!token) throw Object.assign(new Error('La sesión expiró. Vuelva a iniciar sesión.'),
    { status: 401 });
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
    throw Object.assign(new Error(title), {
      status: response.status,
      code: typeof problem.code === 'string' ? problem.code : undefined,
    });
  }
  if (response.status === 204) return null;
  return response.json();
}

export const getGovernance = () => commercialApi('/governance');
export const getGovernanceAudit = (page = 1) => commercialApi(`/governance/audit?page=${page}&limit=25`);
export const getRampProfiles = () => commercialApi('/human-resources/ramp-profiles');
export const saveRampProfile = (id, values) => commercialApi(id ? `/human-resources/ramp-profiles/${id}` : '/human-resources/ramp-profiles', {
  method: id ? 'PUT' : 'POST', body: JSON.stringify(values),
});
export const getManagedAirlines = () => commercialApi('/governance/airlines');
export const enrichManagedAirlines = () => commercialApi('/governance/airlines/enrichment', { method: 'POST' });
export const saveManagedAirline = (id, values) => commercialApi(id ? `/governance/airlines/${id}` : '/governance/airlines', {
  method: id ? 'PUT' : 'POST', body: JSON.stringify(values),
});
/** Checks the airline in Wikidata (or the offline OpenFlights copy) and stores the verdict (ADR-0023). */
export const checkManagedAirlineRegistry = id => commercialApi(`/governance/airlines/${id}/registry-check`, { method: 'POST' });
export const archiveManagedAirline = (id, version) => commercialApi(`/governance/airlines/${id}?version=${encodeURIComponent(version)}`, {
  method: 'DELETE',
});
export const getMyPermissions = () => commercialApi('/governance/me/permissions');
export const getProvisioning = () => commercialApi('/governance/provisioning');
/** Without a temporary password the API emails an activation link instead (ADR-0022). */
export const provisionAirline = (requestId, email, temporaryPassword) => commercialApi(`/governance/provisioning/${requestId}`, {
  method: 'POST', body: JSON.stringify(temporaryPassword ? { email, temporaryPassword } : { email }),
});
export const resendAirlineInvitation = accountId => commercialApi(`/governance/provisioning/accounts/${accountId}/resend-invitation`, {
  method: 'POST',
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
export const getPublishedCommercialServices = () => createPrivateWebApiClient()
  .getPublicCommercialCatalog({ cache: 'no-store' });
export const getServiceClosures = (status = null, page = 1) => commercialApi(
  `/service-closures?page=${page}&limit=25${status ? `&status=${encodeURIComponent(status)}` : ''}`);
export const requestServiceClosure = (requestId, serviceId, reason) => commercialApi('/service-closures', {
  method: 'POST', body: JSON.stringify({ requestId, serviceId, reason }),
});
export const decideServiceClosure = (id, approve, reason, version) => commercialApi(
  `/service-closures/${id}/decision`, {
    method: 'POST', body: JSON.stringify({ approve, reason, version }),
  });
export const reopenService = (serviceId, reason, serviceVersion) => commercialApi(
  `/service-closures/services/${serviceId}/reopen`, {
    method: 'POST', body: JSON.stringify({ reason, serviceVersion }),
  });
export async function getManagedContracts(page = 1) {
  try {
    return await createPrivateWebApiClient({
      getAccessToken: () => readSession()?.token,
    }).getManagedContracts({ page, limit: 20 });
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}
export async function uploadCommercialMedia(purpose, file) {
  const token = readSession()?.token;
  if (!token || !origin) throw new Error('La sesión expiró. Vuelva a iniciar sesión.');
  const body = new FormData();
  body.append('purpose', purpose);
  body.append('file', file);
  const response = await fetch(`${origin}/api/v1/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
  });
  handleUnauthorizedResponse(response);
  if (!response.ok) throw new Error('No se pudo cargar el archivo. Verifique el formato y tamaño.');
  return response.json();
}
export const commercialMediaUrl = path => path?.startsWith('/api/v1/media/') ? `${origin}${path}` : path;
export const saveManagedService = (id, values) => commercialApi(id ? `/contracts/catalog/services/${id}` : '/contracts/catalog/services', {
  method: id ? 'PUT' : 'POST', body: JSON.stringify(values),
});
export const deleteManagedService = (id, version) => commercialApi(`/contracts/catalog/services/${id}?version=${encodeURIComponent(version)}`, {
  method: 'DELETE',
});
export const getManagedDrafts = () => commercialApi('/contracts/drafts');
export const getManagedDraftOverview = () => commercialApi('/contracts/drafts/overview');
export const updateManagedDraft = (id, values) => commercialApi(`/contracts/drafts/${id}`, {
  method: 'PUT', body: JSON.stringify(values),
});
export const activateManagedDraft = id => commercialApi(`/contracts/drafts/${id}/activate`, {
  method: 'POST',
});

function contractClient() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

async function contractCall(request) {
  try {
    return await request();
  } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/** Formal document of an approved contract version, with its signatures and content hash. */
export const getContractDocument = versionId => contractCall(() => contractClient().getContractDocument(versionId));

/** PDF of an approved version, or the watermarked review copy of a draft (`{ draft: true }`). */
export const loadContractPdf = (versionId, { draft = false } = {}) => contractCall(() => draft
  ? contractClient().downloadContractDraftPdf(versionId)
  : contractClient().downloadContractDocument(versionId));

export async function downloadContractDocument(versionId, fileName) {
  const blob = await loadContractPdf(versionId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export const signContractVersion = (versionId, request, idempotencyKey) =>
  contractCall(() => contractClient().signContractVersion(versionId, request, idempotencyKey));

/** Airline permit dossier for Contratos (ADR-0024); review is Submitted, Verified or Rejected. */
export const getAirlinePermitsForContracts = (review = '') =>
  commercialApi(`/contracts/permits${review ? `?review=${encodeURIComponent(review)}` : ''}`);
export const reviewAirlinePermit = (permitId, verified, note, expectedVersion) =>
  commercialApi(`/contracts/permits/${permitId}/review`, {
    method: 'POST', body: JSON.stringify({ verified, note: note || null, expectedVersion }),
  });
/** Contract history (request, Finance, signatures, permits and status), oldest first. */
export const getContractTimeline = versionId => commercialApi(`/contract-versions/${versionId}/timeline`);
/** Suspend, Reactivate, Terminate or Renew (validFrom/validTo) with a reason and the status the user saw. */
export const applyContractLifecycle = (versionId, values) => commercialApi(`/contract-versions/${versionId}/lifecycle`, {
  method: 'POST', body: JSON.stringify(values),
});

/** Opens a private media document (permit scan, PDF or image) in a new tab with the session token. */
export async function openPrivateDocument(url) {
  const response = await fetch(commercialMediaUrl(url), { headers: { Authorization: `Bearer ${readSession()?.token ?? ''}` } });
  if (!response.ok) throw Object.assign(new Error('No se pudo abrir el documento.'), { status: response.status });
  const objectUrl = URL.createObjectURL(await response.blob());
  window.open(objectUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
