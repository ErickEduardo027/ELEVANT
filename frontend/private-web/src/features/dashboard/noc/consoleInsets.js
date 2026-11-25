// The part of the console's map that its floating panels cover (contratos 2.5): the open panels and the folded pills
// become OccMap's `insets`, so the views are framed, the controls are placed and the selected aircraft or stand is
// brought into the area the panels leave in sight. Pure: useConsoleInsets.js measures the panels and calls it.

/** The edges a panel of the console takes room from. */
export const CONSOLE_PANEL_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);

/**
 * The edge of a panel that docks in a column at either side of the map (CN-32): the side of the map its box is on, the
 * left or the right, by where its middle falls. The inspector docks at the left under 1536 px and at the right above.
 */
export const CONSOLE_SIDE_EDGE = 'side';

/** The room left between a panel and what the map shows beside it, in pixels. */
export const CONSOLE_INSET_GAP_PX = 8;

/**
 * The least of the map that the insets leave in sight, in pixels, across and down: panels that would cover more give
 * back room in proportion, so the map always has an area to frame its views in.
 */
export const MIN_VISIBLE_MAP_PX = Object.freeze({ width: 240, height: 160 });

/**
 * Where each panel of the console sits: the edge of the map it takes room from. The panels of the columns take it from
 * the side they are docked at (CONSOLE_SIDE_EDGE).
 */
export const CONSOLE_PANEL_EDGES = Object.freeze({
  board: CONSOLE_SIDE_EDGE,
  figures: 'top',
  alerts: CONSOLE_SIDE_EDGE,
  inspector: CONSOLE_SIDE_EDGE,
  positions: 'bottom',
});

const ZERO = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const isRect = rect => rect != null && ['top', 'right', 'bottom', 'left'].every(key => finite(rect[key]))
  && rect.right >= rect.left && rect.bottom >= rect.top;

// Two opposite insets that leave less than `minimum` of `size` give back room in proportion to what each takes.
function fit(first, second, size, minimum) {
  const room = Math.max(0, size - minimum);
  const taken = first + second;
  if (taken <= room) return [first, second];
  const scale = taken === 0 ? 0 : room / taken;
  return [Math.floor(first * scale), Math.floor(second * scale)];
}

/**
 * The insets `{ top, right, bottom, left }` in whole pixels of the map whose box is `rootRect` (a DOMRect-like
 * `{ top, right, bottom, left }`), from its panels `[{ side, rect, folded }]`:
 * - an open panel takes its width from the left or right edge, or its height from the top or bottom edge, as far as it
 *   reaches into the map, plus `gapPx`; a panel of a column (`side`) takes it from the side its middle is on;
 * - a folded panel is a pill: it takes room only from the top or the bottom edge, the one it is nearer to (the pills of
 *   the top and of the columns' heads, or of «Posiciones» and of a column's foot), never from the left or the right;
 * - a panel without size (hidden), outside the map or with an unknown side takes nothing.
 * Opposite insets that would leave less than MIN_VISIBLE_MAP_PX of the map give back room in proportion. Without a
 * valid map box every inset is 0.
 */
export function insetsFromPanels(rootRect, panels = [], gapPx = CONSOLE_INSET_GAP_PX) {
  if (!isRect(rootRect)) return ZERO;
  const width = rootRect.right - rootRect.left;
  const height = rootRect.bottom - rootRect.top;
  if (width <= 0 || height <= 0) return ZERO;
  const gap = finite(gapPx) && gapPx > 0 ? gapPx : 0;
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };

  for (const panel of Array.isArray(panels) ? panels : []) {
    const rect = panel?.rect;
    if (!(CONSOLE_PANEL_SIDES.includes(panel?.side) || panel?.side === CONSOLE_SIDE_EDGE) || !isRect(rect)) continue;
    if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) continue;
    // A panel the map does not hold in its box covers nothing of it.
    if (rect.right <= rootRect.left || rect.left >= rootRect.right || rect.bottom <= rootRect.top
      || rect.top >= rootRect.bottom) continue;
    let side = panel.side;
    if (side === CONSOLE_SIDE_EDGE) {
      side = (rect.left + rect.right) / 2 < (rootRect.left + rootRect.right) / 2 ? 'left' : 'right';
    }
    if (panel.folded === true) {
      side = (rect.top + rect.bottom) / 2 < (rootRect.top + rootRect.bottom) / 2 ? 'top' : 'bottom';
    }
    if (side === 'top') insets.top = Math.max(insets.top, rect.bottom - rootRect.top + gap);
    else if (side === 'bottom') insets.bottom = Math.max(insets.bottom, rootRect.bottom - rect.top + gap);
    else if (side === 'left') insets.left = Math.max(insets.left, rect.right - rootRect.left + gap);
    else insets.right = Math.max(insets.right, rootRect.right - rect.left + gap);
  }

  const rounded = Object.fromEntries(CONSOLE_PANEL_SIDES.map(side => [side, Math.max(0, Math.ceil(insets[side]))]));
  const [left, right] = fit(rounded.left, rounded.right, width, MIN_VISIBLE_MAP_PX.width);
  const [top, bottom] = fit(rounded.top, rounded.bottom, height, MIN_VISIBLE_MAP_PX.height);
  return Object.freeze({ top, right, bottom, left });
}

/** Whether two insets are the same, side by side. */
export function sameInsets(first, second) {
  return CONSOLE_PANEL_SIDES.every(side => (first?.[side] ?? 0) === (second?.[side] ?? 0));
}
