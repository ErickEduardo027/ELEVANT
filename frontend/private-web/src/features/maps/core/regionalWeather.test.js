import { describe, expect, it, vi } from 'vitest';
import {
  createRegionWeather, createRadarFrames, createSigmets, WEATHER_NOON,
} from '../testing/weatherFixtures';
import {
  LOOP_BANDS, LOOP_FRAME_COUNT, RADAR_FRAME_COUNT, RADAR_OPACITY, SIGMET_SOURCE, STATIONS_SOURCE, loopLayerId,
  radarLayerId,
} from '../traffic/weatherLayers';
import {
  applyRegionalDrawing, createRegionalApplied, radarCredit, regionalDrawing, regionalLoop, regionalOpacities,
  startRegionalLoop, withPinnedRegional,
} from './regionalWeather';

const NOON = Date.parse(WEATHER_NOON);
// The images GIBS has of the band the loop shows, as useSatelliteImagery's `loop` answers them.
const LOOP = Object.freeze({ status: 'ready', band: 'geocolor', source: 'domain', times: Object.freeze([
  '2026-11-13T14:00:00Z', '2026-11-13T14:10:00Z', '2026-11-13T14:20:00Z', '2026-11-13T14:30:00Z',
  '2026-11-13T14:40:00Z', '2026-11-13T14:50:00Z']) });
// GeoColor's domain read from GIBS on 2026-11-28 at 17:20 UTC: no 16:00, nothing after 16:20 (the infrared had 16:50).
const GEOCOLOR_28 = Object.freeze(['2026-11-28T15:10:00Z', '2026-11-28T15:20:00Z', '2026-11-28T15:30:00Z',
  '2026-11-28T15:40:00Z', '2026-11-28T15:50:00Z', '2026-11-28T16:10:00Z', '2026-11-28T16:20:00Z']);
const AFTERNOON_28 = Date.parse('2026-11-28T17:20:00Z');
const read = data => ({ status: 'success', data });
const weather = (extra = {}) => ({
  region: read(createRegionWeather()), sigmets: read(createSigmets()), wind: { status: 'loading', data: null },
  radar: read(createRadarFrames()), demo: false, ...extra,
});
const fakeEngine = () => ({ setData: vi.fn(), setRasterTiles: vi.fn(), setPaint: vi.fn() });

describe('the regional weather of an OCC map (lane M7)', () => {
  it('draws the loop on the latest image GIBS has, the latest radar frames, the stations and the SIGMETs in force', () => {
    const drawing = regionalDrawing({ regionWeather: weather(), loopImages: LOOP, nowMs: NOON });
    expect(drawing.loop.status).toBe('ready');
    expect(drawing.loop.frames).toHaveLength(LOOP_FRAME_COUNT);
    expect(drawing.loop.frames.at(-1).time).toBe(LOOP.times.at(-1));
    expect(drawing.radar.frames).toHaveLength(RADAR_FRAME_COUNT);
    expect(drawing.radar.provider).toBe('iem-tjua');
    expect(drawing.stations.features.map(item => item.properties.icao)).toContain('MDLR');
    expect(drawing.sigmets.features.map(item => item.properties.id)).toEqual(['MDCS-SIGMET-A1']);
    expect(drawing.notes.stations.status).toBe('success');
    expect(drawing.notes.loop).toBe(drawing.loop);
  });

  it('waits for GIBS, says when it has no image, and draws nothing of a Disabled read', () => {
    expect(regionalLoop({ status: 'loading' }, NOON).status).toBe('loading');
    expect(regionalLoop({ status: 'unavailable' }, NOON)).toMatchObject({ status: 'unavailable', frames: [] });
    const off = regionalDrawing({ regionWeather: weather({ radar: read(createRadarFrames({ status: 'Disabled' })),
      region: read(createRegionWeather({ status: 'Disabled' })) }), loopImages: null, nowMs: NOON });
    expect(off.radar.frames).toEqual([]);
    expect(off.stations.features).toEqual([]);
    // A simulated adapter tags what it draws «Demo».
    const demo = regionalDrawing({ regionWeather: weather({ demo: true }), loopImages: LOOP, nowMs: NOON });
    expect(demo.loop.demo).toBe(true);
    expect(demo.stations.features.every(item => item.properties.demo === true)).toBe(true);
  });

  // Hotfix of 2026-11-28: the loop runs only the images GIBS has of the band it shows, skipping the holes.
  it('runs the latest six images GeoColor has, skipping its holes, never the infrared time', () => {
    const loop = regionalLoop({ status: 'ready', band: 'geocolor', times: GEOCOLOR_28 }, AFTERNOON_28);
    expect(loop).toMatchObject({ status: 'ready', band: 'geocolor' });
    expect(loop.frames.map(frame => frame.time)).toEqual(['2026-11-28T15:20:00Z', '2026-11-28T15:30:00Z',
      '2026-11-28T15:40:00Z', '2026-11-28T15:50:00Z', '2026-11-28T16:10:00Z', '2026-11-28T16:20:00Z']);
    expect(loop.frames.every(frame => frame.tiles[0].includes('/GOES-East_ABI_GeoColor/default/'))).toBe(true);
    expect(loop.frames.some(frame => frame.tiles[0].includes('16:50'))).toBe(false);
    // The band is the one the images are of (the infrared, just after sunrise), not the one of the hour.
    const ir = regionalLoop({ status: 'ready', band: 'ir', times: ['2026-11-28T10:50:00Z'] }, AFTERNOON_28);
    expect(ir.band).toBe('ir');
    expect(ir.frames.map(frame => frame.time)).toEqual(Array(LOOP_FRAME_COUNT).fill('2026-11-28T10:50:00Z'));
    // Until they arrive, the band of the hour; with no image in the list, still loading.
    expect(regionalLoop({ status: 'loading' }, AFTERNOON_28)).toMatchObject({ band: 'geocolor', frames: [] });
    expect(regionalLoop({ status: 'ready', band: 'geocolor', times: [] }, AFTERNOON_28).status).toBe('loading');
  });

  it('gives a source new tiles only when its frame changes', () => {
    const engine = fakeEngine();
    const applied = createRegionalApplied();
    const drawingOf = times => regionalDrawing({ regionWeather: weather(),
      loopImages: { status: 'ready', band: 'geocolor', times }, nowMs: AFTERNOON_28 });
    applyRegionalDrawing(engine, applied, drawingOf(GEOCOLOR_28));
    engine.setRasterTiles.mockClear();
    // The same images, listed again in another order: nothing is pinned again.
    expect(applyRegionalDrawing(engine, applied, drawingOf([...GEOCOLOR_28].reverse()))).toBe(false);
    // A new image moves every frame one step: each loop source is pinned once more, to an image GIBS has.
    applyRegionalDrawing(engine, applied, drawingOf([...GEOCOLOR_28, '2026-11-28T16:30:00Z']));
    const pinned = engine.setRasterTiles.mock.calls.map(([, tiles]) => tiles[0]);
    expect(pinned).toHaveLength(LOOP_FRAME_COUNT);
    expect(pinned.at(-1)).toContain('/2026-11-28T16:30:00Z/');
  });

  it('keeps the loop and the radar hidden until their frames are pinned', () => {
    const groups = { 'weather.loop': true, 'weather.radar': true, 'weather.stations': true };
    const none = regionalDrawing({ regionWeather: weather({ radar: { status: 'loading', data: null } }), loopImages: null,
      nowMs: NOON });
    expect(withPinnedRegional(groups, none)).toEqual({ 'weather.loop': false, 'weather.radar': false,
      'weather.stations': true });
    const all = regionalDrawing({ regionWeather: weather(), loopImages: LOOP, nowMs: NOON });
    expect(withPinnedRegional(groups, all)).toEqual(groups);
    expect(withPinnedRegional(groups, null)).toBe(groups);
  });

  it('writes each source once, pins each frame once and sets the band saturation when it changes', () => {
    const engine = fakeEngine();
    const applied = createRegionalApplied();
    const drawing = regionalDrawing({ regionWeather: weather(), loopImages: LOOP, nowMs: NOON });
    expect(applyRegionalDrawing(engine, applied, drawing)).toBe(true);
    expect(engine.setData.mock.calls.map(([source]) => source)).toEqual([STATIONS_SOURCE, SIGMET_SOURCE]);
    expect(engine.setRasterTiles).toHaveBeenCalledTimes(LOOP_FRAME_COUNT + RADAR_FRAME_COUNT);
    expect(engine.setPaint).toHaveBeenCalledTimes(LOOP_FRAME_COUNT);
    // The same drawing again writes nothing.
    expect(applyRegionalDrawing(engine, applied, regionalDrawing({ regionWeather: weather(), loopImages: LOOP,
      nowMs: NOON }))).toBe(false);
    expect(applyRegionalDrawing(null, applied, drawing)).toBe(false);
  });

  it('runs the frames by opacity, holds the latest one when still, and pauses while the tab is hidden', () => {
    const drawing = regionalDrawing({ regionWeather: weather(), loopImages: LOOP, nowMs: NOON });
    const band = LOOP_BANDS[drawing.loop.band].opacity;
    const first = regionalOpacities(drawing, 0);
    expect(first[loopLayerId(0)]).toBe(band);
    expect(first[loopLayerId(LOOP_FRAME_COUNT - 1)]).toBe(0);
    expect(first[radarLayerId(0)]).toBe(RADAR_OPACITY);
    const still = regionalOpacities(drawing, 0, { still: true });
    expect(still[loopLayerId(LOOP_FRAME_COUNT - 1)]).toBe(band);
    expect(still[radarLayerId(RADAR_FRAME_COUNT - 1)]).toBe(RADAR_OPACITY);

    const engine = fakeEngine();
    let tick = null;
    let now = 0;
    const loop = startRegionalLoop(engine, { getDrawing: () => drawing, now: () => now,
      setTimer: callback => { tick = callback; return 1; }, clearTimer: vi.fn() });
    const written = engine.setPaint.mock.calls.length;
    expect(written).toBe(LOOP_FRAME_COUNT + RADAR_FRAME_COUNT);
    tick();
    expect(engine.setPaint.mock.calls.length).toBe(written);
    now = 600;
    tick();
    // Frame 0 hides and frame 1 shows, on each loop.
    expect(engine.setPaint.mock.calls.length).toBe(written + 4);
    loop.rewrite();
    expect(engine.setPaint.mock.calls.length).toBe(written + 4 + LOOP_FRAME_COUNT + RADAR_FRAME_COUNT);
    loop.stop();
  });

  it("credits the radar provider it knows: only IEM's TJUA, the one the API names (lane M6)", () => {
    expect(radarCredit('iem-tjua').name).toMatch(/Iowa Environmental Mesonet/);
    expect(radarCredit('rainviewer')).toBeNull();
    expect(radarCredit('other')).toBeNull();
    expect(radarCredit(null)).toBeNull();
  });
});
