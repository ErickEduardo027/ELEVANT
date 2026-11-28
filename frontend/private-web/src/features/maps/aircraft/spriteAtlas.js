import { occColor } from '../../occ-ui/occPalette';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { ICON_CATEGORIES } from './types';
import {
  DEMO_PLATE_IMAGE, ESTIMATED_RING_IMAGE, TRAFFIC_IMAGE_SHAPES, aircraftImage,
} from '../style/trafficImages';

// The images the animated traffic layer draws (PR M2, aircraft/aircraft3dLayer.js), in one atlas: the same shapes the
// GeoJSON layers draw (style/trafficImages.js), so an aircraft reads the same in either path. Pure data, plus
// drawSpriteAtlas, which paints them on a 2D canvas context it is handed.
//
// Encoding (read by the layer's shader): a tinted image (a silhouette, the dashed ring of «est.») is its shape in red
// over its halo in green, so the shader paints the red in the instance's colour and the green in its halo colour, as
// MapLibre paints an SDF icon and its halo; a plain image (the «Demo» plate) carries its own colours.

/** The CSS pixels of one atlas slot, and the atlas's pixel ratio: a silhouette stays sharp up to a ratio of 3. */
export const ATLAS_SLOT_PX = 48;
export const ATLAS_RATIO = 3;
const COLUMNS = 5;

/** The halo of a tinted image, in CSS pixels, as the GeoJSON layers draw it (traffic/trafficLayers.js). */
export const SPRITE_HALO_PX = Object.freeze({ aircraft: 1.5, ring: 1 });

const cellNames = [
  ...ICON_CATEGORIES.flatMap(category => [aircraftImage(category), aircraftImage(category, { hollow: true })]),
  ESTIMATED_RING_IMAGE,
  DEMO_PLATE_IMAGE,
];

/**
 * The cells of the atlas by image id: `{ x, y, width, height, plain }` in CSS pixels from the atlas's top-left corner;
 * `plain` for an image that carries its own colours.
 */
export const SPRITE_CELLS = Object.freeze(Object.fromEntries(cellNames.map((name, index) => {
  const shape = TRAFFIC_IMAGE_SHAPES[name];
  return [name, Object.freeze({
    x: (index % COLUMNS) * ATLAS_SLOT_PX,
    y: Math.floor(index / COLUMNS) * ATLAS_SLOT_PX,
    width: shape.width,
    height: shape.height,
    plain: shape.sdf === false,
  })];
})));

/** The atlas's size in CSS pixels. */
export const ATLAS_SIZE = Object.freeze({
  width: COLUMNS * ATLAS_SLOT_PX,
  height: Math.ceil(cellNames.length / COLUMNS) * ATLAS_SLOT_PX,
});

/**
 * The texture rectangle of an image of the atlas, `[u0, v0, du, dv]`, with v from the atlas's top (the layer's texture
 * is not flipped); null for an image the atlas lacks.
 */
export function cellUv(name) {
  const cell = SPRITE_CELLS[name];
  if (cell === undefined) return null;
  return [cell.x / ATLAS_SIZE.width, cell.y / ATLAS_SIZE.height, cell.width / ATLAS_SIZE.width,
    cell.height / ATLAS_SIZE.height];
}

const RED = '#ff0000';
const GREEN = '#00ff00';

function strokeOp(context, path, op, width, colour) {
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.lineCap = op.cap ?? 'butt';
  context.lineJoin = op.join ?? 'round';
  context.setLineDash?.(op.dash ?? []);
  context.stroke(path);
}

// A tinted image: its halo in green, then its shape in red over it.
function drawTinted(context, shape, halo, makePath) {
  for (const op of shape.ops) {
    const path = makePath(op.fill ?? op.stroke);
    if (op.fill !== undefined) {
      context.fillStyle = GREEN;
      context.fill(path);
      strokeOp(context, path, { join: 'round' }, 2 * halo, GREEN);
    } else {
      strokeOp(context, path, op, op.lineWidth + 2 * halo, GREEN);
    }
  }
  for (const op of shape.ops) {
    const path = makePath(op.fill ?? op.stroke);
    if (op.fill !== undefined) {
      context.fillStyle = RED;
      context.fill(path);
    } else {
      strokeOp(context, path, op, op.lineWidth, RED);
    }
  }
}

// The «Demo» plate: its slab, stripes and frame in their own OCC colours, and its word over them as the GeoJSON layer
// writes it (traffic/trafficLayers.js: occ-traffic-demo-plate).
function drawPlate(context, shape, theme, makePath) {
  for (const op of shape.ops) {
    const path = makePath(op.fill ?? op.stroke);
    const colour = occColor(op.color, theme);
    if (op.fill !== undefined) {
      context.fillStyle = colour;
      context.fill(path);
    } else {
      strokeOp(context, path, op, op.lineWidth, colour);
    }
  }
  context.font = 'bold 11px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.strokeStyle = occColor('panel-raised', theme);
  context.strokeText?.(TAGS.demo.es, shape.width / 2, shape.height / 2);
  context.fillStyle = occColor('text', theme);
  context.fillText?.(TAGS.demo.es, shape.width / 2, shape.height / 2);
}

/**
 * Paints every image of the atlas on `context` (a 2D context of ATLAS_SIZE × `ratio` pixels), in the OCC colours of
 * `theme` for the plain ones. `makePath(d)` builds a Path2D from SVG path data (the browser's by default). Throws when
 * the browser has no Path2D.
 */
export function drawSpriteAtlas(context, { ratio = ATLAS_RATIO, theme = 'dark', makePath = null } = {}) {
  const path = makePath ?? (typeof Path2D === 'function' ? d => new Path2D(d) : null);
  if (path === null) throw new TypeError('The traffic atlas needs Path2D');
  context.clearRect(0, 0, ATLAS_SIZE.width * ratio, ATLAS_SIZE.height * ratio);
  for (const [name, cell] of Object.entries(SPRITE_CELLS)) {
    const shape = TRAFFIC_IMAGE_SHAPES[name];
    context.save();
    context.setTransform(ratio, 0, 0, ratio, cell.x * ratio, cell.y * ratio);
    if (cell.plain) drawPlate(context, shape, theme, path);
    else drawTinted(context, shape, name === ESTIMATED_RING_IMAGE ? SPRITE_HALO_PX.ring : SPRITE_HALO_PX.aircraft, path);
    context.restore();
  }
}
