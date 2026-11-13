// The base-map colours of the OCC maps: one dark palette in neutral slate (owner decisions 16 and 18), built to sit
// with the OCC tokens without copying them. The sea is darker than --occ-canvas, the land is close to it, and the hue
// stays on the slate of the tokens, far from navy blue.
//
// Only what the base map paints lives here: land, water, lines, pavement and its labels. Stand states, the selection
// and the signals are not base-map colours; every layer that draws them reads src/features/occ-ui/occPalette.js
// (occColor), and mapTheme.test.js checks that no token value is copied into this file.
export const BASEMAP_COLORS = Object.freeze({
  land: '#1a2125',
  sea: '#0e1417',
  coastline: '#2c3539',
  boundary: '#4b565c',
  road: '#263034',
  roadMajor: '#2f3a3f',
  building: '#202a2e',
  buildingExtrusion: '#273236',
  runway: '#3b464b',
  taxiway: '#2d373c',
  apron: '#1f272b',
  placeLabel: '#9aa6ac',
  waterLabel: '#7d8b92',
  labelHalo: '#101619',
});

const HEX_COLOUR = /^#([0-9a-f]{6})$/i;

function channels(hex) {
  const match = HEX_COLOUR.exec(hex);
  if (match === null) throw new TypeError(`Expected an opaque #rrggbb colour, got ${String(hex)}`);
  return [0, 2, 4].map(start => Number.parseInt(match[1].slice(start, start + 2), 16) / 255);
}

/** WCAG 2 relative luminance of an opaque `#rrggbb` colour. */
export function relativeLuminance(hex) {
  const [red, green, blue] = channels(hex)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2 contrast ratio between two opaque `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
