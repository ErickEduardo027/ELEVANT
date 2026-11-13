import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIRCRAFT_SILHOUETTE_PATH } from '../aircraftSilhouette';
import { MAP_IMAGE_IDS, MAP_IMAGE_SHAPES, createImageResolver, rasterizeWithCanvas } from './mapImages';
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
    expect(single).toMatchObject({ width: 20, height: 20, pixelRatio: 1, sdf: true });
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
    expect(sizes.at(-1)).toEqual([48, 48]);
    expect(calls).toContainEqual(['dash', [4, 3]]);
    expect(calls).toContainEqual(['stroke', 'M4 4 H28 V28 H4 Z', 1.5, 'butt']);

    expect(rasterizeWithCanvas(MAP_IMAGE_SHAPES['stand-slab'], 2, { canvasFactory: () => ({ getContext: () => null }) }))
      .toBeNull();
    expect(rasterizeWithCanvas(MAP_IMAGE_SHAPES['stand-slab'], 2, {
      canvasFactory: () => {
        throw new Error('no canvas');
      },
    })).toBeNull();
  });
});
