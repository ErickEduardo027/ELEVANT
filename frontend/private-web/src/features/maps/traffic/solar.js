// Where the sun is (design J, Decision J-1: an own module instead of SunCalc), for the light of the 3D aircraft and,
// in PR M8, the day and night shade. The low-precision formulas of the Astronomical Almanac (section C, «Low
// precision formulas for the Sun»), good to about 0.01° between 1950 and 2050. Pure: the instant is a parameter, in
// epoch milliseconds of the server's clock (services/serverClock.js), and nothing here reads a clock.
//
// Angles are degrees. Azimuths are true, clockwise from north. Elevations are geometric: from the centre of the sun,
// without refraction, so the sun is at 0° when its centre crosses the horizon.

const DAY_MS = 86_400_000;
// The Julian date of the Unix epoch, and J2000.0 (2000 January 1, 12:00), the origin of the formulas.
const UNIX_EPOCH_JD = 2_440_587.5;
const J2000_JD = 2_451_545;

/** The sun's elevation where the civil twilight ends: below it, it is night. */
export const CIVIL_TWILIGHT_DEG = -6;

const toRadians = degrees => (degrees * Math.PI) / 180;
const toDegrees = radians => (radians * 180) / Math.PI;
const turn = degrees => ((degrees % 360) + 360) % 360;
const halfTurn = degrees => turn(degrees + 180) - 180;

function assertInstant(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    throw new RangeError(`An instant in epoch milliseconds is needed, got ${String(ms)}`);
  }
}

/**
 * The sun at an instant (`ms`, epoch milliseconds): `{ eclipticLongitudeDeg, declinationDeg, rightAscensionDeg,
 * gmstDeg, equationOfTimeMin }`. The longitude, the right ascension and the Greenwich mean sidereal time are within
 * [0, 360); the declination within [−23.44, 23.44]; the equation of time is apparent minus mean solar time, in
 * minutes (positive when a sundial runs ahead of the clock, as in November).
 */
export function solarCoordinates(ms) {
  assertInstant(ms);
  // Days from J2000.0. The formulas want Universal Time; the instants are UTC, under a second away from it.
  const n = ms / DAY_MS + UNIX_EPOCH_JD - J2000_JD;
  // The mean longitude (aberration included) and the mean anomaly.
  const meanLongitude = turn(280.46 + 0.9856474 * n);
  const meanAnomaly = toRadians(turn(357.528 + 0.9856003 * n));
  // The ecliptic longitude (the latitude is 0 at this precision) and the obliquity of the ecliptic.
  const longitude = turn(meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly));
  const obliquity = toRadians(23.439 - 0.0000004 * n);
  const lambda = toRadians(longitude);
  const rightAscension = turn(toDegrees(Math.atan2(Math.cos(obliquity) * Math.sin(lambda), Math.cos(lambda))));
  const declination = toDegrees(Math.asin(Math.sin(obliquity) * Math.sin(lambda)));
  // The Greenwich mean sidereal time, from the same day count (the century terms are below 0.0001° until 2050).
  const gmst = turn(280.46061837 + 360.98564736629 * n);
  return {
    eclipticLongitudeDeg: longitude,
    declinationDeg: declination,
    rightAscensionDeg: rightAscension,
    gmstDeg: gmst,
    // Four minutes of time per degree between the mean sun and the true one.
    equationOfTimeMin: 4 * halfTurn(meanLongitude - rightAscension),
  };
}

/** The point of the Earth with the sun at its zenith at `ms`: `[lng, lat]`, the longitude within [−180, 180). */
export function subsolarPoint(ms) {
  const { declinationDeg, rightAscensionDeg, gmstDeg } = solarCoordinates(ms);
  return [halfTurn(rightAscensionDeg - gmstDeg), declinationDeg];
}

/**
 * Where an observer at `[lng, lat]` sees the sun at `ms`: `{ azimuthDeg, elevationDeg }`, the azimuth within [0, 360)
 * clockwise from north and the elevation geometric (no refraction), within [−90, 90].
 */
export function sunPosition(ms, [lng, lat]) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new RangeError('An observer needs a finite [lng, lat]');
  const { declinationDeg, rightAscensionDeg, gmstDeg } = solarCoordinates(ms);
  const hourAngle = toRadians(gmstDeg + lng - rightAscensionDeg);
  const phi = toRadians(lat);
  const delta = toRadians(declinationDeg);
  // The direction of the sun in the observer's east, north and up.
  const east = -Math.cos(delta) * Math.sin(hourAngle);
  const north = Math.sin(delta) * Math.cos(phi) - Math.cos(delta) * Math.sin(phi) * Math.cos(hourAngle);
  const up = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle);
  return {
    azimuthDeg: turn(toDegrees(Math.atan2(east, north))),
    elevationDeg: toDegrees(Math.asin(Math.max(-1, Math.min(1, up)))),
  };
}

/**
 * The part of the day an elevation belongs to: `'day'` with the sun's centre on or above the horizon, `'twilight'`
 * down to the end of the civil twilight (−6°), `'night'` below it.
 */
export function dayPhase(elevationDeg) {
  if (typeof elevationDeg !== 'number' || Number.isNaN(elevationDeg)) {
    throw new RangeError(`An elevation is needed, got ${String(elevationDeg)}`);
  }
  if (elevationDeg >= 0) return 'day';
  return elevationDeg >= CIVIL_TWILIGHT_DEG ? 'twilight' : 'night';
}

/**
 * The sun's elevation at sunrise and sunset as almanacs publish them: the upper limb on the horizon with the standard
 * refraction (34′ plus the 16′ semi-diameter), not the geometric 0° of dayPhase.
 */
export const SUNRISE_DEG = -0.833;

// The step of the search for the crossings, and how close the bisection gets to each one.
const SEARCH_STEP_MS = 10 * 60_000;
const SEARCH_PRECISION_MS = 15_000;

// The instant within (from, to] where the elevation crosses `threshold`, by bisection.
function crossing(from, to, observer, threshold) {
  let low = from;
  let high = to;
  const above = at => sunPosition(at, observer).elevationDeg >= threshold;
  const lowAbove = above(low);
  while (high - low > SEARCH_PRECISION_MS) {
    const middle = (low + high) / 2;
    if (above(middle) === lowAbove) low = middle;
    else high = middle;
  }
  return Math.round((low + high) / 2);
}

/**
 * The sun's day at an observer (`[lng, lat]`) around `ms` (epoch milliseconds of the server's clock), for the weather
 * panel (M7, 2026-11-27): `{ dawn, sunrise, sunset, dusk }`, frozen, each in epoch milliseconds, within the observer's
 * mean solar day that holds `ms` (from its local mean midnight, 4 h 33 min UTC at Punta Cana). `dawn` and `dusk` are
 * the start and the end of the civil twilight (CIVIL_TWILIGHT_DEG), `sunrise` and `sunset` the crossings of
 * SUNRISE_DEG, to within about a minute. An event the day does not have (a polar day or night) is null.
 */
export function sunTimes(ms, observer) {
  assertInstant(ms);
  const [lng, lat] = Array.isArray(observer) ? observer : [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new RangeError('An observer needs a finite [lng, lat]');
  const offsetMs = (lng / 360) * DAY_MS;
  const start = Math.floor((ms + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
  const events = { dawn: null, sunrise: null, sunset: null, dusk: null };
  const thresholds = [[CIVIL_TWILIGHT_DEG, 'dawn', 'dusk'], [SUNRISE_DEG, 'sunrise', 'sunset']];
  let previous = start;
  let previousElevation = sunPosition(previous, [lng, lat]).elevationDeg;
  for (let at = start + SEARCH_STEP_MS; at <= start + DAY_MS; at += SEARCH_STEP_MS) {
    const elevation = sunPosition(at, [lng, lat]).elevationDeg;
    for (const [threshold, rising, setting] of thresholds) {
      const wasAbove = previousElevation >= threshold;
      const isAbove = elevation >= threshold;
      if (wasAbove === isAbove) continue;
      const key = isAbove ? rising : setting;
      if (events[key] === null) events[key] = crossing(previous, at, [lng, lat], threshold);
    }
    previous = at;
    previousElevation = elevation;
  }
  return Object.freeze(events);
}
