import { isOccAircraftTrack, isOccAirPicture, isOccMapFlights } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { problemMessage } from './problemMessages';
import { createServerClock, parseInstant, serverClock } from './serverClock';

// The OCC map's reads (ADR-0042, contracts 1.3): the air picture, the map flights, one aircraft's track and the ping
// that sets the server clock. Two adapters with one interface: the remote one over the API client, and a simulated one
// for the map lab and the tests that answers a synthetic scenario and never touches the network. The page or the lab
// passes the adapter; a component never chooses the source. The scenario data lives with the tests and the lab
// (features/maps/testing, features/maps/lab), never in this module, so no synthetic data reaches the production bundle.

const defaultClient = () => createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });

/** Spanish explanation of the map's Problem Details codes. The server title is never shown. */
export const OCC_MAP_MESSAGES = Object.freeze({
  invalid_map_query: 'No se pudo leer el mapa con esos datos. Actualice la página.',
});

/** The message of a failed map read, from its code; never the server title. */
export function occMapMessage(error) {
  return problemMessage(error, OCC_MAP_MESSAGES, {
    forbidden: 'No tiene permiso para ver el mapa del OCC.',
    fallback: 'No se pudo leer el mapa. Revise la conexión e intente de nuevo.',
  });
}

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/**
 * The map reads over the API. Each read takes the instants it was sent and answered and feeds `clock` with the
 * answer's `serverTime`; `ping` only answers, and syncServerClock feeds the clock with it. A 401 signs out through
 * handleUnauthorizedResponse; every failure is thrown again as it came, with its `status` and `code`. `client` is the
 * API client or a function that creates it (by default, the private web's, created on each read).
 */
export function createRemoteOccMapAdapter({ client = defaultClient, clock = serverClock } = {}) {
  const api = typeof client === 'function' ? client : () => client;
  async function timed(read, signal) {
    const sentAt = clock.localNow();
    const data = await guarded(() => read(api(), { signal, cache: 'no-store' }));
    clock.observe(data?.serverTime, sentAt, clock.localNow());
    return data;
  }
  return Object.freeze({
    clock,
    /** The air picture of the station, with up to eight trail points per aircraft (`short`) or none (`none`). */
    getAirPicture: ({ stationId, trails = 'short', signal } = {}) =>
      timed((api, options) => api.getOccAirPicture({ stationId, trails }, options), signal),
    /** The map flights of the station in the server's default window (2 hours back, 12 ahead). */
    getMapFlights: ({ stationId, signal } = {}) =>
      timed((api, options) => api.getOccMapFlights({ stationId }, options), signal),
    /** One aircraft's trail from the server's memory (its last segment, at most 600 points). */
    getAircraftTrack: ({ stationId, hex, signal } = {}) =>
      timed((api, options) => api.getOccAircraftTrack({ stationId, hex }, options), signal),
    /** The server's ping, `{ timestampUtc, … }`, for syncServerClock. */
    ping: ({ signal } = {}) => guarded(() => api().getSystemPing({ signal, cache: 'no-store' })),
  });
}

/** The map reads of the private web. */
export const occMapService = createRemoteOccMapAdapter();

// Every field of the three map reads that holds an instant.
const INSTANT_FIELDS = new Set(['serverTime', 'observedAt', 'positionAt', 'at', 'windowFrom', 'windowTo', 'scheduledAt',
  'estimatedAt', 'actualAt', 'appearAt', 'touchdownAt', 'onBlockAt', 'scheduledOffBlockAt', 'offBlockAt', 'takeoffAt',
  'vanishAt']);

/** A copy of `value` with every instant moved by `deltaMs`, written as the API writes UTC instants. */
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

const notFound = () => Object.assign(new Error('not_found'), { status: 404, code: 'not_found' });
const malformed = read => Object.assign(new Error(`The simulated ${read} does not pass its validator.`),
  { status: 200, code: 'malformed_simulation' });

/**
 * The map reads answered from a synthetic scenario, for the map lab and the tests; never the network. The scenario is
 * `{ at, picture, flights, tracks: { [hex]: track } }`: whole API answers written around the instant `at` (by default
 * the picture's `serverTime`), each moved so that `at` falls on `now()`, the simulated server's time. Each part may
 * instead be a function `({ nowMs, stationId, trails, hex }) => answer` written at `nowMs`. Each map read's answer
 * carries the station asked for, goes through the api-client's validator as the remote one does, and feeds `clock` with
 * its `serverTime` (a clock of its own unless one is passed); the ping only answers, at `now()`. `trails: 'none'` drops
 * the trail points; a part the scenario lacks answers 404 `not_found`. `latencyMs` delays each answer on the page's
 * timers. `calls` records every read, `{ read, at, stationId, trails?, hex? }`, for the request budget.
 */
export function createSimulatedOccMapAdapter({ scenario = {}, now = () => Date.now(), clock = createServerClock(),
  latencyMs = 0 } = {}) {
  const calls = [];
  const anchor = parseInstant(scenario.at ?? scenario.picture?.serverTime ?? scenario.flights?.serverTime ?? null);

  function answer(part, input) {
    if (part == null) return null;
    if (typeof part === 'function') return part(input);
    return anchor === null ? JSON.parse(JSON.stringify(part)) : shiftInstants(part, input.nowMs - anchor);
  }

  // Like the remote reads, the map reads feed the clock with their `serverTime`; the ping only answers.
  async function simulate(read, input, signal, build) {
    calls.push({ read, at: now(), ...input });
    const sentAt = clock.localNow();
    if (latencyMs > 0) await wait(latencyMs, signal);
    if (signal?.aborted) throw abortError(signal);
    const data = build(now());
    if (read !== 'ping') clock.observe(data?.serverTime, sentAt, clock.localNow());
    return data;
  }

  return Object.freeze({
    clock,
    calls,
    getAirPicture: ({ stationId, trails = 'short', signal } = {}) => simulate('airPicture', { stationId, trails }, signal,
      nowMs => {
        const picture = answer(scenario.picture, { nowMs, stationId, trails });
        if (picture === null) throw notFound();
        const data = { ...picture, stationId,
          aircraft: (picture.aircraft ?? []).map(item => (trails === 'none' ? { ...item, trail: [] } : item)) };
        if (!isOccAirPicture(data, stationId, trails)) throw malformed('air picture');
        return data;
      }),
    getMapFlights: ({ stationId, signal } = {}) => simulate('mapFlights', { stationId }, signal, nowMs => {
      const flights = answer(scenario.flights, { nowMs, stationId });
      if (flights === null) throw notFound();
      const data = { ...flights, stationId };
      if (!isOccMapFlights(data, stationId)) throw malformed('map flights');
      return data;
    }),
    getAircraftTrack: ({ stationId, hex, signal } = {}) => {
      const address = String(hex ?? '').toLowerCase();
      return simulate('aircraftTrack', { stationId, hex: address }, signal, nowMs => {
        const track = answer(scenario.tracks?.[address], { nowMs, stationId, hex: address });
        if (track === null) throw notFound();
        if (!isOccAircraftTrack(track, address)) throw malformed('aircraft track');
        return track;
      });
    },
    ping: ({ signal } = {}) => simulate('ping', {}, signal, nowMs => ({
      application: 'ELEVANT', status: 'Healthy', environment: 'Simulated', timestampUtc: new Date(nowMs).toISOString(),
    })),
  });
}
