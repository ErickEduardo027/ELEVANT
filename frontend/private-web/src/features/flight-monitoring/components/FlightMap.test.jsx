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
import FlightMap from './FlightMap';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

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
    // Without stands the legend has nothing to explain yet.
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
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
