import { AIRCRAFT_SILHOUETTE_PATH, AIRCRAFT_SILHOUETTE_VIEWBOX } from '../aircraftSilhouette';
import { maskToSdf } from './sdf';

// The icons of the OCC map style. There is no sprite: each icon is drawn on demand from the path data below, turned
// into an SDF and handed to MapLibre, which paints it in the colour of the layer (icon-color) with an optional halo.
// One image therefore serves every state colour, and the ids are fixed strings with no theme or colour in them.
//
// Sizes are CSS pixels. Every shape keeps at least 3 px clear of the image border: the SDF reaches 6 image pixels
// (3 CSS px at the default pixel ratio of 2) outside the shape, and a halo needs that room.

/** The ids the style may name, in a stable order. */
export const MAP_IMAGE_IDS = Object.freeze([
  'stand-frame-solid',
  'stand-frame-solid-2px',
  'stand-frame-solid-2-5px',
  'stand-frame-dash-4-3',
  'stand-frame-dash-2-2',
  'stand-frame-dot-1-3',
  'stand-slab',
  'stand-hatch',
  'glyph-aircraft',
  'glyph-axis',
  'glyph-clock',
  'stand-selected',
  'aircraft-solid',
  'airport-arp',
]);

// A stand is a 24 px square centred in a 32 px image; its fill and glyphs share that image, so the layers of one stand
// line up. Its frame outlines the same square centred in a 34 px image, so that the widest outline also keeps 3 px
// clear; MapLibre centres every icon on its point, so the frame lines up with the rest.
const STAND_IMAGE = 32;
const STAND_SQUARE = 'M4 4 H28 V28 H4 Z';
const FRAME_IMAGE = 34;
const FRAME_SQUARE = 'M5 5 H29 V29 H5 Z';

// The frames of the stand states: one per outline of occ-ui/statusVocabulary.js, drawn at its width and dash. The
// width belongs in the image: icon-size scales the whole stand, and a halo can only thicken a line and keeps its width
// in screen pixels while the zoom and the tilt of the map resize the stand. The id names the pattern, and the width
// where one pattern comes in several.
const STAND_FRAMES = deepFreeze([
  { id: 'stand-frame-solid', width: 1, dash: null },
  { id: 'stand-frame-solid-2px', width: 2, dash: null },
  { id: 'stand-frame-solid-2-5px', width: 2.5, dash: null },
  { id: 'stand-frame-dash-4-3', width: 1.5, dash: [4, 3] },
  { id: 'stand-frame-dash-2-2', width: 1.5, dash: [2, 2] },
  { id: 'stand-frame-dot-1-3', width: 1, dash: [1, 3] },
]);

// Diagonal hatch inside the stand square: lines x + y = c every `step` pixels, clipped to the square.
function hatchPath({ min = 4, max = 28, step = 4 } = {}) {
  const segments = [];
  for (let sum = 2 * min + step; sum < 2 * max; sum += step) {
    const fromX = Math.max(min, sum - max);
    const toX = Math.min(max, sum - min);
    segments.push(`M${fromX} ${sum - fromX} L${toX} ${sum - toX}`);
  }
  return segments.join(' ');
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const frameShape = ({ width, dash }) => ({
  width: FRAME_IMAGE, height: FRAME_IMAGE, ops: [{ stroke: FRAME_SQUARE, lineWidth: width, dash }],
});

const sameDash = (first, second) => (first === null || second === null
  ? first === second
  : first.length === second.length && first.every((length, index) => length === second[index]));

/**
 * The frame image of a stand outline as occ-ui/statusVocabulary.js gives it: `width` in pixels and `dash`, `[dash,
 * gap]` in pixels or `null` for a solid line. Throws a RangeError for an outline that no frame draws.
 */
export function standFrameImage(width, dash = null) {
  const frame = STAND_FRAMES.find(item => item.width === width && sameDash(item.dash, dash ?? null));
  if (!frame) throw new RangeError(`No stand frame is drawn ${width} px wide with the dash ${JSON.stringify(dash)}`);
  return frame.id;
}

// The ELEVANT silhouette (nose up) scaled to `size` and placed at `offset`.
const silhouette = (size, offset) => ({
  fill: AIRCRAFT_SILHOUETTE_PATH,
  scale: size / AIRCRAFT_SILHOUETTE_VIEWBOX,
  translate: [offset, offset],
});

/**
 * What each image draws: `width` × `height` CSS px and a list of operations in that space. An operation fills a path
 * (`fill`) or strokes one (`stroke`, with `lineWidth`, an optional `dash` [dash, gap] and `cap`); `scale` and
 * `translate` place path data drawn in another unit, such as the 64-unit silhouette.
 */
export const MAP_IMAGE_SHAPES = deepFreeze({
  ...Object.fromEntries(STAND_FRAMES.map(frame => [frame.id, frameShape(frame)])),
  'stand-slab': { width: STAND_IMAGE, height: STAND_IMAGE, ops: [{ fill: STAND_SQUARE }] },
  'stand-hatch': { width: STAND_IMAGE, height: STAND_IMAGE, ops: [{ stroke: hatchPath(), lineWidth: 1 }] },
  'glyph-aircraft': { width: STAND_IMAGE, height: STAND_IMAGE, ops: [silhouette(20, 6)] },
  'glyph-axis': { width: STAND_IMAGE, height: STAND_IMAGE, ops: [{ stroke: 'M16 9 V23', lineWidth: 1.4 }] },
  'glyph-clock': {
    width: STAND_IMAGE,
    height: STAND_IMAGE,
    ops: [
      { stroke: 'M22 16 A6 6 0 1 1 10 16 A6 6 0 1 1 22 16 Z', lineWidth: 1.5 },
      { stroke: 'M16 12.5 V16 L18.5 17.5', lineWidth: 1.5, cap: 'round' },
    ],
  },
  // The selection casing hugs the stand square: 2 px outside it on every side.
  'stand-selected': { width: 36, height: 36, ops: [{ stroke: 'M4 4 H32 V32 H4 Z', lineWidth: 2 }] },
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
    context.restore();
  }

  const { data } = context.getImageData(0, 0, width, height);
  const alpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = data[index * 4 + 3];
  return { width, height, alpha };
}

/**
 * The resolver the map engine hands to MapLibre for images the style names and the map does not have yet. It answers
 * `{ width, height, data, pixelRatio, sdf: true }` (RGBA data, the field in the alpha channel) for a known id, and
 * `null` for any other id or when nothing can be drawn. Results are kept, so an id is drawn once.
 * `rasterize(shape, pixelRatio)` is injectable because jsdom has no canvas.
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
    const field = maskToSdf(raster.alpha, width, height);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < field.length; index += 1) {
      data[index * 4] = 255;
      data[index * 4 + 1] = 255;
      data[index * 4 + 2] = 255;
      data[index * 4 + 3] = field[index];
    }
    const image = Object.freeze({ width, height, data, pixelRatio, sdf: true });
    drawn.set(id, image);
    return image;
  };
}
