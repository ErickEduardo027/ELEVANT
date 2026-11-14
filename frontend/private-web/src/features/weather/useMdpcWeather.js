import { useCallback, useEffect, useMemo, useState } from 'react';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import { toWeatherReading, weatherService } from '../../services/weatherService';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { useOptionalOccShellChannel } from '../admin-occ/shell/occShellContext';
import { useOccStation } from '../admin-occ/useOccStation';
import { MAP_PERMISSIONS } from '../maps/mapPermissions';

// The aerodrome weather of the OCC's station, read through the API (services/weatherService.js, ADR-0043): the METAR,
// the TAF and their state. Its own poll, every ten minutes while the tab shows, and once more when the browser is back
// online; never on an occ_planning announcement (contracts 2.7). The host passes the adapter for the lab and the tests;
// this hook never chooses the source.

/** The weather's own poll (contracts 2.7): ten minutes. */
export const WEATHER_POLL_MS = 600_000;

// El METAR rutinario de MDPC es horario: pasados 75 minutos falta al menos un reporte. Es un
// criterio de frescura del dato, no un umbral meteorológico ni operacional.
export const STALE_AFTER_MINUTES = 75;

export function observationAgeMinutes(observedAt, now = Date.now()) {
  const time = Date.parse(observedAt ?? '');
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now - time) / 60_000));
}

export function isObservationStale(observedAt, now = Date.now()) {
  const age = observationAgeMinutes(observedAt, now);
  return age == null || age > STALE_AFTER_MINUTES;
}

const INITIAL = Object.freeze({
  status: 'loading', data: null, fetchedAt: null, refreshFailed: false, refreshing: false,
  apiStatus: null, taf: null, retrievedAt: null, source: null, error: null,
});
// The server refused the reader, or the session ended: nothing to read until the scope changes.
const REFUSED = new Set([401, 403]);
const ANSWERED = new Set(['success', 'empty']);
const SOURCE_STATES = Object.freeze({ Live: 'ok', Stale: 'delayed', Unavailable: 'offline', Disabled: 'unconfigured' });

/**
 * The weather's state in the OCC frame's source list (admin-occ/live/sourceHealth.js), from what useMdpcWeather
 * returns: Live is `ok` (`delayed` after a failed refresh), Stale `delayed`, Unavailable `offline`, Disabled
 * `unconfigured`; a failed first read `offline`, a refused reader `forbidden`, and `idle` until the first answer.
 */
export function weatherSourceState({ status, apiStatus, refreshFailed } = {}) {
  if (status === 'unauthorized') return 'forbidden';
  if (status === 'error') return 'offline';
  if (!ANSWERED.has(status)) return 'idle';
  const state = SOURCE_STATES[apiStatus] ?? 'idle';
  return state === 'ok' && refreshFailed ? 'delayed' : state;
}

function answered(previous, reading) {
  return {
    scope: previous.scope,
    status: reading.observation ? 'success' : 'empty',
    data: reading.observation,
    fetchedAt: reading.receivedAt,
    refreshFailed: false,
    refreshing: false,
    apiStatus: reading.apiStatus,
    taf: reading.taf,
    retrievedAt: reading.retrievedAt,
    source: reading.source,
    error: null,
  };
}

// A refused reader starts again; an answer seen before stays, flagged; a first read that fails is an error.
function failed(previous, error) {
  if (REFUSED.has(error?.status)) return { ...INITIAL, scope: previous.scope, status: 'unauthorized', error };
  if (previous.fetchedAt !== null) return { ...previous, refreshing: false, refreshFailed: true, error };
  return { ...INITIAL, scope: previous.scope, status: 'error', error };
}

/**
 * The aerodrome weather of the OCC station.
 *
 * - `enabled: false` reads nothing; neither does a missing station.
 * - `stationId`: the station whose airport's weather it reads; without one (undefined or null), the OCC session's
 *   station (useOccStation, as Monitoreo and the console take it), so the host needs the AuthProvider. An empty one
 *   is no station.
 * - `service`: `{ getAerodromeWeather }` (services/weatherService.js: weatherService, or the simulated adapter).
 *
 * Reads when the account may read a map (any of MAP_PERMISSIONS, once the department access is loaded; the server
 * decides when it is not); a 401 or 403 stops it until the station or `enabled` change. The state of the weather
 * service (Live, Stale, Unavailable, Disabled) is data, never an error, and goes to the OCC frame's source list as
 * `weather`, tagged «No oficial».
 *
 * Returns `{ status, data, fetchedAt, refreshFailed, refreshing, refresh, apiStatus, taf, retrievedAt, source, error }`:
 * - `status`: `loading` (also while nothing is read), `success` (Live or Stale: `data` holds the METAR), `empty`
 *   (Unavailable or Disabled: no `data`, the state and the credit still there), `error` (the first read failed) or
 *   `unauthorized`.
 * - `data`: `{ station, observedAt, metar, derived, source, flightCategory, decoded }` (services/weatherService.js:
 *   toWeatherReading), or null. A failed refresh keeps the last answer and sets `refreshFailed`; nothing is made up.
 * - `fetchedAt`: when this browser got the last answer (ISO); `refreshing` while a refresh with an answer runs.
 * - `apiStatus`, `taf` (features/weather/taf.js: toTafModel, or null), `retrievedAt` (the last time the weather
 *   service answered the API, ISO or null) and `source` (the credit, `{ name, url, homeUrl, official: false }`) of the
 *   last answer; `error`, the last failure (services/weatherService.js: weatherMessage explains it).
 */
export function useMdpcWeather({ enabled = true, stationId, service = weatherService } = {}) {
  const occStation = useOccStation();
  const wanted = stationId ?? occStation.stationId;
  const station = typeof wanted === 'string' ? wanted : '';
  const reading = Boolean(enabled) && station !== '';
  const scope = reading ? station : '';
  const access = useOptionalDepartmentAccess();
  const withoutMap = access !== null && !MAP_PERMISSIONS.some(code => access.can(code));

  const [state, setState] = useState(() => ({ ...INITIAL, scope }));
  const [revision, setRevision] = useState(0);
  // A new station, or reading switched on or off, starts again: nothing of another scope stays on screen.
  if (state.scope !== scope) setState({ ...INITIAL, scope });
  const view = reading && withoutMap ? INITIAL : state;
  const status = reading && withoutMap ? 'unauthorized' : view.status;
  const active = reading && !withoutMap && state.scope === scope && state.status !== 'unauthorized';

  const refresh = useCallback(() => {
    setState(previous => {
      if (previous.status === 'unauthorized') return previous;
      return ANSWERED.has(previous.status) ? { ...previous, refreshing: true } : { ...previous, status: 'loading' };
    });
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    service.getAerodromeWeather({ stationId: station, signal: controller.signal })
      .then(response => {
        if (controller.signal.aborted) return;
        const next = toWeatherReading(response, { receivedAt: Date.now() });
        setState(previous => (previous.scope === station ? answered(previous, next) : previous));
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState(previous => (previous.scope === station ? failed(previous, error) : previous));
      });
    return () => abortForEffectCleanup(controller);
  }, [active, revision, service, station]);

  useEffect(() => {
    if (!active) return undefined;
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, WEATHER_POLL_MS);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('online', refresh);
    };
  }, [active, refresh]);

  // The weather in the OCC frame's source list, with the time of its METAR and the tag «No oficial».
  const channel = useOptionalOccShellChannel();
  const sourceState = weatherSourceState({ status, apiStatus: view.apiStatus, refreshFailed: view.refreshFailed });
  const sourceAt = sourceState === 'ok' || sourceState === 'delayed' ? (view.data?.observedAt ?? null) : null;
  const unofficial = view.data !== null || view.taf !== null;
  useEffect(() => {
    if (!channel || !reading) return;
    channel.sources.report('weather', { state: sourceState, at: sourceAt, tags: unofficial ? ['unofficial'] : [] });
  }, [channel, reading, sourceAt, sourceState, unofficial]);
  useEffect(() => (channel && reading ? () => channel.sources.remove('weather') : undefined), [channel, reading]);

  const { data, fetchedAt, refreshFailed, refreshing, apiStatus, taf, retrievedAt, source, error } = view;
  return useMemo(() => ({
    status, data, fetchedAt, refreshFailed, refreshing, refresh, apiStatus, taf, retrievedAt, source, error,
  }), [apiStatus, data, error, fetchedAt, refresh, refreshFailed, refreshing, retrievedAt, source, status, taf]);
}
