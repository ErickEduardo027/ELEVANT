'use client';

import { useId, useSyncExternalStore } from 'react';
import { ChevronDownIcon } from '../shell/components/icons';
import { readPanelFolded, subscribePanelFolds, writePanelFolded } from './occPanelMemory';

/**
 * How a floating panel is drawn (contratos 2.4 and 2.5), as pure classes so a test can read what jsdom does not apply.
 * - `float`: over the full-screen map, on the near-opaque `--occ-panel-float` slab with a 1 px joint and the 8 px
 *   overlay radius (from its token: the legacy bridge turns `rounded-lg` into the 4 px control radius inside the OCC).
 *   Flat: no shadow and no blur, so it reads the same over any part of the map and costs nothing over WebGL.
 * - `grid`: the plain grid the console falls back to when the map engine is unavailable, on the panel slab with the
 *   6 px panel radius.
 */
export const OCC_FLOATING_PANEL_LAYOUT = Object.freeze({
  float: 'border border-occ-line bg-occ-panel-float rounded-[var(--occ-radius-overlay)] text-occ-text',
  grid: 'border border-occ-line bg-occ-panel rounded-md',
});

const HEADING_LEVELS = Object.freeze([2, 3, 4]);

// The fold control: the panel's title as a plain control, 44 px wide at least and 44 px high on a touch screen.
const FOLD = 'inline-flex h-8 min-w-11 max-w-full items-center gap-1.5 rounded px-2 text-left text-sm font-semibold '
  + 'text-occ-text hover:bg-occ-panel-raised [@media(pointer:coarse)]:h-11';

// Only the server render and the first client render use this: nothing is remembered there yet.
const NOTHING_REMEMBERED = () => null;

/**
 * A panel of the console that floats over the full-screen map and folds to a pill (contratos 2.5).
 * - A `section` named by its title: the title is the one button of the header, inside its heading (`headingLevel`,
 *   `h2` by default). The button says with `aria-expanded` whether the panel is open and points at the body with
 *   `aria-controls`; its name is the title alone.
 * - Folded, only the header stays: the pill. The body stays mounted, `hidden`, so what it holds keeps its state and the
 *   console's ResizeObserver measures the pill. `foldedSummary` (the counts of «Posiciones») shows only while folded,
 *   next to the button, which it describes (`aria-describedby`); `meta` shows in both states; `actions` only open.
 * - Each panel remembers its fold for the tab session (occPanelMemory.js, keyed by `panelId`) and starts from
 *   `defaultFolded` when nothing is remembered, on the server too. With `folded` it is controlled: the console owns the
 *   fold and hears every press through `onFoldedChange(next)`.
 * - It answers no key of its own: no shortcut, no Esc, no key handler. It is never a dialog, so the map's keys keep
 *   working while it is open (occShortcuts.js), and every key typed in it reaches the map container untouched.
 * - `layout`: `float` over the map, `grid` in the fallback grid (OCC_FLOATING_PANEL_LAYOUT). It never places itself:
 *   the console positions it with `className` and measures it through `ref`. The root carries
 *   `data-occ-floating-panel` (the `panelId`), `data-folded` and `data-layout`; `bodyClassName` lays out the body.
 * A missing `panelId`, or an unknown layout or heading level, throws.
 */
export default function OccFloatingPanel({
  ref, panelId, title, meta, actions, foldedSummary, defaultFolded = false, folded: foldedProp, onFoldedChange,
  layout = 'float', headingLevel = 2, className = '', bodyClassName = '', children, 'data-testid': testId,
}) {
  const titleId = useId();
  const bodyId = useId();
  const summaryId = useId();
  const remembered = useSyncExternalStore(subscribePanelFolds, () => readPanelFolded(panelId), NOTHING_REMEMBERED);
  if (typeof panelId !== 'string' || panelId.length === 0) throw new TypeError('An OCC floating panel needs a panelId');
  if (!Object.hasOwn(OCC_FLOATING_PANEL_LAYOUT, layout)) throw new RangeError(`Unknown OCC floating panel layout: ${String(layout)}`);
  if (!HEADING_LEVELS.includes(headingLevel)) throw new RangeError(`Unknown OCC panel heading level: ${String(headingLevel)}`);

  const controlled = foldedProp !== undefined;
  const folded = controlled ? Boolean(foldedProp) : (remembered ?? Boolean(defaultFolded));
  const summarised = folded && foldedSummary !== undefined && foldedSummary !== null && foldedSummary !== '';
  const Heading = `h${headingLevel}`;

  function toggle() {
    const next = !folded;
    if (!controlled) writePanelFolded(panelId, next);
    onFoldedChange?.(next);
  }

  return (
    <section ref={ref} aria-labelledby={titleId} data-occ-floating-panel={panelId} data-folded={folded ? 'true' : 'false'}
      data-layout={layout} data-testid={testId}
      className={`flex min-w-0 flex-col ${OCC_FLOATING_PANEL_LAYOUT[layout]} ${className}`}>
      <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1.5 py-1 ${folded ? '' : 'border-b border-occ-line'}`}>
        <Heading id={titleId} className="min-w-0">
          <button type="button" aria-expanded={!folded} aria-controls={bodyId}
            aria-describedby={summarised ? summaryId : undefined} onClick={toggle} className={FOLD}>
            <span className="min-w-0 truncate">{title}</span>
            <ChevronDownIcon className={`h-4 w-4 shrink-0 text-occ-muted ${folded ? '' : 'rotate-180'}`} />
          </button>
        </Heading>
        {summarised ? <div id={summaryId} className="min-w-0 text-xs text-occ-muted">{foldedSummary}</div> : null}
        {meta ? <div className="min-w-0 text-xs text-occ-muted">{meta}</div> : null}
        {!folded && actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
      </div>
      {/* No display class here: one would override `hidden`. The body's own layout goes on the element inside. */}
      <div id={bodyId} hidden={folded} data-occ-panel-body="" className="min-h-0 flex-1">
        <div className={bodyClassName}>{children}</div>
      </div>
    </section>
  );
}
