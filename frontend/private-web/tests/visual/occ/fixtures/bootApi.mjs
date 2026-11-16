import { CONSOLE_PATHS, createConsoleApi } from './consoleApi.mjs';

// Synthetic answers for the OCC boot screen's spec (boot-screen.spec.mjs). On top of the console's API
// (consoleApi.mjs: the department access, the console's day and its map) it answers the department access after a
// pause, and each read of the console after another, so the console the boot screen gives way to is the real one with
// its data, and its first data (the map flights, ConsoleRoute.jsx) arrive when the spec wants them. The answers pass
// the strict validators of @elevant/api-client (tests/visualConsoleFixtures.test.js and
// tests/visualBootFixtures.test.js check them). Every id and name is invented.

export const ACCESS_PATH = CONSOLE_PATHS.access;

/** The console's reads the boot screen waits behind, each held for `consoleDelayMs`. */
export const CONSOLE_READ_PATHS = Object.freeze([
  CONSOLE_PATHS.mapFlights, CONSOLE_PATHS.airPicture, CONSOLE_PATHS.planning, CONSOLE_PATHS.readiness,
  CONSOLE_PATHS.positions, CONSOLE_PATHS.reviewQueue, CONSOLE_PATHS.notices,
]);

const pause = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/**
 * The API handler for isolation.setApi (support/isolate.mjs accepts an async one): the department access answers
 * after `accessDelayMs`, and each read of the console after `consoleDelayMs` (they run side by side, so the console's
 * first data take that long after the access). Everything else is consoleApi.mjs's. `accesses` and `consoleReads` count
 * what was served.
 */
export function createBootApi({ accessDelayMs = 0, consoleDelayMs = 0 } = {}) {
  const base = createConsoleApi();
  const api = { accesses: 0, consoleReads: 0 };
  api.handle = async (request, url) => {
    if (request.method() !== 'GET') return base.handle(request, url);
    if (url.pathname === ACCESS_PATH) {
      await pause(accessDelayMs);
      api.accesses += 1;
      return base.handle(request, url);
    }
    if (!CONSOLE_READ_PATHS.includes(url.pathname)) return base.handle(request, url);
    await pause(consoleDelayMs);
    api.consoleReads += 1;
    return base.handle(request, url);
  };
  return api;
}

// The console's weather pill reads today's METAR of Iowa Environmental Mesonet, an origin support/isolate.mjs does not
// answer. It is answered here without leaving the machine, as unavailable, so the pill shows its state without it.
const CONSOLE_ORIGINS = Object.freeze([
  { url: 'https://mesonet.agron.iastate.edu/**', answer: { status: 503 } },
]);

/**
 * Routes the console's foreign origins on `page`. Registered after the isolation, these routes answer first. Returns
 * the list of what they answered (`METHOD url`).
 */
export async function answerConsoleOrigins(page) {
  const answered = [];
  for (const { url, answer } of CONSOLE_ORIGINS) {
    await page.route(url, route => {
      const request = route.request();
      answered.push(`${request.method()} ${request.url()}`);
      return route.fulfill({
        status: answer.status,
        headers: {
          'access-control-allow-origin': request.headers().origin ?? '*',
          'cache-control': 'no-store',
        },
        contentType: 'text/plain',
        body: '',
      });
    });
  }
  return answered;
}
