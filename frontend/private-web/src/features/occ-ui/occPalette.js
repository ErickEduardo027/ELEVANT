// The OCC colours for JavaScript consumers that cannot read a CSS variable:
// MapLibre paint properties, canvas icons and SVG drawn in code. The values are
// the literal colours of the token block in src/styles/occ.css (dark only), and
// occPalette.test.js fails when the two files differ. Aliases such as
// `--occ-ok` and the radius tokens are not colours of their own and stay out.
export const OCC_PALETTE = Object.freeze({
  '--occ-nav': '#0f161a',
  '--occ-canvas': '#161e22',
  '--occ-panel': '#20282d',
  '--occ-panel-raised': '#2a3439',
  '--occ-panel-float': 'rgb(32 40 45 / 0.94)',
  '--occ-field': '#161e22',
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

const TOKEN_PREFIX = '--occ-';

/**
 * The value of an OCC colour token. Accepts the short name (`'accent'`) or the full one (`'--occ-accent'`).
 * An unknown name throws, so a typo never paints a stand or an icon with `undefined`.
 */
export function occColor(token) {
  const name = typeof token === 'string' && token.startsWith(TOKEN_PREFIX) ? token : `${TOKEN_PREFIX}${token}`;
  if (!Object.hasOwn(OCC_PALETTE, name)) throw new RangeError(`Unknown OCC colour token: ${String(token)}`);
  return OCC_PALETTE[name];
}
