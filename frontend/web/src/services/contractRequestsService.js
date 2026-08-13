import { PROTOTYPE_API_URL, readSession } from '../features/auth/authService';

const INITIAL_REQUESTS = [
  { id: 'SOL-108', airline: 'Sky High', contactName: 'María Santos', contactEmail: 'operaciones@skyhigh.do', type: 'additionalService', requestedService: 'GPU para vuelo DO401 del 12 de agosto', receivedAt: '2026-08-09T09:35:00-04:00', status: 'pending', decisionNote: '', notifiedAt: null },
  { id: 'SOL-107', airline: 'Air Century', contactName: 'Carlos Méndez', contactEmail: 'comercial@aircentury.com', type: 'affiliation', requestedService: 'Afiliación como nuevo cliente para operaciones regulares', receivedAt: '2026-08-08T15:10:00-04:00', status: 'inReview', decisionNote: '', notifiedAt: null },
  { id: 'SOL-105', airline: 'Arajet', contactName: 'Laura Pérez', contactEmail: 'rampa@arajet.com', type: 'additionalService', requestedService: 'Servicio adicional de aire acondicionado para DM610', receivedAt: '2026-08-08T11:20:00-04:00', status: 'pending', decisionNote: '', notifiedAt: null },
  { id: 'SOL-102', airline: 'World2Fly', contactName: 'Ana Ruiz', contactEmail: 'station.puj@world2fly.es', type: 'additionalService', requestedService: 'Ampliación temporal del servicio de limpieza', receivedAt: '2026-08-05T10:15:00-04:00', status: 'approved', decisionNote: 'Servicio disponible para el período solicitado.', notifiedAt: '2026-08-06T08:20:00-04:00' },
  { id: 'SOL-099', airline: 'Caribbean Wings', contactName: 'José Lara', contactEmail: 'info@caribbeanwings.example', type: 'affiliation', requestedService: 'Solicitud de afiliación para vuelos chárter', receivedAt: '2026-08-01T14:40:00-04:00', status: 'rejected', decisionNote: 'Información legal incompleta; puede remitir una nueva solicitud.', notifiedAt: '2026-08-04T09:05:00-04:00' },
];

let requests = INITIAL_REQUESTS.map(request => ({ ...request }));

export async function getContractRequests() {
  if (import.meta.env.MODE !== 'test') return apiRequest('/api/contracts/requests');
  return requests.map(request => ({ ...request }));
}

export async function markRequestInReview(requestId) {
  if (import.meta.env.MODE !== 'test') return apiRequest(`/api/contracts/requests/${requestId}/review`, { method: 'POST' });
  return updateRequest(requestId, { status: 'inReview' });
}

export async function resolveContractRequest(requestId, { status, decisionNote }) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('La decisión seleccionada no es válida.');
  if (!decisionNote.trim()) throw new Error('Debe registrar una observación para atender la solicitud.');
  if (import.meta.env.MODE !== 'test') return apiRequest(`/api/contracts/requests/${requestId}/resolve`, {
    method: 'POST', body: JSON.stringify({ status, decisionNote }),
  });
  return updateRequest(requestId, {
    status,
    decisionNote: decisionNote.trim(),
    notifiedAt: new Date().toISOString(),
  });
}

async function apiRequest(path, options = {}) {
  const token = readSession()?.token;
  let response;
  try {
    response = await fetch(`${PROTOTYPE_API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
    });
  } catch {
    throw new Error('No fue posible conectar con el backend del prototipo.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la solicitud.');
  return payload;
}

function updateRequest(requestId, changes) {
  let updated = null;
  requests = requests.map(request => {
    if (request.id !== requestId) return request;
    updated = { ...request, ...changes };
    return updated;
  });
  if (!updated) throw new Error('La solicitud no existe.');
  return Promise.resolve({ ...updated });
}

export function __resetContractRequestsStoreForTests() {
  requests = INITIAL_REQUESTS.map(request => ({ ...request }));
}
