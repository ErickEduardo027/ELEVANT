import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { standPoint } from '../testing/mapFixtures';
import MapLab, { MAP_LAB_MARKER } from './MapLab';
import { SCENES, findScene } from './scenes';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const NOON = '2026-11-13T15:00:00Z';
const query = () => new URLSearchParams(window.location.search);

function open(search, { strict = false } = {}) {
  window.history.replaceState({}, '', `/map-lab${search}`);
  const view = render(strict ? <StrictMode><MapLab /></StrictMode> : <MapLab />);
  return { ...view, map: fake.state.liveMaps().at(-1) ?? null };
}

const loadStyle = map => act(() => fake.state.emit(map, 'style.load'));
const fnCalls = name => fake.state.calls.filter(call => call.fn === name);

beforeEach(() => {
  fake.state.reset();
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describe('MapLab', () => {
  it('lists every scene when the URL names none, and says so for an unknown one', () => {
    open('');
    const root = document.querySelector(`[${MAP_LAB_MARKER}]`);
    expect(root).toHaveAttribute(MAP_LAB_MARKER, 'v1');
    expect(root).toHaveAttribute('data-department', 'occ');
    expect(root).toHaveClass('bg-occ-canvas');
    // The theme is the document's (ThemeProvider, as in the OCC), not a class of its own.
    expect(root).not.toHaveClass('dark');
    expect(screen.getByRole('heading', { level: 1, name: 'Laboratorio de mapas' })).toBeInTheDocument();
    const links = within(screen.getByRole('list', { name: 'Escenas' })).getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual(SCENES.map(scene => `/map-lab?scene=${scene.id}`));
    expect(links[0]).toHaveTextContent(SCENES[0].title);
    expect(fake.state.maps).toEqual([]);
    cleanup();

    open('?scene=nope');
    expect(screen.getByRole('status')).toHaveTextContent('No existe la escena «nope». Elige una de la lista.');
    expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(SCENES.length);
  });

  it('mounts the map with the scene, its title and the test-data notice, and freezes the map clock with t=', () => {
    const { map, unmount } = open(`?scene=ramp-states&t=${NOON}`);
    expect(screen.getByRole('heading', { level: 1, name: 'Rampa: posiciones y estados' })).toBeInTheDocument();
    expect(screen.getByText('Datos de prueba, no oficiales')).toBeInTheDocument();
    expect(screen.getByText('Reloj fijo: 2026-11-13 15:00 UTC')).toBeInTheDocument();
    // The clock is frozen before the map starts, and the map starts without symbol fades.
    const order = fake.state.calls.map(call => call.fn);
    expect(order.indexOf('setNow')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('setNow')).toBeLessThan(order.indexOf('Map'));
    expect(fnCalls('setNow')[0].args).toEqual([Date.parse(NOON)]);
    expect(map.options.fadeDuration).toBe(0);
    expect(map.options.style.sources).toHaveProperty('openmaptiles');
    expect(screen.getByTestId('map-lab-map').querySelector('.maplibregl-canvas')).not.toBeNull();

    loadStyle(map);
    // The 41 stands as polygons, read at the frozen instant: the seven states of the scene.
    const polygons = map.getSource('occ-stands').data.features;
    expect(polygons).toHaveLength(41);
    expect(new Set(polygons.map(feature => feature.properties.state))).toEqual(new Set(STAND_STATE_KEYS));
    expect(polygons.find(feature => feature.id === 'A3').properties.state).toBe('arriving');
    // The countdowns too: A3's flight is due ten minutes after noon.
    expect(map.getSource('occ-stand-labels').data.features.find(feature => feature.id === 'A3').properties.label3)
      .toBe('A3\nDM203\nLlega 11:10 · en 10 min\nSin agente que la cubra');
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'ramp');
    expect(screen.getByRole('group', { name: 'Vista del mapa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leyenda' })).toBeInTheDocument();

    unmount();
    expect(fnCalls('restoreNow')).toHaveLength(1);
    expect(fake.state.liveMaps()).toEqual([]);
  });

  it('draws without the vector tiles with basemap=none and keeps the clock running without t=', () => {
    const { map } = open('?scene=airfield&basemap=none');
    expect(map.options.style.sources).not.toHaveProperty('openmaptiles');
    expect(map.options.fadeDuration).toBe(150);
    expect(fnCalls('setNow')).toEqual([]);
    expect(screen.getByText('Sin mapa base')).toBeInTheDocument();
    loadStyle(map);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'airfield');
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-basemap', 'off');
  });

  it('writes the scene selection to the URL once and follows the URL after that', () => {
    const { map } = open('?scene=ramp-selected&stationId=s-1');
    expect(query().get('stand')).toBe('A5');
    expect(query().get('stationId')).toBe('s-1');
    loadStyle(map);
    expect(map.getSource('occ-selection').data.features[0].properties).toMatchObject({ kind: 'stand', id: 'A5', label1: 'A5' });
    expect(map.featureStateOf('occ-stands', 'A5')).toEqual({ selected: true });
    // Esc clears it, and the scene does not select it again.
    fireEvent.keyDown(map.getCanvas(), { key: 'Escape' });
    expect(query().has('stand')).toBe(false);
    expect(map.getSource('occ-selection').data.features).toEqual([]);
    // A stand clicked on the map is the selection.
    fake.state.setRenderedFeatures(map, () => [{ layer: { id: 'occ-stands-fill' }, properties: { code: 'B21' } }]);
    act(() => fake.state.emit(map, 'click', { point: { x: 10, y: 10 }, lngLat: { lng: -68.369, lat: 18.563 } }));
    expect(query().get('stand')).toBe('B21');
  });

  it('places the stand of the placing scene: its pending box, a click moves it and Esc stops the placing first', () => {
    const scene = findScene('ramp-placing-ghost');
    const { map } = open(`?scene=ramp-placing-ghost&t=${NOON}`);
    loadStyle(map);
    // The stand is selected while it is placed, and the header says what to do.
    expect(query().get('stand')).toBe(scene.placing.code);
    expect(screen.getByText(`Ubicando ${scene.placing.code}: haz clic en el mapa; Esc lo deja`)).toBeInTheDocument();
    expect(map.getCanvas().style.cursor).toBe('crosshair');
    const boxes = map.getSource('occ-stand-ghost');
    expect(boxes.data.features.map(feature => feature.id)).toEqual(['pending', 'pending-centre']);
    expect(boxes.data.features[1].geometry.coordinates).toEqual([scene.placing.pending.longitude, scene.placing.pending.latitude]);
    expect(window.__occMapLab.placing()).toEqual(scene.placing);

    // A click at the stand's reference point (its centre in the layout) snaps the pending location there.
    const [longitude, latitude] = standPoint(scene.placing.code);
    act(() => fake.state.emit(map, 'click', { point: { x: 10, y: 10 }, lngLat: { lng: longitude, lat: latitude } }));
    expect(window.__occMapLab.placing().pending).toEqual({ latitude, longitude, snapped: true });
    expect(boxes.data.features[0].properties).toMatchObject({ kind: 'pending', snapped: true });

    // Esc stops the placing and keeps the selection; the next one clears it.
    fireEvent.keyDown(map.getCanvas(), { key: 'Escape' });
    expect(window.__occMapLab.placing()).toBeNull();
    expect(boxes.data.features).toEqual([]);
    expect(map.getCanvas().style.cursor).toBe('');
    expect(query().get('stand')).toBe(scene.placing.code);
    fireEvent.keyDown(map.getCanvas(), { key: 'Escape' });
    expect(query().has('stand')).toBe(false);
  });

  it('re-reads the same stands without a new map or a new write, and exposes the lab handle', async () => {
    const { map, unmount } = open('?scene=ramp-states', { strict: true });
    loadStyle(map);
    expect(fake.state.liveMaps()).toEqual([map]);
    const source = map.getSource('occ-stands');
    expect(source.setDataCalls).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Releer posiciones' }));
    act(() => window.__occMapLab.refresh());
    expect(fake.state.liveMaps()).toEqual([map]);
    expect(source.setDataCalls).toHaveLength(1);
    expect(source.updateDataCalls).toEqual([]);
    // Without t= the stands read at the scene's own instant, which the header says.
    expect(screen.getByText('Hora de la escena: 2026-11-13 15:00 UTC')).toBeInTheDocument();
    expect(source.data.features.find(feature => feature.id === 'A3').properties.state).toBe('arriving');

    const lab = window.__occMapLab;
    expect(lab.scene).toBe('ramp-states');
    expect(lab.liveMaps()).toBe(1);
    expect(lab.getCamera()).toMatchObject({ zoom: map.getZoom() });
    act(() => lab.flyToPreset('ramp', { terminal: 'FBO' }));
    act(() => map.jumpTo({ center: standPoint('BN6') }));
    expect(lab.project(standPoint('BN6'))).toEqual({ x: 720, y: 450 });
    // A stand of the scene by its code; an unknown code has no pixel.
    expect(lab.project('BN6')).toEqual({ x: 720, y: 450 });
    expect(lab.project('Z9')).toBeNull();
    const idle = lab.whenIdle();
    act(() => fake.state.emit(map, 'idle'));
    await expect(idle).resolves.toBe(true);

    unmount();
    expect(window.__occMapLab).toBeUndefined();
  });

  it('refuses WebGL while the fallback scene is open and gives it back after', () => {
    const original = HTMLCanvasElement.prototype.getContext;
    const spy = vi.fn(() => 'context-2d');
    HTMLCanvasElement.prototype.getContext = spy;
    try {
      const { unmount } = open('?scene=unavailable-fallback');
      const patched = HTMLCanvasElement.prototype.getContext;
      expect(patched).not.toBe(spy);
      const canvas = document.createElement('canvas');
      for (const type of ['webgl2', 'webgl', 'experimental-webgl']) expect(canvas.getContext(type)).toBeNull();
      expect(canvas.getContext('2d', { willReadFrequently: true })).toBe('context-2d');
      expect(spy).toHaveBeenCalledExactlyOnceWith('2d', { willReadFrequently: true });
      unmount();
      expect(HTMLCanvasElement.prototype.getContext).toBe(spy);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });

  it('cuts every base-map request of the degraded scene through a protocol of its own', async () => {
    const { map, unmount } = open('?scene=basemap-degraded');
    expect(fnCalls('addProtocol')[0].args).toEqual(['occ-lab-cut']);
    const { transformRequest } = map.options;
    expect(transformRequest('https://tiles.openfreemap.org/planet', 'Source')).toEqual({ url: 'occ-lab-cut://basemap' });
    expect(transformRequest('https://tiles.openfreemap.org/planet/20261101_001001_pt/14/4968/7226.pbf', 'Tile'))
      .toEqual({ url: 'occ-lab-cut://basemap' });
    // Glyphs and everything else are left as they are.
    expect(transformRequest('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Bold/0-255.pbf', 'Glyphs')).toBeUndefined();
    await expect(fake.state.protocols.get('occ-lab-cut')({ url: 'occ-lab-cut://basemap' })).rejects.toThrow();

    loadStyle(map);
    act(() => fake.state.emit(map, 'error', { sourceId: 'openmaptiles', error: new Error('The map lab cut the base map.') }));
    expect(screen.getByRole('status')).toHaveTextContent('No se pudo cargar el mapa base.');
    unmount();
    expect(fnCalls('removeProtocol')[0].args).toEqual(['occ-lab-cut']);
    expect(fake.state.protocols.size).toBe(0);
  });

  it('mounts the review screen of the airport layout for the layout-qa scene', () => {
    const { map } = open(`?scene=layout-qa&t=${NOON}`, { strict: true });
    expect(screen.getByRole('heading', { level: 1, name: 'Revisión del plano de MDPC' })).toBeInTheDocument();
    expect(screen.getByText('Reloj fijo: 2026-11-13 15:00 UTC')).toBeInTheDocument();
    expect(fnCalls('setNow')[0].args).toEqual([Date.parse(NOON)]);
    // A screen of its own: the review overlay and its side list, no stand points and no re-read of positions.
    expect(map.options.style.sources).toHaveProperty('occ-lab-qa');
    expect(map.options.style.sources).not.toHaveProperty('occ-stands');
    expect(screen.queryByRole('button', { name: 'Releer posiciones' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Revisión del plano' })).toBeInTheDocument();
    loadStyle(map);
    expect(fake.state.liveMaps()).toEqual([map]);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'airfield');
    expect(window.__occMapLab.scene).toBe('layout-qa');
    expect(window.__occMapLab.qaFlagged().length).toBeGreaterThan(0);
  });

  it('draws the synthetic traffic of a traffic scene once, with its credit and its state, and exposes where it is', () => {
    const { map } = open(`?scene=approach-traffic-estimated-stale&t=${NOON}`);
    expect(map.options.style.sources['occ-traffic']).toMatchObject({ type: 'geojson', promoteId: 'id' });
    loadStyle(map);
    const source = map.getSource('occ-traffic');
    expect(source.updateDataCalls).toHaveLength(1);
    expect(source.updateDataCalls[0].add.length).toBeGreaterThan(3);
    // The picture is more than a minute late: the chip says so, and the credit of its (invented) source is a link.
    const status = screen.getByTestId('map-source-status');
    expect(within(status).getByRole('status')).toHaveTextContent('Tráfico con retraso: último dato hace 1 min.');
    expect(within(status).getByRole('link', { name: 'Red ADS-B de prueba' })).toHaveAttribute('href', 'https://example.org/adsb');
    // The handle answers where an aircraft is drawn, and nothing for one the map does not draw.
    const [first] = source.updateDataCalls[0].add;
    expect(window.__occMapLab.aircraftAt(first.properties.id)).toEqual(first.geometry.coordinates);
    expect(window.__occMapLab.aircraftAt('h:000000')).toBeNull();
    cleanup();

    // A scene without traffic has no traffic layers.
    const plain = open(`?scene=ramp-states&t=${NOON}`);
    expect(plain.map.options.style.sources['occ-traffic']).toBeUndefined();
    expect(screen.queryByTestId('map-source-status')).not.toBeInTheDocument();
  });

  it('shows the data block of the scene\'s selection and its layers menu, on the lab\'s frozen clock', () => {
    open(`?scene=region-traffic-selected&t=${NOON}`);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    // The scene chose ZZ161: its key is in the URL, its block docked, its age frozen with the clock.
    expect(query().get('flightId')).toMatch(/^p:/);
    const block = screen.getByRole('dialog', { name: 'Vuelo ZZ161' });
    expect(block.querySelector('[data-source-line]')).toHaveTextContent('En vivo · hace 4 s');
    // Its route (PR M6): observed, estimated from Miami, still to fly to A5 with its three marks.
    expect(map.getSource('occ-route').data.features.map(feature => feature.properties.part))
      .toEqual(['flownObserved', 'flownEstimated', 'remaining', 'mark', 'mark', 'mark']);
    // «Seguir» in the block and in the dock: one switch, off.
    expect(within(block).getByRole('button', { name: 'Seguir' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(screen.getByTestId('map-preset-switcher').parentElement).getByRole('button', { name: 'Seguir' }))
      .toBeEnabled();
    expect(within(screen.getByTestId('map-layers-menu')).getByRole('button', { name: 'Capas' }))
      .toHaveAttribute('aria-expanded', 'false');
    // «Cerrar» clears the selection, and with it the block and the route.
    fireEvent.click(within(block).getByRole('button', { name: 'Cerrar' }));
    expect(query().get('flightId')).toBeNull();
    expect(screen.queryByTestId('flight-data-block')).not.toBeInTheDocument();
    expect(map.getSource('occ-route').data.features).toEqual([]);
    cleanup();

    // The layers-menu scene opens with its menu open; a scene without traffic offers only the references (PR M8).
    open(`?scene=region-layers-menu&t=${NOON}`);
    loadStyle(fake.state.liveMaps().at(-1));
    expect(within(screen.getByTestId('map-layers-menu')).getByRole('button', { name: 'Capas' }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Tráfico' })).toBeInTheDocument();
    // The region's airports under «Referencias», on in the Región view.
    expect(within(screen.getByRole('group', { name: 'Referencias' })).getByRole('checkbox', { name: 'Aeropuertos de la región' }))
      .toBeChecked();
    cleanup();
    open(`?scene=ramp-states&t=${NOON}`);
    loadStyle(fake.state.liveMaps().at(-1));
    fireEvent.click(within(screen.getByTestId('map-layers-menu')).getByRole('button', { name: 'Capas' }));
    expect(screen.getByRole('group', { name: 'Referencias' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tráfico' })).not.toBeInTheDocument();
  });

  it('draws the weather of a weather scene with its own layers and a simulated GIBS, and only there', async () => {
    window.localStorage.clear();
    // The region with both satellite images on: the scene's layers, its images pinned to their simulated times.
    open(`?scene=region-satellite&t=${NOON}`);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    await act(() => new Promise(resolve => { setTimeout(resolve, 0); }));
    expect(map.getSource('occ-weather-goes').setTilesCalls).toEqual([[expect.stringContaining('/default/2026-11-13T14:50:00Z/')]]);
    expect(map.getSource('occ-weather-imerg').setTilesCalls).toEqual([[expect.stringContaining('/default/2026-11-13T14:30:00Z/')]]);
    expect(map.getLayer('occ-weather-goes-image').layout.visibility).toBe('visible');
    expect(map.getLayer('occ-weather-imerg-image').layout.visibility).toBe('visible');
    // The scene's layers are not the browser's: nothing is kept.
    expect(window.localStorage.getItem('elevant-occ-map-layers:v1')).toBeNull();
    cleanup();

    // The wind by the airfield, where the handle says it stands.
    open(`?scene=airfield-wind-live&t=${NOON}`);
    const airfield = fake.state.liveMaps().at(-1);
    loadStyle(airfield);
    const [wind] = airfield.getSource('occ-weather-wind').data.features;
    expect(wind.properties.label).toBe('100° 13 kt R08');
    expect(window.__occMapLab.windAt()).toEqual(wind.geometry.coordinates);
    // A scene the person turns the satellite on in reads only the simulated GIBS, which names no image here.
    fireEvent.click(within(screen.getByTestId('map-layers-menu')).getByRole('button', { name: 'Capas' }));
    expect(screen.getByRole('group', { name: 'Meteorología' })).toBeInTheDocument();
    cleanup();

    // A scene without weather draws none: no weather sources, no Meteorología group, no wind for the handle.
    open(`?scene=ramp-states&t=${NOON}`);
    const ramp = fake.state.liveMaps().at(-1);
    loadStyle(ramp);
    expect(ramp.options.style.sources['occ-weather-wind']).toBeUndefined();
    expect(window.__occMapLab.windAt()).toBeNull();
    fireEvent.click(within(screen.getByTestId('map-layers-menu')).getByRole('button', { name: 'Capas' }));
    expect(screen.queryByRole('group', { name: 'Meteorología' })).not.toBeInTheDocument();
    window.localStorage.clear();
  });

  it('moves the demo flight as the app does: frozen at t=, its block from the motion, and «Pausar movimiento»', () => {
    const { map } = open(`?scene=ramp-demo-awaiting-stand&t=${NOON}`);
    loadStyle(map);
    // Nobody imported it: waiting at terminal B's apron hold, its block says so, and the map draws it there.
    const block = screen.getByRole('dialog', { name: 'Vuelo ZZ9001' });
    expect(block.querySelector('[data-status-line]')).toHaveTextContent('Esperando posición · sin importar');
    expect(block.querySelector('[data-source-line]'))
      .toHaveTextContent('Posición estimada: calculada con el horario, no con señal del avión.');
    const at = window.__occMapLab.aircraftAt('f:p:5b000000-0000-4000-8000-000000009001');
    expect(at).toEqual(map.getSource('occ-traffic').data.features
      .find(feature => feature.properties.id === 'f:p:5b000000-0000-4000-8000-000000009001').geometry.coordinates);
    // The frozen clock shows no pause; the button pauses and resumes, and the chip says the data's time.
    const button = screen.getByRole('button', { name: 'Pausar movimiento' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(within(screen.getByTestId('map-motion-control')).queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Reanudar movimiento' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByTestId('map-motion-control')).getByRole('status'))
      .toHaveTextContent('Movimiento en pausa · datos de las 11:00');
    fireEvent.click(screen.getByRole('button', { name: 'Reanudar movimiento' }));
    expect(screen.getByRole('button', { name: 'Pausar movimiento' })).toHaveAttribute('aria-pressed', 'false');
    cleanup();

    // The two-minute demo says its air part is compressed.
    open(`?scene=approach-demo-accelerated&t=${NOON}`);
    loadStyle(fake.state.liveMaps().at(-1));
    expect(screen.getByRole('dialog', { name: 'Vuelo ZZ9001' }).querySelector('[data-time-scale]'))
      .toHaveTextContent(/^Demo acelerada ×\d,\d$/u);
    cleanup();
    // A scene without traffic has nothing to pause.
    open(`?scene=ramp-states&t=${NOON}`);
    expect(screen.queryByTestId('map-motion-control')).not.toBeInTheDocument();
  });

  it('opens a follow scene following its flight, and the dock\'s «Seguir» or S stops and starts it (PR M6)', () => {
    const { map } = open(`?scene=approach-follow-final&t=${NOON}`);
    loadStyle(map);
    // The scene wrote its flight and follow=1; on the frozen clock the camera framed the aircraft once.
    expect(query().get('flightId')).toBe('p:5b000000-0000-4000-8000-000000009001');
    expect(query().get('follow')).toBe('1');
    const dockFollow = () => within(screen.getByTestId('map-preset-switcher').parentElement).getByRole('button',
      { name: 'Seguir' });
    expect(dockFollow()).toHaveAttribute('aria-pressed', 'true');
    const block = screen.getByRole('dialog', { name: 'Vuelo ZZ9001' });
    expect(within(block).getByRole('button', { name: 'Seguir' })).toHaveAttribute('aria-pressed', 'true');
    // The dock's button lets it go; S on the map follows again.
    fireEvent.click(dockFollow());
    expect(query().get('follow')).toBeNull();
    expect(dockFollow()).toHaveAttribute('aria-pressed', 'false');
    expect(within(block).getByRole('button', { name: 'Seguir' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(screen.getByTestId('occ-map'), { key: 's' });
    expect(query().get('follow')).toBe('1');
    expect(dockFollow()).toHaveAttribute('aria-pressed', 'true');
    cleanup();
    // A scene that does not follow opens without follow=1, and the route scenes choose their flight.
    open(`?scene=airfield-departure-route&t=${NOON}`);
    loadStyle(fake.state.liveMaps().at(-1));
    expect(query().get('follow')).toBeNull();
    expect(query().get('flightId')).toBe('p:5b000000-0000-4000-8000-000000009002');
    expect(fake.state.liveMaps().at(-1).getSource('occ-route').data.features.map(feature => feature.properties.part))
      .toEqual(['flownEstimated', 'remaining']);
  });

  it('uses only occ-* classes', async () => {
    const { readSource } = await import('../../../styles/occSourceScan');
    const { findLegacyColourClasses } = await import('../../../styles/occLegacyBridge');
    const files = [
      'src/features/maps/lab/MapLab.jsx', 'src/features/maps/lab/LayoutQaScene.jsx', 'src/features/maps/lab/labChrome.jsx',
      'app/map-lab/MapLabLoader.jsx',
    ];
    for (const file of files) {
      const source = readSource(file);
      expect(findLegacyColourClasses(source), file).toEqual([]);
      expect(source.match(/-occ-[a-z-]+\/(?:\d+|\[)/g), file).toBeNull();
      expect(source, file).not.toMatch(/backdrop|gradient|\bblur\b|\bshadow-(?!none\b)|(?<![\w-])ring-/);
    }
  });
});
