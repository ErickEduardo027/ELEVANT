import { normalizedRegistration } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

// The AeroDataBox reference reads of the private web (ADR-0028 and ADR-0043, notes of 15 November 2026), always through
// the API: an aircraft by its registration, the daily routes and the current delays of an airport, and an airline's
// fleet. The API keeps each answer (a day, 24 hours, an hour, seven days) and caps what each read may spend; this
// adapter adds a short memory in the tab so that selecting the same flight again, or two components showing the same
// subject, send one request. Two adapters with one interface: the remote one over the API client and a simulated one for
// the map lab and the tests, which never touches the network. The page or the lab passes the adapter
// (features/aviation-reference/AviationReferenceContext.jsx); a component never chooses the source.

const defaultClient = () => createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });

/** How long the tab reuses an answer before asking the API again. */
export const AVIATION_REFERENCE_TAB_MEMORY_MS = Object.freeze({
  aircraft: 60 * 60_000,
  routes: 60 * 60_000,
  delays: 15 * 60_000,
  fleet: 60 * 60_000,
});

/** A demo flight's synthetic registration («HIDM01» to «HIDM99»): never asked of the API (ADR-0041). */
export function isDemoRegistration(registration) {
  const compact = normalizedRegistration(registration);
  return compact !== null && /^HIDM(?!00)\d{2}$/.test(compact);
}

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/**
 * A memory of answers by key for `ttlMs`, with one request in flight per key. A failed request is not kept; a request
 * whose caller went away (its signal aborted) still settles the memory for the next caller.
 */
function createMemory(now) {
  const entries = new Map();
  return function remember(key, ttlMs, load) {
    const entry = entries.get(key);
    if (entry && (entry.pending || now() - entry.at < ttlMs)) return entry.promise;
    const promise = load().then(value => {
      entries.set(key, { at: now(), promise: Promise.resolve(value), pending: false });
      return value;
    }, error => {
      entries.delete(key);
      throw error;
    });
    entries.set(key, { at: now(), promise, pending: true });
    if (entries.size > 500) entries.delete(entries.keys().next().value);
    return promise;
  };
}

/** The signal of one caller over a shared request: it rejects for that caller alone. */
function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/**
 * The reference reads over the API. A 401 signs out through handleUnauthorizedResponse; every failure is thrown again
 * as it came, with its `status` and `code`. A demo registration answers `NotApplicable` without a request.
 */
export function createRemoteAviationReferenceService({ client = defaultClient, now = () => Date.now() } = {}) {
  const api = typeof client === 'function' ? client : () => client;
  const remember = createMemory(now);
  const read = (key, ttlMs, call, signal) =>
    withSignal(remember(key, ttlMs, () => guarded(() => call(api(), { cache: 'no-store' }))), signal);
  return Object.freeze({
    kind: 'remote',
    getAircraft({ stationId, registration, signal } = {}) {
      const tail = normalizedRegistration(registration);
      if (tail !== null && isDemoRegistration(tail)) {
        return Promise.resolve({ stationId, registration: tail, status: 'NotApplicable', serverTime: new Date(now()).toISOString(),
          retrievedAt: null, source: 'AeroDataBox', aircraft: null });
      }
      return read(`aircraft|${stationId}|${tail}`, AVIATION_REFERENCE_TAB_MEMORY_MS.aircraft,
        (api, options) => api.getOccAircraftReference({ stationId, registration: tail ?? String(registration ?? '') }, options),
        signal);
    },
    getRoutes: ({ stationId, signal } = {}) => read(`routes|${stationId}`, AVIATION_REFERENCE_TAB_MEMORY_MS.routes,
      (api, options) => api.getOccAirportRoutes({ stationId }, options), signal),
    getDelays: ({ stationId, airport = null, signal } = {}) =>
      read(`delays|${stationId}|${airport ?? ''}`, AVIATION_REFERENCE_TAB_MEMORY_MS.delays,
        (api, options) => api.getOccAirportDelays({ stationId, ...(airport ? { airport } : {}) }, options), signal),
    getAirlineFleet: ({ airlineCode, signal } = {}) =>
      read(`fleet|${String(airlineCode ?? '').trim().toUpperCase()}`, AVIATION_REFERENCE_TAB_MEMORY_MS.fleet,
        (api, options) => api.getAirlineFleet({ airlineCode }, options), signal),
  });
}

export const aviationReferenceService = createRemoteAviationReferenceService();

/**
 * A simulated adapter for the map lab and the tests: it answers `answers` (functions of the query, or values) after
 * `latencyMs`, records every call in `calls` and never touches the network. Absent answers are `Disabled`.
 */
export function createSimulatedAviationReferenceService({ answers = {}, latencyMs = 0, now = () => Date.now() } = {}) {
  const calls = [];
  const answer = (name, query, fallback) => {
    calls.push({ read: name, ...query, at: now() });
    const value = typeof answers[name] === 'function' ? answers[name](query) : answers[name];
    const result = value ?? fallback;
    if (result instanceof Error) return new Promise((_, reject) => { setTimeout(() => reject(result), latencyMs); });
    return withSignal(new Promise(resolve => { setTimeout(() => resolve(result), latencyMs); }), query.signal);
  };
  const disabled = extra => ({ status: 'Disabled', serverTime: new Date(now()).toISOString(), retrievedAt: null,
    source: 'AeroDataBox', ...extra });
  return Object.freeze({
    kind: 'simulated',
    calls,
    getAircraft(query = {}) {
      const tail = normalizedRegistration(query.registration);
      if (tail !== null && isDemoRegistration(tail)) {
        return Promise.resolve(disabled({ stationId: query.stationId, registration: tail, status: 'NotApplicable', aircraft: null }));
      }
      return answer('aircraft', query, disabled({ stationId: query.stationId, registration: tail, aircraft: null }));
    },
    getRoutes: (query = {}) => answer('routes', query, disabled({ stationId: query.stationId, airportIcao: 'MDPC', routes: [] })),
    getDelays: (query = {}) => answer('delays', query,
      disabled({ stationId: query.stationId, airport: query.airport ?? 'MDPC', delays: null })),
    getAirlineFleet: (query = {}) => answer('fleet', query,
      disabled({ airlineCode: query.airlineCode, totalAircraft: null, sampledAircraft: 0, types: [] })),
  });
}
