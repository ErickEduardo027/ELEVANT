import { OCC_ACCESS, STATION, createOccApi } from './occApi.mjs';

// Synthetic answers of the ELEVANT API for the OCC work screens of the visual suite (PR U6), one screen at a time:
// Revisión, Cobertura de posiciones and Notificaciones. On top of occApi.mjs (the OCC session's access and the
// positions board) it answers the reads every OCC screen makes through its frame (the notices and the account-change
// feed, both empty and valid) and the reads of each screen, in one of four scenarios: `data`, `empty`, `error` (a
// 500) and `forbidden` (a 403). Every answer passes the strict validators of @elevant/api-client
// (tests/visualScreensFixtures.test.js checks them). Every id, code, name and time is invented.

export const SCREEN_SCENARIOS = Object.freeze(['data', 'empty', 'error', 'forbidden']);

export const STATION_TIME_ZONE = 'America/Santo_Domingo';
const STATION_NAME = 'Aeropuerto de prueba de Punta Cana';
const OPERATION_DATE = '2026-11-13';

const uuid = (group, index) => `${group}-0000-4000-8000-${String(index).padStart(12, '0')}`;
// An instant of the operation date, in UTC (Santo Domingo is UTC−4: 14:30Z is 10:30 local).
const at = time => `${OPERATION_DATE}T${time}:00Z`;
const sha = digit => digit.repeat(64);

/** The department access of the review: the OCC administrator, who also reads the live incidents of an operation. */
export const SCREENS_ACCESS = Object.freeze({
  ...OCC_ACCESS,
  permissions: Object.freeze([...OCC_ACCESS.permissions, 'operations.incidents.read']),
});

export const API_PATHS = Object.freeze({
  access: '/api/v1/governance/me/access',
  notices: '/api/v1/notifications',
  changes: '/api/v1/changes',
  reviewQueue: '/api/v1/occ/review/queue',
  coverage: '/api/v1/occ/coverage',
});

/** The ids of the review's hand-offs: the one the spec opens, and the rest of the queue. */
export const REVIEW_IDS = Object.freeze({
  pending: uuid('7e1a2b3c', 4),
  pendingSubmission: uuid('7e2a2b3c', 4),
  earlierSubmission: uuid('7e2a2b3c', 104),
  secondPending: uuid('7e1a2b3c', 5),
  approved: uuid('7e1a2b3c', 2),
  returned: uuid('7e1a2b3c', 3),
});
const REVIEW_VERSION = `"${sha('7')}"`;

// The services of the hand-off the spec opens, as the detail and the close name them.
const SERVICES = Object.freeze({
  gpu: uuid('5a1b2c3d', 1),
  baggage: uuid('5a1b2c3d', 2),
  pushback: uuid('5a1b2c3d', 3),
});

function queueRow({ operationId, submissionId, revisionNumber = 1, status, code, operationDate = OPERATION_DATE,
  agentName, submittedAt, serviceCount, incidentCount }) {
  return {
    operationId, submissionId, revisionNumber, status, operationCode: code, operationDate,
    airlineName: 'Aerolínea de prueba', agentName, submittedAt, serviceCount, incidentCount,
  };
}

/**
 * GET occ/review/queue?stationId=: two hand-offs waiting, one approved and one returned to the ramp (sent after the
 * local midnight of its operation date), or none in the `empty` scenario.
 */
export function reviewQueue(scenario = 'data', stationId = STATION.stationId) {
  const operations = scenario === 'empty' ? [] : [
    queueRow({ operationId: REVIEW_IDS.pending, submissionId: REVIEW_IDS.pendingSubmission, revisionNumber: 2,
      status: 'PendingReview', code: 'PUJ-20261113-004', agentName: 'Agente de prueba Uno', submittedAt: at('15:42'),
      serviceCount: 3, incidentCount: 1 }),
    queueRow({ operationId: REVIEW_IDS.secondPending, submissionId: uuid('7e2a2b3c', 5), status: 'PendingReview',
      code: 'PUJ-20261113-005', agentName: 'Agente de prueba Dos', submittedAt: at('16:10'), serviceCount: 2,
      incidentCount: 0 }),
    queueRow({ operationId: REVIEW_IDS.approved, submissionId: uuid('7e2a2b3c', 2), status: 'Approved',
      code: 'PUJ-20261113-002', agentName: 'Agente de prueba Uno', submittedAt: at('12:05'), serviceCount: 4,
      incidentCount: 0 }),
    queueRow({ operationId: REVIEW_IDS.returned, submissionId: uuid('7e2a2b3c', 3), status: 'Returned',
      code: 'PUJ-20261112-009', operationDate: '2026-11-12', agentName: 'Agente de prueba Dos',
      submittedAt: at('04:05'), serviceCount: 2, incidentCount: 2 }),
  ];
  return {
    stationId, stationCode: STATION.stationCode, stationName: STATION_NAME, ianaTimeZone: STATION_TIME_ZONE,
    operations, hasMore: false,
  };
}

// Eight milestones of the flight report the agent recorded, in the order they happened.
const MILESTONES = Object.freeze([
  ['BLOCK_ON', '14:34'], ['STAIRS_JETBRIDGE', '14:36'], ['WALKAROUND_START', '14:37'], ['UNLOADING_EQUIPMENT', '14:39'],
  ['WALKAROUND_END', '14:43'], ['FIRST_CUSTOMS', '14:46'], ['UNLOAD_SHEET', '14:52'], ['LOAD_SHEET', '15:21'],
].map(([code, time]) => Object.freeze({ code, actualAt: at(time) })));

/** GET occ/review/operations/{id} of the hand-off the spec opens (its ETag is `reviewVersion`). */
export function reviewDetail(operationId = REVIEW_IDS.pending) {
  return {
    operationId, submissionId: REVIEW_IDS.pendingSubmission, revisionNumber: 2, status: 'PendingReview',
    operationCode: 'PUJ-20261113-004', operationDate: OPERATION_DATE, stationId: STATION.stationId,
    stationCode: STATION.stationCode, ianaTimeZone: STATION_TIME_ZONE, airlineName: 'Aerolínea de prueba',
    agentName: 'Agente de prueba Uno',
    plannedStartAt: at('14:30'), plannedEndAt: at('15:30'), actualStartAt: at('14:34'), actualEndAt: at('15:38'),
    submittedAt: at('15:42'), agentNote: 'Sin novedad en la rampa; el GPU se retiró antes del push-back.',
    checklistStatus: 'Submitted',
    checklistAnswers: [
      { section: 'Puente', code: 'BRIDGE_CHECK', label: 'Puente verificado', value: 'Ok', note: null },
      { section: 'Seguridad', code: 'CONES', label: 'Conos colocados', value: 'Ok', note: null },
      { section: 'Seguridad', code: 'FOD', label: 'Revisión de objetos sueltos', value: 'NotOk',
        note: 'Se retiró un tornillo de la posición.' },
    ],
    services: [
      { id: SERVICES.gpu, code: 'GPU', name: 'Planta de energía', status: 'Completed', contractedQuantity: 1,
        executedQuantity: 1, unit: 'hour' },
      { id: SERVICES.baggage, code: 'BAGGAGE', name: 'Manejo de equipaje', status: 'Completed',
        contractedQuantity: 1, executedQuantity: 1, unit: 'operation' },
      { id: SERVICES.pushback, code: 'PUSHBACK', name: 'Remolque', status: 'Exception', contractedQuantity: 1,
        executedQuantity: 1, unit: 'operation' },
    ],
    incidents: [
      { id: uuid('1c1d2e3f', 1), type: 'Operational', severity: 'Low', status: 'Open',
        description: 'La aeronave llegó 12 minutos tarde por rotación.', occurredAt: at('14:22'), delayCode: '93' },
    ],
    decision: null,
    reviewVersion: REVIEW_VERSION,
    serviceOrderState: 'Signed',
    reopening: null,
    close: {
      milestones: MILESTONES,
      charges: [
        { markId: uuid('3a1b2c3d', 1), serviceId: SERVICES.gpu, serviceCode: 'GPU', chargeId: uuid('4a1b2c3d', 1),
          code: 'NIGHT', name: 'Recargo nocturno', source: 'Automatic', appliedAt: at('15:42'), reason: null },
        { markId: uuid('3a1b2c3d', 2), serviceId: SERVICES.baggage, serviceCode: 'BAGGAGE',
          chargeId: uuid('4a1b2c3d', 2), code: 'DELAY', name: 'Demora de llegada', source: 'Occ', appliedAt: at('15:50'),
          reason: 'La aeronave llegó 12 minutos tarde.' },
      ],
      chargeOptions: [
        { chargeId: uuid('4a1b2c3d', 3), code: 'HOLIDAY', name: 'Recargo por feriado', appliesToAllServices: true,
          serviceIds: Object.values(SERVICES) },
      ],
      timing: { groundMinutes: 64, allowedGroundMinutes: 60, arrivalDelayMinutes: 12, aircraftCategory: 'Narrowbody' },
      canAdjustCharges: true,
      damageCount: 1,
      billingExclusions: [],
    },
  };
}

/** GET occ/review/operations/{id}/submissions: the revision on screen and the earlier one, returned to the ramp. */
export function reviewHistory(operationId = REVIEW_IDS.pending) {
  return {
    operationId, hasMore: false,
    submissions: [
      { submissionId: REVIEW_IDS.pendingSubmission, revisionNumber: 2, status: 'PendingReview', submittedAt: at('15:42'),
        outcome: null, decidedAt: null },
      { submissionId: REVIEW_IDS.earlierSubmission, revisionNumber: 1, status: 'Returned', submittedAt: at('15:30'),
        outcome: 'Returned', decidedAt: at('15:35') },
    ],
  };
}

function reviewForm(kind, { number, title, formCode, requiredRoles, signatures, staleRoles }) {
  return {
    kind, number, title, formCode, contentSha256: sha(kind === 'ServiceOrder' ? 'a' : kind === 'FlightReport' ? 'b' : 'c'),
    requiredRoles, signatures, staleRoles, isFullySigned: signatures.length === requiredRoles.length && staleRoles.length === 0,
    summary: {
      flightIn: 'ZZ104', flightOut: 'ZZ204', registration: 'HI1004', aircraftType: 'Airbus A320', position: 'A4',
      passengersIn: 142, passengersOut: 150, mtowKg: 78_000,
      services: [{ code: 'GPU', name: 'Planta de energía', quantity: 1, unit: 'hour', amount: null }],
      surcharges: ['Recargo nocturno'], currencyCode: 'USD', totalAmount: null,
      milestoneCount: MILESTONES.length, checklistAnswered: 3, checklistTotal: 3, damageCount: 1,
    },
  };
}

/** GET occ/operations/{id}/documents: the three forms of the hand-off and its one walk-around damage, without a photo. */
export function reviewDocuments(operationId = REVIEW_IDS.pending) {
  return {
    operationId,
    documents: [
      reviewForm('ServiceOrder', { number: 'PUJ000000004', title: 'Orden de Servicio en Rampa', formCode: 'F-RAM-AVL-MAG 04',
        requiredRoles: ['AirlineRepresentative', 'AviamAgent'],
        signatures: [
          { role: 'AirlineRepresentative', signerName: 'Representante de prueba', signedAt: at('15:40') },
          { role: 'AviamAgent', signerName: 'Agente de prueba Uno', signedAt: at('15:41') },
        ], staleRoles: [] }),
      reviewForm('FlightReport', { number: 'PUJ000000004', title: 'Reporte de Vuelo', formCode: 'F-RAM-AVL-MAG 02',
        requiredRoles: ['Coordinator'], signatures: [], staleRoles: [] }),
      reviewForm('BridgeChecklist', { number: 'PUJ000000004', title: 'Check-List y Reporte Diario del Puente',
        formCode: 'F-RAM-AVL-PB 01', requiredRoles: ['BridgeOperator'], signatures: [], staleRoles: ['BridgeOperator'] }),
    ],
    damageMarks: [
      { id: uuid('d4a1b2c3', 1), x: 0.42, y: 0.31, note: 'Rayón leve en la puerta de carga trasera', reportedAt: at('14:40'),
        hasPhoto: false },
    ],
  };
}

/** GET occ/operations/{id}/incidents: the live incident of the hand-off, still open. */
export function reviewIncidents(operationId = REVIEW_IDS.pending) {
  return {
    operationId, operationCode: 'PUJ-20261113-004', operationStatus: 'PendingReview', ianaTimeZone: STATION_TIME_ZONE,
    canReport: false,
    incidents: [
      { id: uuid('1c1d2e3f', 1), type: 'Operational', severity: 'Low', status: 'Open',
        description: 'La aeronave llegó 12 minutos tarde por rotación.', occurredAt: at('14:22'), reportedAt: at('14:24'),
        delayCode: '93', reportedBy: 'Agente de prueba Uno', reportedByKind: 'Agent', resolutionNote: null,
        resolvedAt: null, resolvedBy: null, version: 'AAAAAAAAB9E=', allowedStatuses: ['InReview', 'Resolved'],
        history: [] },
    ],
  };
}

/** The Problem Details of a server that failed: the review explains it with its own words, never with this title. */
export const SERVER_ERROR = Object.freeze({
  type: 'https://tools.ietf.org/html/rfc9110#section-15.6.1', title: 'Internal Server Error', status: 500,
  code: 'internal_error',
});

/** The Problem Details of an account without access to a read (the `forbidden` scenario). */
export const FORBIDDEN = Object.freeze({
  type: 'https://tools.ietf.org/html/rfc9110#section-15.5.4', title: 'Forbidden', status: 403, code: 'forbidden',
});

// ── Cobertura de posiciones ─────────────────────────────────────────────────────────────────────────────────────────

/** The terminals of the board, as Punta Cana has them. */
export const COVERAGE_TERMINALS = Object.freeze({
  A: Object.freeze({ terminalId: uuid('c0a1b2c3', 1), code: 'A', name: 'Terminal A', maxStandsPerAgent: 3,
    requiresBridgeQualification: false }),
  B: Object.freeze({ terminalId: uuid('c0a1b2c3', 2), code: 'B', name: 'Terminal B', maxStandsPerAgent: 2,
    requiresBridgeQualification: true }),
  FBO: Object.freeze({ terminalId: uuid('c0a1b2c3', 3), code: 'FBO', name: 'FBO / Aviación local', maxStandsPerAgent: 4,
    requiresBridgeQualification: false }),
});

// The stands of the board: the reference codes of Punta Cana with their terminal and attributes. AN4 and AN5 take
// narrowbody aircraft only and A11 is deactivated, so terminal A shows every attribute and state of the board.
const COVERAGE_STANDS = [
  ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11'].map(code => ({ code, terminal: 'A' })),
  ...['AN1', 'AN2', 'AN3', 'AN4', 'AN5'].map(code => ({ code, terminal: 'A', isRemote: true })),
  ...['B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'B26'].map(code => ({ code, terminal: 'B', hasBoardingBridge: true })),
  ...['B27', 'B28', 'B29', 'B30', 'B31'].map(code => ({ code, terminal: 'B' })),
  ...['B32', 'B34', 'B35', 'B36', 'B37'].map(code => ({ code, terminal: 'B', isRemote: true })),
  ...['BN6', 'BN7', 'BN8', 'BN9', 'BN10', 'BN11', 'BN12', 'BN13'].map(code => ({ code, terminal: 'FBO', isRemote: true,
    maxAircraftSize: 'Narrowbody' })),
].map((stand, index) => ({
  standId: uuid('c1a1b2c3', index + 1), terminalId: COVERAGE_TERMINALS[stand.terminal].terminalId,
  isActive: stand.code !== 'A11', hasBoardingBridge: stand.hasBoardingBridge ?? false, isRemote: stand.isRemote ?? false,
  maxAircraftSize: ['AN4', 'AN5'].includes(stand.code) ? 'Narrowbody' : stand.maxAircraftSize ?? null,
  code: stand.code, version: `AAAAAAAA${String(index + 1).padStart(3, '0')}=`,
}));
const standOf = code => COVERAGE_STANDS.find(stand => stand.code === code);

/** The agents with a shift at the station that day: their terminal, shift and the conditions the form shows. */
export const COVERAGE_AGENTS = Object.freeze({
  uno: { agentId: uuid('c2a1b2c3', 1), name: 'Agente de prueba Uno', terminal: 'A', shift: ['10:00', '18:00'] },
  dos: { agentId: uuid('c2a1b2c3', 2), name: 'Agente de prueba Dos', terminal: 'A', shift: ['10:00', '18:00'],
    isJunior: true, hasDriverLicense: false, hasBridgeQualification: false },
  tres: { agentId: uuid('c2a1b2c3', 3), name: 'Agente de prueba Tres', terminal: 'B', shift: ['10:00', '18:00'] },
  cuatro: { agentId: uuid('c2a1b2c3', 4), name: 'Agente de prueba Cuatro', terminal: 'A', shift: ['10:00', '18:00'],
    hasAirportPermit: false, hasBridgeQualification: false },
  cinco: { agentId: uuid('c2a1b2c3', 5), name: 'Agente de prueba Cinco', terminal: 'A', shift: ['18:00', '23:00'],
    isAbsent: true },
  seis: { agentId: uuid('c2a1b2c3', 6), name: 'Agente de prueba Seis', terminal: 'A', shift: ['10:00', '22:00'] },
});

// The coverages of the day: Uno covers three stands of A with a vehicle, Dos (under three months) two with Seis as
// mentor, Seis reinforces A1 at noon, and Tres covers two bridge stands of B. Times are UTC: 10:00Z is 06:00 local.
const COVERAGES = [
  { index: 1, agent: 'uno', stands: ['A1', 'A2', 'A3'], window: ['10:00', '18:00'], vehicleCode: 'VH-07' },
  { index: 2, agent: 'dos', stands: ['A5', 'A6'], window: ['10:00', '18:00'], mentor: 'seis' },
  { index: 3, agent: 'seis', stands: ['A1'], window: ['16:00', '21:00'], isReinforcement: true },
  { index: 4, agent: 'tres', stands: ['B20', 'B21'], window: ['10:00', '18:00'] },
];

function coverageAgent({ agentId, name, terminal, shift, ...conditions }, index, date) {
  return {
    agentId, name, employeeNumber: `VIS-RA-${String(index + 1).padStart(3, '0')}`,
    terminalId: COVERAGE_TERMINALS[terminal].terminalId, terminalCode: terminal,
    shiftStartsAt: `${date}T${shift[0]}:00Z`, shiftEndsAt: `${date}T${shift[1]}:00Z`,
    isJunior: false, hasAirportPermit: true, hasDriverLicense: true, hasBridgeQualification: true, isAbsent: false,
    ...conditions,
  };
}

/**
 * GET occ/coverage?stationId=&date=: the board of the station for that date (the page asks for today's), or a station
 * without terminals in the `empty` scenario. The account may assign and configure.
 */
export function coverageBoard(scenario = 'data', { stationId = STATION.stationId, date = OPERATION_DATE } = {}) {
  const base = { stationId, stationCode: STATION.stationCode, date, canAssign: true, canConfigure: true };
  if (scenario === 'empty') return { ...base, terminals: [], stands: [], constraints: [], agents: [], coverages: [] };
  const coverages = COVERAGES.map(({ index, agent, stands, window, mentor, vehicleCode, isReinforcement }) => {
    const owner = COVERAGE_AGENTS[agent];
    return {
      id: uuid('c3a1b2c3', index), agentId: owner.agentId, agentName: owner.name,
      terminalId: COVERAGE_TERMINALS[owner.terminal].terminalId, terminalCode: owner.terminal,
      stands: stands.map(code => ({ standId: standOf(code).standId, code })),
      startsAt: `${date}T${window[0]}:00Z`, endsAt: `${date}T${window[1]}:00Z`,
      mentorAgentId: mentor ? COVERAGE_AGENTS[mentor].agentId : null, mentorName: mentor ? COVERAGE_AGENTS[mentor].name : null,
      vehicleCode: vehicleCode ?? null, isReinforcement: isReinforcement ?? false,
    };
  });
  const coveredBy = code => coverages.filter(item => item.stands.some(stand => stand.code === code)).map(item => item.agentName);
  return {
    ...base,
    terminals: Object.values(COVERAGE_TERMINALS).map(terminal => ({ ...terminal })),
    stands: COVERAGE_STANDS.map(stand => ({ ...stand, coveredBy: coveredBy(stand.code) })),
    constraints: [
      { id: uuid('c4a1b2c3', 1), standId: standOf('A9').standId, standCode: 'A9', affectedStandId: standOf('A10').standId,
        affectedStandCode: 'A10', kind: 'Cancels' },
      { id: uuid('c4a1b2c3', 2), standId: standOf('B24').standId, standCode: 'B24', affectedStandId: standOf('B25').standId,
        affectedStandCode: 'B25', kind: 'NarrowbodyOnly' },
    ],
    agents: Object.values(COVERAGE_AGENTS).map((agent, index) => coverageAgent(agent, index, date)),
    coverages,
  };
}

/**
 * What the stub answers every new coverage: the server's refusal with the rules it breaks (a 422), so a spec can show
 * a refused assignment and nothing is ever written. The page explains each rule with its own words.
 */
export const COVERAGE_REFUSAL = Object.freeze({
  type: 'https://tools.ietf.org/html/rfc4918#section-11.2', title: 'Unprocessable Entity', status: 422,
  code: 'coverage_rejected',
  reasons: Object.freeze(['mentor_required', 'driver_license_required', 'vehicle_required', 'agent_overlap']),
});

// ── Notificaciones ──────────────────────────────────────────────────────────────────────────────────────────────────

// The notices of the account, newest first: an unread and a read notice of each priority (contratos 2.4) and one more
// unread attention notice, so the filters, the lit rows and the frame's alerts all have something to show.
const NOTICES = [
  { index: 1, kind: 'incident_reported', code: 'PUJ-20261113-004', operation: 4, at: '15:20', read: false },
  { index: 2, kind: 'flight_cancelled_by_provider', code: 'PUJ-20261113-007', operation: 7, at: '15:05', read: false },
  { index: 3, kind: 'operation_submitted', code: 'PUJ-20261113-004', operation: 4, at: '14:42', read: false },
  { index: 4, kind: 'stand_change_unassigned', code: 'PUJ-20261113-006', operation: 6, at: '14:10', read: '14:15' },
  { index: 5, kind: 'agent_message', code: 'PUJ-20261113-005', operation: 5, at: '13:55', read: '14:01' },
  { index: 6, kind: 'incident_reported', code: 'PUJ-20261113-002', operation: 2, at: '12:30', read: '12:34' },
  { index: 7, kind: 'operation_approved', code: 'PUJ-20261113-002', operation: 2, at: '12:05', read: '12:20' },
  { index: 8, kind: 'contract_not_in_force', code: 'PUJ-20261113-008', operation: 8, at: '11:40', read: false },
];

/** GET notifications: the account's notices in the `data` scenario, none in `empty`. */
export function operationalNotices(scenario = 'data') {
  const notifications = scenario === 'empty' ? [] : NOTICES.map(item => ({
    id: uuid('9b1c2d3e', item.index), operationId: uuid('7e1a2b3c', item.operation), operationCode: item.code,
    stationCode: STATION.stationCode, kind: item.kind, sourceId: uuid('9c1c2d3e', item.index), occurredAt: at(item.at),
    readAt: item.read ? at(item.read) : null,
  }));
  return { notifications, hasMore: false };
}

const REVIEW_OPERATION = /^\/api\/v1\/occ\/review\/operations\/([0-9a-f-]{36})$/;
const REVIEW_HISTORY = /^\/api\/v1\/occ\/review\/operations\/([0-9a-f-]{36})\/submissions$/;
const OPERATION_DOCUMENTS = /^\/api\/v1\/occ\/operations\/([0-9a-f-]{36})\/documents$/;
const OPERATION_INCIDENTS = /^\/api\/v1\/occ\/operations\/([0-9a-f-]{36})\/incidents$/;

// The review's reads: the queue in its scenario, and the hand-off the spec opens with its history, forms and incidents.
// Any other operation has no hand-off (404).
function reviewAnswer(url, scenario) {
  if (url.pathname === API_PATHS.reviewQueue) {
    if (scenario === 'error') return { status: 500, json: SERVER_ERROR };
    if (scenario === 'forbidden') return { status: 403, json: FORBIDDEN };
    return { status: 200, json: reviewQueue(scenario, url.searchParams.get('stationId') ?? undefined) };
  }
  const known = path => path.exec(url.pathname)?.[1] === REVIEW_IDS.pending;
  if (known(REVIEW_OPERATION)) {
    const detail = reviewDetail();
    return { status: 200, json: detail, headers: { etag: detail.reviewVersion } };
  }
  if (known(REVIEW_HISTORY)) return { status: 200, json: reviewHistory() };
  if (known(OPERATION_DOCUMENTS)) return { status: 200, json: reviewDocuments() };
  if (known(OPERATION_INCIDENTS)) return { status: 200, json: reviewIncidents() };
  return null;
}

// A read of the screen under review in the `error` and `forbidden` scenarios, or `null` in the others.
const failed = scenario => (scenario === 'error' ? { status: 500, json: SERVER_ERROR }
  : scenario === 'forbidden' ? { status: 403, json: FORBIDDEN } : null);

/**
 * The API handler for support/isolate.mjs in a `scenario` of SCREEN_SCENARIOS: the access of SCREENS_ACCESS, the
 * frame's change feed, and the reads of Revisión and Cobertura in that scenario; every other path is occApi.mjs's, then
 * the isolation's Problem Details 404. The notices are the frame's empty list, or with `{ notices: true }` the reads of
 * Notificaciones in the scenario (the page and the frame read the same list). It accepts no command: a new coverage is
 * refused with COVERAGE_REFUSAL, and any other command gets the 404. `reads` counts the answers by path.
 */
export function createScreensApi(scenario = 'data', { notices = false } = {}) {
  if (!SCREEN_SCENARIOS.includes(scenario)) throw new RangeError(`Unknown screens scenario: ${scenario}`);
  const base = createOccApi();
  const api = { scenario, reads: new Map(), commands: [] };
  const served = (url, answer) => {
    api.reads.set(url.pathname, (api.reads.get(url.pathname) ?? 0) + 1);
    return answer;
  };
  api.readsOf = path => api.reads.get(path) ?? 0;
  api.handle = (request, url) => {
    if (request.method() === 'POST' && url.pathname === API_PATHS.coverage) {
      api.commands.push(url.pathname);
      return { status: 422, json: COVERAGE_REFUSAL };
    }
    if (request.method() !== 'GET') return null;
    if (url.pathname === API_PATHS.access) return served(url, { status: 200, json: SCREENS_ACCESS });
    if (url.pathname === API_PATHS.notices) {
      if (!notices) return served(url, { status: 200, json: { notifications: [], hasMore: false } });
      return served(url, failed(scenario) ?? { status: 200, json: operationalNotices(scenario) });
    }
    if (url.pathname === API_PATHS.coverage) {
      return served(url, failed(scenario) ?? { status: 200, json: coverageBoard(scenario, {
        stationId: url.searchParams.get('stationId') ?? undefined, date: url.searchParams.get('date') ?? undefined,
      }) });
    }
    if (url.pathname === API_PATHS.changes) {
      return served(url, { status: 200, json: { changes: [], nextCursor: null, hasMore: false } });
    }
    const answer = reviewAnswer(url, scenario);
    return answer ? served(url, answer) : base.handle(request, url);
  };
  return api;
}
