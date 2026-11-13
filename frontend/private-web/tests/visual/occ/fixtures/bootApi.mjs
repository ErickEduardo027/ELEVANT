import { STATION, createOccApi } from './occApi.mjs';

// Synthetic answers for the OCC boot screen's spec (boot-screen.spec.mjs). On top of the API of occApi.mjs (the
// department access of the OCC session and the positions board) it answers the department access after a pause, and
// the three reads of Panorama (src/services/dashboardService.js: the review queue, the notices and the planning
// snapshot) empty but valid after another, so the console the boot screen gives way to is the real one and not its
// no-permission state. The answers pass the strict validators of @elevant/api-client
// (tests/visualBootFixtures.test.js checks them). Every id and name is invented.

export const ACCESS_PATH = '/api/v1/governance/me/access';
export const REVIEW_QUEUE_PATH = '/api/v1/occ/review/queue';
export const NOTICES_PATH = '/api/v1/notifications';
export const PLANNING_PATH = '/api/v1/occ/planning';

/** The station's time zone: Panorama takes its operation date from it. */
export const STATION_TIME_ZONE = 'America/Santo_Domingo';
const STATION_NAME = 'Aeropuerto de prueba de Punta Cana';

/** GET occ/review/queue?stationId=: nothing waiting for review. */
export function reviewQueue(stationId = STATION.stationId) {
  return {
    stationId,
    stationCode: STATION.stationCode,
    stationName: STATION_NAME,
    ianaTimeZone: STATION_TIME_ZONE,
    operations: [],
    hasMore: false,
  };
}

/** GET notifications: no notices. */
export function notices() {
  return { notifications: [], hasMore: false };
}

/** GET occ/planning?stationId=&date=: the station's day with no turnarounds. */
export function planningSnapshot({ stationId = STATION.stationId, date }) {
  return {
    station: { id: stationId, code: STATION.stationCode, name: STATION_NAME, ianaTimeZone: STATION_TIME_ZONE },
    date,
    turnarounds: [],
  };
}

// Panorama's reads, by path.
function consoleAnswer(url) {
  const stationId = url.searchParams.get('stationId') ?? undefined;
  if (url.pathname === REVIEW_QUEUE_PATH) return { status: 200, json: reviewQueue(stationId) };
  if (url.pathname === NOTICES_PATH) return { status: 200, json: notices() };
  if (url.pathname === PLANNING_PATH) {
    return { status: 200, json: planningSnapshot({ stationId, date: url.searchParams.get('date') }) };
  }
  return null;
}

const pause = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/**
 * The API handler for isolation.setApi (support/isolate.mjs accepts an async one): the department access answers
 * after `accessDelayMs`, and each read of Panorama after `consoleDelayMs` (Panorama reads the queue and the notices
 * together, then the planning, so its first data take twice that). Everything else is occApi.mjs's. `accesses` and
 * `consoleReads` count what was served.
 */
export function createBootApi({ accessDelayMs = 0, consoleDelayMs = 0 } = {}) {
  const base = createOccApi();
  const api = { accesses: 0, consoleReads: 0 };
  api.handle = async (request, url) => {
    if (request.method() !== 'GET') return base.handle(request, url);
    if (url.pathname === ACCESS_PATH) {
      await pause(accessDelayMs);
      api.accesses += 1;
      return base.handle(request, url);
    }
    const answer = consoleAnswer(url);
    if (!answer) return base.handle(request, url);
    await pause(consoleDelayMs);
    api.consoleReads += 1;
    return answer;
  };
  return api;
}

// Today's Panorama (until PR U3 replaces it) also draws two maps on the dark basemap style of OpenFreeMap, the GOES
// clouds of NASA GIBS and the METAR of Iowa Environmental Mesonet, origins that support/isolate.mjs does not answer.
// They are answered here without leaving the machine: an empty style (the two maps draw no basemap), no cloud tiles
// and no weather, so Panorama shows its states without those sources.
const EMPTY_STYLE = Object.freeze({ version: 8, name: 'Estilo vacío de la prueba visual', sources: {}, layers: [] });
const LEGACY_ORIGINS = Object.freeze([
  { url: 'https://tiles.openfreemap.org/styles/**', answer: { status: 200, json: EMPTY_STYLE } },
  { url: 'https://gibs.earthdata.nasa.gov/**', answer: { status: 404 } },
  { url: 'https://mesonet.agron.iastate.edu/**', answer: { status: 503 } },
]);

/**
 * Routes the legacy Panorama's three foreign origins on `page`. Registered after the isolation, these routes answer
 * first. Returns the list of what they answered (`METHOD url`).
 */
export async function answerLegacyConsoleOrigins(page) {
  const answered = [];
  for (const { url, answer } of LEGACY_ORIGINS) {
    await page.route(url, route => {
      const request = route.request();
      answered.push(`${request.method()} ${request.url()}`);
      return route.fulfill({
        status: answer.status,
        headers: {
          'access-control-allow-origin': request.headers().origin ?? '*',
          'cache-control': 'no-store',
        },
        contentType: answer.json ? 'application/json' : 'text/plain',
        body: answer.json ? JSON.stringify(answer.json) : '',
      });
    });
  }
  return answered;
}
