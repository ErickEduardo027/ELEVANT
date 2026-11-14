import { afterEach, describe, expect, it, vi } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { SIGNALS } from '../../occ-ui/statusVocabulary';
import { CATEGORY_OUTLINES, silhouettePath } from '../aircraft/silhouette';
import { ICON_CATEGORIES } from '../aircraft/types';
import { AIRCRAFT_SILHOUETTE_PATH } from '../aircraftSilhouette';
import {
  MAP_IMAGE_IDS, MAP_IMAGE_SHAPES, createImageResolver, isSdfImage, rasterizeWithCanvas,
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
const numbers = path => path.match(/-?\d+(?:\.\d+)?/g).map(Number);
const pointsOf = path => {
  const values = numbers(path);
  return Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2], values[index * 2 + 1]]);
};
// The points a path of absolute M, L, H, V, Q and Z commands passes through or bends towards.
function pathPoints(path) {
  const points = [];
  let current = [0, 0];
  for (const [, command, args] of path.matchAll(/([MLHVQZ])([^MLHVQZ]*)/g)) {
    const values = args.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (command === 'Z') continue;
    if (command === 'H') current = [values[0], current[1]];
    else if (command === 'V') current = [current[0], values[0]];
    else {
      for (let index = 0; index + 1 < values.length; index += 2) {
        current = [values[index], values[index + 1]];
        points.push(current);
      }
      continue;
    }
    points.push(current);
  }
  return points;
}
// The bounding box of a rectangle path `M x y H x V y H x Z`.
const boxOf = path => {
  const [left, top, right, bottom] = numbers(path);
  return { left, top, right, bottom };
};
const hexChannels = hex => [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('map images', () => {
  it('image ids are deterministic and unique; icons resolve to SDF images and the hatch to a painted pattern of its size', () => {
    expect(new Set(MAP_IMAGE_IDS).size).toBe(MAP_IMAGE_IDS.length);
    expect(Object.keys(MAP_IMAGE_SHAPES)).toEqual(MAP_IMAGE_IDS);
    expect(Object.isFrozen(MAP_IMAGE_IDS) && Object.isFrozen(MAP_IMAGE_SHAPES['glyph-clock'].ops[0])).toBe(true);
    for (const id of MAP_IMAGE_IDS) {
      // Fixed names: one palette, and the colour of an icon comes from its layer.
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      // «light» in ac-light-… is the light-aircraft category, not a theme.
      expect(id).not.toMatch(/dark|(?<!ac-)light|#|\d{3,}/);
      const shape = MAP_IMAGE_SHAPES[id];
      expect(Number.isInteger(shape.width) && Number.isInteger(shape.height), id).toBe(true);
      expect(shape.ops.length, id).toBeGreaterThan(0);
      for (const op of shape.ops) {
        expect([op.fill, op.stroke, op.clear].filter(path => path !== undefined), id).toHaveLength(1);
        if (op.stroke !== undefined) expect(op.lineWidth, id).toBeGreaterThan(0);
      }
    }
    // The patterns painted here are the hatch and the plain marks of the traffic; everything else is an icon.
    expect(MAP_IMAGE_IDS.filter(id => !isSdfImage(id))).toEqual([
      'stand-hatch-pattern', ...Object.keys(TRAFFIC_IMAGE_SHAPES).filter(id => TRAFFIC_IMAGE_SHAPES[id].sdf === false),
    ]);
    // The silhouette is the one the DOM legends draw.
    expect(MAP_IMAGE_SHAPES['aircraft-solid'].ops[0].fill).toBe(AIRCRAFT_SILHOUETTE_PATH);
    expect(MAP_IMAGE_SHAPES['glyph-aircraft'].ops[0].fill).toBe(AIRCRAFT_SILHOUETTE_PATH);

    const rasterize = centreRasterizer();
    const resolve = createImageResolver({ rasterize });
    // The plain images of the traffic are drawn apart (see «plain images keep their own colours»).
    const sdfIds = MAP_IMAGE_IDS.filter(id => MAP_IMAGE_SHAPES[id].sdf !== false);
    for (const id of sdfIds) {
      const shape = MAP_IMAGE_SHAPES[id];
      const image = resolve(id);
      expect(image, id).toMatchObject({ width: shape.width * 2, height: shape.height * 2, pixelRatio: 2, sdf: isSdfImage(id) });
      expect(image.data).toHaveLength(image.width * image.height * 4);
      const mask = rasterize.mock.results.at(-1).value.alpha;
      expect(alphaOf(image)).toEqual(isSdfImage(id) ? maskToSdf(mask, image.width, image.height) : mask);
      if (isSdfImage(id)) expect([image.data[0], image.data[1], image.data[2]]).toEqual([255, 255, 255]);
      expect(resolve(id)).toBe(image);
    }
    expect(rasterize).toHaveBeenCalledTimes(sdfIds.length);

    // Another resolver draws the same pixels; at pixel ratio 1 the image has the declared size.
    const again = createImageResolver({ rasterize: centreRasterizer() });
    expect(again('stand-hatch-pattern').data).toEqual(resolve('stand-hatch-pattern').data);
    const single = createImageResolver({ rasterize: centreRasterizer(), pixelRatio: 1 })('airport-arp');
    expect(single).toMatchObject({ width: 28, height: 20, pixelRatio: 1, sdf: true });
  });

  it('every icon keeps 3 px clear of its border for the SDF and its halo', () => {
    // The icons drawn with lines and curves: every point of what they draw (a cut lies inside its shape).
    for (const id of ['glyph-aircraft', 'glyph-arriving', 'signal-attention', 'signal-urgent', 'aircraft-solid']) {
      const { width, height, ops } = MAP_IMAGE_SHAPES[id];
      for (const op of ops.filter(item => item.clear === undefined)) {
        const scale = op.scale ?? 1;
        const [dx, dy] = op.translate ?? [0, 0];
        const half = op.stroke === undefined ? 0 : op.lineWidth / 2;
        for (const [x, y] of pathPoints(op.fill ?? op.stroke)) {
          const [px, py] = [dx + x * scale, dy + y * scale];
          expect(Math.min(px, width - px) - half, `${id} x ${px}`).toBeGreaterThanOrEqual(2.99);
          expect(Math.min(py, height - py) - half, `${id} y ${py}`).toBeGreaterThanOrEqual(2.99);
        }
      }
    }
    // The icons drawn with arcs: the chip's plate from 3 to 17 by 3 to 13, and the clock's ring of 6 px around the
    // middle with its 1.5 px stroke.
    const chip = MAP_IMAGE_SHAPES['stand-chip'];
    expect(pathPoints(chip.ops[0].fill).every(([x, y]) => x >= 3 && x <= 17 && y >= 3 && y <= 13)).toBe(true);
    expect([chip.width - 17, chip.height - 13]).toEqual([3, 3]);
    const clock = MAP_IMAGE_SHAPES['glyph-clock'];
    const [ringRight, ringY, ringRadius] = numbers(clock.ops[0].stroke);
    expect([ringRight - ringRadius, ringY]).toEqual([clock.width / 2, clock.height / 2]);
    expect(clock.width / 2 - ringRadius - clock.ops[0].lineWidth / 2).toBeGreaterThanOrEqual(3);
  });

  it('the hatch pattern is a non-SDF image painted in line-strong; the signal images are a triangle and an octagon with «!»', () => {
    // The hatch: stripes at 45° (x + y constant) every 8 px, with the corner pieces that join the tiles, painted here in
    // the token of «Inhabilitada»'s hatch, because MapLibre cannot draw a pattern from an SDF.
    const hatch = MAP_IMAGE_SHAPES['stand-hatch-pattern'];
    expect(hatch).toMatchObject({ width: 8, height: 8, sdf: false, color: occColor('line-strong') });
    const segments = hatch.ops[0].stroke.split('M').filter(Boolean).map(pointsOf);
    for (const [[x1, y1], [x2, y2]] of segments) {
      expect(x2 - x1).toBe(-(y2 - y1));
      expect([0, 8, 16]).toContain(x1 + y1);
    }
    expect(new Set(segments.map(([[x, y]]) => x + y))).toEqual(new Set([0, 8, 16]));
    const rasterize = centreRasterizer();
    const pattern = createImageResolver({ rasterize })('stand-hatch-pattern');
    expect(pattern.sdf).toBe(false);
    const mask = rasterize.mock.results.at(-1).value.alpha;
    // Every pixel carries the colour; the drawing's coverage is the alpha, not a distance field.
    for (let index = 0; index < mask.length; index += 1) {
      expect([...pattern.data.slice(index * 4, index * 4 + 3)]).toEqual(hexChannels(occColor('line-strong')));
    }
    expect(alphaOf(pattern)).toEqual(mask);

    // The signals of the vocabulary: the shape it names, filled, with «!» cut out of it.
    expect([SIGNALS.attention.shape, SIGNALS.urgent.shape]).toEqual(['triangle', 'octagon']);
    const triangle = MAP_IMAGE_SHAPES['signal-attention'];
    const octagon = MAP_IMAGE_SHAPES['signal-urgent'];
    expect(pointsOf(triangle.ops[0].fill)).toHaveLength(3);
    const corners = pointsOf(octagon.ops[0].fill);
    expect(corners).toHaveLength(8);
    for (const [x, y] of corners) expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(7, 1);
    // Flat on every side: the octagon's edges run level, upright or at 45°.
    for (const [index, [x, y]] of corners.entries()) {
      const [nx, ny] = corners[(index + 1) % 8];
      const angle = (Math.atan2(ny - y, nx - x) * 180) / Math.PI;
      expect(Math.abs(Math.round(angle / 45) * 45 - angle)).toBeLessThan(0.5);
    }
    for (const signal of [triangle, octagon]) {
      const [bar, dot] = signal.ops.slice(1).map(op => boxOf(op.clear));
      expect(signal.ops.slice(1).every(op => op.clear !== undefined)).toBe(true);
      // An upright bar above a dot, both centred on the shape's axis, and the bar the taller.
      expect(bar.left + bar.right).toBeCloseTo(20, 9);
      expect(dot.left + dot.right).toBeCloseTo(20, 9);
      expect(bar.bottom).toBeLessThan(dot.top);
      expect(bar.bottom - bar.top).toBeGreaterThan(2 * (dot.bottom - dot.top));
    }
    // Both resolve as SDF icons the layer paints in --occ-warn and --occ-danger.
    const resolve = createImageResolver({ rasterize: centreRasterizer() });
    expect([resolve('signal-attention').sdf, resolve('signal-urgent').sdf]).toEqual([true, true]);
  });

  it('the chip stretches only its flat middle around the text and keeps the text inside its plate', () => {
    const chip = MAP_IMAGE_SHAPES['stand-chip'];
    const [[fromX, toX]] = chip.stretchX;
    const [[fromY, toY]] = chip.stretchY;
    const [left, top, right, bottom] = chip.content;
    // The plate runs from 3 to 17 by 3 to 13 with corners of 2 px: the stretched band stays clear of the corners and
    // of the field around the edges, and the text box lies on the plate.
    expect([fromX, toX, fromY, toY]).toEqual([6, 14, 6, 10]);
    expect(left >= 3 && right <= 17 && top >= 3 && bottom <= 13).toBe(true);
    expect(left).toBeLessThanOrEqual(fromX);
    expect(right).toBeGreaterThanOrEqual(toX);
    // MapLibre takes them in image pixels.
    const image = createImageResolver({ rasterize: centreRasterizer() })('stand-chip');
    expect(image).toMatchObject({ sdf: true, stretchX: [[12, 28]], stretchY: [[12, 20]], content: [10, 10, 30, 22] });
    expect(Object.isFrozen(image.stretchX[0])).toBe(true);
    // Only the chip carries stretch metadata.
    expect(MAP_IMAGE_IDS.filter(id => MAP_IMAGE_SHAPES[id].stretchX !== undefined)).toEqual(['stand-chip']);
  });

  it('the aerodrome mark is a ring crossed by a nearly level bar that runs well past it, clear of the image border', () => {
    const { width, height, ops: [ring, bar] } = MAP_IMAGE_SHAPES['airport-arp'];
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
    // The images M2 drew for the stand points are gone with them.
    for (const id of ['stand-slab', 'stand-hatch', 'stand-frame-solid', 'glyph-axis', 'stand-selected']) {
      expect(resolve(id), id).toBeNull();
    }
    expect(rasterize).not.toHaveBeenCalled();
    // Without a canvas there is nothing to hand to MapLibre either.
    expect(createImageResolver({ rasterize: () => null })('glyph-clock')).toBeNull();
    // A drawing of the wrong size is a bug, not an icon.
    const wrong = () => ({ width: 1, height: 1, alpha: new Uint8ClampedArray(1) });
    expect(() => createImageResolver({ rasterize: wrong })('glyph-clock')).toThrow(RangeError);
  });

  it('rasterizeWithCanvas draws every operation at the pixel ratio, cuts the «!» out and keeps the alpha channel', () => {
    vi.stubGlobal('Path2D', class {
      constructor(data) {
        this.data = data;
      }
    });
    const calls = [];
    const context = {
      lineWidth: 1,
      globalCompositeOperation: 'source-over',
      scale: (x, y) => calls.push(['scale', x, y]),
      translate: (x, y) => calls.push(['translate', x, y]),
      save: () => calls.push(['save']),
      restore: () => calls.push(['restore']),
      setLineDash: dash => calls.push(['dash', dash]),
      fill: path => calls.push(['fill', path.data, context.globalCompositeOperation]),
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
      ['scale', 2, 2], ['save'], ['translate', 4, 4], ['scale', 0.5, 0.5], ['fill', AIRCRAFT_SILHOUETTE_PATH, 'source-over'],
      ['restore'],
    ]);

    calls.length = 0;
    rasterizeWithCanvas(MAP_IMAGE_SHAPES['glyph-clock'], 1.5, { canvasFactory });
    expect(sizes.at(-1)).toEqual([30, 30]);
    expect(calls).toContainEqual(['stroke', 'M10 6.5 V10 L12.5 11.5', 1.5, 'round']);

    // The «!» of a signal is cut out of the shape drawn before it, and drawing goes back to normal after it.
    calls.length = 0;
    rasterizeWithCanvas(MAP_IMAGE_SHAPES['signal-attention'], 2, { canvasFactory });
    const fills = calls.filter(call => call[0] === 'fill');
    expect(fills.map(call => call[2])).toEqual(['source-over', 'destination-out', 'destination-out']);
    expect(fills[1][1]).toBe(MAP_IMAGE_SHAPES['signal-attention'].ops[1].clear);
    expect(context.globalCompositeOperation).toBe('source-over');

    expect(rasterizeWithCanvas(MAP_IMAGE_SHAPES['glyph-clock'], 2, { canvasFactory: () => ({ getContext: () => null }) }))
      .toBeNull();
    expect(rasterizeWithCanvas(MAP_IMAGE_SHAPES['glyph-clock'], 2, {
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
      'traffic-ring-est', 'glyph-arrival', 'glyph-departure', 'glyph-arrow-right', 'plate-demo', 'route-mark',
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
    // The two rings (an estimated position's, a route mark's, PR M6): centred, with 3 px clear outside their stroke.
    for (const id of ['traffic-ring-est', 'route-mark']) {
      const { width, height, ops: [ring] } = MAP_IMAGE_SHAPES[id];
      const [right, centreY, radius] = ring.stroke.match(/-?\d+(?:\.\d+)?/g).map(Number);
      expect([right - radius, centreY], id).toEqual([width / 2, width / 2]);
      expect(width, id).toBe(height);
      expect(width / 2 - radius - ring.lineWidth / 2, id).toBeGreaterThanOrEqual(3);
    }
    // The route's ring is an SDF: the layer paints it in the selection's cyan.
    expect(isSdfImage('route-mark')).toBe(true);
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
