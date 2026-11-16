// The OCC colours for JavaScript consumers that cannot read a CSS variable:
// MapLibre paint properties, canvas icons and SVG drawn in code. The values are
// the literal colours of the two token blocks of src/styles/occ.css (dark, the
// default, and light: ADR-0044, note of 2026-11-15), and occPalette.test.js
// fails when the files differ. Aliases such as `--occ-ok` and the radius tokens
// are not colours of their own and stay out. A see-through colour carries its
// alpha as `rgb(r g b / a)`, which MapLibre, a canvas and CSS all read, so no
// consumer dims a colour on its own.
const DARK = Object.freeze({
  '--occ-nav': '#0f161a',
  '--occ-canvas': '#161e22',
  '--occ-panel': '#20282d',
  '--occ-panel-raised': '#2a3439',
  '--occ-panel-float': 'rgb(32 40 45 / 0.94)',
  '--occ-field': '#161e22',
  '--occ-arriving-fill': 'rgb(42 52 57 / 0.4)',
  '--occ-line': '#394348',
  '--occ-line-strong': '#768289',
  '--occ-text': '#e8eef1',
  '--occ-muted': '#bcc8ce',
  '--occ-faint': '#95a2a9',
  '--occ-accent': '#6fd4f5',
  '--occ-accent-soft': '#2d444d',
  '--occ-on-accent': '#0f161a',
  '--occ-primary': '#e8eef1',
  '--occ-primary-hover': '#ffffff',
  '--occ-on-primary': '#0f161a',
  '--occ-warn': '#fdc14f',
  '--occ-warn-fill': '#fdc14f',
  '--occ-warn-soft': '#434032',
  '--occ-on-warn': '#0f161a',
  '--occ-danger': '#f5746d',
  '--occ-danger-fill': '#f5746d',
  '--occ-danger-soft': '#423437',
  '--occ-on-danger': '#0f161a',
  '--occ-scrim': 'rgb(15 22 26 / 0.72)',
  '--occ-nav-line': '#252c30',
  '--occ-nav-text': '#c9d3d8',
  '--occ-nav-muted': '#95a2a9',
  '--occ-nav-hover': '#1a2227',
  '--occ-nav-active': '#252c30',
  '--occ-nav-accent': '#6fd4f5',
});

const LIGHT = Object.freeze({
  '--occ-nav': '#e3e9ec',
  '--occ-canvas': '#e9eef1',
  '--occ-panel': '#ffffff',
  '--occ-panel-raised': '#e4eaed',
  '--occ-panel-float': 'rgb(255 255 255 / 0.94)',
  '--occ-field': '#f4f7f8',
  '--occ-arriving-fill': 'rgb(196 207 213 / 0.4)',
  '--occ-line': '#c9d3d8',
  '--occ-line-strong': '#6f7b82',
  '--occ-text': '#11181c',
  '--occ-muted': '#3b474e',
  '--occ-faint': '#56636a',
  '--occ-accent': '#054e66',
  '--occ-accent-soft': '#d4ebf3',
  '--occ-on-accent': '#ffffff',
  '--occ-primary': '#1b2328',
  '--occ-primary-hover': '#323d43',
  '--occ-on-primary': '#ffffff',
  '--occ-warn': '#634000',
  '--occ-warn-fill': '#f2b340',
  '--occ-warn-soft': '#f8ecd0',
  '--occ-on-warn': '#11181c',
  '--occ-danger': '#b0241a',
  '--occ-danger-fill': '#c62f24',
  '--occ-danger-soft': '#f9e1df',
  '--occ-on-danger': '#ffffff',
  '--occ-scrim': 'rgb(17 24 28 / 0.45)',
  '--occ-nav-line': '#cdd7dc',
  '--occ-nav-text': '#1f2a30',
  '--occ-nav-muted': '#4c5960',
  '--occ-nav-hover': '#d8e0e4',
  '--occ-nav-active': '#cdd7dc',
  '--occ-nav-accent': '#075d76',
});

/** The palette of each OCC theme. */
export const OCC_PALETTES = Object.freeze({ dark: DARK, light: LIGHT });

/** The OCC themes; dark is the default. */
export const OCC_THEMES = Object.freeze(['dark', 'light']);
export const OCC_DEFAULT_THEME = 'dark';

/** The dark palette, the default one, kept under its old name for the consumers that read it. */
export const OCC_PALETTE = DARK;

/** The palette of `theme`; anything but 'light' is the dark default. */
export function occPaletteFor(theme) {
  return theme === 'light' ? LIGHT : DARK;
}

const TOKEN_PREFIX = '--occ-';

/**
 * The value of an OCC colour token in `theme` (dark by default). Accepts the short name (`'accent'`) or the full one
 * (`'--occ-accent'`). An unknown name throws, so a typo never paints a stand or an icon with `undefined`.
 */
export function occColor(token, theme = OCC_DEFAULT_THEME) {
  const name = typeof token === 'string' && token.startsWith(TOKEN_PREFIX) ? token : `${TOKEN_PREFIX}${token}`;
  if (!Object.hasOwn(DARK, name)) throw new RangeError(`Unknown OCC colour token: ${String(token)}`);
  return occPaletteFor(theme)[name];
}

// Several dark tokens share a value (`--occ-nav` and the four `--occ-on-*` inks, `--occ-text` and `--occ-primary`,
// a signal and its fill). A colour read in code is matched back to the token a map, an icon or a legend means by it:
// the first token of the palette with that value, except for the two signals, which a map paints as fills.
const PREFERRED = Object.freeze({ '#fdc14f': '--occ-warn-fill', '#f5746d': '--occ-danger-fill' });
const DARK_TOKEN_OF = new Map();
for (const [name, value] of Object.entries(DARK)) {
  if (!DARK_TOKEN_OF.has(value)) DARK_TOKEN_OF.set(value, PREFERRED[value] ?? name);
}

/** The token whose dark value is `value` (a colour taken from the dark palette), or null. */
export function occTokenOfDarkValue(value) {
  return typeof value === 'string' ? DARK_TOKEN_OF.get(value.toLowerCase()) ?? null : null;
}

/**
 * A colour taken from the dark palette, as `theme` paints it: the same token's value in that theme. Any other value
 * comes back as it is. This is how the code that builds map layers and icons from the dark palette follows the theme.
 */
export function occThemeColor(value, theme = OCC_DEFAULT_THEME) {
  if (theme !== 'light') return value;
  const token = occTokenOfDarkValue(value);
  return token === null ? value : LIGHT[token];
}
