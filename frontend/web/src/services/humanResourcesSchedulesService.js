import {
  AGENTS_MOCK,
  POSITIONS_MOCK,
  SHIFT_BLOCKS_MOCK,
  COVERAGE_REQUIREMENTS_MOCK,
  AGENT_POSITION_QUALIFICATIONS_MOCK,
  SHIFT_ASSIGNMENTS_MOCK,
  AVAILABILITY_REQUESTS_MOCK,
} from '../features/human-resources/schedules/schedulesMock';
import { CURRENT_USER_MOCK } from '../features/human-resources/mockData';

// Adaptador stub para el dominio "Horarios y disponibilidad": hoy resuelve
// contra un store en memoria (mock), mañana contra el backend real de
// planificación de personal. Los hooks/componentes que llaman a estas
// funciones NO deben cambiar cuando se conecten a HTTP real — solo el
// cuerpo de cada función cambia, igual que humanResourcesPermitsService.
//
// CONTRATO PROVISIONAL — no existe todavía OpenAPI/backend para este
// dominio. Las rutas listadas abajo son NOMBRES PROVISIONALES para dejar
// claro dónde debe conectarse cada función; no son un contrato definitivo:
//
//   getAgents                  -> GET    /api/hr/ramp-agents                              (PROVISIONAL —
//                                  mismo catálogo compartido que permits/certifications; no duplicar agentes)
//   getPositions                -> GET    /api/hr/schedules/positions                      (provisional)
//   getShiftBlocks               -> GET    /api/hr/schedules/shift-blocks                    (provisional)
//   getCoverageRequirements      -> GET    /api/hr/schedules/coverage-requirements           (provisional)
//   getQualificationSummaries    -> GET    /api/hr/qualifications?scope=position             (PROVISIONAL —
//                                  el backend real debe resolver esto contra el módulo de Habilitaciones,
//                                  no duplicar el catálogo de certificaciones aquí)
//   getShifts                   -> GET    /api/hr/schedules/shifts                          (provisional)
//   saveShift                   -> POST   /api/hr/schedules/shifts                          (provisional)
//   deleteShift                 -> DELETE /api/hr/schedules/shifts/:id                       (provisional)
//   getAvailabilityRequests      -> GET    /api/hr/schedules/availability-requests            (provisional)
//   resolveAvailabilityRequest   -> POST   /api/hr/schedules/availability-requests/:id/resolve (provisional)
//
// El futuro cliente HTTP debe vivir en src/lib (ver README de esa carpeta) y
// ser inyectado aquí sin tocar la firma pública de estas funciones. Este
// servicio solo expone y persiste el plan de turnos/solicitudes — no decide
// reglas de negocio (esas viven en mappers.js del feature, como
// validateShiftAssignment) para poder reutilizarlas en un futuro validador
// de backend sin acoplarlas al transporte.

let shiftsStore = structuredClone(SHIFT_ASSIGNMENTS_MOCK);
let requestsStore = structuredClone(AVAILABILITY_REQUESTS_MOCK);

function delay(ms = 220) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getAgents() {
  await delay(120);
  return structuredClone(AGENTS_MOCK);
}

export async function getPositions() {
  await delay(80);
  return structuredClone(POSITIONS_MOCK);
}

export async function getShiftBlocks() {
  await delay(60);
  return structuredClone(SHIFT_BLOCKS_MOCK);
}

export async function getCoverageRequirements() {
  await delay(120);
  return structuredClone(COVERAGE_REQUIREMENTS_MOCK);
}

/**
 * PROVISIONAL: relación agente/posición habilitada, acotada a las
 * posiciones de este módulo. Sustituir por una consulta al módulo de
 * Habilitaciones y certificaciones cuando exponga este cruce (ver
 * comentario de contrato arriba).
 */
export async function getQualificationSummaries() {
  await delay(120);
  return structuredClone(AGENT_POSITION_QUALIFICATIONS_MOCK);
}

/** @returns {Promise<import('../types/humanResourcesSchedules').ShiftAssignment[]>} */
export async function getShifts() {
  await delay();
  return structuredClone(shiftsStore);
}

/** @returns {Promise<import('../types/humanResourcesSchedules').AvailabilityRequest[]>} */
export async function getAvailabilityRequests() {
  await delay(150);
  return structuredClone(requestsStore);
}

/**
 * Crea o reemplaza (si `id` viene en el payload) el turno de un agente para
 * una fecha. La unicidad agente/fecha (skill.md: "un agente por posición",
 * turnos rotativos de 8 horas — no hay medios turnos) la impone este
 * servicio, no la UI.
 * @param {import('../types/humanResourcesSchedules').ShiftAssignmentPayload & {id?: string}} payload
 * @returns {Promise<import('../types/humanResourcesSchedules').ShiftAssignment>}
 */
export async function saveShift(payload) {
  await delay(320);
  const agentRecord = AGENTS_MOCK.find(item => item.agentId === payload.agentId);
  if (!agentRecord) throw new Error(`Agente no encontrado: ${payload.agentId}`);

  const existingIndex = payload.id
    ? shiftsStore.findIndex(item => item.id === payload.id)
    : shiftsStore.findIndex(item => item.agentId === payload.agentId && item.date === payload.date);

  const now = new Date().toISOString();
  const shiftBlocks = SHIFT_BLOCKS_MOCK;
  const block =
    shiftBlocks.find(item => item.startTime === payload.startTime && item.endTime === payload.endTime)?.id ?? shiftBlocks[0].id;

  const record = {
    id: existingIndex >= 0 ? shiftsStore[existingIndex].id : `sa-${payload.agentId}-${payload.date}`,
    agentId: payload.agentId,
    agentName: agentRecord.agentName,
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    block,
    terminal: payload.terminal,
    positionId: payload.positionId ?? null,
    createdAt: existingIndex >= 0 ? shiftsStore[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    shiftsStore[existingIndex] = record;
  } else {
    shiftsStore.push(record);
  }

  return structuredClone(record);
}

export async function deleteShift(shiftId) {
  await delay(220);
  shiftsStore = shiftsStore.filter(item => item.id !== shiftId);
}

/**
 * Aprueba o rechaza una solicitud de disponibilidad (skill.md
 * §"SOLICITUDES DE DISPONIBILIDAD"). Una vez resuelta, la solicitud
 * conserva quién y cuándo la resolvió — no se vuelve a poner en `pending`.
 * @param {string} requestId
 * @param {'approved'|'rejected'} status
 * @returns {Promise<import('../types/humanResourcesSchedules').AvailabilityRequest>}
 */
export async function resolveAvailabilityRequest(requestId, status) {
  await delay(280);
  const record = requestsStore.find(item => item.id === requestId);
  if (!record) throw new Error(`Solicitud no encontrada: ${requestId}`);

  record.status = status;
  record.resolvedAt = new Date().toISOString();
  record.resolvedBy = CURRENT_USER_MOCK.name;

  return structuredClone(record);
}

// Únicamente para pruebas: restablece el store en memoria a su estado
// inicial (mismo patrón que __resetPermitsStoreForTests).
export function __resetSchedulesStoreForTests() {
  shiftsStore = structuredClone(SHIFT_ASSIGNMENTS_MOCK);
  requestsStore = structuredClone(AVAILABILITY_REQUESTS_MOCK);
}
