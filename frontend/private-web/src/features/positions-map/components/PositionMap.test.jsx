import { createRef } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { MDPC_LAYOUT } from '../../maps/airport/airportLayout';
import { presetTargets } from '../../maps/core/cameraPresets';
import { attachStandGeometry } from '../../maps/stands/standModel';
import { STAND_REFERENCE } from '../../maps/stands/standReference';
import { createMapStands, standPoint } from '../../maps/testing/mapFixtures';
import { createAerodromeWeather, WEATHER_NOON } from '../../maps/testing/weatherFixtures';
import { toWeatherReading } from '../../../services/weatherService';
import PositionMap from './PositionMap';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
// Synthetic states over the reference points: A1 occupied, A2 free and A3 planned (placed by OCC), B21 disabled and
// BN6 unverified, every other stand free at its reference location.
const STANDS = createMapStands();
const PAGE = '/admin-occ/positions-map?stationId=s-1';
const VIEWPORT_PX = 1440;
// The stands slot: the polygons with their fill, hatch, outlines, lines and casings.
const STAND_LAYERS = [
  'occ-stands-fill', 'occ-stands-hatch', 'occ-stands-outline-solid', 'occ-stands-outline-dash-4-3',
  'occ-stands-outline-dash-2-2', 'occ-stands-outline-dot-1-3', 'occ-stands-leadin', 'occ-stands-leadin-arriving',
  'occ-stands-combined-link', 'occ-stands-narrow-inner', 'occ-stands-selection', 'occ-stands-related', 'occ-stands-same-agent',
];
// The stands as the map draws them: the layout's polygons, moved where OCC placed a stand.
const DRAWN = attachStandGeometry(STANDS, MDPC_LAYOUT);

// The zoom at which the fake map fits the width of `bounds` into `width` pixels.
const fitWidth = (bounds, width = VIEWPORT_PX) => Math.log2((width * 360) / (512 * (bounds[1][0] - bounds[0][0])));
// The views the map frames: the polygons of the reference stands and the box of the MDPC airport layout (PR M3).
const REFERENCE_TARGETS = presetTargets({ stands: STAND_REFERENCE, layout: MDPC_LAYOUT });
const RAMP_FIT = fitWidth(REFERENCE_TARGETS.ramp.bounds);
const AIRFIELD_FIT = fitWidth(REFERENCE_TARGETS.airfield.bounds);

function renderPositions(props = {}, ref = createRef()) {
  const element = next => (
    <PositionMap ref={ref} positions={STANDS} selectedPositionId={null} onSelectPosition={() => {}} viewMode="2d" {...next} />
  );
  let current = props;
  const view = render(element(current));
  return {
    ...view,
    ref,
    map: fake.state.liveMaps().at(-1) ?? null,
    rerender: next => {
      current = { ...current, ...next };
      view.rerender(element(current));
    },
  };
}

const loadStyle = map => act(() => fake.state.emit(map, 'style.load'));
const standFeature = (code, state = 'available') => ({
  id: code, source: 'occ-stands', layer: { id: 'occ-stands-fill' }, properties: { code, state },
  geometry: { type: 'Polygon', coordinates: [DRAWN.find(stand => stand.id === code).geometry.polygon] },
});
const click = (map, features, lngLat = { lng: -68.36, lat: 18.564 }) => {
  fake.state.setRenderedFeatures(map, (_geometry, options) => features.filter(feature => options.layers.includes(feature.layer.id)));
  return act(async () => fake.state.emit(map, 'click', { point: { x: 200, y: 200 }, lngLat }));
};

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describe('PositionMap fallback', () => {
  it('offers selectable positions when WebGL or the map provider fails', async () => {
    fake.state.reset({ constructorError: new GPUInitializationError() });
    const user = userEvent.setup();
    const select = vi.fn();
    const { unmount } = render(<PositionMap positions={[{ id: 'A5', latitude: 18.5, longitude: -68.3 }]}
      selectedPositionId={null} onSelectPosition={select} theme="light" viewMode="2d" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('La cartografía no está disponible');
    await user.click(screen.getByRole('button', { name: 'A5' }));
    expect(select).toHaveBeenCalledWith('A5');
    // The view selector and the legend give way to the list.
    expect(screen.queryByTestId('map-preset-switcher')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leyenda' })).not.toBeInTheDocument();
    unmount();

    // A map that fails to start for any other reason falls back the same way, and the fault is traced.
    const trace = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.state.reset({ constructorError: new Error('The style could not be built') });
    render(<PositionMap positions={[{ id: 'A5', latitude: 18.5, longitude: -68.3 }]}
      selectedPositionId="A5" onSelectPosition={select} theme="light" viewMode="2d" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Puedes consultar y seleccionar las posiciones desde esta lista mientras se restablece el mapa base.');
    expect(within(alert).getByRole('button', { name: 'A5' })).toHaveAttribute('aria-pressed', 'true');
    expect(trace).toHaveBeenCalled();
  });
});

describe('PositionMap fallback in English', () => {
  afterEach(() => act(() => resetLanguageForTests('es')));

  it('explains the unavailable base map in English', async () => {
    fake.state.reset({ constructorError: new GPUInitializationError() });
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><PositionMap positions={[{ id: 'A5', latitude: 18.5, longitude: -68.3 }]}
      selectedPositionId={null} onSelectPosition={() => {}} theme="light" viewMode="2d" /></LanguageScope>);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Base map unavailable');
    expect(alert).toHaveTextContent('You can browse and select stands from this list while the base map is restored.');
    expect(within(alert).getByRole('group', { name: 'Stands on the map' })).toBeInTheDocument();
  });
});

describe('PositionMap on the map engine', () => {
  it('keeps the position-map-container test id with a .maplibregl-canvas inside', () => {
    const { map } = renderPositions();
    const host = screen.getByTestId('position-map-container');
    expect(host.querySelectorAll('.maplibregl-canvas')).toHaveLength(1);
    expect(host.contains(map.getCanvas())).toBe(true);
    expect(fake.state.liveMaps()).toEqual([map]);
  });

  it('opens on the ramp view fitted to the reference stands', () => {
    // Without a single position of its own the map still opens on the ramp of the reference catalogue.
    let view = renderPositions({ positions: [] });
    expect(view.map.getZoom()).toBeCloseTo(RAMP_FIT, 6);
    const [[west], [east]] = REFERENCE_TARGETS.ramp.bounds;
    expect(view.map.getCenter().lng).toBeCloseTo((west + east) / 2, 9);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'ramp');
    expect(within(screen.getByTestId('map-preset-switcher')).getByRole('button', { name: /Rampa/ }))
      .toHaveAttribute('aria-pressed', 'true');
    // The default view is not written in the URL.
    expect(window.location.search).toBe('?stationId=s-1');
    view.unmount();

    // The console's apron opens on the ramp too, tilted when its 3D is on, with its codes from the stand polygons on.
    view = renderPositions({ dashboardLabels: true, viewMode: '3d', allowBuildingExtrusion: true });
    expect(view.map.getZoom()).toBeCloseTo(RAMP_FIT, 6);
    expect([view.map.getPitch(), view.map.getBearing()]).toEqual([55, -17]);
    loadStyle(view.map);
    const codes = view.map.zoomRangeCalls.findLast(call => call.id === 'occ-stand-labels');
    expect(codes.minzoom).toBeCloseTo(AIRFIELD_FIT - 0.3, 6);
    expect(view.map.options.style.sources['occ-stands']).toEqual({
      type: 'geojson', promoteId: 'code', data: { type: 'FeatureCollection', features: [] },
    });
  });

  it('draws the stands as polygons with one setData per source, then only what changed, and never re-creates the map', () => {
    const { map, rerender } = renderPositions();
    loadStyle(map);
    const ids = map.layerIds();
    expect(ids.slice(ids.indexOf('slot-stands') + 1, ids.indexOf('slot-routes'))).toEqual(STAND_LAYERS);
    const source = map.getSource('occ-stands');
    expect(source.spec).toMatchObject({ type: 'geojson', promoteId: 'code' });
    expect(source.spec).not.toHaveProperty('cluster');
    expect(source.setDataCalls).toHaveLength(1);
    expect(source.data.features).toHaveLength(41);
    // A1, placed by OCC at its reference point: the layout's polygon moved rigidly onto it.
    expect(source.data.features.find(feature => feature.id === 'A1')).toEqual({
      type: 'Feature',
      id: 'A1',
      properties: { code: 'A1', terminal: 'A', state: 'occupied', unofficial: false },
      geometry: { type: 'Polygon', coordinates: [DRAWN.find(stand => stand.id === 'A1').geometry.polygon] },
    });
    // PUJ is marked by its reference point, the first of the references every map has (PR M8: the rings, centrelines,
    // airports and navaids around it, which the ramp view does not show).
    const [arp] = map.getSource('occ-reference').data.features;
    expect(arp.properties).toEqual({ kind: 'arp', label: 'PUJ' });

    // The same positions read again in new objects write nothing; a changed state is one update of that stand.
    rerender({ positions: createMapStands() });
    expect([source.setDataCalls.length, source.updateDataCalls.length]).toEqual([1, 0]);
    rerender({ positions: createMapStands({ A2: { status: 'planned' } }) });
    expect(source.setDataCalls).toHaveLength(1);
    expect(source.updateDataCalls.map(diff => diff.update.map(item => item.id))).toEqual([['A2']]);
    expect(source.updateDataCalls[0].update[0].addOrUpdateProperties).toContainEqual({ key: 'state', value: 'planned' });
    // A filter that leaves fewer stands removes the others.
    rerender({ positions: createMapStands().filter(stand => stand.terminal === 'B') });
    expect(source.updateDataCalls).toHaveLength(2);
    expect(source.updateDataCalls[1].remove).toEqual(expect.arrayContaining(['A1', 'BN6']));
    expect(source.updateDataCalls[1].remove).not.toContain('B21');
    expect(fake.state.maps).toEqual([map]);
    expect(map.calls.filter(call => call.method === 'setStyle')).toEqual([]);
  });

  it('a stand click selects it by its polygon; a terminal chip opens that terminal and selects nothing', async () => {
    const onSelectPosition = vi.fn();
    // A page id that the database padded: the map speaks of B21, the page gets its own id back.
    const positions = createMapStands().map(stand => (stand.id === 'B21' ? { ...stand, id: 'B021' } : stand));
    const { map, rerender } = renderPositions({ positions, onSelectPosition });
    loadStyle(map);
    await click(map, [standFeature('A5')]);
    expect(onSelectPosition).toHaveBeenCalledExactlyOnceWith('A5');
    await click(map, [standFeature('B21', 'disabled')]);
    expect(onSelectPosition).toHaveBeenLastCalledWith('B021');
    // The page's selected stand is cased through its polygon's feature state, under the map's code.
    rerender({ selectedPositionId: 'B021' });
    expect(map.featureStateOf('occ-stands', 'B21')).toEqual({ selected: true });

    // Below the stand polygons a chip stands for each terminal: a click opens that terminal's view.
    await click(map, [{ id: 'FBO', source: 'occ-stand-groups', layer: { id: 'occ-stand-groups' }, properties: { terminal: 'FBO', text: 'FBO · 0/8' } }]);
    const query = new URLSearchParams(window.location.search);
    expect([query.get('view'), query.get('terminal')]).toEqual(['ramp', 'FBO']);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'ramp');
    // A chip is not a stand: nothing more was selected.
    expect(onSelectPosition).toHaveBeenCalledTimes(2);
  });

  it('while placing, a map click reports the coordinates and the cursor is a crosshair', async () => {
    const onMapClick = vi.fn();
    const onSelectPosition = vi.fn();
    const { map, rerender } = renderPositions({ placing: true, onMapClick, onSelectPosition });
    loadStyle(map);
    expect(map.getCanvas().style.cursor).toBe('crosshair');
    await click(map, [standFeature('A5')], { lng: -68.3611, lat: 18.5649 });
    expect(onMapClick).toHaveBeenCalledExactlyOnceWith({ latitude: 18.5649, longitude: -68.3611 });
    expect(onSelectPosition).not.toHaveBeenCalled();

    rerender({ placing: false, onMapClick: undefined });
    expect(map.getCanvas().style.cursor).toBe('');
    await click(map, [standFeature('A5')]);
    expect(onMapClick).toHaveBeenCalledOnce();
    expect(onSelectPosition).toHaveBeenCalledExactlyOnceWith('A5');
  });

  it('keeps the imperative handle flyToPosition, flyToBounds, flyToAll, flyToPuj and resetNorth', () => {
    const { map, ref, rerender } = renderPositions();
    loadStyle(map);
    expect(Object.keys(ref.current).sort()).toEqual(['flyToAll', 'flyToBounds', 'flyToPosition', 'flyToPuj', 'resetNorth']);

    // A stand comes at least a step and a half past the ramp fit.
    act(() => ref.current.flyToPosition('A5'));
    expect(map.getCenter().toArray()).toEqual(standPoint('A5'));
    expect(map.getZoom()).toBeCloseTo(RAMP_FIT + 1.5, 6);

    // Bounds and «all» keep 70 px around what they frame, as before.
    act(() => ref.current.flyToBounds([standPoint('A1'), standPoint('A11')]));
    expect(map.getZoom()).toBeCloseTo(fitWidth([standPoint('A11'), standPoint('A1')], VIEWPORT_PX - 140), 6);
    const terminalB = createMapStands().filter(stand => stand.terminal === 'B');
    rerender({ positions: terminalB });
    act(() => ref.current.flyToAll());
    const lngs = terminalB.map(stand => stand.longitude);
    expect(map.getZoom()).toBeCloseTo(fitWidth([[Math.min(...lngs), 0], [Math.max(...lngs), 0]], VIEWPORT_PX - 140), 6);
    expect(map.getCenter().lng).toBeCloseTo((Math.min(...lngs) + Math.max(...lngs)) / 2, 9);

    act(() => ref.current.flyToPuj());
    expect(map.getZoom()).toBeCloseTo(AIRFIELD_FIT, 6);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'airfield');

    act(() => map.jumpTo({ bearing: -17 }));
    act(() => ref.current.resetNorth());
    expect(map.cameraCalls.at(-1)).toEqual({ method: 'easeTo', options: { bearing: 0, duration: 400, essential: false } });
    // The handle only flies: the URL keeps no view.
    expect(window.location.search).toBe('?stationId=s-1');
  });

  it('3D eases to pitch 55 and bearing −17 and shows buildings only when allowed', () => {
    const { map, rerender } = renderPositions();
    loadStyle(map);
    expect([map.getPitch(), map.getBearing()]).toEqual([0, 0]);
    rerender({ viewMode: '3d' });
    expect(map.cameraCalls.at(-1)).toEqual({ method: 'easeTo', options: { pitch: 55, bearing: -17, duration: 600, essential: false } });
    expect(map.getLayer('building-3d').layout.visibility).toBe('none');
    rerender({ allowBuildingExtrusion: true });
    expect(map.getLayer('building-3d').layout.visibility).toBe('visible');
    rerender({ viewMode: '2d' });
    expect([map.getPitch(), map.getBearing()]).toEqual([0, 0]);
    expect(map.getLayer('building-3d').layout.visibility).toBe('none');
  });

  it('keeps initialCamera and reports onCameraChange on moveend', () => {
    const onCameraChange = vi.fn();
    const initialCamera = { center: [-68.365, 18.563], zoom: 16.8, bearing: -17, pitch: 55 };
    const { map } = renderPositions({ initialCamera, onCameraChange, viewMode: '3d' });
    expect(map.options).toMatchObject(initialCamera);
    // It opens where the page left it: no view is flown to.
    expect(map.cameraCalls.filter(call => call.method !== 'setPadding')).toEqual([]);
    expect(onCameraChange).toHaveBeenLastCalledWith(initialCamera, { byUser: false });
    loadStyle(map);
    act(() => map.jumpTo({ center: [-68.3601, 18.5644], zoom: 17.2, originalEvent: new MouseEvent('wheel') }));
    expect(onCameraChange).toHaveBeenLastCalledWith({ center: [-68.3601, 18.5644], zoom: 17.2, bearing: -17, pitch: 55 }, { byUser: true });
  });

  it('shows the legend with the states on screen and «No oficial»', () => {
    let view = renderPositions();
    loadStyle(view.map);
    const legend = screen.getByTestId('map-legend');
    expect(within(legend).getByRole('button', { name: 'Leyenda' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(within(legend).getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar', 'No oficialUbicación de referencia interna, sin verificar']);
    view.unmount();

    // Only what is on screen: three stands placed by OCC, none at a reference location.
    const placed = createMapStands().filter(stand => ['A1', 'A2', 'A3'].includes(stand.id));
    view = renderPositions({ positions: placed });
    loadStyle(view.map);
    expect(within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['Libre', 'Planificada', 'Ocupada']);
    view.unmount();

    // On the console's apron it starts folded.
    view = renderPositions({ dashboardLabels: true });
    expect(screen.getByRole('button', { name: 'Leyenda' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives its map the weather of the page: the wind at the airfield, and none without it (PR M8)', () => {
    // The aerodrome weather as useMdpcWeather answers it, from a synthetic answer of the API: 100° at 13 kt.
    const reading = toWeatherReading(createAerodromeWeather(), { receivedAt: Date.parse(WEATHER_NOON) });
    const weather = { status: 'success', data: reading.observation, apiStatus: reading.apiStatus, source: reading.source };
    let view = renderPositions({ weather });
    loadStyle(view.map);
    expect(view.map.options.style.sources['occ-weather-wind']).toMatchObject({ type: 'geojson' });
    expect(view.map.getSource('occ-weather-wind').data.features[0].properties).toMatchObject({ kind: 'wind',
      directionDeg: 100, speedKt: 13 });
    view.unmount();
    // The console's apron gives it none: no weather on its map.
    view = renderPositions({ dashboardLabels: true });
    expect(view.map.options.style.sources['occ-weather-wind']).toBeUndefined();
  });

  it('no setStyle on theme change', () => {
    const { map, rerender } = renderPositions({ theme: 'light' });
    loadStyle(map);
    rerender({ theme: 'dark' });
    rerender({ theme: 'light' });
    expect(map.styleCalls).toEqual([]);
    expect(fake.state.maps).toEqual([map]);
    expect(map.getSource('occ-stands').setDataCalls).toHaveLength(1);
  });
});
