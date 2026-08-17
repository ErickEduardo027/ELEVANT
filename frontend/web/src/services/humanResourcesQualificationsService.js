import {
  QUALIFICATIONS_MOCK,
  EQUIPMENT_CATALOG_MOCK,
  AGENTS_MOCK,
  getQualificationHistory as getMockQualificationHistory,
} from '../features/human-resources/certifications/certificationsMock';
import { mapQualifications, deriveEquipmentCoverage } from '../features/human-resources/certifications/mappers';
import { DEFAULT_CERTIFYING_ENTITY } from '../features/human-resources/certifications/statusMeta';
import { CURRENT_USER_MOCK } from '../features/human-resources/mockData';
import { handleUnauthorizedResponse, PROTOTYPE_API_URL, readSession } from '../features/auth/authService';

const USE_BACKEND = import.meta.env.MODE !== 'test';

async function apiRequest(path, options = {}) {
  const token = readSession()?.token;
  let response;
  try {
    response = await fetch(`${PROTOTYPE_API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
  } catch {
    throw new Error('No fue posible conectar con el backend del prototipo.');
  }
  const payload = await response.json().catch(() => ({}));
  handleUnauthorizedResponse(response);
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la solicitud.');
  return payload;
}

// Adaptador stub para el dominio "Habilitaciones y certificaciones": hoy
// resuelve contra un store en memoria (mock), mañana contra el backend real
// de ALC/IDAC. Los hooks/componentes que llaman a estas funciones NO deben
// cambiar cuando se conecten a HTTP real — solo el cuerpo de cada función
// cambia, igual que humanResourcesUsersService.
//
// CONTRATO PROVISIONAL — no existe todavía OpenAPI/backend para este
// dominio. Las rutas listadas abajo son NOMBRES PROVISIONALES para dejar
// claro dónde debe conectarse cada función; no son un contrato definitivo:
//
//   getQualifications        -> GET    /api/hr/qualifications                        (provisional)
//   getQualificationById     -> GET    /api/hr/qualifications/:id                    (provisional)
//   getAgentQualifications   -> GET    /api/hr/qualifications?agentId=:agentId        (provisional)
//   getEquipmentCatalog      -> GET    /api/hr/equipment-types                        (provisional)
//   getEquipmentCoverage     -> GET    /api/hr/qualifications/coverage                (provisional)
//   getAgents                -> GET    /api/hr/ramp-agents                           (PROVISIONAL — el
//                                catálogo real debe venir del módulo de Gestión de usuarios cuando
//                                exponga un listado filtrado por tipo de usuario; no duplicar agentes)
//   getQualificationHistory  -> GET    /api/hr/qualifications/:id/history            (provisional)
//   createQualification      -> POST   /api/hr/qualifications                        (provisional)
//   updateQualification      -> PATCH  /api/hr/qualifications/:id                     (provisional)
//   renewQualification       -> POST   /api/hr/qualifications/:id/renew               (provisional)
//
// El futuro cliente HTTP debe vivir en src/lib (ver README de esa carpeta)
// y ser inyectado aquí sin tocar la firma pública de estas funciones. NO
// implementar aquí ninguna validación/bloqueo de asignación operativa: este
// servicio solo expone estado, la decisión de bloquear pertenece a otro
// módulo/backend (skill.md).

let qualificationsStore = structuredClone(QUALIFICATIONS_MOCK);
let historyStore = new Map(QUALIFICATIONS_MOCK.map(record => [record.id, structuredClone(getMockQualificationHistory(record.id))]));

function delay(ms = 220) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findQualificationOrThrow(qualificationId) {
  const record = qualificationsStore.find(item => item.id === qualificationId);
  if (!record) throw new Error(`Habilitación no encontrada: ${qualificationId}`);
  return record;
}

function findAgentOrThrow(agentId) {
  const agent = AGENTS_MOCK.find(item => item.agentId === agentId);
  if (!agent) throw new Error(`Agente no encontrado: ${agentId}`);
  return agent;
}

function equipmentNameOrThrow(equipmentId) {
  const equipment = EQUIPMENT_CATALOG_MOCK.find(item => item.id === equipmentId);
  if (!equipment) throw new Error(`Tipo de equipo no encontrado: ${equipmentId}`);
  return equipment.name;
}

function nextQualificationId() {
  const maxSuffix = qualificationsStore.reduce((max, item) => {
    const suffix = Number(item.id.split('-')[1]);
    return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
  }, 0);
  return `q-${maxSuffix + 1}`;
}

function appendHistory(qualificationId, eventType, description, performedBy = CURRENT_USER_MOCK.name) {
  const events = historyStore.get(qualificationId) ?? [];
  events.push({
    id: `h-${qualificationId}-${events.length + 1}`,
    qualificationId,
    eventType,
    description,
    occurredAt: new Date().toISOString(),
    performedBy,
  });
  historyStore.set(qualificationId, events);
}

/** @returns {Promise<import('../types/humanResourcesQualifications').EquipmentType[]>} */
export async function getEquipmentCatalog() {
  if (USE_BACKEND) return apiRequest('/api/hr/equipment-types');
  await delay(120);
  return structuredClone(EQUIPMENT_CATALOG_MOCK);
}

/**
 * PROVISIONAL: catálogo mínimo de agentes de rampa para el selector del
 * formulario de registro. Sustituir por el listado filtrado del módulo de
 * Gestión de usuarios cuando exista (ver comentario de contrato arriba).
 */
export async function getAgents() {
  if (USE_BACKEND) return apiRequest('/api/hr/ramp-agents');
  await delay(120);
  return structuredClone(AGENTS_MOCK);
}

/** @returns {Promise<import('../types/humanResourcesQualifications').AgentQualification[]>} */
export async function getQualifications() {
  if (USE_BACKEND) return apiRequest('/api/hr/qualifications');
  await delay();
  return structuredClone(qualificationsStore);
}

/** @returns {Promise<import('../types/humanResourcesQualifications').AgentQualification|null>} */
export async function getQualificationById(qualificationId) {
  if (USE_BACKEND) return apiRequest(`/api/hr/qualifications/${encodeURIComponent(qualificationId)}`);
  await delay(120);
  const record = qualificationsStore.find(item => item.id === qualificationId);
  return record ? structuredClone(record) : null;
}

/** @returns {Promise<import('../types/humanResourcesQualifications').AgentQualification[]>} */
export async function getAgentQualifications(agentId) {
  if (USE_BACKEND) return apiRequest(`/api/hr/qualifications?agentId=${encodeURIComponent(agentId)}`);
  await delay(150);
  return structuredClone(qualificationsStore.filter(item => item.agentId === agentId));
}

/**
 * Simula un endpoint de agregación server-side: hoy se calcula sobre el
 * store en memoria con la misma regla de vencimiento que usan las tarjetas
 * de cobertura (ver statusMeta.js), para no duplicar el umbral en dos
 * lugares cuando exista el backend real.
 * @returns {Promise<import('../types/humanResourcesQualifications').EquipmentCoverage[]>}
 */
export async function getEquipmentCoverage() {
  if (USE_BACKEND) {
    const [records, equipment] = await Promise.all([getQualifications(), getEquipmentCatalog()]);
    return deriveEquipmentCoverage(mapQualifications(records), equipment);
  }
  await delay(200);
  const items = mapQualifications(structuredClone(qualificationsStore));
  return deriveEquipmentCoverage(items, structuredClone(EQUIPMENT_CATALOG_MOCK));
}

/** @returns {Promise<import('../types/humanResourcesQualifications').QualificationHistoryEvent[]>} */
export async function getQualificationHistory(qualificationId) {
  if (USE_BACKEND) return apiRequest(`/api/hr/qualifications/${encodeURIComponent(qualificationId)}/history`);
  await delay(150);
  return structuredClone(historyStore.get(qualificationId) ?? []);
}

/**
 * @param {import('../types/humanResourcesQualifications').CreateQualificationPayload} payload
 * @returns {Promise<import('../types/humanResourcesQualifications').AgentQualification>}
 */
export async function createQualification(payload) {
  if (USE_BACKEND) return apiRequest('/api/hr/qualifications', { method: 'POST', body: JSON.stringify(payload) });
  await delay(320);
  const agent = findAgentOrThrow(payload.agentId);
  const id = nextQualificationId();
  const now = new Date().toISOString();

  const record = {
    id,
    agentId: agent.agentId,
    agentName: agent.agentName,
    employeeNumber: agent.employeeNumber,
    terminals: agent.terminals,
    equipmentId: payload.equipmentId,
    equipmentName: equipmentNameOrThrow(payload.equipmentId),
    trainingDate: payload.trainingDate,
    obtainedAt: payload.obtainedAt,
    expiresAt: payload.expiresAt,
    certifyingEntity: payload.certifyingEntity || DEFAULT_CERTIFYING_ENTITY,
    instructor: payload.instructor,
    ...(payload.notes ? { notes: payload.notes } : {}),
    supportDocument: payload.supportDocument ?? null,
    updatedAt: now,
  };

  qualificationsStore = [record, ...qualificationsStore];
  historyStore.set(id, []);
  appendHistory(id, 'created', 'Habilitación creada');
  appendHistory(id, 'training_completed', 'Entrenamiento completado', payload.instructor);

  return structuredClone(record);
}

/**
 * @param {string} qualificationId
 * @param {import('../types/humanResourcesQualifications').UpdateQualificationPayload} payload
 * @returns {Promise<import('../types/humanResourcesQualifications').AgentQualification>}
 */
export async function updateQualification(qualificationId, payload) {
  if (USE_BACKEND) return apiRequest(`/api/hr/qualifications/${encodeURIComponent(qualificationId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  await delay(260);
  const record = findQualificationOrThrow(qualificationId);

  if (payload.trainingDate) record.trainingDate = payload.trainingDate;
  if (payload.certifyingEntity) record.certifyingEntity = payload.certifyingEntity;
  if (payload.instructor) record.instructor = payload.instructor;
  if ('notes' in payload) record.notes = payload.notes;
  if ('supportDocument' in payload) record.supportDocument = payload.supportDocument;
  record.updatedAt = new Date().toISOString();

  return structuredClone(record);
}

/**
 * Registra una renovación (skill.md §5): actualiza el ciclo vigente y
 * agrega un evento de historial — nunca borra los eventos anteriores.
 * @param {string} qualificationId
 * @param {import('../types/humanResourcesQualifications').RenewQualificationPayload} payload
 * @returns {Promise<import('../types/humanResourcesQualifications').AgentQualification>}
 */
export async function renewQualification(qualificationId, payload) {
  if (USE_BACKEND) return apiRequest(`/api/hr/qualifications/${encodeURIComponent(qualificationId)}/renew`, { method: 'POST', body: JSON.stringify(payload) });
  await delay(320);
  const record = findQualificationOrThrow(qualificationId);
  const wasExpired = new Date(record.expiresAt) < new Date();

  record.obtainedAt = payload.obtainedAt;
  record.expiresAt = payload.expiresAt;
  record.certifyingEntity = payload.certifyingEntity || record.certifyingEntity;
  record.instructor = payload.instructor;
  if ('notes' in payload) record.notes = payload.notes;
  if ('supportDocument' in payload) record.supportDocument = payload.supportDocument ?? record.supportDocument;
  record.updatedAt = new Date().toISOString();

  appendHistory(qualificationId, wasExpired ? 'revalidated' : 'renewed', `Renovación registrada — ${record.certifyingEntity}`);

  return structuredClone(record);
}

// Únicamente para pruebas: restablece el store en memoria a su estado
// inicial (mismo patrón que __resetUsersStoreForTests).
export function __resetQualificationsStoreForTests() {
  qualificationsStore = structuredClone(QUALIFICATIONS_MOCK);
  historyStore = new Map(QUALIFICATIONS_MOCK.map(record => [record.id, structuredClone(getMockQualificationHistory(record.id))]));
}
