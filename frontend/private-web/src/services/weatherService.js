import { isOccAerodromeWeather } from '@elevant/api-client';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { OCC_READ_TIMEOUT_MS } from '../features/admin-occ/live/occCadence';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';
import { parseMetar } from '../features/weather/metar';
import { toTafModel } from '../features/weather/taf';
import { problemMessage } from './problemMessages';
import { createServerClock, parseInstant, serverClock } from './serverClock';

// The aerodrome weather of an OCC station (ADR-0043, contracts 1.4): the METAR and the TAF of the station's airport,
// which the API reads from the NOAA Aviation Weather Center (aviationweather.gov) and answers with its state in a 200
// (Live, Stale, Unavailable or Disabled) and the credit of the service. The browser never calls the weather service
// itself. Two adapters with one interface: the remote one over the API client, and a simulated one for the map lab and
// the tests that answers a synthetic scenario and never touches the network. The host passes the adapter; a component
// never chooses the source. The scenario data lives with the tests and the lab (features/maps/testing), never here.
//
// Until the console of PR U3 replaces it, the old dashboard's weather panel still reads its six-hour METAR history from
// Iowa Environmental Mesonet with loadRecentMetars (a public, unofficial mirror without a key or an SLA). Nothing else
// reads Mesonet, and its origin stays in the CSP until a separate change retires it.

const defaultClient = () => createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });

/** Spanish explanation of the weather read's Problem Details codes. The server title is never shown. */
export const WEATHER_MESSAGES = Object.freeze({
  invalid_weather_query: 'No se pudo leer el clima con esos datos. Actualice la página.',
  not_found: 'Esta estación no tiene clima del aeródromo.',
});

/** The message of a failed weather read, from its code; never the server title. */
export function weatherMessage(error) {
  return problemMessage(error, WEATHER_MESSAGES, {
    forbidden: 'No tiene permiso para ver el clima del aeródromo.',
    fallback: 'No se pudo leer el clima. Revise la conexión e intente de nuevo.',
  });
}

/**
 * The credit of the weather as the screens read it: the service's name and home page (`url` and `homeUrl` are the
 * same link; `url` is the field the weather readers already use). `official: false` keeps the tag «No oficial» wherever
 * the weather shows (contracts 2.4): ELEVANT relays the service, it is not an official weather briefing.
 */
export function toWeatherSource(source) {
  const name = typeof source?.name === 'string' ? source.name : '';
  const homeUrl = typeof source?.homeUrl === 'string' ? source.homeUrl : null;
  return Object.freeze({ name, url: homeUrl, homeUrl, official: false });
}

const METRES_PER_STATUTE_MILE = 1609.344;
// The cloud covers features/weather/metar.js reads, so a layer filled from the API speaks the same words.
const METAR_COVERS = new Set(['FEW', 'SCT', 'BKN', 'OVC', 'VV', 'NSC', 'NCD', 'SKC', 'CLR']);
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const numberOrNull = value => (isNumber(value) ? value : null);

/**
 * The METAR decoded from its raw text (`parsed`, features/weather/metar.js: parseMetar) with what it could not read
 * filled in from the API's decoded basics (`decoded`, the answer's `metar`): the wind, the visibility, the temperature,
 * the dew point, the QNH and the clouds. What the raw text says always wins; nothing is filled from a value the API does
 * not have. A new object with the same keys as parseMetar's.
 */
export function mergeDecodedMetar(parsed, decoded) {
  const base = parsed ?? parseMetar('');
  if (!decoded || typeof decoded !== 'object') return { ...base };
  const wind = base.wind ?? (isNumber(decoded.windSpeedKnots) ? {
    directionDeg: decoded.windVariable ? null : numberOrNull(decoded.windDirectionDegrees),
    variable: decoded.windVariable === true,
    speedKt: decoded.windSpeedKnots,
    gustKt: numberOrNull(decoded.windGustKnots),
    variableFrom: null,
    variableTo: null,
  } : null);
  const visibility = base.visibility ?? (isNumber(decoded.visibilityStatuteMiles)
    ? { meters: Math.round(decoded.visibilityStatuteMiles * METRES_PER_STATUTE_MILE), orMore: false }
    : null);
  const layers = Array.isArray(decoded.clouds) ? decoded.clouds.filter(layer => METAR_COVERS.has(layer?.cover)) : [];
  const clouds = base.clouds.length > 0 || base.cavok ? base.clouds
    : layers.map(layer => ({ cover: layer.cover, baseFt: numberOrNull(layer.baseFeet), convective: null }));
  const qnh = numberOrNull(decoded.altimeterHectopascals);
  return {
    ...base,
    wind,
    visibility,
    clouds,
    temperatureC: base.temperatureC ?? numberOrNull(decoded.temperatureCelsius),
    dewPointC: base.dewPointC ?? numberOrNull(decoded.dewpointCelsius),
    qnhHpa: base.qnhHpa ?? (qnh === null ? null : Math.round(qnh)),
  };
}

// The relayed answer carries no derived values (Mesonet computed them); the readers keep the keys and show nothing.
const NO_DERIVED = Object.freeze({ relativeHumidity: null, feelsLikeC: null, precipitationLastHourIn: null });

/** An instant the API wrote, as the canonical ISO text every reader parses (`2026-11-13T14:50:00.000Z`), or null. */
function isoOf(value) {
  const ms = parseInstant(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * An answer of GET occ/weather as the screens read it, frozen: `{ apiStatus, serverTime, retrievedAt, receivedAt,
 * source, observation, taf }`.
 * - `apiStatus`: `Live`, `Stale`, `Unavailable` or `Disabled`, the state the server resolved (data, never an error).
 * - `serverTime` in milliseconds; `retrievedAt`, the last time the service answered, and `receivedAt`, when this
 *   browser got the answer (`receivedAt` option, in milliseconds), as ISO texts or null.
 * - `source`: toWeatherSource of the credit, which every answer carries.
 * - `observation`: null without a METAR (Unavailable, Disabled); otherwise `{ station, observedAt, metar, derived,
 *   source, flightCategory, decoded }`, the reading the weather panels already know: `metar` is parseMetar of the raw
 *   text filled by mergeDecodedMetar, `derived` has no values, and `decoded` is the API's METAR as it came.
 * - `taf`: features/weather/taf.js toTafModel of the TAF, or null.
 */
export function toWeatherReading(response, { receivedAt = null } = {}) {
  const source = toWeatherSource(response?.source);
  const metar = response?.metar ?? null;
  const observedAt = isoOf(metar?.observedAt);
  const observation = metar && observedAt ? Object.freeze({
    station: response.icaoCode,
    observedAt,
    metar: mergeDecodedMetar(parseMetar(metar.raw), metar),
    derived: NO_DERIVED,
    source,
    flightCategory: metar.flightCategory ?? null,
    decoded: metar,
  }) : null;
  return Object.freeze({
    apiStatus: response?.status ?? null,
    serverTime: parseInstant(response?.serverTime),
    retrievedAt: isoOf(response?.retrievedAt),
    receivedAt: isNumber(receivedAt) ? new Date(receivedAt).toISOString() : null,
    source,
    observation,
    taf: toTafModel(response?.taf ?? null),
  });
}

async function guarded(request) {
  try { return await request(); } catch (error) {
    if (error?.status === 401) handleUnauthorizedResponse({ status: 401 });
    throw error;
  }
}

/**
 * The weather read over the API. It takes the instants it was sent and answered and feeds `clock` with the answer's
 * `serverTime`. Like every OCC read it is abandoned after OCC_READ_TIMEOUT_MS (20 s) and fails with a `TimeoutError`,
 * never left loading; the caller's `signal` cancels it before. A 401 signs out through handleUnauthorizedResponse;
 * every failure is thrown again as it came, with its `status` and `code`. `client` is the API client or a function
 * that creates it (by default, the private web's, created on each read).
 */
export function createRemoteWeatherAdapter({ client = defaultClient, clock = serverClock,
  timeoutMs = OCC_READ_TIMEOUT_MS } = {}) {
  const api = typeof client === 'function' ? client : () => client;
  return Object.freeze({
    clock,
    /** The METAR and the TAF of the station's airport, with their state: the API's answer, validated by the client. */
    async getAerodromeWeather({ stationId, signal } = {}) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const options = { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: 'no-store' };
      const sentAt = clock.localNow();
      const data = await guarded(() => api().getOccAerodromeWeather({ stationId }, options));
      clock.observe(data?.serverTime, sentAt, clock.localNow());
      return data;
    },
  });
}

/** The weather read of the private web. */
export const weatherService = createRemoteWeatherAdapter();

// Every field of the weather read that holds an instant.
const INSTANT_FIELDS = new Set(['serverTime', 'retrievedAt', 'observedAt', 'issuedAt', 'validFrom', 'validTo', 'from',
  'to']);

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

// The title a server would write; the screens never show it, and the tests check that they do not.
const SIMULATED_TITLE = 'The simulated weather read was refused.';
const notFound = () => Object.assign(new Error('not_found'), { status: 404, code: 'not_found' });
const malformed = () => Object.assign(new Error('The simulated aerodrome weather does not pass its validator.'),
  { status: 200, code: 'malformed_simulation' });
const refused = ({ status = 503, code } = {}) => Object.assign(new Error(SIMULATED_TITLE),
  { status, code, title: SIMULATED_TITLE });

/**
 * The weather read answered from a synthetic scenario, for the map lab and the tests; never the network. The scenario
 * is `{ at, weather, failure }`: `weather` is a whole answer of GET occ/weather written around the instant `at` (by
 * default its `serverTime`), moved so that `at` falls on `now()`, the simulated server's time; or a function
 * `({ nowMs, stationId }) => answer` written at `nowMs`. The answer carries the station asked for, goes through the
 * api-client's validator as the remote one does (a scenario it rejects throws `malformed_simulation`), and feeds `clock`
 * with its `serverTime` (a clock of its own unless one is passed). `failure` (`{ status, code }`, or a function
 * `({ nowMs, stationId, call }) => failure | null` where `call` counts the reads from 1) makes the read throw that
 * failure with a server title the screens never show; a scenario without weather answers 404 `not_found`.
 * `latencyMs` delays each answer on the page's timers. `calls` records every read, `{ read: 'aerodromeWeather', at,
 * stationId }`.
 */
export function createSimulatedWeatherAdapter({ scenario = {}, now = () => Date.now(), clock = createServerClock(),
  latencyMs = 0 } = {}) {
  const calls = [];
  const written = typeof scenario.weather === 'function' ? null : scenario.weather;
  const anchor = parseInstant(scenario.at ?? written?.serverTime ?? null);

  function answer(input) {
    const part = scenario.weather;
    if (part == null) return null;
    if (typeof part === 'function') return part(input);
    return anchor === null ? JSON.parse(JSON.stringify(part)) : shiftInstants(part, input.nowMs - anchor);
  }

  return Object.freeze({
    clock,
    calls,
    async getAerodromeWeather({ stationId, signal } = {}) {
      calls.push({ read: 'aerodromeWeather', at: now(), stationId });
      const call = calls.length;
      const sentAt = clock.localNow();
      if (latencyMs > 0) await wait(latencyMs, signal);
      if (signal?.aborted) throw abortError(signal);
      const nowMs = now();
      const failure = typeof scenario.failure === 'function'
        ? scenario.failure({ nowMs, stationId, call })
        : scenario.failure;
      if (failure) throw refused(failure);
      const weather = answer({ nowMs, stationId });
      if (weather === null) throw notFound();
      const data = { ...weather, stationId };
      if (!isOccAerodromeWeather(data, stationId)) throw malformed();
      clock.observe(data.serverTime, sentAt, clock.localNow());
      return data;
    },
  });
}

// --- The old dashboard's METAR history (Iowa Environmental Mesonet), until PR U3 retires that panel. ---

export const WEATHER_STATION = 'MDPC';

const IEM_ORIGIN = 'https://mesonet.agron.iastate.edu';
const REQUEST_TIMEOUT_MS = 15_000;

export class WeatherUnavailableError extends Error {
  constructor(reason) {
    super(`weather-${reason}`);
    this.name = 'WeatherUnavailableError';
    this.reason = reason;
  }
}

async function fetchFromIem(path, { signal } = {}) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(`${IEM_ORIGIN}${path}`, { signal: combined, credentials: 'omit', cache: 'no-store' });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WeatherUnavailableError(timeout.aborted ? 'timeout' : 'network');
  }
  if (!response.ok) throw new WeatherUnavailableError('http');
  return response;
}

/** The METARs of the last `hours` from Mesonet, newest first: the history of the old dashboard's weather panel. */
export async function loadRecentMetars({ hours = 3, signal } = {}) {
  const query = new URLSearchParams({ station: WEATHER_STATION, data: 'metar', hours: String(hours),
    format: 'onlycomma', tz: 'UTC' });
  const response = await fetchFromIem(`/cgi-bin/request/asos.py?${query}`, { signal });
  const lines = (await response.text()).trim().split(/\r?\n/);
  if (lines[0] !== 'station,valid,metar') throw new WeatherUnavailableError('format');
  return lines.slice(1).map(line => {
    const [station, valid, ...rest] = line.split(',');
    const raw = rest.join(',');
    return { station, observedAt: `${valid.replace(' ', 'T')}:00Z`, metar: parseMetar(raw) };
  }).filter(item => item.station === WEATHER_STATION && !Number.isNaN(Date.parse(item.observedAt)))
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
}
