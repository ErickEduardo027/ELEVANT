import { describe, expect, it } from 'vitest';
import { OCC_PALETTES } from '../../occ-ui/occPalette';
import { standOverlay } from '../stands/standLayers';
import { flightOverlay } from '../traffic/flightLayers';
import { trafficOverlay } from '../traffic/trafficLayers';
import { airfieldOverlay } from './airfieldLayers';
import { MAP_COLORS } from './mapColors';
import { BASEMAP_THEMES } from './mapTheme';
import { buildOccStyle } from './occStyle';
import { referenceOverlay } from './referenceLayers';
import { selectionOverlay } from './selectionLayers';

// Every colour string of a style, rgba() trails turned into #rrggbb.
function coloursOf(style) {
  const found = [];
  const walk = value => {
    if (typeof value === 'string') {
      const rgba = /^rgba\((\d+), (\d+), (\d+), [\d.]+\)$/.exec(value);
      if (rgba) found.push(`#${rgba.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}`);
      else if (/^#[0-9a-f]{6}$/i.test(value) || /^rgb\(/.test(value)) found.push(value.toLowerCase());
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const layer of style.layers) {
    walk(layer.paint ?? {});
    walk(layer.layout ?? {});
  }
  return found;
}

describe('OCC map style in the light theme', () => {
  it('the overlays of OccMap paint no colour of the dark theme that the light one does not have', () => {
    const overlays = [selectionOverlay(), airfieldOverlay(), referenceOverlay(), standOverlay(), flightOverlay(),
      trafficOverlay()];
    const light = new Set([...Object.values(OCC_PALETTES.light), ...Object.values(BASEMAP_THEMES.light)]);
    const darkOnly = new Set([...Object.values(OCC_PALETTES.dark), ...Object.values(BASEMAP_THEMES.dark)]
      .filter(value => !light.has(value)));

    const dark = coloursOf(buildOccStyle({ overlays, theme: 'dark' }));
    expect(dark.some(colour => darkOnly.has(colour))).toBe(true);
    const leftovers = coloursOf(buildOccStyle({ overlays, theme: 'light' })).filter(colour => darkOnly.has(colour));
    expect([...new Set(leftovers)]).toEqual([]);
  });

  it('the overlays given the light theme paint the light map colours, which the theme pass leaves as they are', () => {
    const overlaysOf = theme => [selectionOverlay(), referenceOverlay({ theme }), standOverlay({ theme }),
      trafficOverlay({ theme })];
    const lightColours = new Set(coloursOf({ layers: overlaysOf('light').flatMap(overlay => overlay.layers) }));
    const style = coloursOf(buildOccStyle({ overlays: overlaysOf('light'), theme: 'light' }));
    const { altitude, airports, stands } = MAP_COLORS.light;
    const expected = [...altitude.stops.map(([, colour]) => colour), altitude.ground, altitude.unknown, altitude.halo,
      airports.home, airports.international, airports.regional, airports.label, airports.halo,
      ...Object.values(stands).map(fill => fill.color)];
    for (const colour of expected) {
      expect(lightColours.has(colour), colour).toBe(true);
      expect(style.includes(colour), colour).toBe(true);
    }
    // No colour of the dark map palette is left in the light style.
    const darkOnly = [MAP_COLORS.dark.altitude.stops.map(([, colour]) => colour), MAP_COLORS.dark.altitude.ground,
      MAP_COLORS.dark.airports.label, ...Object.values(MAP_COLORS.dark.stands).map(fill => fill.color)].flat();
    expect(style.filter(colour => darkOnly.includes(colour))).toEqual([]);
  });
});
