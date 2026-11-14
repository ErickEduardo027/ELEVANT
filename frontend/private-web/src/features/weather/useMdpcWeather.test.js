import { OCC_AERODROME_WEATHER_LIMITS } from '@elevant/api-client';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulatedWeatherAdapter, weatherMessage } from '../../services/weatherService';
import { administratorAccess, DepartmentAccessProvider, useDepartmentAccess } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { MAP_PERMISSIONS } from '../maps/mapPermissions';
import { WIND_MAX_AGE_MINUTES } from '../maps/traffic/referenceFeatures';
import { staleWords } from '../maps/traffic/stationTime';
import { windReading } from '../maps/traffic/weatherLayers';
import {
  createWeatherScenario, WEATHER_NOON, WEATHER_STATION_ID, weatherInstant,
} from '../maps/testing/weatherFixtures';
import { MAP_PERMISSIONS as SITUATION_PERMISSIONS } from '../maps/useMapSituation';
import { parseMetar } from './metar';
import {
  isObservationStale, STALE_AFTER_MINUTES, useMdpcWeather, WEATHER_POLL_MS, weatherSourceState,
} from './useMdpcWeather';

// The OCC session the hook takes its station from (useOccStation reads useAuth).
const auth = vi.hoisted(() => ({ current: { session: null } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth.current }));

const NOON = Date.parse(WEATHER_NOON);
const OTHER_STATION = '5a000000-0000-4000-8000-000000000002';
const PUJ = { stationId: WEATHER_STATION_ID, stationCode: 'PUJ' };
const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
const WITHOUT_MAP = { ...ACCESS, kind: 'Member', canManageDepartmentUsers: false,
  permissions: ACCESS.permissions.filter(code => !MAP_PERMISSIONS.includes(code)) };
const OLD_KEYS = ['status', 'data', 'fetchedAt', 'refreshFailed', 'refreshing', 'refresh'];
const REFUSED = { status: 403, code: 'forbidden' };

// The department access of the test, as the OCC shell holds it: its refresh() brings a new access object.
let accessContext;
function CaptureAccess() {
  const value = useDepartmentAccess();
  useEffect(() => { accessContext = value; });
  return null;
}

let visibility = 'visible';
function setVisibility(state) {
  visibility = state;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

// Moves the fake clock and lets every answer and render that falls due settle.
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function setup(props = {}, { access = ACCESS, shell = createOccShellValue(), scenario = createWeatherScenario(),
  service } = {}) {
  const adapter = service ?? createSimulatedWeatherAdapter({ scenario });
  const loadAccess = vi.fn().mockResolvedValue(access);
  const wrapper = ({ children }) => createElement(DepartmentAccessProvider,
    { initialAccess: access, load: loadAccess, observe: false },
    createElement(OccShellTestProvider, { value: shell }, createElement(CaptureAccess), children));
  const hook = renderHook(current => useMdpcWeather(current), { wrapper, initialProps: { service: adapter, ...props } });
  return { ...hook, adapter, shell, loadAccess };
}

// A new access object, as the shell's refresh on department_users and access_requests brings.
const refreshAccess = () => act(async () => { await accessContext.refresh(); });

const weatherSource = shell => shell.sourceStore.getSnapshot().find(item => item.id === 'weather') ?? null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOON);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  auth.current = { session: { stationScopes: [PUJ] } };
});

afterEach(() => {
  cleanup();
  delete document.visibilityState;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useMdpcWeather (contracts 1.4, 2.5 and 2.7)', () => {
  it('does not read until enabled and with a station', async () => {
    const off = setup({ enabled: false });
    await flush(WEATHER_POLL_MS);
    expect(off.adapter.calls).toHaveLength(0);
    expect(off.result.current).toMatchObject({ status: 'loading', data: null, apiStatus: null });
    // Switched on, it reads at once.
    off.rerender({ enabled: true, service: off.adapter });
    await flush();
    expect(off.adapter.calls).toHaveLength(1);
    expect(off.result.current.status).toBe('success');
    // Switched off again, nothing of the old answer stays.
    off.rerender({ enabled: false, service: off.adapter });
    expect(off.result.current).toMatchObject({ status: 'loading', data: null, apiStatus: null, taf: null });
    cleanup();

    // A session without the PUJ scope has no station; an empty one passed is none either.
    auth.current = { session: { stationScopes: [{ stationId: OTHER_STATION, stationCode: 'SDQ' }] } };
    const noScope = setup();
    const empty = setup({ stationId: '' });
    await flush(WEATHER_POLL_MS);
    expect([noScope.adapter.calls, empty.adapter.calls]).toEqual([[], []]);
    expect(noScope.result.current.status).toBe('loading');
  });

  it('reads the station of the OCC session when none is passed', async () => {
    const session = setup();
    await flush();
    expect(session.adapter.calls).toEqual([{ read: 'aerodromeWeather', at: NOON, stationId: WEATHER_STATION_ID }]);
    // A host whose station is not known yet passes null: the session's again.
    const unknown = setup({ stationId: null });
    await flush();
    expect(unknown.adapter.calls.map(call => call.stationId)).toEqual([WEATHER_STATION_ID]);
    // A station passed wins, and a new one starts again.
    const passed = setup({ stationId: OTHER_STATION });
    await flush();
    expect(passed.adapter.calls.map(call => call.stationId)).toEqual([OTHER_STATION]);
    passed.rerender({ stationId: WEATHER_STATION_ID, service: passed.adapter });
    expect(passed.result.current.status).toBe('loading');
    await flush();
    expect(passed.adapter.calls.map(call => call.stationId)).toEqual([OTHER_STATION, WEATHER_STATION_ID]);
  });

  it('Live and Stale are success with data, apiStatus, taf and retrievedAt', async () => {
    const live = setup();
    await flush();
    expect(live.result.current).toMatchObject({
      status: 'success', apiStatus: 'Live', retrievedAt: '2026-11-13T14:57:00.000Z', fetchedAt: WEATHER_NOON,
      refreshFailed: false, refreshing: false, error: null,
      source: { name: 'NOAA Aviation Weather Center', url: 'https://aviationweather.gov', official: false },
    });
    expect(live.result.current.data).toMatchObject({ station: 'MDPC', observedAt: '2026-11-13T14:50:00.000Z',
      flightCategory: 'VFR', metar: { wind: { directionDeg: 100, speedKt: 13 }, qnhHpa: 1015, temperatureC: 29 } });
    expect(live.result.current.taf.periods.map(period => period.change)).toEqual([null, 'TEMPO', 'FM', 'PROB']);
    // The same answer keeps the same object: the hosts do not render again for nothing.
    const first = live.result.current;
    live.rerender({ service: live.adapter });
    expect(live.result.current).toBe(first);

    const stale = setup({}, { scenario: createWeatherScenario({ status: 'Stale' }) });
    await flush();
    expect(stale.result.current).toMatchObject({ status: 'success', apiStatus: 'Stale' });
    // Stale says «Sin actualizar desde las 08:00»: the vocabulary's words with the station's time of the METAR.
    expect(staleWords(Date.parse(stale.result.current.data.observedAt), 'es')).toBe('Sin actualizar desde las 08:00');
  });

  it('one freshness rule for the frame, the map and isObservationStale: the API state, then its live limit', async () => {
    expect(STALE_AFTER_MINUTES).toBe(OCC_AERODROME_WEATHER_LIMITS.liveMetarMinutes);
    expect(STALE_AFTER_MINUTES).toBe(WIND_MAX_AGE_MINUTES);

    // A Live METAR of 80 minutes is current everywhere; a Stale one of 40 minutes is not: the API's state wins.
    for (const [status, minutes, stale] of [['Live', 80, false], ['Stale', 40, true]]) {
      const hook = setup({}, { scenario: createWeatherScenario({ status, observedAt: weatherInstant(-minutes) }) });
      await flush();
      const weather = hook.result.current;
      expect(weather, status).toMatchObject({ status: 'success', apiStatus: status, refreshFailed: false });
      expect(isObservationStale(weather.data.observedAt, NOON, weather.apiStatus), status).toBe(stale);
      expect(windReading(weather, NOON)?.stale, status).toBe(stale);
      expect(weatherSource(hook.shell)?.state, status).toBe(stale ? 'delayed' : 'ok');

      // Kept on screen, the Live one ages past the limit as the map's wind does, to the millisecond.
      if (status === 'Live') {
        const limit = NOON + (STALE_AFTER_MINUTES - minutes) * 60_000;
        expect([isObservationStale(weather.data.observedAt, limit, 'Live'), windReading(weather, limit).stale])
          .toEqual([false, false]);
        expect([isObservationStale(weather.data.observedAt, limit + 1, 'Live'), windReading(weather, limit + 1).stale])
          .toEqual([true, true]);
      }
      cleanup();
    }
    // The age alone, as the old console panel asks: 80 minutes is current, as the API says; an unknown time is not.
    expect(isObservationStale(weatherInstant(-80), NOON)).toBe(false);
    expect(isObservationStale(weatherInstant(-91), NOON)).toBe(true);
    expect(isObservationStale(null, NOON, 'Live')).toBe(true);
  });

  it('Unavailable and Disabled are empty: no data, the credit and the state kept', async () => {
    const unavailable = setup({}, { scenario: createWeatherScenario({ status: 'Unavailable' }) });
    await flush();
    expect(unavailable.result.current).toMatchObject({ status: 'empty', data: null, apiStatus: 'Unavailable',
      retrievedAt: '2026-11-13T14:57:00.000Z', source: { name: 'NOAA Aviation Weather Center', official: false } });
    expect(unavailable.result.current.taf.raw).toMatch(/^TAF MDPC/);

    const disabled = setup({}, { scenario: createWeatherScenario({ status: 'Disabled' }) });
    await flush();
    expect(disabled.result.current).toMatchObject({ status: 'empty', data: null, apiStatus: 'Disabled', taf: null,
      retrievedAt: null, source: { name: 'NOAA Aviation Weather Center', url: 'https://aviationweather.gov' } });
    // A poll that finds the same state keeps it, without going back to loading.
    await flush(WEATHER_POLL_MS);
    expect(disabled.adapter.calls).toHaveLength(2);
    expect(disabled.result.current.status).toBe('empty');
  });

  it('a failed first read is an error; a failed refresh keeps the data and flags refreshFailed', async () => {
    const down = setup({}, { scenario: { ...createWeatherScenario(), failure: { status: 503 } } });
    await flush();
    expect(down.result.current).toMatchObject({ status: 'error', data: null, apiStatus: null });
    expect(down.result.current.error).toMatchObject({ status: 503 });
    expect(weatherMessage(down.result.current.error)).toBe('No se pudo leer el clima. Revise la conexión e intente de nuevo.');
    // Trying again shows the read, and it fails again.
    act(() => down.result.current.refresh());
    expect(down.result.current.status).toBe('loading');
    await flush();
    expect(down.result.current.status).toBe('error');
    cleanup();

    // The second read fails: the last answer stays, flagged, and the next one clears the flag.
    const flaky = setup({}, { scenario: { ...createWeatherScenario(), failure: ({ call }) => (call === 2 ? { status: 503 } : null) } });
    await flush();
    const answer = flaky.result.current.data;
    act(() => flaky.result.current.refresh());
    expect(flaky.result.current).toMatchObject({ status: 'success', refreshing: true });
    await flush();
    expect(flaky.result.current).toMatchObject({ status: 'success', refreshing: false, refreshFailed: true, apiStatus: 'Live' });
    expect(flaky.result.current.data).toBe(answer);
    expect(flaky.result.current.error).toMatchObject({ status: 503 });
    act(() => flaky.result.current.refresh());
    await flush();
    expect(flaky.result.current).toMatchObject({ status: 'success', refreshFailed: false, error: null });
  });

  it('a 403 is unauthorized and stops polling until access changes or refresh()', async () => {
    // The server refuses the first two reads, then lets the account read.
    const refused = setup({}, {
      scenario: { ...createWeatherScenario(), failure: ({ call }) => (call <= 2 ? REFUSED : null) },
    });
    await flush();
    expect(refused.result.current).toMatchObject({ status: 'unauthorized', data: null });
    expect(weatherMessage(refused.result.current.error)).toBe('No tiene permiso para ver el clima del aeródromo.');
    // Neither the poll nor the browser back online asks a refused reader.
    await flush(WEATHER_POLL_MS * 3);
    act(() => { window.dispatchEvent(new Event('online')); });
    await flush();
    expect(refused.adapter.calls).toHaveLength(1);

    // A person's refresh() tries again at once, showing the read; the server refuses it again.
    act(() => refused.result.current.refresh());
    expect(refused.result.current).toMatchObject({ status: 'loading', error: null });
    await flush();
    expect(refused.adapter.calls).toHaveLength(2);
    expect(refused.result.current.status).toBe('unauthorized');
    await flush(WEATHER_POLL_MS * 2);
    expect(refused.adapter.calls).toHaveLength(2);

    // A new access object, as the shell brings when a permission is granted again, reads once more (contracts 2.7):
    // the server lets it read, and the poll starts again.
    await refreshAccess();
    await flush();
    expect(refused.adapter.calls).toHaveLength(3);
    expect(refused.result.current).toMatchObject({ status: 'success', apiStatus: 'Live', error: null });
    await flush(WEATHER_POLL_MS);
    expect(refused.adapter.calls).toHaveLength(4);
    // A new access object leaves a reader that is not refused at its own pace.
    await refreshAccess();
    await flush();
    expect(refused.adapter.calls).toHaveLength(4);
    expect(refused.result.current.status).toBe('success');
    cleanup();

    // Another station is a new scope: it reads again.
    const station = setup({}, { scenario: { ...createWeatherScenario(), failure: REFUSED } });
    await flush();
    station.rerender({ stationId: OTHER_STATION, service: station.adapter });
    await flush();
    expect(station.adapter.calls.map(call => call.stationId)).toEqual([WEATHER_STATION_ID, OTHER_STATION]);
    cleanup();

    // Access that loses every map permission says unauthorized at once and reads nothing; getting one back reads.
    const regained = setup();
    await flush();
    regained.loadAccess.mockResolvedValueOnce(WITHOUT_MAP);
    await refreshAccess();
    expect(regained.result.current).toMatchObject({ status: 'unauthorized', data: null, apiStatus: null });
    await flush(WEATHER_POLL_MS * 2);
    expect(regained.adapter.calls).toHaveLength(1);
    regained.loadAccess.mockResolvedValueOnce(ACCESS);
    await refreshAccess();
    await flush();
    expect(regained.adapter.calls).toHaveLength(2);
    expect(regained.result.current.status).toBe('success');
    cleanup();

    // An account without a map permission never asks; the hook says unauthorized at once.
    const withoutMap = setup({}, { access: WITHOUT_MAP });
    await flush(WEATHER_POLL_MS);
    expect(withoutMap.adapter.calls).toHaveLength(0);
    expect(withoutMap.result.current).toMatchObject({ status: 'unauthorized', data: null });
    // The weather hook gates on the map's permissions: one list (contracts 1.3).
    expect(MAP_PERMISSIONS).toBe(SITUATION_PERMISSIONS);
  });

  it('polls every 10 minutes only while visible, and on online', async () => {
    const { adapter, shell } = setup();
    await flush();
    expect(WEATHER_POLL_MS).toBe(10 * 60_000);
    await flush(WEATHER_POLL_MS);
    expect(adapter.calls.map(call => call.at - NOON)).toEqual([0, WEATHER_POLL_MS]);

    // Hidden, the poll reads nothing; back, it reads at its next tick.
    setVisibility('hidden');
    await flush(WEATHER_POLL_MS * 2);
    expect(adapter.calls).toHaveLength(2);
    setVisibility('visible');
    await flush(WEATHER_POLL_MS);
    expect(adapter.calls).toHaveLength(3);

    // The browser back online reads at once; an occ_planning announcement never does (contracts 2.7).
    act(() => { window.dispatchEvent(new Event('online')); });
    await flush();
    expect(adapter.calls).toHaveLength(4);
    act(() => shell.announce(['occ_planning']));
    await flush(60_000);
    expect(adapter.calls).toHaveLength(4);
    expect(shell.subscriptions()).toEqual([]);
  });

  it('keeps the old keys of its answer and adds apiStatus, taf and retrievedAt', async () => {
    const { result } = setup();
    await flush();
    expect(Object.keys(result.current).sort())
      .toEqual([...OLD_KEYS, 'apiStatus', 'taf', 'retrievedAt', 'source', 'error'].sort());
    expect(typeof result.current.refresh).toBe('function');
    // The observation keeps the keys of the panels that read it, and the METAR the keys of parseMetar.
    expect(Object.keys(result.current.data).sort())
      .toEqual(['decoded', 'derived', 'flightCategory', 'metar', 'observedAt', 'source', 'station']);
    expect(Object.keys(result.current.data.metar)).toEqual(Object.keys(parseMetar('')));
    expect(result.current.data.derived).toEqual({ relativeHumidity: null, feelsLikeC: null, precipitationLastHourIn: null });
    expect(result.current.data.source).toEqual({ name: 'NOAA Aviation Weather Center', url: 'https://aviationweather.gov',
      homeUrl: 'https://aviationweather.gov', official: false });
    expect(Date.parse(result.current.fetchedAt)).toBe(NOON);
  });

  it('tells the OCC frame the state of the weather and takes it back when it unmounts', async () => {
    const live = setup();
    expect(weatherSource(live.shell)).toMatchObject({ state: 'idle', tags: [] });
    await flush();
    expect(weatherSource(live.shell)).toEqual({ id: 'weather', state: 'ok', at: NOON - 600_000, detail: null,
      tags: ['unofficial'] });
    live.unmount();
    expect(weatherSource(live.shell)).toBeNull();

    for (const [status, state] of [['Stale', 'delayed'], ['Unavailable', 'offline'], ['Disabled', 'unconfigured']]) {
      const hook = setup({}, { scenario: createWeatherScenario({ status }) });
      await flush();
      expect(weatherSource(hook.shell)?.state, status).toBe(state);
      // «No oficial» goes with what the weather shows: a METAR or a TAF.
      expect(weatherSource(hook.shell)?.tags, status).toEqual(status === 'Disabled' ? [] : ['unofficial']);
    }
    const refused = setup({}, { scenario: { ...createWeatherScenario(), failure: { status: 403, code: 'forbidden' } } });
    await flush();
    expect(weatherSource(refused.shell)?.state).toBe('forbidden');

    // The same rule, alone: a Live answer whose refresh failed is late; a first read that failed is offline.
    expect(weatherSourceState({ status: 'success', apiStatus: 'Live', refreshFailed: true })).toBe('delayed');
    expect(weatherSourceState({ status: 'error' })).toBe('offline');
    expect(weatherSourceState({ status: 'loading' })).toBe('idle');
    expect(weatherSourceState()).toBe('idle');
  });
});
