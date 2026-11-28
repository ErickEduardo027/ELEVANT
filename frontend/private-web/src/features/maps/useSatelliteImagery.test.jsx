import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GOES_TILE_TEMPLATE, IMERG_TILE_TEMPLATE } from '../../services/satelliteService';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import {
  LOOP_POLL_MS, LOOP_WINDOW_MS, SATELLITE_POLL_MS, createSimulatedSatelliteImagery, readLoopImages, remoteSatelliteImagery,
  satelliteSourceState, useSatelliteImagery,
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

// Hotfix of 2026-11-28: the satellite loop asks GIBS which images it has of the band it shows (its DescribeDomains),
// and never pins GeoColor to the infrared's time. The domains below are the ones GIBS answered at 17:20 UTC.
const AFTERNOON = Date.parse('2026-11-28T17:20:00Z');
const GEOCOLOR_DOMAIN = Object.freeze(['2026-11-28T15:10:00Z', '2026-11-28T15:20:00Z', '2026-11-28T15:30:00Z',
  '2026-11-28T15:40:00Z', '2026-11-28T15:50:00Z', '2026-11-28T16:10:00Z', '2026-11-28T16:20:00Z']);
const IR_DOMAIN = Object.freeze(['2026-11-28T16:20:00Z', '2026-11-28T16:30:00Z', '2026-11-28T16:40:00Z',
  '2026-11-28T16:50:00Z']);
const GEOCOLOR_LAYER = 'GOES-East_ABI_GeoColor';
const IR_LAYER = 'GOES-East_ABI_Band13_Clean_Infrared';
const loaders = ({ domains = {}, latest = {} } = {}) => ({
  loadDomain: vi.fn(async ({ layer }) => {
    const answer = domains[layer];
    if (answer instanceof Error || answer instanceof DOMException) throw answer;
    return answer ?? null;
  }),
  loadLatestTime: vi.fn(async ({ layer }) => {
    const answer = latest[layer];
    if (answer instanceof Error || answer instanceof DOMException) throw answer;
    return answer ?? null;
  }),
});
const pendingRead = reads => (band, { signal }) => {
  reads.push({ band, signal });
  return new Promise(() => {});
};

describe('the images of the satellite loop (hotfix of 2026-11-28)', () => {
  it('reads the domain of the band it shows over the last three hours, holes and all', async () => {
    const read = loaders({ domains: { [GEOCOLOR_LAYER]: GEOCOLOR_DOMAIN, [IR_LAYER]: IR_DOMAIN },
      latest: { [IR_LAYER]: '2026-11-28T16:50:00Z' } });
    await expect(readLoopImages('geocolor', { ...read, nowMs: AFTERNOON }))
      .resolves.toEqual({ band: 'geocolor', times: GEOCOLOR_DOMAIN, source: 'domain' });
    expect(read.loadDomain).toHaveBeenCalledTimes(1);
    expect(read.loadDomain.mock.calls[0][0]).toMatchObject({ layer: GEOCOLOR_LAYER,
      matrix: 'GoogleMapsCompatible_Level7', fromMs: AFTERNOON - LOOP_WINDOW_MS, toMs: AFTERNOON });
    // GeoColor never asks for the infrared's time.
    expect(read.loadLatestTime).not.toHaveBeenCalled();
    await expect(readLoopImages('ir', { ...read, nowMs: AFTERNOON }))
      .resolves.toEqual({ band: 'ir', times: IR_DOMAIN, source: 'domain' });
    expect(read.loadDomain.mock.calls[1][0]).toMatchObject({ layer: IR_LAYER, matrix: 'GoogleMapsCompatible_Level6' });
  });

  it('falls back to the header of its own band when the domain cannot be read', async () => {
    const read = loaders({ domains: { [GEOCOLOR_LAYER]: new Error('satellite-unavailable') },
      latest: { [GEOCOLOR_LAYER]: '2026-11-28T16:20:00Z', [IR_LAYER]: '2026-11-28T16:50:00Z' } });
    await expect(readLoopImages('geocolor', { ...read, nowMs: AFTERNOON })).resolves.toEqual({ band: 'geocolor',
      source: 'header', times: ['2026-11-28T15:30:00Z', '2026-11-28T15:40:00Z', '2026-11-28T15:50:00Z',
        '2026-11-28T16:00:00Z', '2026-11-28T16:10:00Z', '2026-11-28T16:20:00Z'] });
    expect(read.loadLatestTime.mock.calls.map(([options]) => options.layer)).toEqual([GEOCOLOR_LAYER]);
    // A domain that cannot be read (null) falls back the same way.
    const unread = loaders({ latest: { [GEOCOLOR_LAYER]: '2026-11-28T16:20:00Z' } });
    await expect(readLoopImages('geocolor', { ...unread, nowMs: AFTERNOON })).resolves.toMatchObject({
      band: 'geocolor', source: 'header' });
  });

  it('shows the infrared when GeoColor has nothing yet in the window (just after sunrise) or cannot be read', async () => {
    const sunrise = loaders({ domains: { [GEOCOLOR_LAYER]: [], [IR_LAYER]: IR_DOMAIN } });
    await expect(readLoopImages('geocolor', { ...sunrise, nowMs: AFTERNOON }))
      .resolves.toEqual({ band: 'ir', times: IR_DOMAIN, source: 'domain' });
    // An empty domain is an answer: GeoColor's header is not read.
    expect(sunrise.loadLatestTime).not.toHaveBeenCalled();
    const down = loaders({ domains: { [GEOCOLOR_LAYER]: new Error('x'), [IR_LAYER]: new Error('x') },
      latest: { [GEOCOLOR_LAYER]: new Error('x'), [IR_LAYER]: '2026-11-28T16:50:00Z' } });
    await expect(readLoopImages('geocolor', { ...down, nowMs: AFTERNOON }))
      .resolves.toMatchObject({ band: 'ir', source: 'header' });
    // Nothing anywhere: no images.
    await expect(readLoopImages('geocolor', { ...loaders(), nowMs: AFTERNOON })).resolves.toBeNull();
    await expect(readLoopImages('ir', { ...loaders({ domains: { [IR_LAYER]: [] } }), nowMs: AFTERNOON }))
      .resolves.toBeNull();
    // A cancelled read stays cancelled: it never falls back.
    const controller = new AbortController();
    controller.abort();
    const aborted = loaders({ domains: { [GEOCOLOR_LAYER]: new DOMException('stop', 'AbortError') } });
    await expect(readLoopImages('geocolor', { ...aborted, nowMs: AFTERNOON, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted.loadLatestTime).not.toHaveBeenCalled();
  });

  it('reads the loop only while it is wanted, every five minutes while visible, again on a new band', async () => {
    vi.setSystemTime(AFTERNOON);
    const reads = [];
    const service = {
      loadImageInfo: vi.fn(),
      loadLoopImages: vi.fn((band, { signal, nowMs }) => {
        reads.push({ band, signal, nowMs });
        return Promise.resolve({ band, times: band === 'geocolor' ? GEOCOLOR_DOMAIN : IR_DOMAIN, source: 'domain' });
      }),
    };
    const view = setup({}, { service });
    await flush(LOOP_POLL_MS);
    expect(reads).toEqual([]);
    expect(view.result.current.loop).toEqual({ status: 'idle', band: null, times: [], source: null });

    view.rerender({ loop: 'geocolor', service });
    expect(view.result.current.loop.status).toBe('loading');
    await flush();
    expect(reads.map(read => read.band)).toEqual(['geocolor']);
    expect(reads[0].nowMs).toBe(AFTERNOON + LOOP_POLL_MS);
    expect(view.result.current.loop).toEqual({ status: 'ready', band: 'geocolor', times: GEOCOLOR_DOMAIN,
      source: 'domain' });
    // The header of the clouds is not read for the loop.
    expect(service.loadImageInfo).not.toHaveBeenCalled();

    // Again after five minutes while the tab shows; not while it is hidden.
    await flush(LOOP_POLL_MS - 1);
    expect(reads).toHaveLength(1);
    await flush(1);
    expect(reads).toHaveLength(2);
    visibility = 'hidden';
    await flush(LOOP_POLL_MS);
    expect(reads).toHaveLength(2);
    visibility = 'visible';

    // A new band (sunset): the infrared is read at once; the loop keeps its images until it answers.
    service.loadLoopImages.mockImplementationOnce(pendingRead(reads));
    view.rerender({ loop: 'ir', service });
    await flush();
    expect(reads.at(-1).band).toBe('ir');
    expect(view.result.current.loop).toMatchObject({ status: 'ready', band: 'geocolor' });
    // Back to GeoColor before it answers: the infrared read is cancelled.
    const pending = reads.at(-1).signal;
    view.rerender({ loop: 'geocolor', service });
    await flush();
    expect(pending.aborted).toBe(true);
    expect(reads.at(-1).band).toBe('geocolor');

    // Not wanted: no more reads; gone: the read in flight is cancelled.
    view.rerender({ loop: null, service });
    const count = reads.length;
    await flush(3 * LOOP_POLL_MS);
    expect(reads).toHaveLength(count);
    service.loadLoopImages.mockImplementationOnce(pendingRead(reads));
    vi.setSystemTime(AFTERNOON + 60 * 60_000);
    view.rerender({ loop: 'ir', service });
    await flush();
    const inFlight = reads.at(-1).signal;
    view.unmount();
    expect(inFlight.aborted).toBe(true);
  });

  it('leaves the loop unavailable when GIBS has no image, and tells the OCC frame', async () => {
    const shell = createOccShellValue();
    const none = createSimulatedSatelliteImagery({ domains: { geocolor: [], ir: [] } });
    const view = setup({ loop: 'geocolor' }, { service: none, shell });
    await flush();
    expect(view.result.current.loop.status).toBe('unavailable');
    expect(satelliteSource(shell)).toMatchObject({ state: 'offline' });
    cleanup();

    const ready = createOccShellValue();
    const service = createSimulatedSatelliteImagery({ domains: { geocolor: GEOCOLOR_DOMAIN } });
    setup({ loop: 'geocolor' }, { service, shell: ready });
    await flush();
    expect(satelliteSource(ready)).toMatchObject({ state: 'ok', at: Date.parse('2026-11-28T16:20:00Z') });
  });

  it('the simulated adapter answers fixed instants, never the network; the remote one reads the domain from GIBS', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network in the simulated adapter'); }));
    const simulated = createSimulatedSatelliteImagery({ goes: IMAGES.goes,
      domains: { geocolor: GEOCOLOR_DOMAIN, ir: { fails: true } }, latest: { ir: '2026-11-28T16:50:00Z' } });
    await expect(simulated.loadLoopImages('geocolor', { nowMs: AFTERNOON }))
      .resolves.toEqual({ band: 'geocolor', times: GEOCOLOR_DOMAIN, source: 'domain' });
    await expect(simulated.loadLoopImages('ir', { nowMs: AFTERNOON }))
      .resolves.toMatchObject({ band: 'ir', source: 'header' });
    // A band the scene does not name runs six images ending at the time of its clouds.
    await expect(createSimulatedSatelliteImagery({ goes: IMAGES.goes }).loadLoopImages('geocolor'))
      .resolves.toMatchObject({ band: 'geocolor', times: expect.arrayContaining([IMAGES.goes.time]) });
    expect(simulated.calls).toEqual([{ loop: true, read: 'domain', band: 'geocolor' },
      { loop: true, read: 'domain', band: 'ir' }, { loop: true, read: 'header', band: 'ir' }]);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    const xml = '<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier>'
      + '<Domain>2026-11-28T15:40:00Z/2026-11-28T15:50:00Z/PT10M,2026-11-28T16:10:00Z/2026-11-28T16:20:00Z/PT10M</Domain>'
      + '</DimensionDomain></Domains>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));
    await expect(remoteSatelliteImagery.loadLoopImages('geocolor', { nowMs: AFTERNOON })).resolves.toEqual({
      band: 'geocolor', source: 'domain',
      times: ['2026-11-28T15:40:00Z', '2026-11-28T15:50:00Z', '2026-11-28T16:10:00Z', '2026-11-28T16:20:00Z'] });
    expect(fetch.mock.calls[0][0]).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/'
      + 'GOES-East_ABI_GeoColor/default/GoogleMapsCompatible_Level7/all/2026-11-28T14:20:00Z--2026-11-28T17:20:00Z.xml');
    vi.unstubAllGlobals();
  });
});
