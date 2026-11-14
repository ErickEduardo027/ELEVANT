import { occButtonClass } from './OccButton';
import { occControlClass } from './OccField';

/**
 * The class strings that the register routes (Cobertura, Datos maestros, Tablets, Contratos listos and Reportes) still
 * define on their own, drawn with the OCC tokens: the first, mechanical step of their migration (design E.2) replaces
 * their local constants with these, one line per route, before the restructure with the primitives.
 * - `card` is a panel slab with its joint and the 6 px panel radius; `muted` is secondary text.
 * - `button` is OccButton's default look, and `primary`, `secondary` and `danger` its variants (occButtonClass).
 * - `input` is a one-line control as wide as its place; `field` the control of a form field that sits under its
 *   label, also for a text of several lines (occControlClass).
 * They keep the display, the width and the gap under a label of the strings they replace, so swapping them reflows
 * nothing; heights, padding, radii and colours become the OCC's.
 */
export const OCC_CLASSES = Object.freeze({
  card: 'rounded-md border border-occ-line bg-occ-panel p-4 text-occ-text',
  muted: 'text-occ-muted',
  button: occButtonClass(),
  primary: occButtonClass({ variant: 'primary' }),
  secondary: occButtonClass({ variant: 'secondary' }),
  danger: occButtonClass({ variant: 'danger' }),
  field: `mt-1 block w-full ${occControlClass({ kind: 'textarea' })}`,
  input: `w-full ${occControlClass({ kind: 'input' })}`,
});
