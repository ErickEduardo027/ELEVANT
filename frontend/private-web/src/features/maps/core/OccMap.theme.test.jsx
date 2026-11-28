import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { OCC_PALETTES } from '../../occ-ui/occPalette';
import { ThemeProvider, useTheme } from '../../shell/useTheme';
import { BASEMAP_THEMES } from '../style/mapTheme';
import { occSky } from './mapSky';
import OccMap from './OccMap';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const PAGE = '/admin-occ/positions-map?stationId=s-1';

const backgroundOf = map => map.options.style.layers.find(layer => layer.id === 'base-background').paint['background-color'];
const selectionColourOf = map => JSON.stringify(map.options.style.layers.filter(layer => layer.id.startsWith('occ-selection'))
  .map(layer => layer.paint));

function ThemeButton() {
  const { toggleTheme } = useTheme();
  return <button type="button" onClick={toggleTheme}>tema</button>;
}

beforeEach(() => {
  fake.state.reset();
  window.localStorage.clear();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  window.history.replaceState({}, '', '/');
});

describe('OccMap and the theme', () => {
  it('is dark outside a ThemeProvider', () => {
    render(<OccMap />);
    expect(backgroundOf(fake.state.liveMaps().at(-1))).toBe(BASEMAP_THEMES.dark.land);
  });

  it('opens in the stored theme and is re-created, never restyled, on the camera it had when the theme changes', () => {
    window.localStorage.setItem('elevant-theme', 'light');
    render(<ThemeProvider><ThemeButton /><OccMap /></ThemeProvider>);
    const light = fake.state.liveMaps().at(-1);
    expect(backgroundOf(light)).toBe(BASEMAP_THEMES.light.land);
    expect(selectionColourOf(light)).toContain(OCC_PALETTES.light['--occ-accent']);
    expect(selectionColourOf(light)).not.toContain(OCC_PALETTES.dark['--occ-accent']);

    act(() => light.jumpTo({ center: [-68.37, 18.56], zoom: 15.25, bearing: 20 }));
    act(() => screen.getByRole('button', { name: 'tema' }).click());

    const live = fake.state.liveMaps();
    expect(live).toHaveLength(1);
    const dark = live[0];
    expect(dark).not.toBe(light);
    expect(light.removed).toBe(true);
    expect(backgroundOf(dark)).toBe(BASEMAP_THEMES.dark.land);
    expect(dark.getZoom()).toBeCloseTo(15.25, 6);
    expect(dark.getCenter().lng).toBeCloseTo(-68.37, 6);
    expect(dark.getBearing()).toBeCloseTo(20, 6);
    // Contracts 2.4: the style is handed over at creation and never swapped.
    for (const map of fake.state.maps) expect(map.styleCalls).toEqual([]);
  });

  it('shows the sky of its theme in the 3D views and none in 2D, without a setStyle (M4)', () => {
    window.localStorage.setItem('elevant-theme', 'light');
    const element = pitchMode => <ThemeProvider><OccMap pitchMode={pitchMode} /></ThemeProvider>;
    const view = render(element('3d'));
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    expect(map.getSky()).toEqual(occSky('light'));
    view.rerender(element('2d'));
    expect(map.getSky()).toBeUndefined();
    view.rerender(element('3d'));
    expect(map.getSky()).toEqual(occSky('light'));
    expect(map.calls.filter(call => call.method === 'setSky')).toHaveLength(3);
    expect(map.styleCalls).toEqual([]);
  });

  it('opens a 2D map without telling MapLibre about a sky (M4)', () => {
    render(<OccMap pitchMode="2d" />);
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    expect(map.calls.filter(call => call.method === 'setSky')).toEqual([]);
  });
});
