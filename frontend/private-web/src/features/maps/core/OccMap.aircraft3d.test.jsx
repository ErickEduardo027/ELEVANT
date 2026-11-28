import { createRef } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { OCC_PALETTES } from '../../occ-ui/occPalette';
import { ThemeProvider, useTheme } from '../../shell/useTheme';
import { linearRgb } from '../aircraft/instancePlan';
import { destinationPoint } from '../airport/geo';
import {
  createAirPicture, createDemoBlock, createDemoFlights, createEstimates, createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_NOON,
  TRAFFIC_SOURCE,
} from '../testing/trafficFixtures';
import { createMotionStore } from '../traffic/motionStore';
import { buildSituation, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import MapDock from '../ui/MapDock';
import MapPresetSwitcher from '../ui/MapPresetSwitcher';
import { MODE_3D_STORAGE_KEY } from './aircraft3d';
import { PUJ_ARP } from './cameraPresets';
import { createRenderClock } from './frameLoop';
import OccMap from './OccMap';
import { useOccMap } from './OccMapContext';

// The 3D aircraft wired into OccMap (PR M7), on the fake MapLibre and the real 3D layer with an injected renderer:
// three's scene and raycaster need no WebGL, its renderer does. The chunk is the real one, handed over by a mocked
// loader, so no test reaches the network or a GPU.
vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const hoisted = vi.hoisted(() => ({ layers: [], renderers: [], failRenderer: false, failLoad: false, createCanvas: null }));
vi.mock('../aircraft/loadAircraft3d', async () => {
  const chunk = await import('../aircraft/aircraft3dChunk');
  const renderer = () => {
    if (hoisted.failRenderer) throw new Error('No WebGL2 here.');
    const made = { autoClear: true, resetState: vi.fn(), setViewport: vi.fn(), render: vi.fn(), dispose: vi.fn() };
    hoisted.renderers.push(made);
    return made;
  };
  return {
    loadAircraft3d: vi.fn(() => (hoisted.failLoad ? Promise.reject(new Error('chunk')) : Promise.resolve({
      three: chunk.THREE_PARTS, buildAircraftGeometry: chunk.buildAircraftGeometry, sceneLighting: chunk.sceneLighting,
      AIRCRAFT_3D_LAYER_ID: chunk.AIRCRAFT_3D_LAYER_ID,
      createAircraft3dLayer: options => {
        const layer = chunk.createAircraft3dLayer({ ...options, createRenderer: renderer,
          ...(hoisted.createCanvas ? { createCanvas: hoisted.createCanvas } : {}) });
        hoisted.layers.push({ layer, options });
        return layer;
      },
    }))),
  };
});

const fake = sharedFakeMapLibre();
// A canvas whose 2D context draws nothing (jsdom has none): the atlas of the animated traffic (PR M2) is built on it.
function fakeCanvas(width, height) {
  const context = new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return { width, height, getContext: type => (type === '2d' ? context : null) };
}
const PAGE = '/admin-occ/console?stationId=s-1';
const LAYER_ID = 'occ-aircraft-3d';

function noonTraffic() {
  const picture = toPictureModel(createAirPicture());
  const situation = buildSituation({ picture, flights: toFlightsModel(createMapFlights()), nowMs: Date.parse(TRAFFIC_NOON),
    estimates: createEstimates() });
  // The picture's aircraft are all far from the field or other traffic on the ground (2D only): two more are close in,
  // an AVIAM arrival taxiing on the apron and another aircraft on short final at 300 m.
  const arrival = situation.aircraft.find(item => item.kind === 'aviam');
  const overflight = situation.aircraft.find(item => item.kind === 'other' && item.onGround !== true);
  const [taxiLng, taxiLat] = destinationPoint(PUJ_ARP, 200, 500);
  const [finalLng, finalLat] = destinationPoint(PUJ_ARP, 260, 4_000);
  const near = [
    { ...arrival, id: 'f:near-1', flightKey: 'near-1', lon: taxiLng, lat: taxiLat, onGround: true, altM: 0, gsMs: 7,
      trackDeg: 80, typeIcao: 'A320', quality: 'live' },
    { ...overflight, id: 'h:abc123', hex: 'abc123', lon: finalLng, lat: finalLat, onGround: false, altM: 300, trackDeg: 80,
      typeIcao: 'B738' },
  ];
  return { aircraft: [...situation.aircraft, ...near], trails: null, route: null, source: TRAFFIC_SOURCE };
}

const loadStyle = map => act(() => fake.state.emit(map, 'style.load'));
// The chunk resolves on a microtask; the layer is added once the style is there.
const settle = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});
const press = (target, key) => {
  const event = createEvent.keyDown(target, { key });
  fireEvent(target, event);
  return event;
};
const trafficProperties = map => {
  const byId = new Map();
  for (const call of map.getSource('occ-traffic').updateDataCalls) {
    for (const feature of call.add ?? []) byId.set(feature.properties.id, { ...feature.properties });
    for (const change of call.update ?? []) {
      const properties = byId.get(change.id);
      for (const { key, value } of change.addOrUpdateProperties ?? []) properties[key] = value;
    }
  }
  return byId;
};
const plannedIds = () => {
  const { plan } = hoisted.layers.at(-1).options.getInstances();
  return [...plan.values()].flatMap(entry => entry.ids.filter(id => id !== null)).sort();
};

function renderConsole(props = {}) {
  const ref = createRef();
  const view = render(
    <OccMap ref={ref} defaultView="ramp" traffic={noonTraffic()} mapOptions={{ fadeDuration: 0 }} {...props}>
      <MapDock><MapPresetSwitcher /></MapDock>
    </OccMap>,
  );
  const map = fake.state.liveMaps().at(-1);
  return { ...view, ref, map, root: screen.getByTestId('occ-map') };
}

beforeEach(() => {
  fake.state.reset();
  hoisted.layers.length = 0;
  hoisted.renderers.length = 0;
  hoisted.failRenderer = false;
  hoisted.failLoad = false;
  hoisted.createCanvas = null;
  window.localStorage.clear();
  window.history.replaceState({}, '', PAGE);
  // A browser that draws WebGL2 (jsdom does not): the 3D is on by default there.
  vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {});
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OccMap 3D aircraft (PR M7)', () => {
  it('opens in 3D in Rampa by default, D and the dock switch it, and the choice is remembered', async () => {
    const { map, root, unmount } = renderConsole();
    loadStyle(map);
    // Contracts 2.3: pitch 55 and bearing −17 in Rampa.
    expect(map.getPitch()).toBe(55);
    expect(map.getBearing()).toBe(-17);
    const toggle = screen.getByRole('button', { name: '3D' });
    expect(toggle).toHaveAttribute('data-testid', 'map-3d-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('aria-keyshortcuts', 'D');
    expect(press(root, 'd').defaultPrevented).toBe(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem(MODE_3D_STORAGE_KEY)).toBe('2d');
    expect(root).toHaveAttribute('data-occ-3d', 'off');
    unmount();

    // Another visit opens in 2D, as left; the dock's 3D button brings it back.
    const again = renderConsole();
    loadStyle(again.map);
    expect(again.map.getPitch()).toBe(0);
    act(() => screen.getByRole('button', { name: '3D' }).click());
    expect(window.localStorage.getItem(MODE_3D_STORAGE_KEY)).toBe('3d');
    // Aeródromo tilts to 40.
    act(() => press(again.root, '3'));
    expect(again.map.getPitch()).toBe(40);
  });

  it('a page that sets the mode keeps it: no control without onPitchModeChange, its callback with one', () => {
    const { root } = renderConsole({ pitchMode: '2d' });
    expect(screen.queryByTestId('map-3d-toggle')).toBeNull();
    expect(press(root, 'd').defaultPrevented).toBe(false);
    cleanup();
    const change = vi.fn();
    const controlled = renderConsole({ pitchMode: '2d', onPitchModeChange: change });
    press(controlled.root, 'd');
    expect(change).toHaveBeenCalledWith('3d');
    expect(window.localStorage.getItem(MODE_3D_STORAGE_KEY)).toBeNull();
  });

  it('loads the layer at the 3D threshold into the models slot, fed by the same writes as the 2D, which give way', async () => {
    const { map, root, ref } = renderConsole();
    loadStyle(map);
    await settle();
    const ids = map.layerIds();
    expect(ids).toContain(LAYER_ID);
    expect(ids.indexOf(LAYER_ID)).toBeGreaterThan(ids.indexOf('slot-models'));
    expect(ids.indexOf(LAYER_ID)).toBeLessThan(ids.indexOf('slot-standLabels'));
    expect(root).toHaveAttribute('data-occ-3d', 'ready');
    expect(hoisted.renderers).toHaveLength(1);
    // The layer's plan holds the aircraft near the airfield the write drew; exactly those leave their 2D silhouette.
    // A write after the layer arrived carries the flags.
    act(() => map.jumpTo({ zoom: map.getZoom() + 0.01 }));
    const planned = plannedIds();
    expect(planned).toEqual(['f:near-1', 'h:abc123']);
    const properties = trafficProperties(map);
    for (const [id, feature] of properties) expect(feature.model3d, id).toBe(planned.includes(id));
    // Its origin is the ARP and its light the sun at the traffic's instant.
    expect(hoisted.layers[0].options.originLngLat).toEqual([-68.36345, 18.56732].map(value => expect.closeTo(value, 2)));
    expect(ref.current.aircraft3d()).toMatchObject({ enabled: true, status: 'ready', stats: { failed: false } });

    // Out to the approach: below the threshold the plan is empty and every 2D silhouette is back.
    act(() => ref.current.jumpTo({ zoom: 11 }));
    expect(plannedIds()).toEqual([]);
    expect([...trafficProperties(map).values()].some(feature => feature.model3d)).toBe(false);
  });

  it('a 3D pick comes first and is translated to the map selection; nothing under it falls back to the 2D pick', async () => {
    const onSelect = vi.fn();
    const { map } = renderConsole({ onSelect });
    loadStyle(map);
    await settle();
    const layer = map.layers.find(item => item.id === LAYER_ID);
    const flightKey = 'p:5b000000-0000-4000-8000-000000000161';
    vi.spyOn(layer, 'pick').mockReturnValue({ kind: 'aircraft', id: `f:${flightKey}` });
    fake.state.setRenderedFeatures(map, () => []);
    fake.state.emit(map, 'click', { point: { x: 300, y: 200 }, lngLat: { lng: -68.36, lat: 18.56 } });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'flight', id: flightKey });
    layer.pick.mockReturnValue({ kind: 'aircraft', id: 'h:abc123' });
    fake.state.emit(map, 'click', { point: { x: 300, y: 200 }, lngLat: { lng: -68.36, lat: 18.56 } });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'aircraft', id: 'abc123' });
    layer.pick.mockReturnValue({ kind: 'aircraft', id: 's:A6' });
    fake.state.emit(map, 'click', { point: { x: 300, y: 200 }, lngLat: { lng: -68.36, lat: 18.56 } });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'stand', id: 'A6' });
    // Nothing in 3D under the pointer: the 2D pick (a stand polygon here) stands.
    layer.pick.mockReturnValue(null);
    const stand = { layer: { id: 'occ-stands-fill' }, id: 'B1', properties: { code: 'B1' } };
    fake.state.setRenderedFeatures(map, () => [stand]);
    fake.state.emit(map, 'click', { point: { x: 300, y: 200 }, lngLat: { lng: -68.36, lat: 18.56 } });
    expect(layer.pick).toHaveBeenCalledTimes(4);
  });

  it('falls back to 2D with its notice when the layer cannot draw or the chunk fails', async () => {
    hoisted.failRenderer = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { map, root } = renderConsole();
    loadStyle(map);
    await settle();
    expect(root).toHaveAttribute('data-occ-3d', 'failed');
    expect(screen.getByRole('status')).toHaveTextContent('No pudimos mostrar los aviones en 3D; los mostramos en 2D.');
    act(() => map.jumpTo({ zoom: map.getZoom() + 0.01 }));
    expect([...trafficProperties(map).values()].some(feature => feature.model3d)).toBe(false);
    expect(warn).toHaveBeenCalled();
    cleanup();

    hoisted.failRenderer = false;
    hoisted.failLoad = true;
    const failed = renderConsole();
    loadStyle(failed.map);
    await settle();
    expect(failed.root).toHaveAttribute('data-occ-3d', 'failed');
    expect(failed.map.layerIds()).not.toContain(LAYER_ID);
  });

  it('a lost context removes the layer as MapLibre 6.16 does and the restored style adds it again on a new renderer', async () => {
    const { map, root } = renderConsole();
    loadStyle(map);
    await settle();
    const first = hoisted.renderers[0];
    act(() => fake.state.loseContext(map));
    expect(first.dispose).toHaveBeenCalled();
    act(() => fake.state.restoreContext(map));
    loadStyle(map);
    expect(map.layerIds()).toContain(LAYER_ID);
    expect(hoisted.renderers).toHaveLength(2);
    expect(root).toHaveAttribute('data-occ-3d', 'ready');
  });

  it('the governor\'s pause says so and «Volver a 3D» brings it back', async () => {
    const { map, ref, root } = renderConsole();
    loadStyle(map);
    await settle();
    act(() => ref.current.aircraft3d().pause());
    expect(root).toHaveAttribute('data-occ-3d', 'paused');
    expect(map.layerIds()).not.toContain(LAYER_ID);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Pausamos la vista 3D para que el mapa siga fluido.');
    act(() => within(notice).getByRole('button', { name: 'Volver a 3D' }).click());
    expect(root).toHaveAttribute('data-occ-3d', 'ready');
    expect(map.layerIds()).toContain(LAYER_ID);
  });

  it('survives the theme change: the new map gets its own layer, in the theme\'s colours, and the old one is disposed', async () => {
    function ThemeButton() {
      const { toggleTheme } = useTheme();
      return <button type="button" onClick={toggleTheme}>tema</button>;
    }
    window.localStorage.setItem('elevant-theme', 'dark');
    render(<ThemeProvider><ThemeButton /><OccMap defaultView="ramp" traffic={noonTraffic()} /></ThemeProvider>);
    const dark = fake.state.liveMaps().at(-1);
    loadStyle(dark);
    await settle();
    expect(dark.layerIds()).toContain(LAYER_ID);
    act(() => screen.getByRole('button', { name: 'tema' }).click());
    const light = fake.state.liveMaps().at(-1);
    expect(light).not.toBe(dark);
    expect(hoisted.renderers[0].dispose).toHaveBeenCalled();
    loadStyle(light);
    await settle();
    expect(light.layerIds()).toContain(LAYER_ID);
    expect(hoisted.layers).toHaveLength(2);
    // Contracts 2.4: the chosen aircraft in the theme's cyan.
    act(() => light.jumpTo({ zoom: light.getZoom() + 0.01 }));
    const { plan } = hoisted.layers[1].options.getInstances();
    const colours = [...plan.values()].flatMap(entry => [...entry.colors]);
    const lightAviam = linearRgb(OCC_PALETTES.light['--occ-panel']);
    expect(colours.some((value, index) => index % 3 === 0 && Math.abs(value - lightAviam[0]) < 1e-6)).toBe(true);
  });
});

// PR M2: the traffic of a motion store, animated by the layer every frame from the keyframes of the writes.
describe('OccMap animated traffic (PR M2)', () => {
  const NOON = Date.parse(TRAFFIC_NOON);
  const DEMO_ID = `f:${TRAFFIC_FLIGHT_KEY.demoArrival}`;

  // The demo flight on final at noon and nothing else, on a render clock whose server time the test moves.
  function demoTraffic() {
    const server = { at: NOON, now() { return this.at; } };
    const clock = createRenderClock({ clock: server });
    const motion = createMotionStore({ clock });
    const block = createDemoBlock({ appearAt: NOON - 240_000 });
    const response = createDemoFlights(block);
    const flights = { ...response, flights: response.flights.filter(row => row.isDemo) };
    const picture = toPictureModel(createAirPicture({ status: 'Disabled' }));
    const flightsModel = toFlightsModel(flights);
    motion.ingest({ picture, flights: flightsModel });
    const situation = buildSituation({ picture, flights: flightsModel, nowMs: NOON, estimates: motion.estimatesAt(NOON),
      estimatesChangeAt: motion.nextChangeAt(NOON) });
    return { server, traffic: { aircraft: situation.aircraft, trails: null, route: null, source: TRAFFIC_SOURCE, motion } };
  }

  // Animation frames the test runs by hand.
  function controlledFrames() {
    const frames = new Map();
    let next = 1;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
      const handle = next++;
      frames.set(handle, callback);
      return handle;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(handle => { frames.delete(handle); });
    return {
      pending: () => frames.size,
      run: () => {
        const due = [...frames.values()];
        frames.clear();
        act(() => due.forEach(callback => callback(0)));
        return due.length;
      },
    };
  }

  const repaints = map => map.calls.filter(call => call.method === 'triggerRepaint').length;
  const spriteXY = (sprites, id) => {
    const index = sprites.ids.indexOf(id);
    return index < 0 ? null : [sprites.matrices[16 * index + 12], sprites.matrices[16 * index + 13]];
  };
  const renderOnce = layer => layer.render({ drawingBufferWidth: 200, drawingBufferHeight: 100 },
    { defaultProjectionData: { mainMatrix: Float64Array.from({ length: 16 }, (_, index) => (index % 5 === 0 ? 1 : 0)) } });

  it('draws every aircraft in the layer between the writes, repaints only while one moves, and hides its icons', async () => {
    hoisted.createCanvas = fakeCanvas;
    vi.stubGlobal('Path2D', class Path2D {});
    window.localStorage.setItem(MODE_3D_STORAGE_KEY, '2d');
    const frames = controlledFrames();
    const { server, traffic } = demoTraffic();
    render(<OccMap defaultView="approach" traffic={traffic} mapOptions={{ fadeDuration: 0 }} />);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    await settle();
    // 2D, and the 3D chunk loaded for the animation: the layer is on the map.
    expect(map.layerIds()).toContain(LAYER_ID);
    server.at += 500;
    frames.run();
    const feature = trafficProperties(map).get(DEMO_ID);
    // Its icon, its dashed ring, its «Demo» plate and its tag are the layer's now (the GeoJSON ones are the fallback).
    expect(feature).toMatchObject({ model3d: true, animated: true, demo: true });
    const { getInstances } = hoisted.layers.at(-1).options;
    const first = getInstances();
    expect(first.plan.size).toBe(0);
    expect(spriteXY(first.sprites, DEMO_ID)).not.toBeNull();
    // The plate travels with it.
    expect([...first.sprites.ids].filter(id => id === null).length).toBeGreaterThan(0);
    // So does its tag: the layer anchors it where the frame draws the aircraft, with the words of the write.
    const tagOf = answer => answer.labels.tags.find(tag => tag.id === DEMO_ID) ?? null;
    expect(tagOf(first)?.tag).toMatchObject({ aviam: true, dir: 'arr' });
    expect(tagOf(first).x).toBeCloseTo(spriteXY(first.sprites, DEMO_ID)[0], 3);
    expect(tagOf(first).y).toBeCloseTo(spriteXY(first.sprites, DEMO_ID)[1], 3);

    // Every frame while it moves repaints the map once and draws it further along, without a write in between.
    const writes = map.getSource('occ-traffic').updateDataCalls.length;
    const before = repaints(map);
    server.at += 100;
    frames.run();
    const later = getInstances();
    expect(repaints(map)).toBe(before + 1);
    expect(map.getSource('occ-traffic').updateDataCalls).toHaveLength(writes);
    expect(later.revision).toBeGreaterThan(first.revision);
    expect(spriteXY(later.sprites, DEMO_ID)).not.toEqual(spriteXY(first.sprites, DEMO_ID));
    expect(tagOf(later).x).toBeCloseTo(spriteXY(later.sprites, DEMO_ID)[0], 3);
    expect(Math.hypot(tagOf(later).x - tagOf(first).x, tagOf(later).y - tagOf(first).y)).toBeGreaterThan(1);
    renderOnce(hoisted.layers.at(-1).layer);
    expect(map.layers.find(item => item.id === LAYER_ID).stats()).toMatchObject({ sprites: first.sprites.count });

    // An hour later it waits at its apron hold: the frames stop and the map rests.
    server.at = NOON + 3_600_000;
    frames.run();
    frames.run();
    expect(frames.pending()).toBe(0);
    const resting = repaints(map);
    expect(getInstances()).toBe(getInstances());
    expect(repaints(map)).toBe(resting);
  });

  it('writes the GeoJSON at most twice a second while the layer animates the traffic; the keyframes carry the rest', async () => {
    hoisted.createCanvas = fakeCanvas;
    vi.stubGlobal('Path2D', class Path2D {});
    window.localStorage.setItem(MODE_3D_STORAGE_KEY, '2d');
    // Two seconds of 16 ms frames at zoom 16 on the demo flight on final: some 30 px a second, 15 writes a second
    // without the animation (CN-18).
    const writesIn2s = async options => {
      const frames = controlledFrames();
      const { server, traffic } = demoTraffic();
      const ref = createRef();
      const view = render(<OccMap ref={ref} defaultView="approach" traffic={traffic} mapOptions={{ fadeDuration: 0 }}
        aircraft3d={options} />);
      const map = fake.state.liveMaps().at(-1);
      loadStyle(map);
      await settle();
      server.at += 500;
      frames.run();
      const [lon, lat] = map.getSource('occ-traffic').data.features
        .find(feature => feature.properties.id === DEMO_ID).geometry.coordinates;
      act(() => { ref.current.jumpTo({ center: [lon, lat], zoom: 16 }); });
      frames.run();
      const source = map.getSource('occ-traffic');
      const before = source.updateDataCalls.length;
      const answers = [];
      for (let frame = 0; frame < 125; frame += 1) {
        server.at += 16;
        frames.run();
        if (options === null) answers.push(spriteXY(hoisted.layers.at(-1).options.getInstances().sprites, DEMO_ID));
      }
      const written = source.updateDataCalls.length - before;
      view.unmount();
      vi.restoreAllMocks();
      return { written, answers };
    };
    const animated = await writesIn2s(null);
    expect(animated.written).toBeGreaterThanOrEqual(3);
    expect(animated.written).toBeLessThanOrEqual(5);
    // Between the writes every frame draws the aircraft further along (the keyframes of the last write).
    const steps = animated.answers.slice(1).map((xy, index) => Math.hypot(xy[0] - animated.answers[index][0],
      xy[1] - animated.answers[index][1]));
    expect(steps.every(step => step > 0)).toBe(true);
    vi.stubGlobal('Path2D', class Path2D {});
    const icons = await writesIn2s({ animate: false });
    expect(icons.written).toBeGreaterThanOrEqual(20);
  });

  it('reads what the map draws when it settles at most once a second while the traffic moves, the last one after', async () => {
    hoisted.createCanvas = fakeCanvas;
    vi.stubGlobal('Path2D', class Path2D {});
    const frames = controlledFrames();
    const { server, traffic } = demoTraffic();
    render(<OccMap defaultView="approach" traffic={traffic} mapOptions={{ fadeDuration: 0 }} />);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    await settle();
    server.at += 500;
    frames.run();
    const queries = () => map.calls.filter(call => call.method === 'queryRenderedFeatures').length;
    act(() => fake.state.emit(map, 'idle'));
    const once = queries();
    // MapLibre settles after each write while the traffic moves: those reads wait for their second.
    for (let index = 0; index < 5; index += 1) act(() => fake.state.emit(map, 'idle'));
    expect(queries()).toBe(once);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-settled', 'true');
    await act(() => new Promise(resolve => { setTimeout(resolve, 1_100); }));
    expect(queries()).toBeGreaterThan(once);
  });

  it('«Seguir en 3D» poses the camera on the animated aircraft every frame without a write every frame', async () => {
    hoisted.createCanvas = fakeCanvas;
    vi.stubGlobal('Path2D', class Path2D {});
    const frames = controlledFrames();
    const { server, traffic } = demoTraffic();
    function Start() {
      const { follow } = useOccMap();
      return <button type="button" onClick={() => follow.three.start()}>start</button>;
    }
    render(<OccMap defaultView="airfield" traffic={traffic} selection={{ kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoArrival }}
      mapOptions={{ fadeDuration: 0 }}><Start /></OccMap>);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    await settle();
    server.at += 16;
    frames.run();
    act(() => { screen.getByRole('button', { name: 'start' }).click(); });
    await settle();
    // The fly-in.
    for (let frame = 0; frame < 125; frame += 1) {
      server.at += 16;
      frames.run();
    }
    const controller = hoisted.layers.at(-1);
    expect(controller).toBeDefined();
    const source = map.getSource('occ-traffic');
    const writes = source.updateDataCalls.length;
    const centers = [];
    for (let frame = 0; frame < 62; frame += 1) {
      server.at += 16;
      frames.run();
      centers.push(map.getCenter().toArray());
    }
    // About a second: twice a second the traffic is written (it was every frame), and the camera moves every frame.
    expect(source.updateDataCalls.length - writes).toBeLessThanOrEqual(3);
    const moves = centers.slice(1).map((center, index) => Math.hypot(center[0] - centers[index][0],
      center[1] - centers[index][1]));
    expect(moves.every(move => move > 0)).toBe(true);
  });

  it('keeps the GeoJSON icons when the layer cannot build its sprites, and without motion', async () => {
    hoisted.createCanvas = () => null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.localStorage.setItem(MODE_3D_STORAGE_KEY, '2d');
    const frames = controlledFrames();
    const { server, traffic } = demoTraffic();
    render(<OccMap defaultView="approach" traffic={traffic} mapOptions={{ fadeDuration: 0 }} />);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    await settle();
    server.at += 500;
    frames.run();
    expect(trafficProperties(map).get(DEMO_ID)).toMatchObject({ animated: true });
    // The first frame cannot build the atlas: the layer goes and the next write gives the icons back.
    renderOnce(hoisted.layers.at(-1).layer);
    await settle();
    expect(warn).toHaveBeenCalled();
    expect(map.layerIds()).not.toContain(LAYER_ID);
    expect(trafficProperties(map).get(DEMO_ID)).toMatchObject({ model3d: false, animated: false });
    cleanup();

    // Traffic without motion has no frame loop: nothing to animate, the 2D map loads no 3D.
    const still = renderConsole();
    loadStyle(still.map);
    await settle();
    expect(still.map.layerIds()).not.toContain(LAYER_ID);
  });
});
