import { createRef } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { presetTargets } from '../../maps/core/cameraPresets';
import { STAND_REFERENCE } from '../../maps/stands/standReference';
import { createMapStands, standPoint } from '../../maps/testing/mapFixtures';
import PositionMap from './PositionMap';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
// Synthetic states over the reference points: A1 occupied, A2 free and A3 planned (placed by OCC), B21 disabled and
// BN6 unverified, every other stand free at its reference location.
const STANDS = createMapStands();
const PAGE = '/admin-occ/positions-map?stationId=s-1';
const VIEWPORT_PX = 1440;
const MARK_LAYERS = ['occ-stands-clusters', 'occ-stands-fill', 'occ-stands-frame', 'occ-stands-glyph', 'occ-stands-clock'];

// The zoom at which the fake map fits the width of `bounds` into `width` pixels.
const fitWidth = (bounds, width = VIEWPORT_PX) => Math.log2((width * 360) / (512 * (bounds[1][0] - bounds[0][0])));
const REFERENCE_TARGETS = presetTargets({ stands: STAND_REFERENCE });
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
const standFeature = (code, status = 'available') => ({
  id: code, source: 'occ-stands', layer: { id: 'occ-stands-frame' }, properties: { code, status },
  geometry: { type: 'Point', coordinates: standPoint(code) },
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

    // The console's apron opens on the ramp too, tilted when its 3D is on.
    view = renderPositions({ dashboardLabels: true, viewMode: '3d', allowBuildingExtrusion: true });
    expect(view.map.getZoom()).toBeCloseTo(RAMP_FIT, 6);
    expect([view.map.getPitch(), view.map.getBearing()]).toEqual([55, -17]);
    loadStyle(view.map);
    expect(view.map.layerIds()).toContain('occ-stands-codes-planned');
    expect(view.map.options.style.sources['occ-stands']).toMatchObject({ cluster: true, clusterRadius: 35 });
  });

  it('draws the stands through the stands slot with one setData per positions change and never re-creates the map', () => {
    const { map, rerender } = renderPositions();
    loadStyle(map);
    const ids = map.layerIds();
    expect(ids.slice(ids.indexOf('slot-stands') + 1, ids.indexOf('slot-routes'))).toEqual(MARK_LAYERS);
    expect(ids.slice(ids.indexOf('slot-standLabels') + 1, ids.indexOf('slot-traffic')))
      .toEqual(['occ-stands-cluster-count', 'occ-stands-codes', 'occ-stands-keep-out']);
    const source = map.getSource('occ-stands');
    expect(source.spec).toMatchObject({ type: 'geojson', promoteId: 'code', cluster: true, clusterRadius: 50 });
    expect(source.setDataCalls).toHaveLength(1);
    expect(source.data.features).toHaveLength(41);
    expect(source.data.features.find(feature => feature.properties.code === 'A1')).toEqual({
      type: 'Feature',
      properties: { code: 'A1', terminal: 'A', status: 'occupied', unofficial: false },
      geometry: { type: 'Point', coordinates: standPoint('A1') },
    });
    // The clusters end one zoom below the codes threshold of this screen; PUJ is marked by its reference point.
    expect(source.getClusterOptions()).toEqual({ cluster: true, clusterRadius: 50, clusterMaxZoom: Math.floor(RAMP_FIT - 0.3) - 1 });
    expect(map.getSource('occ-reference').data.features.map(feature => feature.properties.label)).toEqual(['PUJ']);

    // The same positions read again in new objects write nothing; a changed state writes once more.
    rerender({ positions: createMapStands() });
    expect(source.setDataCalls).toHaveLength(1);
    rerender({ positions: createMapStands({ A2: { status: 'planned' } }) });
    expect(source.setDataCalls).toHaveLength(2);
    expect(source.data.features.find(feature => feature.properties.code === 'A2').properties.status).toBe('planned');
    // A filter that leaves fewer stands is one more write.
    rerender({ positions: createMapStands().filter(stand => stand.terminal === 'B') });
    expect(source.setDataCalls).toHaveLength(3);
    expect(source.data.features.every(feature => feature.properties.terminal === 'B')).toBe(true);
    expect(fake.state.maps).toEqual([map]);
    expect(map.calls.filter(call => call.method === 'setStyle')).toEqual([]);
  });

  it('a stand click selects it; a cluster click awaits the expansion zoom', async () => {
    const onSelectPosition = vi.fn();
    // A page id that the database padded: the map speaks of B21, the page gets its own id back.
    const positions = createMapStands().map(stand => (stand.id === 'B21' ? { ...stand, id: 'B021' } : stand));
    const { map } = renderPositions({ positions, onSelectPosition });
    loadStyle(map);
    await click(map, [standFeature('A5')]);
    expect(onSelectPosition).toHaveBeenCalledExactlyOnceWith('A5');
    await click(map, [standFeature('B21', 'disabled')]);
    expect(onSelectPosition).toHaveBeenLastCalledWith('B021');

    // MapLibre 6 answers the expansion zoom with a promise: the camera moves once it is there.
    const source = map.getSource('occ-stands');
    let answer;
    source.getClusterExpansionZoom = vi.fn(() => new Promise(resolve => { answer = resolve; }));
    const before = map.cameraCalls.length;
    await click(map, [{
      id: 9, source: 'occ-stands', layer: { id: 'occ-stands-clusters' },
      properties: { cluster_id: 42, point_count: 16, point_count_abbreviated: '16' },
      geometry: { type: 'Point', coordinates: [-68.364, 18.5641] },
    }]);
    expect(source.getClusterExpansionZoom).toHaveBeenCalledWith(42);
    expect(map.cameraCalls).toHaveLength(before);
    act(() => answer(15.2));
    await waitFor(() => expect(map.cameraCalls).toHaveLength(before + 1));
    expect(map.cameraCalls.at(-1)).toEqual({ method: 'easeTo', options: { center: [-68.364, 18.5641], zoom: 15.2, duration: 500 } });
    // A cluster is not a stand: nothing more was selected.
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
