import { describe, expect, it } from 'vitest';
import { maskToSdf } from './sdf';

const SIZE = 40;

// A square from `from` to `to` (inclusive), with its outer ring of pixels half covered when `antialiased`.
function squareMask({ from = 10, to = 29, antialiased = true } = {}) {
  const mask = new Uint8ClampedArray(SIZE * SIZE);
  for (let y = from; y <= to; y += 1) {
    for (let x = from; x <= to; x += 1) {
      const onEdge = x === from || x === to || y === from || y === to;
      mask[y * SIZE + x] = antialiased && onEdge ? 128 : 255;
    }
  }
  return mask;
}

const at = (field, x, y) => field[y * SIZE + x];

describe('maskToSdf', () => {
  it('a filled square encodes about 191 on its edge, 255 deep inside and 0 beyond the radius', () => {
    const field = maskToSdf(squareMask(), SIZE, SIZE);
    expect(field).toBeInstanceOf(Uint8ClampedArray);
    expect(field).toHaveLength(SIZE * SIZE);

    // The half covered ring is the edge of the shape: 0.75 of the byte range.
    expect(Math.abs(at(field, 10, 20) - 191)).toBeLessThanOrEqual(1);
    expect(Math.abs(at(field, 20, 29) - 191)).toBeLessThanOrEqual(1);
    // From two pixels inside, the field is full.
    expect(at(field, 20, 20)).toBe(255);
    expect(at(field, 12, 20)).toBe(255);
    // Outside, each pixel of distance takes 1/8 of the range, down to 0 at six pixels.
    const perPixel = at(field, 9, 20) - at(field, 8, 20);
    expect(Math.abs(Math.abs(perPixel) - 255 / 8)).toBeLessThanOrEqual(1);
    expect(at(field, 4, 20)).toBe(0);
    // Beyond the radius of 8 pixels nothing is left, corners included.
    expect(at(field, 1, 20)).toBe(0);
    expect(at(field, 0, 0)).toBe(0);
    // The field falls steadily from the centre to the border of the image.
    for (let x = 20; x > 0; x -= 1) expect(at(field, x - 1, 20)).toBeLessThanOrEqual(at(field, x, 20));

    // Without antialiasing the edge lies between two pixels, which straddle 191.
    const hard = maskToSdf(squareMask({ antialiased: false }), SIZE, SIZE);
    expect(Math.abs((at(hard, 10, 20) + at(hard, 9, 20)) / 2 - 191)).toBeLessThanOrEqual(1);
  });

  it('a symmetric mask gives a symmetric field', () => {
    // A plus sign centred in the image: symmetric across both axes and both diagonals.
    const mask = new Uint8ClampedArray(SIZE * SIZE);
    for (let y = 8; y < 32; y += 1) {
      for (let x = 8; x < 32; x += 1) {
        if ((x >= 17 && x < 23) || (y >= 17 && y < 23)) mask[y * SIZE + x] = 255;
      }
    }
    const field = maskToSdf(mask, SIZE, SIZE);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const value = at(field, x, y);
        expect(at(field, SIZE - 1 - x, y)).toBe(value);
        expect(at(field, x, SIZE - 1 - y)).toBe(value);
        expect(at(field, y, x)).toBe(value);
      }
    }
  });

  it('an empty or a full mask saturates, and a wrong size is refused', () => {
    expect(new Set(maskToSdf(new Uint8ClampedArray(16), 4, 4))).toEqual(new Set([0]));
    expect(new Set(maskToSdf(new Uint8ClampedArray(16).fill(255), 4, 4))).toEqual(new Set([255]));
    expect(() => maskToSdf(new Uint8ClampedArray(15), 4, 4)).toThrow(RangeError);
    expect(() => maskToSdf(new Uint8ClampedArray(0), 0, 0)).toThrow(RangeError);
  });
});
