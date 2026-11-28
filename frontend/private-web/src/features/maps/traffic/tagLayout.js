import { TAG_ANCHORS } from './trafficLayers';

// Where the animated layer puts the tags of the traffic (PR M2, aircraft/trafficLabels.js), on the CPU: each tag beside
// its aircraft at one of the anchors of the GeoJSON tags (traffic/trafficLayers.js: TAG_ANCHORS), a fixed number of
// pixels past its silhouette, chosen greedily in the order of the tags' priorities a few times a second (TAG_LAYOUT_MS);
// between two layouts every tag keeps its anchor and rides with its aircraft. Pure: screen pixels in, anchors out.
//
// The rules (CN-29, as the GeoJSON tags keep them): a tag keeps off the tags placed before it and, where it can, off the
// silhouettes of the other aircraft; one that must show (`always`: an ELEVANT tag from the ramp's zoom, the chosen
// aircraft's, the one under the pointer's) is placed even where no anchor is free; the others give way. A tag keeps the
// anchor it had while that one stays free, so the tags do not jump between layouts.

/** How often the tags are laid out again while the traffic moves: four times a second. */
export const TAG_LAYOUT_MS = 250;

const DIAGONAL = Math.SQRT1_2;

/**
 * The centre of a tag of `width` × `height` pixels at `anchor`, from its aircraft, in pixels (y down): `offsetPx` past
 * the aircraft, along the anchor's side or, at a corner, along its diagonal (MapLibre's radial offset).
 */
export function anchorOffset(anchor, width, height, offsetPx) {
  const halfW = width / 2;
  const halfH = height / 2;
  const d = offsetPx * DIAGONAL;
  switch (anchor) {
    case 'left': return [offsetPx + halfW, 0];
    case 'right': return [-(offsetPx + halfW), 0];
    case 'top': return [0, offsetPx + halfH];
    case 'bottom': return [0, -(offsetPx + halfH)];
    case 'top-left': return [d + halfW, d + halfH];
    case 'top-right': return [-(d + halfW), d + halfH];
    case 'bottom-left': return [d + halfW, -(d + halfH)];
    case 'bottom-right': return [-(d + halfW), -(d + halfH)];
    default: throw new RangeError(`Not a tag anchor: ${String(anchor)}`);
  }
}

/** The box `{ left, top, right, bottom }` in pixels of a tag at `anchor` beside its aircraft at (`x`, `y`). */
export function tagBox(anchor, { x, y, width, height, offsetPx }) {
  const [dx, dy] = anchorOffset(anchor, width, height, offsetPx);
  const cx = x + dx;
  const cy = y + dy;
  return { left: cx - width / 2, top: cy - height / 2, right: cx + width / 2, bottom: cy + height / 2 };
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const finite = value => typeof value === 'number' && Number.isFinite(value);

/**
 * The anchors of the tags that show, `Map<id, anchor>`, in the order they were placed.
 * - `candidates`: `{ id, x, y, width, height, offsetPx, priority, always }`, the tags that may show, at the screen
 *   pixels of their aircraft; a lower `priority` is placed first (ties keep their order);
 * - `obstacles`: `{ id, left, top, right, bottom }`, the silhouettes on screen; a tag keeps off all but its own;
 * - `previous`: the anchors of the last layout, tried first;
 * - `viewport`: `{ width, height }`; a tag whose aircraft is off screen is left out (none without it).
 */
export function placeTags(candidates = [], { obstacles = [], previous = null, viewport = null } = {}) {
  const order = (Array.isArray(candidates) ? candidates : [])
    .filter(item => item?.id != null && finite(item.x) && finite(item.y) && item.width > 0 && item.height > 0)
    .filter(item => viewport === null || (item.x >= 0 && item.y >= 0 && item.x <= viewport.width
      && item.y <= viewport.height))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.priority ?? 0) - (b.item.priority ?? 0) || a.index - b.index)
    .map(({ item }) => item);
  const placed = [];
  const anchors = new Map();
  const blocks = Array.isArray(obstacles) ? obstacles : [];
  for (const item of order) {
    const before = previous?.get?.(item.id);
    const tries = TAG_ANCHORS.includes(before) ? [before, ...TAG_ANCHORS.filter(anchor => anchor !== before)] : TAG_ANCHORS;
    const clearOfTags = box => !placed.some(other => overlaps(box, other));
    const clearOfAircraft = box => !blocks.some(block => block.id !== item.id && overlaps(box, block));
    let chosen = null;
    let chosenBox = null;
    // Clear of the tags and of the other aircraft; else clear of the tags; else, if it must show, where it was.
    for (const anchor of tries) {
      const box = tagBox(anchor, item);
      if (clearOfTags(box) && clearOfAircraft(box)) {
        chosen = anchor;
        chosenBox = box;
        break;
      }
    }
    if (chosen === null) {
      for (const anchor of tries) {
        const box = tagBox(anchor, item);
        if (clearOfTags(box)) {
          chosen = anchor;
          chosenBox = box;
          break;
        }
      }
    }
    if (chosen === null && item.always === true) {
      chosen = tries[0];
      chosenBox = tagBox(chosen, item);
    }
    if (chosen === null) continue;
    anchors.set(item.id, chosen);
    placed.push(chosenBox);
  }
  return anchors;
}
