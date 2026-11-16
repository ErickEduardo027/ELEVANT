import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GOES_TILE_TEMPLATE, IMERG_TILE_TEMPLATE } from '../../services/satelliteService';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import {
  SATELLITE_POLL_MS, createSimulatedSatelliteImagery, remoteSatelliteImagery, satelliteSourceState, useSatelliteImagery,
} from './useSatelliteImagery';

// The times of the satellite images (PR M8), read from a simulated GIBS: nothing here touches the network.

const NOON = Date.parse('2026-11-13T15:00:00.000Z');
const IMAGES = Object.freeze({
  goes: Object.freeze({ time: '2026-11-13T14:50:00Z', precision: 'instant' }),
  imerg: Object.freeze({ time: '2026-11-13', precision: 'day' }),
});
const pinned = (template, time) => template.replace('/default/default/', `/default/${time}/`);

let visibility = 'visible';
// Moves the fake clock and lets every answer and render that falls due settle.
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function setup(props = {}, { service = createSimulatedSatelliteImagery(IMAGES), shell = null } = {}) {
  const wrapper = shell ? ({ children }) => <OccShellTestProvider value={shell}>{children}</OccShellTestProvider> : undefined;
  const hook = renderHook(current => useSatelliteImagery(current), { wrapper, initialProps: { service, ...props } });
  return { ...hook, service, shell };
}
const layersRead = service => service.calls.map(call => call.layer);
const satelliteSource = shell => shell.sourceStore.getSnapshot().find(item => item.id === 'satellite') ?? null;

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
  vi.restoreAllMocks();
});

describe('useSatelliteImagery (PR M8)', () => {
  it('reads a layer only while it is wanted, every 10 minutes while visible', async () => {
    const view = setup();
    await flush(SATELLITE_POLL_MS);
    // Nothing wanted, nothing read.
    expect(view.service.calls).toEqual([]);
    expect(view.result.current.goes).toEqual({ status: 'idle', time: null, precision: null, tileTemplate: null });

    // The clouds wanted: read at once, and ready with their tiles pinned to the time GIBS names.
    view.rerender({ goes: true, service: view.service });
    expect(view.result.current.goes.status).toBe('loading');
    await flush();
    expect(layersRead(view.service)).toEqual(['goes']);
    expect(view.result.current.goes).toEqual({ status: 'ready', time: IMAGES.goes.time, precision: 'instant',
      tileTemplate: pinned(GOES_TILE_TEMPLATE, IMAGES.goes.time) });
    expect(view.result.current.imerg.status).toBe('idle');

    // Again after ten minutes, while the tab shows; not while it is hidden.
    await flush(SATELLITE_POLL_MS - 1);
    expect(layersRead(view.service)).toEqual(['goes']);
    await flush(1);
    expect(layersRead(view.service)).toEqual(['goes', 'goes']);
    visibility = 'hidden';
    await flush(SATELLITE_POLL_MS);
    expect(layersRead(view.service)).toEqual(['goes', 'goes']);
    visibility = 'visible';

    // No longer wanted (the map left Región and Aproximación): no more reads, and the image it had stays.
    view.rerender({ goes: false, service: view.service });
    await flush(2 * SATELLITE_POLL_MS);
    expect(layersRead(view.service)).toEqual(['goes', 'goes']);
    expect(view.result.current.goes.status).toBe('ready');
    // Wanted again within ten minutes of its last read (at noon + 10 min): no read at once, the next one on its pace.
    vi.setSystemTime(NOON + 15 * 60_000);
    view.rerender({ goes: true, service: view.service });
    await flush();
    expect(layersRead(view.service)).toEqual(['goes', 'goes']);
    await flush(SATELLITE_POLL_MS);
    expect(layersRead(view.service)).toEqual(['goes', 'goes', 'goes']);

    // The rain wanted too: its own read, a daily image.
    view.rerender({ goes: true, imerg: true, service: view.service });
    await flush();
    expect(layersRead(view.service)).toEqual(['goes', 'goes', 'goes', 'imerg']);
    expect(view.result.current.imerg).toEqual({ status: 'ready', time: IMAGES.imerg.time, precision: 'day',
      tileTemplate: pinned(IMERG_TILE_TEMPLATE, IMAGES.imerg.time) });
    // Gone, nothing left running.
    view.unmount();
    const calls = view.service.calls.length;
    await flush(3 * SATELLITE_POLL_MS);
    expect(view.service.calls).toHaveLength(calls);
  });

  it('a failed read leaves the layer unavailable', async () => {
    // GIBS answers without the time of its image, or the read fails: the layer stays unavailable, nothing to pin.
    const service = createSimulatedSatelliteImagery({ goes: null, imerg: { fails: true } });
    const view = setup({ goes: true, imerg: true }, { service });
    await flush();
    expect(view.result.current.goes).toEqual({ status: 'unavailable', time: null, precision: null, tileTemplate: null });
    expect(view.result.current.imerg.status).toBe('unavailable');
    // It tries again on its pace.
    await flush(SATELLITE_POLL_MS);
    expect(layersRead(service)).toEqual(['goes', 'imerg', 'goes', 'imerg']);
    cleanup();

    // A refresh that fails keeps the image it had: its tiles stay pinned to a time GIBS named.
    let fail = false;
    const flaky = {
      calls: [],
      async loadImageInfo(layer) {
        this.calls.push({ layer });
        if (fail) throw new Error('satellite-unavailable');
        return { time: IMAGES.goes.time, precision: 'instant', tileTemplate: pinned(GOES_TILE_TEMPLATE, IMAGES.goes.time) };
      },
    };
    const kept = setup({ goes: true }, { service: flaky });
    await flush();
    expect(kept.result.current.goes.status).toBe('ready');
    fail = true;
    await flush(SATELLITE_POLL_MS);
    expect(flaky.calls).toHaveLength(2);
    expect(kept.result.current.goes).toMatchObject({ status: 'ready', time: IMAGES.goes.time });
  });

  it('tells the OCC frame the state of the images while one is wanted, and takes it back', async () => {
    const shell = createOccShellValue();
    const view = setup({ goes: true }, { shell });
    expect(satelliteSource(shell)).toMatchObject({ state: 'idle' });
    await flush();
    expect(satelliteSource(shell)).toMatchObject({ state: 'ok', at: Date.parse(IMAGES.goes.time) });
    // Not wanted: off the list.
    view.rerender({ goes: false, service: view.service });
    expect(satelliteSource(shell)).toBeNull();
    cleanup();

    const failing = createOccShellValue();
    setup({ goes: true, imerg: true }, { shell: failing, service: createSimulatedSatelliteImagery({ goes: { fails: true } }) });
    await flush();
    expect(satelliteSource(failing)).toMatchObject({ state: 'offline', at: null });
    // The rules of that state, apart.
    const ready = { status: 'ready', time: IMAGES.goes.time, precision: 'instant' };
    expect(satelliteSourceState({ goes: ready, imerg: { status: 'unavailable' } }, { goes: true, imerg: true })).toBe('ok');
    expect(satelliteSourceState({ goes: { status: 'loading' }, imerg: { status: 'unavailable' } }, { goes: true, imerg: true }))
      .toBe('idle');
    expect(satelliteSourceState({ goes: ready }, {})).toBe('idle');
  });

  it('the simulated adapter answers its images without the network; the remote one reads GIBS through the service', async () => {
    const service = createSimulatedSatelliteImagery({ goes: { time: '2026-11-13T14:50:00Z' } });
    await expect(service.loadImageInfo('goes')).resolves.toEqual({ time: '2026-11-13T14:50:00Z', precision: 'instant',
      tileTemplate: pinned(GOES_TILE_TEMPLATE, '2026-11-13T14:50:00Z') });
    await expect(service.loadImageInfo('imerg')).resolves.toBeNull();
    await expect(createSimulatedSatelliteImagery({ goes: { time: 'mañana' } }).loadImageInfo('goes')).resolves.toBeNull();
    const controller = new AbortController();
    controller.abort();
    await expect(service.loadImageInfo('goes', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(service.calls).toEqual([{ layer: 'goes' }, { layer: 'imerg' }, { layer: 'goes' }]);
    // The remote adapter is services/satelliteService.js: a fetch of the GIBS tile over PUJ (stubbed here).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {
      status: 200, headers: { 'Layer-Time-Actual': '2026-11-13T14:50:00Z' },
    })));
    await expect(remoteSatelliteImagery.loadImageInfo('goes')).resolves.toMatchObject({ time: '2026-11-13T14:50:00Z' });
    expect(fetch.mock.calls[0][0]).toMatch(/^https:\/\/gibs\.earthdata\.nasa\.gov\//);
    vi.unstubAllGlobals();
  });
});
