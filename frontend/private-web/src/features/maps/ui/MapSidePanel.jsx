'use client';

import { useId } from 'react';

// The side panel of an OCC map screen (CN-32, «Monitoreo OCC más profesional»; M1, «pantalla completa con paneles
// flotantes»): the detail of what is chosen on the map. One chrome for every detail of the maps: the flight of
// Monitoreo de vuelos (flight-monitoring/components/FlightInspector.jsx), the stand of Mapa de posiciones
// (positions-map/components/PositionDetailDrawer.jsx) and the flight panel of follow mode.
//
// It is a landmark (`aside` by default), not a dialog: no veil and no focus trap, so the map keeps its keys. It never
// places itself: the screen docks it in a column of its own beside the map (`framed`, the rounded panel slab of the
// work screens), flush against the map's edge (`flush`, the joint on the side that meets the map, as the console's
// panes) or floats it over its full-screen map (`floating`, M1: the near-opaque floating slab with a 1 px joint and the
// 8 px overlay radius, flat, as the floating panels of occ-ui; the screen measures it into the map's insets, so the
// camera keeps what is chosen clear of it). Its parts, top to bottom:
// - the header: `title` (the heading, at `headingLevel`), `subtitle` and `status` lines under it, the screen's
//   `actions` and «Cerrar» (`onClose`, named `closeLabel`) at its right;
// - the body, which scrolls on its own (`bodyClassName`), with the screen's sections (MapSidePanelSection);
// - the `footer`, always in sight under the body: the panel's links and commands.

/**
 * How the panel meets the screen, its slab included, as pure classes so a test can read what jsdom does not apply. The
 * floating slab takes the overlay radius from its token (the legacy bridge turns `rounded-lg` into the 4 px control
 * radius inside the OCC); no shadow and no blur, so it reads the same over any part of the map and costs nothing over
 * WebGL.
 */
export const MAP_SIDE_PANEL_LAYOUT = Object.freeze({
  framed: 'rounded-md border border-occ-line bg-occ-panel',
  flush: 'border-l border-occ-line bg-occ-panel',
  floating: 'rounded-[var(--occ-radius-overlay)] border border-occ-line bg-occ-panel-float',
});

const CLOSE = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-occ-muted hover:bg-occ-panel-raised '
  + 'hover:text-occ-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-occ-accent '
  + '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';
const HEADING_LEVELS = Object.freeze([2, 3]);

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4">
      <path d="M4 4 L12 12 M12 4 L4 12" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }} />
    </svg>
  );
}

/**
 * The side panel. `label` names the landmark (required); `title`, `subtitle` and `status` make its header; `onClose`
 * adds «Cerrar» with `closeLabel`; `actions` go in the header and `footer` under the body. `as` is `aside` (default) or
 * `section`; `variant` is `framed` (default), `flush` or `floating` (MAP_SIDE_PANEL_LAYOUT). Other props (`data-*`, a
 * `ref` to measure it) go on the root. An unknown variant or heading level throws.
 */
export default function MapSidePanel({
  label, title, subtitle, status, actions, onClose, closeLabel, footer, as = 'aside', variant = 'framed',
  headingLevel = 2, className = '', bodyClassName = '', children, ...rest
}) {
  const titleId = useId();
  if (typeof label !== 'string' || label.trim() === '') throw new TypeError('A map side panel needs a label');
  if (!Object.hasOwn(MAP_SIDE_PANEL_LAYOUT, variant)) throw new RangeError(`Unknown map side panel variant: ${String(variant)}`);
  if (!HEADING_LEVELS.includes(headingLevel)) throw new RangeError(`Unknown map side panel heading level: ${String(headingLevel)}`);
  const Root = as === 'section' ? 'section' : 'aside';
  const Heading = `h${headingLevel}`;
  const closable = typeof onClose === 'function';

  return (
    <Root aria-label={label} data-map-side-panel={variant} {...rest}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden text-occ-text ${MAP_SIDE_PANEL_LAYOUT[variant]} ${className}`}>
      <header className="flex shrink-0 items-start gap-2 border-b border-occ-line py-2 pl-3 pr-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Heading id={titleId} className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-semibold">{title}</Heading>
          {subtitle ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">{subtitle}</div> : null}
          {status ? <div className="flex min-w-0 items-center gap-1.5 text-sm text-occ-text">{status}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        {closable ? (
          <button type="button" onClick={() => onClose()} aria-label={closeLabel} title={closeLabel} className={CLOSE}>
            <CloseIcon />
          </button>
        ) : null}
      </header>
      <div data-map-side-panel-body=""
        className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin] ${bodyClassName}`}>
        {children}
      </div>
      {footer ? (
        <div data-map-side-panel-footer="" className="flex shrink-0 flex-wrap gap-2 border-t border-occ-line px-3 py-2">
          {footer}
        </div>
      ) : null}
    </Root>
  );
}

/**
 * A section of a side panel: its `title` as a small heading in sentence case (never spaced capitals) over what it
 * holds, with `meta` (a chip, a count) at the right of the heading and outside it, so the heading keeps its name.
 * `headingLevel` is one below the panel's (3 by default).
 */
export function MapSidePanelSection({ title, meta, headingLevel = 3, className = '', children, ...rest }) {
  const titleId = useId();
  const Heading = `h${headingLevel === 4 ? 4 : 3}`;
  return (
    <section aria-labelledby={title ? titleId : undefined} className={`space-y-2 ${className}`} {...rest}>
      {title ? (
        <div className="flex min-h-5 items-center justify-between gap-2">
          <Heading id={titleId} className="text-xs font-semibold text-occ-muted">{title}</Heading>
          {meta ?? null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
