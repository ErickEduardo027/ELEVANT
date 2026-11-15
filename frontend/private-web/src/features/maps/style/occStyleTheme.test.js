import { describe, expect, it } from 'vitest';
import { OCC_PALETTES } from '../../occ-ui/occPalette';
import { standOverlay } from '../stands/standLayers';
import { flightOverlay } from '../traffic/flightLayers';
import { trafficOverlay } from '../traffic/trafficLayers';
import { airfieldOverlay } from './airfieldLayers';
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
});
