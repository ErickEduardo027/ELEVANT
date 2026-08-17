// Datos mock del dominio "Horarios y disponibilidad", consumidos
// EXCLUSIVAMENTE a través de humanResourcesSchedulesService (ver ese archivo
// para el detalle de qué endpoint provisional sustituye a cada función).
// Ningún componente debe importar este archivo directamente — mismo
// contrato que permitsMock.js/certificationsMock.js.
//
// Los agentes reutilizan intencionalmente los mismos `agentId`/`agentName`
// que certificationsMock.js/permitsMock.js (mismo catálogo de agentes de
// rampa; no se inventa un espacio de identificadores nuevo). El catálogo de
// posiciones reutiliza el mismo vocabulario que EQUIPMENT_CATALOG_MOCK
// (certifications) porque operar una posición de rampa es, en la práctica,
// operar el equipo asociado — así la validación de habilitación por
// posición tiene un correlato real.
//
// Semana de referencia ("hoy" = 2026-08-10, un lunes): la semana actual
// (08-10 a 08-16) queda deliberadamente con déficit de cobertura —
// especialmente de madrugada en Terminal B — para poder mostrar los estados
// "en riesgo"/"crítica" sin inventar datos. La semana anterior (08-03 a
// 08-09) queda con cobertura casi completa; la semana siguiente (08-17 a
// 08-23) queda prácticamente sin turnos, para poder ver ese estado sin más
// que navegar con "Semana siguiente".

export const AGENTS_MOCK = [
  { agentId: 'u-11', agentName: 'Kevin Alexander Díaz', employeeNumber: 'RA-1042', terminals: ['A'] },
  { agentId: 'u-12', agentName: 'Rosa Elena Guzmán', employeeNumber: 'RA-1077', terminals: ['B'] },
  { agentId: 'u-13', agentName: 'Franklin Ortiz', employeeNumber: 'RA-1103', terminals: ['A', 'B'] },
  { agentId: 'u-14', agentName: 'Yeimy Santana', employeeNumber: 'RA-0991', terminals: ['A'] },
  { agentId: 'u-18', agentName: 'María López', employeeNumber: 'RA-1150', terminals: ['B'] },
  { agentId: 'u-19', agentName: 'Luis Tavárez', employeeNumber: 'RA-1162', terminals: ['A'] },
  { agentId: 'u-20', agentName: 'Juan Pérez', employeeNumber: 'RA-1178', terminals: ['A'] },
  { agentId: 'u-21', agentName: 'Ana Fermín', employeeNumber: 'RA-1183', terminals: ['B'] },
  { agentId: 'u-22', agentName: 'Carlos Núñez', employeeNumber: 'RA-1197', terminals: ['A'] },
  { agentId: 'u-23', agentName: 'Katherine Objío', employeeNumber: 'RA-1204', terminals: ['B'] },
];

// Los tres bloques del modelo rotativo de 8 horas (skill.md §OBJETIVO). El
// bloque `night` es el que alimenta el KPI "agentes en turno de madrugada".
export const SHIFT_BLOCKS_MOCK = [
  { id: 'morning', label: 'Mañana', startTime: '06:00', endTime: '14:00' },
  { id: 'afternoon', label: 'Tarde', startTime: '14:00', endTime: '22:00' },
  { id: 'night', label: 'Madrugada', startTime: '22:00', endTime: '06:00' },
];

export const POSITIONS_MOCK = [
  { id: 'gpu', name: 'GPU (unidad de poder en tierra)', requiresQualification: true },
  { id: 'pushback_tractor', name: 'Tractor / Pushback', requiresQualification: true },
  { id: 'belt_loader', name: 'Cinta transportadora / Belt Loader', requiresQualification: true },
  { id: 'bridge', name: 'Puente de abordaje', requiresQualification: true },
  { id: 'baggage_cart', name: 'Manejo de equipaje / Baggage Cart', requiresQualification: true },
  { id: 'marshalling', name: 'Señalización en plataforma', requiresQualification: false },
];

// Habilitación vigente por agente/posición — copia local acotada a las
// posiciones de este módulo, mismo criterio que
// certificationsMock.js#QUALIFICATIONS_MOCK (vigencia derivada de
// `expiresAt`, no de un campo de estado almacenado). Un agente sin entrada
// aquí para una posición no está habilitado.
function qualification(agentId, positionId, expiresAt) {
  return { agentId, positionId, expiresAt };
}

export const AGENT_POSITION_QUALIFICATIONS_MOCK = [
  qualification('u-11', 'gpu', '2027-01-15T00:00:00-04:00'),
  qualification('u-11', 'belt_loader', '2027-02-01T00:00:00-04:00'),
  qualification('u-12', 'belt_loader', '2027-03-01T00:00:00-04:00'),
  qualification('u-13', 'pushback_tractor', '2027-01-10T00:00:00-04:00'),
  qualification('u-13', 'baggage_cart', '2026-08-25T00:00:00-04:00'),
  qualification('u-14', 'gpu', '2026-07-01T00:00:00-04:00'),
  qualification('u-18', 'belt_loader', '2027-04-01T00:00:00-04:00'),
  qualification('u-19', 'gpu', '2027-02-20T00:00:00-04:00'),
  qualification('u-20', 'bridge', '2027-03-15T00:00:00-04:00'),
  qualification('u-20', 'pushback_tractor', '2027-05-01T00:00:00-04:00'),
  qualification('u-21', 'bridge', '2026-08-20T00:00:00-04:00'),
  qualification('u-22', 'baggage_cart', '2027-01-01T00:00:00-04:00'),
  qualification('u-23', 'gpu', '2027-06-01T00:00:00-04:00'),
  qualification('u-23', 'belt_loader', '2027-06-01T00:00:00-04:00'),
];

// Cuántos agentes se requieren por posición/terminal/bloque (skill.md
// §CONTEXTO OPERATIVO: "la demanda cambia durante el día... debe analizarse
// por franja horaria y terminal"). Terminal B queda deliberadamente con
// menos requisitos de madrugada — es el escenario que el skill pide poder
// detectar ("pocas franjas donde pocos agentes cubren ambas terminales").
function requirement(positionId, terminal, block, requiredCount) {
  return { positionId, terminal, block, requiredCount };
}

export const COVERAGE_REQUIREMENTS_MOCK = [
  requirement('gpu', 'A', 'morning', 1),
  requirement('pushback_tractor', 'A', 'morning', 1),
  requirement('belt_loader', 'A', 'morning', 1),
  requirement('bridge', 'A', 'morning', 1),
  requirement('baggage_cart', 'A', 'morning', 1),
  requirement('marshalling', 'A', 'morning', 1),
  requirement('gpu', 'A', 'afternoon', 1),
  requirement('pushback_tractor', 'A', 'afternoon', 1),
  requirement('belt_loader', 'A', 'afternoon', 1),
  requirement('bridge', 'A', 'afternoon', 1),
  requirement('gpu', 'A', 'night', 1),
  requirement('marshalling', 'A', 'night', 1),

  requirement('belt_loader', 'B', 'morning', 1),
  requirement('bridge', 'B', 'morning', 1),
  requirement('gpu', 'B', 'morning', 1),
  requirement('marshalling', 'B', 'morning', 1),
  requirement('belt_loader', 'B', 'afternoon', 1),
  requirement('gpu', 'B', 'afternoon', 1),
  requirement('gpu', 'B', 'night', 1),
];

function shift({ agentId, date, block, terminal, positionId }) {
  const shiftBlock = SHIFT_BLOCKS_MOCK.find(item => item.id === block);
  const agentRecord = AGENTS_MOCK.find(item => item.agentId === agentId);
  return {
    id: `sa-${agentId}-${date}`,
    agentId,
    agentName: agentRecord.agentName,
    date,
    startTime: shiftBlock.startTime,
    endTime: shiftBlock.endTime,
    block,
    terminal,
    positionId,
    createdAt: '2026-08-01T09:00:00-04:00',
    updatedAt: '2026-08-01T09:00:00-04:00',
  };
}

// Semana anterior (2026-08-03 a 2026-08-09) — cobertura casi completa en
// ambos terminales y los tres bloques.
const PREVIOUS_WEEK_SHIFTS = [
  shift({ agentId: 'u-11', date: '2026-08-03', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-19', date: '2026-08-03', block: 'morning', terminal: 'A', positionId: 'pushback_tractor' }),
  shift({ agentId: 'u-14', date: '2026-08-03', block: 'morning', terminal: 'A', positionId: 'belt_loader' }),
  shift({ agentId: 'u-20', date: '2026-08-03', block: 'morning', terminal: 'A', positionId: 'bridge' }),
  shift({ agentId: 'u-22', date: '2026-08-03', block: 'morning', terminal: 'A', positionId: 'baggage_cart' }),
  shift({ agentId: 'u-13', date: '2026-08-03', block: 'morning', terminal: 'B', positionId: 'belt_loader' }),
  shift({ agentId: 'u-21', date: '2026-08-03', block: 'morning', terminal: 'B', positionId: 'bridge' }),
  shift({ agentId: 'u-23', date: '2026-08-03', block: 'morning', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-12', date: '2026-08-03', block: 'afternoon', terminal: 'B', positionId: 'belt_loader' }),
  shift({ agentId: 'u-18', date: '2026-08-03', block: 'afternoon', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-11', date: '2026-08-03', block: 'night', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-23', date: '2026-08-03', block: 'night', terminal: 'B', positionId: 'gpu' }),

  shift({ agentId: 'u-19', date: '2026-08-04', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-20', date: '2026-08-04', block: 'morning', terminal: 'A', positionId: 'pushback_tractor' }),
  shift({ agentId: 'u-11', date: '2026-08-04', block: 'morning', terminal: 'A', positionId: 'belt_loader' }),
  shift({ agentId: 'u-13', date: '2026-08-04', block: 'morning', terminal: 'A', positionId: 'bridge' }),
  shift({ agentId: 'u-22', date: '2026-08-04', block: 'morning', terminal: 'A', positionId: 'baggage_cart' }),
  shift({ agentId: 'u-21', date: '2026-08-04', block: 'morning', terminal: 'B', positionId: 'belt_loader' }),
  shift({ agentId: 'u-23', date: '2026-08-04', block: 'morning', terminal: 'B', positionId: 'bridge' }),
  shift({ agentId: 'u-12', date: '2026-08-04', block: 'morning', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-14', date: '2026-08-04', block: 'afternoon', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-18', date: '2026-08-04', block: 'afternoon', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-20', date: '2026-08-04', block: 'night', terminal: 'A', positionId: 'gpu' }),

  shift({ agentId: 'u-11', date: '2026-08-05', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-13', date: '2026-08-05', block: 'morning', terminal: 'A', positionId: 'pushback_tractor' }),
  shift({ agentId: 'u-19', date: '2026-08-05', block: 'morning', terminal: 'A', positionId: 'belt_loader' }),
  shift({ agentId: 'u-20', date: '2026-08-05', block: 'morning', terminal: 'A', positionId: 'bridge' }),
  shift({ agentId: 'u-12', date: '2026-08-05', block: 'morning', terminal: 'B', positionId: 'belt_loader' }),
  shift({ agentId: 'u-21', date: '2026-08-05', block: 'morning', terminal: 'B', positionId: 'bridge' }),
  shift({ agentId: 'u-23', date: '2026-08-05', block: 'morning', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-14', date: '2026-08-05', block: 'afternoon', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-18', date: '2026-08-05', block: 'afternoon', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-19', date: '2026-08-05', block: 'night', terminal: 'A', positionId: 'gpu' }),
];

// Semana actual (2026-08-10 a 2026-08-16) — con déficit: la madrugada de
// Terminal B queda sin cobertura casi toda la semana, y varias posiciones
// de la tarde también quedan descubiertas.
const CURRENT_WEEK_SHIFTS = [
  shift({ agentId: 'u-11', date: '2026-08-10', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-20', date: '2026-08-10', block: 'morning', terminal: 'A', positionId: 'pushback_tractor' }),
  shift({ agentId: 'u-19', date: '2026-08-10', block: 'morning', terminal: 'A', positionId: 'belt_loader' }),
  shift({ agentId: 'u-13', date: '2026-08-10', block: 'morning', terminal: 'B', positionId: 'belt_loader' }),
  shift({ agentId: 'u-23', date: '2026-08-10', block: 'morning', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-22', date: '2026-08-10', block: 'afternoon', terminal: 'A', positionId: 'baggage_cart' }),
  shift({ agentId: 'u-18', date: '2026-08-10', block: 'afternoon', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-11', date: '2026-08-10', block: 'night', terminal: 'A', positionId: 'gpu' }),

  shift({ agentId: 'u-19', date: '2026-08-11', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-20', date: '2026-08-11', block: 'morning', terminal: 'A', positionId: 'bridge' }),
  shift({ agentId: 'u-13', date: '2026-08-11', block: 'morning', terminal: 'B', positionId: 'belt_loader' }),
  shift({ agentId: 'u-12', date: '2026-08-11', block: 'afternoon', terminal: 'B', positionId: 'belt_loader' }),
  shift({ agentId: 'u-14', date: '2026-08-11', block: 'afternoon', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-20', date: '2026-08-11', block: 'night', terminal: 'A', positionId: 'gpu' }),

  shift({ agentId: 'u-11', date: '2026-08-12', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-13', date: '2026-08-12', block: 'morning', terminal: 'A', positionId: 'pushback_tractor' }),
  shift({ agentId: 'u-21', date: '2026-08-12', block: 'morning', terminal: 'B', positionId: 'bridge' }),
  shift({ agentId: 'u-23', date: '2026-08-12', block: 'morning', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-19', date: '2026-08-12', block: 'night', terminal: 'A', positionId: 'gpu' }),

  shift({ agentId: 'u-20', date: '2026-08-13', block: 'morning', terminal: 'A', positionId: 'pushback_tractor' }),
  shift({ agentId: 'u-11', date: '2026-08-13', block: 'morning', terminal: 'A', positionId: 'belt_loader' }),
  shift({ agentId: 'u-23', date: '2026-08-13', block: 'morning', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-22', date: '2026-08-13', block: 'afternoon', terminal: 'A', positionId: 'baggage_cart' }),
  shift({ agentId: 'u-11', date: '2026-08-13', block: 'night', terminal: 'A', positionId: 'gpu' }),

  shift({ agentId: 'u-19', date: '2026-08-14', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-13', date: '2026-08-14', block: 'morning', terminal: 'B', positionId: 'belt_loader' }),
  shift({ agentId: 'u-21', date: '2026-08-14', block: 'afternoon', terminal: 'B', positionId: 'belt_loader' }),
  shift({ agentId: 'u-20', date: '2026-08-14', block: 'night', terminal: 'A', positionId: 'gpu' }),

  shift({ agentId: 'u-11', date: '2026-08-15', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-23', date: '2026-08-15', block: 'morning', terminal: 'B', positionId: 'gpu' }),
  shift({ agentId: 'u-14', date: '2026-08-15', block: 'afternoon', terminal: 'A', positionId: 'gpu' }),

  shift({ agentId: 'u-20', date: '2026-08-16', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-13', date: '2026-08-16', block: 'morning', terminal: 'B', positionId: 'belt_loader' }),
];

// Semana siguiente (2026-08-17 a 2026-08-23) — prácticamente sin turnos
// asignados todavía (skill.md §ESTADOS: "semana sin turnos").
const NEXT_WEEK_SHIFTS = [
  shift({ agentId: 'u-11', date: '2026-08-17', block: 'morning', terminal: 'A', positionId: 'gpu' }),
  shift({ agentId: 'u-13', date: '2026-08-17', block: 'morning', terminal: 'B', positionId: 'belt_loader' }),
];

export const SHIFT_ASSIGNMENTS_MOCK = [...PREVIOUS_WEEK_SHIFTS, ...CURRENT_WEEK_SHIFTS, ...NEXT_WEEK_SHIFTS];

function availabilityRequest({ id, agentId, date, type, reason, status, requestedAt, resolvedAt, resolvedBy }) {
  const agentRecord = AGENTS_MOCK.find(item => item.agentId === agentId);
  return {
    id,
    agentId,
    agentName: agentRecord.agentName,
    date,
    type,
    reason,
    status,
    requestedAt,
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(resolvedBy ? { resolvedBy } : {}),
  };
}

export const AVAILABILITY_REQUESTS_MOCK = [
  availabilityRequest({
    id: 'ar-1', agentId: 'u-14', date: '2026-08-12', type: 'restriction',
    reason: 'Cita médica programada.', status: 'approved',
    requestedAt: '2026-08-05T10:00:00-04:00', resolvedAt: '2026-08-06T09:00:00-04:00', resolvedBy: 'Camila Reyes',
  }),
  availabilityRequest({
    id: 'ar-2', agentId: 'u-19', date: '2026-08-14', type: 'shift_change',
    reason: 'Solicita turno de mañana por estudios nocturnos.', status: 'pending',
    requestedAt: '2026-08-09T15:30:00-04:00',
  }),
  availabilityRequest({
    id: 'ar-3', agentId: 'u-21', date: '2026-08-11', type: 'day_off',
    reason: 'Asunto personal.', status: 'pending',
    requestedAt: '2026-08-08T08:45:00-04:00',
  }),
  availabilityRequest({
    id: 'ar-4', agentId: 'u-13', date: '2026-08-20', type: 'restriction',
    reason: 'Entrenamiento programado ALC.', status: 'approved',
    requestedAt: '2026-08-04T11:00:00-04:00', resolvedAt: '2026-08-05T09:00:00-04:00', resolvedBy: 'Camila Reyes',
  }),
  availabilityRequest({
    id: 'ar-5', agentId: 'u-22', date: '2026-08-05', type: 'day_off',
    reason: 'Permiso personal.', status: 'rejected',
    requestedAt: '2026-08-01T09:00:00-04:00', resolvedAt: '2026-08-02T10:00:00-04:00', resolvedBy: 'Camila Reyes',
  }),
  availabilityRequest({
    id: 'ar-6', agentId: 'u-18', date: '2026-08-13', type: 'shift_change',
    reason: 'Cambio de turno por cuidado familiar.', status: 'pending',
    requestedAt: '2026-08-09T17:10:00-04:00',
  }),
];
