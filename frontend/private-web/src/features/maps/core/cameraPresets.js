import { PUJ_COORDINATES } from '../../flight-monitoring/flightMonitoringMappers';

// The camera presets of the OCC maps (contracts 2.3): four views of one canvas, Región, Aproximación, Aeródromo and
// Rampa, plus one view per terminal. Pure: OccMap fits each target to the screen it has, and every zoom threshold
// and every boundary between views is derived at run time from those fitted zooms, never from fixed numbers.
// Coordinates are [longitude, latitude]; bounds are [[west, south], [east, north]], as MapLibre takes them.

export const VIEW_NAMES = Object.freeze(['region', 'approach', 'airfield', 'ramp']);
export const TERMINALS = Object.freeze(['A', 'B', 'FBO']);

/** The aerodrome reference point of Punta Cana. */
export const PUJ_ARP = Object.freeze([PUJ_COORDINATES.longitude, PUJ_COORDINATES.latitude]);

export const REGION_RADIUS_NM = 250;
export const APPROACH_RADIUS_NM = 40;
// Until PR M3 brings layout.meta.bbox, the airport box is this ring around the ARP joined with the stands.
export const AIRFIELD_RADIUS_NM = 1.5;
export const STAND_MARGIN_M = 120;
export const AIRFIELD_MARGIN_M = 300;
// Only for a station without one located stand: the ramp then frames a small ring around the ARP.
export const RAMP_FALLBACK_RADIUS_NM = 0.6;

/**
 * The tilt of the 3D mode by view (contracts 2.3): the ramp keeps today's values of the positions map, the airfield
 * tilts less so the whole field stays in sight. Region and approach stay 2D.
 */
export const CAMERA_3D = Object.freeze({
  airfield: Object.freeze({ pitch: 40, bearing: -17 }),
  ramp: Object.freeze({ pitch: 55, bearing: -17 }),
});

// How the derived thresholds sit against the fitted zooms (contracts 2.3).
const THRESHOLD_OFFSET = Object.freeze({ polygons: -0.3, codes: -0.3, threeLine: 0.8 });

// Camera transitions (design A5): a flight above this zoom change, an ease below it.
const FLY_ABOVE_ZOOM_STEPS = 2.5;
const FLY_CURVE = 1.42;
const DURATION_BASE_MS = 600;
const DURATION_PER_ZOOM_MS = 220;
const DURATION_MIN_MS = 600;
const DURATION_MAX_MS = 2600;

const EARTH_RADIUS_M = 6371008.8;
const METRES_PER_NM = 1852;

const toRadians = degrees => (degrees * Math.PI) / 180;
const toDegrees = radians => (radians * 180) / Math.PI;
const isCoordinate = value => typeof value === 'number' && Number.isFinite(value);

/** Great-circle distance in nautical miles. */
export function distanceNm([fromLng, fromLat], [toLng, toLat]) {
  const fromPhi = toRadians(fromLat);
  const toPhi = toRadians(toLat);
  const halfChord = Math.sin(toRadians(toLat - fromLat) / 2) ** 2
    + Math.cos(fromPhi) * Math.cos(toPhi) * Math.sin(toRadians(toLng - fromLng) / 2) ** 2;
  return (2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(halfChord)))) / METRES_PER_NM;
}

/** The point `distance` nautical miles from `origin` on the initial bearing `bearing` (degrees from north). */
export function destinationPoint([lng, lat], bearing, distance) {
  const angle = (distance * METRES_PER_NM) / EARTH_RADIUS_M;
  const theta = toRadians(bearing);
  const phi = toRadians(lat);
  const sinPhi = Math.sin(phi) * Math.cos(angle) + Math.cos(phi) * Math.sin(angle) * Math.cos(theta);
  const lambda = toRadians(lng) + Math.atan2(
    Math.sin(theta) * Math.sin(angle) * Math.cos(phi),
    Math.cos(angle) - Math.sin(phi) * sinPhi,
  );
  return [toDegrees(lambda), toDegrees(Math.asin(sinPhi))];
}

/**
 * The box around a ring of `radiusNm` around `center`: north and south on the centre's meridian, east and west on the
 * meridians the ring touches (the widest longitude of a circle on the sphere is not on the centre's parallel).
 */
export function ringBounds([lng, lat], radiusNm) {
  const angle = (radiusNm * METRES_PER_NM) / EARTH_RADIUS_M;
  const dLat = toDegrees(angle);
  const dLng = toDegrees(Math.asin(Math.min(1, Math.sin(angle) / Math.cos(toRadians(lat)))));
  return [[lng - dLng, lat - dLat], [lng + dLng, lat + dLat]];
}

const isBounds = bounds => Array.isArray(bounds) && bounds.length === 2 && bounds.flat().every(isCoordinate);

/** `bounds` grown by `metres` on every side; the longitude margin holds at the latitude farthest from the equator. */
export function padBounds(bounds, metres) {
  if (!isBounds(bounds)) return null;
  const [[west, south], [east, north]] = bounds;
  const dLat = toDegrees(metres / EARTH_RADIUS_M);
  const farthest = toRadians(Math.max(Math.abs(south), Math.abs(north)));
  const dLng = toDegrees(metres / (EARTH_RADIUS_M * Math.cos(farthest)));
  return [[west - dLng, south - dLat], [east + dLng, north + dLat]];
}

/** The box around every given box; `null` entries are skipped, and `null` comes back when none is left. */
export function unionBounds(...boxes) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const box of boxes) {
    if (!isBounds(box)) continue;
    west = Math.min(west, box[0][0]);
    south = Math.min(south, box[0][1]);
    east = Math.max(east, box[1][0]);
    north = Math.max(north, box[1][1]);
  }
  return west === Infinity ? null : [[west, south], [east, north]];
}

/** The middle of `bounds` as `[lng, lat]`, or `null` when it is not a box. */
export function boundsCenter(bounds) {
  if (!isBounds(bounds)) return null;
  return [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
}

/** Whether `[lng, lat]` lies inside `bounds` (edges included). */
export function isInBounds(point, bounds) {
  if (!Array.isArray(point) || !isBounds(bounds)) return false;
  const [lng, lat] = point;
  return lng >= bounds[0][0] && lng <= bounds[1][0] && lat >= bounds[0][1] && lat <= bounds[1][1];
}

// Stands reach the map in two shapes: the reference catalogue ({ id, terminal, lat, lon }) and the positions of a
// screen ({ id | code, terminal | terminalCode, latitude, longitude, status }).

/** The point of a stand or a flight as `[lng, lat]`, or `null` when it has no finite coordinates. */
export function lngLatOf(item) {
  const lng = item?.longitude ?? item?.lon;
  const lat = item?.latitude ?? item?.lat;
  return isCoordinate(lng) && isCoordinate(lat) ? [lng, lat] : null;
}

export const standCodeOf = stand => String(stand?.code ?? stand?.id ?? '');
export const standTerminalOf = stand => stand?.terminal ?? stand?.terminalCode ?? null;
export const isRetired = stand => stand?.retired === true;

/** The stands that are drawn inside `bounds`: retired stands are never drawn, and no bounds means every stand. */
export function standsInView(stands = [], bounds = null) {
  return (stands ?? []).filter(stand => stand != null && !isRetired(stand)
    && (bounds === null || isInBounds(lngLatOf(stand), bounds)));
}

/** The bounds of the non-retired stand points (of one terminal when given) plus 120 m, or `null` with no point. */
export function standBounds(stands = [], { terminal } = {}) {
  const points = (stands ?? [])
    .filter(stand => !isRetired(stand) && (terminal == null || standTerminalOf(stand) === terminal))
    .map(lngLatOf)
    .filter(Boolean);
  if (points.length === 0) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return padBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], STAND_MARGIN_M);
}

/**
 * The airport box plus 300 m. Until PR M3 brings layout.meta.bbox it is the union of a 1.5 NM ring around the ARP
 * and the stand bounds.
 */
export function airfieldBounds(stands = []) {
  return padBounds(unionBounds(ringBounds(PUJ_ARP, AIRFIELD_RADIUS_NM), standBounds(stands)), AIRFIELD_MARGIN_M);
}

const northUp = bounds => ({ bounds, pitch: 0, bearing: 0 });

/**
 * What each view frames, 2D and north-up: `{ region, approach, airfield, ramp, terminals: { A, B, FBO } }`, each
 * `{ bounds, pitch: 0, bearing: 0 }`. A terminal without a located stand is `null` and falls back to the ramp.
 */
export function presetTargets({ stands = [] } = {}) {
  const ramp = standBounds(stands) ?? padBounds(ringBounds(PUJ_ARP, RAMP_FALLBACK_RADIUS_NM), STAND_MARGIN_M);
  return {
    region: northUp(ringBounds(PUJ_ARP, REGION_RADIUS_NM)),
    approach: northUp(ringBounds(PUJ_ARP, APPROACH_RADIUS_NM)),
    airfield: northUp(airfieldBounds(stands)),
    ramp: northUp(ramp),
    terminals: Object.fromEntries(TERMINALS.map(code => {
      const bounds = standBounds(stands, { terminal: code });
      return [code, bounds && northUp(bounds)];
    })),
  };
}

/** The target of a view, the terminal preset when `view` is `ramp` and the terminal has stands. */
export function targetFor(targets, view, terminal = null) {
  if (!targets || !VIEW_NAMES.includes(view)) return null;
  if (view === 'ramp' && terminal != null) return targets.terminals?.[terminal] ?? targets.ramp;
  return targets[view];
}

/**
 * The zoom at which each view fits the screen: `{ region, approach, airfield, ramp }`, or `null` while any of them
 * cannot be fitted. `cameraForBounds(bounds, { bearing })` is the map's (the caller adds the padding).
 */
export function fitZooms(cameraForBounds, targets) {
  if (typeof cameraForBounds !== 'function' || !targets) return null;
  const fits = {};
  for (const view of VIEW_NAMES) {
    const target = targets[view];
    const zoom = target?.bounds ? cameraForBounds(target.bounds, { bearing: target.bearing ?? 0 })?.zoom : undefined;
    if (!Number.isFinite(zoom)) return null;
    fits[view] = zoom;
  }
  return fits;
}

/** Whether two results of fitZooms are the same. */
export function sameFits(first, second) {
  if (first === second) return true;
  if (!first || !second) return false;
  return VIEW_NAMES.every(view => Math.abs(first[view] - second[view]) < 1e-9);
}

/**
 * The zoom thresholds named in layer metadata: stand polygons from the airfield fit − 0.3, codes from the ramp fit
 * − 0.3, three-line labels from the ramp fit + 0.8. `null` before the fit.
 */
export function thresholdsFromFits(fits) {
  if (!Number.isFinite(fits?.airfield) || !Number.isFinite(fits?.ramp)) return null;
  return {
    polygons: fits.airfield + THRESHOLD_OFFSET.polygons,
    codes: fits.ramp + THRESHOLD_OFFSET.codes,
    threeLine: fits.ramp + THRESHOLD_OFFSET.threeLine,
  };
}

/**
 * The view the camera really shows at `zoom`: each boundary lies half way between two consecutive fitted zooms, so
 * the view selector stays truthful when the user zooms freely. `null` before the fit.
 */
export function presetForZoom(zoom, fits) {
  if (!Number.isFinite(zoom) || !fits) return null;
  const zooms = VIEW_NAMES.map(view => fits[view]);
  if (!zooms.every(Number.isFinite)) return null;
  for (let index = 0; index < VIEW_NAMES.length - 1; index += 1) {
    if (zoom < (zooms[index] + zooms[index + 1]) / 2) return VIEW_NAMES[index];
  }
  return VIEW_NAMES[VIEW_NAMES.length - 1];
}

/**
 * How the camera travels between two zooms: `flyTo` with curve 1.42 above 2.5 zoom steps, `easeTo` below, both with
 * an explicit duration of clamp(600 + 220 × |Δzoom|, 600, 2600) ms. There is no maxDuration (MapLibre turns an
 * over-long flight into a jump) and `essential` is false, so MapLibre makes the move instant under reduced motion.
 */
export function transitionFor(fromZoom, toZoom) {
  const steps = Number.isFinite(fromZoom) && Number.isFinite(toZoom) ? Math.abs(toZoom - fromZoom) : 0;
  const duration = Math.round(Math.min(Math.max(DURATION_BASE_MS + DURATION_PER_ZOOM_MS * steps, DURATION_MIN_MS),
    DURATION_MAX_MS));
  return steps > FLY_ABOVE_ZOOM_STEPS
    ? { method: 'flyTo', duration, curve: FLY_CURVE, essential: false }
    : { method: 'easeTo', duration, essential: false };
}

/** Pitch and bearing of a view: the 3D tilt of airfield and ramp when the mode is 3D, flat and north-up otherwise. */
export function cameraAngles(view, pitchMode) {
  const tilt = pitchMode === '3d' && Object.hasOwn(CAMERA_3D, view) ? CAMERA_3D[view] : null;
  return tilt ? { ...tilt } : { pitch: 0, bearing: 0 };
}

/** The view Monitoreo opens on: `approach` when the linked flight has a position within 40 NM of the ARP. */
export function defaultFlightView(flight) {
  const point = lngLatOf(flight?.position ?? flight);
  return point !== null && distanceNm(point, PUJ_ARP) <= APPROACH_RADIUS_NM ? 'approach' : 'region';
}
