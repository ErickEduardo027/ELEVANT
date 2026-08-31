// Datos mock del dominio "Habilitaciones y certificaciones", consumidos
// EXCLUSIVAMENTE a través de humanResourcesQualificationsService (ver ese
// archivo para el detalle de qué endpoint provisional sustituye a cada
// función). Ningún componente debe importar este archivo directamente —
// mismo contrato que usersMock.js en el dominio de usuarios.
//
// Los agentes u-11..u-14 reutilizan intencionalmente los mismos `agentId`
// que sus registros en usersMock.js (Agente de Rampa), para que el enlace
// "Ver habilitaciones completas" desde UserDetailPanel abra el agente
// correcto. Los agentes u-18..u-23 continúan la misma numeración a modo de
// agentes de rampa aún no incorporados al módulo de Gestión de usuarios —
// no se inventa un espacio de identificadores nuevo.

export const EQUIPMENT_CATALOG_MOCK = [
  { id: 'bridge', name: 'Puente de abordaje' },
  { id: 'belt_loader', name: 'Cinta transportadora / Belt Loader' },
  { id: 'loader', name: 'Loader' },
  { id: 'pax_stairs', name: 'Escaleras de pasajeros' },
  { id: 'club_car', name: 'Club Car' },
  { id: 'pushback_tractor', name: 'Tractor / Pushback' },
  { id: 'baggage_cart', name: 'Baggage Cart' },
  { id: 'dolly', name: 'Dollies' },
  { id: 'gpu', name: 'GPU' },
  { id: 'acu', name: 'ACU' },
  { id: 'asu', name: 'ASU' },
];

// `identificationNumber`/`hireDate` de u-11..u-14 replican exactamente los
// valores de rampAgent en usersMock.js (mismo agentId) para que el detalle
// de agente muestre datos consistentes entre ambos módulos. u-18..u-23
// continúan la numeración de identificación de ese mismo mock.
export const AGENTS_MOCK = [
  { agentId: 'u-11', agentName: 'Kevin Alexander Díaz', employeeNumber: 'RA-1042', terminals: ['A'], identificationNumber: '001-1234567-11', hireDate: '2024-09-16T00:00:00.000Z' },
  { agentId: 'u-12', agentName: 'Rosa Elena Guzmán', employeeNumber: 'RA-1077', terminals: ['B'], identificationNumber: '001-1234567-12', hireDate: '2025-02-03T00:00:00.000Z' },
  { agentId: 'u-13', agentName: 'Franklin Ortiz', employeeNumber: 'RA-1103', terminals: ['A', 'B'], identificationNumber: '001-1234567-13', hireDate: '2026-07-28T00:00:00.000Z' },
  { agentId: 'u-14', agentName: 'Yeimy Santana', employeeNumber: 'RA-0991', terminals: ['A'], identificationNumber: '001-1234567-14', hireDate: '2024-12-30T00:00:00.000Z' },
  { agentId: 'u-18', agentName: 'María López', employeeNumber: 'RA-1150', terminals: ['B'], identificationNumber: '001-1234567-18', hireDate: '2025-03-10T00:00:00.000Z' },
  { agentId: 'u-19', agentName: 'Luis Tavárez', employeeNumber: 'RA-1162', terminals: ['A'], identificationNumber: '001-1234567-19', hireDate: '2025-05-22T00:00:00.000Z' },
  { agentId: 'u-20', agentName: 'Juan Pérez', employeeNumber: 'RA-1178', terminals: ['A'], identificationNumber: '001-1234567-20', hireDate: '2023-11-04T00:00:00.000Z' },
  { agentId: 'u-21', agentName: 'Ana Fermín', employeeNumber: 'RA-1183', terminals: ['B'], identificationNumber: '001-1234567-21', hireDate: '2024-06-18T00:00:00.000Z' },
  { agentId: 'u-22', agentName: 'Carlos Núñez', employeeNumber: 'RA-1197', terminals: ['A'], identificationNumber: '001-1234567-22', hireDate: '2023-08-30T00:00:00.000Z' },
  { agentId: 'u-23', agentName: 'Katherine Objío', employeeNumber: 'RA-1204', terminals: ['B'], identificationNumber: '001-1234567-23', hireDate: '2022-10-12T00:00:00.000Z' },
];

function agent(agentId) {
  const found = AGENTS_MOCK.find(item => item.agentId === agentId);
  return { agentId: found.agentId, agentName: found.agentName, employeeNumber: found.employeeNumber, terminals: found.terminals };
}

function equipmentName(equipmentId) {
  return EQUIPMENT_CATALOG_MOCK.find(item => item.id === equipmentId).name;
}

function qualification({ id, agentId, equipmentId, trainingDate, obtainedAt, expiresAt, certifyingEntity = 'ALC', instructor, notes, supportDocument = null, updatedAt }) {
  return {
    id,
    ...agent(agentId),
    equipmentId,
    equipmentName: equipmentName(equipmentId),
    trainingDate,
    obtainedAt,
    expiresAt,
    certifyingEntity,
    instructor,
    ...(notes ? { notes } : {}),
    supportDocument,
    updatedAt,
  };
}

// Fechas relativas al "hoy" de referencia de este mock: 2026-08-09. La
// ventana de "próxima a vencer" (30 días) se aplica en mappers.js, no aquí.
export const QUALIFICATIONS_MOCK = [
  qualification({
    id: 'q-1', agentId: 'u-11', equipmentId: 'gpu',
    trainingDate: '2025-07-08T00:00:00-04:00', obtainedAt: '2025-07-15T00:00:00-04:00', expiresAt: '2026-07-20T00:00:00-04:00',
    instructor: 'Rafael Fermín', updatedAt: '2025-07-15T09:00:00-04:00',
  }),
  qualification({
    id: 'q-2', agentId: 'u-13', equipmentId: 'pushback_tractor',
    trainingDate: '2025-05-28T00:00:00-04:00', obtainedAt: '2025-06-05T00:00:00-04:00', expiresAt: '2026-06-10T00:00:00-04:00',
    certifyingEntity: 'IDAC', instructor: 'Yolanda Cabrera', updatedAt: '2025-06-05T09:00:00-04:00',
  }),
  qualification({
    id: 'q-3', agentId: 'u-14', equipmentId: 'gpu',
    trainingDate: '2025-05-05T00:00:00-04:00', obtainedAt: '2025-05-12T00:00:00-04:00', expiresAt: '2026-05-18T00:00:00-04:00',
    instructor: 'Rafael Fermín', updatedAt: '2025-05-12T09:00:00-04:00',
  }),
  qualification({
    id: 'q-4', agentId: 'u-14', equipmentId: 'acu',
    trainingDate: '2025-07-18T00:00:00-04:00', obtainedAt: '2025-07-25T00:00:00-04:00', expiresAt: '2026-07-30T00:00:00-04:00',
    instructor: 'Marco Objío', notes: 'Pendiente reprogramar entrenamiento de actualización.', updatedAt: '2025-07-25T09:00:00-04:00',
  }),
  qualification({
    id: 'q-5', agentId: 'u-11', equipmentId: 'belt_loader',
    trainingDate: '2025-08-11T00:00:00-04:00', obtainedAt: '2025-08-18T00:00:00-04:00', expiresAt: '2026-08-22T00:00:00-04:00',
    instructor: 'Elena Ruiz', updatedAt: '2025-08-18T09:00:00-04:00',
  }),
  qualification({
    id: 'q-6', agentId: 'u-12', equipmentId: 'club_car',
    trainingDate: '2025-08-19T00:00:00-04:00', obtainedAt: '2025-08-26T00:00:00-04:00', expiresAt: '2026-08-30T00:00:00-04:00',
    instructor: 'Yolanda Cabrera', updatedAt: '2025-08-26T09:00:00-04:00',
  }),
  qualification({
    id: 'q-7', agentId: 'u-13', equipmentId: 'baggage_cart',
    trainingDate: '2025-08-22T00:00:00-04:00', obtainedAt: '2025-08-29T00:00:00-04:00', expiresAt: '2026-09-02T00:00:00-04:00',
    instructor: 'Rafael Fermín', notes: 'Agente único habilitado en este equipo — priorizar renovación.', updatedAt: '2025-08-29T09:00:00-04:00',
  }),
  qualification({
    id: 'q-8', agentId: 'u-18', equipmentId: 'belt_loader',
    trainingDate: '2025-08-07T00:00:00-04:00', obtainedAt: '2025-08-14T00:00:00-04:00', expiresAt: '2026-08-18T00:00:00-04:00',
    instructor: 'Elena Ruiz', updatedAt: '2025-08-14T09:00:00-04:00',
  }),
  qualification({
    id: 'q-9', agentId: 'u-19', equipmentId: 'gpu',
    trainingDate: '2025-08-16T00:00:00-04:00', obtainedAt: '2025-08-23T00:00:00-04:00', expiresAt: '2026-08-27T00:00:00-04:00',
    instructor: 'Rafael Fermín', updatedAt: '2025-08-23T09:00:00-04:00',
  }),
  qualification({
    id: 'q-10', agentId: 'u-11', equipmentId: 'bridge',
    trainingDate: '2026-01-30T00:00:00-04:00', obtainedAt: '2026-02-06T00:00:00-04:00', expiresAt: '2027-02-10T00:00:00-04:00',
    instructor: 'Marco Objío', supportDocument: { name: 'Certificado ALC - Puente de abordaje - K. Díaz.pdf', url: '#' },
    updatedAt: '2026-02-06T09:00:00-04:00',
  }),
  qualification({
    id: 'q-11', agentId: 'u-12', equipmentId: 'loader',
    trainingDate: '2026-01-04T00:00:00-04:00', obtainedAt: '2026-01-11T00:00:00-04:00', expiresAt: '2027-01-15T00:00:00-04:00',
    instructor: 'Yolanda Cabrera', updatedAt: '2026-01-11T09:00:00-04:00',
  }),
  qualification({
    id: 'q-12', agentId: 'u-12', equipmentId: 'pax_stairs',
    trainingDate: '2025-11-24T00:00:00-04:00', obtainedAt: '2025-12-01T00:00:00-04:00', expiresAt: '2026-12-05T00:00:00-04:00',
    instructor: 'Elena Ruiz', updatedAt: '2025-12-01T09:00:00-04:00',
  }),
  qualification({
    id: 'q-13', agentId: 'u-13', equipmentId: 'dolly',
    trainingDate: '2026-04-09T00:00:00-04:00', obtainedAt: '2026-04-16T00:00:00-04:00', expiresAt: '2027-04-20T00:00:00-04:00',
    instructor: 'Rafael Fermín', updatedAt: '2026-04-16T09:00:00-04:00',
  }),
  qualification({
    id: 'q-14', agentId: 'u-20', equipmentId: 'bridge',
    trainingDate: '2026-04-24T00:00:00-04:00', obtainedAt: '2026-05-01T00:00:00-04:00', expiresAt: '2027-05-05T00:00:00-04:00',
    certifyingEntity: 'IDAC', instructor: 'Marco Objío', updatedAt: '2026-05-01T09:00:00-04:00',
  }),
  qualification({
    id: 'q-15', agentId: 'u-20', equipmentId: 'loader',
    trainingDate: '2026-05-21T00:00:00-04:00', obtainedAt: '2026-05-28T00:00:00-04:00', expiresAt: '2027-06-01T00:00:00-04:00',
    instructor: 'Yolanda Cabrera', updatedAt: '2026-05-28T09:00:00-04:00',
  }),
  qualification({
    id: 'q-16', agentId: 'u-21', equipmentId: 'pax_stairs',
    trainingDate: '2025-10-31T00:00:00-04:00', obtainedAt: '2025-11-07T00:00:00-04:00', expiresAt: '2026-11-11T00:00:00-04:00',
    instructor: 'Elena Ruiz', updatedAt: '2025-11-07T09:00:00-04:00',
  }),
  qualification({
    id: 'q-17', agentId: 'u-22', equipmentId: 'club_car',
    trainingDate: '2026-02-17T00:00:00-04:00', obtainedAt: '2026-02-24T00:00:00-04:00', expiresAt: '2027-02-28T00:00:00-04:00',
    instructor: 'Yolanda Cabrera', updatedAt: '2026-02-24T09:00:00-04:00',
  }),
  qualification({
    id: 'q-18', agentId: 'u-23', equipmentId: 'dolly',
    trainingDate: '2026-03-07T00:00:00-04:00', obtainedAt: '2026-03-14T00:00:00-04:00', expiresAt: '2027-03-18T00:00:00-04:00',
    instructor: 'Rafael Fermín', supportDocument: { name: 'Certificado ALC - Dollies - K. Objío.pdf', url: '#' },
    updatedAt: '2026-03-14T09:00:00-04:00',
  }),
  qualification({
    id: 'q-19', agentId: 'u-23', equipmentId: 'acu',
    trainingDate: '2025-12-14T00:00:00-04:00', obtainedAt: '2025-12-21T00:00:00-04:00', expiresAt: '2026-12-25T00:00:00-04:00',
    instructor: 'Marco Objío', updatedAt: '2025-12-21T09:00:00-04:00',
  }),
];

const RENEWED_QUALIFICATION_IDS = new Set(['q-1', 'q-5', 'q-10', 'q-13', 'q-17', 'q-19']);

function priorCycleDate(isoString, days = 365) {
  const date = new Date(isoString);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function buildHistoryFor(record) {
  const events = [];
  if (RENEWED_QUALIFICATION_IDS.has(record.id)) {
    events.push({ id: `h-${record.id}-1`, qualificationId: record.id, eventType: 'created', description: 'Habilitación creada', occurredAt: priorCycleDate(record.obtainedAt), performedBy: 'Camila Reyes' });
    events.push({ id: `h-${record.id}-2`, qualificationId: record.id, eventType: 'training_completed', description: 'Entrenamiento completado', occurredAt: priorCycleDate(record.trainingDate), performedBy: record.instructor });
    events.push({ id: `h-${record.id}-3`, qualificationId: record.id, eventType: 'renewed', description: `Renovación registrada — ${record.certifyingEntity}`, occurredAt: record.obtainedAt, performedBy: 'Camila Reyes' });
  } else {
    events.push({ id: `h-${record.id}-1`, qualificationId: record.id, eventType: 'created', description: 'Habilitación creada', occurredAt: record.obtainedAt, performedBy: 'Camila Reyes' });
    events.push({ id: `h-${record.id}-2`, qualificationId: record.id, eventType: 'training_completed', description: 'Entrenamiento completado', occurredAt: record.trainingDate, performedBy: record.instructor });
  }
  return events;
}

export const QUALIFICATION_HISTORY_MOCK = Object.fromEntries(
  QUALIFICATIONS_MOCK.map(record => [record.id, buildHistoryFor(record)])
);

export function getQualificationHistory(qualificationId) {
  return QUALIFICATION_HISTORY_MOCK[qualificationId] ?? [];
}
