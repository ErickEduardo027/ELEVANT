import { STATION, airPicture, createOccApi, mapFlights, operationDateAt } from './occApi.mjs';

// Synthetic answers of the ELEVANT API for Monitoreo de vuelos in the visual suite (tests/visual/occ/
// flight-monitoring.spec.mjs), on top of createOccApi (fixtures/occApi.mjs): its access, its air picture, its map flights
// and its ping, and a planning snapshot built from those same map flights, so the board and the map name the same legs
// (the page reads the snapshot, the map its own reads). They pass the strict validators of @elevant/api-client
// (tests/visualMonitoringFixtures.test.js checks them). Every id, flight, registration, name and position is invented;
// nothing comes from a provider.
//
// The day: the board's visits of occApi.mjs with both legs (on their stands, landing, due later), the demo flight ZZ9001
// imported onto A3 (`isDemo`), and one more visit only this fixture adds, ZZ130 from SDQ due in 25 minutes with no stand
// and nobody assigned (the amber «Llegada sin posición asignada»). The empty day has no flight at all: the map flights and
// the snapshot are empty, and the air picture's aircraft match none of them.

const MINUTE_MS = 60 * 1000;
const uuid = (group, index) => `${group}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const iso = ms => new Date(ms).toISOString();

const STATION_NAME = 'Punta Cana International Airport';
const STATION_TIME_ZONE = 'America/Santo_Domingo';
const PUJ_AIRPORT = Object.freeze({ id: uuid('6c100000', 1), iataCode: 'PUJ', icaoCode: 'MDPC',
  name: 'Punta Cana International' });
const AIRPORT_IDS = Object.freeze({ MIA: uuid('6c100000', 2), JFK: uuid('6c100000', 3), SDQ: uuid('6c100000', 4) });
const SDQ = Object.freeze({ iataCode: 'SDQ', icaoCode: 'MDSD', name: 'Las Américas International', latitude: 18.4297,
  longitude: -69.6689 });
const TERMINALS = Object.freeze({
  A: Object.freeze({ id: uuid('6c200000', 1), code: 'A', name: 'Terminal A' }),
  B: Object.freeze({ id: uuid('6c200000', 2), code: 'B', name: 'Terminal B' }),
  FBO: Object.freeze({ id: uuid('6c200000', 3), code: 'FBO', name: 'FBO / Aviación local' }),
});
// The aircraft types of the day, with their maker and model as the planning snapshot names them.
const TYPES = Object.freeze({
  A320: ['Airbus', 'A320-200'], A321: ['Airbus', 'A321-200'], A20N: ['Airbus', 'A320neo'], B738: ['Boeing', '737-800'],
  B38M: ['Boeing', '737 MAX 8'], E190: ['Embraer', 'E190'], AT76: ['ATR', 'ATR 72-600'],
});
const SERVICES = Object.freeze([['BAGGAGE', 'Manejo de equipaje'], ['GPU', 'Planta eléctrica'], ['CLEANING', 'Limpieza']]);
// The operations with somebody on them: the agent of a visit, by its index.
const STAFFED = new Set(['InProgress', 'Assigned', 'Returned']);

/** The visit only Monitoreo adds: an arrival from SDQ due in 25 minutes, without a stand or an agent. */
export const UNASSIGNED_VISIT = Object.freeze({ index: 30, arrival: 'ZZ130', departure: 'ZZ230', arrivalInMin: 25,
  departureInMin: 95 });

const legIdOf = (index, direction) => uuid('7c1d2e3f', index * 2 + (direction === 'Arrival' ? 0 : 1));

// The two map legs of the visit without a stand, with every key of the contract (contracts 1.3).
function unassignedLegs(now, airline) {
  const { index } = UNASSIGNED_VISIT;
  const turnaroundId = uuid('7a1b2c3d', index);
  const common = {
    visitKey: `t:${turnaroundId}`, proposalId: null, turnaroundId, airline, counterpart: SDQ, estimatedAt: null, actualAt: null,
    actualKind: null, providerStatus: null, aircraft: null, imported: true,
    turnaround: { id: turnaroundId, operationCode: `VIS-TAT-${String(index).padStart(4, '0')}`, status: 'Scheduled',
      operationId: uuid('7e2f3a4b', index), operationStatus: 'Planned' },
    stand: null, suggestedStandCode: null, milestones: [], isDemo: false, demo: null,
  };
  const leg = (direction, flightNumber, minutes) => ({
    ...common, flightKey: `l:${legIdOf(index, direction)}`, legId: legIdOf(index, direction), direction, flightNumber,
    callsign: `ZZZ${flightNumber.slice(2)}`, scheduledAt: iso(now + minutes * MINUTE_MS), phase: 'scheduled',
  });
  return [leg('Arrival', UNASSIGNED_VISIT.arrival, UNASSIGNED_VISIT.arrivalInMin),
    leg('Departure', UNASSIGNED_VISIT.departure, UNASSIGNED_VISIT.departureInMin)];
}

/**
 * GET occ/map/flights?stationId=: createOccApi's map flights at `now` with the visit without a stand, or none on the
 * empty day.
 */
export function monitoringMapFlights({ stationId = STATION.stationId, now = Date.now(), demo, empty = false } = {}) {
  const base = mapFlights({ stationId, now, ...(demo ? { demo } : {}) });
  if (empty) return { ...base, flights: [] };
  return { ...base, flights: [...base.flights, ...unassignedLegs(now, base.flights[0].airline)] };
}

const planningAirport = airport => ({ id: AIRPORT_IDS[airport.iataCode] ?? uuid('6c100000', 9), iataCode: airport.iataCode,
  icaoCode: airport.icaoCode ?? airport.iataCode, name: airport.name });

function planningLeg(leg) {
  const counterpart = planningAirport(leg.counterpart ?? SDQ);
  const arrival = leg.direction === 'Arrival';
  return {
    id: leg.legId, flightNumber: leg.flightNumber, origin: arrival ? counterpart : PUJ_AIRPORT,
    destination: arrival ? PUJ_AIRPORT : counterpart, scheduledAt: leg.scheduledAt, estimatedAt: leg.estimatedAt ?? null,
    actualAt: leg.actualAt ?? null,
  };
}

// The planning snapshot's turnaround of one visit of the map flights (its legs share its turnaround).
function planningTurnaround(legs, day, now, order) {
  const arrival = legs.find(leg => leg.direction === 'Arrival') ?? null;
  const departure = legs.find(leg => leg.direction === 'Departure') ?? null;
  const { turnaround, stand, aircraft, airline } = arrival ?? departure;
  const staffed = STAFFED.has(turnaround.operationStatus);
  const type = aircraft?.typeIcaoCode ?? null;
  const [manufacturer, model] = TYPES[type] ?? ['Airbus', type];
  const services = SERVICES.slice(0, staffed ? 1 + (order % SERVICES.length) : 0);
  return {
    id: turnaround.id, operationCode: turnaround.operationCode, operationDate: day, status: turnaround.status,
    airline: { id: airline.id, iataCode: airline.iataCode, icaoCode: airline.icaoCode, name: airline.name },
    // The snapshot names an aircraft by its type; a visit without one has none.
    aircraft: type ? { id: uuid('6c300000', order + 1), icaoCode: type, iataCode: null, manufacturer,
      model: aircraft.model ?? model, registration: aircraft.registration } : null,
    stand: stand ? { id: stand.id, code: stand.code, terminal: TERMINALS[stand.terminalCode] ?? null } : null,
    arrival: arrival ? planningLeg(arrival) : null,
    departure: departure ? planningLeg(departure) : null,
    operation: {
      id: turnaround.operationId, status: turnaround.operationStatus, plannedStartAt: arrival?.scheduledAt ?? null,
      plannedEndAt: departure?.scheduledAt ?? null,
      actualStartAt: turnaround.operationStatus === 'InProgress' ? arrival?.actualAt ?? null : null, actualEndAt: null,
      passengersIn: null, passengersOut: null, mtowKg: null,
    },
    agents: staffed ? [{
      assignmentId: uuid('6c400000', order + 1), agentId: uuid('6c500000', (order % 3) + 1),
      displayName: ['Marta Castillo', 'Luis Peña', 'Ana Rosario'][order % 3], employeeNumber: `EMP-01${10 + (order % 3)}`,
      positionId: null, positionCode: null, positionName: null, assignmentRole: 'Lead', assignedAt: iso(now - 180 * MINUTE_MS),
    }] : [],
    equipment: [],
    services: services.map(([code, name], line) => ({
      id: uuid('6c600000', (order + 1) * 10 + line), lineNumber: line + 1, serviceDefinitionId: uuid('6c700000', line + 1),
      code, name, contractedQuantity: 1, executedQuantity: 0, billingUnit: 'operation', status: 'Planned',
    })),
    // ADR-0041: the mark comes only when true.
    ...(legs.some(leg => leg.isDemo) ? { isDemo: true } : {}),
  };
}

/**
 * GET occ/planning?stationId=: the station's day as the server decides it, one turnaround per visit of the map flights
 * (monitoringMapFlights), in their order; none on the empty day.
 */
export function monitoringSnapshot({ stationId = STATION.stationId, now = Date.now(), demo, empty = false, date = null } = {}) {
  const day = date ?? operationDateAt(now);
  const visits = new Map();
  for (const leg of monitoringMapFlights({ stationId, now, demo, empty }).flights) {
    if (!visits.has(leg.turnaroundId)) visits.set(leg.turnaroundId, []);
    visits.get(leg.turnaroundId).push(leg);
  }
  return {
    station: { id: stationId, code: STATION.stationCode, name: STATION_NAME, ianaTimeZone: STATION_TIME_ZONE },
    date: day,
    turnarounds: [...visits.values()].map((legs, order) => planningTurnaround(legs, day, now, order)),
  };
}

/** GET occ/map/air-picture: createOccApi's sky; on the empty day no aircraft is an ELEVANT flight. */
export function monitoringAirPicture({ stationId = STATION.stationId, now = Date.now(), empty = false } = {}) {
  const picture = airPicture({ stationId, now });
  if (!empty) return picture;
  return { ...picture, aircraft: picture.aircraft.map(item => ({ ...item, matchedFlightKey: null, matchedBy: null })) };
}

/**
 * The API handler of Monitoreo for support/isolate.mjs: createOccApi's (the access, the map reads, the ping), with the
 * day of this fixture in the planning snapshot and the map flights (`empty` for a day without flights). `planningReads`
 * counts the snapshots served.
 */
export function createMonitoringApi({ empty = false, startedAt = Date.now() } = {}) {
  const api = createOccApi({ startedAt });
  const base = api.handle;
  api.planningReads = 0;
  api.empty = empty;
  api.handle = (request, url) => {
    if (request.method() === 'GET') {
      const now = Date.now();
      const stationId = url.searchParams.get('stationId') ?? STATION.stationId;
      if (url.pathname === '/api/v1/occ/planning') {
        api.planningReads += 1;
        return { status: 200, json: monitoringSnapshot({ stationId, now, demo: api.demo, empty,
          date: url.searchParams.get('date') }) };
      }
      if (url.pathname === '/api/v1/occ/map/flights') {
        api.mapReads.flights += 1;
        return { status: 200, json: monitoringMapFlights({ stationId, now, demo: api.demo, empty }) };
      }
      if (url.pathname === '/api/v1/occ/map/air-picture') {
        api.mapReads.airPicture += 1;
        return { status: 200, json: monitoringAirPicture({ stationId, now, empty }) };
      }
    }
    return base(request, url);
  };
  return api;
}

/** The leg id of an arrival of the day (occApi.mjs's visits by index, UNASSIGNED_VISIT, 9001 the demo arrival). */
export const arrivalLegOf = index => (index === 9001 ? uuid('7c1d2e3f', 9001) : legIdOf(index, 'Arrival'));
