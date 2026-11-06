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
/**
 * Creates (no id) or saves an airline profile with the `version` on screen. An update carries the intent's
 * Idempotency-Key; the identity of an airline that already operates is fixed (`airline_identity_locked`, 1-N20).
 */
export const saveManagedAirline = (id, values, idempotencyKey) => commercialApi(id ? `/governance/airlines/${id}` : '/governance/airlines', {
  method: id ? 'PUT' : 'POST', body: JSON.stringify(values),
  ...(id && idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
});
/** Checks the airline in Wikidata (or the offline OpenFlights copy) and stores the verdict (ADR-0023). */
export const checkManagedAirlineRegistry = id => commercialApi(`/governance/airlines/${id}/registry-check`, { method: 'POST' });
export const archiveManagedAirline = (id, version) => commercialApi(`/governance/airlines/${id}?version=${encodeURIComponent(version)}`, {
  method: 'DELETE',
});
export const getMyPermissions = () => commercialApi('/governance/me/permissions');
/** Approved requests waiting for their portal account, each with the request `version` (1-N13). */
export const getProvisioning = () => contractCall(() => contractClient().listProvisioningTasks({ cache: 'no-store' }));
/**
 * Creates the airline's portal account: `{ email, temporaryPassword?, expectedVersion }`. Without a temporary
 * password the API queues an activation link instead (ADR-0022). An email that already has a portal account
 * fails with `email_has_account` when it can be linked instead.
 */
export const provisionAirline = (requestId, command, idempotencyKey) =>
  contractCall(() => contractClient().provisionAirlineAccount(requestId, command, idempotencyKey));
/** Links the existing portal account of the email to the request (`{ email, expectedVersion }`); credentials do not change. */
export const linkProvisioningAccount = (requestId, command, idempotencyKey) =>
  contractCall(() => contractClient().linkProvisioningAccount(requestId, command, idempotencyKey));
/** Queues a new activation link for the account whose `version` is on screen; the earlier ones stop working. */
export const resendAirlineInvitation = (accountId, expectedVersion, idempotencyKey) =>
  contractCall(() => contractClient().resendAirlineInvitation(accountId, { expectedVersion }, idempotencyKey));
/** Superadmin outbox (1-N22): `{ status, page, limit }`, with the reason of each email and what it is about. */
export const getEmailOutbox = query => contractCall(() => contractClient().getEmailOutbox(query, { cache: 'no-store' }));
export const getCommercialStations = () => commercialApi('/contracts/commercial-requests/stations');
export const getManagedServices = () => commercialApi('/contracts/catalog/services');
export const getPublishedCommercialServices = () => createPrivateWebApiClient()
  .getPublicCommercialCatalog({ cache: 'no-store' });
export const getServiceClosures = (status = null, page = 1) => commercialApi(
  `/service-closures?page=${page}&limit=25${status ? `&status=${encodeURIComponent(status)}` : ''}`);
export const requestServiceClosure = (requestId, serviceId, reason) => commercialApi('/service-closures', {
  method: 'POST', body: JSON.stringify({ requestId, serviceId, reason }),
});
/**
 * Contratos decides an OCC closure (1-N11), also of a hidden or retired service: `command` is
 * `{ approve, reason, version }` and travels with its Idempotency-Key.
 */
export const decideServiceClosure = (id, command, idempotencyKey) =>
  contractCall(() => contractClient().decideServiceClosure(id, command, idempotencyKey));
/** Republishes the service its approved closure hid: `{ reason, serviceVersion }`; a retired service is refused. */
export const reopenService = (serviceId, command, idempotencyKey) =>
  contractCall(() => contractClient().reopenService(serviceId, command, idempotencyKey));
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
export const createManagedService = values => commercialApi('/contracts/catalog/services', {
  method: 'POST', body: JSON.stringify(values),
});
/**
 * The edit form of a service (1-N03): hides it from the public catalog, shows it or reactivates it, with its
 * Idempotency-Key and the version on screen. It never retires a service.
 */
export const updateManagedService = (id, values, idempotencyKey) =>
  contractCall(() => contractClient().updateManagedService(id, values, idempotencyKey));
/** «Dar de baja» with a reason: `{ expectedVersion, reason }`; refused while a contract in force uses the service. */
export const retireManagedService = (id, command, idempotencyKey) =>
  contractCall(() => contractClient().retireManagedService(id, command, idempotencyKey));
export const getManagedDrafts = () => commercialApi('/contracts/drafts');
export const getManagedDraftOverview = () => commercialApi('/contracts/drafts/overview');

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

/**
 * Contratos inbox of public requests (1-N23): status filter, server search, paging and the
 * counters per status. Commands carry an Idempotency-Key and the request `version` they saw.
 */
export const getCommercialRequestInbox = query => contractCall(() => contractClient().getCommercialRequestInbox(query));
/** Verifies the airline from the request; a proposed airline is linked or gets a verified profile. */
export const verifyCommercialRequestAirline = (requestId, command, idempotencyKey) =>
  contractCall(() => contractClient().verifyCommercialRequestAirline(requestId, command, idempotencyKey));
/** Records who confirmed the representative, when and how (1-N18); approval requires it. */
export const confirmCommercialRepresentative = (requestId, command, idempotencyKey) =>
  contractCall(() => contractClient().confirmCommercialRepresentative(requestId, command, idempotencyKey));
export const cancelCommercialRequest = (requestId, command, idempotencyKey) =>
  contractCall(() => contractClient().cancelCommercialRequest(requestId, command, idempotencyKey));
/** Approves (answers with the draft contract) or rejects with a reason. */
export const decideCommercialRequest = (requestId, command, idempotencyKey) =>
  contractCall(() => contractClient().decideCommercialRequest(requestId, command, idempotencyKey));
/** Published airline profiles, to link a proposed airline to an existing one. */
export const getPublishedAirlineProfiles = () => createPrivateWebApiClient()
  .getPublicCommercialCatalog({ cache: 'no-store' }).then(catalog => catalog.airlines);

/**
 * Contract drafts (phase 1, block B). Every command carries an Idempotency-Key and the draft
 * `version` (rowversion) the user saw; a 409 means re-reading before a new attempt.
 */
/** Saves terms, validity, currency, rates and charges. */
export const updateManagedDraft = (versionId, command, idempotencyKey) =>
  contractCall(() => contractClient().updateManagedContractDraft(versionId, command, idempotencyKey));
/** «Enviar a Finanzas»: answers the draft's contract. */
export const activateManagedDraft = (versionId, command, idempotencyKey) =>
  contractCall(() => contractClient().submitManagedContractDraft(versionId, command, idempotencyKey));
/** Whether the draft can go to Finance, every blocking cause and the airline's portal account. */
export const getContractDraftReadiness = versionId =>
  contractCall(() => contractClient().getContractDraftReadiness(versionId, { cache: 'no-store' }));
/** Services and stations of the draft, and the active services that can be added. */
export const getContractDraftScope = versionId =>
  contractCall(() => contractClient().getContractDraftScope(versionId, { cache: 'no-store' }));
export const setContractDraftScope = (versionId, command, idempotencyKey) =>
  contractCall(() => contractClient().setContractDraftScope(versionId, command, idempotencyKey));
/** Discards a draft or a version awaiting Finance with a reason; nothing is deleted. */
export const discardContractDraft = (versionId, command, idempotencyKey) =>
  contractCall(() => contractClient().discardContractDraft(versionId, command, idempotencyKey));
/** Contratos answers the airline on its draft. */
export const replyContractDraft = (versionId, command, idempotencyKey) =>
  contractCall(() => contractClient().replyContractDraft(versionId, command, idempotencyKey));

/**
 * Finance (phase 1, block C): Contratos amends an active or suspended contract from «Vigente desde» with
 * the contract status on screen (1-C), and Finance discards or retires a package with a reason (1-N27).
 * Every command carries the intent's Idempotency-Key.
 */
/** Answers the new draft version, which Contratos completes in Borradores. */
export const createContractAmendment = (versionId, command, idempotencyKey) =>
  contractCall(() => contractClient().createContractAmendment(versionId, command, idempotencyKey));
export const discardFinancePackage = (packageId, command, idempotencyKey) =>
  contractCall(() => contractClient().discardFinancePackage(packageId, command, idempotencyKey));
export const retireFinancePackage = (packageId, command, idempotencyKey) =>
  contractCall(() => contractClient().retireFinancePackage(packageId, command, idempotencyKey));

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

/**
 * Contratos confirms validity, renewal and termination before signatures (ADR-0025) with the intent's
 * Idempotency-Key: a retry of the same body after an uncertain result replays the first answer.
 */
export const setContractValidity = (versionId, request, idempotencyKey) =>
  contractCall(() => contractClient().setContractValidity(versionId, request, idempotencyKey));

/**
 * Contratos withdraws an approved version both parties have not signed, with a reason and the content hash
 * on screen (2-N10). Answers the version (Rejected), its contract and, for a contract that never activated,
 * the new draft with the same content (`draftVersionId`).
 */
export const withdrawContractVersion = (versionId, command, idempotencyKey) =>
  contractCall(() => contractClient().withdrawContractVersion(versionId, command, idempotencyKey));

/** Airline permit dossier for Contratos (ADR-0024); review is Submitted, Verified or Rejected. */
export const getAirlinePermitsForContracts = (review = '') =>
  commercialApi(`/contracts/permits${review ? `?review=${encodeURIComponent(review)}` : ''}`);
export const reviewAirlinePermit = (permitId, verified, note, expectedVersion) =>
  commercialApi(`/contracts/permits/${permitId}/review`, {
    method: 'POST', body: JSON.stringify({ verified, note: note || null, expectedVersion }),
  });
/** Contract history (request, Finance, signatures, permits and status), oldest first. */
export const getContractTimeline = versionId => commercialApi(`/contract-versions/${versionId}/timeline`);
/**
 * Suspend, Reactivate, Terminate (also «Descartar contrato» for one that never activated), CancelTermination
 * or Renew (validFrom/validTo) with a reason, the status the user saw and the intent's Idempotency-Key. A
 * termination of an active or suspended contract carries `effectiveOn` (its first day without coverage) or an
 * `immediateCause` (`Breach` or `MutualAgreement`) (2-N14). The history (`getContractTimeline`) tells
 * `terminatesOn` and `earliestTerminationOn`.
 */
export const applyContractLifecycle = (versionId, values, idempotencyKey) => commercialApi(
  `/contract-versions/${versionId}/lifecycle`, {
    method: 'POST', body: JSON.stringify(values),
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });

/** Opens a private media document (permit scan, PDF or image) in a new tab with the session token. */
export async function openPrivateDocument(url) {
  const response = await fetch(commercialMediaUrl(url), { headers: { Authorization: `Bearer ${readSession()?.token ?? ''}` } });
  if (!response.ok) throw Object.assign(new Error('No se pudo abrir el documento.'), { status: response.status });
  const objectUrl = URL.createObjectURL(await response.blob());
  window.open(objectUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
