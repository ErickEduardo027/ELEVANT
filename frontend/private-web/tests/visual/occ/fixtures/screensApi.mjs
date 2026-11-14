import { OCC_ACCESS, STATION, createOccApi, occSession } from './occApi.mjs';

// Synthetic answers of the ELEVANT API for the OCC work screens of the visual suite (PR U6), one screen at a time:
// Revisión, Cobertura de posiciones, Notificaciones, the chat, Datos maestros, Tablets, Contratos listos and Reportes. On
// top of occApi.mjs (the OCC session's access and the positions board) it answers the reads every OCC screen makes
// through its frame (the notices and the account-change feed, both empty and valid) and the reads of each screen, in one
// of four scenarios: `data`, `empty`, `error` (a 500) and `forbidden` (a 403). Every answer passes the strict validators
// of @elevant/api-client (tests/visualScreensFixtures.test.js checks them). Every id, code, name and time is invented.

export const SCREEN_SCENARIOS = Object.freeze(['data', 'empty', 'error', 'forbidden']);

export const STATION_TIME_ZONE = 'America/Santo_Domingo';
const STATION_NAME = 'Aeropuerto de prueba de Punta Cana';
const OPERATION_DATE = '2026-11-13';

const uuid = (group, index) => `${group}-0000-4000-8000-${String(index).padStart(12, '0')}`;
// An instant of the operation date, in UTC (Santo Domingo is UTC−4: 14:30Z is 10:30 local).
const at = time => `${OPERATION_DATE}T${time}:00Z`;
const sha = digit => digit.repeat(64);

/**
 * The department access of the work screens: the OCC administrator, who also reads and manages the live incidents of
 * an operation (the review, as in hueco 3-G of the cycle E2E), writes in the chat of an operation (its composer) and
 * exports the reports. The API gives an administrator every code of the department.
 */
export const SCREENS_ACCESS = Object.freeze({
  ...OCC_ACCESS,
  permissions: Object.freeze([...OCC_ACCESS.permissions, 'operations.incidents.read', 'operations.incidents.update',
    'operations.chat.create', 'operations.reports.export']),
});

export const API_PATHS = Object.freeze({
  access: '/api/v1/governance/me/access',
  notices: '/api/v1/notifications',
  changes: '/api/v1/changes',
  reviewQueue: '/api/v1/occ/review/queue',
  coverage: '/api/v1/occ/coverage',
  conversations: '/api/v1/chat/conversations',
  presence: '/api/v1/chat/presence',
  ownPresence: '/api/v1/chat/presence/status',
  masterData: '/api/v1/occ/master-data',
  devices: '/api/v1/occ/devices',
  contracts: '/api/v1/occ/contracts',
  reports: '/api/v1/occ/reports',
});

/**
 * The ids of the review: the hand-off the spec opens with its revisions (`reopenedSubmission` is the revision 3 that
 * OCC's reopening creates in the `reopened` variant), the rest of the queue, and an operation still on the ramp, which
 * has no hand-off yet and is not in the queue.
 */
export const REVIEW_IDS = Object.freeze({
  pending: uuid('7e1a2b3c', 4),
  pendingSubmission: uuid('7e2a2b3c', 4),
  earlierSubmission: uuid('7e2a2b3c', 104),
  reopenedSubmission: uuid('7e2a2b3c', 204),
  secondPending: uuid('7e1a2b3c', 5),
  approved: uuid('7e1a2b3c', 2),
  returned: uuid('7e1a2b3c', 3),
  onRamp: uuid('7e1a2b3c', 10),
});
const REVIEW_VERSION = `"${sha('7')}"`;
const REOPENED_VERSION = `"${sha('8')}"`;

/**
 * What OCC wrote when it reopened the approval of revision 2 (3-H): the `reopening` of the detail in the `reopened`
 * variant, whose revision 3 waits for a new decision.
 */
export const REOPENING = Object.freeze({
  fromRevisionNumber: 2, reason: 'La aerolínea pidió revisar el recargo nocturno del GPU.', reopenedAt: at('16:40'),
  reopenedBy: 'Coordinación de prueba',
});

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
 * local midnight of its operation date), or none in the `empty` scenario. With `reopened`, the first one waiting is
 * the revision 3 that OCC's reopening created.
 */
export function reviewQueue(scenario = 'data', stationId = STATION.stationId, { reopened = false } = {}) {
  const operations = scenario === 'empty' ? [] : [
    queueRow({ operationId: REVIEW_IDS.pending,
      submissionId: reopened ? REVIEW_IDS.reopenedSubmission : REVIEW_IDS.pendingSubmission,
      revisionNumber: reopened ? 3 : 2, status: 'PendingReview', code: 'PUJ-20261113-004',
      agentName: 'Agente de prueba Uno', submittedAt: at('15:42'), serviceCount: 3, incidentCount: 1 }),
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

/**
 * GET occ/review/operations/{id} of the hand-off the spec opens (its ETag is `reviewVersion`). With `reopened` it is
 * the revision 3 that OCC's reopening created (3-H): the same evidence, on its signed Service Order, with REOPENING.
 */
export function reviewDetail(operationId = REVIEW_IDS.pending, { reopened = false } = {}) {
  const detail = {
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
  if (!reopened) return detail;
  // A reopening copies the approved revision as a new one, sent when it was (the API keeps its `submittedAt`).
  return { ...detail, submissionId: REVIEW_IDS.reopenedSubmission, revisionNumber: 3, reviewVersion: REOPENED_VERSION,
    reopening: { ...REOPENING } };
}

/**
 * GET occ/review/operations/{id}/submissions: the revision on screen and the earlier one, returned to the ramp. With
 * `reopened`, the revision 3 on screen, then the approval it reopened and the first one, returned.
 */
export function reviewHistory(operationId = REVIEW_IDS.pending, { reopened = false } = {}) {
  const returned = { submissionId: REVIEW_IDS.earlierSubmission, revisionNumber: 1, status: 'Returned',
    submittedAt: at('15:30'), outcome: 'Returned', decidedAt: at('15:35') };
  const submissions = reopened ? [
    { submissionId: REVIEW_IDS.reopenedSubmission, revisionNumber: 3, status: 'PendingReview', submittedAt: at('15:42'),
      outcome: null, decidedAt: null },
    { submissionId: REVIEW_IDS.pendingSubmission, revisionNumber: 2, status: 'Approved', submittedAt: at('15:42'),
      outcome: 'Approved', decidedAt: at('15:58') },
    returned,
  ] : [
    { submissionId: REVIEW_IDS.pendingSubmission, revisionNumber: 2, status: 'PendingReview', submittedAt: at('15:42'),
      outcome: null, decidedAt: null },
    returned,
  ];
  return { operationId, hasMore: false, submissions };
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

/**
 * GET occ/operations/{id}/incidents: the live incident of the hand-off, still open. OCC may still report one: the API
 * stops it only once the operation is approved or cancelled.
 */
export function reviewIncidents(operationId = REVIEW_IDS.pending) {
  return {
    operationId, operationCode: 'PUJ-20261113-004', operationStatus: 'PendingReview', ianaTimeZone: STATION_TIME_ZONE,
    canReport: true,
    incidents: [
      { id: uuid('1c1d2e3f', 1), type: 'Operational', severity: 'Low', status: 'Open',
        description: 'La aeronave llegó 12 minutos tarde por rotación.', occurredAt: at('14:22'), reportedAt: at('14:24'),
        delayCode: '93', reportedBy: 'Agente de prueba Uno', reportedByKind: 'Agent', resolutionNote: null,
        resolvedAt: null, resolvedBy: null, version: 'AAAAAAAAB9E=', allowedStatuses: ['InReview', 'Resolved'],
        history: [] },
    ],
  };
}

/** What the agent reported from the tablet on the operation still on the ramp. */
export const ON_RAMP_INCIDENT = 'Derrame de combustible bajo el ala izquierda; los bomberos están en camino.';

/**
 * GET occ/operations/{id}/incidents of the operation still on the ramp (3-G): in progress, open to OCC's reports, with
 * the agent's report from the tablet.
 */
export function onRampIncidents(operationId = REVIEW_IDS.onRamp) {
  return {
    operationId, operationCode: 'PUJ-20261113-010', operationStatus: 'InProgress', ianaTimeZone: STATION_TIME_ZONE,
    canReport: true,
    incidents: [
      { id: uuid('1c1d2e3f', 2), type: 'Safety', severity: 'High', status: 'Open', description: ON_RAMP_INCIDENT,
        occurredAt: at('16:18'), reportedAt: at('16:19'), delayCode: null, reportedBy: 'Agente de prueba Tres',
        reportedByKind: 'Agent', resolutionNote: null, resolvedAt: null, resolvedBy: null, version: 'AAAAAAAAB9I=',
        allowedStatuses: ['InReview', 'Resolved'], history: [] },
    ],
  };
}

/**
 * The Problem Details of the review detail of an operation without a hand-off yet (3-G), with the API's code and
 * title: the review explains it with its own words, never with this title.
 */
export const NO_HAND_OFF = Object.freeze({
  type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5',
  title: 'La operación ya no existe o no está en su alcance.', status: 404, code: 'not_found',
});

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

// ── Chat ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The account of the OCC session (occApi.mjs): its own messages are the ones on the right. */
export const OWN_ACCOUNT_ID = occSession().accountId;

// The operations with a conversation: the hand-offs of the review (the same ids), newest activity first. The first one
// is the thread the spec opens; the second has three unread messages; the third no message yet.
export const CHAT_IDS = Object.freeze({
  open: uuid('7e1a2b3c', 4),
  unread: uuid('7e1a2b3c', 5),
  quiet: uuid('7e1a2b3c', 6),
  closed: uuid('7e1a2b3c', 2),
});

// The people of the conversations: the ramp agents and a second OCC seat.
const CHAT_PEOPLE = Object.freeze({
  uno: Object.freeze({ accountId: uuid('e1a1b2c3', 1), name: 'Agente de prueba Uno', role: 'agent' }),
  dos: Object.freeze({ accountId: uuid('e1a1b2c3', 2), name: 'Agente de prueba Dos', role: 'agent' }),
  tres: Object.freeze({ accountId: uuid('e1a1b2c3', 3), name: 'Agente de prueba Tres', role: 'agent' }),
  colega: Object.freeze({ accountId: uuid('e1a1b2c3', 9), name: 'Coordinación de prueba', role: 'occ' }),
});
const OWN_NAME = occSession().name;

function chatMessage(operationId, index, { from, time, content }) {
  const own = from === 'own';
  return {
    id: uuid('8b1c2d3e', index), operationId,
    senderAccountId: own ? OWN_ACCOUNT_ID : CHAT_PEOPLE[from].accountId,
    senderRole: own ? 'occ' : CHAT_PEOPLE[from].role,
    senderName: own ? OWN_NAME : CHAT_PEOPLE[from].name,
    content, sentAt: at(time),
  };
}

// The thread of each operation, oldest first. The agent read the open thread up to 14:41 UTC: the first two own
// messages are «Visto» and the last one only «Enviado».
const CHAT_THREADS = Object.freeze({
  [CHAT_IDS.open]: [
    { from: 'uno', time: '14:30', content: 'Llegué a la posición A4. El puente está libre.' },
    { from: 'own', time: '14:31', content: 'Recibido. El vuelo bloquea a las 10:34, con dos minutos de adelanto.' },
    { from: 'uno', time: '14:36', content: 'Bloqueo listo en A4. Empezamos la descarga.' },
    { from: 'own', time: '14:38', content: 'Perfecto. El GPU sale antes del push-back; avísame si cambia algo.' },
    { from: 'colega', time: '14:40', content: 'La aerolínea pide el reporte de daños apenas termine el recorrido.' },
    { from: 'uno', time: '14:41', content: 'Rayón leve en la puerta de carga trasera. Lo marco en el recorrido.' },
    { from: 'own', time: '14:44', content: 'Gracias. Lo revisamos en la entrega.' },
  ],
  [CHAT_IDS.unread]: [
    { from: 'own', time: '15:02', content: 'El vuelo ZZ105 entra a B21.' },
    { from: 'dos', time: '15:06', content: '¿Confirmas la posición B21 para la salida?' },
  ],
  [CHAT_IDS.quiet]: [],
  [CHAT_IDS.closed]: [
    { from: 'uno', time: '12:01', content: 'Entrega firmada y enviada.' },
  ],
});
const READ_UP_TO = Object.freeze({ [CHAT_IDS.open]: at('14:41') });

/** GET chat/conversations/{id}/messages: the thread of one operation of CHAT_IDS. */
export function chatMessages(operationId) {
  let index = 0;
  const offset = Object.keys(CHAT_THREADS).indexOf(operationId) * 20;
  const messages = (CHAT_THREADS[operationId] ?? []).map(item => {
    index += 1;
    return chatMessage(operationId, offset + index, item);
  });
  return { operationId, messages, hasMore: false, othersReadUpTo: READ_UP_TO[operationId] ?? null };
}

// The conversations of the station, with the last message of each thread.
const CONVERSATIONS = [
  { id: CHAT_IDS.open, code: 'PUJ-20261113-004', agent: 'uno', status: 'InProgress', unread: 0 },
  { id: CHAT_IDS.unread, code: 'PUJ-20261113-005', agent: 'dos', status: 'InProgress', unread: 3 },
  { id: CHAT_IDS.quiet, code: 'PUJ-20261113-006', agent: 'tres', status: 'Assigned', unread: 0 },
  { id: CHAT_IDS.closed, code: 'PUJ-20261113-002', agent: 'uno', status: 'Completed', unread: 0 },
];

/** GET chat/conversations?stationId=: four conversations, or none in the `empty` scenario. */
export function chatConversations(scenario = 'data') {
  const conversations = scenario === 'empty' ? [] : CONVERSATIONS.map(item => ({
    operationId: item.id, operationCode: item.code, operationDate: OPERATION_DATE, stationCode: STATION.stationCode,
    airlineName: 'Aerolínea de prueba', agentName: CHAT_PEOPLE[item.agent].name, status: item.status,
    lastMessage: chatMessages(item.id).messages.at(-1) ?? null, unreadCount: item.unread,
    othersReadUpTo: READ_UP_TO[item.id] ?? null,
  }));
  return { conversations, hasMore: false };
}

// Who is in each conversation and how: every presence shape of the legend appears once. The OCC session itself is
// a participant too; the page leaves it out.
const PRESENCE = Object.freeze({
  [CHAT_IDS.open]: [
    { person: 'uno', state: 'active', availability: null, message: 'En rampa, posición A4', last: '14:44' },
    { person: 'colega', state: 'active', availability: 'busy', message: null, last: '14:43' },
    { person: 'own', state: 'active', availability: null, message: null, last: '14:44' },
  ],
  [CHAT_IDS.unread]: [{ person: 'dos', state: 'away', availability: 'beRightBack', message: null, last: '15:06' }],
  [CHAT_IDS.quiet]: [{ person: 'tres', state: 'offline', availability: null, message: null, last: '11:20' }],
  [CHAT_IDS.closed]: [{ person: 'uno', state: 'unknown', availability: null, message: null, last: null }],
});

/** GET chat/presence?operationIds=: the participants of the operations asked for, and only of those. */
export function chatPresence(operationIds) {
  const asked = new Set(operationIds.map(id => id.toLowerCase()));
  return {
    asOf: at('15:10'),
    operations: Object.entries(PRESENCE).filter(([operationId]) => asked.has(operationId)).map(([operationId, people]) => ({
      operationId,
      participants: people.map(({ person, state, availability, message, last }) => ({
        accountId: person === 'own' ? OWN_ACCOUNT_ID : CHAT_PEOPLE[person].accountId,
        name: person === 'own' ? OWN_NAME : CHAT_PEOPLE[person].name,
        role: person === 'own' ? 'occ' : CHAT_PEOPLE[person].role,
        state, lastActivityAt: last ? at(last) : null, availability, message,
      })),
    })),
  };
}

/** GET chat/presence/status: the session's own status, automatic (nothing chosen). */
export const OWN_PRESENCE = Object.freeze({ state: 'active', availability: null, message: null });

const CHAT_THREAD = /^\/api\/v1\/chat\/conversations\/([0-9a-f-]{36})\/messages$/;

// ── Datos maestros ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The terminals of the station: A and B have history, FBO is new, and C was closed. */
export const MASTER_TERMINALS = Object.freeze({
  A: Object.freeze({ id: uuid('d0a1b2c3', 1), code: 'A', name: 'Terminal A', isActive: true, hasHistory: true,
    version: 'AAAAAAAAD01=' }),
  B: Object.freeze({ id: uuid('d0a1b2c3', 2), code: 'B', name: 'Terminal B', isActive: true, hasHistory: true,
    version: 'AAAAAAAAD02=' }),
  FBO: Object.freeze({ id: uuid('d0a1b2c3', 3), code: 'FBO', name: 'FBO / Aviación local', isActive: true, hasHistory: false,
    version: 'AAAAAAAAD03=' }),
  C: Object.freeze({ id: uuid('d0a1b2c3', 4), code: 'C', name: 'Terminal C (cerrada)', isActive: false, hasHistory: false,
    version: 'AAAAAAAAD04=' }),
});

// A sample of the Punta Cana stands, with every attribute and state the register shows: history, a remote stand, the
// bridges of B, a narrow-body stand of the FBO and a stand out of use.
const MASTER_STANDS = [
  { code: 'A1', terminal: 'A', history: true }, { code: 'A2', terminal: 'A', history: true },
  { code: 'A3', terminal: 'A', history: true }, { code: 'A4', terminal: 'A', history: true },
  { code: 'A11', terminal: 'A', active: false }, { code: 'AN1', terminal: 'A', remote: true },
  { code: 'B20', terminal: 'B', bridge: true, history: true }, { code: 'B21', terminal: 'B', bridge: true, history: true },
  { code: 'B32', terminal: 'B', remote: true }, { code: 'BN6', terminal: 'FBO', remote: true, size: 'Narrowbody' },
];

// The shared aircraft types: three narrow-bodies, a wide-body and one out of use.
const MASTER_AIRCRAFT_TYPES = [
  ['A320', '320', 'Airbus', 'A320', 'Narrowbody'], ['B738', '73H', 'Boeing', '737-800', 'Narrowbody'],
  ['E190', 'E90', 'Embraer', 'E190', 'Narrowbody'], ['A332', '332', 'Airbus', 'A330-200', 'Widebody'],
  ['B752', '752', 'Boeing', '757-200', 'Widebody', false],
];

/**
 * GET occ/master-data?stationId=: the layout of the station, or none in the `empty` scenario. With `readOnly` the
 * account may neither create nor change anything.
 */
export function masterData(scenario = 'data', { stationId = STATION.stationId, readOnly = false } = {}) {
  const empty = scenario === 'empty';
  return {
    stationId, stationCode: STATION.stationCode,
    terminals: empty ? [] : Object.values(MASTER_TERMINALS).map(terminal => ({ ...terminal })),
    stands: empty ? [] : MASTER_STANDS.map((stand, index) => ({
      id: uuid('d1a1b2c3', index + 1), terminalId: MASTER_TERMINALS[stand.terminal].id, code: stand.code,
      hasBoardingBridge: stand.bridge ?? false, isRemote: stand.remote ?? false, maxAircraftSize: stand.size ?? null,
      isActive: stand.active ?? true, hasHistory: stand.history ?? false, version: `AAAAAAAAE${String(index + 1).padStart(2, '0')}=`,
    })),
    aircraftTypes: empty ? [] : MASTER_AIRCRAFT_TYPES.map(([icaoCode, iataCode, manufacturer, model, sizeCategory, isActive = true],
      index) => ({
      id: uuid('d2a1b2c3', index + 1), icaoCode, iataCode, manufacturer, model, sizeCategory, isActive,
      version: `AAAAAAAAF${String(index + 1).padStart(2, '0')}=`,
    })),
    canCreate: !readOnly, canUpdate: !readOnly,
  };
}

// ── Tablets ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const DEVICE_AGENTS = Object.freeze({
  uno: Object.freeze({ accountId: uuid('e1a1b2c3', 1), rampAgentId: uuid('c2a1b2c3', 1), name: 'Agente de prueba Uno',
    employeeNumber: 'VIS-RA-001' }),
  dos: Object.freeze({ accountId: uuid('e1a1b2c3', 2), rampAgentId: uuid('c2a1b2c3', 2), name: 'Agente de prueba Dos',
    employeeNumber: 'VIS-RA-002' }),
  tres: Object.freeze({ accountId: uuid('e1a1b2c3', 3), rampAgentId: uuid('c2a1b2c3', 3), name: 'Agente de prueba Tres',
    employeeNumber: 'VIS-RA-003' }),
  cuatro: Object.freeze({ accountId: uuid('e1a1b2c3', 4), rampAgentId: null, name: 'Agente de prueba Cuatro',
    employeeNumber: null }),
});

/** The ids of the tablets: the two in an agent's hands, the free ones and the revoked one. */
export const DEVICE_IDS = Object.freeze({
  busy: uuid('f0a1b2c3', 1), held: uuid('f0a1b2c3', 2), free: uuid('f0a1b2c3', 3), unnamed: uuid('f0a1b2c3', 4),
  revoked: uuid('f0a1b2c3', 5),
});

// Who holds each tablet: an agent in the middle of an operation, an agent between flights, a tablet freed at the end
// of a shift, an iOS tablet with no name and no agent, and a tablet revoked after it was lost. Times are UTC.
const DEVICES = [
  { id: DEVICE_IDS.busy, name: 'Tablet T-01', platform: 'Android', os: '15', app: '1.4.2', status: 'Bound', agent: 'uno',
    inProgress: true, since: '10:05', seen: '15:38' },
  { id: DEVICE_IDS.held, name: 'Tablet T-02', platform: 'Android', os: '15', app: '1.4.2', status: 'Bound', agent: 'dos',
    since: '11:20', seen: '15:31' },
  { id: DEVICE_IDS.free, name: 'Tablet T-03', platform: 'Android', os: '14', app: '1.4.1', status: 'Unbound', agent: 'tres',
    since: '14:02', seen: '14:02' },
  { id: DEVICE_IDS.unnamed, name: null, platform: 'Ios', os: '18.1', app: '1.4.2', status: 'Unbound', agent: null,
    since: '09:12', seen: '09:12' },
  { id: DEVICE_IDS.revoked, name: 'Tablet T-05', platform: 'Android', os: '13', app: '1.3.0', status: 'Revoked', agent: 'cuatro',
    since: '13:15', seen: '12:58' },
];

/**
 * GET occ/devices?stationId=: the tablets of the station, or none in the `empty` scenario. With `readOnly` the
 * account may neither free nor revoke one.
 */
export function occDevices(scenario = 'data', { stationId = STATION.stationId, readOnly = false } = {}) {
  const devices = scenario === 'empty' ? [] : DEVICES.map((device, index) => ({
    id: device.id, platform: device.platform, deviceName: device.name, appVersion: device.app,
    operatingSystemVersion: device.os, lastSeenAt: at(device.seen), status: device.status,
    agent: device.agent ? { ...DEVICE_AGENTS[device.agent] } : null,
    boundAt: device.status === 'Bound' ? at(device.since) : at('08:00'),
    unboundAt: device.status === 'Unbound' ? at(device.since) : null,
    revokedAt: device.status === 'Revoked' ? at(device.since) : null,
    agentHasOperationInProgress: device.inProgress ?? false,
    version: `tok-visual-${index + 1}`,
  }));
  return { stationId, stationCode: STATION.stationCode, canUnbind: !readOnly, canRevoke: !readOnly, devices };
}

// ── Contratos listos ────────────────────────────────────────────────────────────────────────────────────────────────

/** The services a ready contract lists, without prices: OCC never sees them. */
const CONTRACT_SERVICES = Object.freeze({
  turnaround: Object.freeze({ code: 'TURN', name: 'Turnaround completo', billingUnit: 'operation' }),
  pushback: Object.freeze({ code: 'PUSHBACK', name: 'Remolque', billingUnit: 'operation' }),
  gpu: Object.freeze({ code: 'GPU', name: 'Planta de energía', billingUnit: 'hour' }),
  baggage: Object.freeze({ code: 'BAGGAGE', name: 'Manejo de equipaje', billingUnit: 'operation' }),
  stairs: Object.freeze({ code: 'STAIRS', name: 'Escalera de pasajeros', billingUnit: 'operation' }),
  cargo: Object.freeze({ code: 'CARGO', name: 'Turnaround de carga', billingUnit: 'operation' }),
});

// Every case the list draws: an open-ended contract with three services, one with an end date and a manual renewal,
// one with no renewal mode, no services and no flights that day, and a cargo airline with no IATA code.
const READY_CONTRACTS = [
  { code: 'CTR-2026-0101', airline: 'Demo Airlines', iata: 'ZZ', version: 3, from: '2026-01-01', to: null,
    renewal: 'Automatic', services: ['turnaround', 'pushback', 'gpu'], flights: 3 },
  { code: 'CTR-2026-0102', airline: 'Aerolínea de prueba', iata: 'Z1', version: 1, from: '2026-03-01', to: '2026-12-31',
    renewal: 'Manual', services: ['baggage', 'stairs'], flights: 1 },
  { code: 'CTR-2026-0103', airline: 'Aerolínea de prueba Dos', iata: 'Z2', version: 2, from: '2026-06-15', to: '2027-06-14',
    renewal: null, services: [], flights: 0 },
  { code: 'CTR-2026-0104', airline: 'Carga de prueba', iata: null, version: 1, from: '2026-09-01', to: null,
    renewal: 'Automatic', services: ['cargo'], flights: 2 },
];

/** GET occ/contracts?stationId=&date=: the contracts ready on that date, or none in the `empty` scenario. */
export function readyContracts(scenario = 'data', { stationId = STATION.stationId, date = OPERATION_DATE } = {}) {
  return {
    stationId, stationCode: STATION.stationCode, date,
    contracts: scenario === 'empty' ? [] : READY_CONTRACTS.map((item, index) => ({
      contractId: uuid('a0c1d2e3', index + 1), contractCode: item.code, airlineId: uuid('a1c1d2e3', index + 1),
      airlineName: item.airline, airlineIataCode: item.iata, versionId: uuid('a2c1d2e3', index + 1),
      versionNumber: item.version, validFrom: item.from, validTo: item.to, renewalMode: item.renewal,
      services: item.services.map(key => ({ ...CONTRACT_SERVICES[key] })), flightsOnDate: item.flights,
    })),
  };
}

// ── Reportes ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** GET occ/reports: the six reports of the API, with their headers. */
export const REPORT_CATALOG = Object.freeze([
  ['operations', 'Operaciones del período', 'Cada operación de la estación con su estado, horarios planificados y reales y sus agentes.',
    ['Fecha', 'Operación', 'Aerolínea', 'Matrícula', 'Estado', 'Inicio planificado', 'Fin planificado', 'Inicio real',
      'Fin real', 'Agentes']],
  ['turnaround-times', 'Tiempos de turnaround',
    'Duración planificada frente a la real de las operaciones terminadas, con su desviación en minutos.',
    ['Fecha', 'Operación', 'Aerolínea', 'Minutos planificados', 'Minutos reales', 'Desviación (min)']],
  ['services-by-airline', 'Servicios ejecutados por aerolínea',
    'Servicios facturables de las operaciones aprobadas por OCC, agrupados por aerolínea.',
    ['Aerolínea', 'Servicio', 'Unidad', 'Operaciones', 'Cantidad contratada', 'Cantidad ejecutada']],
  ['reviews', 'Revisiones, devoluciones e incidencias', 'Decisiones de revisión OCC de cada envío y sus incidencias.',
    ['Fecha', 'Operación', 'Aerolínea', 'Revisión', 'Resultado', 'Motivo', 'Decidido', 'Incidencias']],
  ['agent-productivity', 'Productividad por agente', 'Operaciones y minutos que cada agente trabajó en el período.',
    ['Agente', 'N.º de empleado', 'Operaciones', 'Aprobadas', 'Devueltas', 'Minutos trabajados']],
  ['daily-close', 'Cierre operacional del día', 'Por vuelo: horarios programados y reales, posiciones y tiempo en tierra.',
    ['Fecha', 'Operación', 'Aerolínea', 'Vuelos', 'STA', 'ATA', 'STD', 'Push-back', 'Posición inicial', 'Posición final',
      'Aviso del cambio (min)', 'Tiempo en tierra (min)', 'Permitido (min)', 'Demoras IATA', 'Desviaciones', 'Estado']],
].map(([key, title, description, columns]) => Object.freeze({ key, title, description, columns: Object.freeze(columns) })));

export const reportCatalog = () => ({
  maxRangeDays: 366,
  reports: REPORT_CATALOG.map(report => ({ ...report, columns: [...report.columns] })),
});

const textCell = value => ({ value, type: 'text' });
const numberCell = value => ({ value: String(value), type: 'number' });
const REPORT_AIRLINES = Object.freeze(['Demo Airlines', 'Aerolínea de prueba', 'Aerolínea de prueba Dos']);

// 32 finished operations of 1 to 11 November: 25 on the first page and 7 on the second. Every seventh has no planned
// time, so its planned minutes and its deviation are «—» inside a column of numbers, as the API writes them.
const TURNAROUND_ROWS = Object.freeze(Array.from({ length: 32 }, (_, index) => {
  const day = String(1 + Math.floor(index / 3)).padStart(2, '0');
  const planned = index % 7 === 5 ? null : 60 + (index % 4) * 15;
  const actual = (planned ?? 70) + ((index * 7) % 23) - 8;
  return Object.freeze([
    textCell(`${day}/11/2026`), textCell(`PUJ-202611${day}-${String((index % 3) + 1).padStart(3, '0')}`),
    textCell(REPORT_AIRLINES[index % 3]), planned === null ? textCell('—') : numberCell(planned), numberCell(actual),
    planned === null ? textCell('—') : numberCell(actual - planned),
  ]);
}));

// Six operations of the day, with their agents.
const OPERATION_ROWS = Object.freeze([
  ['PUJ-20261113-001', 'ZZ-T101', 'Aprobada', '06:00', '07:00', '06:04', '06:58', 'Agente de prueba Uno'],
  ['PUJ-20261113-002', 'ZZ-T102', 'Aprobada', '08:15', '09:15', '08:20', '09:31', 'Agente de prueba Dos, Agente de prueba Tres'],
  ['PUJ-20261113-003', 'ZZ-T103', 'Devuelta', '10:30', '11:30', '10:41', '11:44', 'Agente de prueba Uno'],
  ['PUJ-20261113-004', 'ZZ-T104', 'Por revisar', '14:30', '15:30', '14:34', '15:38', 'Agente de prueba Uno'],
  ['PUJ-20261113-005', 'ZZ-T105', 'En curso', '16:00', '17:00', '16:06', '—', 'Agente de prueba Dos'],
  ['PUJ-20261113-006', 'ZZ-T106', 'Planificada', '19:45', '20:45', '—', '—', 'Sin asignar'],
].map(([code, registration, status, plannedStart, plannedEnd, actualStart, actualEnd, agents], index) => Object.freeze([
  textCell('13/11/2026'), textCell(code), textCell(REPORT_AIRLINES[index % 3]), textCell(registration),
  textCell(status), textCell(plannedStart), textCell(plannedEnd), textCell(actualStart), textCell(actualEnd),
  textCell(agents),
])));

const REPORT_ROWS = Object.freeze({ 'turnaround-times': TURNAROUND_ROWS, operations: OPERATION_ROWS });

/**
 * GET occ/reports/{key}?stationId=&from=&to=&page=&limit=: one page of the report for the period asked, which it
 * echoes. `turnaround-times` and `operations` have rows; the others, and every report in the `empty` scenario, none.
 */
export function reportPage(key, { stationId = STATION.stationId, from = '2026-11-01', to = OPERATION_DATE, page = 1,
  limit = 25 } = {}, scenario = 'data') {
  const report = REPORT_CATALOG.find(item => item.key === key);
  if (!report) throw new RangeError(`Unknown report: ${key}`);
  const rows = scenario === 'empty' ? [] : REPORT_ROWS[key] ?? [];
  const start = (page - 1) * limit;
  return {
    key, title: report.title, stationId, stationCode: STATION.stationCode, from, to, asOf: at('15:45'),
    columns: [...report.columns], rows: rows.slice(start, start + limit).map(row => row.map(cell => ({ ...cell }))),
    page, limit, hasMore: start + limit < rows.length,
  };
}

const REPORT_PAGE = /^\/api\/v1\/occ\/reports\/([a-z-]+)$/;

/** The query of a report page as the page sends it. */
function reportQuery(url) {
  const { searchParams } = url;
  return {
    stationId: searchParams.get('stationId') ?? undefined, from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined, page: Number(searchParams.get('page') ?? 1),
    limit: Number(searchParams.get('limit') ?? 25),
  };
}

const REVIEW_OPERATION = /^\/api\/v1\/occ\/review\/operations\/([0-9a-f-]{36})$/;
const REVIEW_HISTORY = /^\/api\/v1\/occ\/review\/operations\/([0-9a-f-]{36})\/submissions$/;
const OPERATION_DOCUMENTS = /^\/api\/v1\/occ\/operations\/([0-9a-f-]{36})\/documents$/;
const OPERATION_INCIDENTS = /^\/api\/v1\/occ\/operations\/([0-9a-f-]{36})\/incidents$/;

// The review's reads: the queue in its scenario, the hand-off the spec opens with its history, forms and incidents
// (as revision 3 of a reopening with `reopened`), and the operation still on the ramp: its detail is the API's 404 of
// an operation without a hand-off, and its live incidents answer. Any other operation has no answer (the isolation's
// 404).
function reviewAnswer(url, scenario, { reopened = false } = {}) {
  if (url.pathname === API_PATHS.reviewQueue) {
    if (scenario === 'error') return { status: 500, json: SERVER_ERROR };
    if (scenario === 'forbidden') return { status: 403, json: FORBIDDEN };
    return { status: 200, json: reviewQueue(scenario, url.searchParams.get('stationId') ?? undefined, { reopened }) };
  }
  const operationOf = path => path.exec(url.pathname)?.[1];
  if (operationOf(REVIEW_OPERATION) === REVIEW_IDS.onRamp) return { status: 404, json: NO_HAND_OFF };
  if (operationOf(OPERATION_INCIDENTS) === REVIEW_IDS.onRamp) return { status: 200, json: onRampIncidents() };
  const known = path => operationOf(path) === REVIEW_IDS.pending;
  if (known(REVIEW_OPERATION)) {
    const detail = reviewDetail(REVIEW_IDS.pending, { reopened });
    return { status: 200, json: detail, headers: { etag: detail.reviewVersion } };
  }
  if (known(REVIEW_HISTORY)) return { status: 200, json: reviewHistory(REVIEW_IDS.pending, { reopened }) };
  if (known(OPERATION_DOCUMENTS)) return { status: 200, json: reviewDocuments() };
  if (known(OPERATION_INCIDENTS)) return { status: 200, json: reviewIncidents() };
  return null;
}

// A read of the screen under review in the `error` and `forbidden` scenarios, or `null` in the others.
const failed = scenario => (scenario === 'error' ? { status: 500, json: SERVER_ERROR }
  : scenario === 'forbidden' ? { status: 403, json: FORBIDDEN } : null);

// The chat's reads: the conversations in the scenario, the thread of a known operation, the presence of the operations
// asked for and the session's own status. The presence is the page's company, not what it is about: it is always there.
function chatAnswer(url, scenario) {
  if (url.pathname === API_PATHS.conversations) return failed(scenario) ?? { status: 200, json: chatConversations(scenario) };
  const thread = CHAT_THREAD.exec(url.pathname)?.[1];
  if (thread) return Object.hasOwn(CHAT_THREADS, thread) ? { status: 200, json: chatMessages(thread) } : null;
  if (url.pathname === API_PATHS.presence) return { status: 200, json: chatPresence(url.searchParams.getAll('operationIds')) };
  if (url.pathname === API_PATHS.ownPresence) return { status: 200, json: OWN_PRESENCE };
  return null;
}

/**
 * The API handler for support/isolate.mjs in a `scenario` of SCREEN_SCENARIOS: the access of SCREENS_ACCESS, the
 * frame's change feed, and the reads of Revisión, Cobertura, the chat, Datos maestros, Tablets, Contratos listos and
 * Reportes in that scenario; every other path is occApi.mjs's, then the isolation's Problem Details 404. The notices are
 * the frame's empty list, or with `{ notices: true }` the reads of Notificaciones in the scenario (the page and the frame
 * read the same list). With `{ readOnly: true }` Datos maestros and Tablets answer an account that may change nothing.
 * With `{ reopened: true }` the review's hand-off is the revision 3 of a reopening (3-H). The list of reports is the
 * API's in every scenario; the scenario applies to the page of a report, which echoes the period asked. It accepts no
 * command: a new coverage is refused with COVERAGE_REFUSAL, and any other command (a message, a read receipt, a
 * presence lease, a change of the layout, a tablet's release) gets the 404, and so does an export. `reads` counts the
 * answers by path.
 */
export function createScreensApi(scenario = 'data', { notices = false, readOnly = false, reopened = false } = {}) {
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
    const station = { stationId: url.searchParams.get('stationId') ?? undefined, readOnly };
    if (url.pathname === API_PATHS.masterData) return served(url, failed(scenario) ?? { status: 200, json: masterData(scenario, station) });
    if (url.pathname === API_PATHS.devices) return served(url, failed(scenario) ?? { status: 200, json: occDevices(scenario, station) });
    if (url.pathname === API_PATHS.contracts) {
      return served(url, failed(scenario) ?? { status: 200, json: readyContracts(scenario, {
        stationId: station.stationId, date: url.searchParams.get('date') ?? undefined,
      }) });
    }
    if (url.pathname === API_PATHS.reports) return served(url, { status: 200, json: reportCatalog() });
    const reportKey = REPORT_PAGE.exec(url.pathname)?.[1];
    if (reportKey && REPORT_CATALOG.some(report => report.key === reportKey)) {
      return served(url, failed(scenario) ?? { status: 200, json: reportPage(reportKey, reportQuery(url), scenario) });
    }
    const chat = chatAnswer(url, scenario);
    if (chat) return served(url, chat);
    const answer = reviewAnswer(url, scenario, { reopened });
    return answer ? served(url, answer) : base.handle(request, url);
  };
  return api;
}
