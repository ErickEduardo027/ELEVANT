import { NM, fpmToMs, ftToM, ktToMs } from './units.js';

// Performance numbers of the map kinematics by aircraft category (PR M6, design F2): the speeds, heights, rates and
// waits a trajectory is built from before it is fitted to its instants. The narrow-body values are the design's; the
// other categories change only the numbers the design gives for them and scale the rest by the same ratios. SI units:
// m/s, m, m/s², s and degrees. Pure data and two lookups: explicit '.js' imports, no clock, no JSON.

/** The four categories, the narrow-body first. */
export const PERF_CATEGORIES = Object.freeze(['narrow', 'wide', 'regional', 'turboprop']);

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// The narrow-body as the design gives it (A320, B737). The other categories derive from it through `profileFor`.
const NARROW = {
  cruiseKt: 450, cruiseFt: 36_000, vrefKt: 137, liftoffKt: 148, takeoffAccelMs2: 2.2, climbFpm: 2_500,
};
const VARIANTS = {
  narrow: NARROW,
  wide: { ...NARROW, vrefKt: 145, liftoffKt: 165, takeoffAccelMs2: 1.9, climbFpm: 2_000, cruiseKt: 490 },
  regional: { ...NARROW, vrefKt: 130, liftoffKt: 140, cruiseKt: 420 },
  turboprop: { ...NARROW, cruiseKt: 275, cruiseFt: 25_000, vrefKt: 110, liftoffKt: 115, climbFpm: 1_500 },
};

/**
 * One category's profile. The approach and the start of the final scale with the reference speed (180 kt for a
 * 137 kt narrow-body), the start of the climb with the lift-off speed (160 for 148), and the descent and the end of
 * the climb with the cruise (290 kt and 270 kt for 450); below FL100 the descent never exceeds 250 kt.
 */
function profileFor({ cruiseKt, cruiseFt, vrefKt, liftoffKt, takeoffAccelMs2, climbFpm }) {
  const approachKt = (vrefKt * 180) / 137;
  const descentHighKt = (cruiseKt * 290) / 450;
  return {
    cruise: { speedMs: ktToMs(cruiseKt), altM: ftToM(cruiseFt) },
    descent: {
      highSpeedMs: ktToMs(descentHighKt),
      lowSpeedMs: ktToMs(Math.min(250, descentHighKt)),
      transitionAltM: ftToM(10_000),
      // Metres flown per metre of height lost: 3 NM per 1 000 ft.
      ratio: (3 * NM) / ftToM(1_000),
    },
    approach: { speedMs: ktToMs(approachKt) },
    final: { startSpeedMs: ktToMs(approachKt), vrefMs: ktToMs(vrefKt), glideDeg: 3, thresholdCrossM: ftToM(50) },
    landing: {
      touchdownAlongM: 300,
      brakingMs2: 1.8,
      brakingMinMs2: 1.2,
      brakingMaxMs2: 2.5,
      exitSpeedMs: 15,
    },
    taxi: {
      straightMs: ktToMs(16),
      turnMs: ktToMs(9),
      leadInMs: ktToMs(5),
      minMs: ktToMs(5),
      maxMs: ktToMs(25),
      accelMs2: 0.5,
      decelMs2: 0.8,
    },
    pushback: { speedMs: 1.5, minSpeedMs: 0.5, maxSpeedMs: 2, accelMs2: 0.3, engineStartS: 60 },
    takeoff: { holdShortS: 20, lineUpMs: ktToMs(10), accelMs2: takeoffAccelMs2, liftoffMs: ktToMs(liftoffKt) },
    climb: {
      rateMs: fpmToMs(climbFpm),
      startSpeedMs: ktToMs((liftoffKt * 160) / 148),
      endSpeedMs: ktToMs((cruiseKt * 270) / 450),
      turnAltM: ftToM(1_500),
      maxDistanceM: 250 * NM,
      bankDeg: 25,
    },
  };
}

/** The profile of each category in SI units, frozen: `{ narrow, wide, regional, turboprop }`. */
export const PERF_PROFILES = deepFreeze(Object.fromEntries(
  PERF_CATEGORIES.map(category => [category, profileFor(VARIANTS[category])]),
));

// The ICAO types the map tells apart; any other type falls back on its size category.
const TYPE_CATEGORIES = Object.freeze({
  A20N: 'narrow', A320: 'narrow', A321: 'narrow', B738: 'narrow', B38M: 'narrow', B739: 'narrow',
  E190: 'regional', E195: 'regional', CRJ9: 'regional',
  AT76: 'turboprop', AT72: 'turboprop', DH8D: 'turboprop',
  B77W: 'wide', B789: 'wide', A333: 'wide', A359: 'wide',
});

const WITH_CATEGORY = Object.freeze(Object.fromEntries(
  PERF_CATEGORIES.map(category => [category, Object.freeze({ category, ...PERF_PROFILES[category] })]),
));

/**
 * The profile for an aircraft, frozen: `{ category, ...profile }`. By its ICAO type (`typeIcao` or `typeIcaoCode`,
 * any case), then by its size category (`'Widebody'` is a wide-body), else a narrow-body.
 */
export function perfFor({ typeIcao = null, typeIcaoCode = null, sizeCategory = null } = {}) {
  const type = String(typeIcao ?? typeIcaoCode ?? '').trim().toUpperCase();
  return WITH_CATEGORY[TYPE_CATEGORIES[type] ?? (sizeCategory === 'Widebody' ? 'wide' : 'narrow')];
}
