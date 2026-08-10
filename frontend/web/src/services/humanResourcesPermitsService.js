import {
  PERMITS_MOCK,
  AGENTS_MOCK,
  getPermitHistory as getMockPermitHistory,
} from '../features/human-resources/permits/permitsMock';
import { CURRENT_USER_MOCK } from '../features/human-resources/mockData';

// Adaptador stub para el dominio "Carnets y permisos aeroportuarios": hoy
// resuelve contra un store en memoria (mock), mañana contra el backend real
// de ALC/IDAC. Los hooks/componentes que llaman a estas funciones NO deben
// cambiar cuando se conecten a HTTP real — solo el cuerpo de cada función
// cambia, igual que humanResourcesQualificationsService.
//
// CONTRATO PROVISIONAL — no existe todavía OpenAPI/backend para este
// dominio. Las rutas listadas abajo son NOMBRES PROVISIONALES para dejar
// claro dónde debe conectarse cada función; no son un contrato definitivo:
//
//   getPermits               -> GET    /api/hr/airport-permits                       (provisional)
//   getAgentPermits          -> GET    /api/hr/airport-permits?agentId=:agentId       (provisional)
//   getAgents                -> GET    /api/hr/ramp-agents                           (PROVISIONAL — el
//                                catálogo real debe venir del módulo de Gestión de usuarios cuando
//                                exponga un listado filtrado por tipo de usuario; no duplicar agentes)
//   getPermitHistory         -> GET    /api/hr/airport-permits/:id/history            (provisional)
//   renewPermit              -> POST   /api/hr/airport-permits/:id/renew              (provisional)
//
// El futuro cliente HTTP debe vivir en src/lib (ver README de esa carpeta)
// y ser inyectado aquí sin tocar la firma pública de estas funciones. Este
// servicio solo expone estado del documento — no implementa ninguna
// validación/bloqueo de acceso a rampa: esa decisión pertenece a otro
// módulo/backend (skill.md).

let permitsStore = structuredClone(PERMITS_MOCK);
let historyStore = new Map(PERMITS_MOCK.map(record => [record.id, structuredClone(getMockPermitHistory(record.id))]));

function delay(ms = 220) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findPermitOrThrow(permitId) {
  const record = permitsStore.find(item => item.id === permitId);
  if (!record) throw new Error(`Documento no encontrado: ${permitId}`);
  return record;
}

function appendHistory(permitId, documentType, eventType, description, performedBy = CURRENT_USER_MOCK.name) {
  const events = historyStore.get(permitId) ?? [];
  events.push({
    id: `h-${permitId}-${events.length + 1}`,
    permitId,
    documentType,
    eventType,
    description,
    occurredAt: new Date().toISOString(),
    performedBy,
  });
  historyStore.set(permitId, events);
}

/**
 * PROVISIONAL: catálogo mínimo de agentes de rampa para la vista "Por
 * agente". Sustituir por el listado filtrado del módulo de Gestión de
 * usuarios cuando exista (ver comentario de contrato arriba).
 */
export async function getAgents() {
  await delay(120);
  return structuredClone(AGENTS_MOCK);
}

/** @returns {Promise<import('../types/humanResourcesPermits').AirportPermitRecord[]>} */
export async function getPermits() {
  await delay();
  return structuredClone(permitsStore);
}

/** @returns {Promise<import('../types/humanResourcesPermits').AirportPermitRecord[]>} */
export async function getAgentPermits(agentId) {
  await delay(150);
  return structuredClone(permitsStore.filter(item => item.agentId === agentId));
}

/** @returns {Promise<import('../types/humanResourcesPermits').PermitHistoryEvent[]>} */
export async function getPermitHistory(permitId) {
  await delay(150);
  return structuredClone(historyStore.get(permitId) ?? []);
}

/**
 * Registra una renovación (skill.md §"RENOVACIÓN"): actualiza el ciclo
 * vigente y agrega un evento de historial — nunca borra los eventos
 * anteriores.
 * @param {string} permitId
 * @param {import('../types/humanResourcesPermits').RenewPermitPayload} payload
 * @returns {Promise<import('../types/humanResourcesPermits').AirportPermitRecord>}
 */
export async function renewPermit(permitId, payload) {
  await delay(320);
  const record = findPermitOrThrow(permitId);
  const wasExpired = new Date(record.expiresAt) < new Date();

  record.number = payload.number;
  record.issuedAt = payload.issuedAt;
  record.expiresAt = payload.expiresAt;
  if ('supportDocument' in payload) record.supportDocument = payload.supportDocument ?? record.supportDocument;
  record.updatedAt = new Date().toISOString();

  appendHistory(permitId, record.type, wasExpired ? 'revalidated' : 'renewed', `Renovación registrada — ${record.number}`);

  return structuredClone(record);
}

// Únicamente para pruebas: restablece el store en memoria a su estado
// inicial (mismo patrón que __resetQualificationsStoreForTests).
export function __resetPermitsStoreForTests() {
  permitsStore = structuredClone(PERMITS_MOCK);
  historyStore = new Map(PERMITS_MOCK.map(record => [record.id, structuredClone(getMockPermitHistory(record.id))]));
}
