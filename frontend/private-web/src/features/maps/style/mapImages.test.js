import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAND_STATES, STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { AIRCRAFT_SILHOUETTE_PATH } from '../aircraftSilhouette';
import {
  MAP_IMAGE_IDS, MAP_IMAGE_SHAPES, createImageResolver, rasterizeWithCanvas, standFrameImage,
} from './mapImages';
import { maskToSdf } from './sdf';

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
      expect(id).not.toMatch(/dark|light|#|\d{3,}/);
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
    for (const id of MAP_IMAGE_IDS) {
      const shape = MAP_IMAGE_SHAPES[id];
      const image = resolve(id);
      expect(image, id).toMatchObject({ width: shape.width * 2, height: shape.height * 2, pixelRatio: 2, sdf: true });
      expect(image.data).toHaveLength(image.width * image.height * 4);
      const mask = rasterize.mock.results.at(-1).value.alpha;
      expect(alphaOf(image)).toEqual(maskToSdf(mask, image.width, image.height));
      expect([image.data[0], image.data[1], image.data[2]]).toEqual([255, 255, 255]);
      expect(resolve(id)).toBe(image);
    }
    expect(rasterize).toHaveBeenCalledTimes(MAP_IMAGE_IDS.length);

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
