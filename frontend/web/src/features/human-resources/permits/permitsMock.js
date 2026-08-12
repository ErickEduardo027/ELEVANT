// Datos mock del dominio "Carnets y permisos aeroportuarios", consumidos
// EXCLUSIVAMENTE a través de humanResourcesPermitsService (ver ese archivo
// para el detalle de qué endpoint provisional sustituye a cada función).
// Ningún componente debe importar este archivo directamente — mismo
// contrato que certificationsMock.js/usersMock.js.
//
// Los agentes reutilizan intencionalmente los mismos `agentId`/`agentName`
// que certificationsMock.js (mismo catálogo de agentes de rampa; no se
// inventa un espacio de identificadores nuevo). Cada agente administra
// exactamente dos documentos — carnet aeroportuario y licencia de conducir
// en rampa — por eso los IDs de permiso son deterministas (`${agentId}-carnet`
// / `${agentId}-licencia`) en vez de una secuencia incremental: no existe un
// flujo de alta de documento nuevo, solo renovación (skill.md §RENOVACIÓN).
//
// Fechas relativas al "hoy" de referencia de este mock: 2026-08-10.

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

function permit({ agentId, type, number, issuedAt, expiresAt, supportDocument = null, updatedAt }) {
  return {
    id: `${agentId}-${type}`,
    ...agent(agentId),
    type,
    number,
    issuedAt,
    expiresAt,
    supportDocument,
    updatedAt,
  };
}

// Cubre deliberadamente los escenarios exigidos por el skill: Franklin
// Ortiz (carnet vencido + licencia vigente) y Yeimy Santana (ambos
// vencidos), además de vigentes y próximos a vencer repartidos entre el
// resto de agentes.
export const PERMITS_MOCK = [
  permit({ agentId: 'u-11', type: 'carnet', number: 'CARN-2024-0111', issuedAt: '2025-01-10T00:00:00-04:00', expiresAt: '2027-01-10T00:00:00-04:00', updatedAt: '2025-01-10T09:00:00-04:00' }),
  permit({ agentId: 'u-11', type: 'licencia', number: 'LIC-RAMP-0211', issuedAt: '2024-11-05T00:00:00-04:00', expiresAt: '2026-11-05T00:00:00-04:00', supportDocument: { name: 'Licencia de conducir en rampa - K. Díaz.pdf', url: '#' }, updatedAt: '2024-11-05T09:00:00-04:00' }),

  permit({ agentId: 'u-12', type: 'carnet', number: 'CARN-2024-0212', issuedAt: '2025-08-20T00:00:00-04:00', expiresAt: '2026-08-25T00:00:00-04:00', updatedAt: '2025-08-20T09:00:00-04:00' }),
  permit({ agentId: 'u-12', type: 'licencia', number: 'LIC-RAMP-0212', issuedAt: '2024-06-01T00:00:00-04:00', expiresAt: '2027-06-01T00:00:00-04:00', updatedAt: '2024-06-01T09:00:00-04:00' }),

  permit({ agentId: 'u-13', type: 'carnet', number: 'CARN-2023-0113', issuedAt: '2024-07-15T00:00:00-04:00', expiresAt: '2026-07-20T00:00:00-04:00', updatedAt: '2024-07-15T09:00:00-04:00' }),
  permit({ agentId: 'u-13', type: 'licencia', number: 'LIC-RAMP-0213', issuedAt: '2024-12-01T00:00:00-04:00', expiresAt: '2026-12-01T00:00:00-04:00', updatedAt: '2024-12-01T09:00:00-04:00' }),

  permit({ agentId: 'u-14', type: 'carnet', number: 'CARN-2023-0114', issuedAt: '2024-06-10T00:00:00-04:00', expiresAt: '2026-06-15T00:00:00-04:00', updatedAt: '2024-06-10T09:00:00-04:00' }),
  permit({ agentId: 'u-14', type: 'licencia', number: 'LIC-RAMP-0214', issuedAt: '2024-07-01T00:00:00-04:00', expiresAt: '2026-07-01T00:00:00-04:00', updatedAt: '2024-07-01T09:00:00-04:00' }),

  permit({ agentId: 'u-18', type: 'carnet', number: 'CARN-2025-0118', issuedAt: '2026-05-01T00:00:00-04:00', expiresAt: '2027-05-01T00:00:00-04:00', updatedAt: '2026-05-01T09:00:00-04:00' }),
  permit({ agentId: 'u-18', type: 'licencia', number: 'LIC-RAMP-0218', issuedAt: '2024-08-30T00:00:00-04:00', expiresAt: '2026-08-30T00:00:00-04:00', updatedAt: '2024-08-30T09:00:00-04:00' }),

  permit({ agentId: 'u-19', type: 'carnet', number: 'CARN-2024-0119', issuedAt: '2025-08-18T00:00:00-04:00', expiresAt: '2026-08-18T00:00:00-04:00', updatedAt: '2025-08-18T09:00:00-04:00' }),
  permit({ agentId: 'u-19', type: 'licencia', number: 'LIC-RAMP-0219', issuedAt: '2024-08-22T00:00:00-04:00', expiresAt: '2026-08-22T00:00:00-04:00', updatedAt: '2024-08-22T09:00:00-04:00' }),

  permit({ agentId: 'u-20', type: 'carnet', number: 'CARN-2024-0120', issuedAt: '2025-08-19T00:00:00-04:00', expiresAt: '2026-08-19T00:00:00-04:00', updatedAt: '2025-08-19T09:00:00-04:00' }),
  permit({ agentId: 'u-20', type: 'licencia', number: 'LIC-RAMP-0220', issuedAt: '2025-03-01T00:00:00-04:00', expiresAt: '2027-03-01T00:00:00-04:00', updatedAt: '2025-03-01T09:00:00-04:00' }),

  permit({ agentId: 'u-21', type: 'carnet', number: 'CARN-2025-0121', issuedAt: '2026-01-15T00:00:00-04:00', expiresAt: '2027-01-15T00:00:00-04:00', updatedAt: '2026-01-15T09:00:00-04:00' }),
  permit({ agentId: 'u-21', type: 'licencia', number: 'LIC-RAMP-0221', issuedAt: '2024-08-21T00:00:00-04:00', expiresAt: '2026-08-21T00:00:00-04:00', updatedAt: '2024-08-21T09:00:00-04:00' }),

  permit({ agentId: 'u-22', type: 'carnet', number: 'CARN-2025-0122', issuedAt: '2026-06-01T00:00:00-04:00', expiresAt: '2027-06-01T00:00:00-04:00', updatedAt: '2026-06-01T09:00:00-04:00' }),
  permit({ agentId: 'u-22', type: 'licencia', number: 'LIC-RAMP-0222', issuedAt: '2026-05-15T00:00:00-04:00', expiresAt: '2027-05-15T00:00:00-04:00', supportDocument: { name: 'Licencia de conducir en rampa - C. Núñez.pdf', url: '#' }, updatedAt: '2026-05-15T09:00:00-04:00' }),

  permit({ agentId: 'u-23', type: 'carnet', number: 'CARN-2024-0123', issuedAt: '2025-09-05T00:00:00-04:00', expiresAt: '2026-09-05T00:00:00-04:00', updatedAt: '2025-09-05T09:00:00-04:00' }),
  permit({ agentId: 'u-23', type: 'licencia', number: 'LIC-RAMP-0223', issuedAt: '2025-02-20T00:00:00-04:00', expiresAt: '2027-02-20T00:00:00-04:00', updatedAt: '2025-02-20T09:00:00-04:00' }),
];

// Documentos de los agentes más recientes (María López, Luis Tavárez) están
// en su primer ciclo — sin renovación previa. El resto ya pasó por al menos
// una renovación.
const FIRST_CYCLE_AGENT_IDS = new Set(['u-18', 'u-19']);

function priorCycleDate(isoString, days = 365) {
  const date = new Date(isoString);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function buildHistoryFor(record) {
  const events = [];
  if (FIRST_CYCLE_AGENT_IDS.has(record.agentId)) {
    events.push({ id: `h-${record.id}-1`, permitId: record.id, documentType: record.type, eventType: 'issued', description: `${record.type === 'carnet' ? 'Carnet aeroportuario' : 'Licencia de conducir en rampa'} emitido`, occurredAt: record.issuedAt, performedBy: 'Camila Reyes' });
  } else {
    events.push({ id: `h-${record.id}-1`, permitId: record.id, documentType: record.type, eventType: 'issued', description: `${record.type === 'carnet' ? 'Carnet aeroportuario' : 'Licencia de conducir en rampa'} emitido`, occurredAt: priorCycleDate(record.issuedAt), performedBy: 'Camila Reyes' });
    events.push({ id: `h-${record.id}-2`, permitId: record.id, documentType: record.type, eventType: 'renewed', description: `Renovación registrada — ${record.number}`, occurredAt: record.issuedAt, performedBy: 'Camila Reyes' });
  }
  return events;
}

export const PERMIT_HISTORY_MOCK = Object.fromEntries(PERMITS_MOCK.map(record => [record.id, buildHistoryFor(record)]));

export function getPermitHistory(permitId) {
  return PERMIT_HISTORY_MOCK[permitId] ?? [];
}
