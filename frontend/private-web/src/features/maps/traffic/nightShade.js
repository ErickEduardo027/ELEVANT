import { CIVIL_TWILIGHT_DEG, subsolarPoint } from './solar.js';

// The night of the OCC maps (design E6, PR M8): where the sun is below the edge of the civil twilight (−6°), as one
// polygon for the night shade, the line of its edge and the points where its word goes, at a minute of the server's
// clock. It is not a second sun
// module: the sun comes from traffic/solar.js (subsolarPoint), and this only finds, meridian by meridian, the latitudes
// where the sun stands at the edge, solving sin φ · sin δ + cos φ · cos δ · cos H = sin(edge) (H the sun's hour angle
// there, δ its declination). The night on a meridian is one stretch of latitude; the polygon joins those stretches and
// closes towards the pole in the night, with the latitudes bounded to ±85° (the Web Mercator world). Near an equinox
// the night holds neither pole: it is then a cap around the point opposite the sun, split at the antimeridian when it
// crosses it. Pure: the instant is a parameter.

/** The highest latitude the shade reaches, north and south. */
export const NIGHT_MAX_LATITUDE = 85;
/** The meridians the edge is solved on, every 2°. */
export const NIGHT_STEP_DEG = 2;

const MINUTE_MS = 60_000;
const DIGITS = 4;
// Bisection steps that close a stretch of night where it ends between two meridians (2° / 2^24, well under a metre).
const BISECTION_STEPS = 24;
const toRadians = degrees => (degrees * Math.PI) / 180;
const toDegrees = radians => (radians * 180) / Math.PI;
const round = value => {
  const rounded = Math.round(value * 10 ** DIGITS) / 10 ** DIGITS;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** The minute an instant falls in: the shade changes once a minute and two instants of one minute draw the same. */
export const floorToMinute = ms => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

/**
 * The stretch of night on the meridian `lngDeg`: `[south, north]` in degrees, bounded to ±NIGHT_MAX_LATITUDE, or
 * `null` when the meridian has none. `sun` is the subsolar point `[lng, lat]`; night is where the sun is below
 * `edgeDeg`.
 */
export function nightStretch(lngDeg, [sunLng, sunLat], edgeDeg = CIVIL_TWILIGHT_DEG) {
  const declination = toRadians(sunLat);
  const a = Math.sin(declination);
  const b = Math.cos(declination) * Math.cos(toRadians(lngDeg - sunLng));
  const c = Math.sin(toRadians(edgeDeg));
  // How far the sun is above the edge at latitude φ (radians): night where it is below zero.
  const above = phi => a * Math.sin(phi) + b * Math.cos(phi) - c;
  const amplitude = Math.hypot(a, b);
  const bounds = [-Math.PI / 2];
  if (amplitude > Math.abs(c)) {
    // a sin φ + b cos φ = R sin(φ + ψ): the roots of R sin(φ + ψ) = c on the meridian.
    const psi = Math.atan2(b, a);
    const base = Math.asin(c / amplitude);
    for (const root of [base - psi, Math.PI - base - psi]) {
      const phi = Math.atan2(Math.sin(root), Math.cos(root));
      if (phi > -Math.PI / 2 && phi < Math.PI / 2) bounds.push(phi);
    }
  }
  bounds.push(Math.PI / 2);
  bounds.sort((x, y) => x - y);
  // The night on a meridian is one stretch (the cap of the night is convex), so its pieces between the roots join.
  let south = null;
  let north = null;
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    const [from, to] = [bounds[index], bounds[index + 1]];
    if (to - from < 1e-12 || above((from + to) / 2) >= 0) continue;
    south = south === null ? from : Math.min(south, from);
    north = north === null ? to : Math.max(north, to);
  }
  if (south === null) return null;
  const limit = NIGHT_MAX_LATITUDE;
  const [from, to] = [Math.max(-limit, toDegrees(south)), Math.min(limit, toDegrees(north))];
  return to - from > 1e-9 ? [from, to] : null;
}

// The meridians from −180° to 180°, both included.
function meridians(stepDeg) {
  const count = Math.round(360 / stepDeg);
  return Array.from({ length: count + 1 }, (_, index) => -180 + (360 * index) / count);
}

// Where a stretch of night ends between the meridian `inside` (with night) and `outside` (without): the last meridian
// that still has it, found by bisection, with the middle of its tiny stretch.
function closingPoint(inside, outside, sun, edgeDeg) {
  let [near, far] = [inside, outside];
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const middle = (near + far) / 2;
    if (nightStretch(middle, sun, edgeDeg) === null) far = middle;
    else near = middle;
  }
  const [south, north] = nightStretch(near, sun, edgeDeg);
  return [near, (south + north) / 2];
}

// One polygon of night over a run of meridians with night: its north side west to east, its south side back.
function runRing(run, { west, east }) {
  const north = run.map(({ lng, stretch }) => [lng, stretch[1]]);
  const south = run.map(({ lng, stretch }) => [lng, stretch[0]]).reverse();
  return [...(west ? [west] : []), ...north, ...(east ? [east] : []), ...south, west ?? north[0]];
}

/**
 * The night at `ms` (epoch milliseconds of the server's clock, taken at its minute) as `{ polygons, edges }`:
 * `polygons` are the rings of the night (one, or two when a cap of night crosses the antimeridian), closed, within ±180°
 * and ±NIGHT_MAX_LATITUDE; `edges` are the lines where the sun stands at `edgeDeg` (the civil twilight by default),
 * without the parts that bound the polygons at ±85° or at the antimeridian. `stepDeg` spaces the meridians.
 */
export function terminatorPolygon(ms, { edgeDeg = CIVIL_TWILIGHT_DEG, stepDeg = NIGHT_STEP_DEG } = {}) {
  const sun = subsolarPoint(floorToMinute(ms));
  const samples = meridians(stepDeg).map(lng => ({ lng, stretch: nightStretch(lng, sun, edgeDeg) }));
  const runs = [];
  let current = null;
  samples.forEach((sample, index) => {
    if (sample.stretch === null) {
      current = null;
      return;
    }
    if (current === null) {
      current = { start: index, samples: [] };
      runs.push(current);
    }
    current.samples.push(sample);
  });
  const last = samples.length - 1;
  const polygons = runs.map(run => {
    const end = run.start + run.samples.length - 1;
    // A run that reaches ±180° stops there (the antimeridian cuts it); one that ends between two meridians closes where
    // its night ends.
    const west = run.start === 0 ? null : closingPoint(samples[run.start].lng, samples[run.start - 1].lng, sun, edgeDeg);
    const east = end === last ? null : closingPoint(samples[end].lng, samples[end + 1].lng, sun, edgeDeg);
    return runRing(run.samples, { west, east }).map(([lng, lat]) => [round(lng), round(lat)]);
  });
  return { polygons, edges: polygons.flatMap(edgeLines) };
}

// The parts of a ring that are the edge of the night: not along a bound at ±85°, not along the antimeridian.
function edgeLines(ring) {
  const limit = NIGHT_MAX_LATITUDE;
  const bound = ([lng, lat], [nextLng, nextLat]) => (Math.abs(lat) >= limit - 1e-9 && Math.abs(nextLat) >= limit - 1e-9)
    || (Math.abs(lng) === 180 && lng === nextLng);
  const lines = [];
  let open = null;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [from, to] = [ring[index], ring[index + 1]];
    if (bound(from, to)) {
      open = null;
      continue;
    }
    if (open === null) {
      open = [from];
      lines.push(open);
    }
    open.push(to);
  }
  return lines.filter(part => part.length >= 2);
}

/** The latitudes at which the shade writes its word, on the night side of its edge. */
export const NIGHT_LABEL_LATITUDES = Object.freeze([-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60]);
/** How far into the night the word sits from the edge, in degrees of longitude. */
export const NIGHT_LABEL_OFFSET_DEG = 1.5;

/**
 * Where the shade writes its word: wherever its edge crosses one of NIGHT_LABEL_LATITUDES, NIGHT_LABEL_OFFSET_DEG
 * into the side that is night. Over the sea the shade barely darkens the dark map, so the word and the edge's line say
 * where the night is: not its tone alone.
 */
function labelPoints(edges, sun, edgeDeg) {
  const points = [];
  for (const line of edges) {
    for (let index = 0; index + 1 < line.length; index += 1) {
      const [[fromLng, fromLat], [toLng, toLat]] = [line[index], line[index + 1]];
      for (const lat of NIGHT_LABEL_LATITUDES) {
        if ((fromLat < lat) === (toLat < lat)) continue;
        const crossing = fromLng + ((lat - fromLat) / (toLat - fromLat)) * (toLng - fromLng);
        const night = [1, -1].map(side => crossing + side * NIGHT_LABEL_OFFSET_DEG).find(lng => {
          if (Math.abs(lng) > 180) return false;
          const stretch = nightStretch(lng, sun, edgeDeg);
          return stretch !== null && stretch[0] <= lat && lat <= stretch[1];
        });
        if (night !== undefined) points.push([round(night), lat]);
      }
    }
  }
  return points;
}

/**
 * The data of the night source at `ms`, taken at its minute: one feature `night` (a Polygon, or a MultiPolygon when the
 * antimeridian splits it), one `nightEdge` (a MultiLineString along the edge of the civil twilight) and one
 * `nightLabel` (a MultiPoint with `label`, the word the screen's language gives the night, on its side of the edge).
 */
export function nightShadeFeatures(ms, { label = 'Noche' } = {}) {
  const { polygons, edges } = terminatorPolygon(ms);
  const shade = polygons.length === 1
    ? { type: 'Polygon', coordinates: [polygons[0]] }
    : { type: 'MultiPolygon', coordinates: polygons.map(ring => [ring]) };
  const words = labelPoints(edges, subsolarPoint(floorToMinute(ms)), CIVIL_TWILIGHT_DEG);
  return {
    type: 'FeatureCollection',
    features: [
      ...(polygons.length === 0 ? [] : [{ type: 'Feature', properties: { kind: 'night' }, geometry: shade }]),
      ...(edges.length === 0 ? [] : [{ type: 'Feature', properties: { kind: 'nightEdge' },
        geometry: { type: 'MultiLineString', coordinates: edges } }]),
      ...(words.length === 0 ? [] : [{ type: 'Feature', properties: { kind: 'nightLabel', label },
        geometry: { type: 'MultiPoint', coordinates: words } }]),
    ],
  };
}
