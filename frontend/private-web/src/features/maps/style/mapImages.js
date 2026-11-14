import { occColor } from '../../occ-ui/occPalette';
import { AIRCRAFT_SILHOUETTE_PATH, AIRCRAFT_SILHOUETTE_VIEWBOX } from '../aircraftSilhouette';
import { maskToSdf } from './sdf';

// The images of the OCC map style. There is no sprite: each image is drawn on demand from the path data below and
// handed to MapLibre. An icon becomes an SDF, which MapLibre paints in the colour of its layer (icon-color) with an
// optional halo, so one image serves every colour and the ids are fixed strings with no theme or colour in them. A
// pattern (fill-pattern) cannot be an SDF: it is painted here, in the one OCC token it carries (`sdf: false`).
//
// Sizes are CSS pixels. Every icon keeps at least 3 px clear of the image border: the SDF reaches 6 image pixels (3 CSS
// px at the default pixel ratio of 2) outside the shape, and a halo needs that room. A pattern fills its tile edge to
// edge instead, so its stripes join the next tile.

/** The ids the style may name, in a stable order. */
export const MAP_IMAGE_IDS = Object.freeze([
  'stand-hatch-pattern',
  'stand-chip',
  'glyph-aircraft',
  'glyph-clock',
  'glyph-arriving',
  'signal-attention',
  'signal-urgent',
  'aircraft-solid',
  'airport-arp',
]);

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// The ELEVANT silhouette (nose up) scaled to `size` and placed at `offset`.
const silhouette = (size, offset) => ({
  fill: AIRCRAFT_SILHOUETTE_PATH,
  scale: size / AIRCRAFT_SILHOUETTE_VIEWBOX,
  translate: [offset, offset],
});

// The «!» of a signal, cut out of its shape: a bar and a dot, 1.8 px wide, centred on x = 10. The map paints the
// signal with a dark halo, which fills the cut, so the «!» reads dark on amber or red.
const exclamation = (barTop, barBottom, dotTop) => [
  { clear: `M9.1 ${barTop} H10.9 V${barBottom} H9.1 Z` },
  { clear: `M9.1 ${dotTop} H10.9 V${dotTop + 1.8} H9.1 Z` },
];

// A regular octagon of radius `radius` around (cx, cy), flat on every side of the image.
function octagonPath(cx, cy, radius) {
  const points = Array.from({ length: 8 }, (_, index) => {
    const angle = ((22.5 + 45 * index) * Math.PI) / 180;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)].map(value => Math.round(value * 100) / 100);
  });
  return `M${points.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
}

// The plate of a terminal chip: a 14 × 10 px slab with corners of 2 px (the radius of the OCC plates), stretched by
// MapLibre around the chip's text (icon-text-fit). Only its flat middle stretches, so the corners and the halo that
// draws its 1 px joint keep their size; the text goes over the middle (`content`).
const CHIP_PLATE = 'M5 3 H15 A2 2 0 0 1 17 5 V11 A2 2 0 0 1 15 13 H5 A2 2 0 0 1 3 11 V5 A2 2 0 0 1 5 3 Z';

/**
 * What each image draws: `width` × `height` CSS px and a list of operations in that space. An operation fills a path
 * (`fill`), strokes one (`stroke`, with `lineWidth`, an optional `dash` [dash, gap] and `cap`) or cuts one out of what
 * is drawn (`clear`); `scale` and `translate` place path data drawn in another unit, such as the 64-unit silhouette.
 * A pattern says `sdf: false` and the `color` it is painted in. An image MapLibre stretches around a text
 * (icon-text-fit) says where: `stretchX` and `stretchY` (`[[from, to]]`) and `content` (`[left, top, right, bottom]`).
 */
export const MAP_IMAGE_SHAPES = deepFreeze({
  // The hatch of «Inhabilitada»: stripes at 45° every 8 px, in the token of the vocabulary's hatch (--occ-line-strong).
  // The corner pieces carry each stripe over the tile's edge, so the tiles join without a seam.
  'stand-hatch-pattern': {
    width: 8,
    height: 8,
    sdf: false,
    color: occColor('line-strong'),
    ops: [{ stroke: 'M-1 1 L1 -1 M0 8 L8 0 M7 9 L9 7', lineWidth: 1 }],
  },
  'stand-chip': {
    width: 20,
    height: 16,
    ops: [{ fill: CHIP_PLATE }],
    stretchX: [[6, 14]],
    stretchY: [[6, 10]],
    content: [5, 5, 15, 11],
  },
  // The aircraft of a stand with an aircraft on it, nose up: the layer turns it to the stand's heading.
  'glyph-aircraft': { width: 32, height: 32, ops: [silhouette(20, 6)] },
  // The clock of «Por liberar»: a ring and its two hands.
  'glyph-clock': {
    width: 20,
    height: 20,
    ops: [
      { stroke: 'M16 10 A6 6 0 1 1 4 10 A6 6 0 1 1 16 10 Z', lineWidth: 1.5 },
      { stroke: 'M10 6.5 V10 L12.5 11.5', lineWidth: 1.5, cap: 'round' },
    ],
  },
  // The mark of a terminal chip with a flight arriving at one of its stands: an arrow pointing down at the chip.
  'glyph-arriving': {
    width: 16,
    height: 16,
    ops: [
      { stroke: 'M8 4 V9.5', lineWidth: 2 },
      { fill: 'M4 8.5 L12 8.5 L8 13 Z' },
    ],
  },
  // The two signals of the vocabulary (SIGNALS): attention, a triangle with «!»; urgent, an octagon with «!».
  'signal-attention': {
    width: 20,
    height: 20,
    ops: [{ fill: 'M10 3.5 L17 16.5 L3 16.5 Z' }, ...exclamation(7.6, 12.4, 13.4)],
  },
  'signal-urgent': {
    width: 20,
    height: 20,
    ops: [{ fill: octagonPath(10, 10, 7) }, ...exclamation(5.6, 11.2, 12.4)],
  },
  'aircraft-solid': { width: 40, height: 40, ops: [silhouette(32, 4)] },
  // Aerodrome reference point: a ring crossed by a runway bar that runs well past it, nearly level (a generic runway,
  // not a bearing). A bar kept inside the ring reads as a «no entry» sign, so the image is wider than tall.
  'airport-arp': {
    width: 28,
    height: 20,
    ops: [
      { stroke: 'M18.5 10 A4.5 4.5 0 1 1 9.5 10 A4.5 4.5 0 1 1 18.5 10 Z', lineWidth: 1.5 },
      { stroke: 'M3.2 11.6 L24.8 8.4', lineWidth: 2 },
    ],
  },
});

/** Whether an image is an SDF (an icon the layer paints) rather than a pattern painted here. */
export const isSdfImage = id => MAP_IMAGE_SHAPES[id]?.sdf !== false;

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Draws a shape with the browser's canvas and returns its alpha mask: `{ width, height, alpha }` in image pixels, or
 * `null` when there is no 2D canvas (jsdom, or a browser that refuses one). `canvasFactory` is for tests.
 */
export function rasterizeWithCanvas(shape, pixelRatio, { canvasFactory = createCanvas } = {}) {
  const width = Math.round(shape.width * pixelRatio);
  const height = Math.round(shape.height * pixelRatio);
  let context = null;
  try {
    context = canvasFactory(width, height)?.getContext('2d', { willReadFrequently: true }) ?? null;
  } catch {
    context = null;
  }
  if (context === null) return null;

  context.scale(pixelRatio, pixelRatio);
  for (const op of shape.ops) {
    const scale = op.scale ?? 1;
    context.save();
    if (op.translate) context.translate(op.translate[0], op.translate[1]);
    if (scale !== 1) context.scale(scale, scale);
    context.fillStyle = '#000';
    context.strokeStyle = '#000';
    if (op.fill !== undefined) context.fill(new Path2D(op.fill));
    if (op.stroke !== undefined) {
      context.lineWidth = op.lineWidth / scale;
      context.lineCap = op.cap ?? 'butt';
      context.lineJoin = 'miter';
      context.setLineDash((op.dash ?? []).map(length => length / scale));
      context.stroke(new Path2D(op.stroke));
    }
    if (op.clear !== undefined) {
      context.globalCompositeOperation = 'destination-out';
      context.fill(new Path2D(op.clear));
      context.globalCompositeOperation = 'source-over';
    }
    context.restore();
  }

  const { data } = context.getImageData(0, 0, width, height);
  const alpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = data[index * 4 + 3];
  return { width, height, alpha };
}

const HEX_COLOUR = /^#([0-9a-f]{6})$/i;

// The red, green and blue of an opaque `#rrggbb` token.
function rgbOf(colour) {
  const match = HEX_COLOUR.exec(colour ?? '');
  if (match === null) throw new RangeError(`A pattern is painted in an opaque #rrggbb token, not ${String(colour)}`);
  return [0, 2, 4].map(start => Number.parseInt(match[1].slice(start, start + 2), 16));
}

const scaled = (values, pixelRatio) => values.map(value => (Array.isArray(value)
  ? scaled(value, pixelRatio)
  : Math.round(value * pixelRatio)));

/**
 * The resolver the map engine hands to MapLibre for images the style names and the map does not have yet. For a known
 * id it answers `{ width, height, data, pixelRatio, sdf }` (RGBA data) and, for an image MapLibre stretches around a
 * text, its `stretchX`, `stretchY` and `content` in image pixels: an icon is an SDF in white with the field in the alpha
 * channel (`sdf: true`), a pattern its colour with the drawing's coverage as alpha (`sdf: false`). Any other id, or
 * nothing to draw with, answers `null`. Results are kept, so an id is drawn once. `rasterize(shape, pixelRatio)` is
 * injectable because jsdom has no canvas.
 */
export function createImageResolver({ rasterize = rasterizeWithCanvas, pixelRatio = 2 } = {}) {
  const drawn = new Map();
  return function resolveMapImage(id) {
    if (drawn.has(id)) return drawn.get(id);
    if (!Object.hasOwn(MAP_IMAGE_SHAPES, id)) return null;
    const shape = MAP_IMAGE_SHAPES[id];
    const raster = rasterize(shape, pixelRatio);
    if (!raster) return null;

    const width = Math.round(shape.width * pixelRatio);
    const height = Math.round(shape.height * pixelRatio);
    if (raster.width !== width || raster.height !== height) {
      throw new RangeError(`Image ${id} was drawn at ${raster.width} × ${raster.height}, not ${width} × ${height}`);
    }
    const sdf = shape.sdf !== false;
    const [red, green, blue] = sdf ? [255, 255, 255] : rgbOf(shape.color);
    const alpha = sdf ? maskToSdf(raster.alpha, width, height) : raster.alpha;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < alpha.length; index += 1) {
      data[index * 4] = red;
      data[index * 4 + 1] = green;
      data[index * 4 + 2] = blue;
      data[index * 4 + 3] = alpha[index];
    }
    const stretch = shape.stretchX === undefined ? {} : {
      stretchX: scaled(shape.stretchX, pixelRatio),
      stretchY: scaled(shape.stretchY, pixelRatio),
      content: scaled(shape.content, pixelRatio),
    };
    // The pixel data stays a plain typed array (a view with elements cannot be frozen); the rest is fixed.
    const image = Object.freeze({ width, height, data, pixelRatio, sdf, ...deepFreeze(stretch) });
    drawn.set(id, image);
    return image;
  };
}
