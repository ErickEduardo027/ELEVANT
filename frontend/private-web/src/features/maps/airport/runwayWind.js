import { degToRad, ktToMs } from '../kinematics/units.js';
import { runwayEnds } from './runwayInUse.js';

// The wind of the METAR along and across each runway end (PR M8), for the map's wind readout and the runway in use.
// The METAR gives the wind in degrees true, where it blows from, and in knots; the layout gives each runway end's
// heading in degrees true too, so the two compare without a magnetic variation. Pure and Node-safe like runwayInUse.js:
// explicit '.js' imports, no clock and no JSON; the layout always arrives as a parameter.

const isNumber = value => typeof value === 'number' && Number.isFinite(value);
// A runway designator: 01 to 36 and an optional L, C or R.
const DESIGNATOR = /^(?:0[1-9]|[12]\d|3[0-6])[LCR]?$/u;

/** Whole knots, half away from zero, never −0. */
function wholeKnots(value) {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded;
}

/**
 * The wind on a runway: `{ headwindKt, crosswindKt, side }`, frozen, in whole knots. `headwindKt` is the part along the
 * runway, negative for a tail wind; `crosswindKt` the part across it, never negative, and `side` where it comes from
 * seen from the cockpit (`right` or `left`, null when there is none). Null unless the wind's direction (where it blows
 * from, degrees true), its speed (knots, not negative) and the runway's heading (degrees true) are finite numbers.
 */
export function windComponents(windFromDeg, windKt, runwayHeadingDeg) {
  if (!isNumber(windFromDeg) || !isNumber(windKt) || windKt < 0 || !isNumber(runwayHeadingDeg)) return null;
  const angle = degToRad(windFromDeg - runwayHeadingDeg);
  const across = windKt * Math.sin(angle);
  const crosswindKt = wholeKnots(Math.abs(across));
  return Object.freeze({
    headwindKt: wholeKnots(windKt * Math.cos(angle)),
    crosswindKt,
    side: crosswindKt === 0 ? null : (across > 0 ? 'right' : 'left'),
  });
}

/** «R08» for the runway end «08», «8», «RWY 08» or «R08»; null for an empty or unknown designator. */
export function runwayLabel(ident) {
  const text = String(ident ?? '').trim().toUpperCase().replace(/^RWY\s*/u, '').replace(/^R(?=\d)/u, '');
  const designator = /^\d[LCR]?$/u.test(text) ? `0${text}` : text;
  return DESIGNATOR.test(designator) ? `R${designator}` : null;
}

/** A wind that blows from somewhere: a direction, a speed above zero and not variable. */
const blowsFrom = wind => Boolean(wind) && wind.variable !== true && isNumber(wind.directionDeg)
  && isNumber(wind.speedKt) && wind.speedKt > 0;

/** A gust worth its own components: a finite speed above the mean wind's. */
const gustOf = wind => (isNumber(wind.gustKt) && wind.gustKt > wind.speedKt ? wind.gustKt : null);

/**
 * The wind on every runway end of the layout, in layout order (08, 26, 09 and 27 at Punta Cana): `[{ ident, label,
 * headwindKt, crosswindKt, side }]`, frozen. `wind` is the METAR's (`{ directionDeg, speedKt, gustKt, variable }`, as
 * features/weather/metar.js reads it); calm, variable or no wind gives an empty list. A gust above the mean speed (M7,
 * 2026-11-27) adds `gust`: the same `{ headwindKt, crosswindKt, side }` at the gust's speed and the same direction, so
 * the weather panel shows the strongest cross and tail wind a crew can meet; without a gust the key is absent.
 */
export function runwayWinds(layout, wind) {
  if (!blowsFrom(wind)) return Object.freeze([]);
  const gustKt = gustOf(wind);
  return Object.freeze(runwayEnds(layout).flatMap(end => {
    const components = windComponents(wind.directionDeg, wind.speedKt, end.headingTrue);
    if (!components) return [];
    const gust = gustKt === null ? null : windComponents(wind.directionDeg, gustKt, end.headingTrue);
    return [Object.freeze({ ident: end.ident, label: runwayLabel(end.ident), ...components, ...(gust ? { gust } : {}) })];
  }));
}

/**
 * The METAR's wind as runwayInUse takes it (`{ directionDeg, speedMs }`, frozen: where it blows from, in degrees true,
 * and its speed in metres per second); null for calm, variable or no wind, which say nothing about the runway.
 */
export function metarWindForRunway(metarWind) {
  if (!blowsFrom(metarWind)) return null;
  return Object.freeze({ directionDeg: metarWind.directionDeg, speedMs: ktToMs(metarWind.speedKt) });
}
