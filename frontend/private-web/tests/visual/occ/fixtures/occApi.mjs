// Synthetic answers of the ELEVANT API for the OCC screens of the visual suite: an OCC account of Punta Cana, its
// department access, a positions board and the aerodrome weather (PR M8) that pass the strict validators of
// @elevant/api-client (tests/visualOccFixtures.test.js checks them). Every id, flight, registration and report is
// invented.

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

const uuid = (group, index) => `${group}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const minutes = (base, delta) => new Date(base + delta * 60 * 1000).toISOString();

// A visit of the board: its arrival `arrivalInMin` minutes from `now` (recorded 5 minutes later when `arrived`) and
// its departure `departureInMin` minutes from it.
function turnaround(index, now, { arrived, arrivalInMin = arrived ? -40 : 50, departureInMin = arrived ? 45 : 140 }) {
  return {
    turnaroundId: uuid('7a1b2c3d', index),
    operationCode: `VIS-TAT-${String(index).padStart(4, '0')}`,
    airlineName: 'Aerolínea de prueba',
    aircraftRegistration: `HI${1000 + index}`,
    arrivalFlightNumber: `ZZ${100 + index}`,
    departureFlightNumber: `ZZ${200 + index}`,
    arrivalScheduledAt: minutes(now, arrivalInMin),
    arrivedAt: arrived ? minutes(now, arrivalInMin + 5) : null,
    departureScheduledAt: minutes(now, departureInMin),
    assignedFrom: minutes(now, -120),
    status: arrived ? 'InProgress' : 'Planned',
  };
}

/**
 * GET occ/positions?stationId=&date=: the board of the station for that operation date, as of `now`. `located` maps a
 * stand id to the location OCC saved for it (`{ latitude, longitude }`, «Ubicar en el mapa»); every other stand has
 * none.
 */
export function positionsBoard({ stationId = STATION.stationId, date, now = Date.now(), located = new Map() } = {}) {
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
      else if (ARRIVING.has(code)) {
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
const iso = ms => new Date(ms).toISOString();

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

const LOCATION_PATH = /^\/api\/v1\/occ\/stands\/([^/]+)\/location$/;

/**
 * The API handler for support/isolate.mjs: the access, the positions board, the aerodrome weather (PR M8) and «Ubicar en
 * el mapa» (PUT occ/stands/{standId}/location, ADR-0027), which keeps the location and answers the board with it, as
 * the API does; every other path answers the Problem Details 404 of the isolation. `reads` counts the boards served,
 * `weatherReads` the weather, `locates` lists the locations sent (`{ standId, latitude, longitude, operationDate }`)
 * and `located` keeps them by stand.
 */
export function createOccApi() {
  const api = { reads: 0, weatherReads: 0, locates: [], located: new Map() };
  api.handle = (request, url) => {
    const location = request.method() === 'PUT' ? LOCATION_PATH.exec(url.pathname) : null;
    if (location) {
      const { latitude = null, longitude = null, operationDate } = JSON.parse(request.postData() ?? '{}');
      const standId = decodeURIComponent(location[1]);
      api.locates.push({ standId, latitude, longitude, operationDate });
      if (latitude === null || longitude === null) api.located.delete(standId);
      else api.located.set(standId, { latitude, longitude });
      return { status: 200, json: positionsBoard({ date: operationDate, located: api.located }) };
    }
    if (request.method() !== 'GET') return null;
    if (url.pathname === '/api/v1/governance/me/access') return { status: 200, json: OCC_ACCESS };
    if (url.pathname === '/api/v1/occ/weather') {
      api.weatherReads += 1;
      return { status: 200, json: aerodromeWeather({ stationId: url.searchParams.get('stationId') ?? STATION.stationId }) };
    }
    if (url.pathname === '/api/v1/occ/positions') {
      api.reads += 1;
      return {
        status: 200,
        json: positionsBoard({
          stationId: url.searchParams.get('stationId'), date: url.searchParams.get('date'), located: api.located,
        }),
      };
    }
    return null;
  };
  return api;
}
