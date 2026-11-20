import { OCC_ACCESS, STATION, aerodromeWeather } from './occApi.mjs';

// Synthetic answers of the ELEVANT API for the OCC console of the visual suite (tests/visual/occ/console.spec.mjs): one
// coherent day at Punta Cana for the console's reads (contratos 1.3 and 2.7), the planning snapshot, the positions
// board, the review queue, the readiness marks, the notices, the map flights, the air picture and its tracks, the ping
// and the account-change feed. They pass the strict validators of @elevant/api-client
// (tests/visualConsoleFixtures.test.js checks them). Every id, flight, registration, name and position is invented;
// nothing comes from a provider. Times are written around `now`, the instant of each answer.
//
// The day: ZZ161 from MIA on final for runway 08 (its aircraft live in the picture), due on A5 within 15 minutes;
// ZZ300 from YYZ on A2 with its agent at work; ZZ500 from MIA due on B30 within the hour with nobody assigned and nobody
// covering the stand; ZZ610 from BOG later today without a stand or an agent; ZZ700, done and waiting for review. Once
// `triggerDemo()` is called, the demo pair ZZ9001/ZZ9002 from JFK appears in the map flights (not imported, in
// approach, B21 suggested) and the change feed announces `occ_planning`, as when the superadministrator fires it. With
// `openAfterDeparture` (N30) the day also has ZZ800, which left A4 80 minutes ago while its agent never handed the
// operation off: «Pendientes de la jornada» lists it and «En operación» says it is open after its departure.

export const CONSOLE_PATHS = Object.freeze({
  access: '/api/v1/governance/me/access',
  planning: '/api/v1/occ/planning',
  readiness: '/api/v1/occ/planning/assignment-readiness',
  positions: '/api/v1/occ/positions',
  reviewQueue: '/api/v1/occ/review/queue',
  notices: '/api/v1/notifications',
  mapFlights: '/api/v1/occ/map/flights',
  airPicture: '/api/v1/occ/map/air-picture',
  ping: '/api/v1/system/ping',
  changes: '/api/v1/changes',
});
const TRACK_PATH = /^\/api\/v1\/occ\/map\/aircraft\/([0-9a-f]{6})\/track$/;
const NOTICE_READ_PATH = /^\/api\/v1\/notifications\/([0-9a-f-]{36})\/read$/;

export const STATION_TIME_ZONE = 'America/Santo_Domingo';
const STATION_NAME = 'Aeropuerto de prueba de Punta Cana';
const PUJ = Object.freeze({ latitude: 18.5674, longitude: -68.3634 });
// The threshold of runway 08 and its inbound course.
const THRESHOLD_08 = Object.freeze({ latitude: 18.57031, longitude: -68.383055 });
const FINAL_COURSE_DEG = 74;
const METRES_PER_NM = 1852;
const EARTH_RADIUS_M = 6_371_008.8;

const uuid = (group, index) => `${group}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const minutes = (now, delta) => new Date(now + delta * 60_000).toISOString();
const seconds = (now, delta) => new Date(now + delta * 1_000).toISOString();
const round6 = value => Math.round(value * 1e6) / 1e6;

/** The station's day `YYYY-MM-DD` at `now`, in its time zone. */
export function stationDay(now = Date.now()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: STATION_TIME_ZONE, year: 'numeric', month: '2-digit',
    day: '2-digit' }).format(now);
}

// A point `distanceM` metres from `from` along `bearingDeg`, on a sphere: precise enough for a synthetic position.
function destination(from, bearingDeg, distanceM) {
  const lat1 = (from.latitude * Math.PI) / 180;
  const lon1 = (from.longitude * Math.PI) / 180;
  const bearing = (bearingDeg * Math.PI) / 180;
  const angle = distanceM / EARTH_RADIUS_M;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angle) + Math.cos(lat1) * Math.sin(angle) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(lat1), Math.cos(angle) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: round6((lat2 * 180) / Math.PI), longitude: round6((lon2 * 180) / Math.PI) };
}

const AIRLINE = Object.freeze({ id: uuid('6a100000', 1), name: 'Zeta Air de prueba', iataCode: 'ZZ', icaoCode: 'ZZZ' });
// The airports as the planning snapshot names them (with an id) and as the map flights do (with a reference point).
const AIRPORTS = Object.freeze({
  PUJ: { id: uuid('6a200000', 1), iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana International', ...PUJ },
  MIA: { id: uuid('6a200000', 2), iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami International', latitude: 25.7932,
    longitude: -80.2906 },
  YYZ: { id: uuid('6a200000', 3), iataCode: 'YYZ', icaoCode: 'CYYZ', name: 'Toronto Pearson', latitude: 43.6777,
    longitude: -79.6248 },
  BOG: { id: uuid('6a200000', 4), iataCode: 'BOG', icaoCode: 'SKBO', name: 'El Dorado', latitude: 4.7016,
    longitude: -74.1469 },
  JFK: { id: uuid('6a200000', 5), iataCode: 'JFK', icaoCode: 'KJFK', name: 'John F. Kennedy International',
    latitude: 40.6413, longitude: -73.7781 },
});
const planningAirport = code => ({ id: AIRPORTS[code].id, iataCode: AIRPORTS[code].iataCode,
  icaoCode: AIRPORTS[code].icaoCode, name: AIRPORTS[code].name });
const mapAirport = code => ({ iataCode: AIRPORTS[code].iataCode, icaoCode: AIRPORTS[code].icaoCode,
  name: AIRPORTS[code].name, latitude: AIRPORTS[code].latitude, longitude: AIRPORTS[code].longitude });

// The stands of Punta Cana, with the terminal and type of each; BN13 has no row (the map reads it «Sin verificar»).
const STANDS = [
  ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11'].map(code => [code, 'A', 'Contact']),
  ...['AN1', 'AN2', 'AN3', 'AN4', 'AN5'].map(code => [code, 'A', 'Remote']),
  ...['B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31'].map(code => [code, 'B', 'Contact']),
  ...['B32', 'B34', 'B35', 'B36', 'B37'].map(code => [code, 'B', 'Remote']),
  ...['BN6', 'BN7', 'BN8', 'BN9', 'BN10', 'BN11', 'BN12'].map(code => [code, 'FBO', 'Remote']),
];
const TERMINALS = Object.freeze({
  A: { id: uuid('6a300000', 1), code: 'A', name: 'Terminal A' },
  B: { id: uuid('6a300000', 2), code: 'B', name: 'Terminal B' },
  FBO: { id: uuid('6a300000', 3), code: 'FBO', name: 'FBO / Aviación local' },
});
const standIndex = code => STANDS.findIndex(([standCode]) => standCode === code);
const standId = code => uuid('6a400000', standIndex(code) + 1);
const terminalOf = code => STANDS[standIndex(code)][1];
// Who covers the stands today: terminal A has Marta Castillo; terminal B and the FBO nobody.
const coveredBy = code => (terminalOf(code) === 'A' ? ['Marta Castillo'] : []);

const AGENTS = Object.freeze({
  marta: { agentId: uuid('6a500000', 1), displayName: 'Marta Castillo', employeeNumber: 'EMP-0101' },
  luis: { agentId: uuid('6a500000', 2), displayName: 'Luis Peña', employeeNumber: 'EMP-0102' },
});

// The visits of the day. Minutes are counted from `now`; `stand` is the assigned stand (null without one).
const VISITS = Object.freeze([
  { n: 161, code: '001', from: 'MIA', arrival: 'ZZ161', departure: 'ZZ162', scheduledIn: 12, estimatedIn: 10,
    departureIn: 75, stand: 'A5', status: 'Confirmed', operation: 'Assigned', agent: 'marta', aircraft: 'ZZ-TST1',
    type: ['B38M', '737 MAX 8'], phase: 'approaching', providerStatus: 'Approaching' },
  { n: 300, code: '002', from: 'YYZ', arrival: 'ZZ300', departure: 'ZZ301', scheduledIn: -30, arrivedIn: -22,
    departureIn: 40, stand: 'A2', status: 'InProgress', operation: 'InProgress', agent: 'luis', aircraft: 'ZZ-TST9',
    type: ['A320', 'A320-200'], phase: 'arrived', milestones: [['BLOCK_ON', -22], ['WALKAROUND_START', -21], ['WALKAROUND_END', -17], ['STAIRS_JETBRIDGE', -16],
      ['FIRST_CUSTOMS', -12]] },
  { n: 500, code: '003', from: 'MIA', arrival: 'ZZ500', departure: 'ZZ501', scheduledIn: 50, estimatedIn: 48,
    departureIn: 110, stand: 'B30', status: 'Confirmed', operation: 'Planned', agent: null, aircraft: 'ZZ-TST7',
    type: ['A21N', 'A321neo'], phase: 'enroute', providerStatus: 'EnRoute' },
  { n: 610, code: '004', from: 'BOG', arrival: 'ZZ610', departure: 'ZZ611', scheduledIn: 150, departureIn: 215,
    stand: null, status: 'Scheduled', operation: 'Planned', agent: null, aircraft: null, type: null, phase: 'scheduled',
    providerStatus: 'Expected' },
  { n: 700, code: '005', from: 'YYZ', arrival: 'ZZ700', departure: 'ZZ701', scheduledIn: -150, arrivedIn: -140,
    departureIn: -60, departedIn: -55, stand: 'A3', status: 'Completed', operation: 'PendingReview', agent: 'luis',
    aircraft: 'ZZ-TST8', type: ['B738', '737-800'], phase: 'arrived',
    milestones: [['BLOCK_ON', -140], ['PUSHBACK', -58]] },
]);

// With `openAfterDeparture` (N30): ZZ800 pushed back from A4 80 minutes ago and took off 5 minutes later, and its
// operation is still in progress, more than the hour of D-N30 after it left.
const OPEN_AFTER_DEPARTURE = Object.freeze({ n: 800, code: '006', from: 'MIA', arrival: 'ZZ800', departure: 'ZZ801',
  scheduledIn: -200, arrivedIn: -195, departureIn: -85, departedIn: -75, stand: 'A4', status: 'InProgress',
  operation: 'InProgress', agent: 'marta', aircraft: 'ZZ-TST6', type: ['A320', 'A320-200'], phase: 'arrived',
  milestones: [['BLOCK_ON', -195], ['PUSHBACK', -80]] });
const visitsOf = openAfterDeparture => (openAfterDeparture ? [...VISITS, OPEN_AFTER_DEPARTURE] : VISITS);
// The arrivals whose time left the map's window (2 hours back): their departures are still in it.
const OUT_OF_WINDOW = new Set(['ZZ700', 'ZZ800']);

const turnaroundId = visit => uuid('6a600000', visit.n);
const operationId = visit => uuid('6a700000', visit.n);
const legId = (visit, direction) => uuid('6a800000', visit.n * 10 + (direction === 'Arrival' ? 1 : 2));
const proposalId = (visit, direction) => uuid('6a900000', visit.n * 10 + (direction === 'Arrival' ? 1 : 2));
const operationCode = (visit, day) => `PUJ-${day.replaceAll('-', '')}-${visit.code}`;
const aircraftId = visit => uuid('6aa00000', visit.n);
const assignmentId = visit => uuid('6ab00000', visit.n);

// The planning snapshot's turnaround of a visit.
function planningTurnaround(visit, now, day) {
  const arrivalLeg = {
    id: legId(visit, 'Arrival'), flightNumber: visit.arrival, origin: planningAirport(visit.from),
    destination: planningAirport('PUJ'), scheduledAt: minutes(now, visit.scheduledIn),
    estimatedAt: visit.estimatedIn === undefined ? null : minutes(now, visit.estimatedIn),
    actualAt: visit.arrivedIn === undefined ? null : minutes(now, visit.arrivedIn),
  };
  const departureLeg = {
    id: legId(visit, 'Departure'), flightNumber: visit.departure, origin: planningAirport('PUJ'),
    destination: planningAirport(visit.from), scheduledAt: minutes(now, visit.departureIn), estimatedAt: null,
    actualAt: visit.departedIn === undefined ? null : minutes(now, visit.departedIn),
  };
  const agent = visit.agent ? AGENTS[visit.agent] : null;
  return {
    id: turnaroundId(visit), operationCode: operationCode(visit, day), operationDate: day, status: visit.status,
    airline: { id: AIRLINE.id, iataCode: AIRLINE.iataCode, icaoCode: AIRLINE.icaoCode, name: AIRLINE.name },
    aircraft: visit.aircraft ? { id: aircraftId(visit), icaoCode: visit.type[0], iataCode: null,
      manufacturer: visit.type[0].startsWith('A') ? 'Airbus' : 'Boeing', model: visit.type[1],
      registration: visit.aircraft } : null,
    stand: visit.stand ? { id: standId(visit.stand), code: visit.stand, terminal: TERMINALS[terminalOf(visit.stand)] }
      : null,
    arrival: arrivalLeg,
    departure: departureLeg,
    operation: {
      id: operationId(visit), status: visit.operation, plannedStartAt: minutes(now, visit.scheduledIn),
      plannedEndAt: minutes(now, visit.departureIn),
      actualStartAt: visit.arrivedIn === undefined ? null : minutes(now, visit.arrivedIn + 2),
      actualEndAt: visit.departedIn === undefined ? null : minutes(now, visit.departedIn), passengersIn: null,
      passengersOut: null, mtowKg: null,
    },
    agents: agent ? [{ assignmentId: assignmentId(visit), agentId: agent.agentId, displayName: agent.displayName,
      employeeNumber: agent.employeeNumber, positionId: null, positionCode: null, positionName: null,
      assignmentRole: 'Lead', assignedAt: minutes(now, -180) }] : [],
    equipment: [],
    services: [],
  };
}

/** GET occ/planning?stationId=: the station's day as the server decides it, with ZZ800 when `openAfterDeparture`. */
export function planningSnapshot({ now = Date.now(), stationId = STATION.stationId, openAfterDeparture = false } = {}) {
  const day = stationDay(now);
  return {
    station: { id: stationId, code: STATION.stationCode, name: STATION_NAME, ianaTimeZone: STATION_TIME_ZONE },
    date: day,
    turnarounds: visitsOf(openAfterDeparture).map(visit => planningTurnaround(visit, now, day)),
  };
}

/** GET occ/planning/assignment-readiness?stationId=&date=: nobody assigned is unfit today. */
export function assignmentReadiness({ stationId = STATION.stationId, date }) {
  return { stationId, date, assignments: [] };
}

// The positions board's visit of a stand: what is assigned to it and not yet gone (its PUSHBACK frees it).
function boardVisit(visit, now, day) {
  return {
    turnaroundId: turnaroundId(visit), operationCode: operationCode(visit, day), airlineName: AIRLINE.name,
    aircraftRegistration: visit.aircraft, arrivalFlightNumber: visit.arrival, departureFlightNumber: visit.departure,
    arrivalScheduledAt: minutes(now, visit.scheduledIn),
    arrivedAt: visit.arrivedIn === undefined ? null : minutes(now, visit.arrivedIn),
    departureScheduledAt: minutes(now, visit.departureIn), assignedFrom: minutes(now, -180),
    status: visit.status === 'InProgress' ? 'InProgress' : 'Planned',
  };
}

/** GET occ/positions?stationId=&date=: the board of the station's day. */
export function positionsBoard({ now = Date.now(), stationId = STATION.stationId, date = stationDay(now) } = {}) {
  const listed = VISITS.filter(visit => visit.stand && !(visit.milestones ?? []).some(([code]) => code === 'PUSHBACK'));
  return {
    stationId, stationCode: STATION.stationCode, operationDate: date, asOf: new Date(now).toISOString(),
    positions: STANDS.map(([code, terminalCode, standType]) => {
      const visits = listed.filter(visit => visit.stand === code).map(visit => boardVisit(visit, now, date));
      const arrived = visits.some(visit => visit.arrivedAt !== null);
      return {
        standId: standId(code), code, terminalCode, standType,
        status: visits.length === 0 ? 'available' : arrived ? 'occupied' : 'planned',
        turnarounds: visits, latitude: null, longitude: null, hasBoardingBridge: false,
        isRemote: standType === 'Remote', maxAircraftSize: null,
        // A10 is free and cancelled by its combined neighbour: «Inhabilitada» on the map.
        cancelledBy: code === 'A10' ? 'A9' : null,
        narrowbodyOnly: terminalCode === 'FBO', coveredBy: coveredBy(code),
      };
    }),
    unassigned: [],
    canAssign: true,
  };
}

/** GET occ/review/queue?stationId=: the hand-off of ZZ700, waiting for OCC. */
export function reviewQueue({ now = Date.now(), stationId = STATION.stationId } = {}) {
  const day = stationDay(now);
  const visit = VISITS.find(item => item.n === 700);
  return {
    stationId, stationCode: STATION.stationCode, stationName: STATION_NAME, ianaTimeZone: STATION_TIME_ZONE,
    operations: [{
      operationId: operationId(visit), submissionId: uuid('6ac00000', 700), revisionNumber: 1, status: 'PendingReview',
      operationCode: operationCode(visit, day), operationDate: day, airlineName: AIRLINE.name,
      agentName: AGENTS.luis.displayName, submittedAt: minutes(now, -45), serviceCount: 3, incidentCount: 0,
    }],
    hasMore: false,
  };
}

/**
 * GET notifications: an urgent incident on ZZ300's operation the account has not received, an attention notice it
 * already received and a plain notice of the hand-off. `received` marks the ids the account received in this run.
 */
export function notices({ now = Date.now(), received = new Set() } = {}) {
  const day = stationDay(now);
  const of = n => VISITS.find(item => item.n === n);
  const notice = (id, visit, kind, at, readAt = null) => ({
    id, operationId: operationId(visit), operationCode: operationCode(visit, day), stationCode: STATION.stationCode,
    kind, sourceId: uuid('6ae00000', Number(id.slice(-4))), occurredAt: minutes(now, at),
    readAt: received.has(id) ? minutes(now, 0) : readAt,
  });
  return {
    notifications: [
      notice(uuid('6ad00000', 1), of(300), 'incident_reported', -6),
      notice(uuid('6ad00000', 2), of(500), 'stand_change_unassigned', -35, minutes(now, -30)),
      notice(uuid('6ad00000', 3), of(700), 'operation_submitted', -45),
    ],
    hasMore: false,
  };
}

// The map flights of a visit: its two legs, imported (keys of the import: the proposal of each leg).
function mapLegs(visit, now, day) {
  const turnaround = { id: turnaroundId(visit), operationCode: operationCode(visit, day), status: visit.status,
    operationId: operationId(visit), operationStatus: visit.operation };
  const aircraft = visit.aircraft ? { registration: visit.aircraft, typeIcaoCode: visit.type[0], model: visit.type[1],
    sizeCategory: 'Narrowbody' } : null;
  const stand = visit.stand ? { id: standId(visit.stand), code: visit.stand, terminalCode: terminalOf(visit.stand) } : null;
  const milestones = (visit.milestones ?? []).map(([code, at]) => ({ code, actualAt: minutes(now, at) }));
  const common = { visitKey: `p:${proposalId(visit, 'Arrival')}`, turnaroundId: turnaroundId(visit), airline: AIRLINE,
    aircraft, imported: true, turnaround, stand, suggestedStandCode: null, milestones, isDemo: false, demo: null };
  return [
    {
      ...common, flightKey: `p:${proposalId(visit, 'Arrival')}`, proposalId: proposalId(visit, 'Arrival'),
      legId: legId(visit, 'Arrival'), direction: 'Arrival', flightNumber: visit.arrival,
      callsign: `ZZZ${visit.arrival.slice(2)}`, counterpart: mapAirport(visit.from),
      scheduledAt: minutes(now, visit.scheduledIn),
      estimatedAt: visit.estimatedIn === undefined ? null : minutes(now, visit.estimatedIn),
      actualAt: visit.arrivedIn === undefined ? null : minutes(now, visit.arrivedIn),
      actualKind: visit.arrivedIn === undefined ? null : 'OnBlock', phase: visit.phase,
      providerStatus: visit.providerStatus ?? null,
    },
    {
      ...common, flightKey: `p:${proposalId(visit, 'Departure')}`, proposalId: proposalId(visit, 'Departure'),
      legId: legId(visit, 'Departure'), direction: 'Departure', flightNumber: visit.departure,
      callsign: `ZZZ${visit.departure.slice(2)}`, counterpart: mapAirport(visit.from),
      scheduledAt: minutes(now, visit.departureIn), estimatedAt: null,
      actualAt: visit.departedIn === undefined ? null : minutes(now, visit.departedIn),
      actualKind: visit.departedIn === undefined ? null : 'Runway',
      phase: visit.departedIn === undefined ? 'scheduled' : 'departed', providerStatus: null,
    },
  ];
}

const DEMO = Object.freeze({ arrival: 'ZZ9001', departure: 'ZZ9002', from: 'JFK', arrivalProposal: uuid('6af00000', 1),
  departureProposal: uuid('6af00000', 2), demoFlightId: uuid('6b000000', 1) });

/** The keys of the demo pair in the map flights. */
export const DEMO_FLIGHT_KEYS = Object.freeze({
  arrival: `p:${DEMO.arrivalProposal}`, departure: `p:${DEMO.departureProposal}`,
});

/** The keys of ZZ161, the arrival on final whose aircraft the picture shows. */
export const ARRIVAL_ON_FINAL_KEY = `p:${proposalId(VISITS[0], 'Arrival')}`;

// The demo pair before the import: the server's clock (contratos 1.1), in approach since a minute ago.
function demoLegs(now) {
  const demo = { demoFlightId: DEMO.demoFlightId, state: 'Active', phase: 'Approach', appearAt: minutes(now, -1),
    touchdownAt: seconds(now, 210), onBlockAt: minutes(now, 7), scheduledOffBlockAt: minutes(now, 67), offBlockAt: null,
    takeoffAt: null, vanishAt: null };
  const aircraft = { registration: 'ZZ-DMO1', typeIcaoCode: 'A320', model: 'A320-200', sizeCategory: 'Narrowbody' };
  const common = { visitKey: `p:${DEMO.arrivalProposal}`, legId: null, turnaroundId: null, airline: AIRLINE,
    counterpart: mapAirport(DEMO.from), aircraft, imported: false, turnaround: null, stand: null,
    suggestedStandCode: 'B21', milestones: [], isDemo: true, demo, actualAt: null, actualKind: null };
  return [
    { ...common, flightKey: `p:${DEMO.arrivalProposal}`, proposalId: DEMO.arrivalProposal, direction: 'Arrival',
      flightNumber: DEMO.arrival, callsign: 'ZZZ9001', scheduledAt: minutes(now, 7), estimatedAt: minutes(now, 7),
      phase: 'approaching', providerStatus: 'Approaching' },
    { ...common, flightKey: `p:${DEMO.departureProposal}`, proposalId: DEMO.departureProposal, direction: 'Departure',
      flightNumber: DEMO.departure, callsign: 'ZZZ9002', scheduledAt: minutes(now, 67), estimatedAt: null,
      phase: 'scheduled', providerStatus: 'Expected' },
  ];
}

/**
 * GET occ/map/flights?stationId=: the ELEVANT flights of the window (2 hours back, 12 ahead), the demo pair with `demo`
 * and ZZ800's departure with `openAfterDeparture`.
 */
export function mapFlights({ now = Date.now(), stationId = STATION.stationId, demo = false, openAfterDeparture = false } = {}) {
  const day = stationDay(now);
  return {
    stationId, stationCode: STATION.stationCode, serverTime: new Date(now).toISOString(),
    windowFrom: minutes(now, -120), windowTo: minutes(now, 720), stationAirport: mapAirport('PUJ'),
    // ZZ700 (and ZZ800) left more than two hours of window behind with its arrival; its departure is still in it.
    flights: [...visitsOf(openAfterDeparture).flatMap(visit => mapLegs(visit, now, day))
      .filter(flight => !OUT_OF_WINDOW.has(flight.flightNumber)), ...(demo ? demoLegs(now) : [])],
  };
}

/** The credit of the invented network of the picture. */
export const CONSOLE_TRAFFIC_SOURCE = Object.freeze({
  name: 'Red ADS-B de prueba', homeUrl: 'https://example.org/adsb', licenseName: 'Datos sintéticos', licenseUrl: null,
});

/** The invented addresses of the picture's aircraft. */
export const CONSOLE_HEX = Object.freeze({ onFinal: 'f1c161', overflight: 'f1c804', groundFbo: 'f1c415' });

// The aircraft of the picture: ZZ161 8 NM out on final for 08, an overflight 40 NM north-east and a light aircraft on
// the ground at the FBO; each with the few trail points of `trails=short`.
function pictureAircraft(now, trails) {
  const along = (distanceNm, ago) => ({ at: seconds(now, -ago), ...destination(THRESHOLD_08, FINAL_COURSE_DEG + 180,
    distanceNm * METRES_PER_NM), altitudeFeet: Math.round(distanceNm * 318), onGround: false });
  const onFinal = { hex: CONSOLE_HEX.onFinal, callsign: 'ZZZ161', registration: 'ZZ-TST1', typeIcaoCode: 'B38M',
    category: 'A3', ...destination(THRESHOLD_08, FINAL_COURSE_DEG + 180, 8 * METRES_PER_NM), altitudeFeet: 2_540,
    onGround: false, groundSpeedKnots: 150, trackDegrees: FINAL_COURSE_DEG, verticalRateFeetPerMinute: -768,
    squawk: '4521', positionAt: seconds(now, -3), matchedFlightKey: ARRIVAL_ON_FINAL_KEY, matchedBy: 'Registration',
    trail: trails ? [along(9.2, 33), along(8.8, 23), along(8.4, 13)] : [] };
  const overflight = { hex: CONSOLE_HEX.overflight, callsign: 'ZZZ804', registration: 'ZZ-TST2', typeIcaoCode: 'A20N',
    category: 'A3', ...destination(PUJ, 45, 40 * METRES_PER_NM), altitudeFeet: 34_000, onGround: false,
    groundSpeedKnots: 460, trackDegrees: 320, verticalRateFeetPerMinute: 0, squawk: '2000', positionAt: seconds(now, -5),
    matchedFlightKey: null, matchedBy: null, trail: [] };
  const groundFbo = { hex: CONSOLE_HEX.groundFbo, callsign: null, registration: 'ZZ-TST4', typeIcaoCode: 'C208',
    category: 'A1', ...destination(PUJ, 120, 900), altitudeFeet: null, onGround: true, groundSpeedKnots: 0,
    trackDegrees: null, verticalRateFeetPerMinute: null, squawk: '1200', positionAt: seconds(now, -6),
    matchedFlightKey: null, matchedBy: null, trail: [] };
  return [onFinal, overflight, groundFbo];
}

/** GET occ/map/air-picture?stationId=&trails=: a Live picture of the invented network. */
export function airPicture({ now = Date.now(), stationId = STATION.stationId, trails = 'short' } = {}) {
  return {
    stationId, status: 'Live', reason: null, serverTime: new Date(now).toISOString(), observedAt: seconds(now, -2),
    ageSeconds: 2, refreshAfterSeconds: 10, source: CONSOLE_TRAFFIC_SOURCE,
    center: { latitude: PUJ.latitude, longitude: PUJ.longitude, radiusNm: 250 },
    aircraft: pictureAircraft(now, trails !== 'none'),
  };
}

/** GET occ/map/aircraft/{hex}/track?stationId=: the last minute of an aircraft of the picture, oldest first. */
export function aircraftTrack({ now = Date.now(), hex }) {
  const aircraft = pictureAircraft(now, false).find(item => item.hex === hex) ?? null;
  const points = aircraft === null ? [] : Array.from({ length: 7 }, (_, index) => {
    const ago = (6 - index) * 10;
    const nm = (aircraft.groundSpeedKnots ?? 0) * (ago / 3_600);
    const point = destination(aircraft, ((aircraft.trackDegrees ?? 0) + 180) % 360, nm * METRES_PER_NM);
    return { at: seconds(now, -3 - ago), ...point, altitudeFeet: aircraft.altitudeFeet, onGround: aircraft.onGround };
  });
  return { hex, serverTime: new Date(now).toISOString(), source: CONSOLE_TRAFFIC_SOURCE, points };
}

/** GET system/ping: the server's time, which sets the app's clock. */
export function ping({ now = Date.now() } = {}) {
  return { application: 'Elevant.Api', status: 'Healthy', environment: 'Development', timestampUtc: new Date(now).toISOString() };
}

/**
 * The API handler of the console for support/isolate.mjs. It answers every read of the console from the day above at the
 * moment of each request, and «Recibido» (PUT notifications/{id}/read), which the next read of the notices keeps. Every
 * other path is the isolation's 404. `triggerDemo()` fires the demo flight: from then on the map flights carry the demo
 * pair and the change feed announces `occ_planning` once. `openAfterDeparture` adds ZZ800, whose operation is still open
 * after its departure, to the planning and the map flights. `reads` counts what was served, by path name.
 */
export function createConsoleApi({ demo = false, openAfterDeparture = false } = {}) {
  const state = { demo, changes: [], received: new Set() };
  const api = { reads: {}, acknowledged: [] };
  const count = name => { api.reads[name] = (api.reads[name] ?? 0) + 1; };
  api.triggerDemo = (now = Date.now()) => {
    state.demo = true;
    state.changes.push({ eventId: uuid('6b100000', state.changes.length + 1), cursor: `c${state.changes.length + 1}`,
      resource: 'occ_planning', resourceId: STATION.stationId, occurredAt: new Date(now).toISOString() });
  };
  api.handle = (request, url) => {
    const now = Date.now();
    const read = request.method() === 'PUT' ? NOTICE_READ_PATH.exec(url.pathname) : null;
    if (read) {
      const id = read[1];
      state.received.add(id);
      api.acknowledged.push(id);
      const notice = notices({ now, received: state.received }).notifications.find(item => item.id === id);
      return notice ? { status: 200, json: notice } : null;
    }
    if (request.method() !== 'GET') return null;
    const stationId = url.searchParams.get('stationId') ?? STATION.stationId;
    const track = TRACK_PATH.exec(url.pathname);
    if (track) {
      count('track');
      return { status: 200, json: aircraftTrack({ now, hex: track[1] }) };
    }
    switch (url.pathname) {
      case CONSOLE_PATHS.access: count('access'); return { status: 200, json: OCC_ACCESS };
      case CONSOLE_PATHS.planning:
        count('planning');
        return { status: 200, json: planningSnapshot({ now, stationId, openAfterDeparture }) };
      case CONSOLE_PATHS.readiness:
        count('readiness');
        return { status: 200, json: assignmentReadiness({ stationId, date: url.searchParams.get('date') }) };
      case CONSOLE_PATHS.positions:
        count('positions');
        return { status: 200, json: positionsBoard({ now, stationId, date: url.searchParams.get('date') }) };
      case CONSOLE_PATHS.reviewQueue: count('reviewQueue'); return { status: 200, json: reviewQueue({ now, stationId }) };
      case CONSOLE_PATHS.notices: count('notices'); return { status: 200, json: notices({ now, received: state.received }) };
      case CONSOLE_PATHS.mapFlights:
        count('mapFlights');
        return { status: 200, json: mapFlights({ now, stationId, demo: state.demo, openAfterDeparture }) };
      case CONSOLE_PATHS.airPicture:
        count('airPicture');
        return { status: 200, json: airPicture({ now, stationId, trails: url.searchParams.get('trails') ?? 'short' }) };
      case CONSOLE_PATHS.ping: count('ping'); return { status: 200, json: ping({ now }) };
      // The aerodrome weather through the API (PR M8): an invented live METAR and TAF, never aviationweather.gov.
      case '/api/v1/occ/weather': count('weather'); return { status: 200, json: aerodromeWeather({ now, stationId }) };
      // AeroDataBox through the API (ADR-0028, note of 15 November 2026): invented answers, never the provider.
      case '/api/v1/occ/aviation/routes': count('airportRoutes'); return { status: 200, json: airportRoutes({ now, stationId }) };
      case '/api/v1/occ/aviation/delays':
        count('airportDelays');
        return { status: 200, json: airportDelays({ now, stationId, airport: url.searchParams.get('airport') }) };
      case '/api/v1/occ/aviation/aircraft':
        count('aircraftReference');
        return { status: 200, json: aircraftReference({ now, stationId, registration: url.searchParams.get('registration') }) };
      case CONSOLE_PATHS.changes: {
        count('changes');
        const after = url.searchParams.get('after');
        const from = after === null ? 0 : state.changes.findIndex(item => item.cursor === after) + 1;
        const page = state.changes.slice(from);
        return { status: 200, json: { changes: page, nextCursor: page.at(-1)?.cursor ?? after ?? null, hasMore: false } };
      }
      default: return null;
    }
  };
  return api;
}

// The daily routes from PUJ (invented frequencies; the airports and their positions are public).
const ROUTES = Object.freeze([
  ['SJU', 'TJSJ', 'San Juan Luis Muñoz Marín', 'PR', 18.4394, -66.0018, 4.5],
  ['MIA', 'KMIA', 'Miami International', 'US', 25.7959, -80.287, 7],
  ['JFK', 'KJFK', 'New York JFK', 'US', 40.6398, -73.7789, 6],
  ['YYZ', 'CYYZ', 'Toronto Pearson', 'CA', 43.6772, -79.6306, 5],
  ['PTY', 'MPTO', 'Panamá Tocumen', 'PA', 9.0714, -79.3835, 3],
  ['BOG', 'SKBO', 'Bogotá El Dorado', 'CO', 4.7016, -74.1469, 2],
  ['CCS', 'SVMI', 'Caracas Simón Bolívar', 'VE', 10.6031, -66.9906, 1],
  ['AUA', 'TNCA', 'Aruba Reina Beatrix', 'AW', 12.5014, -70.0152, 1.5],
  ['MAD', 'LEMD', 'Madrid Barajas', 'ES', 40.4719, -3.5626, 2],
]);

/** The daily routes from PUJ as the API answers them (AeroDataBox, invented). */
export function airportRoutes({ now = Date.now(), stationId = STATION.stationId } = {}) {
  return { stationId, airportIcao: 'MDPC', status: 'Available', serverTime: new Date(now).toISOString(),
    retrievedAt: new Date(now - 3 * 3_600_000).toISOString(), source: 'AeroDataBox',
    routes: ROUTES.map(([iata, icao, name, countryCode, latitude, longitude, flights]) => ({ destinationIata: iata,
      destinationIcao: icao, name, city: null, countryCode, latitude, longitude, averageDailyFlights: flights,
      operators: ['Demo Airlines'] })) };
}

/** The current delays of PUJ (or of `airport`) as the API answers them (AeroDataBox, invented). */
export function airportDelays({ now = Date.now(), stationId = STATION.stationId, airport = null } = {}) {
  const batch = (total, median, index) => ({ total, qualified: total - 1, cancelled: 0, medianDelayMinutes: median,
    delayIndex: index });
  return { stationId, airport: airport ?? 'MDPC', status: 'Available', serverTime: new Date(now).toISOString(),
    retrievedAt: new Date(now - 10 * 60_000).toISOString(), source: 'AeroDataBox',
    delays: { airportIcao: airport && airport.length === 4 ? airport : 'MDPC', from: new Date(now - 7_200_000).toISOString(),
      to: new Date(now).toISOString(), arrivals: batch(14, 12, 1.7), departures: batch(11, 8, 1.1) } };
}

/** Any registration as an invented Boeing 737-800 (AeroDataBox through the API). */
export function aircraftReference({ now = Date.now(), stationId = STATION.stationId, registration = 'HI1055' } = {}) {
  return { stationId, registration, status: 'Available', serverTime: new Date(now).toISOString(),
    retrievedAt: new Date(now - 3_600_000).toISOString(), source: 'AeroDataBox',
    aircraft: { registration, active: true, model: 'Boeing 737-800', typeName: 'Boeing 737', icaoType: 'B738',
      iataType: '73H', operator: 'Demo Airlines', serial: '12345', modeS: '0C2ABC', seats: 186, engines: 2,
      engineType: 'Jet', ageYears: 9.3, firstFlight: '2017-06-12', delivered: '2017-07-01', registered: '2017-07-01',
      isFreighter: false } };
}

/**
 * Today's METAR of MDPC as Iowa Environmental Mesonet answers it (/api/1/currents.json), written `ageMinutes` before
 * `now`: the weather pill's read until PR M8, which reads `GET occ/weather` instead (handled above). Synthetic.
 */
export function iemCurrents({ now = Date.now(), ageMinutes = 20 } = {}) {
  const at = new Date(now - ageMinutes * 60_000);
  const stamp = `${String(at.getUTCDate()).padStart(2, '0')}${String(at.getUTCHours()).padStart(2, '0')}`
    + `${String(at.getUTCMinutes()).padStart(2, '0')}Z`;
  return {
    data: [{
      station: 'MDPC', utc_valid: at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      raw: `MDPC ${stamp} 10013G25KT 9999 FEW022 30/23 Q1015`, relh: 66, feel: 93, phour: 0,
    }],
  };
}
