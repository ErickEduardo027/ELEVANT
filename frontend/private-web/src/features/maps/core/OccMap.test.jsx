import { StrictMode, createRef } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { OccBootContext } from '../../admin-occ/boot/occBootContext';
import tailwindConfig from '../../../../tailwind.config.js';
import { findLegacyColourClasses } from '../../../styles/occLegacyBridge';
import { readSource } from '../../../styles/occSourceScan';
import { occColor } from '../../occ-ui/occPalette';
import { airfieldFeatures } from '../airport/airfieldFeatures';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, METRES_PER_NM } from '../airport/geo';
import { AIRFIELD_LAYER_IDS } from '../style/airfieldLayers';
import { REFERENCE_LAYER_IDS, ourAirportsFeatures, referenceFeatures } from '../style/referenceLayers';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { ghostFeatures, placingGhost } from '../stands/placing';
import { buildStandFeatures, diffStandFeatures } from '../stands/standFeatures';
import { attachStandGeometry, withStandDisplay } from '../stands/standModel';
import { STAND_REFERENCE } from '../stands/standReference';
import { SCENARIO_AGENTS, createMapStands, createRampScenario, standPoint } from '../testing/mapFixtures';
import {
  createAirPicture, createEstimates, createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_HEX, TRAFFIC_NOON, TRAFFIC_SOURCE,
} from '../testing/trafficFixtures';
import { serverClock } from '../../../services/serverClock';
import { toWeatherReading } from '../../../services/weatherService';
import { runwayEnds } from '../airport/runwayInUse';
import { createAerodromeWeather, WEATHER_NOON } from '../testing/weatherFixtures';
import { nightShadeFeatures } from '../traffic/nightShade';
import { buildSituation, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import { createTrailStore, trailFeatures } from '../traffic/trailStore';
import MapLegend from '../ui/MapLegend';
import { createSimulatedSatelliteImagery } from '../useSatelliteImagery';
import { GOES_TILE_TEMPLATE } from '../../../services/satelliteService';
import { AIRFIELD_ATTRIBUTION } from './attribution';
import { boundsCenter, presetTargets } from './cameraPresets';
import { liveEngineCount } from './mapEngine';
import OccMap from './OccMap';
import { useOccMap } from './OccMapContext';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const STANDS = createMapStands();
// The stands as the map draws them: each with the polygon of the MDPC layout, or moved to where OCC placed it.
const DRAWN = attachStandGeometry(STANDS, MDPC_LAYOUT);
const PAGE = '/admin-occ/positions-map?stationId=s-1';
// 14:07 in Punta Cana (UTC−4): the instant of the ramp scenario's visits.
const NOW = Date.parse('2026-11-13T18:07:00Z');
const MINUTE = 60 * 1000;
const REFERENCES = STAND_REFERENCE.map(stand => ({ id: stand.code, terminal: stand.terminal, lat: stand.latitude, lon: stand.longitude }));
// The ramp scenario as a positions screen gives it to its map: the board's positions read at NOW (useStandDisplay).
function scenarioStands(nowMs = NOW) {
  const { board, flightsByTurnaround } = createRampScenario(NOW);
  return withStandDisplay(mapOccupancyToRampPositions(REFERENCES, board, board.asOf), { nowMs, flightsByTurnaround });
}
// A layer of a screen of its own, next to the stands the map draws.
const EXTRA_OVERLAY = {
  sources: { 'test-notes': { type: 'geojson' } },
  layers: [{
    slot: 'standLabels', id: 'test-notes', type: 'symbol', source: 'test-notes',
    layout: { 'text-field': ['get', 'note'], 'text-font': ['Noto Sans Regular'] },
    metadata: { 'occ:group': 'notes' },
  }],
};
// A screen's own overlay with a pick of its own kind, as the map lab's layout review has.
const PIN_OVERLAY = {
  sources: { 'test-pins': { type: 'geojson' } },
  layers: [{
    slot: 'stands', id: 'test-pins', type: 'circle', source: 'test-pins',
    paint: { 'circle-radius': 4 },
    metadata: { 'occ:group': 'pins', 'occ:pick': 'pin', 'occ:pickId': 'id' },
  }],
};
const pins = ids => ({
  type: 'FeatureCollection',
  features: ids.map(id => ({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [-68.36, 18.56] } })),
});
// Synthetic flights with and without a position, around Punta Cana.
const FLIGHTS = [
  { id: 'l:leg-1', flightKey: 'l:leg-1', heading: 120, latitude: 18.71, longitude: -68.52 },
  { id: 'p:prop-2', flightKey: 'p:prop-2', heading: null, latitude: null, longitude: null },
];

// What the map shares with its overlays, printed for the assertions (a plain element: <output> is a live region).
function Probe() {
  const {
    engineStatus, basemapStatus, activeView, fits, thresholds, standsOnScreen, chipsOnScreen, standMarksOnScreen,
    flightsOnScreen, airfieldOnScreen,
  } = useOccMap();
  return (
    <pre data-testid="probe">
      {JSON.stringify({
        engineStatus, basemapStatus, activeView, fits, thresholds, onScreen: standsOnScreen.map(stand => stand.id),
        chips: chipsOnScreen, marks: standMarksOnScreen, flightsOnScreen: flightsOnScreen.map(flight => flight.id),
        airfieldOnScreen,
      })}
    </pre>
  );
}

const probe = () => JSON.parse(screen.getByTestId('probe').textContent);
// The views the map frames: the MDPC dataset unless a test says otherwise.
const targetsOf = (layout = MDPC_LAYOUT) => presetTargets({ stands: STANDS, layout });
// Features of the airfield as queryRenderedFeatures answers them for the layers it is asked about.
const airfieldDrawn = (layer, properties) => ({ layer: { id: layer }, properties });
const RUNWAY_08 = airfieldDrawn('occ-airfield-runway', { kind: 'runway', id: '08/26', ref: '08/26', lengthM: 3100.1, widthM: 45.1 });
const TAXIWAY_A = airfieldDrawn('occ-airfield-taxiway', { kind: 'taxiway', id: 'tw-148936325', ref: 'A' });
// A taxiway without a name: MapLibre drops a null property.
const TAXIWAY_UNNAMED = airfieldDrawn('occ-airfield-taxiway', { kind: 'taxiway', id: 'tw-812822707' });
// The style source a map started without the stands or flights prop has for them.
function createMapWithout(kind) {
  const view = render(<OccMap />);
  const source = fake.state.liveMaps().at(-1).options.style.sources[kind === 'flights' ? 'occ-flights' : 'occ-stands'];
  view.unmount();
  return source;
}
const query = () => new URLSearchParams(window.location.search);

function renderMap(props = {}, { strict = false } = {}) {
  const ref = createRef();
  const element = props => (
    <OccMap ref={ref} stands={STANDS} testId="position-map-container" {...props}>
      <Probe />
      {props.children}
    </OccMap>
  );
  const view = render(strict ? <StrictMode>{element(props)}</StrictMode> : element(props));
  return {
    ...view,
    ref,
    map: fake.state.liveMaps().at(-1) ?? null,
    rerender: next => view.rerender(strict ? <StrictMode>{element(next)}</StrictMode> : element(next)),
  };
}

const loadStyle = map => act(() => fake.state.emit(map, 'style.load'));
const press = (target, key, init = {}) => {
  const event = createEvent.keyDown(target, { key, ...init });
  fireEvent(target, event);
  return event;
};

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  resetLanguageForTests('es');
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describe('OccMap', () => {
  it('renders the selectable fallback with the given Spanish and English strings when the engine is unavailable', async () => {
    fake.state.reset({ constructorError: new GPUInitializationError() });
    const onSelect = vi.fn();
    const labels = {
      unavailableTitle: 'La cartografía no está disponible',
      unavailableDescription: 'Puedes consultar y seleccionar las posiciones desde esta lista mientras se restablece el mapa base.',
      unavailableList: 'Posiciones',
    };
    renderMap({ labels, selection: { kind: 'stand', id: 'A2' }, onSelect });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-testid', 'map-unavailable');
    // Right after the host of the canvas, where occ.css looks for the fallback of the positions map.
    expect(screen.getByTestId('position-map-container').nextElementSibling).toBe(alert);
    expect(within(alert).getByRole('heading', { name: labels.unavailableTitle })).toBeInTheDocument();
    expect(within(alert).getByText(labels.unavailableDescription)).toBeInTheDocument();
    const list = within(alert).getByRole('group', { name: 'Posiciones' });
    expect(within(list).getAllByRole('button')).toHaveLength(41);
    expect(within(list).getByRole('button', { name: 'A2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(list).getByRole('button', { name: 'A5' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'stand', id: 'A5' });
    expect(probe()).toMatchObject({ engineStatus: 'unavailable', activeView: null });
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-engine', 'unavailable');
    expect(fake.state.liveMaps()).toEqual([]);
    // The view keys do nothing without a map.
    expect(press(alert, '2').defaultPrevented).toBe(false);
    expect(query().has('view')).toBe(false);
    cleanup();

    // English strings from the adapter, a list of its own and its own select handler.
    resetLanguageForTests('en');
    const onFallbackSelect = vi.fn();
    render(
      <LanguageScope>
        <OccMap stands={STANDS} labels={{ unavailableTitle: 'Base map unavailable', unavailableDescription: 'You can browse and select stands from this list while the base map is restored.' }}
          fallbackItems={[{ id: 'l:leg-1', label: 'AA904', kind: 'flight' }]} onFallbackSelect={onFallbackSelect} />
      </LanguageScope>,
    );
    const english = await screen.findByRole('alert');
    expect(within(english).getByRole('heading', { name: 'Base map unavailable' })).toBeInTheDocument();
    expect(within(english).getByText(/while the base map is restored/)).toBeInTheDocument();
    fireEvent.click(within(within(english).getByRole('group', { name: 'Map list' })).getByRole('button', { name: 'AA904' }));
    expect(onFallbackSelect).toHaveBeenCalledExactlyOnceWith('l:leg-1', { id: 'l:leg-1', label: 'AA904', kind: 'flight' });
    cleanup();

    // Without strings of its own the map says it in the language of the screen.
    render(<LanguageScope><OccMap stands={STANDS} /></LanguageScope>);
    expect(await screen.findByRole('heading', { name: 'The map is not available' })).toBeInTheDocument();
  });

  it('switches to the fallback for good when the WebGL context comes back without WebGL2', () => {
    const { map } = renderMap();
    loadStyle(map);
    const root = screen.getByTestId('occ-map');
    const host = screen.getByTestId('position-map-container');
    expect(root).toHaveAttribute('data-occ-engine', 'ready');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(host.querySelector('.maplibregl-canvas')).not.toBeNull();

    act(() => fake.state.loseContext(map));
    act(() => fake.state.failContextRestore(map));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-testid', 'map-unavailable');
    expect(root).toHaveAttribute('data-occ-engine', 'unavailable');
    expect(within(within(alert).getByRole('group')).getAllByRole('button')).toHaveLength(41);
    expect(probe()).toMatchObject({ engineStatus: 'unavailable', basemapStatus: 'off' });
    // The map is gone, as when it cannot start: no canvas or control is left under the list.
    expect(fake.state.liveMaps()).toEqual([]);
    expect(host.querySelector('.maplibregl-canvas, .maplibregl-control-container')).toBeNull();

    // The style MapLibre had rebuilt loading later brings nothing back.
    loadStyle(map);
    expect(screen.getByRole('alert')).toBe(alert);
    expect(root).toHaveAttribute('data-occ-engine', 'unavailable');
    expect(host.querySelector('.maplibregl-canvas')).toBeNull();
    // The view keys do nothing without a map.
    expect(press(alert, '2').defaultPrevented).toBe(false);
    expect(query().has('view')).toBe(false);
  });

  it('tells the OCC boot screen the map is ready once its engine settles, ready or unavailable (contract 2.6)', async () => {
    const markReady = vi.fn();
    const boot = { markReady };
    const inFrame = () => <OccBootContext.Provider value={boot}><OccMap stands={STANDS} /></OccBootContext.Provider>;

    // Ready on style.load: the airfield and the stands draw from ELEVANT's own data, with or without the base map.
    const first = render(inFrame());
    expect(markReady).not.toHaveBeenCalled();
    loadStyle(fake.state.liveMaps().at(-1));
    expect(markReady).toHaveBeenCalledWith('map');
    expect(markReady.mock.calls.every(([source]) => source === 'map')).toBe(true);
    first.unmount();

    // Without WebGL the fallback list is what the screen shows: the boot screen need not wait its 6 s for it either.
    markReady.mockClear();
    fake.state.reset({ constructorError: new GPUInitializationError() });
    render(inFrame());
    await screen.findByRole('alert');
    expect(markReady).toHaveBeenCalledWith('map');
    expect(markReady.mock.calls.every(([source]) => source === 'map')).toBe(true);
  });

  it('shows the degraded base-map chip and keeps the map usable', () => {
    const onSelect = vi.fn();
    const { map } = renderMap({ selection: { kind: 'stand', id: 'A5' }, onSelect });
    loadStyle(map);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const root = screen.getByTestId('occ-map');
    expect(root).toHaveAttribute('data-occ-engine', 'ready');
    expect(root).toHaveAttribute('data-occ-basemap', 'loading');

    act(() => fake.state.emit(map, 'error', { sourceId: 'openmaptiles', error: new Error('Failed to fetch') }));
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('No se pudo cargar el mapa base. Los datos de ELEVANT siguen en el mapa.');
    expect(chip).toHaveClass('occ-map-chip');
    expect(probe()).toMatchObject({ engineStatus: 'ready', basemapStatus: 'degraded' });
    // The same states on the root, where the visual suite waits for them.
    expect(root).toHaveAttribute('data-occ-basemap', 'degraded');
    // A chip, not a fallback: the canvas stays and the map answers.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fake.state.liveMaps()).toEqual([map]);
    expect(screen.getByTestId('position-map-container').querySelector('.maplibregl-canvas')).not.toBeNull();
    press(map.getCanvas(), '3');
    expect(query().get('view')).toBe('airfield');
    expect(map.getZoom()).toBeCloseTo(probe().fits.airfield, 6);
    expect(map.getSource('occ-selection').data.features).toHaveLength(1);

    // A tile of the base map brings it back.
    act(() => fake.state.emit(map, 'sourcedata', { sourceId: 'openmaptiles', tile: {} }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('leaves exactly one live map after a StrictMode double mount', () => {
    const before = liveEngineCount();
    const { map, unmount } = renderMap({}, { strict: true });
    expect(fake.state.maps).toHaveLength(2);
    expect(fake.state.liveMaps()).toEqual([fake.state.maps[1]]);
    expect(map).toBe(fake.state.maps[1]);
    expect(liveEngineCount()).toBe(before + 1);
    const host = screen.getByTestId('position-map-container');
    expect(host.querySelectorAll('.occ-map-engine')).toHaveLength(1);
    expect(host.querySelectorAll('.maplibregl-canvas')).toHaveLength(1);
    // The map that stayed is the one that answers: it opened on the ramp and its zoom buttons' map moves.
    loadStyle(map);
    expect(map.getZoom()).toBeCloseTo(probe().fits.ramp, 6);
    press(map.getCanvas(), '1');
    expect(map.getZoom()).toBeCloseTo(probe().fits.region, 6);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'region');
    expect(fake.state.maps[0].cameraCalls.filter(call => call.method !== 'setPadding' && call.method !== 'jumpTo')).toEqual([]);

    unmount();
    expect(fake.state.liveMaps()).toEqual([]);
    expect(liveEngineCount()).toBe(before);
  });

  it('keys 1 to 4 change the view and write view=; Esc clears the selection; keys typed in a field or with Ctrl do nothing', () => {
    const onSelect = vi.fn();
    const { map, rerender } = renderMap({
      selection: { kind: 'stand', id: 'A5' }, onSelect, children: <input aria-label="Buscar posición" />,
    });
    loadStyle(map);
    const canvas = map.getCanvas();
    const root = screen.getByTestId('occ-map');
    for (const [key, view] of [['1', 'region'], ['2', 'approach'], ['3', 'airfield'], ['4', 'ramp']]) {
      expect(press(canvas, key).defaultPrevented, key).toBe(true);
      expect(query().get('view'), key).toBe(view);
      expect(map.getZoom(), key).toBeCloseTo(probe().fits[view], 6);
      expect(root, key).toHaveAttribute('data-occ-view', view);
      expect(Number(root.getAttribute('data-occ-zoom')), key).toBeCloseTo(probe().fits[view], 2);
    }
    expect(query().get('stationId')).toBe('s-1');

    // Esc clears the selection and uses the key.
    expect(press(canvas, 'Escape').defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);

    // A field inside the map, Ctrl or Meta, and a key pressed outside the map do nothing.
    const field = screen.getByRole('textbox', { name: 'Buscar posición' });
    expect(press(field, '1').defaultPrevented).toBe(false);
    expect(press(canvas, '2', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(canvas, '3', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press(document.body, '1').defaultPrevented).toBe(false);
    expect(query().get('view')).toBe('ramp');
    expect(map.getZoom()).toBeCloseTo(probe().fits.ramp, 6);

    // With nothing selected Esc is not used; a modal dialog or a drawer the page reports holds every key.
    rerender({ selection: null, onSelect });
    expect(press(canvas, 'Escape').defaultPrevented).toBe(false);
    expect(onSelect).toHaveBeenCalledOnce();
    let drawerOpen = true;
    rerender({ selection: { kind: 'stand', id: 'A5' }, onSelect, isShortcutBlocked: () => drawerOpen });
    expect(press(canvas, 'Escape').defaultPrevented).toBe(false);
    expect(press(canvas, '1').defaultPrevented).toBe(false);
    drawerOpen = false;
    const dialog = document.body.appendChild(Object.assign(document.createElement('div'), { role: 'dialog' }));
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    expect(press(canvas, '1').defaultPrevented).toBe(false);
    dialog.remove();
    expect(query().get('view')).toBe('ramp');
    expect(onSelect).toHaveBeenCalledOnce();
    // D, S and L belong to later PRs: they pass through.
    for (const key of ['d', 's', 'l']) expect(press(canvas, key).defaultPrevented, key).toBe(false);
  });

  it('opens on the URL view, else initialCamera, else defaultView; re-pressing the active view after a free zoom flies again', () => {
    const initialCamera = { center: [-68.365, 18.563], zoom: 12.3, bearing: 0, pitch: 0 };
    window.history.replaceState({}, '', `${PAGE}&view=approach`);
    let view = renderMap({ initialCamera, defaultView: 'ramp' });
    expect(view.map.getZoom()).toBeCloseTo(probe().fits.approach, 6);
    expect(probe().activeView).toBe('approach');
    // The view is jumped to at start, not animated.
    expect(view.map.cameraCalls.filter(call => call.method !== 'setPadding').map(call => call.method)).toEqual(['jumpTo']);
    view.unmount();

    // A terminal preset of the URL frames that terminal's stands.
    window.history.replaceState({}, '', `${PAGE}&view=ramp&terminal=FBO`);
    view = renderMap();
    const fbo = targetsOf().terminals.FBO.bounds;
    const expectedFbo = Math.log2((1440 * 360) / (512 * (fbo[1][0] - fbo[0][0])));
    expect(view.map.getZoom()).toBeCloseTo(expectedFbo, 6);
    expect(view.map.getCenter().lng).toBeCloseTo((fbo[0][0] + fbo[1][0]) / 2, 9);
    view.unmount();

    window.history.replaceState({}, '', PAGE);
    view = renderMap({ initialCamera, defaultView: 'ramp' });
    expect(view.map.options).toMatchObject({ center: [-68.365, 18.563], zoom: 12.3 });
    expect(view.map.getZoom()).toBe(12.3);
    expect(view.map.cameraCalls.filter(call => call.method !== 'setPadding')).toEqual([]);
    expect(probe().activeView).toBe('airfield');
    view.unmount();

    view = renderMap({ defaultView: 'airfield' });
    const { map } = view;
    const { fits } = probe();
    expect(map.getZoom()).toBeCloseTo(fits.airfield, 6);
    // The default view is not written in the URL.
    expect(query().has('view')).toBe(false);

    // A free zoom keeps the selector truthful; pressing the view flies back and writes it.
    act(() => map.jumpTo({ zoom: 9 }));
    expect(probe().activeView).toBe('approach');
    press(map.getCanvas(), '3');
    expect(query().get('view')).toBe('airfield');
    expect(map.getZoom()).toBeCloseTo(fits.airfield, 6);
    // The URL already says airfield: after another free zoom the same key still flies.
    act(() => map.jumpTo({ zoom: 17.5 }));
    const calls = map.cameraCalls.length;
    press(map.getCanvas(), '3');
    expect(map.cameraCalls).toHaveLength(calls + 1);
    expect(map.cameraCalls.at(-1)).toMatchObject({ method: 'flyTo', options: { curve: 1.42, essential: false } });
    expect(map.getZoom()).toBeCloseTo(fits.airfield, 6);

    // A view written in the URL by someone else (another panel, back and forward) flies too.
    act(() => globalThis.__nextRouterMock.replace(`${PAGE}&view=region`));
    expect(map.getZoom()).toBeCloseTo(fits.region, 6);
    expect(probe().activeView).toBe('region');
  });

  it('frames its first view as soon as a map without a size gets one, unless a person moved it first', () => {
    // A collapsed container: MapLibre cannot fit anything yet.
    fake.state.size.width = 0;
    let view = renderMap({ defaultView: 'airfield' });
    const airfield = targetsOf().airfield.bounds;
    // It waits over the airfield, not at MapLibre's [0, 0], and moves nothing.
    expect(view.map.options.center).toEqual(boundsCenter(airfield));
    expect(probe()).toMatchObject({ fits: null, thresholds: null, activeView: null });
    expect(view.map.cameraCalls.filter(call => call.method !== 'setPadding')).toEqual([]);

    act(() => fake.state.resize(view.map, { width: 1440 }));
    const { fits } = probe();
    expect(view.map.getZoom()).toBeCloseTo(fits.airfield, 6);
    expect(view.map.getCenter().lng).toBeCloseTo(boundsCenter(airfield)[0], 9);
    expect(view.map.cameraCalls.filter(call => call.method !== 'setPadding').map(call => call.method)).toEqual(['jumpTo']);
    expect(probe().activeView).toBe('airfield');
    // Once framed, a later resize keeps the camera where it is.
    act(() => fake.state.resize(view.map, { width: 1200 }));
    expect(view.map.cameraCalls.filter(call => call.method !== 'setPadding')).toHaveLength(1);
    view.unmount();

    // A person who moves the map before it has a size keeps the camera they chose.
    fake.state.size.width = 0;
    view = renderMap({ defaultView: 'airfield' });
    act(() => view.map.jumpTo({ zoom: 9, originalEvent: new MouseEvent('wheel') }));
    act(() => fake.state.resize(view.map, { width: 1440 }));
    expect(view.map.getZoom()).toBe(9);
    expect(probe().activeView).toBe('approach');
  });

  it('insets feed the padding and the CSS variables and re-derive the thresholds', () => {
    const insets = { top: 56, right: 320, bottom: 48, left: 0 };
    const { map, rerender } = renderMap({ insets });
    loadStyle(map);
    expect(map.getPadding()).toEqual(insets);
    const root = screen.getByTestId('occ-map');
    const engineContainer = root.querySelector('.occ-map-engine');
    for (const [side, value] of Object.entries(insets)) {
      expect(root.style.getPropertyValue(`--occ-map-inset-${side}`), side).toBe(`${value}px`);
      expect(engineContainer.style.getPropertyValue(`--occ-map-inset-${side}`), side).toBe(`${value}px`);
    }

    // The ramp fits the width the panels leave free; the code threshold sits 0.3 below that fit.
    const ramp = targetsOf().ramp.bounds;
    const fitFor = width => Math.log2((width * 360) / (512 * (ramp[1][0] - ramp[0][0])));
    const narrow = probe();
    expect(narrow.fits.ramp).toBeCloseTo(fitFor(1440 - 320), 9);
    expect(narrow.thresholds).toEqual({
      polygons: narrow.fits.airfield - 0.3, codes: narrow.fits.ramp - 0.3, threeLine: narrow.fits.ramp + 0.8,
      airfield: (narrow.fits.approach + narrow.fits.airfield) / 2, approach: (narrow.fits.region + narrow.fits.approach) / 2,
    });
    expect(map.zoomRangeCalls.findLast(call => call.id === 'occ-stands-leadin'))
      .toEqual({ id: 'occ-stands-leadin', minzoom: narrow.thresholds.codes, maxzoom: 24 });
    expect(map.getZoom()).toBeCloseTo(narrow.fits.ramp, 6);

    // Folding the side panel gives the room back: new fits, new thresholds.
    rerender({ insets: { ...insets, right: 0 } });
    expect(map.getPadding()).toEqual({ ...insets, right: 0 });
    expect(root.style.getPropertyValue('--occ-map-inset-right')).toBe('0px');
    const wide = probe();
    expect(wide.fits.ramp).toBeCloseTo(fitFor(1440), 9);
    expect(map.zoomRangeCalls.findLast(call => call.id === 'occ-stands-leadin').minzoom).toBeCloseTo(wide.fits.ramp - 0.3, 9);
    // The same insets in a new object change nothing.
    const ranges = map.zoomRangeCalls.length;
    rerender({ insets: { ...insets, right: 0 } });
    expect(map.zoomRangeCalls).toHaveLength(ranges);

    // A resize of the map re-derives them as well.
    act(() => fake.state.resize(map, { width: 1000 }));
    expect(probe().fits.ramp).toBeCloseTo(fitFor(1000), 9);
    expect(map.zoomRangeCalls.findLast(call => call.id === 'occ-stands-leadin').minzoom).toBeCloseTo(fitFor(1000) - 0.3, 9);

    // A view flies inside the insets.
    press(map.getCanvas(), '3');
    expect(map.cameraCalls.at(-1).options.padding).toEqual({ ...insets, right: 0 });
  });

  it('counts on screen the stands whose polygon the insets leave in sight, again whenever the insets change', () => {
    const { map, rerender } = renderMap();
    loadStyle(map);
    // Up close on A2 (a 1440 × 900 map at zoom 18). A stand counts when its polygon reaches into the area the panels
    // leave free: here that is read in pixels, from the polygons the map draws.
    act(() => map.jumpTo({ center: standPoint('A2'), zoom: 18 }));
    const pixelBox = code => {
      const points = DRAWN.find(stand => stand.id === code).geometry.polygon.map(point => map.project(point));
      return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)) };
    };
    const inSight = ({ left, right, top = 0, bottom = 900 }) => DRAWN.filter(stand => {
      const points = stand.geometry.polygon.map(point => map.project(point));
      const [xs, ys] = [points.map(p => p.x), points.map(p => p.y)];
      return Math.max(...xs) >= left && Math.min(...xs) <= right && Math.max(...ys) >= top && Math.min(...ys) <= bottom;
    }).map(stand => stand.id);
    const whole = inSight({ left: 0, right: 1440 });
    expect(whole).toEqual(expect.arrayContaining(['A1', 'A2', 'A3']));
    expect(whole).not.toContain('B21');
    expect(probe().onScreen).toEqual(whole);

    // A panel over the right of the map that covers A1's whole polygon hides it, and the camera stays where it was.
    const right = Math.ceil(1440 - pixelBox('A1').left) + 4;
    rerender({ insets: { top: 56, right, bottom: 0, left: 0 } });
    expect(probe().onScreen).not.toContain('A1');
    expect(probe().onScreen).toContain('A2');
    expect(probe().onScreen).toEqual(inSight({ left: 0, right: 1440 - right, top: 56 }));
    expect(map.getCenter().toArray()).toEqual(standPoint('A2'));
    expect(map.getZoom()).toBe(18);
    // Panels that cover the whole map leave nothing on screen; folded, every stand is back.
    rerender({ insets: { left: 720, right: 720 } });
    expect(probe().onScreen).toEqual([]);
    rerender({ insets: undefined });
    expect(probe().onScreen).toEqual(whole);
  });

  it('the legend lists terminal chips below the polygon threshold and states from it', () => {
    // A1 limited to narrow-body aircraft, and B21 cancelled by B22: the two stand marks the legend explains.
    const stands = createMapStands({ A1: { narrowbodyOnly: true }, B21: { cancelledBy: 'B22' } });
    const { map } = renderMap({ stands, children: <MapLegend /> });
    loadStyle(map);
    const legend = () => within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem')
      .map(item => item.textContent);
    const chip = 'Posiciones de una terminalOcupadas del total; acerca el mapa para ver cada una';
    const { fits, thresholds } = probe();
    // The ramp view draws the polygons: their states, the link of B21 and the narrow-body box of A1; no chip.
    expect(probe()).toMatchObject({ activeView: 'ramp', chips: [], marks: ['combined', 'narrowbody'] });
    expect(probe().onScreen).toHaveLength(41);
    expect(legend()).toEqual([
      'Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar',
      'Enlace con la posición que la anula', 'Caja de fuselaje estrecho',
      'No oficialUbicación de referencia interna, sin verificar',
    ]);
    // Below the codes threshold the narrow-body box is no longer drawn; the link is, with the polygons.
    act(() => map.jumpTo({ zoom: thresholds.codes - 0.1 }));
    expect(probe().marks).toEqual(['combined']);

    // Below the polygon threshold (the airfield fit − 0.6): one chip per terminal in sight and no stand state.
    act(() => map.jumpTo({ center: boundsCenter(targetsOf().airfield.bounds), zoom: fits.airfield - 0.6 }));
    expect(probe()).toMatchObject({ onScreen: [], chips: ['A', 'B', 'FBO'], marks: [] });
    expect(legend()).toEqual([chip]);
    // At the polygon threshold the states are back and the chips go.
    act(() => map.jumpTo({ zoom: thresholds.polygons }));
    expect(probe().chips).toEqual([]);
    expect(probe().onScreen.length).toBeGreaterThan(0);
    expect(legend()).not.toContain(chip);
    expect(legend()).toContain('Ocupada');
    // Below the airfield threshold (the region view) nothing of the stands is drawn: nothing to explain.
    press(map.getCanvas(), '1');
    expect(probe()).toMatchObject({ activeView: 'region', onScreen: [], chips: [], marks: [] });
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    cleanup();

    // In English, the chip's words.
    resetLanguageForTests('en');
    window.history.replaceState({}, '', `${PAGE}&view=airfield`);
    render(<LanguageScope><OccMap stands={STANDS}><Probe /><MapLegend /></OccMap></LanguageScope>);
    const english = fake.state.liveMaps().at(-1);
    loadStyle(english);
    act(() => english.jumpTo({ zoom: probe().fits.airfield - 0.6 }));
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['Stands of a terminalOccupied of the total; zoom in to see each one']);
  });

  it('counts the arrow over a terminal chip as a mark on screen only while a chip with a stand in «Llegando» is in sight', () => {
    // The ramp scenario: A3 and A6 read «Llegando», so only the chip of terminal A carries the arrow.
    const stands = scenarioStands();
    const { map } = renderMap({ stands, frozenAt: NOW });
    loadStyle(map);
    const chipOf = terminal => map.getSource('occ-stand-groups').data.features.find(item => item.id === terminal);
    expect(['A', 'B', 'FBO'].map(terminal => chipOf(terminal).properties.arriving)).toEqual([true, false, false]);
    // The ramp view draws the polygons and no chip: no arrow either.
    expect(probe()).toMatchObject({ activeView: 'ramp', chips: [] });
    expect(probe().marks).not.toContain('chipArriving');

    // Below the polygon threshold: the three chips, and the arrow over A's.
    const { fits, thresholds } = probe();
    act(() => map.jumpTo({ center: boundsCenter(targetsOf().airfield.bounds), zoom: fits.airfield - 0.6 }));
    expect(probe()).toMatchObject({ onScreen: [], chips: ['A', 'B', 'FBO'], marks: ['chipArriving'] });

    // The right edge between the chips of A and B (terminal A lies east of B and the FBO): B's and the FBO's chips stay
    // in sight, without an arrow. The left edge between them: A's chip alone, with its arrow.
    const pixel = terminal => map.project(chipOf(terminal).geometry.coordinates);
    const between = () => (pixel('A').x + pixel('B').x) / 2;
    expect(pixel('A').x).toBeGreaterThan(Math.max(pixel('B').x, pixel('FBO').x) + 20);
    act(() => map.jumpTo({ center: map.unproject([between() - 720, 450]).toArray() }));
    expect(probe()).toMatchObject({ chips: ['B', 'FBO'], marks: [] });
    act(() => map.jumpTo({ center: map.unproject([between() + 720, 450]).toArray() }));
    expect(probe()).toMatchObject({ chips: ['A'], marks: ['chipArriving'] });

    // From the polygon threshold the chips go, and their arrow with them.
    act(() => map.jumpTo({ zoom: thresholds.polygons }));
    expect(probe().chips).toEqual([]);
    expect(probe().marks).not.toContain('chipArriving');
  });

  it('counts on screen the flights it draws in the area the insets leave in sight', () => {
    const screenWith = (props = {}) => (
      <OccMap flights={FLIGHTS} defaultView="region" {...props}>
        <Probe />
      </OccMap>
    );
    const { rerender } = render(screenWith());
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    // The region view holds the flight with a position; the one without a position is never drawn.
    expect(probe().flightsOnScreen).toEqual(['l:leg-1']);

    // Centred on the flight (x = 720 of the 1440 px map): a panel over the left half hides it, one over the right not.
    act(() => map.jumpTo({ center: [-68.52, 18.71], zoom: 12 }));
    rerender(screenWith({ insets: { left: 760 } }));
    expect(probe().flightsOnScreen).toEqual([]);
    rerender(screenWith({ insets: { right: 600 } }));
    expect(probe().flightsOnScreen).toEqual(['l:leg-1']);
    // The camera leaving the flight takes it off screen, and the flight coming into the view brings it back.
    act(() => map.jumpTo({ center: [-70.55, 19.45], zoom: 12 }));
    expect(probe().flightsOnScreen).toEqual([]);
    rerender(screenWith({ insets: { right: 600 }, flights: [{ ...FLIGHTS[0], latitude: 19.45, longitude: -70.55 }, FLIGHTS[1]] }));
    expect(probe().flightsOnScreen).toEqual(['l:leg-1']);
    cleanup();

    // A map that started without flights has no flight layer, so flights given later are never on screen.
    const late = render(<OccMap defaultView="region"><Probe /></OccMap>);
    const plain = fake.state.liveMaps().at(-1);
    loadStyle(plain);
    late.rerender(<OccMap defaultView="region" flights={FLIGHTS}><Probe /></OccMap>);
    expect(plain.options.style.sources['occ-flights']).toBeUndefined();
    expect(probe().flightsOnScreen).toEqual([]);
  });

  it('draws the selected stand with its casing through the feature state and its label first; a flight with a ring', () => {
    const { map, rerender } = renderMap({ selection: { kind: 'stand', id: 'a05' } });
    loadStyle(map);
    const source = map.getSource('occ-selection');
    const labelOf = code => map.getSource('occ-stand-labels').data.features.find(item => item.id === code);
    // The selection source holds the selected stand's label point and texts: its label is placed before the others.
    const a5 = labelOf('A5');
    expect(source.data).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { kind: 'stand', id: 'A5', label1: 'A5', label2: a5.properties.label2, label3: a5.properties.label3 },
        geometry: a5.geometry,
      }],
    });
    // The casing is the polygon's feature state, cyan; the selected label is cyan too; a ring is for anything else.
    expect(map.featureStateOf('occ-stands', 'A5')).toEqual({ selected: true });
    const ids = map.layerIds();
    // The top slot: the ring, then the boxes of «Ubicar en el mapa» (empty until a stand is placed).
    expect(ids.slice(ids.indexOf('slot-selection') + 1)).toEqual([
      'occ-selection-ring', 'occ-stand-ghost-fill', 'occ-stand-ghost-pending', 'occ-stand-ghost-outline',
      'occ-stand-ghost-snapped', 'occ-stand-ghost-centre',
    ]);
    expect(map.getSource('occ-stand-ghost').data.features).toEqual([]);
    expect(map.getLayer('occ-stands-selection').paint['line-color']).toBe(occColor('accent'));
    expect(map.getLayer('occ-stand-label-selected').paint['text-color']).toBe(occColor('accent'));
    expect(map.getLayer('occ-selection-ring').paint['circle-stroke-color']).toBe(occColor('accent'));

    // Another stand moves the casing: one feature state off, one on, never a rewrite of the stand sources.
    const writes = () => ['occ-stands', 'occ-stand-labels'].map(id => map.getSource(id).setDataCalls.length
      + map.getSource(id).updateDataCalls.length);
    const before = writes();
    rerender({ selection: { kind: 'stand', id: 'B21' } });
    expect(map.featureStateOf('occ-stands', 'A5')).toEqual({});
    expect(map.featureStateOf('occ-stands', 'B21')).toEqual({ selected: true });
    expect(source.data.features[0].geometry).toEqual(labelOf('B21').geometry);
    expect(writes()).toEqual(before);
    // The same selection in a new object writes nothing.
    const states = map.calls.filter(call => /FeatureState/.test(call.method)).length;
    const selectionWrites = source.setDataCalls.length;
    rerender({ selection: { kind: 'stand', id: 'B21' } });
    expect(source.setDataCalls).toHaveLength(selectionWrites);
    expect(map.calls.filter(call => /FeatureState/.test(call.method))).toHaveLength(states);

    // A flight is ringed where it is, and the stand loses its casing; none clears both.
    rerender({ selection: { kind: 'flight', id: 'leg-7' }, flights: [{ id: 'leg-7', latitude: standPoint('AN1')[1], longitude: standPoint('AN1')[0] }] });
    expect(source.data.features).toEqual([{
      type: 'Feature', properties: { kind: 'flight', id: 'leg-7' }, geometry: { type: 'Point', coordinates: standPoint('AN1') },
    }]);
    expect(map.featureStateOf('occ-stands', 'B21')).toEqual({});
    rerender({ selection: null });
    expect(source.data.features).toEqual([]);

    // The casing survives a context loss: the engine puts the feature state back on the rebuilt style.
    rerender({ selection: { kind: 'stand', id: 'A3' } });
    act(() => fake.state.loseContext(map));
    act(() => fake.state.restoreContext(map));
    loadStyle(map);
    expect(map.featureStateOf('occ-stands', 'A3')).toEqual({ selected: true });
    expect(map.getSource('occ-selection').data.features[0].properties).toMatchObject({ kind: 'stand', id: 'A3' });
  });

  it('selects what is clicked, opens a terminal from its chip, reports the point while placing and sets the cursor once per frame', async () => {
    const onSelect = vi.fn();
    const onMapClick = vi.fn();
    const { map, rerender } = renderMap({ onSelect, onMapClick });
    loadStyle(map);
    const click = (features, lngLat = { lng: -68.36, lat: 18.564 }) => {
      fake.state.setRenderedFeatures(map, () => features);
      return act(async () => fake.state.emit(map, 'click', { point: { x: 100, y: 100 }, lngLat }));
    };

    // A stand is picked by its polygon.
    await click([{ id: 'B21', layer: { id: 'occ-stands-fill' }, properties: { code: 'B21' } }]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'stand', id: 'B21' });
    await click([]);
    expect(onSelect).toHaveBeenCalledOnce();

    // A terminal chip opens that terminal's view and writes it in the URL; it selects nothing.
    await click([{ id: 'B', layer: { id: 'occ-stand-groups' }, properties: { terminal: 'B', text: 'B · 1/17' } }]);
    expect([query().get('view'), query().get('terminal')]).toEqual(['ramp', 'B']);
    expect(onSelect).toHaveBeenCalledOnce();

    // While placing a stand the click gives its point and selects nothing.
    rerender({ onSelect, onMapClick, placing: true });
    expect(map.getCanvas().style.cursor).toBe('crosshair');
    await click([{ id: 'B21', layer: { id: 'occ-stands-fill' }, properties: { code: 'B21' } }], { lng: -68.3611, lat: 18.5649 });
    expect(onMapClick).toHaveBeenCalledExactlyOnceWith({ latitude: 18.5649, longitude: -68.3611 });
    expect(onSelect).toHaveBeenCalledOnce();

    // The cursor: one pick per frame, a pointer over what can be chosen, a chip included.
    rerender({ onSelect, onMapClick, placing: false });
    expect(map.getCanvas().style.cursor).toBe('');
    const frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    let picks = 0;
    let under = [{ id: 'A5', layer: { id: 'occ-stands-fill' }, properties: { code: 'A5' } }];
    fake.state.setRenderedFeatures(map, () => {
      picks += 1;
      return under;
    });
    for (const x of [10, 11, 12]) fake.state.emit(map, 'mousemove', { point: { x, y: 10 }, lngLat: { lng: -68.36, lat: 18.56 } });
    expect(frames).toHaveLength(1);
    expect(picks).toBe(0);
    frames.shift()(0);
    expect(picks).toBe(1);
    expect(map.getCanvas().style.cursor).toBe('pointer');
    fake.state.emit(map, 'mouseout');
    frames.shift()(16);
    expect(map.getCanvas().style.cursor).toBe('');
    under = [{ id: 'A', layer: { id: 'occ-stand-groups' }, properties: { terminal: 'A' } }];
    fake.state.emit(map, 'mousemove', { point: { x: 40, y: 40 }, lngLat: { lng: -68.36, lat: 18.56 } });
    frames.shift()(32);
    expect(map.getCanvas().style.cursor).toBe('pointer');
  });

  it('flies to presets, stands and bounds through its handle', () => {
    const { map, ref } = renderMap();
    loadStyle(map);
    const { fits } = probe();
    act(() => ref.current.flyToPreset('region'));
    expect(map.getZoom()).toBeCloseTo(fits.region, 6);
    // Only flying: the URL keeps no view for a call of the page.
    expect(query().has('view')).toBe(false);
    act(() => ref.current.flyToPuj());
    expect(map.getZoom()).toBeCloseTo(fits.airfield, 6);
    act(() => ref.current.flyToAll());
    expect(map.getZoom()).toBeCloseTo(fits.ramp, 6);

    act(() => ref.current.flyToStand('a05'));
    expect(map.getCenter().toArray()).toEqual(standPoint('A5'));
    expect(map.getZoom()).toBeCloseTo(fits.ramp + 1.5, 6);
    act(() => ref.current.flyToStand('A6', { minZoom: 18.5 }));
    expect(map.getZoom()).toBe(18.5);
    // Closer than asked stays closer; an unknown stand moves nothing.
    act(() => ref.current.flyToStand('A7', { minZoom: 15 }));
    expect(map.getZoom()).toBe(18.5);
    expect(ref.current.flyToStand('Z9')).toBe(false);

    act(() => ref.current.flyToBounds([standPoint('A1'), standPoint('A11')]));
    const span = standPoint('A1')[0] - standPoint('A11')[0];
    expect(map.getZoom()).toBeCloseTo(Math.log2(((1440 - 140) * 360) / (512 * span)), 6);
    expect(ref.current.flyToBounds([])).toBe(false);

    act(() => map.jumpTo({ bearing: -17 }));
    act(() => ref.current.resetNorth());
    expect(map.cameraCalls.at(-1)).toEqual({ method: 'easeTo', options: { bearing: 0, duration: 400, essential: false } });
    expect(ref.current.getCamera()).toMatchObject({ bearing: 0, zoom: map.getZoom() });
    // A camera put at once, without an animation (the lab sets a zoom between two thresholds with it).
    let jumped = false;
    act(() => {
      jumped = ref.current.jumpTo({ zoom: fits.airfield - 0.6 });
    });
    expect(jumped).toBe(true);
    expect(map.cameraCalls.at(-1)).toEqual({ method: 'jumpTo', options: { zoom: fits.airfield - 0.6 } });

    // The pixel of a point inside the map, as a plain object: the centre sits in the middle of the 1440 × 900 map.
    act(() => ref.current.flyToStand('A5'));
    expect(ref.current.project(standPoint('A5'))).toEqual({ x: 720, y: 450 });
    expect(Object.getPrototypeOf(ref.current.project(standPoint('A6')))).toBe(Object.prototype);
  });

  it('waits through its handle for a frame with nothing left to draw', async () => {
    const { map, ref } = renderMap();
    loadStyle(map);
    const idle = ref.current.whenIdle();
    act(() => fake.state.emit(map, 'idle'));
    await expect(idle).resolves.toBe(true);
    cleanup();
    fake.state.reset({ constructorError: new GPUInitializationError() });
    const failing = renderMap();
    await screen.findByRole('alert');
    await expect(failing.ref.current.whenIdle()).resolves.toBe(false);
  });

  it('starts the map with the extra MapLibre options it is given, keeping its own locale', () => {
    const { map } = renderMap({ mapOptions: { fadeDuration: 0, locale: { 'Map.Title': 'Otro' } } });
    expect(map.options.fadeDuration).toBe(0);
    expect(map.options.locale).toMatchObject({ 'Map.Title': 'Mapa del OCC', 'NavigationControl.ZoomIn': 'Acercar' });
    cleanup();
    // Without them the engine keeps its own fade.
    render(<OccMap stands={STANDS} />);
    expect(fake.state.liveMaps().at(-1).options.fadeDuration).toBe(150);
  });

  it('answers no pixel without a map', async () => {
    fake.state.reset({ constructorError: new GPUInitializationError() });
    const { ref } = renderMap();
    expect(ref.current.project(standPoint('A5'))).toBeNull();
    await screen.findByRole('alert');
  });

  it('tilts in 3D, shows the 3D buildings when asked and names its controls in Spanish', () => {
    const { map, rerender } = renderMap({ pitchMode: '2d' });
    loadStyle(map);
    expect(map.options.locale).toMatchObject({
      'Map.Title': 'Mapa del OCC', 'NavigationControl.ZoomIn': 'Acercar', 'NavigationControl.ZoomOut': 'Alejar',
      'ScaleControl.NauticalMiles': 'NM',
    });
    expect(map.getPitch()).toBe(0);
    rerender({ pitchMode: '3d', groups: { 'buildings-3d': true } });
    expect(map.cameraCalls.at(-1)).toEqual({ method: 'easeTo', options: { pitch: 55, bearing: -17, duration: 600, essential: false } });
    expect(map.getLayer('building-3d').layout.visibility).toBe('visible');
    // The region view stays flat, in 3D as well; the airfield tilts less than the ramp.
    press(map.getCanvas(), '1');
    expect([map.getPitch(), map.getBearing()]).toEqual([0, 0]);
    press(map.getCanvas(), '3');
    expect([map.getPitch(), map.getBearing()]).toEqual([40, -17]);
    press(map.getCanvas(), '4');
    expect([map.getPitch(), map.getBearing()]).toEqual([55, -17]);
    rerender({ pitchMode: '3d', groups: { 'buildings-3d': false } });
    expect(map.getLayer('building-3d').layout.visibility).toBe('none');
  });

  it('draws the stands as polygons: one setData at start, then updateData with only the changed stands', () => {
    const { map, rerender } = renderMap({ overlays: [EXTRA_OVERLAY] });
    loadStyle(map);
    const ids = map.layerIds();
    expect(ids.slice(ids.indexOf('slot-stands') + 1, ids.indexOf('slot-routes'))).toEqual([
      'occ-stands-fill', 'occ-stands-hatch', 'occ-stands-outline-solid', 'occ-stands-outline-dash-4-3',
      'occ-stands-outline-dash-2-2', 'occ-stands-outline-dot-1-3', 'occ-stands-leadin', 'occ-stands-leadin-arriving',
      'occ-stands-combined-link', 'occ-stands-narrow-inner', 'occ-stands-selection', 'occ-stands-related',
      'occ-stands-same-agent',
    ]);
    // A screen's own overlays come after the map's in their slot.
    expect(ids.slice(ids.indexOf('slot-standLabels') + 1, ids.indexOf('slot-traffic'))).toEqual([
      'occ-stand-groups', 'occ-stand-groups-arriving', 'occ-stand-glyph', 'occ-stand-clock', 'occ-stand-labels',
      'occ-stand-labels-3', 'occ-stand-label-selected', 'occ-stand-label-selected-3', 'occ-stand-signal', 'test-notes',
    ]);
    const sources = ['occ-stands', 'occ-stand-aux', 'occ-stand-labels', 'occ-stand-groups'].map(id => map.getSource(id));
    // One setData per source when the map starts, and no clustering any more.
    expect(sources.map(source => source.setDataCalls.length)).toEqual([1, 1, 1, 1]);
    expect(sources.map(source => source.updateDataCalls.length)).toEqual([0, 0, 0, 0]);
    expect(sources[0].spec).toEqual({ type: 'geojson', promoteId: 'code', data: { type: 'FeatureCollection', features: [] } });
    const [polygons, , labels, groups] = sources;
    expect(polygons.data.features).toHaveLength(41);
    expect(polygons.data.features.every(feature => feature.geometry.type === 'Polygon')).toBe(true);
    // Where each polygon is: the layout's, moved rigidly where OCC placed the stand.
    const a1 = DRAWN.find(stand => stand.id === 'A1');
    expect(polygons.data.features.find(feature => feature.id === 'A1')).toEqual({
      type: 'Feature', id: 'A1', properties: { code: 'A1', terminal: 'A', state: 'occupied', unofficial: false },
      geometry: { type: 'Polygon', coordinates: [a1.geometry.polygon] },
    });
    expect(labels.data.features.find(feature => feature.id === 'A1').properties).toMatchObject({ glyph: 'aircraft', label1: 'A1' });
    expect(groups.data.features.map(feature => feature.properties.text)).toEqual(['A · 1/16', 'B · 0/17', 'FBO · 0/8']);
    // Every stand layer starts at its derived threshold.
    const ranges = Object.fromEntries(map.zoomRangeCalls.map(call => [call.id, call.minzoom]));
    for (const id of ['occ-stands-fill', 'occ-stands-hatch', 'occ-stands-outline-solid', 'occ-stand-glyph', 'occ-stand-signal']) {
      expect(ranges[id], id).toBe(probe().thresholds.polygons);
    }
    expect([ranges['occ-stand-labels'], ranges['occ-stands-leadin']]).toEqual([probe().thresholds.codes, probe().thresholds.codes]);
    expect(ranges['occ-stand-labels-3']).toBe(probe().thresholds.threeLine);
    expect(ranges['occ-stand-groups']).toBe(probe().thresholds.airfield);

    // The same stands in new objects write nothing.
    rerender({ overlays: [EXTRA_OVERLAY], stands: createMapStands() });
    expect(sources.map(source => source.setDataCalls.length + source.updateDataCalls.length)).toEqual([1, 1, 1, 1]);
    // A2 now has an aircraft about to leave: one updateData per changed source, with A2 only (and its terminal's chip).
    rerender({ overlays: [EXTRA_OVERLAY], stands: createMapStands({ A2: { status: 'releasing' } }) });
    expect(sources.map(source => source.setDataCalls.length)).toEqual([1, 1, 1, 1]);
    const [polygonDiff] = polygons.updateDataCalls;
    expect(polygonDiff).toEqual({
      add: [], remove: [],
      update: [{ id: 'A2', addOrUpdateProperties: [{ key: 'state', value: 'releasing' }] }],
    });
    // Applied as MapLibre 6.16 applies it, the stand keeps every property it is drawn by.
    expect(polygons.data.features.find(feature => feature.id === 'A2').properties)
      .toEqual({ code: 'A2', terminal: 'A', state: 'releasing', unofficial: false });
    expect(labels.updateDataCalls.map(diff => diff.update.map(item => item.id))).toEqual([['A2']]);
    expect(map.getSource('occ-stand-aux').updateDataCalls.map(diff => diff.update.map(item => item.id))).toEqual([['leadIn:A2']]);
    expect(groups.updateDataCalls.map(diff => diff.update.map(item => item.id))).toEqual([['A']]);
    // OCC places A5 30 m east («Ubicar en el mapa»): its box moves rigidly and keeps everything it is drawn by, and its
    // label moves with it with its texts.
    const [placedLng, placedLat] = destinationPoint(standPoint('A5'), 90, 30);
    const placed = createMapStands({ A2: { status: 'releasing' }, A5: { latitude: placedLat, longitude: placedLng, locationSource: 'occ' } });
    rerender({ overlays: [EXTRA_OVERLAY], stands: placed });
    const a5 = attachStandGeometry(placed, MDPC_LAYOUT).find(stand => stand.id === 'A5');
    expect(polygons.data.features.find(feature => feature.id === 'A5')).toEqual({
      type: 'Feature', id: 'A5', properties: { code: 'A5', terminal: 'A', state: 'available', unofficial: false },
      geometry: { type: 'Polygon', coordinates: [a5.geometry.polygon] },
    });
    expect(labels.data.features.find(feature => feature.id === 'A5')).toMatchObject({
      properties: { code: 'A5', label1: 'A5' }, geometry: { coordinates: a5.geometry.center },
    });
    expect(fake.state.maps).toEqual([map]);
    cleanup();

    // A map given no stands has no stand sources; one given an empty list is ready for them.
    expect(createMapWithout('stands')).toBeUndefined();
    render(<OccMap stands={[]} />);
    const empty = fake.state.liveMaps().at(-1);
    loadStyle(empty);
    for (const id of ['occ-stands', 'occ-stand-aux', 'occ-stand-labels', 'occ-stand-groups']) {
      expect(empty.getSource(id).data.features, id).toEqual([]);
    }
  });

  it('says on its root whether it has drawn everything it was given (the visual suite waits on it)', () => {
    const { map, rerender } = renderMap();
    const root = screen.getByTestId('occ-map');
    // Its first view and its stands are written: nothing is drawn yet.
    expect(root).toHaveAttribute('data-occ-settled', 'false');
    loadStyle(map);
    act(() => fake.state.emit(map, 'idle'));
    expect(root).toHaveAttribute('data-occ-settled', 'true');
    // A board refresh that changes a stand, a camera move or another selected stand: not settled until the next idle.
    rerender({ stands: createMapStands({ A2: { status: 'planned' } }) });
    expect(root).toHaveAttribute('data-occ-settled', 'false');
    act(() => fake.state.emit(map, 'idle'));
    act(() => map.jumpTo({ zoom: 17 }));
    expect(root).toHaveAttribute('data-occ-settled', 'false');
    act(() => fake.state.emit(map, 'idle'));
    rerender({ stands: createMapStands({ A2: { status: 'planned' } }), selection: { kind: 'stand', id: 'A2' } });
    expect(root).toHaveAttribute('data-occ-settled', 'false');
    act(() => fake.state.emit(map, 'idle'));
    expect(root).toHaveAttribute('data-occ-settled', 'true');
    // The same positions read again change nothing to draw.
    rerender({ stands: createMapStands({ A2: { status: 'planned' } }), selection: { kind: 'stand', id: 'A2' } });
    expect(root).toHaveAttribute('data-occ-settled', 'true');
  });

  it('a minute tick updates only the labels whose countdown changed', () => {
    vi.useFakeTimers({ now: NOW + 20 * 1000, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      // The screen read its stands at NOW; the map counts their times down on its own minute.
      const stands = scenarioStands();
      const { map } = renderMap({ stands });
      loadStyle(map);
      const sources = ['occ-stands', 'occ-stand-aux', 'occ-stand-labels', 'occ-stand-groups'].map(id => map.getSource(id));
      const countdowns = sources[2].data.features.filter(feature => / · en \d+ min/.test(feature.properties.label3))
        .map(feature => feature.id);
      expect(countdowns).toEqual(['A2', 'A3', 'A4', 'A5', 'A6', 'A9']);
      act(() => vi.advanceTimersByTime(39 * 1000));
      expect(sources.map(source => source.updateDataCalls.length)).toEqual([0, 0, 0, 0]);
      act(() => vi.advanceTimersByTime(1000));
      // One updateData on the labels, with exactly the countdowns; the polygons, lines and chips are not touched.
      expect(sources.map(source => source.updateDataCalls.length)).toEqual([0, 0, 1, 0]);
      expect(sources[2].updateDataCalls[0].update.map(item => item.id)).toEqual(countdowns);
      expect(sources[2].updateDataCalls[0]).toEqual(diffStandFeatures(
        buildStandFeatures(attachStandGeometry(stands, MDPC_LAYOUT), { nowMs: NOW }),
        buildStandFeatures(attachStandGeometry(stands, MDPC_LAYOUT), { nowMs: NOW + MINUTE }),
      ).labels);
      expect(sources.map(source => source.setDataCalls.length)).toEqual([1, 1, 1, 1]);
      cleanup();

      // A frozen clock (the map lab) never ticks.
      const frozen = renderMap({ stands, frozenAt: NOW });
      loadStyle(frozen.map);
      act(() => vi.advanceTimersByTime(5 * MINUTE));
      expect(frozen.map.getSource('occ-stand-labels').updateDataCalls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws the flights it is given that carry a position and centres one through flyToFlight', () => {
    const ref = createRef();
    const onSelect = vi.fn();
    const { rerender } = render(<OccMap ref={ref} flights={FLIGHTS} defaultView="region" onSelect={onSelect} />);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    const source = map.getSource('occ-flights');
    expect(source.setDataCalls).toHaveLength(1);
    expect(source.data.features).toEqual([{
      type: 'Feature', properties: { id: 'l:leg-1', heading: 120 }, geometry: { type: 'Point', coordinates: [-68.52, 18.71] },
    }]);
    const ids = map.layerIds();
    expect(ids[ids.indexOf('slot-traffic') + 1]).toBe('occ-flights');

    const zoom = map.getZoom();
    act(() => ref.current.flyToFlight('l:leg-1'));
    expect(map.getCenter().toArray()).toEqual([-68.52, 18.71]);
    expect(map.getZoom()).toBeCloseTo(zoom, 9);
    act(() => ref.current.flyToFlight('l:leg-1', { minZoom: 12 }));
    expect(map.getZoom()).toBe(12);
    // A flight without a position, or an unknown one, moves nothing.
    expect(ref.current.flyToFlight('p:prop-2')).toBe(false);
    expect(ref.current.flyToFlight('l:leg-9')).toBe(false);

    // A symbol click selects the flight.
    fake.state.setRenderedFeatures(map, () => [{ id: 'l:leg-1', layer: { id: 'occ-flights' }, properties: { id: 'l:leg-1' } }]);
    act(() => fake.state.emit(map, 'click', { point: { x: 10, y: 10 }, lngLat: { lng: -68.52, lat: 18.71 } }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'flight', id: 'l:leg-1' });
    // New positions are one more write on the same map.
    rerender(<OccMap ref={ref} flights={[{ ...FLIGHTS[0], latitude: 18.72 }, FLIGHTS[1]]} defaultView="region" onSelect={onSelect} />);
    expect(source.setDataCalls).toHaveLength(2);
    expect(fake.state.maps).toEqual([map]);
    // A map given no flights has no flight layer.
    expect(createMapWithout('flights')).toBeUndefined();
  });

  it('overlayData fills a custom overlay source with one setData per change; onPick hears hits that are not selections', async () => {
    const onPick = vi.fn();
    const onSelect = vi.fn();
    const props = data => ({ overlays: [PIN_OVERLAY], overlayData: { 'test-pins': data }, onPick, onSelect });
    const { map, rerender } = renderMap(props(pins(['p1'])));
    // Given before the style loads, written once it has.
    expect(map.getSource('test-pins')).toBeUndefined();
    loadStyle(map);
    const source = map.getSource('test-pins');
    expect(source.setDataCalls).toHaveLength(1);
    expect(source.data).toEqual(pins(['p1']));
    // The same features in new objects write nothing; a change writes once, on the same map.
    rerender(props(pins(['p1'])));
    expect(source.setDataCalls).toHaveLength(1);
    rerender(props(pins(['p1', 'p2'])));
    expect(source.setDataCalls).toHaveLength(2);
    expect(source.data.features).toHaveLength(2);
    expect(fake.state.maps).toEqual([map]);

    // A click on a pick of the screen's own kind reaches onPick as the engine answers it, and selects nothing.
    const click = features => {
      fake.state.setRenderedFeatures(map, () => features);
      return act(async () => fake.state.emit(map, 'click', { point: { x: 100, y: 100 }, lngLat: { lng: -68.36, lat: 18.56 } }));
    };
    await click([{ layer: { id: 'test-pins' }, properties: { id: 'p2' } }]);
    expect(onPick).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'pin', id: 'p2' }));
    expect(onSelect).not.toHaveBeenCalled();
    // A stand is still a selection, a runway still its card, and a pick without an id is nothing.
    await click([{ layer: { id: 'occ-stands-fill' }, properties: { code: 'B21' } }]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'stand', id: 'B21' });
    await click([RUNWAY_08]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pista 08/26');
    await click([{ layer: { id: 'test-pins' }, properties: {} }]);
    expect(onPick).toHaveBeenCalledOnce();

    // The cursor says that a pick the screen hears can be clicked.
    const frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    fake.state.setRenderedFeatures(map, () => [{ layer: { id: 'test-pins' }, properties: { id: 'p1' } }]);
    fake.state.emit(map, 'mousemove', { point: { x: 100, y: 100 }, lngLat: { lng: -68.36, lat: 18.56 } });
    act(() => frames.shift()(0));
    expect(map.getCanvas().style.cursor).toBe('pointer');
    cleanup();

    // Without onPick the same pick is not a thing to click, and a click on it does nothing.
    fake.state.reset();
    window.history.replaceState({}, '', PAGE);
    const plain = renderMap({ overlays: [PIN_OVERLAY], overlayData: { 'test-pins': pins(['p1']), 'missing-source': pins([]) } });
    loadStyle(plain.map);
    expect(plain.map.getSource('test-pins').setDataCalls).toHaveLength(1);
    fake.state.setRenderedFeatures(plain.map, () => [{ layer: { id: 'test-pins' }, properties: { id: 'p1' } }]);
    fake.state.emit(plain.map, 'mousemove', { point: { x: 100, y: 100 }, lngLat: { lng: -68.36, lat: 18.56 } });
    act(() => frames.shift()(0));
    expect(plain.map.getCanvas().style.cursor).toBe('');
  });

  it('always marks PUJ with its reference point, up to the codes threshold', () => {
    const { map } = renderMap();
    loadStyle(map);
    expect(map.getSource('occ-reference').data).toEqual(referenceFeatures());
    // What is drawn from OurAirports goes on its own source, with the credit of OurAirports (PR M8).
    expect(map.getSource('occ-reference-ourairports').data).toEqual(ourAirportsFeatures());
    expect(map.getSource('occ-reference-ourairports').spec.attribution).toContain('https://ourairports.com/');
    expect(map.getSource('occ-reference').spec.attribution).toBeUndefined();
    expect(map.zoomRangeCalls.find(call => call.id === 'occ-reference-arp'))
      .toEqual({ id: 'occ-reference-arp', minzoom: 0, maxzoom: probe().thresholds.codes });
    // Above the pavement of the tiles, the last layer under the stands.
    const ids = map.layerIds();
    expect(ids[ids.indexOf('slot-stands') - 1]).toBe('occ-reference-arp');
    expect(ids.indexOf('occ-reference-arp')).toBeGreaterThan(ids.indexOf('airfield-runway'));
  });

  it('fills the airfield source from the dataset at start and applies the airfield threshold after the fit', () => {
    const { map } = renderMap({ children: <MapLegend /> });
    loadStyle(map);
    // The dataset, written once, with the credit of its data on its source.
    const source = map.getSource('occ-airfield');
    expect(source.data).toEqual(airfieldFeatures(MDPC_LAYOUT));
    expect(source.setDataCalls).toHaveLength(1);
    expect(source.spec.attribution).toBe(AIRFIELD_ATTRIBUTION);
    // In the airfield slot, above the tile aeroway and under the mark of PUJ.
    const ids = map.layerIds();
    expect(ids.slice(ids.indexOf('slot-airfield') + 1, ids.indexOf('slot-stands'))).toEqual([
      'airfield-apron', 'airfield-runway-area', 'airfield-taxiway', 'airfield-runway', 'airfield-runway-ref',
      ...AIRFIELD_LAYER_IDS, 'occ-reference-counterpart-labels', 'occ-reference-arp',
    ]);

    // From the derived threshold, the boundary of the Aeródromo view, the dataset draws the airfield; the tiles stop.
    const { fits, thresholds } = probe();
    expect(thresholds.airfield).toBeCloseTo((fits.approach + fits.airfield) / 2, 9);
    const ranges = () => Object.fromEntries(map.zoomRangeCalls.map(call => [call.id, [call.minzoom, call.maxzoom]]));
    for (const id of AIRFIELD_LAYER_IDS) expect(ranges()[id], id).toEqual([thresholds.airfield, 24]);
    expect(ranges()['airfield-runway']).toEqual([9, thresholds.airfield]);
    expect(ranges()['airfield-apron']).toEqual([11, thresholds.airfield]);
    // The airfield view sits above the threshold and the approach view below it.
    expect(fits.airfield).toBeGreaterThan(thresholds.airfield);
    expect(fits.approach).toBeLessThan(thresholds.airfield);
    // A narrower map lowers the fits and the threshold with them.
    act(() => fake.state.resize(map, { width: 1000 }));
    expect(probe().thresholds.airfield).toBeLessThan(thresholds.airfield);
    expect(ranges()['occ-airfield-runway'][0]).toBeCloseTo(probe().thresholds.airfield, 9);
    expect(ranges()['airfield-taxiway'][1]).toBeCloseTo(probe().thresholds.airfield, 9);

    // What the map draws of the airfield in sight reaches the legend, read again when the map settles.
    const asked = [];
    const drawn = [RUNWAY_08, TAXIWAY_A, airfieldDrawn('occ-airfield-apron', { kind: 'apron', id: 'apron-1' })];
    fake.state.setRenderedFeatures(map, (geometry, options) => {
      if (options.layers.includes('occ-airfield-runway')) asked.push({ geometry, layers: options.layers });
      return drawn.filter(feature => options.layers.includes(feature.layer.id));
    });
    act(() => fake.state.emit(map, 'idle'));
    expect(asked.at(-1)).toEqual({ geometry: [[0, 0], [1000, 900]], layers: [...AIRFIELD_LAYER_IDS] });
    expect(probe().airfieldOnScreen).toEqual(['runway', 'taxiway', 'apron']);
    const legend = () => within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem').map(item => item.textContent);
    expect(legend().slice(-3)).toEqual(['Pista', 'Calle de rodaje', 'Plataforma']);
    // Below the threshold (the region view) nothing of the airfield is drawn: the map is not asked and nothing is listed.
    const questions = asked.length;
    press(map.getCanvas(), '1');
    act(() => fake.state.emit(map, 'idle'));
    expect(probe().airfieldOnScreen).toEqual([]);
    expect(asked).toHaveLength(questions);
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    cleanup();

    // Without a layout: no airfield of its own, the tile aeroway keeps every zoom and the stand points frame the views.
    fake.state.reset();
    window.history.replaceState({}, '', PAGE);
    const plain = renderMap({ layout: null });
    loadStyle(plain.map);
    expect(plain.map.getSource('occ-airfield')).toBeUndefined();
    expect(plain.map.zoomRangeCalls.filter(call => call.id.startsWith('airfield-') || call.id.startsWith('occ-airfield'))).toEqual([]);
    const pointRamp = presetTargets({ stands: STANDS }).ramp.bounds;
    expect(probe().fits.ramp).toBeCloseTo(Math.log2((1440 * 360) / (512 * (pointRamp[1][0] - pointRamp[0][0]))), 9);
    expect(probe().airfieldOnScreen).toEqual([]);
  });

  it('hovering or clicking a runway shows its designator, length and width; a taxiway its name; a click elsewhere closes it', async () => {
    const frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    const onSelect = vi.fn();
    const { map, rerender } = renderMap({ onSelect });
    loadStyle(map);
    let under = [];
    fake.state.setRenderedFeatures(map, (_geometry, options) => under.filter(feature => options.layers.includes(feature.layer.id)));
    const card = () => screen.queryByRole('tooltip');
    const at = ({ x, y }) => ({ point: { x, y }, lngLat: map.unproject([x, y]) });
    // The pointer over `features`, then the frame that reads what is under it.
    const hover = (features, point = { x: 400, y: 300 }, originalEvent = undefined) => {
      under = features;
      act(() => {
        fake.state.emit(map, 'mousemove', { ...at(point), originalEvent });
        frames.shift()?.(0);
      });
    };
    const click = async (features, point = { x: 400, y: 300 }) => {
      under = features;
      await act(async () => fake.state.emit(map, 'click', at(point)));
    };

    // A runway under the pointer: its designator, length and width from the dataset, next to the pointer.
    hover([RUNWAY_08]);
    expect(card()).toHaveTextContent('Pista 08/26 · 3100 m × 45 m');
    expect(card()).toHaveAttribute('data-pinned', 'false');
    expect(card()).toHaveStyle({ left: '400px', top: '300px', transform: 'translate(12px, 12px)' });
    expect(map.getCanvas().style.cursor).toBe('pointer');
    // A taxiway: its name, on the side with room (the lower right of the map puts the card above and to the left).
    hover([TAXIWAY_A], { x: 1000, y: 700 });
    expect(card()).toHaveTextContent('Calle de rodaje A');
    expect(card()).toHaveStyle({ left: '1000px', top: '700px', transform: 'translate(calc(-100% - 12px), calc(-100% - 12px))' });
    // The same taxiway further along keeps its card where it is: nothing is written on every frame.
    hover([TAXIWAY_A], { x: 1010, y: 705 });
    expect(card()).toHaveStyle({ left: '1000px' });
    hover([TAXIWAY_UNNAMED]);
    expect(card()).toHaveTextContent('Calle de rodaje sin nombre');
    // Nothing of the airfield under the pointer, a drag, or the pointer leaving the map: no card.
    hover([]);
    expect(card()).toBeNull();
    expect(map.getCanvas().style.cursor).toBe('');
    hover([RUNWAY_08], { x: 400, y: 300 }, new MouseEvent('mousemove', { buttons: 1 }));
    expect(card()).toBeNull();
    hover([RUNWAY_08]);
    act(() => {
      fake.state.emit(map, 'mouseout');
      frames.shift()?.(0);
    });
    expect(card()).toBeNull();

    // A click holds it: the pointer leaving the runway or the map does not close it, and nothing is selected.
    await click([RUNWAY_08]);
    expect(card()).toHaveTextContent('Pista 08/26 · 3100 m × 45 m');
    expect(card()).toHaveAttribute('data-pinned', 'true');
    hover([]);
    act(() => {
      fake.state.emit(map, 'mouseout');
      frames.shift()?.(0);
    });
    expect(card()).toHaveAttribute('data-pinned', 'true');
    expect(onSelect).not.toHaveBeenCalled();
    // It is a card on the map, not a modal: no dialog, and it never takes the pointer.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card()).not.toHaveAttribute('aria-modal');
    expect(card()).toHaveClass('pointer-events-none');
    // Held, it follows its point when the map moves, and closes when the point leaves the map.
    const held = at({ x: 400, y: 300 }).lngLat;
    act(() => map.jumpTo({ center: map.unproject([600, 450]) }));
    const moved = map.project(held);
    expect(card()).toHaveStyle({ left: `${moved.x}px`, top: `${moved.y}px` });
    act(() => map.jumpTo({ center: [-70.55, 19.45] }));
    expect(card()).toBeNull();

    // A click anywhere else closes it; so does another view; a click on a stand selects the stand and closes it.
    act(() => map.jumpTo({ center: standPoint('A5'), zoom: 15 }));
    await click([RUNWAY_08]);
    await click([]);
    expect(card()).toBeNull();
    await click([TAXIWAY_A]);
    expect(card()).toHaveTextContent('Calle de rodaje A');
    press(map.getCanvas(), '1');
    expect(card()).toBeNull();
    press(map.getCanvas(), '4');
    await click([RUNWAY_08]);
    await click([{ id: 'B21', layer: { id: 'occ-stands-fill' }, properties: { code: 'B21' } }]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'stand', id: 'B21' });
    expect(card()).toBeNull();
    // While a stand is being placed, no card shows and a held one closes.
    await click([RUNWAY_08]);
    rerender({ onSelect, placing: true });
    expect(card()).toBeNull();
    hover([RUNWAY_08]);
    expect(card()).toBeNull();
    cleanup();

    // In English.
    resetLanguageForTests('en');
    render(<LanguageScope><OccMap stands={STANDS} /></LanguageScope>);
    const english = fake.state.liveMaps().at(-1);
    loadStyle(english);
    fake.state.setRenderedFeatures(english, (_geometry, options) => (options.layers.includes('occ-airfield-runway') ? [RUNWAY_08] : []));
    await act(async () => fake.state.emit(english, 'click', { point: { x: 400, y: 300 }, lngLat: english.unproject([400, 300]) }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Runway 08/26 · 3100 m × 45 m');
  });

  it('hover shows the stand tooltip and sets hover and sameAgent feature-state, never setData', () => {
    const frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    const stands = scenarioStands();
    const { map, rerender } = renderMap({ stands, frozenAt: NOW });
    loadStyle(map);
    const sourceIds = ['occ-stands', 'occ-stand-aux', 'occ-stand-labels', 'occ-stand-groups', 'occ-stand-ghost', 'occ-selection'];
    const writes = () => sourceIds.map(id => map.getSource(id).setDataCalls.length + map.getSource(id).updateDataCalls.length);
    const before = writes();
    const card = () => screen.queryByRole('tooltip');
    const stateOf = code => map.featureStateOf('occ-stands', code) ?? {};
    const pick = code => ({ id: code, layer: { id: 'occ-stands-fill' }, properties: { code } });
    let under = [];
    fake.state.setRenderedFeatures(map, (_geometry, options) => under.filter(feature => options.layers.includes(feature.layer.id)));
    const hover = (features, originalEvent) => {
      under = features;
      act(() => {
        fake.state.emit(map, 'mousemove', { point: { x: 500, y: 400 }, lngLat: { lng: -68.36, lat: 18.564 }, originalEvent });
        frames.shift()?.(0);
      });
    };

    // A1: Marta covers it and A2 and A6 too. The card says its code, state and agent; the marks are feature-state.
    hover([pick('A1')]);
    expect(card()).toHaveAttribute('data-kind', 'stand');
    expect(card()).toHaveTextContent('A1 · Libre');
    expect(card()).toHaveTextContent('Cubre Marta Castillo');
    expect(map.getCanvas().style.cursor).toBe('pointer');
    // Under or over A1's box, never on the stand or its label: A1 is the stand furthest east, so the card starts at the
    // box's east side and runs west, towards the middle of the map.
    const pixels = attachStandGeometry(stands, MDPC_LAYOUT).find(stand => stand.id === 'A1').geometry.polygon
      .map(point => map.project(point));
    const ys = pixels.map(point => point.y);
    expect(card().style.left).toBe(`${Math.max(...pixels.map(point => point.x))}px`);
    expect([`${Math.min(...ys)}px`, `${Math.max(...ys)}px`]).toContain(card().style.top);
    expect(card().style.transform).toMatch(/^translate\(calc\(-100% - 12px\), /);
    expect(stateOf('A1')).toEqual({ hover: true });
    expect([stateOf('A2'), stateOf('A6')]).toEqual([{ sameAgent: true }, { sameAgent: true }]);
    // The selection casing shows lighter under the pointer: the same layer reads the hover.
    expect(map.getLayer('occ-stands-selection').paint['line-opacity']).toEqual(expect.arrayContaining([['boolean', ['feature-state', 'hover'], false]]));
    // Up close, where A1's box fills more than half the map, the card goes back to the pointer.
    const ramp = map.getCenter().toArray();
    const rampZoom = map.getZoom();
    hover([]);
    act(() => map.jumpTo({ center: standPoint('A1'), zoom: 19.5 }));
    hover([pick('A1')]);
    expect(card()).toHaveStyle({ left: '500px', top: '400px' });
    hover([]);
    act(() => map.jumpTo({ center: ramp, zoom: rampZoom }));
    hover([pick('A1')]);

    // A3: arriving and covered by nobody: its signal in the card; Marta's marks go.
    hover([pick('A3')]);
    expect(card()).toHaveTextContent('A3 · Llegando');
    expect(within(card()).getByRole('img', { name: 'Atención' })).toBeInTheDocument();
    expect(card()).toHaveTextContent('Sin agente que la cubra');
    expect([stateOf('A1'), stateOf('A2'), stateOf('A6'), stateOf('A3')]).toEqual([{}, {}, {}, { hover: true }]);
    // A drag shows no card and marks nothing; leaving the map clears everything.
    hover([pick('A1')], new MouseEvent('mousemove', { buttons: 1 }));
    expect(card()).toBeNull();
    expect(stateOf('A1')).toEqual({});
    hover([pick('A1')]);
    act(() => {
      fake.state.emit(map, 'mouseout');
      frames.shift()?.(0);
    });
    expect(card()).toBeNull();
    expect([stateOf('A1'), stateOf('A2'), stateOf('A6')]).toEqual([{}, {}, {}]);
    // Never a write to a source: the pointer only changes feature-state.
    expect(writes()).toEqual(before);

    // With A4 selected (Luis covers A4, A5 and B22), the pointer over A1 shows Marta's stands and leaving gives the
    // marks back to the selection, which the legend explains.
    rerender({ stands, frozenAt: NOW, selection: { kind: 'stand', id: 'A4' } });
    expect([stateOf('A4'), stateOf('A5'), stateOf('B22')]).toEqual([{ selected: true }, { sameAgent: true }, { sameAgent: true }]);
    expect(probe().marks).toContain('sameAgent');
    hover([pick('A1')]);
    expect([stateOf('A5'), stateOf('A2'), stateOf('A6')]).toEqual([{}, { sameAgent: true }, { sameAgent: true }]);
    hover([]);
    expect([stateOf('A5'), stateOf('B22'), stateOf('A2')]).toEqual([{ sameAgent: true }, { sameAgent: true }, {}]);
    // A refresh with new coverage moves the marks: B22 is no longer Luis's.
    rerender({
      stands: stands.map(stand => (stand.id === 'B22' ? { ...stand, coveredBy: [SCENARIO_AGENTS.ana] } : stand)),
      frozenAt: NOW, selection: { kind: 'stand', id: 'A4' },
    });
    expect([stateOf('A5'), stateOf('B22')]).toEqual([{ sameAgent: true }, {}]);
    rerender({ stands, frozenAt: NOW, selection: null });
    expect(probe().marks).not.toContain('sameAgent');
    expect([stateOf('A4'), stateOf('A5')]).toEqual([{}, {}]);
  });

  it('the legend explains the same-agent ring the map draws, and whose agent it follows, as the pointer moves', () => {
    const frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    const stands = scenarioStands();
    const { map, rerender } = renderMap({ stands, frozenAt: NOW, children: <MapLegend /> });
    loadStyle(map);
    const pick = code => ({ id: code, layer: { id: 'occ-stands-fill' }, properties: { code } });
    let under = [];
    fake.state.setRenderedFeatures(map, (_geometry, options) => under.filter(feature => options.layers.includes(feature.layer.id)));
    const hover = features => {
      under = features;
      act(() => {
        fake.state.emit(map, 'mousemove', { point: { x: 500, y: 400 }, lngLat: { lng: -68.36, lat: 18.564 } });
        frames.shift()?.(0);
      });
    };
    // The stands the feature-state rings, and the entries of the legend and the marks of the map that explain a ring.
    const ringed = () => stands.map(stand => stand.id).filter(code => map.featureStateOf('occ-stands', code)?.sameAgent === true);
    const SELECTED = 'Mismo agente que la posición elegida';
    const POINTED = 'Mismo agente que la posición bajo el puntero';
    const explained = () => within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem')
      .map(item => item.textContent).filter(text => text === SELECTED || text === POINTED);
    const ringMarks = () => probe().marks.filter(mark => mark.startsWith('sameAgent'));

    // Without a selection, the pointer over A1 rings Marta's other stands, and the legend says it follows the pointer.
    expect([ringed(), explained()]).toEqual([[], []]);
    hover([pick('A1')]);
    expect([ringed(), explained(), ringMarks()]).toEqual([['A2', 'A6'], [POINTED], ['sameAgentHover']]);
    hover([]);
    expect([ringed(), explained(), ringMarks()]).toEqual([[], [], []]);

    // With A4 selected, Luis's other stands are ringed, and the legend says they are the selected stand's.
    rerender({ stands, frozenAt: NOW, selection: { kind: 'stand', id: 'A4' }, children: <MapLegend /> });
    expect([ringed(), explained(), ringMarks()]).toEqual([['A5', 'B22'], [SELECTED], ['sameAgent']]);
    // Over A3, which nobody covers, the map rings no stand: the legend explains no ring, not even the selection's.
    hover([pick('A3')]);
    expect([ringed(), explained(), ringMarks()]).toEqual([[], [], []]);
    // Over A1 the ring is Marta's, and the legend follows the pointer, never naming the selected stand.
    hover([pick('A1')]);
    expect([ringed(), explained(), ringMarks()]).toEqual([['A2', 'A6'], [POINTED], ['sameAgentHover']]);
    // Over the selected stand itself, the ring is the selection's.
    hover([pick('A4')]);
    expect([ringed(), explained(), ringMarks()]).toEqual([['A5', 'B22'], [SELECTED], ['sameAgent']]);
    // Off the stands, the ring and its entry are the selection's again.
    hover([pick('A1')]);
    hover([]);
    expect([ringed(), explained(), ringMarks()]).toEqual([['A5', 'B22'], [SELECTED], ['sameAgent']]);
  });

  it('selecting a visible stand does not move the camera; one outside the safe area eases to it', () => {
    // A stand selected when the map starts is framed by the view: no move of its own.
    window.history.replaceState({}, '', PAGE);
    const { map, rerender, ref } = renderMap({ selection: { kind: 'stand', id: 'B21' } });
    loadStyle(map);
    const moves = () => map.cameraCalls.filter(call => call.method !== 'setPadding' && call.method !== 'jumpTo');
    expect(moves()).toEqual([]);
    // In the ramp view every stand is in sight: selecting one moves nothing.
    rerender({ selection: { kind: 'stand', id: 'A1' } });
    rerender({ selection: { kind: 'stand', id: 'BN13' } });
    expect(moves()).toEqual([]);

    // Up close on A2: A3 is in sight, B21 is not.
    act(() => map.jumpTo({ center: standPoint('A2'), zoom: 18 }));
    rerender({ selection: { kind: 'stand', id: 'A3' } });
    expect(moves()).toEqual([]);
    rerender({ selection: { kind: 'stand', id: 'B21' } });
    const b21 = DRAWN.find(stand => stand.id === 'B21').geometry.center;
    // It eases, keeping the zoom, inside the insets.
    expect(moves()).toEqual([{
      method: 'easeTo',
      options: { center: b21, zoom: 18, padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: 600, essential: false },
    }]);
    expect(map.getZoom()).toBe(18);
    // The same selection again, or a re-read of the stands, moves nothing more.
    rerender({ selection: { kind: 'stand', id: 'B21' } });
    rerender({ selection: { kind: 'stand', id: 'B21' }, stands: createMapStands() });
    expect(moves()).toHaveLength(1);

    // A stand the page flies to itself (the search): the selection that follows adds no move of its own.
    act(() => ref.current.flyToStand('BN9'));
    rerender({ selection: { kind: 'stand', id: 'BN9' } });
    expect(moves()).toHaveLength(2);
    expect(moves()[1].options.center).toEqual(DRAWN.find(stand => stand.id === 'BN9').geometry.center);
    // A stand the map does not draw, or a flight, moves nothing.
    act(() => map.jumpTo({ center: standPoint('A2'), zoom: 18 }));
    rerender({ selection: { kind: 'stand', id: 'Z9' } });
    rerender({ selection: { kind: 'flight', id: 'leg-1' } });
    expect(moves()).toHaveLength(2);
  });

  it('while placing, the pointer moves the ghost once per frame and the click reports the snapped point', async () => {
    const frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    const onMapClick = vi.fn();
    const onSelect = vi.fn();
    const placingStand = { code: 'A5', sizeHint: null };
    const { map, rerender } = renderMap({ placingStand, onMapClick, onSelect, children: <MapLegend /> });
    loadStyle(map);
    const ghostSource = map.getSource('occ-stand-ghost');
    const a5 = MDPC_LAYOUT.stands.find(stand => stand.code === 'A5');
    fake.state.setRenderedFeatures(map, () => [{ id: 'A5', layer: { id: 'occ-stands-fill' }, properties: { code: 'A5' } }]);
    const lngLatOfPoint = point => ({ lng: point[0], lat: point[1] });
    expect(map.getCanvas().style.cursor).toBe('crosshair');

    // Three moves in one frame: one setData of the ghost source, with the box at the last pointer.
    const points = [10, 20, 40].map(metres => destinationPoint(a5.center, 90, metres));
    act(() => {
      for (const point of points) fake.state.emit(map, 'mousemove', { point: { x: 400, y: 300 }, lngLat: lngLatOfPoint(point) });
    });
    expect(frames).toHaveLength(1);
    expect(ghostSource.setDataCalls).toHaveLength(0);
    act(() => frames.shift()(0));
    expect(ghostSource.setDataCalls).toHaveLength(1);
    const last = placingGhost({ code: 'A5', pointer: points[2], layout: MDPC_LAYOUT });
    expect(ghostSource.data.features).toEqual(ghostFeatures({ ghost: last }).features);
    expect(ghostSource.data.features[0].properties).toMatchObject({ kind: 'ghost', snapped: false });
    // No tooltip and no hover mark while placing; the legend explains the box.
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(map.featureStateOf('occ-stands', 'A5') ?? {}).toEqual({});
    expect(probe().marks).toContain('ghost');
    // The same pointer again writes nothing; near the centre the box snaps to the layout's outline.
    act(() => {
      fake.state.emit(map, 'mousemove', { point: { x: 400, y: 300 }, lngLat: lngLatOfPoint(points[2]) });
      frames.shift()(16);
    });
    expect(ghostSource.setDataCalls).toHaveLength(1);
    act(() => {
      fake.state.emit(map, 'mousemove', { point: { x: 400, y: 300 }, lngLat: lngLatOfPoint(points[0]) });
      frames.shift()(32);
    });
    expect(ghostSource.data.features[0]).toMatchObject({ properties: { kind: 'ghost', snapped: true }, geometry: { coordinates: [a5.polygon] } });

    // The click gives the layout's centre when the box snapped, the pointer otherwise, and selects nothing.
    const click = point => act(async () => fake.state.emit(map, 'click', { point: { x: 400, y: 300 }, lngLat: lngLatOfPoint(point) }));
    await click(points[0]);
    expect(onMapClick).toHaveBeenLastCalledWith({ latitude: a5.center[1], longitude: a5.center[0], snapped: true });
    await click(points[2]);
    expect(onMapClick).toHaveBeenLastCalledWith({ latitude: points[2][1], longitude: points[2][0], snapped: false });
    expect(onSelect).not.toHaveBeenCalled();

    // The pending location the page keeps: its box and its centre, with the ghost.
    rerender({ placingStand, onMapClick, onSelect, children: <MapLegend />, pendingLocation: { latitude: points[2][1], longitude: points[2][0] } });
    expect(ghostSource.data.features.map(feature => feature.id)).toEqual(['pending', 'pending-centre', 'ghost']);
    expect(probe().marks).toEqual(expect.arrayContaining(['ghost', 'pending']));
    // The pointer leaving the map takes the ghost away and keeps the pending box.
    act(() => {
      fake.state.emit(map, 'mouseout');
      frames.shift()(48);
    });
    expect(ghostSource.data.features.map(feature => feature.id)).toEqual(['pending', 'pending-centre']);
    expect(probe().marks).not.toContain('ghost');
    // The placing ends: nothing left in the source, the cursor and the clicks are the map's again.
    rerender({ onMapClick, onSelect, children: <MapLegend /> });
    expect(ghostSource.data.features).toEqual([]);
    expect(map.getCanvas().style.cursor).toBe('');
    expect(probe().marks).not.toContain('pending');
    await click(points[2]);
    expect(onMapClick).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'stand', id: 'A5' });
  });

  it('imports occ-map.css and uses only occ-* classes (no opacity modifier)', () => {
    const component = readSource('src/features/maps/core/OccMap.jsx');
    expect(component).toMatch(/^import 'maplibre-gl\/dist\/maplibre-gl\.css';$/m);
    expect(component).toMatch(/^import '\.\.\/\.\.\/\.\.\/styles\/occ-map\.css';$/m);
    const files = [
      'src/features/maps/core/OccMap.jsx', 'src/features/maps/core/MapUnavailable.jsx',
      'src/features/maps/ui/MapLegend.jsx', 'src/features/maps/ui/MapPresetSwitcher.jsx', 'src/features/maps/ui/MapDock.jsx',
      'src/features/maps/ui/MapTooltip.jsx', 'src/features/maps/ui/StandDetailFacts.jsx',
      'src/features/positions-map/components/PositionMap.jsx', 'src/features/flight-monitoring/components/FlightMap.jsx',
      // PR M5: the data block and the layers menu.
      'src/features/maps/ui/FlightDataBlock.jsx', 'src/features/maps/ui/MapLayersMenu.jsx',
    ];
    const tokens = new Set(Object.keys(tailwindConfig.theme.extend.colors.occ));
    for (const file of files) {
      const source = readSource(file);
      // No legacy colour (that check also reads an occ colour with an opacity modifier), and no modifier at all.
      expect(findLegacyColourClasses(source), file).toEqual([]);
      expect(source.match(/-occ-[a-z-]+\/(?:\d+|\[)/g), file).toBeNull();
      // Flat: no shadow, ring (a shadow too), blur or gradient.
      expect(source, file).not.toMatch(/backdrop|gradient|\bblur\b|\bshadow-(?!none\b)|(?<![\w-])ring-/);
      // Every occ colour class names a token of tailwind.config.js, and the only other colour is «none».
      for (const [, , token] of source.matchAll(/(?<![\w-])(bg|text|border|outline|fill|stroke)-occ-([a-z]+(?:-[a-z]+)*)/g)) {
        expect(tokens.has(token), `${file}: occ-${token}`).toBe(true);
      }
      const plainColours = [...source.matchAll(/(?<![\w-])(?:bg|border|outline|fill|stroke)-(white|black|current|inherit|[a-z]+-\d{2,3})(?![\w-])/g)];
      expect(plainColours.map(match => match[0]), file).toEqual([]);
      // Radii of the OCC: 2 (plates), 4 (controls), 6 (panels) and 8 px (overlays).
      for (const [radius] of source.matchAll(/(?<![\w-])rounded(?:-[a-z0-9]+)?(?![\w-])/g)) {
        expect(['rounded-sm', 'rounded', 'rounded-md', 'rounded-lg'], `${file}: ${radius}`).toContain(radius);
      }
    }

    const stylesheet = readSource('src/styles/occ-map.css');
    const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
    const preludes = [...css.matchAll(/([^{}]+)\{/g)].map(([, prelude]) => prelude.trim());
    // The only at-rule keeps MapLibre's own icons in forced colours.
    expect(preludes.filter(prelude => prelude.startsWith('@'))).toEqual(['@media (forced-colors: active)']);
    const selectors = preludes.filter(prelude => !prelude.startsWith('@')).flatMap(prelude => prelude.split(',').map(part => part.trim()));
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) expect(selector.startsWith('.occ-map'), selector).toBe(true);
    for (const [, value] of css.matchAll(/box-shadow:\s*([^;]+);/g)) expect(value.trim()).toBe('none');
    expect(css).not.toMatch(/backdrop-filter|gradient|blur\(/);
    // Colours only through the tokens; radii only 2, 4, 6 or 8 px.
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map(([, name]) => name).filter(name => !name.startsWith('--occ-'))).toEqual([]);
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) expect(['2px', '4px', '6px', '8px']).toContain(value.trim());
    // The root of the component is the scope of the stylesheet.
    renderMap();
    expect(screen.getByTestId('occ-map')).toHaveClass('occ-map');
  });
});
// The traffic of PR M5 at the lab's noon: the synthetic air picture and map flights, the demo arrival estimated on
// final, and the trails the picture's short trails draw.
function noonTraffic({ change = () => null, source = TRAFFIC_SOURCE } = {}) {
  const base = createAirPicture();
  const picture = toPictureModel({ ...base, aircraft: base.aircraft.map(item => change(item) ?? item) });
  const situation = buildSituation({ picture, flights: toFlightsModel(createMapFlights()), nowMs: Date.parse(TRAFFIC_NOON),
    estimates: createEstimates() });
  const trails = createTrailStore();
  trails.ingestPicture(picture);
  const aviamHexes = new Set(situation.aircraft.filter(item => item.kind === 'aviam' && item.hex).map(item => item.hex));
  return { aircraft: situation.aircraft, trails: trailFeatures(trails.getSnapshot(), { aviamHexes, nowMs: picture.serverTime }),
    route: null, source };
}

function TrafficProbe() {
  const { trafficOnScreen, trafficSource } = useOccMap();
  return <pre data-testid="traffic-probe">{JSON.stringify({ trafficOnScreen, trafficSource })}</pre>;
}
const trafficProbe = () => JSON.parse(screen.getByTestId('traffic-probe').textContent);
const attributionOf = map => map.controls.find(entry => entry.control instanceof fake.module.AttributionControl)
  ?.control.options.customAttribution;
// Far from PUJ and from every aircraft of the picture.
const NOWHERE = { center: [-72.4, 22.4], zoom: 11 };

describe('OccMap traffic (PR M5)', () => {
  it('draws the traffic with one updateData per read and never re-creates the map', () => {
    const traffic = noonTraffic();
    const view = render(<OccMap defaultView="region" traffic={traffic}><TrafficProbe /></OccMap>);
    const map = fake.state.liveMaps().at(-1);
    const { style } = map.options;
    expect(style.sources['occ-traffic']).toMatchObject({ type: 'geojson', promoteId: 'id' });
    expect(style.sources['occ-trails']).toMatchObject({ type: 'geojson', lineMetrics: true });
    expect(style.sources['occ-route']).toMatchObject({ type: 'geojson' });
    loadStyle(map);
    // Its layers in the traffic slot, above the stands' labels, and the chosen aircraft in the selection slot.
    const ids = map.layerIds();
    expect(ids.indexOf('occ-traffic-aviam')).toBeGreaterThan(ids.indexOf('slot-traffic'));
    expect(ids.indexOf('occ-traffic-selected')).toBeGreaterThan(ids.indexOf('slot-selection'));
    const source = map.getSource('occ-traffic');
    expect(source.updateDataCalls).toHaveLength(1);
    const [first] = source.updateDataCalls;
    // Every aircraft drawn, the one inside the stand ZZ300 holds left out.
    expect(first.add.map(feature => feature.properties.id).sort()).toEqual([
      `f:${TRAFFIC_FLIGHT_KEY.arrival}`, `f:${TRAFFIC_FLIGHT_KEY.demoArrival}`, `h:${TRAFFIC_HEX.overflight}`,
      `h:${TRAFFIC_HEX.groundOnFreeStand}`, `h:${TRAFFIC_HEX.outsideWindow}`, `h:${TRAFFIC_HEX.stale}`,
    ].sort());
    expect([first.update, first.remove]).toEqual([[], []]);
    expect(source.setDataCalls).toEqual([]);
    expect(map.getSource('occ-trails').setDataCalls).toHaveLength(1);

    // The same picture read again in new objects writes nothing; a moved aircraft is one update of its own.
    view.rerender(<OccMap defaultView="region" traffic={noonTraffic()}><TrafficProbe /></OccMap>);
    expect(source.updateDataCalls).toHaveLength(1);
    const moved = noonTraffic({ change: item => (item.hex === TRAFFIC_HEX.overflight
      ? { ...item, latitude: item.latitude + 0.05 } : null) });
    view.rerender(<OccMap defaultView="region" traffic={moved}><TrafficProbe /></OccMap>);
    expect(source.updateDataCalls).toHaveLength(2);
    expect(source.updateDataCalls[1]).toMatchObject({ add: [], remove: [],
      update: [{ id: `h:${TRAFFIC_HEX.overflight}`, newGeometry: { type: 'Point' } }] });

    // A selection is a change of properties: the chosen aircraft grows and takes its tag.
    view.rerender(<OccMap defaultView="region" traffic={moved} selection={{ kind: 'aircraft', id: TRAFFIC_HEX.stale }}>
      <TrafficProbe /></OccMap>);
    expect(source.updateDataCalls).toHaveLength(3);
    expect(source.updateDataCalls[2].update).toEqual([{ id: `h:${TRAFFIC_HEX.stale}`, addOrUpdateProperties: expect.arrayContaining([
      { key: 'selected', value: true }, { key: 'scale', value: 1.4 }, { key: 'forceTag', value: true },
    ]) }]);
    // One map for its whole life, and never a new style.
    expect(fake.state.maps).toEqual([map]);
    expect(map.calls.filter(call => call.method === 'setStyle')).toEqual([]);

    // The aircraft of other traffic under the pointer shows its tag, once per frame and once per change.
    const frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    const hovered = { layer: { id: 'occ-traffic-other' }, properties: { id: `h:${TRAFFIC_HEX.outsideWindow}`, hex: TRAFFIC_HEX.outsideWindow } };
    fake.state.setRenderedFeatures(map, (_geometry, options) => (options.layers.includes('occ-traffic-other') ? [hovered] : []));
    fake.state.emit(map, 'mousemove', { point: { x: 10, y: 10 }, lngLat: { lng: -68.4, lat: 18.2 } });
    act(() => frames.shift()(0));
    expect(source.updateDataCalls).toHaveLength(4);
    expect(source.updateDataCalls[3].update).toEqual([{ id: `h:${TRAFFIC_HEX.outsideWindow}`,
      addOrUpdateProperties: [{ key: 'forceTag', value: true }, { key: 'showTag', value: true }] }]);
    expect(map.getCanvas().style.cursor).toBe('pointer');
    fake.state.emit(map, 'mousemove', { point: { x: 11, y: 10 }, lngLat: { lng: -68.4, lat: 18.2 } });
    act(() => frames.shift()(16));
    expect(source.updateDataCalls).toHaveLength(4);
    fake.state.emit(map, 'mouseout');
    act(() => frames.shift()(32));
    expect(source.updateDataCalls).toHaveLength(5);
    expect(source.updateDataCalls[4].update[0].addOrUpdateProperties).toEqual([{ key: 'forceTag', value: false },
      { key: 'showTag', value: false }]);
    view.unmount();

    // A map that starts without traffic has no traffic layers, and traffic given later draws nothing.
    const plain = render(<OccMap defaultView="region" />);
    const without = fake.state.liveMaps().at(-1);
    loadStyle(without);
    plain.rerender(<OccMap defaultView="region" traffic={traffic} />);
    expect(without.options.style.sources['occ-traffic']).toBeUndefined();
    expect(without.calls.filter(call => call.method === 'updateData')).toEqual([]);
  });

  it('a click on an AVIAM aircraft selects its flight key and on other traffic its hex', async () => {
    const onSelect = vi.fn();
    const ref = createRef();
    const traffic = noonTraffic();
    render(<OccMap ref={ref} defaultView="region" traffic={traffic} onSelect={onSelect} />);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    const click = features => {
      fake.state.setRenderedFeatures(map, (_geometry, options) => features.filter(feature => options.layers.includes(feature.layer.id)));
      return act(async () => fake.state.emit(map, 'click', { point: { x: 100, y: 100 }, lngLat: { lng: -68.5, lat: 18.5 } }));
    };
    await click([{ layer: { id: 'occ-traffic-aviam' }, properties: { id: `f:${TRAFFIC_FLIGHT_KEY.arrival}`, flightKey: TRAFFIC_FLIGHT_KEY.arrival } }]);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'flight', id: TRAFFIC_FLIGHT_KEY.arrival });
    await click([{ layer: { id: 'occ-traffic-other' }, properties: { id: `h:${TRAFFIC_HEX.overflight}`, hex: TRAFFIC_HEX.overflight } }]);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'aircraft', id: TRAFFIC_HEX.overflight });
    // Other traffic on the ground is picked by its address too; the AVIAM layer is picked above other traffic.
    await click([{ layer: { id: 'occ-traffic-other-ground' }, properties: { id: `h:${TRAFFIC_HEX.groundOnFreeStand}`, hex: TRAFFIC_HEX.groundOnFreeStand } }]);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'aircraft', id: TRAFFIC_HEX.groundOnFreeStand });
    expect(onSelect).toHaveBeenCalledTimes(3);

    // flyToFlight finds a flight the traffic draws by any of its ids, keeping the zoom.
    const zoom = map.getZoom();
    const arrival = traffic.aircraft.find(item => item.flightKey === TRAFFIC_FLIGHT_KEY.arrival);
    act(() => { expect(ref.current.flyToFlight(arrival.legId)).toBe(true); });
    expect(map.getCenter().toArray()).toEqual([arrival.lon, arrival.lat]);
    expect(map.getZoom()).toBeCloseTo(zoom, 9);
    act(() => { expect(ref.current.flyToFlight(TRAFFIC_FLIGHT_KEY.noFix)).toBe(false); });
  });

  it('the selected aircraft is cyan and larger with its ring', () => {
    const traffic = noonTraffic();
    const view = render(<OccMap defaultView="region" traffic={traffic} selection={{ kind: 'aircraft', id: TRAFFIC_HEX.overflight }} />);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    const added = Object.fromEntries(map.getSource('occ-traffic').updateDataCalls[0].add
      .map(feature => [feature.properties.id, feature.properties]));
    // Larger (1.4×) with its tag, drawn again in the selection slot in cyan, above every other aircraft.
    expect(added[`h:${TRAFFIC_HEX.overflight}`]).toMatchObject({ selected: true, scale: 1.4, forceTag: true });
    expect(Object.values(added).filter(properties => properties.selected).map(properties => properties.id))
      .toEqual([`h:${TRAFFIC_HEX.overflight}`]);
    const selected = map.getLayer('occ-traffic-selected');
    expect(selected.filter).toEqual(['==', ['get', 'selected'], true]);
    expect(selected.paint['icon-color']).toBe(occColor('accent'));
    expect(selected.layout['icon-size']).toEqual(['get', 'scale']);
    const ids = map.layerIds();
    expect(ids.indexOf('occ-traffic-selected')).toBeGreaterThan(ids.indexOf('slot-selection'));
    // Its ring, a circle of the traffic overlay in the selection slot, under the cyan aircraft, drawn from the chosen
    // aircraft's own feature: the selection source, which rings the stands and the flights a screen places, stays empty.
    const ring = map.getLayer('occ-traffic-selected-ring');
    expect(ring).toMatchObject({ type: 'circle', source: 'occ-traffic', filter: ['==', ['get', 'selected'], true] });
    expect(ring.paint['circle-stroke-color']).toBe(occColor('accent'));
    expect(ring.paint['circle-stroke-width']).toBe(2);
    expect(ids.indexOf('occ-traffic-selected-ring')).toBeGreaterThan(ids.indexOf('slot-selection'));
    expect(ids.indexOf('occ-traffic-selected-ring')).toBeLessThan(ids.indexOf('occ-traffic-selected'));
    const selectionSource = map.getSource('occ-selection');
    expect(selectionSource.data.features).toEqual([]);
    const selectionWrites = selectionSource.setDataCalls.length;

    // A flight drawn as traffic, chosen by the page's leg id: the cyan and the ring move to its aircraft.
    const arrival = traffic.aircraft.find(item => item.flightKey === TRAFFIC_FLIGHT_KEY.arrival);
    view.rerender(<OccMap defaultView="region" traffic={traffic} selection={{ kind: 'flight', id: arrival.legId }} />);
    const updates = map.getSource('occ-traffic').updateDataCalls.at(-1).update;
    const byId = Object.fromEntries(updates.map(change => [change.id,
      Object.fromEntries(change.addOrUpdateProperties.map(({ key, value }) => [key, value]))]));
    expect(byId[`f:${TRAFFIC_FLIGHT_KEY.arrival}`]).toMatchObject({ selected: true, scale: 1.4 });
    expect(byId[`h:${TRAFFIC_HEX.overflight}`]).toMatchObject({ selected: false, scale: 0.85 });
    // The ring follows the aircraft to its next position in the same write that moves it.
    const moved = noonTraffic({ change: item => (item.hex === TRAFFIC_HEX.arrival ? { ...item, latitude: item.latitude + 0.02 } : null) });
    view.rerender(<OccMap defaultView="region" traffic={moved} selection={{ kind: 'flight', id: arrival.legId }} />);
    const step = map.getSource('occ-traffic').updateDataCalls.at(-1).update;
    expect(step).toEqual([{ id: `f:${TRAFFIC_FLIGHT_KEY.arrival}`, newGeometry: { type: 'Point',
      coordinates: [arrival.lon, expect.closeTo(arrival.lat + 0.02, 6)] } }]);
    // Nothing chosen: no ring, no cyan.
    view.rerender(<OccMap defaultView="region" traffic={moved} selection={null} />);
    expect(map.getSource('occ-traffic').updateDataCalls.at(-1).update).toEqual([{ id: `f:${TRAFFIC_FLIGHT_KEY.arrival}`,
      addOrUpdateProperties: expect.arrayContaining([{ key: 'selected', value: false }]) }]);
    // None of it wrote the selection source.
    expect(selectionSource.setDataCalls).toHaveLength(selectionWrites);
    expect(selectionSource.data.features).toEqual([]);
  });

  it('the chosen flight\'s route is drawn with its trail giving way to it, and the legend explains it', () => {
    const traffic = noonTraffic();
    const hex = TRAFFIC_HEX.arrival;
    const arrival = traffic.aircraft.find(item => item.hex === hex);
    const trailOf = collection => collection.features.filter(feature => feature.properties.hex === hex);
    const route = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { id: `${arrival.id}:flown:0`, part: 'flown', hex },
        geometry: { type: 'LineString', coordinates: trailOf(traffic.trails)[0].geometry.coordinates } },
      { type: 'Feature', properties: { id: `${arrival.id}:next`, part: 'next', hex, to: 'stand' },
        geometry: { type: 'LineString', coordinates: [[arrival.lon, arrival.lat], standPoint('A5')] } },
    ] };
    const element = withRoute => (
      <OccMap defaultView="region" traffic={{ ...traffic, route: withRoute ? route : null }}
        selection={{ kind: 'flight', id: TRAFFIC_FLIGHT_KEY.arrival }}>
        <TrafficProbe /><MapLegend />
      </OccMap>
    );
    const view = render(element(true));
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    expect(map.getSource('occ-route').data).toEqual(route);
    // The arrival's trail is its route's flown part now: the trails source no longer draws it.
    expect(trailOf(map.getSource('occ-trails').data)).toEqual([]);
    expect(trafficProbe().trafficOnScreen.route).toEqual(['flown', 'next']);
    const items = () => within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem')
      .map(item => item.getAttribute('data-legend-traffic')).filter(Boolean);
    expect(items()).toEqual(['aviamArrival', 'other', 'demo', 'estimated', 'stale', 'routeFlown', 'routeNext']);
    expect(screen.getByText('Recorrido del vuelo elegido')).toBeInTheDocument();
    expect(screen.getByText('Hasta su próximo punto, en línea recta')).toBeInTheDocument();
    // No route: the trail comes back.
    view.rerender(element(false));
    expect(trailOf(map.getSource('occ-trails').data)).toHaveLength(1);
    expect(map.getSource('occ-route').data.features).toEqual([]);
    expect(items()).not.toContain('routeFlown');
  });

  it('adds the aircraft credit while traffic is on screen and drops it when none is', () => {
    const { rerender } = render(<OccMap defaultView="region" traffic={noonTraffic()}><TrafficProbe /></OccMap>);
    const map = fake.state.liveMaps().at(-1);
    // The map starts with the fixed credit only, and credits the source once it knows traffic is on screen.
    const created = map.calls.find(call => call.method === 'addControl' && call.args[0] instanceof fake.module.AttributionControl);
    expect(created.args[0].options.customAttribution).not.toMatch(/Datos de aeronaves/);
    loadStyle(map);
    // The region view holds the traffic: «Datos de aeronaves» links the source and names its licence.
    expect(attributionOf(map)).toContain('Datos de aeronaves: <a href="https://example.org/adsb" target="_blank" '
      + 'rel="noopener noreferrer">Red ADS-B de prueba</a> (Datos sintéticos)');
    expect(trafficProbe().trafficSource).toEqual(TRAFFIC_SOURCE);
    // Away from every aircraft the credit goes, and comes back with them.
    act(() => map.jumpTo(NOWHERE));
    expect(trafficProbe().trafficOnScreen.kinds).toEqual([]);
    expect(attributionOf(map)).not.toMatch(/Datos de aeronaves/);
    expect(trafficProbe().trafficSource).toBeNull();
    act(() => map.jumpTo({ center: [-68.36, 18.56], zoom: 7 }));
    expect(attributionOf(map)).toContain('Datos de aeronaves');
    // A credit is written once: re-reads of the same source write nothing.
    const writes = map.calls.filter(call => call.method === 'removeControl').length;
    rerender(<OccMap defaultView="region" traffic={noonTraffic()}><TrafficProbe /></OccMap>);
    expect(map.calls.filter(call => call.method === 'removeControl')).toHaveLength(writes);
    // Without a source (the provider is off) there is nothing to credit.
    rerender(<OccMap defaultView="region" traffic={noonTraffic({ source: null })}><TrafficProbe /></OccMap>);
    expect(attributionOf(map)).not.toMatch(/Datos de aeronaves/);
    cleanup();

    // In English the credit speaks English.
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><OccMap defaultView="region" traffic={noonTraffic()} /></LanguageScope>);
    const english = fake.state.liveMaps().at(-1);
    loadStyle(english);
    expect(attributionOf(english)).toContain('Aircraft data: <a href="https://example.org/adsb"');
  });

  it('the legend lists the aircraft kinds, tags and trails on screen', () => {
    render(<OccMap defaultView="region" traffic={noonTraffic()}><TrafficProbe /><MapLegend /></OccMap>);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    // The region view: the arrival and the demo on final, other traffic in the air (on the ground only from the
    // airfield threshold up), the demo's plate, its estimated ring, a stale position, and the arrival's trail.
    expect(trafficProbe().trafficOnScreen).toEqual({ kinds: ['aviamArrival', 'other'], tags: ['demo', 'estimated', 'stale'],
      trails: ['live'], route: [] });
    const items = () => within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem')
      .map(item => item.getAttribute('data-legend-traffic')).filter(Boolean);
    expect(items()).toEqual(['aviamArrival', 'other', 'demo', 'estimated', 'stale', 'trail']);
    // Close over the ramp the aircraft on the free stand A3 is drawn, small, and listed.
    act(() => map.jumpTo({ center: standPoint('A3'), zoom: 17 }));
    expect(trafficProbe().trafficOnScreen.kinds).toEqual(['otherGround']);
    expect(items()).toEqual(['otherGround']);
    // Nothing of the traffic on screen: no traffic in the legend.
    act(() => map.jumpTo(NOWHERE));
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
  });
});

// The references of PR M8 (design E6): the weather as useMdpcWeather answers it, from a synthetic answer of
// GET occ/weather, and a live aircraft on final of a runway end of the layout.
function weatherAt(options = {}) {
  const reading = toWeatherReading(createAerodromeWeather(options), { receivedAt: Date.parse(WEATHER_NOON) });
  return { status: reading.observation ? 'success' : 'empty', data: reading.observation, apiStatus: reading.apiStatus,
    taf: reading.taf, source: reading.source };
}
function onFinal(ident, nm, extra = {}) {
  const end = runwayEnds(MDPC_LAYOUT).find(item => item.ident === ident);
  const [lon, lat] = destinationPoint(end.threshold, (end.headingTrue + 180) % 360, nm * METRES_PER_NM);
  return { id: `h:final-${ident}-${nm}`, kind: 'other', quality: 'live', onGround: false, altM: nm * 100,
    trackDeg: end.headingTrue, vrateMs: -3.5, lon, lat, ...extra };
}
// The lab's noon, ten minutes after the synthetic METAR: the instant these maps read at (the wind of an older METAR
// would not decide the runway).
const WEATHER_NOON_MS = Date.parse(WEATHER_NOON);
const SDQ = Object.freeze({ iataCode: 'SDQ', icaoCode: 'MDSD', name: 'Las Américas', latitude: 18.4297, longitude: -69.6689 });
function ReferenceProbe() {
  const { referencesOnScreen } = useOccMap();
  return <pre data-testid="reference-probe">{JSON.stringify(referencesOnScreen)}</pre>;
}
const referenceProbe = () => JSON.parse(screen.getByTestId('reference-probe').textContent);
const inUseOf = map => map.getSource('occ-reference-ourairports').data.features
  .filter(item => item.properties.kind === 'centrelineLabel').map(item => item.properties.label);
// The layer that draws each kind of reference, as queryRenderedFeatures names it.
const LAYER_OF = Object.freeze({
  centreline: 'occ-reference-centrelines', tick: 'occ-reference-centreline-ticks', airport: 'occ-reference-airports',
  navaid: 'occ-reference-navaids', night: 'occ-night',
});
const drawnLayerOf = properties => (properties.kind === 'ring' ? `occ-reference-rings-${properties.scope}` : LAYER_OF[properties.kind]);

describe('OccMap references (PR M8)', () => {
  const MINUTE_MS = 60 * 1000;

  afterEach(() => {
    serverClock.reset();
    vi.useRealTimers();
  });

  it('writes the reference point and the rings once, and what comes from OurAirports again only when the runway in use, the counterparts or the language change', () => {
    const flights = createMapFlights().flights;
    const trafficOf = ({ aircraft = [], rows = flights } = {}) => ({ aircraft, trails: null, route: null, source: null, flights: rows });
    const element = props => <LanguageScope><OccMap defaultView="approach" frozenAt={WEATHER_NOON_MS} {...props} /></LanguageScope>;
    const view = render(element({ traffic: trafficOf() }));
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    const fixed = map.getSource('occ-reference');
    const source = map.getSource('occ-reference-ourairports');
    // One write of each when the map starts: without weather or arrivals, the usual 08 (owner decision 19).
    expect(fixed.setDataCalls).toHaveLength(1);
    expect(source.setDataCalls).toHaveLength(1);
    expect(inUseOf(map)).toEqual(['Pista 08 (habitual)']);
    // The same traffic and flights read again, in new objects: nothing to write.
    view.rerender(element({ traffic: trafficOf({ rows: flights.map(row => ({ ...row })) }) }));
    expect(source.setDataCalls).toHaveLength(1);
    // A live METAR with a westerly wind: the runway in use is 26, estimated from the wind.
    const westerly = weatherAt({ wind: { directionDeg: 270, speedKt: 15 } });
    view.rerender(element({ traffic: trafficOf(), weather: westerly }));
    expect(source.setDataCalls).toHaveLength(2);
    expect(inUseOf(map)).toEqual(['Pista 26 (estimada por el viento)']);
    // Another reading with the same wind changes nothing; one that is no longer live gives the runway back to 08.
    view.rerender(element({ traffic: trafficOf(), weather: weatherAt({ wind: { directionDeg: 270, speedKt: 15 } }) }));
    expect(source.setDataCalls).toHaveLength(2);
    view.rerender(element({ traffic: trafficOf(), weather: weatherAt({ status: 'Stale', wind: { directionDeg: 270, speedKt: 15 } }) }));
    expect(source.setDataCalls).toHaveLength(3);
    expect(inUseOf(map)).toEqual(['Pista 08 (habitual)']);
    // Live arrivals on final for 08 win over the westerly wind.
    const arrivals = [onFinal('08', 6), onFinal('08', 3)];
    view.rerender(element({ traffic: trafficOf({ aircraft: arrivals }), weather: westerly }));
    expect(source.setDataCalls).toHaveLength(4);
    expect(inUseOf(map)).toEqual(['Pista 08 (según las llegadas)']);
    // The aircraft move on the same final: the runway stays, nothing is written.
    view.rerender(element({ traffic: trafficOf({ aircraft: [onFinal('08', 5), onFinal('08', 2)] }), weather: westerly }));
    expect(source.setDataCalls).toHaveLength(4);
    // A flight of today from Santo Domingo: its airport is emphasised.
    const withSdq = flights.map((row, index) => (index === 0 ? { ...row, counterpart: SDQ } : row));
    view.rerender(element({ traffic: trafficOf({ aircraft: arrivals, rows: withSdq }), weather: westerly }));
    expect(source.setDataCalls).toHaveLength(5);
    const emphasised = () => source.data.features.filter(item => item.properties.kind === 'airport' && item.properties.counterpart)
      .map(item => item.properties.label);
    expect(emphasised()).toEqual(['MDSD SDQ']);
    // The language: the words of the runway and of the navaids, in English.
    act(() => resetLanguageForTests('en'));
    expect(source.setDataCalls).toHaveLength(6);
    expect(inUseOf(map)).toEqual(['Runway 08 (from the arrivals)']);
    expect(source.data.features.filter(item => item.properties.kind === 'navaid').map(item => item.properties.label))
      .toEqual(['PNA VOR-DME 112.7', 'PCA NDB 425']);
    // The reference point and the rings were never written again; one map for its whole life.
    expect(fixed.setDataCalls).toHaveLength(1);
    expect(fixed.data).toEqual(referenceFeatures());
    expect(fake.state.maps).toEqual([map]);
  });

  it('keeps the runway in use from the arrivals for ten minutes of the server clock after the last one on final', () => {
    const trafficOf = aircraft => ({ aircraft, trails: null, route: null, source: null, flights: [] });
    const westerly = weatherAt({ wind: { directionDeg: 270, speedKt: 15 } });
    const element = (minutes, aircraft) => (
      <OccMap defaultView="approach" frozenAt={WEATHER_NOON_MS + minutes * MINUTE_MS} traffic={trafficOf(aircraft)}
        weather={westerly} />
    );
    // 12:00 at the lab's noon: an arrival on final for 08 against a westerly wind.
    const view = render(element(0, [onFinal('08', 4, { hex: 'aa0101', positionAt: WEATHER_NOON_MS })]));
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    const source = map.getSource('occ-reference-ourairports');
    expect(inUseOf(map)).toEqual(['Pista 08 (según las llegadas)']);
    const writes = source.setDataCalls.length;
    // It lands, and then leaves the picture: the runway stays, and nothing is written.
    view.rerender(element(3, [onFinal('08', 0.5, { hex: 'aa0101', onGround: true, altM: 0, positionAt: WEATHER_NOON_MS + 3 * MINUTE_MS })]));
    view.rerender(element(6, []));
    view.rerender(element(10, []));
    expect(inUseOf(map)).toEqual(['Pista 08 (según las llegadas)']);
    expect(source.setDataCalls).toHaveLength(writes);
    // An aircraft joining the downwind for 08 from the east (westbound at 262°, 3 NM north of the 26 centreline) does
    // not vote, so eleven minutes after the last arrival the wind decides again.
    const thresholdOf26 = runwayEnds(MDPC_LAYOUT).find(item => item.ident === '26').threshold;
    const [lon, lat] = destinationPoint(destinationPoint(thresholdOf26, 73.8, 6 * METRES_PER_NM), 343.8, 3 * METRES_PER_NM);
    const downwind = { id: 'h:aa0102', hex: 'aa0102', kind: 'other', quality: 'live', onGround: false, altM: 600,
      trackDeg: 262, vrateMs: 0, lon, lat, positionAt: WEATHER_NOON_MS + 11 * MINUTE_MS };
    view.rerender(element(11, [downwind]));
    expect(inUseOf(map)).toEqual(['Pista 26 (estimada por el viento)']);
    expect(source.setDataCalls).toHaveLength(writes + 1);
  });

  it('rewrites the night shade on the minute of the server clock', () => {
    // 18:15:30 in Punta Cana: dusk, the edge of the civil twilight crossing the region.
    const dusk = Date.parse('2026-11-13T22:15:00Z');
    vi.useFakeTimers({ now: dusk + 30 * 1000, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    serverClock.reset();
    const view = render(<OccMap defaultView="region" />);
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    const night = map.getSource('occ-night');
    expect(night.setDataCalls).toHaveLength(1);
    expect(night.data).toEqual(nightShadeFeatures(dusk));
    // Not before the next minute of the clock, then once.
    act(() => vi.advanceTimersByTime(29_999));
    expect(night.setDataCalls).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(night.setDataCalls).toHaveLength(2);
    expect(night.data).toEqual(nightShadeFeatures(dusk + MINUTE_MS));
    // The server's clock learns it is five minutes ahead of this browser: the shade follows it at once.
    act(() => {
      const now = Date.now();
      serverClock.observe(new Date(now + 5 * MINUTE_MS).toISOString(), now, now);
    });
    expect(night.setDataCalls).toHaveLength(3);
    expect(night.data).toEqual(nightShadeFeatures(dusk + 6 * MINUTE_MS));
    // The rest of the references are not written again on the minute.
    expect(map.getSource('occ-reference').setDataCalls).toHaveLength(1);
    view.unmount();

    // The map lab's frozen clock holds the night where it is.
    render(<OccMap defaultView="region" frozenAt={dusk} />);
    const frozen = fake.state.liveMaps().at(-1);
    loadStyle(frozen);
    act(() => vi.advanceTimersByTime(10 * MINUTE_MS));
    expect(frozen.getSource('occ-night').setDataCalls).toHaveLength(1);
    expect(frozen.getSource('occ-night').data).toEqual(nightShadeFeatures(dusk));
  });

  it('lists the references on screen', () => {
    const traffic = { aircraft: [], trails: null, route: null, source: null,
      flights: createMapFlights().flights.map((row, index) => (index === 0 ? { ...row, counterpart: SDQ } : row)) };
    const element = props => (
      <OccMap defaultView="approach" frozenAt={WEATHER_NOON_MS} traffic={traffic} weather={weatherAt()} {...props}>
        <ReferenceProbe />
        <MapLegend />
      </OccMap>
    );
    const view = render(element({}));
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    // Nothing is drawn yet as far as the map says: nothing to explain.
    expect(referenceProbe()).toEqual({ kinds: [], runway: null });
    // What the map draws in sight, read back for the layers it is asked about: the approach rings, the centrelines with
    // the runway in use, Santo Domingo and La Romana, the navaids and the night.
    const asked = [];
    const written = [...map.getSource('occ-reference').data.features, ...map.getSource('occ-reference-ourairports').data.features];
    const drawn = [...written
      .filter(item => ['ring', 'centreline', 'tick', 'navaid'].includes(item.properties.kind)
        || ['MDSD', 'MDLR'].includes(item.properties.icao))
      .filter(item => item.properties.kind !== 'ring' || item.properties.scope === 'approach'),
    { properties: { kind: 'night' } }].map(item => ({ layer: { id: drawnLayerOf(item.properties) }, properties: item.properties }));
    fake.state.setRenderedFeatures(map, (geometry, options) => {
      if (options.layers.some(id => REFERENCE_LAYER_IDS.includes(id))) asked.push(options.layers);
      return drawn.filter(item => options.layers.includes(item.layer.id));
    });
    act(() => fake.state.emit(map, 'idle'));
    expect(asked.at(-1)).toEqual(REFERENCE_LAYER_IDS);
    expect(referenceProbe()).toEqual({ kinds: ['rings', 'centrelines', 'runwayInUse', 'airports', 'counterparts', 'vor',
      'ndb', 'night'], runway: { arrival: '08', source: 'wind' } });
    const legend = () => within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem')
      .map(item => item.textContent);
    expect(legend()).toEqual(['Anillos de distancia', 'Eje de pista extendido (marca cada NM)',
      'Pista 08 (estimada por el viento)', 'Aeropuerto de la región', 'Origen o destino de un vuelo de hoy',
      'Radioayuda VOR-DME', 'Radioayuda NDB', 'Noche (tras el crepúsculo civil)']);
    // A group the page hides is not asked about, and its entries go from the legend.
    view.rerender(element({ groups: { airports: false, daynight: false } }));
    act(() => fake.state.emit(map, 'idle'));
    expect(asked.at(-1)).not.toContain('occ-reference-airports');
    expect(asked.at(-1)).not.toContain('occ-night');
    expect(legend()).toEqual(['Anillos de distancia', 'Eje de pista extendido (marca cada NM)',
      'Pista 08 (estimada por el viento)', 'Radioayuda VOR-DME', 'Radioayuda NDB']);
    // Nothing of them drawn: no reference in the legend, and no legend at all with nothing else to explain.
    fake.state.setRenderedFeatures(map, () => []);
    act(() => fake.state.emit(map, 'idle'));
    expect(referenceProbe()).toEqual({ kinds: [], runway: null });
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
  });
});

// The weather of PR M8 (traffic/weatherLayers.js): the wind at the airfield and the satellite images, over the synthetic
// weather of the lab's noon and a simulated GIBS; nothing here calls aviationweather.gov or GIBS.
const layoutOf = (map, id) => map.getLayer(id)?.layout?.visibility;
// Lets the answers of a simulated service and the renders they bring settle.
const settle = () => act(() => new Promise(resolve => { setTimeout(resolve, 0); }));
const PINNED_GOES = GOES_TILE_TEMPLATE.replace('/default/default/', '/default/2026-11-13T14:50:00Z/');
// The wind as queryRenderedFeatures answers it for the map's layers: what the map wrote, from the layer that draws it.
function windDrawn(map) {
  const [airfield] = map.getSource('occ-weather-wind').data.features;
  return { layer: { id: 'occ-weather-wind' }, properties: airfield.properties };
}

describe('OccMap weather (PR M8)', () => {
  afterEach(() => {
    serverClock.reset();
  });

  it('draws the wind only with weather', () => {
    // Without weather (the console's apron, the plain Monitoreo), no weather at all: read at start, as the traffic.
    const plain = render(<OccMap defaultView="airfield" />);
    const without = fake.state.liveMaps().at(-1);
    expect(without.options.style.sources['occ-weather-wind']).toBeUndefined();
    expect(without.options.style.sources['occ-weather-goes']).toBeUndefined();
    plain.rerender(<OccMap defaultView="airfield" weather={weatherAt()} />);
    expect(without.options.style.sources['occ-weather-wind']).toBeUndefined();
    plain.unmount();

    // With it (null until there is a reading): its sources and layers, and the wind written when what it draws changes.
    const element = props => <OccMap defaultView="airfield" frozenAt={WEATHER_NOON_MS} {...props}><ReferenceProbe /></OccMap>;
    const view = render(element({ weather: null }));
    const map = fake.state.liveMaps().at(-1);
    expect(map.options.style.sources['occ-weather-wind']).toMatchObject({ type: 'geojson' });
    expect(map.options.style.sources['occ-weather-goes']).toMatchObject({ type: 'raster', tiles: [GOES_TILE_TEMPLATE] });
    loadStyle(map);
    const wind = map.getSource('occ-weather-wind');
    expect(wind.data.features).toEqual([]);
    const writes = wind.setDataCalls.length;
    view.rerender(element({ weather: weatherAt() }));
    expect(wind.setDataCalls).toHaveLength(writes + 1);
    expect(wind.data.features.map(feature => [feature.properties.placement, feature.properties.label])).toEqual([
      ['airfield', '100° 13 kt R08'], ['wide', '100° 13 kt R08'],
    ]);
    // The same reading again in new objects writes nothing.
    view.rerender(element({ weather: weatherAt() }));
    expect(wind.setDataCalls).toHaveLength(writes + 1);
    // A westerly wind lands the map on 26 (contracts 2.3), and the wind says it.
    view.rerender(element({ weather: weatherAt({ wind: { directionDeg: 270, speedKt: 15 } }) }));
    expect(wind.data.features[0].properties.label).toBe('270° 15 kt R26');
    // Stale: dimmed, with the time of its METAR; the runway goes back to the usual 08.
    view.rerender(element({ weather: weatherAt({ status: 'Stale' }) }));
    expect(wind.data.features[0].properties).toMatchObject({ stale: true,
      label: '100° 13 kt R08\nSin actualizar desde las 08:00' });
    // Unavailable or Disabled: no wind on the map.
    for (const status of ['Unavailable', 'Disabled']) {
      view.rerender(element({ weather: weatherAt({ status }) }));
      expect(wind.data.features, status).toEqual([]);
    }
    // The wind shows in Aeródromo by default (design E7), as its own group; the satellite images stay hidden.
    expect(layoutOf(map, 'occ-weather-wind')).toBe('visible');
    expect(layoutOf(map, 'occ-weather-goes-image')).toBe('none');
    expect(layoutOf(map, 'occ-weather-imerg-image')).toBe('none');
    // One map for its whole life.
    expect(fake.state.maps.filter(item => item.options.style.sources['occ-weather-wind'])).toEqual([map]);
  });

  it('shows a satellite layer only when its image time is known', async () => {
    // GIBS names the time of the clouds after a while; the rain it serves without a time.
    const service = createSimulatedSatelliteImagery({ goes: { time: '2026-11-13T14:50:00Z' }, imerg: null, latencyMs: 20 });
    const layers = { 'weather.goes': true, 'weather.imerg': true };
    const element = props => (
      <OccMap defaultView="region" weather={weatherAt()} satelliteService={service} layerOverrides={layers} {...props}>
        <ReferenceProbe />
        <MapLegend />
      </OccMap>
    );
    window.localStorage.setItem('elevant-occ-map-layers:v1', '{"weather.goes":false}');
    render(element({}));
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    // The scene's layers win over the browser's: both images are wanted in Región, and read.
    await act(async () => {});
    expect(service.calls.map(call => call.layer).sort()).toEqual(['goes', 'imerg']);
    // Until GIBS answers, nothing is shown and no tile is asked for.
    expect(layoutOf(map, 'occ-weather-goes-image')).toBe('none');
    expect(map.getSource('occ-weather-goes').setTilesCalls).toEqual([]);
    await act(() => new Promise(resolve => { setTimeout(resolve, 40); }));
    await settle();
    // The clouds pinned to the time of their image, then shown: the tiles before the layer.
    expect(map.getSource('occ-weather-goes').setTilesCalls).toEqual([[PINNED_GOES]]);
    expect(layoutOf(map, 'occ-weather-goes-image')).toBe('visible');
    const order = map.calls.filter(call => call.method === 'setTiles'
      || (call.method === 'setLayoutProperty' && call.args[0] === 'occ-weather-goes-image' && call.args[2] === 'visible'))
      .map(call => call.method);
    expect(order).toEqual(['setTiles', 'setLayoutProperty']);
    // The rain has no time: it stays hidden, its tiles untouched.
    expect(layoutOf(map, 'occ-weather-imerg-image')).toBe('none');
    expect(map.getSource('occ-weather-imerg').setTilesCalls).toEqual([]);
    // The legend lists the clouds with the time of their image, the rain not at all.
    act(() => fake.state.emit(map, 'idle'));
    expect(referenceProbe().kinds).toEqual(['goes']);
    expect(referenceProbe().imagery).toEqual({ goes: { time: '2026-11-13T14:50:00Z', precision: 'instant' } });
    const legend = within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem').map(item => item.textContent);
    expect(legend).toContain('Nubes por satélite (GOES-East, infrarrojo)Imagen de las 10:50');
    // Past the airfield threshold the image leaves the screen and the legend; nothing more is read there.
    const reads = service.calls.length;
    act(() => map.jumpTo({ center: [-68.36, 18.57], zoom: 15 }));
    act(() => fake.state.emit(map, 'idle'));
    expect(referenceProbe().kinds).not.toContain('goes');
    await settle();
    expect(service.calls).toHaveLength(reads);
    // The browser's choices were not touched by the scene's.
    expect(window.localStorage.getItem('elevant-occ-map-layers:v1')).toBe('{"weather.goes":false}');
    window.localStorage.clear();
  });

  it('credits NOAA while the wind is on screen', () => {
    const element = props => (
      <OccMap defaultView="airfield" frozenAt={WEATHER_NOON_MS} weather={weatherAt()} {...props}><ReferenceProbe /></OccMap>
    );
    render(element({}));
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    expect(attributionOf(map) ?? '').not.toMatch(/Clima/);
    // The map draws the wind in sight: «Clima: NOAA Aviation Weather Center», linked, with no traffic on the map.
    fake.state.setRenderedFeatures(map, (_geometry, options) => (options.layers.includes('occ-weather-wind') ? [windDrawn(map)] : []));
    act(() => fake.state.emit(map, 'idle'));
    expect(referenceProbe().kinds).toEqual(['wind']);
    expect(attributionOf(map)).toContain('Clima: <a href="https://aviationweather.gov/" target="_blank" '
      + 'rel="noopener noreferrer">NOAA Aviation Weather Center</a>');
    // Out of sight, or hidden by the layers menu, the credit goes.
    fake.state.setRenderedFeatures(map, () => []);
    act(() => fake.state.emit(map, 'idle'));
    expect(attributionOf(map)).not.toMatch(/Clima/);
    cleanup();

    // In English, with the aircraft data beside it when traffic is on screen too.
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><OccMap defaultView="region" weather={weatherAt()} traffic={noonTraffic()}
      layerOverrides={{ 'weather.wind': true }} /></LanguageScope>);
    const english = fake.state.liveMaps().at(-1);
    loadStyle(english);
    fake.state.setRenderedFeatures(english, (_geometry, options) => (options.layers.includes('occ-weather-wind')
      ? [windDrawn(english)] : []));
    act(() => fake.state.emit(english, 'idle'));
    expect(attributionOf(english)).toContain('Aircraft data: <a href="https://example.org/adsb"');
    expect(attributionOf(english)).toContain('Weather: <a href="https://aviationweather.gov/"');
  });

  it('the wind tooltip', async () => {
    const element = props => <OccMap defaultView="airfield" frozenAt={WEATHER_NOON_MS} weather={weatherAt()} {...props} />;
    const view = render(element({}));
    const map = fake.state.liveMaps().at(-1);
    loadStyle(map);
    const frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    fake.state.setRenderedFeatures(map, (_geometry, options) => (options.layers.includes('occ-weather-wind') ? [windDrawn(map)] : []));
    // The pointer on the wind: a pointer cursor and its card, «No oficial», the time of its METAR and every runway end.
    fake.state.emit(map, 'mousemove', { point: { x: 300, y: 200 }, lngLat: { lng: -68.34, lat: 18.58 } });
    act(() => frames.shift()(0));
    expect(map.getCanvas().style.cursor).toBe('pointer');
    const card = () => screen.getByRole('tooltip');
    expect(card()).toHaveAttribute('data-kind', 'wind');
    expect(card()).toHaveAttribute('data-pinned', 'false');
    expect(within(card()).getByText('Viento 100° 13 kt · No oficial')).toHaveClass('font-semibold');
    expect(within(card()).getByText('METAR de las 10:50')).toHaveClass('text-occ-muted');
    for (const line of ['R08: 12 kt de frente · 6 kt de la derecha', 'R26: 12 kt de cola · 6 kt de la izquierda',
      'R09: 13 kt de frente · 3 kt de la derecha', 'R27: 13 kt de cola · 3 kt de la izquierda']) {
      expect(within(card()).getByText(line)).toBeInTheDocument();
    }
    // A click holds it: nothing depends on hovering alone.
    await act(async () => fake.state.emit(map, 'click', { point: { x: 300, y: 200 }, lngLat: { lng: -68.34, lat: 18.58 } }));
    expect(card()).toHaveAttribute('data-pinned', 'true');
    // A new METAR: the held card says what the wind says now; a wind no longer drawn closes it.
    view.rerender(element({ weather: weatherAt({ wind: { directionDeg: 120, speedKt: 9 } }) }));
    expect(within(card()).getByText('Viento 120° 9 kt · No oficial')).toBeInTheDocument();
    view.rerender(element({ weather: weatherAt({ status: 'Unavailable' }) }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
