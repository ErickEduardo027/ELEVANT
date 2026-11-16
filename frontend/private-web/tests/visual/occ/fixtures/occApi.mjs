import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic answers of the ELEVANT API for the OCC screens of the visual suite: an OCC account of Punta Cana, its
// department access, a positions board, the aerodrome weather (PR M8) and (PR M6) the three map reads with the server
// ping, the planning snapshot and its readiness, all passing the strict validators of @elevant/api-client
// (tests/visualOccFixtures.test.js checks them). Every id, flight, registration, report, ADS-B address and position is
// invented; nothing comes from a provider.
//
// The map reads tell one story, relative to the moment the stub starts (`createOccApi`), on the board's stands: an
// imported demo flight that landed on 08 two minutes ago and taxis to A3 (the server parks it in three minutes); ZZ111,
// live on the ground and holding 90 m short of B24, where it is due; ZZ102, live and standing on A6, whose arrival
// nobody recorded; the turnarounds on A2, A7, B21, B31 and BN8 with their BLOCK_ON and more milestones; aircraft types
// for every visit, so the stands draw them to scale; another aircraft standing on B28 and an overflight far away.

export const STATION = Object.freeze({ stationId: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b', stationCode: 'PUJ' });
const ACCOUNT_ID = '2b7c4e1a-9d3f-4c5b-8e6a-1f2d3c4b5a69';

/** Where src/features/auth/authService.js keeps the session (its AUTH_STORAGE_KEY). */
export const AUTH_STORAGE_KEY = 'elevant-auth-session';

/** The session authService.readSession accepts for an OCC administrator of PUJ, valid for eight hours from `now`. */
export function occSession(now = Date.now()) {
  return {
    token: 'visual-suite-token',
    expiresAt: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
    refreshToken: null,
    refreshExpiresAt: null,
    accountId: ACCOUNT_ID,
    email: 'occ.visual@elevant.test',
    name: 'Prueba visual OCC',
    role: 'ADMIN_OCC',
    roleLabel: 'Administrador OCC',
    homePath: '/admin-occ',
    memberships: [],
    stationScopes: [{ stationId: STATION.stationId, stationCode: STATION.stationCode }],
  };
}

/** GET governance/me/access: an OCC administrator who reads every OCC module of PUJ. */
export const OCC_ACCESS = Object.freeze({
  kind: 'Administrator',
  department: 'operations',
  permissions: Object.freeze([
    'operations.dashboard.read', 'operations.planning.read', 'operations.coverage.read', 'operations.master_data.read',
    'operations.devices.read', 'operations.flight_monitoring.read', 'operations.positions_map.read',
    'operations.review.read', 'operations.reports.read', 'operations.notifications.read', 'operations.chat.read',
  ]),
  stations: Object.freeze([Object.freeze({ id: STATION.stationId, code: STATION.stationCode })]),
  canManageDepartmentUsers: false,
  canValidateAccessRequests: false,
});

// The stands of the board: the reference codes of Punta Cana, with the terminal and type of each.
const STANDS = [
  ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11'].map(code => [code, 'A', 'Contact']),
  ...['AN1', 'AN2', 'AN3', 'AN4', 'AN5'].map(code => [code, 'A', 'Remote']),
  ...['B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'B26'].map(code => [code, 'B', 'Contact']),
  ...['B27', 'B28', 'B29', 'B30', 'B31'].map(code => [code, 'B', 'Contact']),
  ...['B32', 'B34', 'B35', 'B36', 'B37'].map(code => [code, 'B', 'Remote']),
  // BN13 is left out: a map stand with no database row reads as «Sin verificar».
  ...['BN6', 'BN7', 'BN8', 'BN9', 'BN10', 'BN11', 'BN12'].map(code => [code, 'FBO', 'Remote']),
];
// Synthetic visits: on the stand, due on it, and a free stand cancelled by its combined neighbour; then a flight due
// within 15 minutes («Llegando» on the map) and an aircraft leaving within 15 («Por liberar»). Two stands with a flight
// due within the hour have nobody covering them («Sin agente que la cubra»).
const OCCUPIED = new Map([['A2', 1], ['A6', 2], ['B21', 3], ['B31', 4], ['BN8', 5]]);
const PLANNED = new Map([['A4', 6], ['A9', 7], ['B25', 8], ['AN2', 9]]);
const ARRIVING = new Map([['A3', [10, 8]], ['B24', [11, 12]]]);
const RELEASING = new Map([['A7', 12]]);
const UNCOVERED = new Set(['B24', 'AN2']);
const CANCELLED_BY = new Map([['A10', 'A9']]);

const MINUTE_MS = 60 * 1000;
const uuid = (group, index) => `${group}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const minutes = (base, delta) => new Date(base + delta * MINUTE_MS).toISOString();
const iso = ms => (ms === null ? null : new Date(ms).toISOString());
const standIdOf = code => uuid('5e4d3c2b', STANDS.findIndex(([stand]) => stand === code) + 1);
const turnaroundIdOf = index => uuid('7a1b2c3d', index);

// A visit of the board: its arrival `arrivalInMin` minutes from `now` (recorded 5 minutes later when `arrived`) and
// its departure `departureInMin` minutes from it. `times` replaces them with instants (the demo flight's), and `isDemo`
// marks a demo flight (contracts 1.1: the key comes only when true).
function turnaround(index, now, { arrived, arrivalInMin = arrived ? -40 : 50, departureInMin = arrived ? 45 : 140, times = null,
  isDemo = false }) {
  return {
    turnaroundId: turnaroundIdOf(index),
    operationCode: `VIS-TAT-${String(index).padStart(4, '0')}`,
    airlineName: 'Aerolínea de prueba',
    aircraftRegistration: `HI${1000 + index}`,
    arrivalFlightNumber: `ZZ${100 + index}`,
    departureFlightNumber: `ZZ${200 + index}`,
    arrivalScheduledAt: times ? iso(times.arrivalAt) : minutes(now, arrivalInMin),
    arrivedAt: times ? iso(times.arrivedAt) : arrived ? minutes(now, arrivalInMin + 5) : null,
    departureScheduledAt: times ? iso(times.departureAt) : minutes(now, departureInMin),
    assignedFrom: minutes(now, -120),
    status: arrived || times?.arrivedAt != null ? 'InProgress' : 'Planned',
    ...(isDemo ? { isDemo: true } : {}),
  };
}

/**
 * GET occ/positions?stationId=&date=: the board of the station for that operation date, as of `now`. `located` maps a
 * stand id to the location OCC saved for it (`{ latitude, longitude }`, «Ubicar en el mapa»); every other stand has
 * none. With `demo` (demoClock), the visit on A3 is that demo flight: due at its on-block, arrived at its touchdown once
 * that is past, as the demo worker records it (PR M6).
 */
export function positionsBoard({ stationId = STATION.stationId, date, now = Date.now(), located = new Map(), demo = null } = {}) {
  return {
    stationId,
    stationCode: STATION.stationCode,
    operationDate: date,
    asOf: new Date(now).toISOString(),
    positions: STANDS.map(([code, terminalCode, standType], index) => {
      const standId = uuid('5e4d3c2b', index + 1);
      const place = located.get(standId) ?? null;
      let visit = null;
      if (OCCUPIED.has(code)) visit = turnaround(OCCUPIED.get(code), now, { arrived: true });
      else if (RELEASING.has(code)) visit = turnaround(RELEASING.get(code), now, { arrived: true, arrivalInMin: -50, departureInMin: 10 });
      else if (code === 'A3' && demo !== null) {
        visit = turnaround(ARRIVING.get(code)[0], now, { arrived: false, isDemo: true, times: {
          arrivalAt: demo.onBlockAt, arrivedAt: now >= demo.touchdownAt ? demo.touchdownAt : null,
          departureAt: demo.scheduledOffBlockAt,
        } });
      } else if (ARRIVING.has(code)) {
        const [visitIndex, arrivalInMin] = ARRIVING.get(code);
        visit = turnaround(visitIndex, now, { arrived: false, arrivalInMin, departureInMin: arrivalInMin + 60 });
      } else if (PLANNED.has(code)) visit = turnaround(PLANNED.get(code), now, { arrived: false });
      return {
        standId,
        code,
        terminalCode,
        standType,
        status: visit === null ? 'available' : visit.arrivedAt ? 'occupied' : 'planned',
        turnarounds: visit ? [visit] : [],
        latitude: place?.latitude ?? null,
        longitude: place?.longitude ?? null,
        hasBoardingBridge: false,
        isRemote: standType === 'Remote',
        maxAircraftSize: null,
        cancelledBy: CANCELLED_BY.get(code) ?? null,
        narrowbodyOnly: false,
        coveredBy: visit && !UNCOVERED.has(code) ? ['Agente de prueba'] : [],
      };
    }),
    unassigned: [],
    canAssign: true,
  };
}

const pad = (value, length) => String(value).padStart(length, '0');
// «131450»: the day, hour and minute of an instant in UTC, as a METAR writes it.
const dayTime = ms => {
  const date = new Date(ms);
  return `${pad(date.getUTCDate(), 2)}${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}`;
};

/**
 * GET occ/weather?stationId= (PR M8): the aerodrome weather of the station as of `now`, Live, with an invented METAR
 * observed ten minutes before (wind 100° at 13 kt, as the map lab's) and a one-period TAF around it, with the credit the
 * API always sends. Nothing of it comes from aviationweather.gov.
 */
export function aerodromeWeather({ stationId = STATION.stationId, now = Date.now() } = {}) {
  const observedAt = now - 10 * 60 * 1000;
  return {
    stationId,
    icaoCode: 'MDPC',
    status: 'Live',
    serverTime: iso(now),
    retrievedAt: iso(now - 3 * 60 * 1000),
    source: { name: 'NOAA Aviation Weather Center', homeUrl: 'https://aviationweather.gov' },
    metar: {
      raw: `MDPC ${dayTime(observedAt)}Z 10013KT 9999 SCT020 29/22 Q1015`,
      observedAt: iso(observedAt),
      flightCategory: 'VFR',
      windDirectionDegrees: 100,
      windVariable: false,
      windSpeedKnots: 13,
      windGustKnots: null,
      visibilityStatuteMiles: 6,
      temperatureCelsius: 29,
      dewpointCelsius: 22,
      altimeterHectopascals: 1015,
      weather: null,
      clouds: [{ cover: 'SCT', baseFeet: 2000 }],
    },
    taf: {
      raw: `TAF MDPC ${dayTime(now - 4 * 60 * 60 * 1000)}Z ${dayTime(now - 3 * 60 * 60 * 1000).slice(0, 4)}/`
        + `${dayTime(now + 21 * 60 * 60 * 1000).slice(0, 4)} 09012KT 9999 FEW020`,
      issuedAt: iso(now - 4 * 60 * 60 * 1000),
      validFrom: iso(now - 3 * 60 * 60 * 1000),
      validTo: iso(now + 21 * 60 * 60 * 1000),
      periods: [{
        from: iso(now - 3 * 60 * 60 * 1000),
        to: iso(now + 21 * 60 * 60 * 1000),
        change: null,
        probabilityPercent: null,
        windDirectionDegrees: 90,
        windVariable: false,
        windSpeedKnots: 12,
        windGustKnots: null,
        visibilityStatuteMiles: 6,
        weather: null,
        clouds: [{ cover: 'FEW', baseFeet: 2000 }],
      }],
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The map reads (PR M6, contracts 1.3).

// The stands of the airport layout the map draws (its centres and headings), read once from the generated dataset.
// Next to this module when it is loaded from a file (Playwright); else, under vitest's jsdom, from the app's folder, where
// both suites run.
function layoutPath() {
  const url = new URL('../../../../src/features/maps/airport/data/mdpc.layout.json', import.meta.url);
  return url.protocol === 'file:' ? fileURLToPath(url.href)
    : path.resolve(process.cwd(), 'src/features/maps/airport/data/mdpc.layout.json');
}
const LAYOUT = JSON.parse(readFileSync(layoutPath(), 'utf8'));
const layoutStand = code => LAYOUT.stands.find(stand => stand.code === code);
const PUJ = Object.freeze({ latitude: 18.5674, longitude: -68.3634 });
const EARTH_RADIUS_M = 6371008.8;
const round6 = value => Math.round(value * 1e6) / 1e6;

// The point `distanceM` metres from `[lng, lat]` along `bearingDeg`, on the sphere.
function destination([lng, lat], bearingDeg, distanceM) {
  const angle = distanceM / EARTH_RADIUS_M;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const sinPhi = Math.sin(phi) * Math.cos(angle) + Math.cos(phi) * Math.sin(angle) * Math.cos(theta);
  const lambda = (lng * Math.PI) / 180 + Math.atan2(Math.sin(theta) * Math.sin(angle) * Math.cos(phi),
    Math.cos(angle) - Math.sin(phi) * sinPhi);
  return [round6((lambda * 180) / Math.PI), round6((Math.asin(sinPhi) * 180) / Math.PI)];
}

/** The credit of an invented network: the picture's `source`. */
export const MAP_SOURCE = Object.freeze({
  name: 'Red ADS-B de prueba', homeUrl: 'https://example.org/adsb', licenseName: 'Datos sintéticos', licenseUrl: null,
});
const AIRLINE = Object.freeze({ id: uuid('7b0a1c2d', 1), name: 'Aerolínea de prueba', iataCode: 'ZZ', icaoCode: 'ZZZ' });
const MIA = Object.freeze({ iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami International', latitude: 25.7932, longitude: -80.2906 });
const JFK = Object.freeze({ iataCode: 'JFK', icaoCode: 'KJFK', name: 'John F. Kennedy International', latitude: 40.6413,
  longitude: -73.7781 });
const PHASES = Object.freeze(['Approach', 'TaxiIn', 'Parked', 'TaxiOut', 'Departed', 'Gone']);
const MILESTONE_CODES = Object.freeze(['BLOCK_ON', 'WALKAROUND_START', 'WALKAROUND_END', 'STAIRS_JETBRIDGE', 'SECOND_STAIRS',
  'UNLOADING_EQUIPMENT', 'FIRST_CUSTOMS', 'LAST_CUSTOMS', 'UNLOAD_SHEET', 'LOAD_SHEET', 'COMMERCIAL_CARGO', 'FIRST_MAKEUP',
  'LAST_MAKEUP', 'FIRST_LOADING', 'LAST_LOADING', 'LAVATORY_SERVICE', 'POTABLE_WATER', 'AMBULIFT']);
const aircraftOf = (typeIcaoCode, index, sizeCategory = 'Narrowbody') => ({
  registration: `HI${1000 + index}`, typeIcaoCode, model: null, sizeCategory,
});

/**
 * The clock of the demo flight as the server's DemoFlightTimeline writes it (contracts 1.1), for a flight that appeared
 * nine minutes before `startedAt` and reaches its stand twelve minutes after it appeared: the taxi-in is 45 % of that,
 * capped at 5 minutes, so it touched down on 08 two minutes before `startedAt`; imported, it waits on its stand (no
 * off-block). Epoch milliseconds.
 */
export function demoClock(startedAt = Date.now()) {
  const appearAt = startedAt - 9 * MINUTE_MS;
  const onBlockAt = appearAt + 12 * MINUTE_MS;
  const taxiIn = Math.min(Math.max(Math.floor(0.45 * (onBlockAt - appearAt)), 90_000), 300_000);
  return Object.freeze({
    demoFlightId: uuid('7d1e2f3a', 9001), appearAt, touchdownAt: onBlockAt - taxiIn, onBlockAt,
    scheduledOffBlockAt: onBlockAt + 60 * MINUTE_MS,
  });
}

// The demo block of a map flight at `now`: its phase from the timeline (contracts 1.1).
function demoBlock(demo, now) {
  const reached = [demo.touchdownAt, demo.onBlockAt].filter(instant => now >= instant).length;
  return {
    demoFlightId: demo.demoFlightId, state: 'Active', phase: PHASES[reached], appearAt: iso(demo.appearAt),
    touchdownAt: iso(demo.touchdownAt), onBlockAt: iso(demo.onBlockAt), scheduledOffBlockAt: iso(demo.scheduledOffBlockAt),
    offBlockAt: null, takeoffAt: null, vanishAt: null,
  };
}

// One leg of the map flights with every key of the contract; `fields` fill it.
const mapLeg = fields => ({
  flightKey: null, visitKey: null, proposalId: null, legId: null, turnaroundId: null, direction: 'Arrival',
  flightNumber: null, callsign: null, airline: AIRLINE, counterpart: MIA, scheduledAt: null, estimatedAt: null, actualAt: null,
  actualKind: null, phase: 'scheduled', providerStatus: null, aircraft: null, imported: true, turnaround: null, stand: null,
  suggestedStandCode: null, milestones: [], isDemo: false, demo: null, ...fields,
});

// The two legs of a board visit (index `index` on stand `code`) that OCC planned: «l:» keys of their own legs and the
// «t:» key of their turnaround, its aircraft, its milestones and its times.
function visitLegs(index, code, { arrivalAt, departureAt, landedAt = null, aircraft, milestones = [], status = 'InProgress',
  operationStatus = 'InProgress', arrivalPhase = landedAt === null ? 'scheduled' : 'landed' }) {
  const turnaroundId = turnaroundIdOf(index);
  const [stand, terminalCode] = STANDS.find(([item]) => item === code);
  const common = {
    visitKey: `t:${turnaroundId}`, turnaroundId, aircraft, milestones,
    turnaround: { id: turnaroundId, operationCode: `VIS-TAT-${String(index).padStart(4, '0')}`, status,
      operationId: uuid('7e2f3a4b', index), operationStatus },
    stand: { id: standIdOf(stand), code: stand, terminalCode },
  };
  const arrivalLeg = uuid('7c1d2e3f', index * 2);
  const departureLeg = uuid('7c1d2e3f', index * 2 + 1);
  return [
    mapLeg({ ...common, flightKey: `l:${arrivalLeg}`, legId: arrivalLeg, direction: 'Arrival', flightNumber: `ZZ${100 + index}`,
      callsign: `ZZZ${100 + index}`, scheduledAt: iso(arrivalAt), estimatedAt: iso(landedAt ?? arrivalAt), actualAt: iso(landedAt),
      actualKind: landedAt === null ? null : 'Runway', phase: arrivalPhase }),
    mapLeg({ ...common, flightKey: `l:${departureLeg}`, legId: departureLeg, direction: 'Departure',
      flightNumber: `ZZ${200 + index}`, callsign: `ZZZ${200 + index}`, scheduledAt: iso(departureAt), phase: 'scheduled' }),
  ];
}

// The first `count` milestones of the flight report, two minutes apart from `from`.
const recorded = (count, from) => MILESTONE_CODES.slice(0, count).map((code, at) => ({ code, actualAt: iso(from + at * 2 * MINUTE_MS) }));

/** The flight key of the arrival leg of a board visit (the live fixes name it). */
export const arrivalKeyOf = index => `l:${uuid('7c1d2e3f', index * 2)}`;

/**
 * GET occ/map/flights?stationId=: the ELEVANT flights of the station at `now`, the board's visits with their legs, and the
 * demo flight `demo` (demoClock) imported onto A3: its proposals' «p:» keys, its timeline at read time.
 */
export function mapFlights({ stationId = STATION.stationId, now = Date.now(), demo = demoClock(now) } = {}) {
  const at = delta => now + delta * MINUTE_MS;
  const flights = [
    // On their stands with their BLOCK_ON: A2, A7 (leaving in 10 minutes), B21, B31 and BN8.
    ...visitLegs(1, 'A2', { arrivalAt: at(-40), departureAt: at(45), landedAt: at(-42), aircraft: aircraftOf('A320', 1),
      milestones: recorded(9, at(-35)), arrivalPhase: 'arrived' }),
    ...visitLegs(12, 'A7', { arrivalAt: at(-50), departureAt: at(10), landedAt: at(-52), aircraft: aircraftOf('A321', 12),
      milestones: recorded(18, at(-45)), arrivalPhase: 'arrived' }),
    ...visitLegs(3, 'B21', { arrivalAt: at(-40), departureAt: at(45), landedAt: at(-42), aircraft: aircraftOf('B738', 3),
      milestones: recorded(5, at(-35)), arrivalPhase: 'arrived' }),
    ...visitLegs(4, 'B31', { arrivalAt: at(-40), departureAt: at(45), landedAt: at(-42), aircraft: aircraftOf('A20N', 4),
      milestones: recorded(12, at(-35)), arrivalPhase: 'arrived' }),
    ...visitLegs(5, 'BN8', { arrivalAt: at(-40), departureAt: at(45), landedAt: at(-42), aircraft: aircraftOf('AT76', 5),
      milestones: recorded(3, at(-35)), arrivalPhase: 'arrived' }),
    // ZZ102 landed 38 minutes ago and stands on A6, but nobody recorded its arrival: no BLOCK_ON, no on-block time.
    ...visitLegs(2, 'A6', { arrivalAt: at(-40), departureAt: at(45), landedAt: at(-38), aircraft: aircraftOf('B738', 2) }),
    // ZZ111 landed 3 minutes ago, due on B24.
    ...visitLegs(11, 'B24', { arrivalAt: at(12), departureAt: at(72), landedAt: at(-3), aircraft: aircraftOf('B38M', 11),
      status: 'Confirmed', operationStatus: 'Assigned' }),
    // Planned, with their aircraft to scale.
    ...visitLegs(6, 'A4', { arrivalAt: at(50), departureAt: at(140), aircraft: aircraftOf('A321', 6), status: 'Confirmed',
      operationStatus: 'Assigned' }),
    ...visitLegs(7, 'A9', { arrivalAt: at(50), departureAt: at(140), aircraft: aircraftOf('B38M', 7), status: 'Confirmed',
      operationStatus: 'Assigned' }),
    ...visitLegs(8, 'B25', { arrivalAt: at(50), departureAt: at(140), aircraft: aircraftOf('E190', 8), status: 'Confirmed',
      operationStatus: 'Assigned' }),
    ...visitLegs(9, 'AN2', { arrivalAt: at(50), departureAt: at(140), aircraft: aircraftOf('AT76', 9), status: 'Confirmed',
      operationStatus: 'Assigned' }),
  ];
  // The demo pair, imported onto A3: the turnaround of the board's visit, the proposals' keys (contracts 1.3).
  const block = demoBlock(demo, now);
  const landed = now >= demo.touchdownAt;
  const parked = now >= demo.onBlockAt;
  const turnaroundId = turnaroundIdOf(10);
  const proposal = number => uuid('7f3a4b5c', number);
  const demoCommon = {
    visitKey: `p:${proposal(1)}`, turnaroundId, aircraft: { registration: 'HI9001', typeIcaoCode: 'A320', model: 'A320-200',
      sizeCategory: 'Narrowbody' }, counterpart: JFK, isDemo: true, demo: block,
    turnaround: { id: turnaroundId, operationCode: 'VIS-TAT-0010', status: landed ? 'InProgress' : 'Confirmed',
      operationId: uuid('7e2f3a4b', 10), operationStatus: 'Assigned' },
    stand: { id: standIdOf('A3'), code: 'A3', terminalCode: 'A' },
  };
  flights.push(
    mapLeg({ ...demoCommon, flightKey: `p:${proposal(1)}`, proposalId: proposal(1), legId: uuid('7c1d2e3f', 9001),
      direction: 'Arrival', flightNumber: 'ZZ9001', callsign: 'ZZZ9001', scheduledAt: iso(demo.onBlockAt),
      estimatedAt: iso(demo.onBlockAt), actualAt: landed ? iso(demo.touchdownAt) : null, actualKind: landed ? 'Runway' : null,
      phase: parked ? 'arrived' : landed ? 'landed' : 'approaching', providerStatus: landed ? 'Arrived' : 'Approaching' }),
    mapLeg({ ...demoCommon, flightKey: `p:${proposal(2)}`, proposalId: proposal(2), legId: uuid('7c1d2e3f', 9002),
      direction: 'Departure', flightNumber: 'ZZ9002', callsign: 'ZZZ9002', scheduledAt: iso(demo.scheduledOffBlockAt),
      phase: 'scheduled', providerStatus: 'Expected' }),
  );
  return {
    stationId, stationCode: STATION.stationCode, serverTime: iso(now), windowFrom: minutes(now, -120), windowTo: minutes(now, 720),
    stationAirport: { iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana International', ...PUJ },
    flights,
  };
}

/** The invented ADS-B addresses of the picture. */
export const MAP_HEX = Object.freeze({ onA6: 'f0c102', holdingB24: 'f0c111', groundB28: 'f0c201', overflight: 'f0c202' });

// An aircraft of the picture: every key of the contract, on the ground and standing by default.
const fix = fields => ({
  hex: null, callsign: null, registration: null, typeIcaoCode: null, category: 'A3', latitude: null, longitude: null,
  altitudeFeet: null, onGround: true, groundSpeedKnots: 0, trackDegrees: null, verticalRateFeetPerMinute: null, squawk: null,
  positionAt: null, matchedFlightKey: null, matchedBy: null, trail: [], ...fields,
});

/**
 * GET occ/map/air-picture?stationId=&trails=: a Live picture at `now`, read 2 seconds before (its trails left empty, so
 * the answer is the same for `short` and `none`). ZZ102 stands on A6, ZZ111 holds 90 m short of B24 on its taxilane,
 * another aircraft stands on B28, and an overflight passes 30 NM to the north-east.
 */
export function airPicture({ stationId = STATION.stationId, now = Date.now() } = {}) {
  const a6 = layoutStand('A6');
  const b24 = layoutStand('B24');
  const [holdLng, holdLat] = destination(b24.center, (b24.headingTrue + 180) % 360, 90);
  const [b28Lng, b28Lat] = layoutStand('B28').center;
  const [overLng, overLat] = destination([PUJ.longitude, PUJ.latitude], 45, 30 * 1852);
  return {
    stationId, status: 'Live', reason: null, serverTime: iso(now), observedAt: iso(now - 2_000), ageSeconds: 2,
    refreshAfterSeconds: 10, source: MAP_SOURCE, center: { ...PUJ, radiusNm: 250 },
    aircraft: [
      fix({ hex: MAP_HEX.onA6, callsign: 'ZZZ102', registration: 'HI1002', typeIcaoCode: 'B738', longitude: a6.center[0],
        latitude: a6.center[1], trackDegrees: a6.headingTrue, squawk: '1000', positionAt: iso(now - 3_000),
        matchedFlightKey: arrivalKeyOf(2), matchedBy: 'Registration' }),
      fix({ hex: MAP_HEX.holdingB24, callsign: 'ZZZ111', registration: 'HI1011', typeIcaoCode: 'B38M', longitude: holdLng,
        latitude: holdLat, trackDegrees: b24.headingTrue, squawk: '1000', positionAt: iso(now - 2_000),
        matchedFlightKey: arrivalKeyOf(11), matchedBy: 'Registration' }),
      fix({ hex: MAP_HEX.groundB28, callsign: 'ZZZ415', registration: 'ZZ-TST4', typeIcaoCode: 'A20N', longitude: b28Lng,
        latitude: b28Lat, trackDegrees: 264, squawk: '1200', positionAt: iso(now - 4_000) }),
      fix({ hex: MAP_HEX.overflight, callsign: 'ZZZ804', registration: 'ZZ-TST2', typeIcaoCode: 'A20N', longitude: overLng,
        latitude: overLat, altitudeFeet: 34_000, onGround: false, groundSpeedKnots: 460, trackDegrees: 320,
        verticalRateFeetPerMinute: 0, squawk: '2000', positionAt: iso(now - 5_000) }),
    ],
  };
}

/** GET occ/map/aircraft/{hex}/track?stationId=: the server keeps no trail of these standing aircraft. */
export function aircraftTrack({ hex, now = Date.now() } = {}) {
  return { hex, serverTime: iso(now), source: MAP_SOURCE, points: [] };
}

/** The operation date of Punta Cana at `now`. */
export const operationDateAt = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(now);

/** GET occ/planning?stationId=&date=: the planning snapshot of the station, with no turnaround of its own. */
export function planningSnapshot({ stationId = STATION.stationId, date = null, now = Date.now() } = {}) {
  return {
    station: { id: stationId, code: STATION.stationCode, name: 'Punta Cana International Airport', ianaTimeZone: 'America/Santo_Domingo' },
    date: date ?? operationDateAt(now),
    turnarounds: [],
  };
}

/** GET occ/planning/assignment-readiness?stationId=&date=: nobody unfit. */
export const assignmentReadiness = ({ stationId = STATION.stationId, date }) => ({ stationId, date, assignments: [] });

const LOCATION_PATH = /^\/api\/v1\/occ\/stands\/([^/]+)\/location$/;
const TRACK_PATH = /^\/api\/v1\/occ\/map\/aircraft\/([0-9a-fA-F]{6})\/track$/;

/**
 * The API handler for support/isolate.mjs: the access, the positions board, the aerodrome weather (PR M8) and «Ubicar en
 * el mapa» (PUT occ/stands/{standId}/location, ADR-0027), which keeps the location and answers the board with it, as
 * the API does; the map reads (PR M6: air picture, map flights, track), the server ping, the planning snapshot and its
 * readiness; every other path answers the Problem Details 404 of the isolation. `reads` counts the boards served,
 * `weatherReads` the weather, `mapReads` the map reads by kind, `locates` lists the locations sent (`{ standId,
 * latitude, longitude, operationDate }`) and `located` keeps them by stand. `startedAt` is the instant the story of the
 * map reads starts from, and `demo` its demo flight's clock (demoClock).
 */
export function createOccApi({ startedAt = Date.now() } = {}) {
  const api = {
    reads: 0, weatherReads: 0, mapReads: { airPicture: 0, flights: 0, track: 0, ping: 0 }, locates: [], located: new Map(),
    startedAt, demo: demoClock(startedAt),
  };
  const board = (date, stationId = STATION.stationId) => positionsBoard({ stationId, date, located: api.located, demo: api.demo });
  api.handle = (request, url) => {
    const location = request.method() === 'PUT' ? LOCATION_PATH.exec(url.pathname) : null;
    if (location) {
      const { latitude = null, longitude = null, operationDate } = JSON.parse(request.postData() ?? '{}');
      const standId = decodeURIComponent(location[1]);
      api.locates.push({ standId, latitude, longitude, operationDate });
      if (latitude === null || longitude === null) api.located.delete(standId);
      else api.located.set(standId, { latitude, longitude });
      return { status: 200, json: board(operationDate) };
    }
    if (request.method() !== 'GET') return null;
    const now = Date.now();
    const stationId = url.searchParams.get('stationId') ?? STATION.stationId;
    if (url.pathname === '/api/v1/governance/me/access') return { status: 200, json: OCC_ACCESS };
    if (url.pathname === '/api/v1/occ/weather') {
      api.weatherReads += 1;
      return { status: 200, json: aerodromeWeather({ stationId: url.searchParams.get('stationId') ?? STATION.stationId }) };
    }
    if (url.pathname === '/api/v1/occ/positions') {
      api.reads += 1;
      return { status: 200, json: board(url.searchParams.get('date'), stationId) };
    }
    if (url.pathname === '/api/v1/occ/map/air-picture') {
      api.mapReads.airPicture += 1;
      return { status: 200, json: airPicture({ stationId, now }) };
    }
    if (url.pathname === '/api/v1/occ/map/flights') {
      api.mapReads.flights += 1;
      return { status: 200, json: mapFlights({ stationId, now, demo: api.demo }) };
    }
    const track = TRACK_PATH.exec(url.pathname);
    if (track) {
      api.mapReads.track += 1;
      return { status: 200, json: aircraftTrack({ hex: track[1].toLowerCase(), now }) };
    }
    if (url.pathname === '/api/v1/system/ping') {
      api.mapReads.ping += 1;
      return { status: 200, json: { application: 'ELEVANT', status: 'Healthy', environment: 'Visual', timestampUtc: iso(now) } };
    }
    if (url.pathname === '/api/v1/occ/planning') {
      return { status: 200, json: planningSnapshot({ stationId, date: url.searchParams.get('date'), now }) };
    }
    if (url.pathname === '/api/v1/occ/planning/assignment-readiness') {
      return { status: 200, json: assignmentReadiness({ stationId, date: url.searchParams.get('date') ?? operationDateAt(now) }) };
    }
    return null;
  };
  return api;
}
