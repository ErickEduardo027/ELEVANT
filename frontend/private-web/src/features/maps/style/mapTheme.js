// The base-map colours of the OCC maps, one set per theme, both in neutral slate (owner decisions 16 and 18), built to
// sit with the OCC tokens without copying them. Dark (the default): the sea is darker than --occ-canvas, the land is
// close to it, the pavement lighter than the land. Light (ADR-0044, note of 2026-11-15): light grey-blue land close to
// --occ-canvas, a light blue sea, pavement darker than the land and dark labels.
//
// Only what the base map paints lives here: land, water, lines, pavement and its labels. Stand states, the selection
// and the signals are not base-map colours; every layer that draws them reads src/features/occ-ui/occPalette.js
// (occColor), and mapTheme.test.js checks that no token value is copied into this file.
const DARK = Object.freeze({
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

const LIGHT = Object.freeze({
  land: '#e4e9ec',
  sea: '#cbdbe3',
  coastline: '#afc0c9',
  boundary: '#86949b',
  road: '#d4dbdf',
  roadMajor: '#c8d1d6',
  building: '#d7dee2',
  buildingExtrusion: '#cad3d8',
  runway: '#b0bac0',
  taxiway: '#c0c9ce',
  apron: '#d1d9dd',
  placeLabel: '#3d4950',
  waterLabel: '#36505d',
  labelHalo: '#f5f8f9',
});

/** The base-map colours of each theme. */
export const BASEMAP_THEMES = Object.freeze({ dark: DARK, light: LIGHT });

/** The dark base map, the default, under its old name. */
export const BASEMAP_COLORS = DARK;

/** The base-map colours of `theme`; anything but 'light' is the dark default. */
export function basemapColorsFor(theme) {
  return theme === 'light' ? LIGHT : DARK;
}

const DARK_KEY_OF = new Map(Object.entries(DARK).map(([key, value]) => [value, key]));

/** A colour of the dark base map as `theme` paints it (the same key); any other value comes back as it is. */
export function basemapThemeColor(value, theme) {
  if (theme !== 'light' || typeof value !== 'string') return value;
  const key = DARK_KEY_OF.get(value.toLowerCase());
  return key === undefined ? value : LIGHT[key];
}

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
