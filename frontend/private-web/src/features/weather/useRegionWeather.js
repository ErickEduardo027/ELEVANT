'use client';

import { useCallback, useMemo, useRef } from 'react';
import { isAbortError } from '../../lib/abort';
import { useDepartmentAccess } from '../access/DepartmentAccessContext';
import { OCC_COALESCE_MS } from '../admin-occ/live/occCadence';
import { useOccResource } from '../admin-occ/live/useOccResource';
import { MAP_PERMISSIONS } from '../maps/mapPermissions';

// The regional weather of the OCC's station (lane M7), read through the API with the injected adapter
// (services/regionWeatherService.js): the METARs and TAFs of the region's airports, the SIGMETs, the wind grid and the
// radar frames. Each read is one useOccResource on the shell's loop (contracts 2.7): gated by the map permissions,
// paused while the tab is hidden, dropped and not asked again after a 401/403/404, and on its own poll, never on an
// announcement. A failed read waits twice as long for each failure, up to REGION_WEATHER_MAX_DELAY_MS. The host passes
// the adapter; this hook never chooses the source.

/** The longest a failing regional read waits before it asks again: half an hour. */
export const REGION_WEATHER_MAX_DELAY_MS = 1_800_000;

const read = fields => Object.freeze({ ...fields, resources: Object.freeze([]), coalesceMs: OCC_COALESCE_MS });

/**
 * The four regional reads and their pace, one table for this hook and the request budget (admin-occ/live/
 * occRequestPlan.js, checked by occRequestBudget.test.js): the stations' METARs and TAFs, the SIGMETs and the wind grid
 * every ten minutes (the API keeps them 5 min, 10 min and 1 h), the radar index every five (a new frame every 5–10 min).
 * `method` is the adapter's, `read` the shared client's operation.
 */
export const REGION_WEATHER_READS = Object.freeze({
  region: read({ key: 'occWeather.region', method: 'getRegionWeather', read: 'getOccRegionWeather', pollMs: 600_000 }),
  sigmets: read({ key: 'occWeather.sigmets', method: 'getSigmets', read: 'getOccSigmets', pollMs: 600_000 }),
  wind: read({ key: 'occWeather.wind', method: 'getWindGrid', read: 'getOccWindGrid', pollMs: 600_000 }),
  radar: read({ key: 'occWeather.radar', method: 'getRadarFrames', read: 'getOccRadarFrames', pollMs: 300_000 }),
});
const KEYS = Object.keys(REGION_WEATHER_READS);

/** The pace of a regional read: its planned poll, twice as long for each failed read since its last answer, capped. */
export function regionWeatherDelayMs(entry, failures = 0) {
  const base = entry.pollMs;
  if (!(failures > 0)) return base;
  return Math.max(base, Math.min(base * 2 ** failures, REGION_WEATHER_MAX_DELAY_MS));
}

const WITH_DATA = new Set(['Live', 'Stale']);
const answeredEmpty = data => !WITH_DATA.has(data?.status);

/**
 * The state a regional read shows (what maps/traffic/weatherLayers.js reads): `loading` (also while nothing is read),
 * `success`, `empty` (an Unavailable or Disabled answer, kept in `data`), `error` (a failed first read or a timeout) or
 * `unauthorized` (the account may not read it, or the session ended).
 */
export function regionReadStatus(status) {
  if (status === 'success' || status === 'empty') return status;
  if (status === 'forbidden' || status === 'unauthorized') return 'unauthorized';
  if (status === 'error' || status === 'timeout') return 'error';
  return 'loading';
}

function useRegionRead(name, { adapter, stationId, enabled, permission }) {
  const entry = REGION_WEATHER_READS[name];
  const failures = useRef(0);
  const load = useCallback(async ({ signal }) => {
    try {
      const data = await adapter[entry.method]({ stationId, signal });
      failures.current = 0;
      return data;
    } catch (error) {
      if (!isAbortError(error)) failures.current += 1;
      throw error;
    }
  }, [adapter, entry.method, stationId]);
  const pollMs = useCallback(() => regionWeatherDelayMs(entry, failures.current), [entry]);
  const resource = useOccResource({ key: entry.key, load, permission, scopeKey: enabled ? stationId : '', enabled,
    resources: entry.resources, pollMs, coalesceMs: entry.coalesceMs, isEmpty: answeredEmpty });
  const { status, data, fetchedAt, refreshFailed, retry } = resource;
  return useMemo(() => Object.freeze({ status: regionReadStatus(status), data, fetchedAt, refreshFailed, retry }),
    [data, fetchedAt, refreshFailed, retry, status]);
}

/**
 * The regional weather of `stationId`.
 * - `adapter`: `{ getRegionWeather, getSigmets, getWindGrid, getRadarFrames }` (services/regionWeatherService.js).
 * - `enabled: false`, or no station, reads nothing; `wanted` (`{ region, sigmets, wind, radar }` booleans, all by
 *   default) leaves out the reads nobody draws.
 * Returns `{ region, sigmets, wind, radar, demo }`: each read `{ status, data, fetchedAt, refreshFailed, retry }`
 * (regionReadStatus; `data` the API's answer, kept after a failed refresh with `refreshFailed`), and `demo` when the
 * adapter is a simulated one (its answers are tagged «Demo» on the map).
 */
export function useRegionWeather({ adapter, stationId, enabled = true, wanted = null, demo = false } = {}) {
  const { access } = useDepartmentAccess();
  const granted = MAP_PERMISSIONS.find(code => access?.can(code)) ?? MAP_PERMISSIONS[0];
  const station = typeof stationId === 'string' ? stationId : '';
  const reading = Boolean(enabled) && station !== '' && adapter != null;
  const on = key => reading && (wanted === null || wanted?.[key] !== false);
  const shared = { adapter, stationId: station, permission: granted };
  const region = useRegionRead('region', { ...shared, enabled: on('region') });
  const sigmets = useRegionRead('sigmets', { ...shared, enabled: on('sigmets') });
  const wind = useRegionRead('wind', { ...shared, enabled: on('wind') });
  const radar = useRegionRead('radar', { ...shared, enabled: on('radar') });
  const isDemo = demo === true;
  return useMemo(() => Object.freeze({ region, sigmets, wind, radar, demo: isDemo }),
    [isDemo, radar, region, sigmets, wind]);
}

export { KEYS as REGION_WEATHER_KEYS };
