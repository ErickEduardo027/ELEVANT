import { haversineM, measurePolyline, nearestOnPolyline, pointAlong, polylineLengthM } from './geo.js';

// The runway ends of an airport layout and the runway in use (PR M6, contracts 2.3 and owner decision 19). The map
// alone decides it, from what it knows, in this order: a runway the flight carries (a demo flight always uses the
// layout's preferred runway, 08 at Punta Cana, so every screen agrees), then the recent live arrivals aligned with a
// runway, then the head wind of the METAR, then `layout.operations.preferred`. Bearings are degrees true, wind speeds
// m/s, distances metres. Pure and Node-safe like geo.js: it imports only './geo.js', never JSON; the layout always
// arrives as a parameter.

/** A live arrival votes for the runway end whose heading is within this of its track. */
export const ALIGNED_DEG = 10;
/** Wind below this speed is calm and says nothing about the runway. */
export const CALM_WIND_MS = 1.5;
// Runways whose axes differ by less than this are one family of parallel runways (08/26 and 09/27 at Punta Cana).
const FAMILY_DEG = 30;

const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const axisBetween = (a, b) => Math.min(angleBetween(a, b), angleBetween(a, b + 180));
const freezePoint = point => Object.freeze([point[0], point[1]]);
const endsCache = new WeakMap();

/**
 * The centreline from `threshold` to `oppositeThreshold`: the layout's centreline oriented that way, its ends replaced
 * by the two thresholds and the vertices beyond them dropped, so distances along it start at the threshold.
 */
function orientedCenterline(line, threshold, oppositeThreshold) {
  const points = Array.isArray(line) && line.length >= 2 ? [...line] : [threshold, oppositeThreshold];
  if (haversineM(points[0], threshold) > haversineM(points[points.length - 1], threshold)) points.reverse();
  const measured = measurePolyline(points);
  const from = nearestOnPolyline(measured, threshold).alongM;
  const to = nearestOnPolyline(measured, oppositeThreshold).alongM;
  const inner = measured.coords.filter((_, at) => measured.cumM[at] > from + 0.01 && measured.cumM[at] < to - 0.01);
  return Object.freeze([threshold, ...inner, oppositeThreshold].map(freezePoint));
}

/**
 * Every runway end of the layout, in layout order: `[{ ident, runwayId, threshold, headingTrue, elevationFt,
 * oppositeThreshold, centerline, lengthM }]`, frozen and cached per layout. `centerline` runs from this threshold to
 * the opposite one; `lengthM` is its length.
 */
export function runwayEnds(layout) {
  if (layout === null || typeof layout !== 'object') return Object.freeze([]);
  const cached = endsCache.get(layout);
  if (cached) return cached;
  const ends = [];
  for (const runway of layout.runways ?? []) {
    const [first, second] = runway.ends ?? [];
    if (!first || !second) continue;
    for (const [end, opposite] of [[first, second], [second, first]]) {
      const centerline = orientedCenterline(runway.centerline, end.threshold, opposite.threshold);
      ends.push(Object.freeze({
        ident: end.ident,
        runwayId: runway.id,
        threshold: freezePoint(end.threshold),
        headingTrue: end.headingTrue,
        elevationFt: Number.isFinite(end.elevationFt) ? end.elevationFt : (layout.meta?.elevationFt ?? 0),
        oppositeThreshold: freezePoint(opposite.threshold),
        centerline,
        lengthM: polylineLengthM(centerline),
      }));
    }
  }
  const result = Object.freeze(ends);
  endsCache.set(layout, result);
  return result;
}

/** «08», «8» and «RWY 08» name the same end; anything else is compared as written, in upper case. */
function normalizeIdent(ident) {
  const text = String(ident ?? '').trim().toUpperCase().replace(/^RWY\s*/u, '');
  return /^\d[LRC]?$/u.test(text) ? `0${text}` : text;
}

/** The runway end called `ident` («08», «8» or «RWY 08»), or `null` when the layout has none. */
export function runwayEnd(layout, ident) {
  const wanted = normalizeIdent(ident);
  if (wanted === '') return null;
  return runwayEnds(layout).find(end => normalizeIdent(end.ident) === wanted) ?? null;
}

/**
 * The runway of a demo flight: `layout.operations.preferred` as `{ arrival, departure }`, frozen (08 and 08 at Punta
 * Cana, owner decision 19). Without one, the first runway end of the layout for both; `null` for a layout without
 * runways.
 */
export function demoRunway(layout) {
  const preferred = layout?.operations?.preferred;
  const arrival = runwayEnd(layout, preferred?.arrival);
  const departure = runwayEnd(layout, preferred?.departure);
  const first = runwayEnds(layout)[0] ?? null;
  if (!arrival && !departure && !first) return null;
  return Object.freeze({ arrival: (arrival ?? departure ?? first).ident, departure: (departure ?? arrival ?? first).ident });
}

/** The end of `preferredEnd`'s runway that flows the way `flowEnd` does, when both runways are one family. */
function inFlowOf(layout, preferredEnd, flowEnd) {
  if (!preferredEnd || axisBetween(preferredEnd.headingTrue, flowEnd.headingTrue) >= FAMILY_DEG) return flowEnd.ident;
  const same = runwayEnds(layout)
    .filter(end => end.runwayId === preferredEnd.runwayId)
    .sort((a, b) => angleBetween(a.headingTrue, flowEnd.headingTrue) - angleBetween(b.headingTrue, flowEnd.headingTrue));
  return same[0]?.ident ?? flowEnd.ident;
}

/** Among tied ends: the preferred one, else one flowing the way it does, else the first in layout order. */
function breakTie(tied, preferredEnd) {
  if (!preferredEnd) return tied[0];
  return tied.find(end => end.ident === preferredEnd.ident)
    ?? tied.find(end => angleBetween(end.headingTrue, preferredEnd.headingTrue) < 90)
    ?? tied[0];
}

/** A known runway the flight carries, as `{ arrival, departure }`, or `null`. */
function carriedRunway(layout, flightRunway) {
  if (flightRunway === null || flightRunway === undefined) return null;
  const wanted = typeof flightRunway === 'object' ? flightRunway : { arrival: flightRunway, departure: flightRunway };
  const arrival = runwayEnd(layout, wanted.arrival);
  const departure = runwayEnd(layout, wanted.departure);
  if (!arrival && !departure) return null;
  return { arrival: (arrival ?? departure).ident, departure: (departure ?? arrival).ident };
}

/**
 * The runway in use on the map: `{ arrival, departure, source: 'flight' | 'live' | 'wind' | 'default' }`, frozen.
 * 1. `flightRunway` («08» or `{ arrival, departure }`) wins when the layout knows it: a demo flight passes
 *    `demoRunway(layout)`.
 * 2. `recentLiveArrivals` (`[{ trackDeg }]`, the caller keeps only recent arrivals on final): each votes for the
 *    nearest end within 10° of its track; the most voted end lands, a tie goes to the preferred arrival.
 * 3. `wind` (`{ directionDeg, speedMs }`, where it blows from): calm (under 1.5 m/s), variable (no direction) or none
 *    says nothing; otherwise the end with the largest head wind (above 0) sets the flow.
 * 4. `layout.operations.preferred`.
 * Live arrivals and wind set the direction of the flow: within a family of parallel runways the preferred runway
 * keeps the traffic, so a westerly wind lands and departs on 26 at Punta Cana, and arrivals seen on 27 depart on 26.
 */
export function runwayInUse({ wind = null, recentLiveArrivals = [], layout, flightRunway = null } = {}) {
  const answer = (arrival, departure, source) => Object.freeze({ arrival, departure, source });
  const ends = runwayEnds(layout);
  const preferred = demoRunway(layout);
  const preferredArrival = runwayEnd(layout, preferred?.arrival);
  const preferredDeparture = runwayEnd(layout, preferred?.departure);

  const carried = carriedRunway(layout, flightRunway);
  if (carried) return answer(carried.arrival, carried.departure, 'flight');

  const votes = new Map();
  for (const arrival of Array.isArray(recentLiveArrivals) ? recentLiveArrivals : []) {
    const track = Number(arrival?.trackDeg);
    if (arrival?.trackDeg === null || !Number.isFinite(track)) continue;
    let best = null;
    for (const end of ends) {
      const off = angleBetween(track, end.headingTrue);
      if (off <= ALIGNED_DEG && (best === null || off < best.off)) best = { end, off };
    }
    if (best) votes.set(best.end, (votes.get(best.end) ?? 0) + 1);
  }
  if (votes.size > 0) {
    const most = Math.max(...votes.values());
    const landing = breakTie(ends.filter(end => votes.get(end) === most), preferredArrival);
    return answer(landing.ident, inFlowOf(layout, preferredDeparture, landing), 'live');
  }

  const direction = Number(wind?.directionDeg);
  const speed = Number(wind?.speedMs);
  if (wind && wind.directionDeg !== null && Number.isFinite(direction) && Number.isFinite(speed) && speed >= CALM_WIND_MS) {
    let most = 0;
    let tied = [];
    for (const end of ends) {
      const head = speed * Math.cos(((direction - end.headingTrue) * Math.PI) / 180);
      if (head > most + 1e-9) {
        most = head;
        tied = [end];
      } else if (head > 0 && Math.abs(head - most) <= 1e-9) {
        tied.push(end);
      }
    }
    if (tied.length > 0) {
      const flow = breakTie(tied, preferredArrival);
      return answer(inFlowOf(layout, preferredArrival, flow), inFlowOf(layout, preferredDeparture, flow), 'wind');
    }
  }

  if (!preferred) return answer(null, null, 'default');
  return answer(preferred.arrival, preferred.departure, 'default');
}

/** The ids of the runways a `runwayInUse` result lands and departs on, without repeats (for the taxi costs). */
export function runwayIdsInUse(layout, { arrival, departure } = {}) {
  const ids = [runwayEnd(layout, arrival)?.runwayId, runwayEnd(layout, departure)?.runwayId].filter(Boolean);
  return Object.freeze([...new Set(ids)]);
}

/**
 * The centreline of a runway end between two distances along it from its threshold (clamped to the runway), as
 * `[[lng, lat], …]`, frozen: the two cut points and the centreline's vertices between them.
 */
export function centrelineBetween(end, fromAlongM, toAlongM) {
  const centreline = measurePolyline(end.centerline);
  const from = Math.max(0, Math.min(centreline.lengthM, fromAlongM));
  const to = Math.max(from, Math.min(centreline.lengthM, toAlongM));
  const points = [pointAlong(centreline, from).p];
  centreline.coords.forEach((point, at) => {
    if (centreline.cumM[at] > from + 0.01 && centreline.cumM[at] < to - 0.01) points.push(point);
  });
  points.push(pointAlong(centreline, to).p);
  return Object.freeze(points);
}
