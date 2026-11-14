// The classes the console's panels share, so a control reads the same in every panel. Flat slabs and plain controls on
// the OCC tokens (contratos 2.4): no shadow, no blur, no opacity modifier on an occ colour.

/** A plain control: 44 px wide at least, 44 px high on a touch screen. */
export const CONSOLE_ACTION = 'inline-flex h-8 min-w-11 shrink-0 items-center justify-center rounded border '
  + 'border-occ-line-strong px-2.5 text-sm font-semibold text-occ-text hover:bg-occ-panel-raised '
  + '[@media(pointer:coarse)]:h-11';

/** The primary action of a panel: the light «key» of the OCC (contratos 2.4). */
export const CONSOLE_PRIMARY_ACTION = 'inline-flex h-8 min-w-11 shrink-0 items-center justify-center rounded '
  + 'bg-occ-primary px-3 text-sm font-semibold text-occ-on-primary hover:bg-occ-primary-hover '
  + '[@media(pointer:coarse)]:h-11';

/** The title of a section inside a panel. */
export const CONSOLE_SECTION_TITLE = 'px-2 pb-1 pt-3 text-xs font-semibold text-occ-muted';

/** A scrolling body of a panel, with a thin scroll bar. */
export const CONSOLE_SCROLL = 'overflow-y-auto overscroll-contain [scrollbar-width:thin]';
