// The base map of the visual suite: vector tiles in the OpenMapTiles schema that the NOC style reads
// (src/features/maps/style/basemapLayers.js), built here from an invented world around Punta Cana, so the screenshots
// show the base map's colours (land, sea, coast, borders, roads, labels, buildings and pavement) without a tile
// server. Nothing here is map data: the coast, the borders, the roads, the names, the runway and the aprons are made
// up and only roughly placed. Node built-ins only; support/isolate.mjs serves the tiles.

const EXTENT = 4096;
// Polygons keep this much tile space around the tile, and the land cut out of the sea a little less, so the clipped
// edges (and the coast line MapLibre draws along them) stay outside the drawn tile.
const OUTER = 128;
const INNER = 64;

// [longitude, latitude] rings and lines.
const LAND = [
  [-72.6, 19.9], [-71.2, 19.95], [-70.4, 19.85], [-69.6, 19.4], [-69.1, 19.25], [-68.75, 19.0], [-68.45, 18.82],
  [-68.33, 18.62], [-68.335, 18.55], [-68.42, 18.42], [-68.6, 18.32], [-68.95, 18.38], [-69.4, 18.42],
  [-69.9, 18.45], [-70.5, 18.2], [-71.1, 17.75], [-71.7, 17.65], [-72.6, 18.1],
];
const ISLET = [[-68.8, 18.17], [-68.75, 18.12], [-68.62, 18.12], [-68.58, 18.18], [-68.7, 18.22]];

const box = ([west, south], [east, north]) => [[west, south], [east, south], [east, north], [west, north]];

const LAYERS = Object.freeze({
  boundary: [
    { properties: { admin_level: 2, maritime: 0 }, line: [[-71.65, 17.62], [-71.7, 18.8], [-71.62, 19.92]] },
    { properties: { admin_level: 2, maritime: 1 }, line: [[-67.9, 17.4], [-67.6, 18.6], [-67.75, 19.9]] },
  ],
  transportation: [
    { properties: { class: 'motorway' }, line: [[-69.9, 18.5], [-69.2, 18.47], [-68.75, 18.62], [-68.6, 18.69]] },
    { properties: { class: 'primary' }, line: [[-68.6, 18.69], [-68.45, 18.62], [-68.385, 18.557], [-68.355, 18.548]] },
  ],
  building: [
    { properties: {}, polygon: box([-68.366, 18.5628], [-68.3605, 18.5633]) },
    { properties: {}, polygon: box([-68.3725, 18.5612], [-68.368, 18.5618]) },
  ],
  water_name: [
    { properties: { class: 'sea', name: 'Mar de prueba' }, point: [-68.9, 17.9] },
    { properties: { class: 'ocean', name: 'Océano de prueba' }, point: [-68.9, 19.7] },
  ],
  place: [
    { properties: { class: 'country', name: 'País de prueba' }, point: [-70.8, 19.0] },
    { properties: { class: 'city', capital: 2, name: 'Capital de prueba' }, point: [-69.9, 18.5] },
    { properties: { class: 'city', name: 'Ciudad de prueba' }, point: [-68.6, 18.69] },
  ],
  // The home airport is in the tiles too: the style leaves its label out, the reference overlay writes «PUJ» once.
  aerodrome_label: [
    { properties: { iata: 'AD1', name: 'Aeródromo de prueba' }, point: [-69.75, 18.47] },
    { properties: { iata: 'PUJ', name: 'Punta Cana' }, point: [-68.3634, 18.5674] },
  ],
  aeroway: [
    { properties: { class: 'apron' }, polygon: box([-68.3666, 18.5634], [-68.3598, 18.566]) },
    { properties: { class: 'apron' }, polygon: box([-68.3737, 18.5622], [-68.3675, 18.5648]) },
    { properties: { class: 'apron' }, polygon: box([-68.3793, 18.5632], [-68.3744, 18.5643]) },
    { properties: { class: 'runway', ref: '08/26' }, line: [[-68.3779, 18.5677], [-68.3489, 18.5725]] },
    { properties: { class: 'taxiway' }, line: [[-68.3785, 18.5662], [-68.349, 18.5711]] },
    { properties: { class: 'taxiway' }, line: [[-68.3628, 18.5688], [-68.3628, 18.566]] },
    { properties: { class: 'taxiway' }, line: [[-68.37, 18.5676], [-68.37, 18.5648]] },
    { properties: { class: 'taxiway' }, line: [[-68.3765, 18.5665], [-68.3765, 18.5643]] },
  ],
});

/** The point of `[lng, lat]` in the units of tile `z/x/y` (Web Mercator, 4096 per tile). */
export function toTileUnits([lng, lat], z, x, y) {
  const scale = EXTENT * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * scale - x * EXTENT,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale - y * EXTENT,
  ];
}

function crossing(from, to, axis, bound) {
  const t = (bound - from[axis]) / (to[axis] - from[axis]);
  return [from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])];
}

/** A ring cut to the square [min, max]² (Sutherland–Hodgman); an open ring in, an open ring out, maybe empty. */
export function clipRing(ring, min, max) {
  let output = ring;
  for (const [axis, bound, keep] of [[0, min, 1], [0, max, -1], [1, min, 1], [1, max, -1]]) {
    const input = output;
    output = [];
    const inside = point => keep * (point[axis] - bound) >= 0;
    input.forEach((current, index) => {
      const previous = input[(index + input.length - 1) % input.length];
      if (inside(current)) {
        if (!inside(previous)) output.push(crossing(previous, current, axis, bound));
        output.push(current);
      } else if (inside(previous)) {
        output.push(crossing(previous, current, axis, bound));
      }
    });
  }
  return output;
}

// One segment cut to the square (Liang–Barsky), or null when it misses it.
function clipSegment(from, to, min, max) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  let start = 0;
  let end = 1;
  for (const [p, q] of [[-dx, from[0] - min], [dx, max - from[0]], [-dy, from[1] - min], [dy, max - from[1]]]) {
    if (p === 0) {
      if (q < 0) return null;
    } else if (p < 0) {
      start = Math.max(start, q / p);
    } else {
      end = Math.min(end, q / p);
    }
    if (start > end) return null;
  }
  return [[from[0] + start * dx, from[1] + start * dy], [from[0] + end * dx, from[1] + end * dy]];
}

/** The parts of a line inside the square [min, max]². */
export function clipLine(line, min, max) {
  const parts = [];
  let open = null;
  for (let index = 0; index < line.length - 1; index += 1) {
    const segment = clipSegment(line[index], line[index + 1], min, max);
    if (segment === null) {
      open = null;
      continue;
    }
    const [from, to] = segment;
    if (open !== null && open.at(-1)[0] === from[0] && open.at(-1)[1] === from[1]) open.push(to);
    else parts.push(open = [from, to]);
    if (to[0] !== line[index + 1][0] || to[1] !== line[index + 1][1]) open = null;
  }
  return parts;
}

// Whole tile units, without repeated points.
function rounded(points) {
  const out = [];
  for (const [px, py] of points) {
    const point = [Math.round(px), Math.round(py)];
    const last = out.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }
  return out;
}

// Twice the signed area in tile units (y down): positive for the outer rings of the vector tile spec.
function signedArea(ring) {
  let sum = 0;
  ring.forEach(([x1, y1], index) => {
    const [x2, y2] = ring[(index + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  });
  return sum;
}

function oriented(ring, outer) {
  const points = rounded(ring);
  if (points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points.pop();
  if (points.length < 3 || signedArea(points) === 0) return null;
  return (signedArea(points) > 0) === outer ? points : points.reverse();
}

const project = (points, z, x, y) => points.map(point => toTileUnits(point, z, x, y));

// The sea of one tile: the tile and its margin, with the land cut out as holes.
function seaPolygon(z, x, y) {
  const holes = [LAND, ISLET]
    .map(ring => oriented(clipRing(project(ring, z, x, y), -INNER, EXTENT + INNER), false))
    .filter(Boolean);
  // A tile all on land has no sea (signedArea is twice the area).
  const inner = (EXTENT + 2 * INNER) ** 2;
  if (holes.some(hole => Math.abs(signedArea(hole)) / 2 >= inner * 0.999)) return null;
  const outer = oriented([[-OUTER, -OUTER], [EXTENT + OUTER, -OUTER], [EXTENT + OUTER, EXTENT + OUTER], [-OUTER, EXTENT + OUTER]], true);
  return [outer, ...holes];
}

// The features of one layer in tile units: `{ type: 1 | 2 | 3, parts, properties }`.
function tileFeatures(name, z, x, y) {
  if (name === 'water') {
    const rings = seaPolygon(z, x, y);
    return rings ? [{ type: 3, parts: rings, properties: { class: 'ocean' } }] : [];
  }
  const features = [];
  for (const { properties, point, line, polygon } of LAYERS[name]) {
    if (point) {
      const [px, py] = toTileUnits(point, z, x, y);
      if (px >= 0 && px < EXTENT && py >= 0 && py < EXTENT) features.push({ type: 1, parts: [rounded([[px, py]])], properties });
    } else if (line) {
      const parts = clipLine(project(line, z, x, y), -OUTER, EXTENT + OUTER).map(rounded).filter(part => part.length > 1);
      if (parts.length > 0) features.push({ type: 2, parts, properties });
    } else {
      const ring = oriented(clipRing(project(polygon, z, x, y), -OUTER, EXTENT + OUTER), true);
      if (ring) features.push({ type: 3, parts: [ring], properties });
    }
  }
  return features;
}

// Protocol buffers, as much of them as a vector tile needs.
function varint(value, out) {
  let rest = value;
  while (rest > 127) {
    out.push((rest % 128) | 128);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
}
const zigzag = value => (value < 0 ? -2 * value - 1 : 2 * value);
const key = (field, wire, out) => varint(field * 8 + wire, out);
function bytesField(field, bytes, out) {
  key(field, 2, out);
  varint(bytes.length, out);
  for (const byte of bytes) out.push(byte);
}
const stringField = (field, text, out) => bytesField(field, [...Buffer.from(text, 'utf8')], out);
function packed(field, values, out) {
  const body = [];
  values.forEach(value => varint(value, body));
  bytesField(field, body, out);
}

function valueMessage(value) {
  const out = [];
  if (typeof value === 'string') stringField(1, value, out);
  else if (Number.isInteger(value) && value >= 0) {
    key(5, 0, out);
    varint(value, out);
  } else {
    key(3, 1, out);
    const double = Buffer.alloc(8);
    double.writeDoubleLE(value);
    out.push(...double);
  }
  return out;
}

const command = (id, count) => (count * 8) + id;

function geometry(type, parts) {
  const out = [];
  let cursor = [0, 0];
  const moveBy = point => {
    out.push(zigzag(point[0] - cursor[0]), zigzag(point[1] - cursor[1]));
    cursor = point;
  };
  if (type === 1) {
    const points = parts.flat();
    out.push(command(1, points.length));
    points.forEach(moveBy);
    return out;
  }
  for (const part of parts) {
    out.push(command(1, 1));
    moveBy(part[0]);
    out.push(command(2, part.length - 1));
    part.slice(1).forEach(moveBy);
    if (type === 3) out.push(command(7, 1));
  }
  return out;
}

function layerMessage(name, features) {
  const keys = [];
  const values = [];
  const indexOf = (list, item) => {
    const found = list.findIndex(entry => entry === item);
    if (found !== -1) return found;
    list.push(item);
    return list.length - 1;
  };
  const out = [];
  key(15, 0, out);
  varint(2, out);
  stringField(1, name, out);
  for (const { type, parts, properties } of features) {
    const feature = [];
    const tags = Object.entries(properties).flatMap(([property, value]) => [indexOf(keys, property), indexOf(values, value)]);
    if (tags.length > 0) packed(2, tags, feature);
    key(3, 0, feature);
    varint(type, feature);
    packed(4, geometry(type, parts), feature);
    bytesField(2, feature, out);
  }
  keys.forEach(property => stringField(3, property, out));
  values.forEach(value => bytesField(4, valueMessage(value), out));
  key(5, 0, out);
  varint(EXTENT, out);
  return out;
}

/** The source-layers of the synthetic world, as the style reads them. */
export const SYNTHETIC_LAYERS = Object.freeze(['water', ...Object.keys(LAYERS)]);

/**
 * The vector tile `z/x/y` of the synthetic world as bytes, or `null` when nothing of it falls in that tile (the suite
 * then answers 204, an empty tile).
 */
export function syntheticTile(z, x, y) {
  const tile = [];
  for (const name of SYNTHETIC_LAYERS) {
    const features = tileFeatures(name, z, x, y);
    if (features.length > 0) bytesField(3, layerMessage(name, features), tile);
  }
  return tile.length === 0 ? null : Buffer.from(tile);
}
