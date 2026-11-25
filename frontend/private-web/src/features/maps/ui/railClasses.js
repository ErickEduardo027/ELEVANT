// The classes the controls of a map's rail share (ui/MapDock.jsx and occ-map.css, CN-32), so every control of the column
// reads the same: as wide as the column, 32 px high (44 px on a touch screen, as every OCC control), the key of the key
// table before the word, flat on the panel slab with a 1 px joint. Pure strings, so a test can read what jsdom does not
// lay out.

/** The box of a rail control: as wide as the rail, one line, its key and its word from the left. */
export const RAIL_BUTTON = 'flex min-h-8 w-full min-w-0 items-center gap-1.5 px-2 text-left text-xs font-semibold '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-occ-accent '
  + 'disabled:cursor-not-allowed [@media(pointer:coarse)]:min-h-11';

/** A control of the rail standing on its own: its own slab, pressed with the cyan frame of a pressed view. */
export function railToolClass(pressed, className = '') {
  return `${RAIL_BUTTON} rounded border ${pressed
    ? 'border-occ-accent bg-occ-accent-soft text-occ-text'
    : 'border-occ-line bg-occ-panel text-occ-muted hover:bg-occ-panel-raised hover:text-occ-text'} ${className}`.trim();
}

/** The key of the key table before a control's word (it stays in the control's `aria-keyshortcuts`). */
export const RAIL_KEY = 'occ-map-key w-2.5 shrink-0 text-center font-mono text-xs font-medium text-occ-faint';

/** A group of icon tools sharing one slab in a row of the rail, such as «Restablecer vista» and «Centrar PUJ». */
export const RAIL_TOOL_ROW = 'flex divide-x divide-occ-line rounded border border-occ-line bg-occ-panel';

/** An icon tool of a RAIL_TOOL_ROW: an equal share of the row, 32 px high (44 px on a touch screen). */
export const RAIL_ICON_TOOL = 'flex min-h-8 min-w-0 flex-1 items-center justify-center text-occ-text '
  + 'hover:bg-occ-panel-raised first:rounded-l-[3px] last:rounded-r-[3px] focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:-outline-offset-2 focus-visible:outline-occ-accent [@media(pointer:coarse)]:min-h-11';

/** A menu that flies out of the rail to its left («Capas», «Leyenda»): the floating panel slab, placed by occ-map.css. */
export const RAIL_FLYOUT = 'occ-map-flyout rounded-md border border-occ-line bg-occ-panel-float p-3 text-sm text-occ-text';
