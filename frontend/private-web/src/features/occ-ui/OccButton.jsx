/** The four kinds of button of the OCC (design F) and their two sizes. */
export const OCC_BUTTON_VARIANTS = Object.freeze(['primary', 'secondary', 'ghost', 'danger']);
export const OCC_BUTTON_SIZES = Object.freeze(['md', 'sm']);

// A control on the 4 px radius: 32 px high with a mouse and 44 px high and wide on a touch screen (design H.2).
const BASE = 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded font-semibold '
  + '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11';
const SIZE = Object.freeze({ md: 'h-8 px-3 text-sm', sm: 'h-7 px-2 text-xs' });

// How each kind looks at rest and under the pointer (contratos 2.4).
// - primary: the light key, with its own ink. There is one per view.
// - secondary: a strong joint and plain text, the default.
// - ghost: cyan text only, for an action inside a line of text or a row.
// - danger: red joint and red text; under the pointer the red slab takes plain text, because red text on it reads
//   below 4.5:1.
const LOOK = Object.freeze({
  primary: Object.freeze({ rest: 'bg-occ-primary text-occ-on-primary', hover: 'hover:bg-occ-primary-hover' }),
  secondary: Object.freeze({ rest: 'border border-occ-line-strong text-occ-text', hover: 'hover:bg-occ-panel-raised' }),
  ghost: Object.freeze({ rest: 'text-occ-accent', hover: 'hover:bg-occ-accent-soft' }),
  danger: Object.freeze({
    rest: 'border border-occ-danger text-occ-danger', hover: 'hover:bg-occ-danger-soft hover:text-occ-text',
  }),
});
// A control that cannot act now: the faint text of the palette on a quiet joint, with no hover.
const DISABLED_LOOK = Object.freeze({
  primary: 'cursor-not-allowed bg-occ-panel-raised text-occ-faint',
  secondary: 'cursor-not-allowed border border-occ-line text-occ-faint',
  ghost: 'cursor-not-allowed text-occ-faint',
  danger: 'cursor-not-allowed border border-occ-line text-occ-faint',
});

function check(variant, size) {
  if (!OCC_BUTTON_VARIANTS.includes(variant)) throw new RangeError(`Unknown OCC button variant: ${String(variant)}`);
  if (!OCC_BUTTON_SIZES.includes(size)) throw new RangeError(`Unknown OCC button size: ${String(size)}`);
}

/**
 * The classes of an OCC button at rest, for anything that has to look like one: a `Link` to another screen, or a
 * class string of a register route (classes.js). An unknown variant or size throws.
 */
export function occButtonClass({ variant = 'secondary', size = 'md' } = {}) {
  check(variant, size);
  return `${BASE} ${SIZE[size]} ${LOOK[variant].rest} ${LOOK[variant].hover}`;
}

/**
 * A button of the OCC (design F): `variant` `primary` (the light key), `secondary` (default), `ghost` or `danger`;
 * `size` `md` or `sm`; `type` is `button` unless the caller says `submit`.
 * - `disabled` draws the faint look without hover.
 * - `busy` is a command on its way: the button is disabled and `aria-busy`, keeps its look without hover, and shows
 *   `busyLabel` («Confirmando…») in place of its children when one is given. Nothing spins.
 * Every other prop (`onClick`, `aria-*`, `data-*`, `form`) reaches the `button`; `className` goes last.
 */
export default function OccButton({
  variant = 'secondary', size = 'md', busy = false, busyLabel, type = 'button', disabled = false, className = '',
  children, ...rest
}) {
  check(variant, size);
  let look = `${LOOK[variant].rest} ${LOOK[variant].hover}`;
  if (busy) look = `${LOOK[variant].rest} cursor-wait`;
  else if (disabled) look = DISABLED_LOOK[variant];
  return (
    <button type={type} {...rest} disabled={disabled || busy} aria-busy={busy || undefined}
      className={`${BASE} ${SIZE[size]} ${look} ${className}`}>
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
