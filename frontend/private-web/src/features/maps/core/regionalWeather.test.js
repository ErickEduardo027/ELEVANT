import { describe, expect, it, vi } from 'vitest';
import {
  createRegionWeather, createRadarFrames, createSigmets, WEATHER_NOON,
} from '../testing/weatherFixtures';
import {
  LOOP_BANDS, LOOP_FRAME_COUNT, LOOP_FRAME_MS, RADAR_FRAME_COUNT, RADAR_OPACITY, SIGMET_SOURCE, STATIONS_SOURCE,
  WEATHER_GROUPS, loopLayerId, loopSourceId, radarLayerId, radarSourceId, weatherLayerNotes,
} from '../traffic/weatherLayers';
import {
  LOOP_FRAME_FAILED_SHARE, applyRegionalDrawing, createRegionalApplied, isLoopFrameSource, markLoopFrameMissing,
  radarCredit, regionalDrawing, regionalLoop, regionalOpacities, startRegionalLoop, withPinnedRegional,
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

  // Hotfix of 2026-11-28, step 2: a frame GIBS lists whose tiles still fail is skipped, never shown blank.
  describe('a loop frame whose tiles fail', () => {
    const LOOP_KEY = WEATHER_GROUPS.loop;
    const loopNote = regional => weatherLayerNotes({ layers: { [LOOP_KEY]: true }, view: 'region', regional,
      nowMs: NOON, language: 'es' })[LOOP_KEY];
    const pinnedDrawing = (marks = {}) => {
      const engine = fakeEngine();
      const applied = createRegionalApplied();
      const drawing = regionalDrawing({ regionWeather: weather(), loopImages: LOOP, loopMissing: marks, nowMs: NOON });
      applyRegionalDrawing(engine, applied, drawing);
      return { applied, drawing };
    };

    it('is marked at the tiles it is pinned to, only for a loop source', () => {
      const { applied } = pinnedDrawing();
      const marks = markLoopFrameMissing({}, applied.tiles, loopSourceId(2));
      expect(marks).toEqual({ [loopSourceId(2)]: applied.tiles[loopSourceId(2)] });
      // Marked again, a radar frame, a source nothing is pinned to: the same marks.
      expect(markLoopFrameMissing(marks, applied.tiles, loopSourceId(2))).toBe(marks);
      expect(markLoopFrameMissing(marks, applied.tiles, radarSourceId(0))).toBe(marks);
      expect(markLoopFrameMissing(marks, {}, loopSourceId(3))).toBe(marks);
      expect(isLoopFrameSource(loopSourceId(0))).toBe(true);
      expect(isLoopFrameSource(radarSourceId(0))).toBe(false);
      expect(isLoopFrameSource(null)).toBe(false);
    });

    it('is skipped by the loop: the frame before it stays on screen, the radar unchanged', () => {
      const { applied } = pinnedDrawing();
      const marks = markLoopFrameMissing({}, applied.tiles, loopSourceId(2));
      const drawing = regionalDrawing({ regionWeather: weather(), loopImages: LOOP, loopMissing: marks, nowMs: NOON });
      expect(drawing.loop.status).toBe('ready');
      expect(drawing.loop.frames.map(frame => frame.missing)).toEqual([false, false, true, false, false, false]);
      const band = LOOP_BANDS[drawing.loop.band].opacity;
      // Frame 1 shows its turn; frame 2's turn goes to frame 3, never to a blank frame.
      expect(regionalOpacities(drawing, LOOP_FRAME_MS)[loopLayerId(1)]).toBe(band);
      const third = regionalOpacities(drawing, 2 * LOOP_FRAME_MS);
      expect(third[loopLayerId(2)]).toBe(0);
      expect(third[loopLayerId(3)]).toBe(band);
      expect(third[radarLayerId(2)]).toBe(RADAR_OPACITY);
      for (let elapsed = 0; elapsed < 10 * LOOP_FRAME_MS; elapsed += 100) {
        const opacities = regionalOpacities(drawing, elapsed);
        expect(Array.from({ length: LOOP_FRAME_COUNT }, (_, index) => opacities[loopLayerId(index)]))
          .toSatisfy(values => values[2] === 0 && values.filter(value => value > 0).length === 1);
      }
      // A missing latest frame: held still, the loop shows the latest frame it has, and the span ends there.
      const latest = markLoopFrameMissing({}, applied.tiles, loopSourceId(LOOP_FRAME_COUNT - 1));
      const held = regionalDrawing({ regionWeather: weather(), loopImages: LOOP, loopMissing: latest, nowMs: NOON });
      const still = regionalOpacities(held, 0, { still: true });
      expect(still[loopLayerId(LOOP_FRAME_COUNT - 1)]).toBe(0);
      expect(still[loopLayerId(LOOP_FRAME_COUNT - 2)]).toBe(band);
      const shorter = regionalDrawing({ regionWeather: weather(), nowMs: NOON,
        loopImages: { ...LOOP, times: [LOOP.times[0], ...LOOP.times.slice(0, -1)] } });
      expect(loopNote(held.notes)).toBe(loopNote(shorter.notes));
      expect(loopNote(held.notes)).not.toBe(loopNote(regionalDrawing({ regionWeather: weather(), loopImages: LOOP,
        nowMs: NOON }).notes));
    });

    it('loses its mark when the frame is pinned to a new time', () => {
      const { applied } = pinnedDrawing();
      const marks = markLoopFrameMissing({}, applied.tiles, loopSourceId(5));
      // Ten minutes later every frame moves one image on: frame 5 is pinned to 15:00 and is no longer missing.
      const later = Object.freeze({ ...LOOP, times: Object.freeze([...LOOP.times.slice(1), '2026-11-13T15:00:00Z']) });
      const drawing = regionalDrawing({ regionWeather: weather(), loopImages: later, loopMissing: marks, nowMs: NOON });
      expect(drawing.loop.frames.every(frame => frame.missing === false)).toBe(true);
      applyRegionalDrawing(fakeEngine(), applied, drawing);
      // The next mark drops the marks that no longer match what is pinned.
      expect(markLoopFrameMissing(marks, applied.tiles, loopSourceId(1))).toEqual({
        [loopSourceId(1)]: applied.tiles[loopSourceId(1)] });
    });

    it('with every frame missing, holds nothing and the loop says it has no image', () => {
      const { applied } = pinnedDrawing();
      let marks = {};
      for (let index = 0; index < LOOP_FRAME_COUNT; index += 1) {
        marks = markLoopFrameMissing(marks, applied.tiles, loopSourceId(index));
      }
      const drawing = regionalDrawing({ regionWeather: weather(), loopImages: LOOP, loopMissing: marks, nowMs: NOON });
      expect(drawing.loop.status).toBe('unavailable');
      // Its frames stay pinned, so the marks keep matching and nothing is written again.
      expect(drawing.loop.frames).toHaveLength(LOOP_FRAME_COUNT);
      const engine = fakeEngine();
      applyRegionalDrawing(engine, applied, drawing);
      expect(engine.setRasterTiles).not.toHaveBeenCalled();
      for (const still of [false, true]) {
        const opacities = regionalOpacities(drawing, LOOP_FRAME_MS, { still });
        for (let index = 0; index < LOOP_FRAME_COUNT; index += 1) expect(opacities[loopLayerId(index)]).toBe(0);
      }
      expect(loopNote(drawing.notes)).toBe(loopNote({ loop: regionalLoop({ status: 'unavailable' }, NOON) }));
    });

    it('is found by the loop through the engine, without a request or a write, once per frame', () => {
      const { applied, drawing } = pinnedDrawing();
      const engine = { ...fakeEngine(), failedTiles: vi.fn(source => (source === loopSourceId(4) ? 74 : 0)) };
      const onFrameFailed = vi.fn();
      const loop = startRegionalLoop(engine, { getDrawing: () => drawing, onFrameFailed,
        setTimer: () => 1, clearTimer: vi.fn() });
      expect(onFrameFailed).toHaveBeenCalledExactlyOnceWith(loopSourceId(4));
      expect(engine.failedTiles).toHaveBeenCalledTimes(LOOP_FRAME_COUNT);
      expect(engine.setRasterTiles).not.toHaveBeenCalled();
      expect(engine.setData).not.toHaveBeenCalled();
      loop.stop();
      // A frame already missing is not asked about again.
      const marked = regionalDrawing({ regionWeather: weather(), loopImages: LOOP, nowMs: NOON,
        loopMissing: markLoopFrameMissing({}, applied.tiles, loopSourceId(4)) });
      onFrameFailed.mockClear();
      startRegionalLoop(engine, { getDrawing: () => marked, onFrameFailed, setTimer: () => 1, clearTimer: vi.fn() });
      expect(onFrameFailed).not.toHaveBeenCalled();
    });

    // HOTFIX-GOES-2: a flaky network loses a tile here and there; only most of a frame's tiles failing skips it.
    it('skips a frame only when most of the tiles it holds failed; an engine without heldTiles keeps any failure', () => {
      expect(LOOP_FRAME_FAILED_SHARE).toBe(0.5);
      const { drawing } = pinnedDrawing();
      const failedOf = { [loopSourceId(1)]: 1, [loopSourceId(2)]: 6, [loopSourceId(3)]: 12, [loopSourceId(4)]: 5 };
      const engine = { ...fakeEngine(), failedTiles: vi.fn(source => failedOf[source] ?? 0),
        heldTiles: vi.fn(source => (source in failedOf ? 12 : 0)) };
      const onFrameFailed = vi.fn();
      const loop = startRegionalLoop(engine, { getDrawing: () => drawing, onFrameFailed,
        setTimer: () => 1, clearTimer: vi.fn() });
      // 1 of 12 and 5 of 12 leave a gap only; 6 of 12 and all 12 skip the frame. A frame with no failure is not counted.
      expect(onFrameFailed.mock.calls.map(([source]) => source)).toEqual([loopSourceId(2), loopSourceId(3)]);
      expect(engine.heldTiles).toHaveBeenCalledTimes(4);
      expect(engine.setRasterTiles).not.toHaveBeenCalled();
      expect(engine.setData).not.toHaveBeenCalled();
      loop.stop();
      // Without heldTiles the loop keeps the rule of step 2: one failed tile skips the frame.
      const { heldTiles: _held, ...older } = engine;
      onFrameFailed.mockClear();
      startRegionalLoop(older, { getDrawing: () => drawing, onFrameFailed, setTimer: () => 1, clearTimer: vi.fn() });
      expect(onFrameFailed.mock.calls.map(([source]) => source))
        .toEqual([loopSourceId(1), loopSourceId(2), loopSourceId(3), loopSourceId(4)]);
    });
  });

  it("credits the radar provider it knows: only IEM's TJUA, the one the API names (lane M6)", () => {
    expect(radarCredit('iem-tjua').name).toMatch(/Iowa Environmental Mesonet/);
    expect(radarCredit('rainviewer')).toBeNull();
    expect(radarCredit('other')).toBeNull();
    expect(radarCredit(null)).toBeNull();
  });
});
