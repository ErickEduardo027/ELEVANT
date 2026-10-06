import {
  handleUnauthorizedResponse,
  PROTOTYPE_API_URL,
  readSession,
} from '../features/auth/authService';

// En pruebas conserva los escenarios mock exhaustivos. En ejecución normal consume la cola persistente del backend.
//
// Endpoints conceptuales que este adaptador representa (ver Claude-skills/plan-revision/skill.md):
//   GET  /reviews
//   GET  /reviews/{id}
//   GET  /reviews/statistics        (las estadísticas se derivan en el cliente vía reviewMappers.computeKpis)
//   GET  /reviews/{id}/timeline
//   GET  /reviews/{id}/services
//   GET  /reviews/{id}/incidents
//   GET  /reviews/{id}/evidence
//   GET  /reviews/{id}/history
//   GET  /reviews/{id}/reconciliation
//   POST /reviews/{id}/start-review
//   POST /reviews/{id}/approve
//   POST /reviews/{id}/return
//   POST /reviews/bulk-approve
//   POST /reviews/bulk-return

// PUJ / Atlantic Standard Time — matches the "-04:00" offset used throughout this mock.
// Deriving "today" from raw UTC would roll over to the next calendar date for several hours
// every evening at the station (UTC midnight is 20:00 local), well before the station's own day
// is over, silently dating new mock timestamps a day ahead of the station's current date.
const STATION_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

function usesPrototypeApi() {
  return process.env.NODE_ENV !== 'test';
}

async function reviewApi(path, options = {}) {
  const session = readSession();
  const response = await fetch(`${PROTOTYPE_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  handleUnauthorizedResponse(response);
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la revisión operativa.');
  return payload;
}

function getOperationDate() {
  return new Date(Date.now() - STATION_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function isoAt(dateISO, hour, minute) {
  return `${dateISO}T${pad(hour)}:${pad(minute)}:00-04:00`;
}

const today = getOperationDate();

// --- REV-1001 — Caso limpio: sin incidencias, sin discrepancias, firmas completas. ---
const REV_1001 = {
  id: 'REV-1001',
  status: 'PENDING_REVIEW',
  priority: 'NORMAL',
  flight: {
    number: 'DM161',
    airline: 'Arajet',
    airlineIata: 'DM',
    origin: 'MIA',
    destination: 'PUJ',
    aircraftType: 'B737 MAX 8',
    registration: 'HI1024',
  },
  schedule: { sta: isoAt(today, 14, 20), ata: isoAt(today, 14, 27), std: isoAt(today, 15, 35), atd: isoAt(today, 15, 42) },
  position: 'A5',
  agent: { id: 12, name: 'Carlos Medina' },
  supervisor: { id: 5, name: 'Juan Pérez' },
  submittedAt: isoAt(today, 15, 45),
  approvedAt: null,
  planned: { position: 'A5', startTime: isoAt(today, 14, 20), agents: 5, teams: 2, services: ['GPU', 'Baggage', 'Cleaning'], duration: 82, supervisor: 'Juan Pérez' },
  actual: { position: 'A5', startTime: isoAt(today, 14, 20), agents: 5, teams: 2, services: ['GPU', 'Baggage', 'Cleaning'], duration: 82, supervisor: 'Juan Pérez' },
  timeline: {
    blocksOn: isoAt(today, 14, 20),
    doorsOpen: isoAt(today, 14, 24),
    loadingStart: isoAt(today, 14, 32),
    loadingEnd: isoAt(today, 14, 55),
    boardingStart: isoAt(today, 15, 5),
    firstPax: isoAt(today, 15, 8),
    lastPax: isoAt(today, 15, 30),
    firstBag: isoAt(today, 14, 33),
    lastBag: isoAt(today, 14, 54),
    doorsClose: isoAt(today, 15, 35),
    blocksOff: isoAt(today, 15, 42),
  },
  services: [
    { name: 'GPU', status: 'completed' },
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'completed' },
    { name: 'Catering', status: 'not_required' },
    { name: 'Pushback', status: 'completed' },
  ],
  equipment: [
    { name: 'GPU', planned: 1, reported: 1, used: 1 },
    { name: 'Baggage Cart', planned: 2, reported: 2, used: 2 },
    { name: 'Belt Loader', planned: 1, reported: 1, used: 1 },
    { name: 'Pushback Tractor', planned: 1, reported: 1, used: 1 },
  ],
  incidents: [],
  evidence: [
    { id: 'EV-10011', name: 'Checklist de salida DM161', type: 'checklist', user: 'Carlos Medina', date: isoAt(today, 15, 40), status: 'available' },
    { id: 'EV-10012', name: 'Foto de daños — inspección previa', type: 'photo', user: 'Carlos Medina', date: isoAt(today, 14, 22), status: 'available' },
  ],
  signatures: [
    { name: 'Delta Vacations', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 15, 38) },
    { name: 'Carlos Medina', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 15, 40) },
    { name: 'Juan Pérez', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 15, 43) },
  ],
  observations: [
    { user: 'Carlos Medina', role: 'Agente', at: isoAt(today, 15, 44), comment: 'Operación sin novedades. Carga y desembarque dentro de tiempo estándar.' },
  ],
  history: [
    { at: isoAt(today, 14, 20), action: 'Operación iniciada', user: 'Carlos Medina', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 15, 42), action: 'Operación completada', user: 'Carlos Medina', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 15, 45), action: 'Reporte enviado a revisión', user: 'Carlos Medina', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
  ],
  returnReason: null,
};

// --- REV-1002 — Caso con incidencia visible, sin discrepancias de planificación. ---
const REV_1002 = {
  id: 'REV-1002',
  status: 'PENDING_REVIEW',
  priority: 'NORMAL',
  flight: { number: 'AA904', airline: 'American Airlines', airlineIata: 'AA', origin: 'MIA', destination: 'PUJ', aircraftType: 'B737-800', registration: 'N901AA' },
  schedule: { sta: isoAt(today, 9, 20), ata: isoAt(today, 9, 50), std: isoAt(today, 10, 35), atd: isoAt(today, 10, 48) },
  position: 'B21',
  agent: { id: 8, name: 'María Castillo' },
  supervisor: { id: 5, name: 'Juan Pérez' },
  submittedAt: isoAt(today, 10, 52),
  approvedAt: null,
  planned: { position: 'B21', startTime: isoAt(today, 9, 50), agents: 4, teams: 2, services: ['Baggage', 'Cleaning', 'Catering'], duration: 58, supervisor: 'Juan Pérez' },
  actual: { position: 'B21', startTime: isoAt(today, 9, 50), agents: 4, teams: 2, services: ['Baggage', 'Cleaning', 'Catering'], duration: 58, supervisor: 'Juan Pérez' },
  timeline: {
    blocksOn: isoAt(today, 9, 50),
    doorsOpen: isoAt(today, 9, 54),
    loadingStart: isoAt(today, 10, 2),
    loadingEnd: isoAt(today, 10, 26),
    boardingStart: isoAt(today, 10, 20),
    firstPax: isoAt(today, 10, 22),
    lastPax: isoAt(today, 10, 40),
    firstBag: isoAt(today, 10, 3),
    lastBag: isoAt(today, 10, 25),
    doorsClose: isoAt(today, 10, 42),
    blocksOff: isoAt(today, 10, 48),
  },
  services: [
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'completed' },
    { name: 'Catering', status: 'completed' },
    { name: 'GPU', status: 'not_required' },
    { name: 'Pushback', status: 'completed' },
  ],
  equipment: [
    { name: 'Baggage Cart', planned: 2, reported: 2, used: 2 },
    { name: 'Belt Loader', planned: 1, reported: 1, used: 1 },
    { name: 'Pushback Tractor', planned: 1, reported: 1, used: 1 },
  ],
  incidents: [
    {
      id: 'INC-2201',
      description: 'Retraso en carga de equipaje por falla de banda transportadora',
      severity: 'medium',
      reportedBy: 'María Castillo',
      occurredAt: isoAt(today, 10, 15),
      status: 'resolved',
      observation: 'Se utilizó banda alterna de la posición B19. Sin impacto en hora de salida.',
    },
  ],
  evidence: [
    { id: 'EV-22011', name: 'Reporte de falla — banda transportadora', type: 'document', user: 'María Castillo', date: isoAt(today, 10, 16), status: 'available' },
    { id: 'EV-22012', name: 'Checklist de salida AA904', type: 'checklist', user: 'María Castillo', date: isoAt(today, 10, 47), status: 'available' },
  ],
  signatures: [
    { name: 'American Airlines', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 10, 45) },
    { name: 'María Castillo', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 10, 47) },
    { name: 'Juan Pérez', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 10, 50) },
  ],
  observations: [
    { user: 'María Castillo', role: 'Agente', at: isoAt(today, 10, 51), comment: 'Incidencia menor resuelta durante la operación, sin impacto en el itinerario.' },
  ],
  history: [
    { at: isoAt(today, 9, 50), action: 'Operación iniciada', user: 'María Castillo', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 10, 48), action: 'Operación completada', user: 'María Castillo', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 10, 52), action: 'Reporte enviado a revisión', user: 'María Castillo', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
  ],
  returnReason: null,
};

// --- REV-1003 — Caso con discrepancia crítica: planificación ≠ ejecución en agentes. ---
const REV_1003 = {
  id: 'REV-1003',
  status: 'PENDING_REVIEW',
  priority: 'HIGH',
  flight: { number: 'DL2210', airline: 'Delta Air Lines', airlineIata: 'DL', origin: 'ATL', destination: 'PUJ', aircraftType: 'A321neo', registration: 'N401DL' },
  schedule: { sta: isoAt(today, 11, 35), ata: isoAt(today, 12, 25), std: isoAt(today, 13, 15), atd: isoAt(today, 13, 34) },
  position: 'B21',
  agent: { id: 3, name: 'Rafael Peña' },
  supervisor: { id: 9, name: 'Katherine Objío' },
  submittedAt: isoAt(today, 13, 40),
  approvedAt: null,
  planned: { position: 'B21', startTime: isoAt(today, 12, 25), agents: 5, teams: 2, services: ['GPU', 'Baggage', 'Cleaning'], duration: 50, supervisor: 'Katherine Objío' },
  actual: { position: 'B21', startTime: isoAt(today, 12, 32), agents: 4, teams: 2, services: ['GPU', 'Baggage', 'Cleaning'], duration: 62, supervisor: 'Katherine Objío' },
  timeline: {
    blocksOn: isoAt(today, 12, 25),
    doorsOpen: isoAt(today, 12, 32),
    loadingStart: isoAt(today, 12, 40),
    loadingEnd: isoAt(today, 13, 5),
    boardingStart: isoAt(today, 13, 0),
    firstPax: isoAt(today, 13, 3),
    lastPax: isoAt(today, 13, 22),
    firstBag: isoAt(today, 12, 41),
    lastBag: isoAt(today, 13, 4),
    doorsClose: isoAt(today, 13, 25),
    blocksOff: isoAt(today, 13, 34),
  },
  services: [
    { name: 'GPU', status: 'completed' },
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'completed' },
    { name: 'Catering', status: 'not_required' },
    { name: 'Pushback', status: 'completed' },
  ],
  equipment: [
    { name: 'GPU', planned: 1, reported: 1, used: 1 },
    { name: 'Baggage Cart', planned: 2, reported: 2, used: 2 },
    { name: 'Belt Loader', planned: 1, reported: 1, used: 1 },
    { name: 'Pushback Tractor', planned: 1, reported: 1, used: 1 },
  ],
  incidents: [
    {
      id: 'INC-3301',
      description: 'Un agente reasignado a DL2210 no se presentó a la posición',
      severity: 'high',
      reportedBy: 'Katherine Objío',
      occurredAt: isoAt(today, 12, 30),
      status: 'noted',
      observation: 'Operación continuó con 4 agentes en lugar de los 5 planificados. Requiere validación de OCC.',
    },
  ],
  evidence: [
    { id: 'EV-33011', name: 'Checklist de salida DL2210', type: 'checklist', user: 'Rafael Peña', date: isoAt(today, 13, 33), status: 'available' },
  ],
  signatures: [
    { name: 'Delta Air Lines', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 13, 30) },
    { name: 'Rafael Peña', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 13, 33) },
    { name: 'Katherine Objío', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 13, 38) },
  ],
  observations: [
    { user: 'Katherine Objío', role: 'Supervisor', at: isoAt(today, 13, 39), comment: 'Operación completada con un agente menos. Tiempos afectados marginalmente.' },
  ],
  history: [
    { at: isoAt(today, 12, 25), action: 'Operación iniciada', user: 'Rafael Peña', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 13, 34), action: 'Operación completada', user: 'Rafael Peña', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 13, 40), action: 'Reporte enviado a revisión', user: 'Rafael Peña', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
  ],
  returnReason: null,
};

// --- REV-1005 — Caso incompleto: falta firma y parte del timeline. ---
const REV_1005 = {
  id: 'REV-1005',
  status: 'PENDING_REVIEW',
  priority: 'HIGH',
  flight: { number: 'UA1470', airline: 'United Airlines', airlineIata: 'UA', origin: 'PUJ', destination: 'EWR', aircraftType: 'A330', registration: 'N281UA' },
  schedule: { sta: isoAt(today, 9, 40), ata: isoAt(today, 9, 46), std: isoAt(today, 10, 55), atd: isoAt(today, 11, 5) },
  position: 'A1',
  agent: { id: 14, name: 'José Fermín' },
  supervisor: { id: 5, name: 'Juan Pérez' },
  submittedAt: isoAt(today, 11, 10),
  approvedAt: null,
  planned: { position: 'A1', startTime: isoAt(today, 9, 46), agents: 4, teams: 1, services: ['Baggage', 'Cleaning'], duration: 79, supervisor: 'Juan Pérez' },
  actual: { position: 'A1', startTime: isoAt(today, 9, 46), agents: 4, teams: 1, services: ['Baggage', 'Cleaning'], duration: 79, supervisor: 'Juan Pérez' },
  timeline: {
    blocksOn: isoAt(today, 9, 46),
    doorsOpen: isoAt(today, 9, 50),
    loadingStart: isoAt(today, 9, 58),
    loadingEnd: null,
    boardingStart: isoAt(today, 10, 40),
    firstPax: isoAt(today, 10, 42),
    lastPax: null,
    firstBag: isoAt(today, 9, 59),
    lastBag: null,
    doorsClose: isoAt(today, 10, 58),
    blocksOff: isoAt(today, 11, 5),
  },
  services: [
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'completed' },
    { name: 'GPU', status: 'not_required' },
    { name: 'Pushback', status: 'completed' },
  ],
  equipment: [
    { name: 'Baggage Cart', planned: 2, reported: 2, used: 2 },
    { name: 'Pushback Tractor', planned: 1, reported: 1, used: 1 },
  ],
  incidents: [],
  evidence: [
    { id: 'EV-50011', name: 'Checklist de salida UA1470', type: 'checklist', user: 'José Fermín', date: isoAt(today, 11, 4), status: 'available' },
  ],
  signatures: [
    { name: 'United Airlines', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 11, 0) },
    { name: 'José Fermín', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 11, 4) },
    { name: 'Juan Pérez', role: 'Supervisor', status: 'pending', timestamp: null },
  ],
  observations: [],
  history: [
    { at: isoAt(today, 9, 46), action: 'Operación iniciada', user: 'José Fermín', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 11, 5), action: 'Operación completada', user: 'José Fermín', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 11, 10), action: 'Reporte enviado a revisión', user: 'José Fermín', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
  ],
  returnReason: null,
};

// --- REV-1008 / REV-1009 — Pendientes adicionales (variedad de aerolíneas y horarios). ---
const REV_1008 = {
  id: 'REV-1008',
  status: 'PENDING_REVIEW',
  priority: 'NORMAL',
  flight: { number: 'B6289', airline: 'JetBlue', airlineIata: 'B6', origin: 'PUJ', destination: 'JFK', aircraftType: 'B787', registration: 'N789JB' },
  schedule: { sta: isoAt(today, 12, 10), ata: isoAt(today, 12, 14), std: isoAt(today, 13, 20), atd: isoAt(today, 13, 25) },
  position: 'A1',
  agent: { id: 9, name: 'Katherine Objío' },
  supervisor: { id: 3, name: 'Rafael Peña' },
  submittedAt: isoAt(today, 13, 30),
  approvedAt: null,
  planned: { position: 'A1', startTime: isoAt(today, 12, 14), agents: 6, teams: 3, services: ['Baggage', 'Cleaning', 'Catering'], duration: 71, supervisor: 'Rafael Peña' },
  actual: { position: 'A1', startTime: isoAt(today, 12, 14), agents: 6, teams: 3, services: ['Baggage', 'Cleaning', 'Catering'], duration: 71, supervisor: 'Rafael Peña' },
  timeline: {
    blocksOn: isoAt(today, 12, 14),
    doorsOpen: isoAt(today, 12, 18),
    loadingStart: isoAt(today, 12, 26),
    loadingEnd: isoAt(today, 12, 55),
    boardingStart: isoAt(today, 12, 50),
    firstPax: isoAt(today, 12, 52),
    lastPax: isoAt(today, 13, 15),
    firstBag: isoAt(today, 12, 27),
    lastBag: isoAt(today, 12, 54),
    doorsClose: isoAt(today, 13, 18),
    blocksOff: isoAt(today, 13, 25),
  },
  services: [
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'completed' },
    { name: 'Catering', status: 'completed' },
    { name: 'GPU', status: 'completed' },
    { name: 'Pushback', status: 'completed' },
  ],
  equipment: [
    { name: 'Baggage Cart', planned: 3, reported: 3, used: 3 },
    { name: 'Belt Loader', planned: 2, reported: 2, used: 2 },
    { name: 'GPU', planned: 1, reported: 1, used: 1 },
    { name: 'Pushback Tractor', planned: 1, reported: 1, used: 1 },
  ],
  incidents: [],
  evidence: [{ id: 'EV-80011', name: 'Checklist de salida B6289', type: 'checklist', user: 'Katherine Objío', date: isoAt(today, 13, 24), status: 'available' }],
  signatures: [
    { name: 'JetBlue Airways', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 13, 20) },
    { name: 'Katherine Objío', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 13, 24) },
    { name: 'Rafael Peña', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 13, 28) },
  ],
  observations: [],
  history: [
    { at: isoAt(today, 12, 14), action: 'Operación iniciada', user: 'Katherine Objío', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 13, 25), action: 'Operación completada', user: 'Katherine Objío', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 13, 30), action: 'Reporte enviado a revisión', user: 'Katherine Objío', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
  ],
  returnReason: null,
};

const REV_1009 = {
  id: 'REV-1009',
  status: 'PENDING_REVIEW',
  priority: 'NORMAL',
  flight: { number: 'CM345', airline: 'Copa Airlines', airlineIata: 'CM', origin: 'PTY', destination: 'PUJ', aircraftType: 'B737 MAX', registration: 'HP-9901CMP' },
  schedule: { sta: isoAt(today, 10, 15), ata: isoAt(today, 10, 21), std: isoAt(today, 11, 5), atd: isoAt(today, 11, 12) },
  position: 'BN8',
  agent: { id: 3, name: 'Rafael Peña' },
  supervisor: { id: 9, name: 'Katherine Objío' },
  submittedAt: isoAt(today, 11, 15),
  approvedAt: null,
  planned: { position: 'BN8', startTime: isoAt(today, 10, 21), agents: 3, teams: 1, services: ['Desembarque', 'Baggage'], duration: 51, supervisor: 'Katherine Objío' },
  actual: { position: 'BN8', startTime: isoAt(today, 10, 21), agents: 3, teams: 1, services: ['Desembarque', 'Baggage'], duration: 51, supervisor: 'Katherine Objío' },
  timeline: {
    blocksOn: isoAt(today, 10, 21),
    doorsOpen: isoAt(today, 10, 24),
    loadingStart: isoAt(today, 10, 30),
    loadingEnd: isoAt(today, 10, 50),
    boardingStart: isoAt(today, 10, 45),
    firstPax: isoAt(today, 10, 24),
    lastPax: isoAt(today, 10, 40),
    firstBag: isoAt(today, 10, 31),
    lastBag: isoAt(today, 10, 49),
    doorsClose: isoAt(today, 11, 5),
    blocksOff: isoAt(today, 11, 12),
  },
  services: [
    { name: 'Desembarque', status: 'completed' },
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'not_required' },
  ],
  equipment: [
    { name: 'Belt Loader', planned: 1, reported: 1, used: 1 },
    { name: 'Baggage Cart', planned: 1, reported: 1, used: 1 },
  ],
  incidents: [],
  evidence: [{ id: 'EV-90011', name: 'Checklist de llegada CM345', type: 'checklist', user: 'Rafael Peña', date: isoAt(today, 11, 13), status: 'available' }],
  signatures: [
    { name: 'Copa Airlines', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 11, 8) },
    { name: 'Rafael Peña', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 11, 13) },
    { name: 'Katherine Objío', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 11, 14) },
  ],
  observations: [],
  history: [
    { at: isoAt(today, 10, 21), action: 'Operación iniciada', user: 'Rafael Peña', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 11, 12), action: 'Operación completada', user: 'Rafael Peña', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 11, 15), action: 'Reporte enviado a revisión', user: 'Rafael Peña', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
  ],
  returnReason: null,
};

// --- REV-1004 — En revisión, con problema contractual (GPU contratado 1, ejecutado 2). ---
const REV_1004 = {
  id: 'REV-1004',
  status: 'IN_REVIEW',
  priority: 'HIGH',
  flight: { number: 'AC1876', airline: 'Air Canada', airlineIata: 'AC', origin: 'PUJ', destination: 'YYZ', aircraftType: 'A320', registration: 'C-FXAC' },
  schedule: { sta: isoAt(today, 10, 0), ata: isoAt(today, 10, 6), std: isoAt(today, 11, 15), atd: isoAt(today, 11, 24) },
  position: 'A5',
  agent: { id: 12, name: 'Carlos Medina' },
  supervisor: { id: 5, name: 'Juan Pérez' },
  submittedAt: isoAt(today, 11, 30),
  approvedAt: null,
  planned: { position: 'A5', startTime: isoAt(today, 10, 6), agents: 5, teams: 2, services: ['GPU', 'Baggage'], duration: 78, supervisor: 'Juan Pérez' },
  actual: { position: 'A5', startTime: isoAt(today, 10, 6), agents: 5, teams: 2, services: ['GPU', 'Baggage'], duration: 78, supervisor: 'Juan Pérez' },
  timeline: {
    blocksOn: isoAt(today, 10, 6),
    doorsOpen: isoAt(today, 10, 10),
    loadingStart: isoAt(today, 10, 18),
    loadingEnd: isoAt(today, 10, 48),
    boardingStart: isoAt(today, 10, 55),
    firstPax: isoAt(today, 10, 57),
    lastPax: isoAt(today, 11, 15),
    firstBag: isoAt(today, 10, 19),
    lastBag: isoAt(today, 10, 47),
    doorsClose: isoAt(today, 11, 18),
    blocksOff: isoAt(today, 11, 24),
  },
  services: [
    { name: 'GPU', status: 'completed' },
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'not_required' },
    { name: 'Pushback', status: 'completed' },
  ],
  equipment: [
    { name: 'GPU', planned: 1, reported: 2, used: 2 },
    { name: 'Baggage Cart', planned: 2, reported: 2, used: 2 },
    { name: 'Pushback Tractor', planned: 1, reported: 1, used: 1 },
  ],
  incidents: [],
  evidence: [{ id: 'EV-40011', name: 'Checklist de salida AC1876', type: 'checklist', user: 'Carlos Medina', date: isoAt(today, 11, 23), status: 'available' }],
  signatures: [
    { name: 'Air Canada', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 11, 20) },
    { name: 'Carlos Medina', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 11, 23) },
    { name: 'Juan Pérez', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 11, 27) },
  ],
  reconciliation: [
    { concept: 'GPU adicional', unit: 'unidad', contracted: 1, executed: 2, note: 'Se utilizó una segunda unidad de GPU por indisponibilidad de la principal.' },
    { concept: 'Baggage Handling', unit: 'agentes', contracted: 4, executed: 4, note: '' },
  ],
  observations: [
    { user: 'Administrador OCC', role: 'OCC', at: isoAt(today, 11, 32), comment: 'Iniciando revisión por concepto facturable adicional (GPU).' },
  ],
  history: [
    { at: isoAt(today, 10, 6), action: 'Operación iniciada', user: 'Carlos Medina', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 11, 24), action: 'Operación completada', user: 'Carlos Medina', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 11, 30), action: 'Reporte enviado a revisión', user: 'Carlos Medina', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
    { at: isoAt(today, 11, 32), action: 'Revisión iniciada', user: 'Administrador OCC', fromStatus: 'PENDING_REVIEW', toStatus: 'IN_REVIEW', comment: '' },
  ],
  returnReason: null,
};

const REV_1010 = {
  id: 'REV-1010',
  status: 'IN_REVIEW',
  priority: 'NORMAL',
  flight: { number: 'WG654', airline: 'Sunwing', airlineIata: 'WG', origin: 'PUJ', destination: 'YYZ', aircraftType: 'A321neo', registration: 'C-GOWG' },
  schedule: { sta: isoAt(today, 8, 45), ata: isoAt(today, 8, 51), std: isoAt(today, 10, 0), atd: isoAt(today, 10, 9) },
  position: 'B32',
  agent: { id: 8, name: 'María Castillo' },
  supervisor: { id: 5, name: 'Juan Pérez' },
  submittedAt: isoAt(today, 10, 15),
  approvedAt: null,
  planned: { position: 'B32', startTime: isoAt(today, 8, 51), agents: 4, teams: 2, services: ['Baggage', 'Cleaning'], duration: 78, supervisor: 'Juan Pérez' },
  actual: { position: 'B32', startTime: isoAt(today, 8, 51), agents: 4, teams: 2, services: ['Baggage', 'Cleaning'], duration: 78, supervisor: 'Juan Pérez' },
  timeline: {
    blocksOn: isoAt(today, 8, 51),
    doorsOpen: isoAt(today, 8, 55),
    loadingStart: isoAt(today, 9, 3),
    loadingEnd: isoAt(today, 9, 33),
    boardingStart: isoAt(today, 9, 40),
    firstPax: isoAt(today, 9, 42),
    lastPax: isoAt(today, 9, 58),
    firstBag: isoAt(today, 9, 4),
    lastBag: isoAt(today, 9, 32),
    doorsClose: isoAt(today, 10, 2),
    blocksOff: isoAt(today, 10, 9),
  },
  services: [
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'completed' },
    { name: 'GPU', status: 'not_required' },
  ],
  equipment: [
    { name: 'Baggage Cart', planned: 2, reported: 2, used: 2 },
  ],
  incidents: [],
  evidence: [{ id: 'EV-100011', name: 'Checklist de salida WG654', type: 'checklist', user: 'María Castillo', date: isoAt(today, 10, 8), status: 'available' }],
  signatures: [
    { name: 'Sunwing Airlines', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 10, 5) },
    { name: 'María Castillo', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 10, 8) },
    { name: 'Juan Pérez', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 10, 12) },
  ],
  reconciliation: [{ concept: 'Baggage Handling', unit: 'agentes', contracted: 4, executed: 4, note: '' }],
  observations: [],
  history: [
    { at: isoAt(today, 8, 51), action: 'Operación iniciada', user: 'María Castillo', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 10, 9), action: 'Operación completada', user: 'María Castillo', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 10, 15), action: 'Reporte enviado a revisión', user: 'María Castillo', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
    { at: isoAt(today, 10, 20), action: 'Revisión iniciada', user: 'Administrador OCC', fromStatus: 'PENDING_REVIEW', toStatus: 'IN_REVIEW', comment: '' },
  ],
  returnReason: null,
};

const REV_1011 = {
  id: 'REV-1011',
  status: 'IN_REVIEW',
  priority: 'NORMAL',
  flight: { number: 'TS234', airline: 'Air Transat', airlineIata: 'TS', origin: 'PUJ', destination: 'YUL', aircraftType: 'A330', registration: 'C-GTSJ' },
  schedule: { sta: isoAt(today, 12, 0), ata: isoAt(today, 12, 5), std: isoAt(today, 13, 30), atd: isoAt(today, 13, 38) },
  position: 'A1',
  agent: { id: 3, name: 'Rafael Peña' },
  supervisor: { id: 3, name: 'María Castillo' },
  submittedAt: isoAt(today, 13, 42),
  approvedAt: null,
  planned: { position: 'A1', startTime: isoAt(today, 12, 5), agents: 6, teams: 3, services: ['Baggage', 'Cleaning', 'Catering'], duration: 93, supervisor: 'María Castillo' },
  actual: { position: 'A1', startTime: isoAt(today, 12, 5), agents: 6, teams: 3, services: ['Baggage', 'Cleaning', 'Catering'], duration: 93, supervisor: 'María Castillo' },
  timeline: {
    blocksOn: isoAt(today, 12, 5),
    doorsOpen: isoAt(today, 12, 9),
    loadingStart: isoAt(today, 12, 17),
    loadingEnd: isoAt(today, 12, 55),
    boardingStart: isoAt(today, 13, 5),
    firstPax: isoAt(today, 13, 7),
    lastPax: isoAt(today, 13, 28),
    firstBag: isoAt(today, 12, 18),
    lastBag: isoAt(today, 12, 54),
    doorsClose: isoAt(today, 13, 32),
    blocksOff: isoAt(today, 13, 38),
  },
  services: [
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'completed' },
    { name: 'Catering', status: 'completed' },
    { name: 'GPU', status: 'completed' },
  ],
  equipment: [
    { name: 'Baggage Cart', planned: 3, reported: 3, used: 3 },
    { name: 'GPU', planned: 1, reported: 1, used: 1 },
  ],
  incidents: [],
  evidence: [{ id: 'EV-110011', name: 'Checklist de salida TS234', type: 'checklist', user: 'Rafael Peña', date: isoAt(today, 13, 37), status: 'available' }],
  signatures: [
    { name: 'Air Transat', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 13, 34) },
    { name: 'Rafael Peña', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 13, 37) },
    { name: 'María Castillo', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 13, 40) },
  ],
  reconciliation: [{ concept: 'Catering', unit: 'unidad', contracted: 1, executed: 1, note: '' }],
  observations: [],
  history: [
    { at: isoAt(today, 12, 5), action: 'Operación iniciada', user: 'Rafael Peña', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 13, 38), action: 'Operación completada', user: 'Rafael Peña', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 13, 42), action: 'Reporte enviado a revisión', user: 'Rafael Peña', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
    { at: isoAt(today, 13, 50), action: 'Revisión iniciada', user: 'Administrador OCC', fromStatus: 'PENDING_REVIEW', toStatus: 'IN_REVIEW', comment: '' },
  ],
  returnReason: null,
};

// --- Aprobadas hoy ---
function buildApproved(id, overrides) {
  return {
    id,
    status: 'APPROVED',
    priority: 'NORMAL',
    submittedAt: isoAt(today, 8, 0),
    approvedAt: isoAt(today, 8, 20),
    planned: { position: 'A5', startTime: isoAt(today, 7, 30), agents: 4, teams: 2, services: ['GPU', 'Baggage'], duration: 60, supervisor: 'Juan Pérez' },
    actual: { position: 'A5', startTime: isoAt(today, 7, 30), agents: 4, teams: 2, services: ['GPU', 'Baggage'], duration: 60, supervisor: 'Juan Pérez' },
    timeline: {},
    services: [
      { name: 'GPU', status: 'completed' },
      { name: 'Baggage', status: 'completed' },
    ],
    equipment: [{ name: 'GPU', planned: 1, reported: 1, used: 1 }],
    incidents: [],
    evidence: [],
    signatures: [
      { name: 'Aerolínea', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 8, 15) },
      { name: 'Agente', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 8, 16) },
      { name: 'Juan Pérez', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 8, 18) },
    ],
    reconciliation: [],
    observations: [],
    history: [
      { at: isoAt(today, 8, 0), action: 'Reporte enviado a revisión', user: 'Agente', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
      { at: isoAt(today, 8, 10), action: 'Revisión iniciada', user: 'Administrador OCC', fromStatus: 'PENDING_REVIEW', toStatus: 'IN_REVIEW', comment: '' },
      { at: isoAt(today, 8, 20), action: 'Operación aprobada', user: 'Administrador OCC', fromStatus: 'IN_REVIEW', toStatus: 'APPROVED', comment: '' },
    ],
    returnReason: null,
    agent: { id: 12, name: 'Carlos Medina' },
    supervisor: { id: 5, name: 'Juan Pérez' },
    position: 'A5',
    ...overrides,
  };
}

const REV_0995 = buildApproved('REV-0995', {
  flight: { number: 'AA123', airline: 'American Airlines', airlineIata: 'AA', origin: 'PUJ', destination: 'MIA', aircraftType: 'B737-800', registration: 'N902AA' },
  schedule: { sta: isoAt(today, 7, 20), ata: isoAt(today, 7, 26), std: isoAt(today, 8, 20), atd: isoAt(today, 8, 27) },
});
const REV_0996 = buildApproved('REV-0996', {
  flight: { number: 'DM220', airline: 'Arajet', airlineIata: 'DM', origin: 'PUJ', destination: 'SDQ', aircraftType: 'A320', registration: 'HI1055' },
  schedule: { sta: isoAt(today, 6, 15), ata: isoAt(today, 6, 20), std: isoAt(today, 7, 15), atd: isoAt(today, 7, 21) },
  approvedAt: isoAt(today, 7, 40),
});
const REV_0997 = buildApproved('REV-0997', {
  flight: { number: 'DL500', airline: 'Delta Air Lines', airlineIata: 'DL', origin: 'JFK', destination: 'PUJ', aircraftType: 'B787', registration: 'N702DL' },
  schedule: { sta: isoAt(today, 5, 0), ata: isoAt(today, 5, 8), std: isoAt(today, 6, 0), atd: isoAt(today, 6, 12) },
  approvedAt: isoAt(today, 6, 30),
});
const REV_0998 = buildApproved('REV-0998', {
  flight: { number: 'AA455', airline: 'American Airlines', airlineIata: 'AA', origin: 'MIA', destination: 'PUJ', aircraftType: 'B737 MAX', registration: 'N903AA' },
  schedule: { sta: isoAt(today, 4, 10), ata: isoAt(today, 4, 18), std: isoAt(today, 5, 10), atd: isoAt(today, 5, 20) },
  approvedAt: isoAt(today, 5, 35),
});

// --- REV-1006 — Devuelta con correcciones. ---
const REV_1006 = {
  id: 'REV-1006',
  status: 'RETURNED',
  priority: 'HIGH',
  flight: { number: 'B6812', airline: 'JetBlue', airlineIata: 'B6', origin: 'PUJ', destination: 'BOS', aircraftType: 'A320', registration: 'N812JB' },
  schedule: { sta: isoAt(today, 7, 0), ata: isoAt(today, 7, 5), std: isoAt(today, 8, 5), atd: isoAt(today, 8, 20) },
  position: 'A1',
  agent: { id: 14, name: 'José Fermín' },
  supervisor: { id: 5, name: 'Juan Pérez' },
  submittedAt: isoAt(today, 8, 25),
  approvedAt: null,
  planned: { position: 'A1', startTime: isoAt(today, 7, 5), agents: 5, teams: 2, services: ['Baggage', 'Cleaning', 'Catering'], duration: 60, supervisor: 'Juan Pérez' },
  actual: { position: 'A1', startTime: isoAt(today, 7, 5), agents: 3, teams: 1, services: ['Baggage'], duration: 75, supervisor: 'Juan Pérez' },
  timeline: {
    blocksOn: isoAt(today, 7, 5),
    doorsOpen: isoAt(today, 7, 9),
    loadingStart: isoAt(today, 7, 20),
    loadingEnd: null,
    boardingStart: isoAt(today, 7, 55),
    firstPax: isoAt(today, 7, 57),
    lastPax: null,
    firstBag: isoAt(today, 7, 21),
    lastBag: null,
    doorsClose: isoAt(today, 8, 12),
    blocksOff: isoAt(today, 8, 20),
  },
  services: [
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'pending' },
    { name: 'Catering', status: 'pending' },
  ],
  equipment: [{ name: 'Baggage Cart', planned: 2, reported: 1, used: 1 }],
  incidents: [
    {
      id: 'INC-6601',
      description: 'Servicio de limpieza y catering no reportado como completado',
      severity: 'high',
      reportedBy: 'Juan Pérez',
      occurredAt: isoAt(today, 8, 22),
      status: 'open',
      observation: 'Falta evidencia de cierre de ambos servicios.',
    },
  ],
  evidence: [{ id: 'EV-66011', name: 'Checklist parcial B6812', type: 'checklist', user: 'José Fermín', date: isoAt(today, 8, 21), status: 'available' }],
  signatures: [
    { name: 'JetBlue Airways', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 8, 18) },
    { name: 'José Fermín', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 8, 21) },
    { name: 'Juan Pérez', role: 'Supervisor', status: 'pending', timestamp: null },
  ],
  reconciliation: [
    { concept: 'Cleaning', unit: 'servicio', contracted: 1, executed: 0, note: 'No se reportó ejecución del servicio contratado.' },
    { concept: 'Catering', unit: 'servicio', contracted: 1, executed: 0, note: 'No se reportó ejecución del servicio contratado.' },
  ],
  observations: [
    { user: 'Juan Pérez', role: 'Supervisor', at: isoAt(today, 8, 40), comment: 'Se devuelve para que el agente complete evidencia de limpieza y catering.' },
  ],
  history: [
    { at: isoAt(today, 7, 5), action: 'Operación iniciada', user: 'José Fermín', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 8, 20), action: 'Operación completada', user: 'José Fermín', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 8, 25), action: 'Reporte enviado a revisión', user: 'José Fermín', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
    { at: isoAt(today, 8, 35), action: 'Revisión iniciada', user: 'Administrador OCC', fromStatus: 'PENDING_REVIEW', toStatus: 'IN_REVIEW', comment: '' },
    {
      at: isoAt(today, 8, 42),
      action: 'Devuelto con correcciones',
      user: 'Administrador OCC',
      fromStatus: 'IN_REVIEW',
      toStatus: 'RETURNED',
      comment: 'Falta evidencia de cierre de limpieza y catering. Completar antes de reenviar.',
    },
  ],
  returnReason: 'Falta evidencia de cierre de limpieza y catering. Completar antes de reenviar.',
};

const REV_1012 = {
  id: 'REV-1012',
  status: 'RETURNED',
  priority: 'NORMAL',
  flight: { number: 'AA904', airline: 'American Airlines', airlineIata: 'AA', origin: 'PUJ', destination: 'MIA', aircraftType: 'B737-800', registration: 'N904AA' },
  schedule: { sta: isoAt(today, 6, 30), ata: isoAt(today, 6, 34), std: isoAt(today, 7, 25), atd: isoAt(today, 7, 33) },
  position: 'A5',
  agent: { id: 12, name: 'Carlos Medina' },
  supervisor: { id: 5, name: 'Juan Pérez' },
  submittedAt: isoAt(today, 7, 38),
  approvedAt: null,
  planned: { position: 'A5', startTime: isoAt(today, 6, 34), agents: 4, teams: 2, services: ['GPU', 'Baggage'], duration: 51, supervisor: 'Juan Pérez' },
  actual: { position: 'A5', startTime: isoAt(today, 6, 34), agents: 4, teams: 2, services: ['GPU', 'Baggage'], duration: 59, supervisor: 'Juan Pérez' },
  timeline: {
    blocksOn: isoAt(today, 6, 34),
    doorsOpen: isoAt(today, 6, 38),
    loadingStart: isoAt(today, 6, 46),
    loadingEnd: isoAt(today, 7, 10),
    boardingStart: isoAt(today, 7, 5),
    firstPax: isoAt(today, 7, 7),
    lastPax: isoAt(today, 7, 22),
    firstBag: isoAt(today, 6, 47),
    lastBag: isoAt(today, 7, 9),
    doorsClose: isoAt(today, 7, 25),
    blocksOff: isoAt(today, 7, 33),
  },
  services: [
    { name: 'GPU', status: 'completed' },
    { name: 'Baggage', status: 'completed' },
  ],
  equipment: [{ name: 'GPU', planned: 1, reported: 1, used: 1 }],
  incidents: [],
  evidence: [],
  signatures: [
    { name: 'American Airlines', role: 'Representante de aerolínea', status: 'pending', timestamp: null },
    { name: 'Carlos Medina', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 7, 34) },
    { name: 'Juan Pérez', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 7, 36) },
  ],
  reconciliation: [],
  observations: [
    { user: 'Administrador OCC', role: 'OCC', at: isoAt(today, 7, 55), comment: 'Falta la firma del representante de la aerolínea.' },
  ],
  history: [
    { at: isoAt(today, 6, 34), action: 'Operación iniciada', user: 'Carlos Medina', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 7, 33), action: 'Operación completada', user: 'Carlos Medina', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 7, 38), action: 'Reporte enviado a revisión', user: 'Carlos Medina', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
    {
      at: isoAt(today, 7, 55),
      action: 'Devuelto con correcciones',
      user: 'Administrador OCC',
      fromStatus: 'PENDING_REVIEW',
      toStatus: 'RETURNED',
      comment: 'Falta la firma del representante de la aerolínea.',
    },
  ],
  returnReason: 'Falta la firma del representante de la aerolínea.',
};

// --- REV-1007 — Reenviada tras corrección; conserva el historial de la devolución previa. ---
const REV_1007 = {
  id: 'REV-1007',
  status: 'RESUBMITTED',
  priority: 'NORMAL',
  flight: { number: 'CM110', airline: 'Copa Airlines', airlineIata: 'CM', origin: 'PUJ', destination: 'PTY', aircraftType: 'A320', registration: 'HP-9902CMP' },
  schedule: { sta: isoAt(today, 5, 45), ata: isoAt(today, 5, 50), std: isoAt(today, 6, 45), atd: isoAt(today, 6, 55) },
  position: 'B32',
  agent: { id: 3, name: 'Rafael Peña' },
  supervisor: { id: 9, name: 'Katherine Objío' },
  submittedAt: isoAt(today, 7, 0),
  approvedAt: null,
  planned: { position: 'B32', startTime: isoAt(today, 5, 50), agents: 4, teams: 2, services: ['Baggage', 'Cleaning'], duration: 65, supervisor: 'Katherine Objío' },
  actual: { position: 'B32', startTime: isoAt(today, 5, 50), agents: 4, teams: 2, services: ['Baggage', 'Cleaning'], duration: 65, supervisor: 'Katherine Objío' },
  timeline: {
    blocksOn: isoAt(today, 5, 50),
    doorsOpen: isoAt(today, 5, 54),
    loadingStart: isoAt(today, 6, 2),
    loadingEnd: isoAt(today, 6, 30),
    boardingStart: isoAt(today, 6, 35),
    firstPax: isoAt(today, 6, 37),
    lastPax: isoAt(today, 6, 48),
    firstBag: isoAt(today, 6, 3),
    lastBag: isoAt(today, 6, 29),
    doorsClose: isoAt(today, 6, 50),
    blocksOff: isoAt(today, 6, 55),
  },
  services: [
    { name: 'Baggage', status: 'completed' },
    { name: 'Cleaning', status: 'completed' },
  ],
  equipment: [{ name: 'Baggage Cart', planned: 2, reported: 2, used: 2 }],
  incidents: [],
  evidence: [
    { id: 'EV-70011', name: 'Checklist de salida CM110 (corregido)', type: 'checklist', user: 'Rafael Peña', date: isoAt(today, 7, 9), status: 'available' },
    { id: 'EV-70012', name: 'Evidencia fotográfica de limpieza completada', type: 'photo', user: 'Rafael Peña', date: isoAt(today, 7, 8), status: 'available' },
  ],
  signatures: [
    { name: 'Copa Airlines', role: 'Representante de aerolínea', status: 'signed', timestamp: isoAt(today, 6, 52) },
    { name: 'Rafael Peña', role: 'Agente de rampa', status: 'signed', timestamp: isoAt(today, 6, 58) },
    { name: 'Katherine Objío', role: 'Supervisor', status: 'signed', timestamp: isoAt(today, 7, 9) },
  ],
  reconciliation: [],
  observations: [
    { user: 'Rafael Peña', role: 'Agente', at: isoAt(today, 7, 10), comment: 'Se adjunta evidencia fotográfica de limpieza solicitada por OCC.' },
  ],
  history: [
    { at: isoAt(today, 5, 50), action: 'Operación iniciada', user: 'Rafael Peña', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 6, 55), action: 'Operación completada', user: 'Rafael Peña', fromStatus: null, toStatus: null, comment: '' },
    { at: isoAt(today, 6, 58), action: 'Reporte enviado a revisión', user: 'Rafael Peña', fromStatus: null, toStatus: 'PENDING_REVIEW', comment: '' },
    { at: isoAt(today, 6, 59), action: 'Revisión iniciada', user: 'Administrador OCC', fromStatus: 'PENDING_REVIEW', toStatus: 'IN_REVIEW', comment: '' },
    {
      at: isoAt(today, 7, 2),
      action: 'Devuelto con correcciones',
      user: 'Administrador OCC',
      fromStatus: 'IN_REVIEW',
      toStatus: 'RETURNED',
      comment: 'Falta evidencia fotográfica del servicio de limpieza.',
    },
    { at: isoAt(today, 7, 10), action: 'Corrección enviada nuevamente', user: 'Rafael Peña', fromStatus: 'RETURNED', toStatus: 'RESUBMITTED', comment: 'Evidencia fotográfica adjuntada.' },
  ],
  returnReason: null,
};

const REVIEW_OPERATIONS = [
  REV_1001,
  REV_1002,
  REV_1003,
  REV_1004,
  REV_1005,
  REV_1006,
  REV_1007,
  REV_1008,
  REV_1009,
  REV_1010,
  REV_1011,
  REV_1012,
  REV_0995,
  REV_0996,
  REV_0997,
  REV_0998,
];

// Copia mutable en memoria: simula persistencia de estado entre llamadas del adaptador.
let store = REVIEW_OPERATIONS.map(operation => structuredCloneOperation(operation));

function structuredCloneOperation(operation) {
  return JSON.parse(JSON.stringify(operation));
}

function nowIso() {
  return new Date().toISOString();
}

function findOperationOrThrow(id) {
  const operation = store.find(item => item.id === id);
  if (!operation) throw new Error(`No existe la operación de revisión ${id}`);
  return operation;
}

function appendHistory(operation, entry) {
  operation.history = [...operation.history, { at: nowIso(), ...entry }];
}

export async function getReviewQueue(stationCode = 'PUJ') {
  if (usesPrototypeApi()) return reviewApi(`/api/occ/reviews?station=${encodeURIComponent(stationCode)}`);
  return {
    station: { code: stationCode, localAbbr: 'AST' },
    date: getOperationDate(),
    operations: structuredCloneOperation(store),
  };
}

export async function getReviewOperation(id) {
  if (usesPrototypeApi()) return reviewApi(`/api/occ/reviews/${encodeURIComponent(id)}`);
  return structuredCloneOperation(findOperationOrThrow(id));
}

export async function startReview(id, { user }) {
  if (usesPrototypeApi()) return reviewApi(`/api/occ/reviews/${encodeURIComponent(id)}/start`, { method: 'POST', body: JSON.stringify({ user }) });
  const operation = findOperationOrThrow(id);
  const fromStatus = operation.status;
  operation.status = 'IN_REVIEW';
  appendHistory(operation, { action: 'Revisión iniciada', user, fromStatus, toStatus: 'IN_REVIEW', comment: '' });
  return structuredCloneOperation(operation);
}

export async function approveReviewOperation(id, { user, comment = '' } = {}) {
  if (usesPrototypeApi()) return reviewApi(`/api/occ/reviews/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ user, comment }) });
  const operation = findOperationOrThrow(id);
  const fromStatus = operation.status;
  operation.status = 'APPROVED';
  operation.approvedAt = nowIso();
  appendHistory(operation, { action: 'Operación aprobada', user, fromStatus, toStatus: 'APPROVED', comment });
  return structuredCloneOperation(operation);
}

export async function returnReviewOperation(id, { user, reason }) {
  if (!reason || !reason.trim()) throw new Error('El motivo de devolución es obligatorio.');
  if (usesPrototypeApi()) return reviewApi(`/api/occ/reviews/${encodeURIComponent(id)}/return`, { method: 'POST', body: JSON.stringify({ user, reason }) });
  const operation = findOperationOrThrow(id);
  const fromStatus = operation.status;
  operation.status = 'RETURNED';
  operation.returnReason = reason.trim();
  appendHistory(operation, { action: 'Devuelto con correcciones', user, fromStatus, toStatus: 'RETURNED', comment: reason.trim() });
  return structuredCloneOperation(operation);
}

export async function bulkApproveReviewOperations(ids, meta = {}) {
  const results = [];
  for (const id of ids) {
    results.push(await approveReviewOperation(id, meta));
  }
  return results;
}

export async function bulkReturnReviewOperations(ids, meta = {}) {
  const results = [];
  for (const id of ids) {
    results.push(await returnReviewOperation(id, meta));
  }
  return results;
}

// Únicamente para pruebas: restaura el store mock a su estado inicial.
export function __resetReviewStoreForTests() {
  store = REVIEW_OPERATIONS.map(operation => structuredCloneOperation(operation));
}
