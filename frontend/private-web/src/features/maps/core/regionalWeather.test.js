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
const GOES = Object.freeze({ status: 'ready', time: '2026-11-13T14:50:00Z', precision: 'instant' });
const read = data => ({ status: 'success', data });
const weather = (extra = {}) => ({
  region: read(createRegionWeather()), sigmets: read(createSigmets()), wind: { status: 'loading', data: null },
  radar: read(createRadarFrames()), demo: false, ...extra,
});
const fakeEngine = () => ({ setData: vi.fn(), setRasterTiles: vi.fn(), setPaint: vi.fn() });

describe('the regional weather of an OCC map (lane M7)', () => {
  it('draws the loop on the latest GOES time, the latest radar frames, the stations and the SIGMETs in force', () => {
    const drawing = regionalDrawing({ regionWeather: weather(), goes: GOES, nowMs: NOON });
    expect(drawing.loop.status).toBe('ready');
    expect(drawing.loop.frames).toHaveLength(LOOP_FRAME_COUNT);
    expect(drawing.loop.frames.at(-1).time).toBe(GOES.time);
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
      region: read(createRegionWeather({ status: 'Disabled' })) }), goes: null, nowMs: NOON });
    expect(off.radar.frames).toEqual([]);
    expect(off.stations.features).toEqual([]);
    // A simulated adapter tags what it draws «Demo».
    const demo = regionalDrawing({ regionWeather: weather({ demo: true }), goes: GOES, nowMs: NOON });
    expect(demo.loop.demo).toBe(true);
    expect(demo.stations.features.every(item => item.properties.demo === true)).toBe(true);
  });

  it('keeps the loop and the radar hidden until their frames are pinned', () => {
    const groups = { 'weather.loop': true, 'weather.radar': true, 'weather.stations': true };
    const none = regionalDrawing({ regionWeather: weather({ radar: { status: 'loading', data: null } }), goes: null,
      nowMs: NOON });
    expect(withPinnedRegional(groups, none)).toEqual({ 'weather.loop': false, 'weather.radar': false,
      'weather.stations': true });
    const all = regionalDrawing({ regionWeather: weather(), goes: GOES, nowMs: NOON });
    expect(withPinnedRegional(groups, all)).toEqual(groups);
    expect(withPinnedRegional(groups, null)).toBe(groups);
  });

  it('writes each source once, pins each frame once and sets the band saturation when it changes', () => {
    const engine = fakeEngine();
    const applied = createRegionalApplied();
    const drawing = regionalDrawing({ regionWeather: weather(), goes: GOES, nowMs: NOON });
    expect(applyRegionalDrawing(engine, applied, drawing)).toBe(true);
    expect(engine.setData.mock.calls.map(([source]) => source)).toEqual([STATIONS_SOURCE, SIGMET_SOURCE]);
    expect(engine.setRasterTiles).toHaveBeenCalledTimes(LOOP_FRAME_COUNT + RADAR_FRAME_COUNT);
    expect(engine.setPaint).toHaveBeenCalledTimes(LOOP_FRAME_COUNT);
    // The same drawing again writes nothing.
    expect(applyRegionalDrawing(engine, applied, regionalDrawing({ regionWeather: weather(), goes: GOES,
      nowMs: NOON }))).toBe(false);
    expect(applyRegionalDrawing(null, applied, drawing)).toBe(false);
  });

  it('runs the frames by opacity, holds the latest one when still, and pauses while the tab is hidden', () => {
    const drawing = regionalDrawing({ regionWeather: weather(), goes: GOES, nowMs: NOON });
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

  it('credits the radar provider it knows', () => {
    expect(radarCredit('iem-tjua').name).toMatch(/Iowa Environmental Mesonet/);
    expect(radarCredit('rainviewer').name).toBe('RainViewer');
    expect(radarCredit('other')).toBeNull();
    expect(radarCredit(null)).toBeNull();
  });
});
