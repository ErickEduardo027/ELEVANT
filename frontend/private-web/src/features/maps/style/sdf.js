// Signed distance fields for the map icons, in MapLibre's convention (the one TinySDF uses for glyphs). MapLibre reads
// the alpha channel of an SDF image: 191 (0.75) is the edge of the shape, and each pixel of distance moves the value by
// 255 / radius, 1/8 with the default radius of 8. With the default cutoff of 0.25 the value is 255 from two pixels
// inside the shape and 0 from six pixels outside, which is the room MapLibre has for an icon halo.

const FAR = 1e20;

// Felzenszwalb and Huttenlocher's squared distance transform along one row or column: every value becomes
// min over r of (value[r] + (q - r)²), found as the lower envelope of the parabolas rooted at each r.
function transformLine(grid, offset, stride, length, values, roots, bounds) {
  for (let q = 0; q < length; q += 1) values[q] = grid[offset + q * stride];
  let k = 0;
  roots[0] = 0;
  bounds[0] = -FAR;
  bounds[1] = FAR;
  for (let q = 1; q < length; q += 1) {
    let crossing;
    do {
      const r = roots[k];
      crossing = (values[q] + q * q - (values[r] + r * r)) / (2 * (q - r));
    } while (crossing <= bounds[k] && --k > -1);
    k += 1;
    roots[k] = q;
    bounds[k] = crossing;
    bounds[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while (bounds[k + 1] < q) k += 1;
    const r = roots[k];
    grid[offset + q * stride] = values[r] + (q - r) * (q - r);
  }
}

// The two passes of the separable Euclidean transform: every column, then every row.
function distanceTransform(grid, width, height) {
  const longest = Math.max(width, height);
  const values = new Float64Array(longest);
  const roots = new Int32Array(longest);
  const bounds = new Float64Array(longest + 1);
  for (let x = 0; x < width; x += 1) transformLine(grid, x, width, height, values, roots, bounds);
  for (let y = 0; y < height; y += 1) transformLine(grid, y * width, 1, width, values, roots, bounds);
}

/**
 * Turns an alpha mask (one byte per pixel, 255 inside the shape) into an SDF of the same size. A partly covered pixel
 * places the edge inside that pixel, so an antialiased mask gives a smooth field.
 */
export function maskToSdf(alpha, width, height, { radius = 8, cutoff = 0.25 } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`An SDF needs a positive whole size, got ${width} × ${height}`);
  }
  if (alpha?.length !== width * height) throw new RangeError(`The mask has ${alpha?.length} pixels, not ${width * height}`);

  const size = width * height;
  const toInside = new Float64Array(size); // squared distance from an outside pixel to the shape
  const toOutside = new Float64Array(size); // squared distance from an inside pixel to the outside
  for (let index = 0; index < size; index += 1) {
    const coverage = alpha[index] / 255;
    if (coverage >= 1) {
      toInside[index] = 0;
      toOutside[index] = FAR;
    } else if (coverage <= 0) {
      toInside[index] = FAR;
      toOutside[index] = 0;
    } else {
      const offset = 0.5 - coverage;
      toInside[index] = offset > 0 ? offset * offset : 0;
      toOutside[index] = offset < 0 ? offset * offset : 0;
    }
  }
  distanceTransform(toInside, width, height);
  distanceTransform(toOutside, width, height);

  const field = new Uint8ClampedArray(size);
  for (let index = 0; index < size; index += 1) {
    const distance = Math.sqrt(toInside[index]) - Math.sqrt(toOutside[index]);
    field[index] = Math.round(255 - 255 * (distance / radius + cutoff));
  }
  return field;
}
