import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import OccMap from '../core/OccMap';
import { createMapStands } from '../testing/mapFixtures';
import MapPresetSwitcher from './MapPresetSwitcher';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const STANDS = createMapStands();
const PAGE = '/admin-occ/positions-map?stationId=s-1&operationId=op-7';
const NAMES = ['Región', 'Aproximación', 'Aeródromo', 'Rampa'];

// The switcher where a screen puts it: in the dock of its map, at the bottom centre.
function renderSwitcher() {
  render(
    <OccMap stands={STANDS}>
      <div className="occ-map-dock">
        <MapPresetSwitcher />
      </div>
    </OccMap>,
  );
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  return map;
}

const group = () => screen.getByRole('group', { name: 'Vista del mapa' });
const pressed = () => within(group()).getAllByRole('button')
  .filter(button => button.getAttribute('aria-pressed') === 'true')
  .map(button => button.textContent);
const query = () => new URLSearchParams(window.location.search);
// Clicks a view and answers the zoom the map flew to: the fitted zoom of that view.
const fitOf = (map, name) => {
  fireEvent.click(within(group()).getByRole('button', { name }));
  return map.getZoom();
};

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  resetLanguageForTests('es');
  window.history.replaceState({}, '', '/');
});

describe('MapPresetSwitcher', () => {
  it('four 44 px buttons; aria-pressed follows the real zoom, not the last click', () => {
    const map = renderSwitcher();
    const buttons = within(group()).getAllByRole('button');
    // The four views of the key table with their key, on 44 px targets (min-h-11 and min-w-11 are 2.75 rem).
    expect(buttons.map(button => button.textContent)).toEqual(['1Región', '2Aproximación', '3Aeródromo', '4Rampa']);
    expect(buttons.map(button => button.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3', '4']);
    for (const [index, button] of buttons.entries()) {
      expect(button).toHaveAccessibleName(NAMES[index]);
      expect(button).toHaveClass('min-h-11', 'min-w-11');
      expect(button).toBeEnabled();
    }
    // The map opened on the ramp, its default view.
    expect(pressed()).toEqual(['4Rampa']);

    const region = fitOf(map, 'Región');
    const approach = fitOf(map, 'Aproximación');
    const airfield = fitOf(map, 'Aeródromo');
    expect(pressed()).toEqual(['3Aeródromo']);
    // A free zoom moves the pressed button with the camera, whatever was clicked last.
    act(() => map.jumpTo({ zoom: approach + 0.4 }));
    expect(pressed()).toEqual(['2Aproximación']);
    act(() => map.jumpTo({ zoom: (region + approach) / 2 - 0.01 }));
    expect(pressed()).toEqual(['1Región']);
    act(() => map.jumpTo({ zoom: airfield + 4 }));
    expect(pressed()).toEqual(['4Rampa']);
    expect(within(group()).getAllByRole('button', { pressed: true })).toHaveLength(1);
    // The URL still says the view that was asked for.
    expect(query().get('view')).toBe('airfield');
  });

  it('a click sets view= in the URL and flies to that preset', () => {
    const map = renderSwitcher();
    const ramp = map.getZoom();

    fireEvent.click(screen.getByRole('button', { name: 'Aeródromo' }));
    expect(query().get('view')).toBe('airfield');
    // Every other key of the page stays.
    expect([query().get('stationId'), query().get('operationId')]).toEqual(['s-1', 'op-7']);
    const airfield = map.getZoom();
    expect(airfield).toBeLessThan(ramp);
    // A short step eases, for an explicit time that reduced motion may turn into a jump.
    const ease = map.cameraCalls.at(-1);
    expect(ease).toMatchObject({ method: 'easeTo', options: { essential: false } });
    expect(ease.options.duration).toBe(Math.round(600 + 220 * (ramp - airfield)));

    // A long step flies.
    fireEvent.click(screen.getByRole('button', { name: 'Región' }));
    expect(query().get('view')).toBe('region');
    expect(map.cameraCalls.at(-1)).toMatchObject({ method: 'flyTo', options: { curve: 1.42, essential: false } });
    const region = map.getZoom();
    expect(region).toBeLessThan(airfield - 2.5);

    // After a free zoom the view in the URL flies again, and the URL stays as it is.
    act(() => map.jumpTo({ zoom: region + 1.2 }));
    const calls = map.cameraCalls.length;
    const before = window.location.search;
    fireEvent.click(screen.getByRole('button', { name: 'Región' }));
    expect(map.cameraCalls).toHaveLength(calls + 1);
    expect(map.getZoom()).toBeCloseTo(region, 9);
    expect(window.location.search).toBe(before);
  });

  it('speaks English in an English screen and waits while the map cannot draw', async () => {
    resetLanguageForTests('en');
    render(
      <LanguageScope>
        <OccMap stands={STANDS}>
          <MapPresetSwitcher />
        </OccMap>
      </LanguageScope>,
    );
    const english = screen.getByRole('group', { name: 'Map view' });
    expect(within(english).getAllByRole('button').map(button => button.textContent))
      .toEqual(['1Region', '2Approach', '3Airfield', '4Ramp']);
    cleanup();
    resetLanguageForTests('es');

    // Without a map no view can be shown, so the buttons are off.
    fake.state.reset({ constructorError: new GPUInitializationError() });
    render(<OccMap stands={STANDS}><MapPresetSwitcher /></OccMap>);
    expect(await screen.findByTestId('map-unavailable')).toBeInTheDocument();
    for (const button of within(group()).getAllByRole('button')) expect(button).toBeDisabled();
    cleanup();

    // Outside a map nothing is pressed and a click changes nothing.
    render(<MapPresetSwitcher />);
    expect(pressed()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Rampa' }));
    expect(query().has('view')).toBe(false);
  });
});
