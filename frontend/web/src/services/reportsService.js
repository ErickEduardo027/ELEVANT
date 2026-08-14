import { handleUnauthorizedResponse, PROTOTYPE_API_URL, readSession } from '../features/auth/authService';

// En pruebas conserva el conjunto determinista. En ejecución utiliza las operaciones persistidas.
//
// Endpoints conceptuales que este adaptador representa (ver Claude-skills/plan-revision/plan-reports/skill.md):
//   GET  /reports/closure
//   GET  /reports/reconciliation
//   GET  /reports/ground-time
//   GET  /reports/summary
//   POST /reports/export
//
// Los cuatro reportes se derivan de un mismo conjunto base de "registros operativos"
// (OPERATIONAL_RECORDS), tal como lo haría un backend que consulta operaciones ya
// cerradas y las proyecta en distintas vistas analíticas. Esto mantiene los mocks
// coherentes entre reportes (el mismo vuelo puede aparecer en cierre, tiempo en
// tierra y en el resumen operativo con los mismos datos).

// PUJ / Atlantic Standard Time — mismo criterio que dashboardService/reviewService.
const STATION_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function stationDateKey(date) {
  return new Date(date.getTime() - STATION_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function dateOffset(daysAgo) {
  return stationDateKey(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
}

function isoAt(dateISO, hour, minute) {
  return `${dateISO}T${pad(hour)}:${pad(minute)}:00-04:00`;
}

const TODAY = dateOffset(0);
const YESTERDAY = dateOffset(1);
const DAY_2 = dateOffset(2);
const DAY_3 = dateOffset(3);
const DAY_5 = dateOffset(5);

// --- Conjunto base de registros operativos cerrados, ya aprobados por OCC. ---
const OPERATIONAL_RECORDS = [
  {
    id: 'OP-3001',
    flight: { number: 'DM161', airline: 'Arajet', airlineIata: 'DM' },
    terminal: 'Terminal A',
    aircraftType: 'B737 MAX 8',
    date: TODAY,
    position: { assigned: 'A5', final: 'A5' },
    positionChange: null,
    reportedAt: isoAt(TODAY, 14, 24),
    actualBlockAt: isoAt(TODAY, 14, 20),
    flightStatus: 'arrived',
    agent: { id: 12, name: 'Carlos Medina' },
    groundTime: { contractedMinutes: 90, actualMinutes: 82 },
    services: [
      { name: 'GPU', contractedQty: 1, executedQty: 1 },
      { name: 'Baggage', contractedQty: 1, executedQty: 1 },
      { name: 'Cleaning', contractedQty: 1, executedQty: 1 },
    ],
    incidents: 0,
  },
  {
    id: 'OP-3002',
    flight: { number: 'AA904', airline: 'American Airlines', airlineIata: 'AA' },
    terminal: 'Terminal A',
    aircraftType: 'B737-800',
    date: TODAY,
    position: { assigned: 'B19', final: 'B21' },
    positionChange: { initialPosition: 'B19', finalPosition: 'B21', changeReceivedAt: isoAt(TODAY, 9, 18) },
    reportedAt: isoAt(TODAY, 9, 50),
    actualBlockAt: isoAt(TODAY, 9, 50),
    flightStatus: 'arrived',
    agent: { id: 8, name: 'María Castillo' },
    groundTime: { contractedMinutes: 60, actualMinutes: 58 },
    services: [
      { name: 'Baggage', contractedQty: 1, executedQty: 1 },
      { name: 'Cleaning', contractedQty: 1, executedQty: 1 },
      { name: 'Catering', contractedQty: 1, executedQty: 1 },
    ],
    incidents: 1,
  },
  {
    id: 'OP-3003',
    flight: { number: 'DL2210', airline: 'Delta Air Lines', airlineIata: 'DL' },
    terminal: 'Terminal B',
    aircraftType: 'A321neo',
    date: TODAY,
    position: { assigned: 'B18', final: 'B21' },
    positionChange: { initialPosition: 'B18', finalPosition: 'B21', changeReceivedAt: isoAt(TODAY, 12, 12) },
    reportedAt: isoAt(TODAY, 12, 25),
    actualBlockAt: isoAt(TODAY, 12, 25),
    flightStatus: 'delayed',
    agent: { id: 3, name: 'Rafael Peña' },
    groundTime: { contractedMinutes: 50, actualMinutes: 62 },
    services: [
      { name: 'GPU', contractedQty: 1, executedQty: 1 },
      { name: 'Baggage', contractedQty: 4, executedQty: 4 },
    ],
    incidents: 1,
  },
  {
    id: 'OP-3004',
    flight: { number: 'AC1876', airline: 'Air Canada', airlineIata: 'AC' },
    terminal: 'Terminal A',
    aircraftType: 'A320',
    date: TODAY,
    position: { assigned: 'A5', final: 'A5' },
    positionChange: null,
    reportedAt: isoAt(TODAY, 10, 6),
    actualBlockAt: isoAt(TODAY, 10, 6),
    flightStatus: 'arrived',
    agent: { id: 12, name: 'Carlos Medina' },
    groundTime: { contractedMinutes: 75, actualMinutes: 78 },
    services: [
      { name: 'GPU', contractedQty: 1, executedQty: 2 },
      { name: 'Baggage', contractedQty: 4, executedQty: 4 },
    ],
    incidents: 0,
  },
  {
    id: 'OP-3005',
    flight: { number: 'UA1470', airline: 'United Airlines', airlineIata: 'UA' },
    terminal: 'Terminal A',
    aircraftType: 'A330',
    date: YESTERDAY,
    position: { assigned: 'A1', final: 'A1' },
    positionChange: null,
    reportedAt: isoAt(YESTERDAY, 9, 46),
    actualBlockAt: isoAt(YESTERDAY, 9, 46),
    flightStatus: 'arrived',
    agent: { id: 14, name: 'José Fermín' },
    groundTime: { contractedMinutes: 70, actualMinutes: 79 },
    services: [
      { name: 'Baggage', contractedQty: 2, executedQty: 2 },
      { name: 'Cleaning', contractedQty: 1, executedQty: 1 },
    ],
    incidents: 0,
  },
  {
    id: 'OP-3006',
    flight: { number: 'B6289', airline: 'JetBlue', airlineIata: 'B6' },
    terminal: 'Terminal B',
    aircraftType: 'B787',
    date: YESTERDAY,
    position: { assigned: 'A1', final: 'A1' },
    positionChange: null,
    reportedAt: isoAt(YESTERDAY, 12, 14),
    actualBlockAt: isoAt(YESTERDAY, 12, 14),
    flightStatus: 'arrived',
    agent: { id: 9, name: 'Katherine Objío' },
    groundTime: { contractedMinutes: 65, actualMinutes: 71 },
    services: [
      { name: 'Baggage', contractedQty: 3, executedQty: 3 },
      { name: 'Catering', contractedQty: 1, executedQty: 1 },
      { name: 'GPU', contractedQty: 1, executedQty: 1 },
    ],
    incidents: 0,
  },
  {
    id: 'OP-3007',
    flight: { number: 'WG654', airline: 'Sunwing', airlineIata: 'WG' },
    terminal: 'Terminal B',
    aircraftType: 'A321neo',
    date: YESTERDAY,
    position: { assigned: 'B10', final: 'B32' },
    positionChange: { initialPosition: 'B10', finalPosition: 'B32', changeReceivedAt: isoAt(YESTERDAY, 8, 48) },
    reportedAt: isoAt(YESTERDAY, 8, 51),
    actualBlockAt: isoAt(YESTERDAY, 8, 51),
    flightStatus: 'arrived',
    agent: { id: 8, name: 'María Castillo' },
    groundTime: { contractedMinutes: 70, actualMinutes: 78 },
    services: [{ name: 'Baggage', contractedQty: 2, executedQty: 2 }],
    incidents: 0,
  },
  {
    id: 'OP-3008',
    flight: { number: 'B6812', airline: 'JetBlue', airlineIata: 'B6' },
    terminal: 'Terminal A',
    aircraftType: 'A320',
    date: DAY_2,
    position: { assigned: 'A1', final: 'A1' },
    positionChange: null,
    reportedAt: isoAt(DAY_2, 7, 5),
    actualBlockAt: isoAt(DAY_2, 7, 5),
    flightStatus: 'delayed',
    agent: { id: 14, name: 'José Fermín' },
    groundTime: { contractedMinutes: 60, actualMinutes: 75 },
    services: [
      { name: 'Baggage', contractedQty: 2, executedQty: 1 },
      { name: 'Cleaning', contractedQty: 1, executedQty: 0 },
      { name: 'Catering', contractedQty: 1, executedQty: 0 },
    ],
    incidents: 1,
  },
  {
    id: 'OP-3009',
    flight: { number: 'CM110', airline: 'Copa Airlines', airlineIata: 'CM' },
    terminal: 'Terminal B',
    aircraftType: 'A320',
    date: DAY_2,
    position: { assigned: 'B32', final: 'B32' },
    positionChange: null,
    reportedAt: isoAt(DAY_2, 5, 50),
    actualBlockAt: isoAt(DAY_2, 5, 50),
    flightStatus: 'arrived',
    agent: { id: 3, name: 'Rafael Peña' },
    groundTime: { contractedMinutes: 65, actualMinutes: 65 },
    services: [
      { name: 'Baggage', contractedQty: 2, executedQty: 2 },
      { name: 'Cleaning', contractedQty: 1, executedQty: 1 },
    ],
    incidents: 0,
  },
  {
    id: 'OP-3010',
    flight: { number: 'CM345', airline: 'Copa Airlines', airlineIata: 'CM' },
    terminal: 'FBO',
    aircraftType: 'B737 MAX',
    date: DAY_2,
    position: { assigned: 'BN2', final: 'BN8' },
    positionChange: { initialPosition: 'BN2', finalPosition: 'BN8', changeReceivedAt: isoAt(DAY_2, 10, 19) },
    reportedAt: isoAt(DAY_2, 10, 21),
    actualBlockAt: isoAt(DAY_2, 10, 21),
    flightStatus: 'arrived',
    agent: { id: 3, name: 'Rafael Peña' },
    groundTime: { contractedMinutes: 45, actualMinutes: 51 },
    services: [
      { name: 'Desembarque', contractedQty: 1, executedQty: 1 },
      { name: 'Baggage', contractedQty: 1, executedQty: 1 },
    ],
    incidents: 0,
  },
  {
    id: 'OP-3011',
    flight: { number: 'TS234', airline: 'Air Transat', airlineIata: 'TS' },
    terminal: 'Terminal A',
    aircraftType: 'A330',
    date: DAY_3,
    position: { assigned: 'A1', final: 'A1' },
    positionChange: null,
    reportedAt: isoAt(DAY_3, 12, 5),
    actualBlockAt: isoAt(DAY_3, 12, 5),
    flightStatus: 'arrived',
    agent: { id: 3, name: 'Rafael Peña' },
    groundTime: { contractedMinutes: 90, actualMinutes: 93 },
    services: [
      { name: 'Baggage', contractedQty: 3, executedQty: 3 },
      { name: 'Catering', contractedQty: 1, executedQty: 1 },
      { name: 'GPU', contractedQty: 1, executedQty: 1 },
    ],
    incidents: 0,
  },
  {
    id: 'OP-3012',
    flight: { number: 'AA455', airline: 'American Airlines', airlineIata: 'AA' },
    terminal: 'Terminal A',
    aircraftType: 'B737 MAX',
    date: DAY_3,
    position: { assigned: 'A5', final: 'B18' },
    positionChange: { initialPosition: 'A5', finalPosition: 'B18', changeReceivedAt: isoAt(DAY_3, 3, 58) },
    reportedAt: isoAt(DAY_3, 4, 18),
    actualBlockAt: isoAt(DAY_3, 4, 18),
    flightStatus: 'cancelled',
    agent: { id: 12, name: 'Carlos Medina' },
    groundTime: { contractedMinutes: 60, actualMinutes: 0 },
    services: [{ name: 'GPU', contractedQty: 1, executedQty: 0 }],
    incidents: 1,
  },
  {
    id: 'OP-3013',
    flight: { number: 'DL500', airline: 'Delta Air Lines', airlineIata: 'DL' },
    terminal: 'Terminal B',
    aircraftType: 'B787',
    date: DAY_5,
    position: { assigned: 'B21', final: 'B21' },
    positionChange: null,
    reportedAt: isoAt(DAY_5, 5, 8),
    actualBlockAt: isoAt(DAY_5, 5, 8),
    flightStatus: 'arrived',
    agent: { id: 5, name: 'Juan Pérez' },
    groundTime: { contractedMinutes: 55, actualMinutes: 52 },
    services: [
      { name: 'Baggage', contractedQty: 2, executedQty: 2 },
      { name: 'Cleaning', contractedQty: 1, executedQty: 1 },
    ],
    incidents: 0,
  },
  {
    id: 'OP-3014',
    flight: { number: 'AA123', airline: 'American Airlines', airlineIata: 'AA' },
    terminal: 'Terminal A',
    aircraftType: 'B737-800',
    date: DAY_5,
    position: { assigned: 'A5', final: 'A9' },
    positionChange: { initialPosition: 'A5', finalPosition: 'A9', changeReceivedAt: isoAt(DAY_5, 7, 6) },
    reportedAt: isoAt(DAY_5, 7, 26),
    actualBlockAt: isoAt(DAY_5, 7, 26),
    flightStatus: 'diverted',
    agent: { id: 12, name: 'Carlos Medina' },
    groundTime: { contractedMinutes: 60, actualMinutes: 66 },
    services: [{ name: 'GPU', contractedQty: 1, executedQty: 1 }],
    incidents: 0,
  },
];

function diffMinutes(fromIso, toIso) {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
}

function cloneRecords() {
  return JSON.parse(JSON.stringify(OPERATIONAL_RECORDS));
}

const usesPrototypeApi = () => import.meta.env.MODE !== 'test';

async function baseRecords() {
  if (!usesPrototypeApi()) return cloneRecords();
  const session = readSession();
  const response = await fetch(`${PROTOTYPE_API_URL}/api/reports/operational-records`, {
    headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    handleUnauthorizedResponse(response);
    throw new Error(payload.error || 'No se pudieron cargar los reportes operativos.');
  }
  return payload.records ?? [];
}

// Umbrales de clasificación de severidad del cierre operacional. Se exponen como
// constantes (no en línea) para que puedan sustituirse por el valor que envíe la
// API sin tocar la lógica que las consume.
export const CLOSURE_SEVERITY_THRESHOLDS = { criticalMaxMinutes: 15, warningMaxMinutes: 20 };
export const GROUND_TIME_NEAR_LIMIT_BUFFER_MINUTES = 10;

export function classifyClosureSeverity(leadTimeMinutes, thresholds = CLOSURE_SEVERITY_THRESHOLDS) {
  if (leadTimeMinutes < thresholds.criticalMaxMinutes) return 'critical';
  if (leadTimeMinutes < thresholds.warningMaxMinutes) return 'warning';
  return 'normal';
}

export function classifyGroundTimeStatus(contractedMinutes, actualMinutes, bufferMinutes = GROUND_TIME_NEAR_LIMIT_BUFFER_MINUTES) {
  if (actualMinutes <= contractedMinutes) return 'within_sla';
  if (actualMinutes <= contractedMinutes + bufferMinutes) return 'near_limit';
  return 'exceeded';
}

export function classifyReconciliationStatus(contractedQty, executedQty) {
  if (executedQty === contractedQty) return 'conforme';
  if (executedQty === 0 && contractedQty > 0) return 'no_ejecutado';
  return 'diferencia';
}

function toClosureRow(record) {
  const change = record.positionChange;
  const leadTimeMinutes = diffMinutes(change.changeReceivedAt, record.actualBlockAt);
  return {
    id: `${record.id}-closure`,
    recordId: record.id,
    flight: record.flight,
    terminal: record.terminal,
    date: record.date,
    initialPosition: change.initialPosition,
    finalPosition: change.finalPosition,
    changeReceivedAt: change.changeReceivedAt,
    actualBlockAt: record.actualBlockAt,
    leadTimeMinutes,
    agent: record.agent,
    severity: record.closureSeverityOverride ?? classifyClosureSeverity(leadTimeMinutes),
    incidents: record.incidents,
    detail: record,
  };
}

function toReconciliationRows(record) {
  return record.services.map((service, index) => ({
    id: `${record.id}-svc-${index}`,
    recordId: record.id,
    airline: record.flight.airline,
    flight: record.flight.number,
    terminal: record.terminal,
    period: record.date,
    service: service.name,
    contractedQty: service.contractedQty,
    executedQty: service.executedQty,
    diff: service.executedQty - service.contractedQty,
    status: classifyReconciliationStatus(service.contractedQty, service.executedQty),
    detail: record,
  }));
}

function toGroundTimeRow(record) {
  const { contractedMinutes, actualMinutes } = record.groundTime;
  return {
    id: `${record.id}-gt`,
    recordId: record.id,
    flight: record.flight,
    terminal: record.terminal,
    date: record.date,
    aircraftType: record.aircraftType,
    contractedMinutes,
    actualMinutes,
    diffMinutes: actualMinutes - contractedMinutes,
    status: classifyGroundTimeStatus(contractedMinutes, actualMinutes),
    detail: record,
  };
}

function inRange(dateKey, dateFrom, dateTo) {
  if (dateFrom && dateKey < dateFrom) return false;
  if (dateTo && dateKey > dateTo) return false;
  return true;
}

function applyCommonFilters(records, filters = {}) {
  return records.filter(record => {
    if (filters.airline && record.flight.airline !== filters.airline) return false;
    if (filters.agent && record.agent?.name !== filters.agent) return false;
    if (filters.terminal && record.terminal !== filters.terminal) return false;
    if (!inRange(record.date, filters.dateFrom, filters.dateTo)) return false;
    return true;
  });
}

export async function getClosureReport(stationCode = 'PUJ', filters = {}) {
  const records = applyCommonFilters(await baseRecords(), filters).filter(record => record.positionChange !== null);
  const rows = records
    .filter(record => (filters.position ? record.positionChange.finalPosition === filters.position : true))
    .map(toClosureRow);
  return { station: { code: stationCode }, rows };
}

export async function getReconciliationReport(stationCode = 'PUJ', filters = {}) {
  const records = applyCommonFilters(await baseRecords(), filters);
  const rows = records.flatMap(toReconciliationRows);
  return { station: { code: stationCode }, rows };
}

export async function getGroundTimeReport(stationCode = 'PUJ', filters = {}) {
  const records = applyCommonFilters(await baseRecords(), filters);
  const rows = records.map(toGroundTimeRow);
  return { station: { code: stationCode }, rows };
}

export async function getOperationalSummary(stationCode = 'PUJ', filters = {}) {
  const records = applyCommonFilters(await baseRecords(), filters);
  return { station: { code: stationCode }, records };
}

export async function exportReport({ reportId, format }) {
  // Simula latencia de generación de un reporte en el backend.
  await new Promise(resolve => setTimeout(resolve, 900));
  return {
    reportId,
    format,
    fileName: `${reportId}-${stationDateKey(new Date())}.${format === 'excel' ? 'xlsx' : 'pdf'}`,
    generatedAt: new Date().toISOString(),
  };
}
