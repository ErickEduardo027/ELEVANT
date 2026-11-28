import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { OCC_READ_TIMEOUT_MS } from '../features/admin-occ/live/occCadence';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { createServerClock, parseInstant, serverClock } from './serverClock';

// The regional weather of an OCC station (lane M7, owner decisions of 2026-11-26 and 2026-11-27): the METARs and TAFs
// of the region's airports, the SIGMETs in force, a grid of wind and the index of radar frames. The API reads them from
// their providers (lane M6: GET occ/weather/region, occ/weather/sigmets, occ/weather/wind and occ/weather/radar; the
// radar is San Juan's NEXRAD through the Iowa Environmental Mesonet, `provider` iem-tjua) and answers each with its
// state in a 200 (Live, Stale, Unavailable or Disabled) and its credit; the browser never calls a weather provider
// itself (ADR-0004). Two adapters with one interface, `{ getRegionWeather, getSigmets, getWindGrid, getRadarFrames }`,
// each `({ stationId, signal }) => answer`:
// - the remote one, over the shared client's getOccRegionWeather, getOccSigmets, getOccWindGrid and getOccRadarFrames
//   (which check every answer against the contract and refuse a malformed one);
// - a simulated one for the map lab and the tests, which answers a synthetic scenario and never touches the network
//   (its data live with the tests and the lab: features/maps/testing/weatherFixtures.js).
// The host passes the adapter; a component never chooses the source.

const defaultClient = () => createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });

/** The reads of the regional weather: the adapter's method and the shared client's operation for each. */
export const REGION_WEATHER_OPERATIONS = Object.freeze({
  region: Object.freeze({ method: 'getRegionWeather', read: 'getOccRegionWeather' }),
  sigmets: Object.freeze({ method: 'getSigmets', read: 'getOccSigmets' }),
  wind: Object.freeze({ method: 'getWindGrid', read: 'getOccWindGrid' }),
  radar: Object.freeze({ method: 'getRadarFrames', read: 'getOccRadarFrames' }),
});
const OPERATIONS = Object.entries(REGION_WEATHER_OPERATIONS);

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/**
 * The regional reads over the API. Each takes the instants it was sent and answered and feeds `clock` with the answer's
 * `serverTime`; like every OCC read it is abandoned after OCC_READ_TIMEOUT_MS and fails with a `TimeoutError`; the
 * caller's `signal` cancels it before. A 401 signs out through handleUnauthorizedResponse; every failure is thrown again
 * as it came, with its `status` and `code`.
 */
export function createRemoteRegionWeatherAdapter({ client = defaultClient, clock = serverClock,
  timeoutMs = OCC_READ_TIMEOUT_MS } = {}) {
  const api = typeof client === 'function' ? client : () => client;
  const reader = read => async ({ stationId, signal } = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const options = { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: 'no-store' };
    const sentAt = clock.localNow();
    const data = await guarded(() => api()[read]({ stationId }, options));
    clock.observe(data?.serverTime, sentAt, clock.localNow());
    return data;
  };
  return Object.freeze({
    clock,
    ...Object.fromEntries(OPERATIONS.map(([, { method, read }]) => [method, reader(read)])),
  });
}

/** The regional weather of Panorama: the API's, through the shared client. */
export function defaultRegionWeatherAdapter() {
  return createRemoteRegionWeatherAdapter();
}

// Every field of the regional answers that holds an instant.
const INSTANT_FIELDS = new Set(['serverTime', 'observedAt', 'issuedAt', 'validFrom', 'validTo', 'validAt', 'time']);

function shiftInstants(value, deltaMs) {
  if (Array.isArray(value)) return value.map(item => shiftInstants(item, deltaMs));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const ms = INSTANT_FIELDS.has(key) ? parseInstant(item) : null;
    return [key, ms === null ? shiftInstants(item, deltaMs) : new Date(ms + deltaMs).toISOString()];
  }));
}

function abortError(signal) {
  return signal?.reason ?? new DOMException('The simulated read was cancelled.', 'AbortError');
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(abortError(signal)); return; }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  function onAbort() {
    clearTimeout(timer);
    reject(abortError(signal));
  }
  signal?.addEventListener('abort', onAbort, { once: true });
});

// The title a server would write; the screens never show it.
const SIMULATED_TITLE = 'The simulated regional weather read was refused.';
const refused = ({ status = 503, code } = {}) => Object.assign(new Error(SIMULATED_TITLE),
  { status, code, title: SIMULATED_TITLE });
const notFound = () => Object.assign(new Error('not_found'), { status: 404, code: 'not_found' });

/**
 * The regional reads answered from a synthetic scenario, for the map lab and the tests; never the network. The scenario
 * is `{ at, region, sigmets, wind, radar, failure }`: each answer is a whole answer of its read written around the
 * instant `at` (by default the region's `serverTime`), moved so that `at` falls on `now()` when `shift` is true; or a
 * function `({ nowMs, stationId, call }) => answer`. A read without an answer fails 404 `not_found`. `failure`
 * (`{ status, code }`, or a function `({ read, nowMs, stationId, call }) => failure | null`, `read` the key of
 * REGION_WEATHER_OPERATIONS and `call` counting that read's calls from 1) makes the read throw that failure with a
 * server title the screens never show. Every answer carries the station asked for and feeds `clock` with its
 * `serverTime`. `latencyMs` delays each answer on the page's timers; `calls` records every read
 * (`{ read, at, stationId }`).
 */
export function createSimulatedRegionWeatherAdapter({ scenario = {}, now = () => Date.now(), clock = createServerClock(),
  latencyMs = 0, shift = false } = {}) {
  const calls = [];
  const anchor = parseInstant(scenario.at ?? (typeof scenario.region === 'function' ? null : scenario.region?.serverTime)
    ?? null);
  const counts = {};

  function answer(part, input) {
    if (part == null) return null;
    if (typeof part === 'function') return part(input);
    return !shift || anchor === null ? JSON.parse(JSON.stringify(part)) : shiftInstants(part, input.nowMs - anchor);
  }

  const reader = read => async ({ stationId, signal } = {}) => {
    calls.push({ read, at: now(), stationId });
    counts[read] = (counts[read] ?? 0) + 1;
    const call = counts[read];
    const sentAt = clock.localNow();
    if (latencyMs > 0) await wait(latencyMs, signal);
    if (signal?.aborted) throw abortError(signal);
    const nowMs = now();
    const failure = typeof scenario.failure === 'function'
      ? scenario.failure({ read, nowMs, stationId, call })
      : scenario.failure;
    if (failure) throw refused(failure);
    const data = answer(scenario[read], { nowMs, stationId, call });
    if (data === null) throw notFound();
    const stamped = { ...data, stationId };
    clock.observe(stamped.serverTime, sentAt, clock.localNow());
    return stamped;
  };

  return Object.freeze({
    clock,
    calls,
    simulated: true,
    ...Object.fromEntries(OPERATIONS.map(([read, { method }]) => [method, reader(read)])),
  });
}
