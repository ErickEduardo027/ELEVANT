// Units of the map kinematics (PR M6). Every kinematic module works in SI inside: metres, metres per second,
// milliseconds and degrees true. Knots, feet and nautical miles appear only in labels and at the API mapper, and they
// convert through these constants, so a nautical mile here is the same 1 852 m that airport/geo.js uses.
// Pure and dependency-free: explicit '.js' imports only, no clock, no JSON.

/** Metres in one international nautical mile. */
export const NM = 1852;
/** Metres per second in one knot (one nautical mile per hour). */
export const KT = NM / 3600;
/** Metres in one international foot. */
export const FT = 0.3048;
/** Metres per second in one foot per minute. */
export const FPM = FT / 60;
/** Standard gravity in m/s². */
export const G0 = 9.80665;

/** Knots → m/s. */
export const ktToMs = knots => knots * KT;
/** m/s → knots. */
export const msToKt = metresPerSecond => metresPerSecond / KT;
/** Feet → metres. */
export const ftToM = feet => feet * FT;
/** Metres → feet. */
export const mToFt = metres => metres / FT;
/** Nautical miles → metres. */
export const nmToM = nauticalMiles => nauticalMiles * NM;
/** Metres → nautical miles. */
export const mToNm = metres => metres / NM;
/** Feet per minute → m/s. */
export const fpmToMs = feetPerMinute => feetPerMinute * FPM;
/** m/s → feet per minute. */
export const msToFpm = metresPerSecond => metresPerSecond / FPM;
/** Degrees → radians. */
export const degToRad = degrees => (degrees * Math.PI) / 180;
/** Radians → degrees. */
export const radToDeg = radians => (radians * 180) / Math.PI;

/** A bearing in degrees wrapped into [0, 360), never negative zero. */
export function normalizeDeg(degrees) {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped === 0 ? 0 : wrapped;
}
