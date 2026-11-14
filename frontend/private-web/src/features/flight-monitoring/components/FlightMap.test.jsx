import { StrictMode } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, SERVED_WORKER_URL, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { PUJ_ARP, presetTargets } from '../../maps/core/cameraPresets';
import { liveEngineCount } from '../../maps/core/mapEngine';
import { STAND_REFERENCE } from '../../maps/stands/standReference';
import { OPENFREEMAP_TILEJSON } from '../../maps/style/occStyle';
import { administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { OccShellTestProvider } from '../../admin-occ/shell/testing/occShellFixtures';
import {
  createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_HEX, TRAFFIC_NOON, TRAFFIC_STATION_ID,
} from '../../maps/testing/trafficFixtures';
import FlightMap from './FlightMap';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);
// Inside the OCC shell the map reads the station of the session and the map service; both are synthetic here: the
// session holds the station of the traffic fixtures, and the service answers their scenario without the network.
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ session: { stationScopes: [{ stationId: '5a000000-0000-4000-8000-000000000001', stationCode: 'PUJ' }] } }),
}));
vi.mock('../../../services/occMapService', async () => {
  const actual = await vi.importActual('../../../services/occMapService');
  const { createTrafficScenario } = await import('../../maps/testing/trafficFixtures');
  return { ...actual, occMapService: actual.createSimulatedOccMapAdapter({ scenario: createTrafficScenario() }) };
});

const fake = sharedFakeMapLibre();
const PAGE = '/admin-occ/flight-monitoring?stationId=s-1';
const VIEWPORT_PX = 1440;
const TARGETS = presetTargets({ stands: STAND_REFERENCE });
// The zoom at which the fake map fits the width of `bounds` into `width` pixels.
const fitWidth = (bounds, width = VIEWPORT_PX) => Math.log2((width * 360) / (512 * (bounds[1][0] - bounds[0][0])));

// Synthetic flights of Monitoreo: invented numbers; the first is about 19 NM from PUJ, the second about 110 NM.
function flight(overrides) {
  return { id: 1, flightNumber: 'ZZ101', status: 'approaching', heading: 90, latitude: 18.78, longitude: -68.12, ...overrides };
}
const FAR = { latitude: 19.5, longitude: -69.9 };

function renderFlights(props = {}, { strict = false } = {}) {
  const element = next => {
    const map = <FlightMap flights={[]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" {...next} />;
    return strict ? <StrictMode>{map}</StrictMode> : map;
  };
  let current = props;
  const view = render(element(current));
  return {
    ...view,
    map: fake.state.liveMaps().at(-1) ?? null,
    rerender: next => {
      current = { ...current, ...next };
      view.rerender(element(current));
    },
  };
}

const loadStyle = map => act(() => fake.state.emit(map, 'style.load'));

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
  window.history.replaceState({}, '', '/');
});

describe('FlightMap', () => {
  it('keeps the page and says the map is unavailable when the map cannot start (no WebGL2); reset and centre buttons are absent', async () => {
    fake.state.reset({ constructorError: new GPUInitializationError() });
    const onSelectFlight = vi.fn();
    const { unmount } = renderFlights({ flights: [flight({ id: 1 }), flight({ id: 2, flightNumber: 'ZZ202' })], onSelectFlight });
    const alert = await screen.findByRole('alert');
    expect(fake.state.maps).toHaveLength(0);
    expect(alert).toHaveTextContent('El mapa no está disponible en este navegador');
    expect(alert).toHaveTextContent('La lista de vuelos sigue funcionando. Para ver el mapa, usa un navegador con la aceleración gráfica activada.');
    expect(screen.getByTestId('flight-map-container')).toBeInTheDocument();
    expect(screen.queryByLabelText('Restablecer vista')).toBeNull();
    expect(screen.queryByLabelText('Centrar PUJ')).toBeNull();
    // The flights stay at hand in the list, with the page's own ids.
    const list = within(alert).getByRole('group', { name: 'Vuelos del mapa' });
    await userEvent.click(within(list).getByRole('button', { name: 'ZZ202' }));
    expect(onSelectFlight).toHaveBeenCalledExactlyOnceWith(2);
    unmount();

    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><FlightMap flights={[flight({ id: 1 })]} selectedFlightId={1} onSelectFlight={() => {}} /></LanguageScope>);
    const english = await screen.findByRole('alert');
    expect(english).toHaveTextContent('The map is not available in this browser');
    expect(within(english).getByRole('button', { name: 'ZZ101' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('mounts one map on the NOC style (no demotiles) with the worker URL set and opens on the region view', () => {
    const { map } = renderFlights();
    expect(fake.state.liveMaps()).toEqual([map]);
    expect(fake.state.workerUrl).toBe(SERVED_WORKER_URL);
    const { style } = map.options;
    expect(style.sources.openmaptiles.url).toBe(OPENFREEMAP_TILEJSON);
    expect(JSON.stringify(style)).not.toMatch(/demotiles/);
    expect(style.sources['occ-flights']).toMatchObject({ type: 'geojson', promoteId: 'id' });
    // Monitoreo draws no stands; PUJ is its reference point, not a DOM marker.
    expect(style.sources['occ-stands']).toBeUndefined();
    expect(style.sources['occ-reference']).toBeDefined();
    expect(map.getZoom()).toBeCloseTo(fitWidth(TARGETS.region.bounds), 6);
    expect(map.getCenter().lng).toBeCloseTo(PUJ_ARP[0], 9);
    expect(map.getCenter().lat).toBeCloseTo(PUJ_ARP[1], 9);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'region');
    expect(screen.getByTestId('flight-map-container').querySelectorAll('.maplibregl-canvas')).toHaveLength(1);
    expect(document.querySelector('.maplibregl-marker')).toBeNull();
    loadStyle(map);
    expect(map.getSource('occ-reference').data.features.map(feature => feature.properties.label)).toEqual(['PUJ']);
    expect(within(screen.getByTestId('map-preset-switcher')).getByRole('button', { name: /Región/ }))
      .toHaveAttribute('aria-pressed', 'true');
    // With no flight on screen the legend has nothing to explain.
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
  });

  it('shows its legend, the only «Leyenda» of the map, while a flight is on screen', () => {
    const { map } = renderFlights({ flights: [flight({ id: 1 }), flight({ id: 2, latitude: null, longitude: null })] });
    loadStyle(map);
    // The region view holds the flight about 19 NM from PUJ: the legend explains its aircraft.
    const legend = screen.getByTestId('map-legend');
    expect(screen.getAllByRole('button', { name: 'Leyenda' })).toEqual([within(legend).getByRole('button', { name: 'Leyenda' })]);
    expect(within(legend).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['VueloApunta según su rumbo; al norte si no se conoce']);
    // Away from the flight there is nothing to explain; the legend comes back with it.
    act(() => map.jumpTo({ center: [-70.55, 19.45], zoom: 12 }));
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    act(() => map.jumpTo({ center: [-68.12, 18.78], zoom: 12 }));
    expect(screen.getByTestId('map-legend')).toBeInTheDocument();
  });

  it('says the base map did not load without naming stands it does not draw, and keeps its flights', () => {
    const { map } = renderFlights({ flights: [flight({ id: 1 })] });
    loadStyle(map);
    act(() => fake.state.emit(map, 'error', { sourceId: 'openmaptiles', error: new Error('Failed to fetch') }));
    // Monitoreo opens on the region and draws no stand: the notice speaks of the ELEVANT data, not of stands.
    const root = screen.getByTestId('occ-map');
    expect(root).toHaveAttribute('data-occ-view', 'region');
    expect(root).toHaveAttribute('data-occ-basemap', 'degraded');
    expect(map.options.style.sources['occ-stands']).toBeUndefined();
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('No se pudo cargar el mapa base. Los datos de ELEVANT siguen en el mapa.');
    expect(notice.textContent).not.toMatch(/posici/i);
    // It is a notice, not a fallback: the flight is still drawn and its legend still explains it.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(map.getSource('occ-flights').data.features).toHaveLength(1);
    expect(within(screen.getByTestId('map-legend')).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['VueloApunta según su rumbo; al norte si no se conoce']);
    cleanup();

    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><FlightMap flights={[flight({ id: 1 })]} selectedFlightId={null} onSelectFlight={() => {}} /></LanguageScope>);
    const english = fake.state.liveMaps().at(-1);
    loadStyle(english);
    act(() => fake.state.emit(english, 'error', { sourceId: 'openmaptiles', error: new Error('Failed to fetch') }));
    expect(screen.getByRole('status')).toHaveTextContent('The base map could not be loaded. ELEVANT data is still on the map.');
  });

  it('opens on approach when the linked flight is within 40 NM', () => {
    let view = renderFlights({ flights: [flight({ id: 7 })], selectedFlightId: 7 });
    expect(view.map.getZoom()).toBeCloseTo(fitWidth(TARGETS.approach.bounds), 6);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'approach');
    // The view frames the flight: the map does not fly to it as it opens.
    expect(view.map.getCenter().lng).toBeCloseTo(PUJ_ARP[0], 9);
    expect(view.map.cameraCalls.filter(call => call.method !== 'setPadding').map(call => call.method)).toEqual(['jumpTo']);
    view.unmount();

    // A linked flight farther out, or none with a position, opens on the region.
    view = renderFlights({ flights: [flight({ id: 7, ...FAR })], selectedFlightId: 7 });
    expect(view.map.getZoom()).toBeCloseTo(fitWidth(TARGETS.region.bounds), 6);
    view.unmount();
    view = renderFlights({ flights: [flight({ id: 7, latitude: null, longitude: null })], selectedFlightId: 7 });
    expect(view.map.getZoom()).toBeCloseTo(fitWidth(TARGETS.region.bounds), 6);
  });

  it('flights with a position reach the flight source in one setData instead of markers, and a symbol click selects the flight', () => {
    const onSelectFlight = vi.fn();
    const flights = [flight({ id: 1 }), flight({ id: 2, ...FAR, heading: null }), flight({ id: 3, latitude: null, longitude: null })];
    const { map, rerender } = renderFlights({ flights, onSelectFlight });
    loadStyle(map);
    const source = map.getSource('occ-flights');
    expect(source.setDataCalls).toHaveLength(1);
    expect(source.data.features.map(feature => [feature.properties, feature.geometry.coordinates])).toEqual([
      [{ id: '1', heading: 90 }, [-68.12, 18.78]],
      [{ id: '2', heading: 0 }, [-69.9, 19.5]],
    ]);
    const ids = map.layerIds();
    expect(ids.slice(ids.indexOf('slot-traffic') + 1, ids.indexOf('slot-selection'))).toEqual(['occ-flights']);
    expect(document.querySelector('.maplibregl-marker')).toBeNull();

    // A flight that moved is one more write on the same map; the same flights read again write nothing.
    rerender({ flights: [flight({ id: 1, latitude: 18.8, longitude: -68.1 }), flights[1], flights[2]] });
    expect(source.setDataCalls).toHaveLength(2);
    expect(source.data.features[0].geometry.coordinates).toEqual([-68.1, 18.8]);
    rerender({ flights: [flight({ id: 1, latitude: 18.8, longitude: -68.1 }), { ...flights[1] }, { ...flights[2] }] });
    expect(source.setDataCalls).toHaveLength(2);
    expect(fake.state.maps).toEqual([map]);

    // A click on a symbol selects that flight with the page's own id.
    fake.state.setRenderedFeatures(map, (_geometry, options) => (options.layers.includes('occ-flights')
      ? [{ id: '2', source: 'occ-flights', layer: { id: 'occ-flights' }, properties: { id: '2', heading: 0 } }]
      : []));
    act(() => fake.state.emit(map, 'click', { point: { x: 10, y: 10 }, lngLat: { lng: -69.9, lat: 19.5 } }));
    expect(onSelectFlight).toHaveBeenCalledExactlyOnceWith(2);
    // Esc on the map clears a selection.
    rerender({ selectedFlightId: 2 });
    const escape = createEvent.keyDown(map.getCanvas(), { key: 'Escape' });
    fireEvent(map.getCanvas(), escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onSelectFlight).toHaveBeenLastCalledWith(null);
  });

  it('flies to a newly selected flight once it has a position, keeping the zoom', () => {
    const flights = [flight({ id: 1 }), flight({ id: 2, ...FAR }), flight({ id: 3, latitude: null, longitude: null })];
    const { map, rerender } = renderFlights({ flights });
    loadStyle(map);
    const zoom = map.getZoom();
    rerender({ selectedFlightId: 2 });
    expect(map.getCenter().toArray()).toEqual([FAR.longitude, FAR.latitude]);
    expect(map.getZoom()).toBeCloseTo(zoom, 9);
    // Its selection ring is drawn where it is.
    expect(map.getSource('occ-selection').data.features[0].geometry.coordinates).toEqual([FAR.longitude, FAR.latitude]);

    // A flight without a position moves nothing until one arrives.
    const calls = map.cameraCalls.length;
    rerender({ selectedFlightId: 3 });
    expect(map.cameraCalls).toHaveLength(calls);
    rerender({ flights: [flights[0], flights[1], flight({ id: 3, latitude: 18.9, longitude: -68.6 })] });
    expect(map.getCenter().toArray()).toEqual([-68.6, 18.9]);
    // A later re-read of the same flights does not fly again.
    const after = map.cameraCalls.length;
    rerender({ flights: [flights[0], flights[1], flight({ id: 3, latitude: 18.9, longitude: -68.6 })] });
    expect(map.cameraCalls).toHaveLength(after);
  });

  it('no setStyle on theme change', () => {
    const { map, rerender } = renderFlights({ flights: [flight({ id: 1 })], theme: 'light' });
    loadStyle(map);
    rerender({ theme: 'dark' });
    rerender({ theme: 'light' });
    expect(map.styleCalls).toEqual([]);
    expect(map.calls.filter(call => call.method === 'setStyle')).toEqual([]);
    expect(fake.state.maps).toEqual([map]);
  });

  it('«Centrar PUJ» flies to the approach view and «Restablecer vista» fits the flights and PUJ', async () => {
    const user = userEvent.setup();
    const { map, rerender } = renderFlights({ flights: [flight({ id: 1 }), flight({ id: 2, ...FAR })] });
    loadStyle(map);
    await user.click(screen.getByRole('button', { name: 'Centrar PUJ' }));
    expect(map.getZoom()).toBeCloseTo(fitWidth(TARGETS.approach.bounds), 6);
    expect(map.getCenter().lng).toBeCloseTo(PUJ_ARP[0], 9);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'approach');

    // PUJ and both flights, with 60 px to spare on every side.
    await user.click(screen.getByRole('button', { name: 'Restablecer vista' }));
    expect(map.getZoom()).toBeCloseTo(fitWidth([[FAR.longitude, 0], [-68.12, 0]], VIEWPORT_PX - 120), 6);
    expect(map.getCenter().lng).toBeCloseTo((FAR.longitude - 68.12) / 2, 9);
    expect(map.getCenter().lat).toBeCloseTo((PUJ_ARP[1] + FAR.latitude) / 2, 9);
    expect(map.getPitch()).toBe(0);

    // Without a flight on the map it goes back to the region.
    rerender({ flights: [] });
    await user.click(screen.getByRole('button', { name: 'Restablecer vista' }));
    expect(map.getZoom()).toBeCloseTo(fitWidth(TARGETS.region.bounds), 6);
    // Both buttons only fly: the URL keeps no view.
    expect(window.location.search).toBe('?stationId=s-1');
    expect(screen.getByRole('button', { name: 'Restablecer vista' })).toHaveAttribute('title', 'Restablecer vista');
  });

  it('leaves exactly one live map after a StrictMode double mount', async () => {
    const user = userEvent.setup();
    const before = liveEngineCount();
    const { unmount } = renderFlights({ flights: [flight({ id: 1 })] }, { strict: true });
    expect(fake.state.maps).toHaveLength(2);
    const [first, map] = fake.state.maps;
    expect(fake.state.liveMaps()).toEqual([map]);
    expect(liveEngineCount()).toBe(before + 1);
    expect(screen.getByTestId('flight-map-container').querySelectorAll('.maplibregl-canvas')).toHaveLength(1);
    // The map that stayed is the one that answers: it has the flights and its buttons move it.
    loadStyle(map);
    expect(map.getSource('occ-flights').data.features).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Centrar PUJ' }));
    expect(map.getZoom()).toBeCloseTo(fitWidth(TARGETS.approach.bounds), 6);
    expect(first.cameraCalls.filter(call => call.method !== 'setPadding' && call.method !== 'jumpTo')).toEqual([]);
    unmount();
    expect(fake.state.liveMaps()).toEqual([]);
    expect(liveEngineCount()).toBe(before);
  });
});
describe('FlightMap inside the OCC shell (live traffic, PR M5)', () => {
  const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
  // The page's flights of the visit ZZ161 (ids are leg ids, as the planning snapshot gives them), and one more.
  const [arrivalRow, departureRow] = createMapFlights().flights;
  const pageFlight = (row, extra = {}) => ({ id: row.legId, flightNumber: row.flightNumber, latitude: null, longitude: null,
    heading: null, ...extra });
  const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  function renderLive(props = {}) {
    const element = next => (
      <DepartmentAccessProvider initialAccess={ACCESS} load={vi.fn().mockResolvedValue(ACCESS)} observe={false}>
        <OccShellTestProvider>
          <FlightMap flights={[pageFlight(arrivalRow), pageFlight(departureRow)]} selectedFlightId={null}
            onSelectFlight={() => {}} theme="dark" {...next} />
        </OccShellTestProvider>
      </DepartmentAccessProvider>
    );
    const view = render(element(props));
    return { ...view, map: fake.state.liveMaps().at(-1), rerender: next => view.rerender(element({ ...props, ...next })) };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(Date.parse(TRAFFIC_NOON));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('draws the live traffic of the station, says nothing more while all is well and credits its source', async () => {
    const { map } = renderLive();
    expect(map.options.style.sources['occ-traffic']).toMatchObject({ type: 'geojson', promoteId: 'id' });
    loadStyle(map);
    await flush();
    const drawn = map.getSource('occ-traffic').updateDataCalls.flatMap(diff => diff.add.map(feature => feature.properties.id));
    expect(drawn).toContain(`f:${TRAFFIC_FLIGHT_KEY.arrival}`);
    expect(drawn).toContain(`h:${TRAFFIC_HEX.overflight}`);
    // The credit of the aircraft data, as a link over the map and in its attribution; no chip while the picture is Live.
    const status = screen.getByTestId('map-source-status');
    expect(within(status).getByRole('link', { name: 'Red ADS-B de prueba' })).toHaveAttribute('href', 'https://example.org/adsb');
    expect(within(status).queryByRole('status')).not.toBeInTheDocument();
    const attribution = map.controls.find(entry => entry.control instanceof fake.module.AttributionControl).control;
    expect(attribution.options.customAttribution).toContain('Datos de aeronaves');
    // The legend explains the traffic on screen.
    expect(within(screen.getByTestId('map-legend')).getAllByRole('listitem')[0]).toHaveTextContent('Vuelo de AVIAM que llega');
  });

  it('draws a flight the traffic shows once, as traffic, and selects the page\'s flight from its aircraft', async () => {
    const onSelectFlight = vi.fn();
    // ZZ161 has a position of its own on the page, but the traffic already draws its aircraft: it is not drawn twice.
    const { map } = renderLive({ onSelectFlight,
      flights: [pageFlight(arrivalRow, { latitude: 18.9, longitude: -68.6, heading: 90 }), pageFlight(departureRow, { latitude: 19, longitude: -68.5 })] });
    loadStyle(map);
    await flush();
    expect(map.getSource('occ-flights').data.features.map(feature => feature.properties.id)).toEqual([departureRow.legId]);

    // A click on the ELEVANT aircraft selects the page's flight by its leg.
    const click = feature => {
      fake.state.setRenderedFeatures(map, (_geometry, options) => (options.layers.includes(feature.layer.id) ? [feature] : []));
      return act(async () => { fake.state.emit(map, 'click', { point: { x: 100, y: 100 }, lngLat: { lng: -68.5, lat: 18.5 } }); });
    };
    await click({ layer: { id: 'occ-traffic-aviam' }, properties: { id: `f:${TRAFFIC_FLIGHT_KEY.arrival}`, flightKey: TRAFFIC_FLIGHT_KEY.arrival } });
    expect(onSelectFlight).toHaveBeenLastCalledWith(arrivalRow.legId);
    // The demo arrival has no row on the page: it is selected by its key.
    await click({ layer: { id: 'occ-traffic-aviam' }, properties: { id: `f:${TRAFFIC_FLIGHT_KEY.demoArrival}`, flightKey: TRAFFIC_FLIGHT_KEY.demoArrival } });
    expect(onSelectFlight).toHaveBeenLastCalledWith(TRAFFIC_FLIGHT_KEY.demoArrival);
    // Other traffic is selected by its address in the URL, and the page's flight is let go.
    await click({ layer: { id: 'occ-traffic-other' }, properties: { id: `h:${TRAFFIC_HEX.overflight}`, hex: TRAFFIC_HEX.overflight } });
    expect(onSelectFlight).toHaveBeenLastCalledWith(null);
    expect(new URLSearchParams(window.location.search).get('hex')).toBe(TRAFFIC_HEX.overflight);
    expect(new URLSearchParams(window.location.search).get('stationId')).toBe('s-1');
  });

  it('shows the chosen flight drawn by the traffic in cyan, by the page\'s leg id', async () => {
    const { map, rerender } = renderLive();
    loadStyle(map);
    await flush();
    rerender({ selectedFlightId: arrivalRow.legId });
    await flush();
    const last = map.getSource('occ-traffic').updateDataCalls.at(-1);
    expect(last.update).toEqual(expect.arrayContaining([{ id: `f:${TRAFFIC_FLIGHT_KEY.arrival}`, addOrUpdateProperties:
      expect.arrayContaining([{ key: 'selected', value: true }]) }]));
  });

  it('is the plain map outside the OCC shell, without live traffic', () => {
    const { map } = renderFlights({ flights: [flight({ id: 1 })] });
    expect(map.options.style.sources['occ-traffic']).toBeUndefined();
    expect(screen.queryByTestId('map-source-status')).not.toBeInTheDocument();
    expect(TRAFFIC_STATION_ID).toBe('5a000000-0000-4000-8000-000000000001');
  });
});
