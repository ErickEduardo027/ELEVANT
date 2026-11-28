// The part of a map screen's full-screen map that its floating panels cover (contratos 2.5; M1, «pantalla completa con
// paneles flotantes»): the open panels and the folded pills become OccMap's `insets`, so the views are framed, the
// controls are placed and the selected aircraft or stand is brought into the area the panels leave in sight. One stage
// for the three map screens (Panorama, Monitoreo de vuelos, Mapa de posiciones): each names the edge every panel of
// its own takes room from (an edges map, `{ [panelId]: edge }`). Pure: useStageInsets.js measures the panels and calls
// it.
//
// The map's control column (its zoom group and its rail, occ-map.css) stays at the true right edge of the map and is no
// panel of the stage: a panel that floats at the right of the map sits left of it (--occ-map-rail-reserve), so its
// right inset is its width, the reserve of the column and the gap, and the camera centres in the area left of both.

/** The edges a panel of a map screen takes room from. */
export const STAGE_PANEL_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);

/**
 * The edge of a panel that sits in a column at either side of the map (CN-32): the side of the map its box is on, the
 * left or the right, by where its middle falls. The console's inspector sits at the left under 1536 px and at the right
 * above.
 */
export const STAGE_SIDE_EDGE = 'side';

/** The room left between a panel and what the map shows beside it, in pixels. */
export const STAGE_INSET_GAP_PX = 8;

/**
 * The least of the map that the insets leave in sight, in pixels, across and down: panels that would cover more give
 * back room in proportion, so the map always has an area to frame its views in.
 */
export const MIN_VISIBLE_MAP_PX = Object.freeze({ width: 240, height: 160 });

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
 *   the top and of the columns' heads, or of a band and of a column's foot), never from the left or the right;
 * - a panel without size (hidden), outside the map or with an unknown side takes nothing.
 * Opposite insets that would leave less than MIN_VISIBLE_MAP_PX of the map give back room in proportion. Without a
 * valid map box every inset is 0.
 */
export function insetsFromPanels(rootRect, panels = [], gapPx = STAGE_INSET_GAP_PX) {
  if (!isRect(rootRect)) return ZERO;
  const width = rootRect.right - rootRect.left;
  const height = rootRect.bottom - rootRect.top;
  if (width <= 0 || height <= 0) return ZERO;
  const gap = finite(gapPx) && gapPx > 0 ? gapPx : 0;
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };

  for (const panel of Array.isArray(panels) ? panels : []) {
    const rect = panel?.rect;
    if (!(STAGE_PANEL_SIDES.includes(panel?.side) || panel?.side === STAGE_SIDE_EDGE) || !isRect(rect)) continue;
    if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) continue;
    // A panel the map does not hold in its box covers nothing of it.
    if (rect.right <= rootRect.left || rect.left >= rootRect.right || rect.bottom <= rootRect.top
      || rect.top >= rootRect.bottom) continue;
    let side = panel.side;
    if (side === STAGE_SIDE_EDGE) {
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

  const rounded = Object.fromEntries(STAGE_PANEL_SIDES.map(side => [side, Math.max(0, Math.ceil(insets[side]))]));
  const [left, right] = fit(rounded.left, rounded.right, width, MIN_VISIBLE_MAP_PX.width);
  const [top, bottom] = fit(rounded.top, rounded.bottom, height, MIN_VISIBLE_MAP_PX.height);
  return Object.freeze({ top, right, bottom, left });
}

/** Whether two insets are the same, side by side. */
export function sameInsets(first, second) {
  return STAGE_PANEL_SIDES.every(side => (first?.[side] ?? 0) === (second?.[side] ?? 0));
}
