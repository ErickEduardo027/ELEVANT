import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { LAYERS_STORAGE_KEY } from '../core/layersMenu';
import OccMap from '../core/OccMap';
import { OCC_MAP_IDLE, OccMapContext } from '../core/OccMapContext';
import {
  createAirPicture, createEstimates, createMapFlights, TRAFFIC_HEX as HEX, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import MapDock from './MapDock';
import MapLayersMenu from './MapLayersMenu';
import MapLegend from './MapLegend';
import { createSimulatedSatelliteImagery } from '../useSatelliteImagery';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const PAGE = '/admin-occ/flight-monitoring?stationId=s-1';

// The synthetic traffic of the lab's noon, as useMapSituation gives it to the map.
function noonTraffic() {
  const situation = buildSituation({ picture: toPictureModel(createAirPicture()), flights: toFlightsModel(createMapFlights()),
    nowMs: Date.parse(TRAFFIC_NOON), estimates: createEstimates() });
  return { aircraft: situation.aircraft, trails: null, route: null, source: null };
}

function renderMap({ selection = null, onSelect = vi.fn(), traffic = noonTraffic(), menu = true } = {}) {
  const view = render(
    <OccMap defaultView="region" traffic={traffic} selection={selection} onSelect={onSelect}>
      <MapDock>
        {menu && <MapLayersMenu />}
        <MapLegend />
      </MapDock>
    </OccMap>,
  );
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  return { ...view, map, onSelect };
}

const press = (target, key, init = {}) => {
  const event = createEvent.keyDown(target, { key, ...init });
  fireEvent(target, event);
  return event;
};
const layersButton = () => within(screen.getByTestId('map-layers-menu')).getByRole('button', { name: 'Capas' });
const trafficGroup = () => screen.queryByRole('group', { name: 'Tráfico' });
const checkbox = name => within(trafficGroup()).getByRole('checkbox', { name });
const visibilityOf = (map, id) => map.getLayoutProperty(id, 'visibility');
const legendTraffic = () => within(screen.getByRole('list', { name: 'Leyenda' })).getAllByRole('listitem')
  .map(item => item.getAttribute('data-legend-traffic')).filter(Boolean);

beforeEach(() => {
  fake.state.reset();
  window.localStorage.clear();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('MapLayersMenu', () => {
  it('L opens and closes the menu from the map', () => {
    const { map } = renderMap();
    const canvas = map.getCanvas();
    expect(layersButton()).toHaveAttribute('aria-expanded', 'false');
    expect(layersButton()).toHaveAttribute('aria-keyshortcuts', 'L');
    expect(trafficGroup()).toBeNull();

    const open = press(canvas, 'l');
    expect(open.defaultPrevented).toBe(true);
    expect(layersButton()).toHaveAttribute('aria-expanded', 'true');
    // The Tráfico group of design E7, in its order, with its defaults; Vuelos de AVIAM is always on.
    const boxes = within(trafficGroup()).getAllByRole('checkbox');
    expect(boxes.map(box => box.labels[0].textContent)).toEqual(['Vuelos de AVIAM', 'Otro tráfico',
      'Etiquetas de todo el tráfico', 'Estelas de todo el tráfico', 'Ruta del vuelo elegido']);
    expect(boxes.map(box => box.checked)).toEqual([true, true, false, false, true]);
    expect(checkbox('Vuelos de AVIAM')).toBeDisabled();
    expect(checkbox('Vuelos de AVIAM')).toHaveAccessibleDescription('Siempre visible');
    expect(screen.getByRole('group', { name: 'Capas del mapa' })).toContainElement(trafficGroup());

    // The same key closes it, in any case; with Ctrl it is the browser's.
    expect(press(canvas, 'L').defaultPrevented).toBe(true);
    expect(trafficGroup()).toBeNull();
    expect(press(canvas, 'l', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(layersButton()).toHaveAttribute('aria-expanded', 'false');
    cleanup();

    // A map that shows no menu leaves L alone.
    const plain = renderMap({ menu: false });
    expect(press(plain.map.getCanvas(), 'l').defaultPrevented).toBe(false);
    cleanup();
    // A map without traffic still has the references of PR M8 to offer: L opens their group alone.
    const empty = render(<OccMap defaultView="region"><MapDock><MapLayersMenu /></MapDock></OccMap>);
    const bare = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(bare, 'style.load'));
    expect(press(bare.getCanvas(), 'l').defaultPrevented).toBe(true);
    expect(screen.getByRole('group', { name: 'Referencias' })).toBeInTheDocument();
    expect(trafficGroup()).toBeNull();
    empty.unmount();

    // A map that cannot draw shows its fallback list, without the menu.
    fake.state.reset({ constructorError: new GPUInitializationError() });
    render(<OccMap defaultView="region" traffic={noonTraffic()}><MapDock><MapLayersMenu /></MapDock></OccMap>);
    return screen.findByRole('alert').then(() => {
      expect(screen.queryByTestId('map-layers-menu')).not.toBeInTheDocument();
    });
  });

  it('one Esc closes only the menu', async () => {
    const user = userEvent.setup();
    const { map, onSelect } = renderMap({ selection: { kind: 'aircraft', id: HEX.overflight } });
    const canvas = map.getCanvas();

    // Opened from the map: the first Esc closes the menu, marked as used; the second clears the selection.
    press(canvas, 'l');
    const first = press(canvas, 'Escape');
    expect(first.defaultPrevented).toBe(true);
    expect(trafficGroup()).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(press(canvas, 'Escape').defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);

    // Opened with its button, Esc on one of its checkboxes closes it and gives the focus back to the button.
    await user.click(layersButton());
    expect(layersButton()).toHaveAttribute('aria-expanded', 'true');
    const box = checkbox('Otro tráfico');
    box.focus();
    const inside = press(box, 'Escape');
    expect(inside.defaultPrevented).toBe(true);
    expect(trafficGroup()).toBeNull();
    expect(layersButton()).toHaveFocus();
    expect(onSelect).toHaveBeenCalledTimes(1);
    // And on its own button.
    await user.click(layersButton());
    expect(press(layersButton(), 'Escape').defaultPrevented).toBe(true);
    expect(trafficGroup()).toBeNull();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('turning Otro tráfico off hides its layers and survives a remount', async () => {
    const user = userEvent.setup();
    const first = renderMap();
    expect(legendTraffic()).toContain('other');
    await user.click(layersButton());
    // Vuelos de AVIAM cannot be turned off.
    await user.click(checkbox('Vuelos de AVIAM'));
    expect(checkbox('Vuelos de AVIAM')).toBeChecked();
    expect(window.localStorage.getItem(LAYERS_STORAGE_KEY)).toBeNull();

    await user.click(checkbox('Otro tráfico'));
    expect(checkbox('Otro tráfico')).not.toBeChecked();
    for (const id of ['occ-traffic-other', 'occ-traffic-other-ground', 'occ-traffic-tags-other', 'occ-trails-other']) {
      expect(visibilityOf(first.map, id), id).toBe('none');
    }
    expect(visibilityOf(first.map, 'occ-traffic-aviam')).toBe('visible');
    // Only the difference from the defaults is kept, and the legend no longer lists what the map no longer shows.
    expect(window.localStorage.getItem(LAYERS_STORAGE_KEY)).toBe('{"traffic.other":false}');
    expect(legendTraffic()).not.toContain('other');
    first.unmount();

    // A new map in this browser starts with the choice: the box unchecked and the layers hidden from its first frame.
    const second = renderMap();
    expect(visibilityOf(second.map, 'occ-traffic-other')).toBe('none');
    await user.click(layersButton());
    expect(checkbox('Otro tráfico')).not.toBeChecked();
    // Labels for all the traffic need the other traffic on: they show once both are.
    await user.click(checkbox('Etiquetas de todo el tráfico'));
    expect(visibilityOf(second.map, 'occ-traffic-tags-other')).toBe('none');
    await user.click(checkbox('Otro tráfico'));
    expect(visibilityOf(second.map, 'occ-traffic-other')).toBe('visible');
    expect(visibilityOf(second.map, 'occ-traffic-tags-other')).toBe('visible');
    // Back to the default, the entry goes; the labels stay as the one difference.
    expect(window.localStorage.getItem(LAYERS_STORAGE_KEY)).toBe('{"traffic.labels":true}');
    // The route of the chosen flight hides with its key: its four layers (PR M6), observed, estimated, still to fly and
    // its marked points.
    await user.click(checkbox('Ruta del vuelo elegido'));
    expect(['occ-route-flown', 'occ-route-flown-estimated', 'occ-route-remaining', 'occ-route-marks']
      .map(id => visibilityOf(second.map, id))).toEqual(['none', 'none', 'none', 'none']);
  });

  it('lists the Referencias group after Tráfico, only with its layers in the style, and its keys work', async () => {
    const user = userEvent.setup();
    const { map } = renderMap();
    await user.click(layersButton());
    // Below Tráfico, the five keys of design E7 with the defaults of the Región view.
    const groups = within(screen.getByRole('group', { name: 'Capas del mapa' })).getAllByRole('group');
    expect(groups.map(group => group.querySelector('legend').textContent))
      .toEqual(['Tráfico', 'Referencias']);
    const references = screen.getByRole('group', { name: 'Referencias' });
    const boxes = within(references).getAllByRole('checkbox');
    expect(boxes.map(box => box.labels[0].textContent)).toEqual(['Aeropuertos de la región', 'Anillos de distancia',
      'Ejes de pista', 'Radioayudas', 'Día y noche']);
    expect(boxes.map(box => box.checked)).toEqual([true, true, false, false, true]);
    expect(boxes.some(box => box.disabled)).toBe(false);
    // Turning the rings off hides their layers and keeps the choice; turning the centrelines on shows theirs.
    expect(visibilityOf(map, 'occ-reference-rings-region')).toBe('visible');
    await user.click(within(references).getByRole('checkbox', { name: 'Anillos de distancia' }));
    for (const id of ['occ-reference-rings-region', 'occ-reference-ring-labels-region', 'occ-reference-rings-approach']) {
      expect(visibilityOf(map, id), id).toBe('none');
    }
    await user.click(within(references).getByRole('checkbox', { name: 'Ejes de pista' }));
    expect(visibilityOf(map, 'occ-reference-centrelines')).toBe('visible');
    expect(window.localStorage.getItem(LAYERS_STORAGE_KEY)).toBe('{"centrelines":true,"rings":false}');
    // The mark of PUJ is no key of the menu: it always shows.
    expect(visibilityOf(map, 'occ-reference-arp')).not.toBe('none');
    cleanup();

    // A map whose style has no reference layers (the menu reads the keys the map offers) shows no Referencias group.
    render(
      <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, engineStatus: 'ready', layersMenuOpen: true,
        layers: { keys: ['traffic.aviam', 'traffic.other'], values: { 'traffic.aviam': true, 'traffic.other': true } } }}>
        <MapLayersMenu />
      </OccMapContext.Provider>,
    );
    expect(screen.getByRole('group', { name: 'Tráfico' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Referencias' })).not.toBeInTheDocument();
  });

  it('lists the Meteorología group after Referencias on a map with weather, and says why a key on shows nothing', async () => {
    const user = userEvent.setup();
    // The weather of PR M8, synthetic: the aerodrome weather without a METAR; GIBS simulated, the clouds without a time.
    const service = createSimulatedSatelliteImagery({ goes: null, imerg: { time: '2026-11-13T14:30:00Z' } });
    const weather = { status: 'success', apiStatus: 'Unavailable', data: null };
    render(
      <OccMap defaultView="region" weather={weather} satelliteService={service}>
        <MapDock><MapLayersMenu /></MapDock>
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    await user.click(layersButton());
    const groups = within(screen.getByRole('group', { name: 'Capas del mapa' })).getAllByRole('group');
    expect(groups.map(group => group.querySelector('legend').textContent)).toEqual(['Referencias', 'Meteorología']);
    const meteorology = screen.getByRole('group', { name: 'Meteorología' });
    const boxes = within(meteorology).getAllByRole('checkbox');
    // The keys of design E7 in Región: the satellite images off, the wind off (it is on in Aproximación and Aeródromo).
    expect(boxes.map(box => box.labels[0].textContent)).toEqual(['Nubes por satélite', 'Lluvia estimada', 'Viento en pista']);
    expect(boxes.map(box => box.checked)).toEqual([false, false, false]);
    expect(boxes.map(box => box.getAttribute('aria-describedby'))).toEqual([null, null, null]);
    // Turned on: GIBS is read; an image without a time says so, the other says the time of its image, and is shown.
    await user.click(within(meteorology).getByRole('checkbox', { name: 'Nubes por satélite' }));
    await user.click(within(meteorology).getByRole('checkbox', { name: 'Lluvia estimada' }));
    await act(() => new Promise(resolve => { setTimeout(resolve, 0); }));
    expect(within(meteorology).getByRole('checkbox', { name: 'Nubes por satélite' }))
      .toHaveAccessibleDescription('No hay imagen en este momento.');
    expect(within(meteorology).getByRole('checkbox', { name: 'Lluvia estimada' })).toHaveAccessibleDescription('Imagen de las 10:30');
    expect(visibilityOf(map, 'occ-weather-goes-image')).toBe('none');
    expect(visibilityOf(map, 'occ-weather-imerg-image')).toBe('visible');
    // The wind on, with an aerodrome weather that has none: the menu says the state of that weather.
    await user.click(within(meteorology).getByRole('checkbox', { name: 'Viento en pista' }));
    expect(within(meteorology).getByRole('checkbox', { name: 'Viento en pista' }))
      .toHaveAccessibleDescription('No hay clima del aeródromo en este momento.');
    // The choices are kept as differences from the view on screen.
    expect(JSON.parse(window.localStorage.getItem(LAYERS_STORAGE_KEY))).toEqual({
      'weather.goes': true, 'weather.imerg': true, 'weather.wind': true,
    });
    cleanup();

    // A map without weather offers no Meteorología group.
    render(<OccMap defaultView="region"><MapDock><MapLayersMenu /></MapDock></OccMap>);
    act(() => fake.state.emit(fake.state.liveMaps().at(-1), 'style.load'));
    await user.click(layersButton());
    expect(screen.queryByRole('group', { name: 'Meteorología' })).not.toBeInTheDocument();
  });

  it('speaks English inside a translated scope', async () => {
    act(() => resetLanguageForTests('en'));
    render(
      <LanguageScope>
        <OccMap defaultView="region" traffic={noonTraffic()}><MapDock><MapLayersMenu /></MapDock></OccMap>
      </LanguageScope>,
    );
    const button = within(screen.getByTestId('map-layers-menu')).getByRole('button', { name: 'Layers' });
    await userEvent.click(button);
    const group = screen.getByRole('group', { name: 'Traffic' });
    expect(within(group).getAllByRole('checkbox').map(box => box.labels[0].textContent)).toEqual(['AVIAM flights',
      'Other traffic', 'Labels for all traffic', 'Trails for all traffic', 'Route of the selected flight']);
    expect(within(group).getByRole('checkbox', { name: 'AVIAM flights' })).toHaveAccessibleDescription('Always shown');
  });
});
