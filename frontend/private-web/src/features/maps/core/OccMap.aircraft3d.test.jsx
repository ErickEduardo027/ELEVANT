import { createRef } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { OCC_PALETTES } from '../../occ-ui/occPalette';
import { ThemeProvider, useTheme } from '../../shell/useTheme';
import { linearRgb } from '../aircraft/instancePlan';
import { destinationPoint } from '../airport/geo';
import { createAirPicture, createEstimates, createMapFlights, TRAFFIC_NOON, TRAFFIC_SOURCE } from '../testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import MapDock from '../ui/MapDock';
import MapPresetSwitcher from '../ui/MapPresetSwitcher';
import { MODE_3D_STORAGE_KEY } from './aircraft3d';
import { PUJ_ARP } from './cameraPresets';
import OccMap from './OccMap';

// The 3D aircraft wired into OccMap (PR M7), on the fake MapLibre and the real 3D layer with an injected renderer:
// three's scene and raycaster need no WebGL, its renderer does. The chunk is the real one, handed over by a mocked
// loader, so no test reaches the network or a GPU.
vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const hoisted = vi.hoisted(() => ({ layers: [], renderers: [], failRenderer: false, failLoad: false }));
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
        const layer = chunk.createAircraft3dLayer({ ...options, createRenderer: renderer });
        hoisted.layers.push({ layer, options });
        return layer;
      },
    }))),
  };
});

const fake = sharedFakeMapLibre();
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
