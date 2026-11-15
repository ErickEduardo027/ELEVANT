// The base-map colours of the OCC maps (owner request of 2026-11-15, «más color»): the dark palette of
// style/mapColors.js, a deep navy sea under a lighter blue-grey land, with borders, names and pavement that read.
// Only what the base map paints lives there: land, water, lines, pavement and its labels. Stand states, the selection
// and the signals are not base-map colours; every layer that draws them reads src/features/occ-ui/occPalette.js
// (occColor), and mapColors.test.js checks that no token value is copied.
import { MAP_COLORS } from './mapColors';

export const BASEMAP_COLORS = MAP_COLORS.dark.basemap;

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
