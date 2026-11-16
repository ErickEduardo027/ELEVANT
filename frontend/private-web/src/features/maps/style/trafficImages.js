import { CATEGORY_OUTLINES, silhouettePath } from '../aircraft/silhouette';
import { ICON_CATEGORIES } from '../aircraft/types';

// The images of the traffic on the OCC maps (PR M5), drawn on demand by style/mapImages.js like every other icon and
// listed at the end of its MAP_IMAGE_IDS: one solid and one hollow silhouette per icon category (design E2), the dashed
// ring of an estimated position, three plain images and (PR M6) the ring of a point marked on the chosen flight's route.
// Sizes are CSS pixels and every shape keeps 3 px clear of the image border. Pure data.
//
// The silhouettes and the rings are SDF images, painted in the colour of their layer. The glyphs that go inside a tag
// (arrival, departure, the arrow before a stand) and the «Demo» plate are plain images (`sdf: false`) in their own OCC
// colours: MapLibre draws an image inside a text's `format` as it is, without the SDF threshold, and the plate has two
// tones and a frame (contracts 2.4: «Demo» on 45° stripes, as occ-ui/DemoTag.jsx draws it).

/** The square of each category's silhouette: larger airframes read larger, before the layer's own scale. */
export const AIRCRAFT_ICON_SIZES = Object.freeze({
  heavy4: 36, wide2: 34, narrow: 30, regional: 28, turboprop: 28, bizjet: 26, light: 24, heli: 26, unknown: 26,
});

/** The silhouette keeps this much of its square free: 3 px clear plus half the outline of a hollow one. */
export const AIRCRAFT_ICON_INSET = 4;
export const HOLLOW_LINE_WIDTH = 1.5;

/** The image of an aircraft: its category's silhouette, solid or (a departing ELEVANT flight) hollow. */
export function aircraftImage(category, { hollow = false } = {}) {
  const known = ICON_CATEGORIES.includes(category) ? category : 'unknown';
  return `ac-${known}-${hollow ? 'hollow' : 'solid'}`;
}

/** The dashed ring of a position estimated from the schedule. */
export const ESTIMATED_RING_IMAGE = 'traffic-ring-est';
/** The ring of a point marked on the chosen flight's route (PR M6): its touchdown, runway exit, stand or apron hold. */
export const ROUTE_MARK_IMAGE = 'route-mark';
/** The plain images of a tag and the «Demo» plate. */
export const TAG_GLYPHS = Object.freeze({ arrival: 'glyph-arrival', departure: 'glyph-departure', stand: 'glyph-arrow-right' });
export const DEMO_PLATE_IMAGE = 'plate-demo';
/** The slab of the «Demo» plate inside its image (3 px clear on every side). */
export const DEMO_PLATE = Object.freeze({ width: 38, height: 16 });

function aircraftShape(category, style) {
  const size = AIRCRAFT_ICON_SIZES[category];
  const path = silhouettePath(CATEGORY_OUTLINES[category], { size, inset: AIRCRAFT_ICON_INSET });
  // Round joins: a mitred outline would grow spikes at the sharp corners of a tailplane or a dart.
  const op = style === 'hollow' ? { stroke: path, lineWidth: HOLLOW_LINE_WIDTH, join: 'round' } : { fill: path };
  return { width: size, height: size, ops: [op] };
}

const sumOf = ([x, y]) => x + y;

// The part of a convex polygon on one side of the line x + y = limit.
function clipBySum(points, limit, keepAbove) {
  const inside = point => (keepAbove ? sumOf(point) >= limit : sumOf(point) <= limit);
  const crossing = (from, to) => {
    const share = (limit - sumOf(from)) / (sumOf(to) - sumOf(from));
    return [from[0] + share * (to[0] - from[0]), from[1] + share * (to[1] - from[1])];
  };
  const result = [];
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    if (inside(point)) {
      if (!inside(previous)) result.push(crossing(previous, point));
      result.push(point);
    } else if (inside(previous)) {
      result.push(crossing(previous, point));
    }
  });
  return result;
}

const pixel = value => String(Math.round(value * 100) / 100);

/**
 * The 45° stripes of a plate, as filled bands clipped to the rectangle `{ left, top, right, bottom }` (so no stroke
 * cap can leave it): bands `width` px wide every `step` px, measured across the stripes, rising to the right as in
 * occ-ui/DemoTag.jsx. SVG path data, one per band.
 */
export function stripeBands({ left, top, right, bottom }, { step = 6, width = 3 } = {}) {
  const rect = [[left, top], [right, top], [right, bottom], [left, bottom]];
  const along = Math.SQRT2;
  const bands = [];
  for (let start = left + top + along; start < right + bottom; start += step * along) {
    const band = clipBySum(clipBySum(rect, start, true), start + width * along, false);
    if (band.length >= 3) bands.push(`M${band.map(([x, y]) => `${pixel(x)} ${pixel(y)}`).join(' L')} Z`);
  }
  return bands;
}

const plate = DEMO_PLATE;

/** The shapes of the traffic images, in the order MAP_IMAGE_IDS lists them (see mapImages.js for the operations). */
export const TRAFFIC_IMAGE_SHAPES = Object.freeze({
  ...Object.fromEntries(ICON_CATEGORIES.flatMap(category => [
    [aircraftImage(category), aircraftShape(category, 'solid')],
    [aircraftImage(category, { hollow: true }), aircraftShape(category, 'hollow')],
  ])),
  // Clear of the largest silhouette drawn at the same scale.
  [ESTIMATED_RING_IMAGE]: {
    width: 40,
    height: 40,
    ops: [{ stroke: 'M36 20 A16 16 0 1 1 4 20 A16 16 0 1 1 36 20 Z', lineWidth: 1.5, dash: [3, 2.5] }],
  },
  // A short arrow coming down onto the ground line, and one leaving it.
  [TAG_GLYPHS.arrival]: {
    width: 16,
    height: 16,
    sdf: false,
    ops: [
      { stroke: 'M3.8 4.2 L9.4 8.8', lineWidth: 1.6, color: '--occ-text' },
      { fill: 'M12 11 L7.2 10.7 L10.8 6.6 Z', color: '--occ-text' },
      { stroke: 'M3 12.4 H13', lineWidth: 1.2, color: '--occ-text' },
    ],
  },
  [TAG_GLYPHS.departure]: {
    width: 16,
    height: 16,
    sdf: false,
    ops: [
      { stroke: 'M3.8 10.4 L9.4 5.8', lineWidth: 1.6, color: '--occ-text' },
      { fill: 'M12 3.6 L10.8 8 L7.2 3.9 Z', color: '--occ-text' },
      { stroke: 'M3 12.4 H13', lineWidth: 1.2, color: '--occ-text' },
    ],
  },
  // The «→» before a stand: the glyph ranges the map loads stop at 255.
  [TAG_GLYPHS.stand]: {
    width: 16,
    height: 16,
    sdf: false,
    ops: [
      { stroke: 'M3.5 8 H9.5', lineWidth: 1.6, color: '--occ-text' },
      { fill: 'M13 8 L9 4.8 V11.2 Z', color: '--occ-text' },
    ],
  },
  [DEMO_PLATE_IMAGE]: {
    width: plate.width + 6,
    height: plate.height + 6,
    sdf: false,
    ops: [
      { fill: `M3 3 H${plate.width + 3} V${plate.height + 3} H3 Z`, color: '--occ-panel-raised' },
      ...stripeBands({ left: 3, top: 3, right: plate.width + 3, bottom: plate.height + 3 })
        .map(band => ({ fill: band, color: '--occ-line' })),
      { stroke: `M3.5 3.5 H${plate.width + 2.5} V${plate.height + 2.5} H3.5 Z`, lineWidth: 1, color: '--occ-line-strong' },
    ],
  },
  // A small ring, SDF: the route layer paints it in the selection's cyan with a dark halo.
  [ROUTE_MARK_IMAGE]: {
    width: 16,
    height: 16,
    ops: [{ stroke: 'M12 8 A4 4 0 1 1 4 8 A4 4 0 1 1 12 8 Z', lineWidth: 2 }],
  },
});
