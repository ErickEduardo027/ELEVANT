import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAND_STATES, STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { CATEGORY_OUTLINES, silhouettePath } from '../aircraft/silhouette';
import { ICON_CATEGORIES } from '../aircraft/types';
import { AIRCRAFT_SILHOUETTE_PATH } from '../aircraftSilhouette';
import {
  MAP_IMAGE_IDS, MAP_IMAGE_SHAPES, createImageResolver, rasterizeWithCanvas, standFrameImage,
} from './mapImages';
import { maskToSdf } from './sdf';
import {
  AIRCRAFT_ICON_INSET, AIRCRAFT_ICON_SIZES, DEMO_PLATE, HOLLOW_LINE_WIDTH, TRAFFIC_IMAGE_SHAPES, aircraftImage,
} from './trafficImages';

// jsdom has no canvas: this stand-in covers the middle half of every image.
function centreRasterizer() {
  return vi.fn((shape, pixelRatio) => {
    const width = Math.round(shape.width * pixelRatio);
    const height = Math.round(shape.height * pixelRatio);
    const alpha = new Uint8ClampedArray(width * height);
    for (let y = Math.floor(height / 4); y < Math.ceil((3 * height) / 4); y += 1) {
      for (let x = Math.floor(width / 4); x < Math.ceil((3 * width) / 4); x += 1) alpha[y * width + x] = 255;
    }
    return { width, height, alpha };
  });
}

const alphaOf = image => Uint8ClampedArray.from({ length: image.width * image.height }, (_, index) => image.data[index * 4 + 3]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('map images', () => {
  it('image ids are deterministic and unique and resolve to SDF images of the declared size', () => {
    expect(new Set(MAP_IMAGE_IDS).size).toBe(MAP_IMAGE_IDS.length);
    expect(Object.keys(MAP_IMAGE_SHAPES)).toEqual(MAP_IMAGE_IDS);
    expect(Object.isFrozen(MAP_IMAGE_IDS) && Object.isFrozen(MAP_IMAGE_SHAPES['glyph-clock'].ops[0])).toBe(true);
    for (const id of MAP_IMAGE_IDS) {
      // Fixed names: one palette, and the colour comes from the layer.
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      // «light» in ac-light-… is the light-aircraft category, not a theme.
      expect(id).not.toMatch(/dark|(?<!ac-)light|#|\d{3,}/);
      const shape = MAP_IMAGE_SHAPES[id];
      expect(Number.isInteger(shape.width) && Number.isInteger(shape.height), id).toBe(true);
      expect(shape.ops.length, id).toBeGreaterThan(0);
      for (const op of shape.ops) {
        expect((op.fill === undefined) !== (op.stroke === undefined), id).toBe(true);
        if (op.stroke !== undefined) expect(op.lineWidth, id).toBeGreaterThan(0);
      }
    }
    // The silhouette is the one the DOM legends draw.
    expect(MAP_IMAGE_SHAPES['aircraft-solid'].ops[0].fill).toBe(AIRCRAFT_SILHOUETTE_PATH);

    const rasterize = centreRasterizer();
    const resolve = createImageResolver({ rasterize });
    // The plain images of the traffic are drawn apart (see «plain images keep their own colours»).
    const sdfIds = MAP_IMAGE_IDS.filter(id => MAP_IMAGE_SHAPES[id].sdf !== false);
    for (const id of sdfIds) {
      const shape = MAP_IMAGE_SHAPES[id];
      const image = resolve(id);
      expect(image, id).toMatchObject({ width: shape.width * 2, height: shape.height * 2, pixelRatio: 2, sdf: true });
      expect(image.data).toHaveLength(image.width * image.height * 4);
      const mask = rasterize.mock.results.at(-1).value.alpha;
      expect(alphaOf(image)).toEqual(maskToSdf(mask, image.width, image.height));
      expect([image.data[0], image.data[1], image.data[2]]).toEqual([255, 255, 255]);
      expect(resolve(id)).toBe(image);
    }
    expect(rasterize).toHaveBeenCalledTimes(sdfIds.length);

    // Another resolver draws the same pixels; at pixel ratio 1 the image has the declared size.
    const again = createImageResolver({ rasterize: centreRasterizer() });
    expect(again('stand-hatch').data).toEqual(resolve('stand-hatch').data);
    const single = createImageResolver({ rasterize: centreRasterizer(), pixelRatio: 1 })('airport-arp');
    expect(single).toMatchObject({ width: 28, height: 20, pixelRatio: 1, sdf: true });
  });

  it('draws each stand outline of the vocabulary on a frame of its own, at its width and dash, clear of the border', () => {
    const frames = MAP_IMAGE_IDS.filter(id => id.startsWith('stand-frame-'));
    const used = new Set();
    for (const state of STAND_STATE_KEYS) {
      const { outline, dash } = STAND_STATES[state];
      const id = standFrameImage(outline.width, dash);
      used.add(id);
      const { width, height, ops } = MAP_IMAGE_SHAPES[id];
      expect(ops, `${state}: ${id}`).toHaveLength(1);
      const [{ stroke, lineWidth, dash: frameDash }] = ops;
      // The outline of the contract (1 px solid «Libre», 1.5 px dashed 4-3 «Planificada», 2.5 px «Llegando»…) is the
      // line the image draws: nothing in the style can make it thinner, and the stand's icon-size scales it.
      expect(lineWidth, `${state}: ${id}`).toBe(outline.width);
      expect(frameDash ?? null, `${state}: ${id}`).toEqual(dash);
      // The 24 px stand square, centred like every stand image, its outer edge 3 px or more from the border.
      const [left, top, right, bottom] = stroke.match(/^M(\d+) (\d+) H(\d+) V(\d+) H\1 Z$/).slice(1).map(Number);
      expect([right - left, bottom - top], id).toEqual([24, 24]);
      expect([left + right, top + bottom], id).toEqual([width, height]);
      expect(left - lineWidth / 2, id).toBeGreaterThanOrEqual(3);
    }
    // One frame per outline: states with the same outline share its frame, and no frame is left over.
    expect([...used].sort()).toEqual([...frames].sort());
    expect(standFrameImage(1)).toBe('stand-frame-solid');
    expect(standFrameImage(2.5, null)).toBe('stand-frame-solid-2-5px');
    expect(() => standFrameImage(3, null)).toThrow(RangeError);
    expect(() => standFrameImage(1.5, null)).toThrow(RangeError);
    expect(() => standFrameImage(1, [4, 3])).toThrow(RangeError);
  });

  it('the aerodrome mark is a ring crossed by a nearly level bar that runs well past it, clear of the image border', () => {
    const { width, height, ops: [ring, bar] } = MAP_IMAGE_SHAPES['airport-arp'];
    const numbers = path => path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    // The ring: `M (cx + r) cy A r r 0 1 1 (cx − r) cy …`, in the middle of the image.
    const [right, cy, radius] = numbers(ring.stroke);
    const cx = right - radius;
    expect([cx, cy]).toEqual([width / 2, height / 2]);
    expect(bar.stroke).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);
    const [x1, y1, x2, y2] = numbers(bar.stroke);
    const slope = Math.atan2(y2 - y1, x2 - x1);
    // Nearly level, so it reads as a runway, never as the slash or the bar of a «no entry» sign.
    expect(Math.abs((slope * 180) / Math.PI)).toBeLessThan(15);
    // Both ends at least 4 px beyond the ring and its stroke.
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      expect(Math.hypot(x - cx, y - cy) - (radius + ring.lineWidth / 2)).toBeGreaterThanOrEqual(4);
    }
    // Butt ends 3 px clear of the border, as every shape here must be, for the SDF and its halo.
    const half = bar.lineWidth / 2;
    expect(bar.cap ?? 'butt').toBe('butt');
    for (const x of [x1, x2]) expect(Math.min(x, width - x) - half * Math.abs(Math.sin(slope))).toBeGreaterThanOrEqual(3);
    for (const y of [y1, y2]) expect(Math.min(y, height - y) - half).toBeGreaterThanOrEqual(3);
    expect(Math.min(cy, height - cy) - radius - ring.lineWidth / 2).toBeGreaterThanOrEqual(3);
  });

  it('an unknown id resolves to null', () => {
    const rasterize = centreRasterizer();
    const resolve = createImageResolver({ rasterize });
    expect(resolve('circle-11')).toBeNull();
    expect(resolve('toString')).toBeNull();
    expect(resolve('')).toBeNull();
    expect(rasterize).not.toHaveBeenCalled();
    // Without a canvas there is nothing to hand to MapLibre either.
    expect(createImageResolver({ rasterize: () => null })('stand-slab')).toBeNull();
    // A drawing of the wrong size is a bug, not an icon.
    const wrong = () => ({ width: 1, height: 1, alpha: new Uint8ClampedArray(1) });
    expect(() => createImageResolver({ rasterize: wrong })('stand-slab')).toThrow(RangeError);
  });

  it('rasterizeWithCanvas draws every operation at the pixel ratio and keeps the alpha channel', () => {
    vi.stubGlobal('Path2D', class {
      constructor(data) {
        this.data = data;
      }
    });
    const calls = [];
    const context = {
      lineWidth: 1,
      scale: (x, y) => calls.push(['scale', x, y]),
      translate: (x, y) => calls.push(['translate', x, y]),
      save: () => calls.push(['save']),
      restore: () => calls.push(['restore']),
      setLineDash: dash => calls.push(['dash', dash]),
      fill: path => calls.push(['fill', path.data]),
      stroke: path => calls.push(['stroke', path.data, context.lineWidth, context.lineCap]),
      getImageData: (x, y, width, height) => ({
        data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) => (index % 4 === 3 ? index % 251 : 9)),
      }),
    };
    const sizes = [];
    const canvasFactory = (width, height) => {
      sizes.push([width, height]);
      return { getContext: () => context };
    };

    const raster = rasterizeWithCanvas(MAP_IMAGE_SHAPES['aircraft-solid'], 2, { canvasFactory });
    expect(sizes).toEqual([[80, 80]]);
    expect(raster.width).toBe(80);
    expect(raster.alpha[1]).toBe(7 % 251);
    expect(calls).toEqual([
      ['scale', 2, 2], ['save'], ['translate', 4, 4], ['scale', 0.5, 0.5], ['fill', AIRCRAFT_SILHOUETTE_PATH], ['restore'],
    ]);

    calls.length = 0;
    rasterizeWithCanvas(MAP_IMAGE_SHAPES['stand-frame-dash-4-3'], 1.5, { canvasFactory });
    expect(sizes.at(-1)).toEqual([51, 51]);
    expect(calls).toContainEqual(['dash', [4, 3]]);
    expect(calls).toContainEqual(['stroke', 'M5 5 H29 V29 H5 Z', 1.5, 'butt']);

    expect(rasterizeWithCanvas(MAP_IMAGE_SHAPES['stand-slab'], 2, { canvasFactory: () => ({ getContext: () => null }) }))
      .toBeNull();
    expect(rasterizeWithCanvas(MAP_IMAGE_SHAPES['stand-slab'], 2, {
      canvasFactory: () => {
        throw new Error('no canvas');
      },
    })).toBeNull();
  });
});

// The points a path's ink can reach: every vertex of a fill; for a stroke of width `width`, the corners of each
// segment's band (butt caps) and every join grown by half the width on both axes (round or right-angle joins).
// Absolute M, L, H, V and Z commands only.
function inkExtent(path, width = 0) {
  const polylines = [];
  let current = null;
  let point = [0, 0];
  const tokens = path.match(/[MLHVZ]|-?\d+(?:\.\d+)?/g);
  let command = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/[MLHVZ]/.test(token)) {
      command = token;
      if (command === 'Z' && current) current.closed = true;
      continue;
    }
    const value = Number(token);
    if (command === 'M' || command === 'L') {
      point = [value, Number(tokens[index + 1])];
      index += 1;
    } else if (command === 'H') point = [value, point[1]];
    else if (command === 'V') point = [point[0], value];
    if (command === 'M') {
      current = { points: [], closed: false };
      polylines.push(current);
    }
    current.points.push(point);
  }
  const reach = [];
  for (const { points, closed } of polylines) {
    if (width === 0) {
      reach.push(...points);
      continue;
    }
    const half = width / 2;
    const ring = closed ? [...points, points[0]] : points;
    for (let index = 0; index + 1 < ring.length; index += 1) {
      const [x1, y1] = ring[index];
      const [x2, y2] = ring[index + 1];
      const length = Math.hypot(x2 - x1, y2 - y1);
      const [nx, ny] = [(-(y2 - y1) / length) * half, ((x2 - x1) / length) * half];
      reach.push([x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny]);
    }
    const joins = closed ? points : points.slice(1, -1);
    for (const [x, y] of joins) reach.push([x - half, y - half], [x + half, y + half]);
  }
  return reach;
}

const TRAFFIC_IDS = Object.keys(TRAFFIC_IMAGE_SHAPES);

describe('traffic images (PR M5)', () => {
  it('lists a solid and a hollow silhouette per icon category, the ring and the plain images at the end', () => {
    expect(MAP_IMAGE_IDS.slice(-TRAFFIC_IDS.length)).toEqual(TRAFFIC_IDS);
    expect(TRAFFIC_IDS).toEqual([
      ...ICON_CATEGORIES.flatMap(category => [`ac-${category}-solid`, `ac-${category}-hollow`]),
      'traffic-ring-est', 'glyph-arrival', 'glyph-departure', 'glyph-arrow-right', 'plate-demo',
    ]);
    expect(aircraftImage('narrow')).toBe('ac-narrow-solid');
    expect(aircraftImage('heavy4', { hollow: true })).toBe('ac-heavy4-hollow');
    expect(aircraftImage('zeppelin')).toBe('ac-unknown-solid');
    // Each category draws its generic airframe, larger airframes in larger squares.
    for (const category of ICON_CATEGORIES) {
      const { width, height, ops: [op] } = MAP_IMAGE_SHAPES[aircraftImage(category)];
      expect([width, height], category).toEqual([AIRCRAFT_ICON_SIZES[category], AIRCRAFT_ICON_SIZES[category]]);
      expect(op.fill, category).toBe(silhouettePath(CATEGORY_OUTLINES[category], { size: width, inset: AIRCRAFT_ICON_INSET }));
    }
    expect(AIRCRAFT_ICON_SIZES.heavy4).toBeGreaterThan(AIRCRAFT_ICON_SIZES.narrow);
    expect(AIRCRAFT_ICON_SIZES.narrow).toBeGreaterThan(AIRCRAFT_ICON_SIZES.light);
  });

  it('arrivals and departures use different images, not only colour', () => {
    for (const category of ICON_CATEGORIES) {
      // The departing ELEVANT flight is the same silhouette as an outline: its shape differs, whatever the colour.
      const solid = MAP_IMAGE_SHAPES[aircraftImage(category)].ops;
      const hollow = MAP_IMAGE_SHAPES[aircraftImage(category, { hollow: true })].ops;
      expect(solid, category).toEqual([{ fill: expect.any(String) }]);
      expect(hollow, category).toEqual([{ stroke: solid[0].fill, lineWidth: HOLLOW_LINE_WIDTH, join: 'round' }]);
    }
    // The glyphs of the tags: an arrow coming down onto the ground line and one leaving it, in the same colour.
    const arrival = MAP_IMAGE_SHAPES['glyph-arrival'].ops;
    const departure = MAP_IMAGE_SHAPES['glyph-departure'].ops;
    expect(arrival.map(op => op.fill ?? op.stroke)).not.toEqual(departure.map(op => op.fill ?? op.stroke));
    expect(new Set([...arrival, ...departure].map(op => op.color))).toEqual(new Set(['--occ-text']));
    // Drawn left to right, the arrival's shaft goes down the image and the departure's goes up.
    const [[, arrivalFrom], [, arrivalTo]] = inkExtent(arrival[0].stroke);
    const [[, departureFrom], [, departureTo]] = inkExtent(departure[0].stroke);
    expect(arrivalTo).toBeGreaterThan(arrivalFrom);
    expect(departureTo).toBeLessThan(departureFrom);
  });

  it('every traffic image keeps 3 px clear', () => {
    for (const id of TRAFFIC_IDS) {
      const { width, height, ops } = MAP_IMAGE_SHAPES[id];
      for (const op of ops) {
        const path = op.fill ?? op.stroke;
        if (path.includes('A')) continue; // the ring, measured below
        const reach = inkExtent(path, op.stroke === undefined ? 0 : op.lineWidth);
        expect(Math.min(...reach.map(([x]) => x)), id).toBeGreaterThanOrEqual(3 - 1e-9);
        expect(Math.min(...reach.map(([, y]) => y)), id).toBeGreaterThanOrEqual(3 - 1e-9);
        expect(Math.max(...reach.map(([x]) => x)), id).toBeLessThanOrEqual(width - 3 + 1e-9);
        expect(Math.max(...reach.map(([, y]) => y)), id).toBeLessThanOrEqual(height - 3 + 1e-9);
      }
    }
    const { width, ops: [ring] } = MAP_IMAGE_SHAPES['traffic-ring-est'];
    const [right, centreY, radius] = ring.stroke.match(/-?\d+(?:\.\d+)?/g).map(Number);
    expect([right - radius, centreY]).toEqual([width / 2, width / 2]);
    expect(width / 2 - radius - ring.lineWidth / 2).toBeGreaterThanOrEqual(3);
    // The plate's word has its slab: 38 × 16 px inside the 3 px margin.
    expect([MAP_IMAGE_SHAPES['plate-demo'].width, MAP_IMAGE_SHAPES['plate-demo'].height])
      .toEqual([DEMO_PLATE.width + 6, DEMO_PLATE.height + 6]);
  });

  it('the estimated ring is dashed', () => {
    const shape = MAP_IMAGE_SHAPES['traffic-ring-est'];
    expect(shape.sdf).toBeUndefined();
    expect(shape.ops).toHaveLength(1);
    const [ring] = shape.ops;
    expect(ring.fill).toBeUndefined();
    expect(ring.stroke).toMatch(/^M[\d.]+ [\d.]+ A/);
    expect(ring.dash).toHaveLength(2);
    expect(ring.dash.every(length => length > 0)).toBe(true);
    // Clear of the largest silhouette at the same scale: the heavy's half diagonal is inside the ring.
    const radius = Number(ring.stroke.match(/A(\d+(?:\.\d+)?)/)[1]);
    expect(radius - ring.lineWidth / 2).toBeGreaterThan((AIRCRAFT_ICON_SIZES.heavy4 - 2 * AIRCRAFT_ICON_INSET) / 2);
  });

  it('plain images keep their own colours, laid over one another in order', () => {
    const rasterize = centreRasterizer();
    const resolve = createImageResolver({ rasterize });
    const arrow = resolve('glyph-arrow-right');
    expect(arrow).toMatchObject({ width: 32, height: 32, pixelRatio: 2, sdf: false });
    // One mask per operation, each drawn alone in the image's box.
    expect(rasterize).toHaveBeenCalledTimes(MAP_IMAGE_SHAPES['glyph-arrow-right'].ops.length);
    expect(rasterize.mock.calls.map(([shape]) => shape.ops)).toEqual(MAP_IMAGE_SHAPES['glyph-arrow-right'].ops.map(op => [op]));
    const pixelAt = (image, x, y) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
    expect(pixelAt(arrow, 16, 16)).toEqual([0xe8, 0xee, 0xf1, 255]);
    expect(pixelAt(arrow, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(resolve('glyph-arrow-right')).toBe(arrow);
    // The plate: the frame, drawn last, covers the middle in this stand-in; the slab and stripes lie under it.
    expect(pixelAt(resolve('plate-demo'), 44, 22)).toEqual([0x76, 0x82, 0x89, 255]);

    // Half-covered operations blend like a canvas: the later colour over the earlier one, in straight RGBA.
    const half = vi.fn((shape, pixelRatio) => {
      const width = Math.round(shape.width * pixelRatio);
      const height = Math.round(shape.height * pixelRatio);
      return { width, height, alpha: new Uint8ClampedArray(width * height).fill(128) };
    });
    const blended = createImageResolver({ rasterize: half })('glyph-arrow-right');
    const cover = 128 / 255;
    const total = cover + cover * (1 - cover);
    const [r, g, b, a] = pixelAt(blended, 0, 0);
    expect(a).toBe(Math.round(total * 255));
    expect([r, g, b]).toEqual([0xe8, 0xee, 0xf1]);
    // Without a canvas there is no plain image either.
    expect(createImageResolver({ rasterize: () => null })('plate-demo')).toBeNull();
  });

  it('draws the hollow silhouettes with round joins and the other strokes with mitres', () => {
    vi.stubGlobal('Path2D', class {
      constructor(data) {
        this.data = data;
      }
    });
    const joins = [];
    const context = {
      scale: () => {}, translate: () => {}, save: () => {}, restore: () => {}, setLineDash: () => {}, fill: () => {},
      stroke: () => joins.push(context.lineJoin),
      getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    };
    const canvasFactory = () => ({ getContext: () => context });
    rasterizeWithCanvas(MAP_IMAGE_SHAPES['ac-narrow-hollow'], 2, { canvasFactory });
    rasterizeWithCanvas(MAP_IMAGE_SHAPES['traffic-ring-est'], 2, { canvasFactory });
    expect(joins).toEqual(['round', 'miter']);
  });
});
