import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDisabledRegionWeatherAdapter, createRemoteRegionWeatherAdapter, createSimulatedRegionWeatherAdapter,
  offersRegionWeather, REGION_WEATHER_OPERATIONS,
} from '../../services/regionWeatherService';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { MAP_PERMISSIONS } from '../maps/mapPermissions';
import {
  createRegionWeatherScenario, WEATHER_NOON, WEATHER_STATION_ID,
} from '../maps/testing/weatherFixtures';
import {
  REGION_WEATHER_MAX_DELAY_MS, REGION_WEATHER_READS, regionReadStatus, regionWeatherDelayMs, useRegionWeather,
} from './useRegionWeather';

const NOON = Date.parse(WEATHER_NOON);
const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
const WITHOUT_MAP = { ...ACCESS, kind: 'Member', canManageDepartmentUsers: false,
  permissions: ACCESS.permissions.filter(code => !MAP_PERMISSIONS.includes(code)) };

let visibility = 'visible';
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const readsOf = adapter => adapter.calls.map(call => call.read).sort();

function setup(props = {}, { access = ACCESS, scenario = createRegionWeatherScenario(), adapter } = {}) {
  const used = adapter ?? createSimulatedRegionWeatherAdapter({ scenario });
  const shell = createOccShellValue();
  const wrapper = ({ children }) => (
    <DepartmentAccessProvider initialAccess={access} load={vi.fn().mockResolvedValue(access)} observe={false}>
      <OccShellTestProvider value={shell}>{children}</OccShellTestProvider>
    </DepartmentAccessProvider>
  );
  const hook = renderHook(current => useRegionWeather(current),
    { wrapper, initialProps: { adapter: used, stationId: WEATHER_STATION_ID, ...props } });
  return { ...hook, adapter: used, shell };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOON);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  cleanup();
  delete document.visibilityState;
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useRegionWeather (lane M7)', () => {
  it('reads the four regional answers once through the injected adapter', async () => {
    const { result, adapter } = setup();
    expect(result.current.region.status).toBe('loading');
    await flush();
    expect(readsOf(adapter)).toEqual(['radar', 'region', 'sigmets', 'wind']);
    expect(adapter.calls.every(call => call.stationId === WEATHER_STATION_ID)).toBe(true);
    const { region, sigmets, wind, radar } = result.current;
    expect([region.status, sigmets.status, wind.status, radar.status]).toEqual(['success', 'success', 'success', 'success']);
    expect(region.data.stations.map(station => station.icao)).toContain('MDPC');
    expect(sigmets.data.sigmets).toHaveLength(3);
    expect(radar.data.frames.length).toBeGreaterThan(0);
    expect(wind.data.grid.points).toHaveLength(9);
    expect(result.current.demo).toBe(false);
  });

  it('polls on its own pace: the radar index every five minutes, the rest every ten', async () => {
    const { adapter } = setup();
    await flush();
    await flush(300_000);
    expect(adapter.calls.filter(call => call.read === 'radar')).toHaveLength(2);
    expect(adapter.calls.filter(call => call.read === 'region')).toHaveLength(1);
    await flush(300_000);
    expect(adapter.calls.filter(call => call.read === 'radar')).toHaveLength(3);
    for (const read of ['region', 'sigmets', 'wind']) expect(adapter.calls.filter(call => call.read === read)).toHaveLength(2);
  });

  it('waits while the tab is hidden and reads once it shows again', async () => {
    const { adapter } = setup();
    await flush();
    visibility = 'hidden';
    await flush(600_000);
    expect(adapter.calls).toHaveLength(4);
    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(adapter.calls.length).toBeGreaterThan(4);
  });

  it('an Unavailable or Disabled answer is empty and keeps its state for the layers menu', async () => {
    const { result } = setup({}, { scenario: createRegionWeatherScenario({ status: 'Disabled' }) });
    await flush();
    expect(result.current.region.status).toBe('empty');
    expect(result.current.region.data.status).toBe('Disabled');
    expect(result.current.radar.data.frames).toEqual([]);
  });

  it('a failed read is an error and backs off; a refused one is unauthorized and is not asked again', async () => {
    const failing = createRegionWeatherScenario({ failure: ({ read }) => (read === 'radar' ? { status: 503 } : null) });
    const { result, adapter } = setup({}, { scenario: failing });
    await flush();
    expect(result.current.radar.status).toBe('error');
    expect(result.current.region.status).toBe('success');
    // The first retry after twice the five minutes, not after five.
    await flush(300_000);
    expect(adapter.calls.filter(call => call.read === 'radar')).toHaveLength(1);
    await flush(300_000);
    expect(adapter.calls.filter(call => call.read === 'radar')).toHaveLength(2);

    cleanup();
    const refused = createRegionWeatherScenario({ failure: ({ read }) => (read === 'sigmets' ? { status: 403 } : null) });
    const second = setup({}, { scenario: refused });
    await flush();
    expect(second.result.current.sigmets.status).toBe('unauthorized');
    await flush(3_600_000);
    expect(second.adapter.calls.filter(call => call.read === 'sigmets')).toHaveLength(1);
  });

  it('reads nothing without a map permission, without a station, disabled, or for a read nobody wants', async () => {
    const denied = setup({}, { access: WITHOUT_MAP });
    await flush();
    expect(denied.adapter.calls).toEqual([]);
    expect(denied.result.current.region.status).toBe('unauthorized');
    cleanup();
    for (const props of [{ stationId: '' }, { enabled: false }]) {
      const quiet = setup(props);
      await flush();
      expect(quiet.adapter.calls).toEqual([]);
      expect(quiet.result.current.radar.status).toBe('loading');
      cleanup();
    }
    const some = setup({ wanted: { wind: false, radar: false }, demo: true });
    await flush();
    expect(readsOf(some.adapter)).toEqual(['region', 'sigmets']);
    expect(some.result.current.demo).toBe(true);
  });

  it('keeps the plan pace and the back-off pure', () => {
    expect(Object.values(REGION_WEATHER_READS).map(entry => entry.pollMs)).toEqual([600_000, 600_000, 600_000, 300_000]);
    const radar = REGION_WEATHER_READS.radar;
    expect(regionWeatherDelayMs(radar)).toBe(300_000);
    expect(regionWeatherDelayMs(radar, 2)).toBe(1_200_000);
    expect(regionWeatherDelayMs(radar, 9)).toBe(REGION_WEATHER_MAX_DELAY_MS);
    expect(['success', 'empty', 'forbidden', 'unauthorized', 'timeout', 'error', 'idle', 'loading'].map(regionReadStatus))
      .toEqual(['success', 'empty', 'unauthorized', 'unauthorized', 'error', 'error', 'loading', 'loading']);
  });
});

describe('the regional weather adapters (services/regionWeatherService.js)', () => {
  it('the remote one calls the shared client with the station and fails a read the client does not offer yet', async () => {
    const client = {
      getOccRegionWeather: vi.fn().mockResolvedValue({ status: 'Live', serverTime: WEATHER_NOON, stations: [] }),
    };
    const adapter = createRemoteRegionWeatherAdapter({ client });
    await expect(adapter.getRegionWeather({ stationId: WEATHER_STATION_ID })).resolves.toMatchObject({ status: 'Live' });
    expect(client.getOccRegionWeather).toHaveBeenCalledWith({ stationId: WEATHER_STATION_ID }, expect.any(Object));
    await expect(adapter.getRadarFrames({ stationId: WEATHER_STATION_ID }))
      .rejects.toMatchObject({ status: 404, code: 'region_weather_unavailable' });
    expect(offersRegionWeather(client)).toBe(false);
    const full = Object.fromEntries(Object.values(REGION_WEATHER_OPERATIONS).map(({ read }) => [read, () => null]));
    expect(offersRegionWeather(full)).toBe(true);
    expect(offersRegionWeather(() => { throw new Error('no client'); })).toBe(false);
  });

  it('the disabled one answers Disabled for every read without a request', async () => {
    const adapter = createDisabledRegionWeatherAdapter();
    const answers = await Promise.all([adapter.getRegionWeather({ stationId: 'x' }), adapter.getSigmets({}),
      adapter.getWindGrid({}), adapter.getRadarFrames({})]);
    expect(answers.map(answer => answer.status)).toEqual(['Disabled', 'Disabled', 'Disabled', 'Disabled']);
    expect(answers[0]).toMatchObject({ stationId: 'x', stations: [] });
    expect(answers[3].frames).toEqual([]);
  });

  it('the simulated one moves its instants to now when asked, and answers 404 for a missing part', async () => {
    const later = NOON + 3_600_000;
    const adapter = createSimulatedRegionWeatherAdapter({ scenario: { ...createRegionWeatherScenario(), wind: null },
      now: () => later, shift: true });
    const region = await adapter.getRegionWeather({ stationId: WEATHER_STATION_ID });
    expect(Date.parse(region.serverTime)).toBe(later);
    await expect(adapter.getWindGrid({ stationId: WEATHER_STATION_ID })).rejects.toMatchObject({ status: 404 });
    expect(adapter.calls.map(call => call.read)).toEqual(['region', 'wind']);
  });
});
