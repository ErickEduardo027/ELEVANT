// Synthetic answers of the ELEVANT API for the OCC screens of the visual suite: an OCC account of Punta Cana, its
// department access and a positions board that passes the strict validators of @elevant/api-client
// (tests/visualOccFixtures.test.js checks them). Every id, flight and registration is invented.

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
// Synthetic visits: on the stand, due on it, and a free stand cancelled by its combined neighbour.
const OCCUPIED = new Map([['A2', 1], ['A6', 2], ['B21', 3], ['B31', 4], ['BN8', 5]]);
const PLANNED = new Map([['A4', 6], ['A9', 7], ['B25', 8], ['AN2', 9]]);
const CANCELLED_BY = new Map([['A10', 'A9']]);

const uuid = (group, index) => `${group}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const minutes = (base, delta) => new Date(base + delta * 60 * 1000).toISOString();

function turnaround(index, now, { arrived }) {
  return {
    turnaroundId: uuid('7a1b2c3d', index),
    operationCode: `VIS-TAT-${String(index).padStart(4, '0')}`,
    airlineName: 'Aerolínea de prueba',
    aircraftRegistration: `HI${1000 + index}`,
    arrivalFlightNumber: `ZZ${100 + index}`,
    departureFlightNumber: `ZZ${200 + index}`,
    arrivalScheduledAt: minutes(now, arrived ? -40 : 50),
    arrivedAt: arrived ? minutes(now, -35) : null,
    departureScheduledAt: minutes(now, arrived ? 45 : 140),
    assignedFrom: minutes(now, -120),
    status: arrived ? 'InProgress' : 'Planned',
  };
}

/** GET occ/positions?stationId=&date=: the board of the station for that operation date, as of `now`. */
export function positionsBoard({ stationId = STATION.stationId, date, now = Date.now() } = {}) {
  return {
    stationId,
    stationCode: STATION.stationCode,
    operationDate: date,
    asOf: new Date(now).toISOString(),
    positions: STANDS.map(([code, terminalCode, standType], index) => {
      const visit = OCCUPIED.has(code) ? turnaround(OCCUPIED.get(code), now, { arrived: true })
        : PLANNED.has(code) ? turnaround(PLANNED.get(code), now, { arrived: false }) : null;
      return {
        standId: uuid('5e4d3c2b', index + 1),
        code,
        terminalCode,
        standType,
        status: OCCUPIED.has(code) ? 'occupied' : PLANNED.has(code) ? 'planned' : 'available',
        turnarounds: visit ? [visit] : [],
        latitude: null,
        longitude: null,
        hasBoardingBridge: false,
        isRemote: standType === 'Remote',
        maxAircraftSize: null,
        cancelledBy: CANCELLED_BY.get(code) ?? null,
        narrowbodyOnly: false,
        coveredBy: visit ? ['Agente de prueba'] : [],
      };
    }),
    unassigned: [],
    canAssign: true,
  };
}

/**
 * The API handler for support/isolate.mjs: the access and the positions board; every other path answers the
 * Problem Details 404 of the isolation. `reads` counts the boards served.
 */
export function createOccApi() {
  const api = { reads: 0 };
  api.handle = (request, url) => {
    if (request.method() !== 'GET') return null;
    if (url.pathname === '/api/v1/governance/me/access') return { status: 200, json: OCC_ACCESS };
    if (url.pathname === '/api/v1/occ/positions') {
      api.reads += 1;
      return {
        status: 200,
        json: positionsBoard({ stationId: url.searchParams.get('stationId'), date: url.searchParams.get('date') }),
      };
    }
    return null;
  };
  return api;
}
