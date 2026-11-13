import { StrictMode, createRef } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import tailwindConfig from '../../../../tailwind.config.js';
import { findLegacyColourClasses } from '../../../styles/occLegacyBridge';
import { readSource } from '../../../styles/occSourceScan';
import { occColor } from '../../occ-ui/occPalette';
import { airfieldFeatures } from '../airport/airfieldFeatures';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { AIRFIELD_LAYER_IDS } from '../style/airfieldLayers';
import { referenceFeatures } from '../style/referenceLayers';
import { createMapStands, standPoint } from '../testing/mapFixtures';
import MapLegend from '../ui/MapLegend';
import { AIRFIELD_ATTRIBUTION } from './attribution';
import { boundsCenter, presetTargets } from './cameraPresets';
import { liveEngineCount } from './mapEngine';
import OccMap from './OccMap';
import { useOccMap } from './OccMapContext';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const STANDS = createMapStands();
const PAGE = '/admin-occ/positions-map?stationId=s-1';
// A layer of a screen of its own, next to the stands the map draws.
const EXTRA_OVERLAY = {
  sources: { 'test-notes': { type: 'geojson' } },
  layers: [{
    slot: 'standLabels', id: 'test-notes', type: 'symbol', source: 'test-notes',
    layout: { 'text-field': ['get', 'note'], 'text-font': ['Noto Sans Regular'] },
    metadata: { 'occ:group': 'notes' },
  }],
};
// Synthetic flights with and without a position, around Punta Cana.
const FLIGHTS = [
  { id: 'l:leg-1', flightKey: 'l:leg-1', heading: 120, latitude: 18.71, longitude: -68.52 },
  { id: 'p:prop-2', flightKey: 'p:prop-2', heading: null, latitude: null, longitude: null },
];

// What the map shares with its overlays, printed for the assertions (a plain element: <output> is a live region).
function Probe() {
  const {
    engineStatus, basemapStatus, activeView, fits, thresholds, standsOnScreen, standsGrouped, flightsOnScreen,
    airfieldOnScreen,
  } = useOccMap();
  return (
    <pre data-testid="probe">
      {JSON.stringify({
        engineStatus, basemapStatus, activeView, fits, thresholds, onScreen: standsOnScreen.map(stand => stand.id),
        grouped: standsGrouped, flightsOnScreen: flightsOnScreen.map(flight => flight.id), airfieldOnScreen,
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
      airfield: (narrow.fits.approach + narrow.fits.airfield) / 2,
    });
    expect(map.zoomRangeCalls.findLast(call => call.id === 'occ-stands-codes'))
      .toEqual({ id: 'occ-stands-codes', minzoom: narrow.thresholds.codes, maxzoom: 24 });
    expect(map.getZoom()).toBeCloseTo(narrow.fits.ramp, 6);

    // Folding the side panel gives the room back: new fits, new thresholds.
    rerender({ insets: { ...insets, right: 0 } });
    expect(map.getPadding()).toEqual({ ...insets, right: 0 });
    expect(root.style.getPropertyValue('--occ-map-inset-right')).toBe('0px');
    const wide = probe();
    expect(wide.fits.ramp).toBeCloseTo(fitFor(1440), 9);
    expect(map.zoomRangeCalls.at(-1).minzoom).toBeCloseTo(wide.fits.ramp - 0.3, 9);
    // The same insets in a new object change nothing.
    const ranges = map.zoomRangeCalls.length;
    rerender({ insets: { ...insets, right: 0 } });
    expect(map.zoomRangeCalls).toHaveLength(ranges);

    // A resize of the map re-derives them as well.
    act(() => fake.state.resize(map, { width: 1000 }));
    expect(probe().fits.ramp).toBeCloseTo(fitFor(1000), 9);
    expect(map.zoomRangeCalls.at(-1).minzoom).toBeCloseTo(fitFor(1000) - 0.3, 9);

    // A view flies inside the insets.
    press(map.getCanvas(), '3');
    expect(map.cameraCalls.at(-1).options.padding).toEqual({ ...insets, right: 0 });
  });

  it('counts on screen only the stands the insets leave in sight, again whenever the insets change', () => {
    const { map, rerender } = renderMap();
    loadStyle(map);
    // Up close on A2 (a 1440 × 900 map at zoom 18): A1 at x ≈ 948, A3 at x ≈ 471 and A4 at x ≈ 213.
    act(() => map.jumpTo({ center: standPoint('A2'), zoom: 18 }));
    expect(probe().onScreen).toEqual(['A1', 'A2', 'A3', 'A4']);

    // A panel 540 px wide over the right of the map hides A1, and the camera stays where it was.
    rerender({ insets: { top: 56, right: 540, bottom: 0, left: 0 } });
    expect(probe().onScreen).toEqual(['A2', 'A3', 'A4']);
    expect(map.getCenter().toArray()).toEqual(standPoint('A2'));
    expect(map.getZoom()).toBe(18);
    // Panels that cover the whole map leave nothing on screen; folded, every stand is back.
    rerender({ insets: { left: 720, right: 720 } });
    expect(probe().onScreen).toEqual([]);
    rerender({ insets: undefined });
    expect(probe().onScreen).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('while the map gathers the stands, counts on screen the ones it still draws on their own, read again when it settles', () => {
    const { map } = renderMap({ children: <MapLegend /> });
    loadStyle(map);
    const legend = () => within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem')
      .map(item => item.textContent);
    const group = 'Grupo de posicionesAcerca el mapa para ver cada una';
    // What MapLibre draws of the stands, as queryRenderedFeatures answers it for the layers it is asked about; only the
    // questions about the stands are counted (the airfield is asked about on its own).
    const queries = [];
    let drawn = [];
    fake.state.setRenderedFeatures(map, (geometry, options) => {
      if (options.layers.includes('occ-stands-frame')) queries.push({ geometry, options });
      return drawn.filter(feature => options.layers.includes(feature.layer.id));
    });
    const cluster = { id: 4, layer: { id: 'occ-stands-clusters' }, properties: { cluster: true, cluster_id: 4, point_count: 39 } };
    const alone = code => ({ id: code, layer: { id: 'occ-stands-frame' }, properties: { code } });

    // The ramp view draws every stand on its own: those in sight count, and nothing is asked of the map.
    expect(probe()).toMatchObject({ activeView: 'ramp', grouped: false });
    expect(probe().onScreen).toHaveLength(41);
    expect(queries).toEqual([]);

    // The airfield view gathers them. Right after the move the tiles of its zoom are still loading: nothing drawn yet.
    press(map.getCanvas(), '3');
    expect(queries).toEqual([{ geometry: [[0, 0], [1440, 900]], options: { layers: ['occ-stands-frame', 'occ-stands-clusters'] } }]);
    expect(probe()).toMatchObject({ activeView: 'airfield', onScreen: [], grouped: false });
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    // Once the map settles: clusters, and B21, with no neighbour close enough to join one, on its own (in two tiles).
    drawn = [cluster, alone('B21'), alone('B21')];
    act(() => fake.state.emit(map, 'idle'));
    expect(probe()).toMatchObject({ onScreen: ['B21'], grouped: true });
    expect(legend()).toEqual([group, 'Inhabilitada', 'No oficialUbicación de referencia interna, sin verificar']);

    // Only a stand whose place lies in sight counts: east of the airport A1 is, BN13 is not.
    drawn = [cluster, alone('A1'), alone('BN13')];
    act(() => map.jumpTo({ center: [-68.345, 18.5642] }));
    expect(probe()).toMatchObject({ activeView: 'airfield', onScreen: ['A1'], grouped: true });
    expect(legend()).toEqual([group, 'Ocupada']);
    // Every stand there drawn on its own: no cluster to explain.
    drawn = [alone('A1')];
    act(() => fake.state.emit(map, 'idle'));
    expect(probe()).toMatchObject({ onScreen: ['A1'], grouped: false });
    expect(legend()).toEqual(['Ocupada']);

    // The ramp view counts the stands in sight whatever the map answers; the region view draws none. Neither asks.
    const asked = queries.length;
    press(map.getCanvas(), '4');
    expect(probe().onScreen).toHaveLength(41);
    expect(probe().grouped).toBe(false);
    press(map.getCanvas(), '1');
    act(() => fake.state.emit(map, 'idle'));
    expect(probe()).toMatchObject({ activeView: 'region', onScreen: [], grouped: false });
    expect(queries).toHaveLength(asked);
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

  it('draws the selection in the selection slot with the accent colour', () => {
    const { map, rerender } = renderMap({ selection: { kind: 'stand', id: 'a05' } });
    loadStyle(map);
    const source = map.getSource('occ-selection');
    expect(source.data).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { kind: 'stand', id: 'A5' }, geometry: { type: 'Point', coordinates: standPoint('A5') } }],
    });
    // The top slot of the map, cyan, and data rather than feature state.
    const ids = map.layerIds();
    expect(ids.slice(ids.indexOf('slot-selection') + 1)).toEqual(['occ-selection-stand', 'occ-selection-ring']);
    expect(ids.at(-1)).toBe('occ-selection-ring');
    expect(map.getLayer('occ-selection-stand').paint['icon-color']).toBe(occColor('accent'));
    expect(map.getLayer('occ-selection-ring').paint['circle-stroke-color']).toBe(occColor('accent'));
    expect(map.calls.filter(call => call.method === 'setFeatureState')).toEqual([]);

    rerender({ selection: { kind: 'stand', id: 'B21' } });
    expect(source.data.features[0].geometry.coordinates).toEqual(standPoint('B21'));
    // The same selection in a new object writes nothing; a flight is ringed where it is; none clears the source.
    const writes = source.setDataCalls.length;
    rerender({ selection: { kind: 'stand', id: 'B21' } });
    expect(source.setDataCalls).toHaveLength(writes);
    rerender({ selection: { kind: 'flight', id: 'leg-7' }, flights: [{ id: 'leg-7', latitude: 18.7, longitude: -68.2 }] });
    expect(source.data.features).toEqual([{
      type: 'Feature', properties: { kind: 'flight', id: 'leg-7' }, geometry: { type: 'Point', coordinates: [-68.2, 18.7] },
    }]);
    rerender({ selection: null });
    expect(source.data.features).toEqual([]);

    // It survives a context loss as data: nothing needs to be written again.
    act(() => fake.state.loseContext(map));
    act(() => fake.state.restoreContext(map));
    loadStyle(map);
    expect(map.getSource('occ-selection').data.features).toEqual([]);
  });

  it('selects what is clicked, expands a cluster, reports the point while placing and sets the cursor once per frame', async () => {
    const onSelect = vi.fn();
    const onMapClick = vi.fn();
    const { map, rerender } = renderMap({ onSelect, onMapClick });
    loadStyle(map);
    const click = (features, lngLat = { lng: -68.36, lat: 18.564 }) => {
      fake.state.setRenderedFeatures(map, () => features);
      return act(async () => fake.state.emit(map, 'click', { point: { x: 100, y: 100 }, lngLat }));
    };

    await click([{ id: 'B21', layer: { id: 'occ-stands-frame' }, properties: { code: 'B21' } }]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'stand', id: 'B21' });
    await click([]);
    expect(onSelect).toHaveBeenCalledOnce();

    // A cluster zooms in to MapLibre's expansion zoom (a promise in 6.x) and selects nothing.
    await click([{ id: 9, source: 'occ-stands', layer: { id: 'occ-stands-clusters' }, properties: { cluster_id: 42, point_count: 5 },
      geometry: { type: 'Point', coordinates: [-68.37, 18.563] } }]);
    expect(map.getSource('occ-stands').expansionZoomCalls).toEqual([42]);
    expect(map.cameraCalls.at(-1)).toEqual({ method: 'easeTo', options: { center: [-68.37, 18.563], zoom: 16, duration: 500 } });
    expect(onSelect).toHaveBeenCalledOnce();

    // While placing a stand the click gives its point and selects nothing.
    rerender({ onSelect, onMapClick, placing: true });
    expect(map.getCanvas().style.cursor).toBe('crosshair');
    await click([{ id: 'B21', layer: { id: 'occ-stands-frame' }, properties: { code: 'B21' } }], { lng: -68.3611, lat: 18.5649 });
    expect(onMapClick).toHaveBeenCalledExactlyOnceWith({ latitude: 18.5649, longitude: -68.3611 });
    expect(onSelect).toHaveBeenCalledOnce();

    // The cursor: one pick per frame, a pointer over what can be chosen.
    rerender({ onSelect, onMapClick, placing: false });
    expect(map.getCanvas().style.cursor).toBe('');
    const frames = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    let picks = 0;
    fake.state.setRenderedFeatures(map, () => {
      picks += 1;
      return [{ id: 'A5', layer: { id: 'occ-stands-frame' }, properties: { code: 'A5' } }];
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

  it('draws the stands it is given in the stands slot with one setData per change and ends the clusters below the stand threshold', () => {
    const { map, rerender } = renderMap({ overlays: [EXTRA_OVERLAY] });
    loadStyle(map);
    const ids = map.layerIds();
    expect(ids.slice(ids.indexOf('slot-stands') + 1, ids.indexOf('slot-routes')))
      .toEqual(['occ-stands-clusters', 'occ-stands-fill', 'occ-stands-frame', 'occ-stands-glyph', 'occ-stands-clock']);
    // A screen's own overlays come after the map's in their slot.
    expect(ids.slice(ids.indexOf('slot-standLabels') + 1, ids.indexOf('slot-traffic')))
      .toEqual(['occ-stands-cluster-count', 'occ-stands-codes', 'occ-stands-keep-out', 'test-notes']);
    const source = map.getSource('occ-stands');
    expect(source.setDataCalls).toHaveLength(1);
    expect(source.data.features).toHaveLength(41);
    // Outside the console the clusters end one zoom below the codes threshold: one by one from the ramp view on.
    const limit = () => Math.floor(probe().thresholds.codes) - 1;
    expect(source.getClusterOptions()).toEqual({ cluster: true, clusterRadius: 50, clusterMaxZoom: limit() });
    expect(source.clusterOptionCalls).toHaveLength(1);
    expect(Math.floor(probe().fits.ramp)).toBeGreaterThan(limit());
    expect(Math.floor(probe().fits.airfield)).toBeLessThanOrEqual(limit());
    // Every stand layer starts at the stand threshold, the codes at theirs.
    const ranges = Object.fromEntries(map.zoomRangeCalls.map(call => [call.id, call.minzoom]));
    for (const id of ['occ-stands-clusters', 'occ-stands-fill', 'occ-stands-frame', 'occ-stands-glyph', 'occ-stands-clock',
      'occ-stands-cluster-count']) {
      expect(ranges[id], id).toBe(probe().thresholds.polygons);
    }
    expect(ranges['occ-stands-codes']).toBe(probe().thresholds.codes);

    // A narrower map moves the limit: one call for a new limit, none for the same one.
    const before = limit();
    act(() => fake.state.resize(map, { width: 1000 }));
    expect(limit()).toBe(before - 1);
    expect(source.clusterOptionCalls).toHaveLength(2);
    expect(source.getClusterOptions()).toMatchObject({ cluster: true, clusterMaxZoom: before - 1 });
    act(() => fake.state.resize(map, { width: 800 }));
    expect(limit()).toBe(before - 1);
    expect(source.clusterOptionCalls).toHaveLength(2);

    // The same stands in new objects write nothing; a changed state writes once; the map stays.
    rerender({ overlays: [EXTRA_OVERLAY], stands: createMapStands() });
    expect(source.setDataCalls).toHaveLength(1);
    rerender({ overlays: [EXTRA_OVERLAY], stands: createMapStands({ A2: { status: 'releasing' } }) });
    expect(source.setDataCalls).toHaveLength(2);
    expect(source.data.features.find(feature => feature.properties.code === 'A2').properties.status).toBe('releasing');
    expect(fake.state.maps).toEqual([map]);
    cleanup();

    // A map given no stands has no stand layers; one given an empty list is ready for them.
    expect(createMapWithout('stands')).toBeUndefined();
    render(<OccMap stands={[]} />);
    const empty = fake.state.liveMaps().at(-1);
    loadStyle(empty);
    expect(empty.getSource('occ-stands').data.features).toEqual([]);
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

  it('always marks PUJ with its reference point, up to the codes threshold', () => {
    const { map } = renderMap();
    loadStyle(map);
    expect(map.getSource('occ-reference').data).toEqual(referenceFeatures());
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
      ...AIRFIELD_LAYER_IDS, 'occ-reference-arp',
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
    await click([{ id: 'B21', layer: { id: 'occ-stands-frame' }, properties: { code: 'B21' } }]);
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

  it('imports occ-map.css and uses only occ-* classes (no opacity modifier)', () => {
    const component = readSource('src/features/maps/core/OccMap.jsx');
    expect(component).toMatch(/^import 'maplibre-gl\/dist\/maplibre-gl\.css';$/m);
    expect(component).toMatch(/^import '\.\.\/\.\.\/\.\.\/styles\/occ-map\.css';$/m);
    const files = [
      'src/features/maps/core/OccMap.jsx', 'src/features/maps/core/MapUnavailable.jsx',
      'src/features/maps/ui/MapLegend.jsx', 'src/features/maps/ui/MapPresetSwitcher.jsx', 'src/features/maps/ui/MapDock.jsx',
      'src/features/maps/ui/MapTooltip.jsx',
      'src/features/positions-map/components/PositionMap.jsx', 'src/features/flight-monitoring/components/FlightMap.jsx',
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
