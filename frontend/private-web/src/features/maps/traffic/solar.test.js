import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { CIVIL_TWILIGHT_DEG, dayPhase, solarCoordinates, subsolarPoint, sunPosition } from './solar';

// Decision J-1: the sun from the Astronomical Almanac's low-precision formulas, checked against published instants
// within 0.05°. Instants are epoch milliseconds, as the server's clock gives them.
const TOLERANCE_DEG = 0.05;
const MDPC = MDPC_LAYOUT.meta.arp;
const at = iso => Date.parse(iso);

// The smallest angle between two directions, in degrees.
const angleGap = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

// The angle at the Earth's centre between two `[lng, lat]` points, in degrees.
function centralAngleDeg([lng1, lat1], [lng2, lat2]) {
  const toRadians = degrees => (degrees * Math.PI) / 180;
  const cosine = Math.sin(toRadians(lat1)) * Math.sin(toRadians(lat2))
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(toRadians(lng2 - lng1));
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

// The instant of local apparent noon at `point` near `ms`: where the sun's hour angle is zero.
function solarNoon(ms, [lng]) {
  let t = ms;
  for (let step = 0; step < 4; step += 1) {
    const { gmstDeg, rightAscensionDeg } = solarCoordinates(t);
    const hourAngle = ((((gmstDeg + lng - rightAscensionDeg) % 360) + 540) % 360) - 180;
    t -= (hourAngle / 360.98564736629) * 86_400_000;
  }
  return t;
}

describe('the sun (design J, Decision J-1)', () => {
  it('the sun crosses the 2026 equinoxes and solstices at the instants the USNO publishes', () => {
    // USNO, «Earth's Seasons and Apsides», 2026 (UTC).
    const seasons = [
      ['2026-03-20T14:46:00Z', 0, 0],
      ['2026-06-21T08:24:00Z', 90, 23.436],
      ['2026-09-23T00:05:00Z', 180, 0],
      ['2026-12-21T20:50:00Z', 270, -23.436],
    ];
    for (const [instant, longitude, declination] of seasons) {
      const sun = solarCoordinates(at(instant));
      expect(angleGap(sun.eclipticLongitudeDeg, longitude), instant).toBeLessThan(TOLERANCE_DEG);
      expect(Math.abs(sun.declinationDeg - declination), instant).toBeLessThan(TOLERANCE_DEG);
      for (const key of ['eclipticLongitudeDeg', 'rightAscensionDeg', 'gmstDeg']) {
        expect(sun[key]).toBeGreaterThanOrEqual(0);
        expect(sun[key]).toBeLessThan(360);
      }
    }
    // At an equinox the sun stands on the equinoctial colure: its right ascension is that of its longitude.
    expect(angleGap(solarCoordinates(at('2026-09-23T00:05:00Z')).rightAscensionDeg, 180)).toBeLessThan(TOLERANCE_DEG);
    expect(() => solarCoordinates(Number.NaN)).toThrow(RangeError);
    expect(() => solarCoordinates('2026-03-20')).toThrow(RangeError);
  });

  it('the equation of time peaks near +16.4 min early in November and dips near −14.2 min in February', () => {
    const start = at('2026-01-01T00:00:00Z');
    let highest = { minutes: -Infinity, ms: start };
    let lowest = { minutes: Infinity, ms: start };
    for (let hours = 0; hours < 365 * 24; hours += 6) {
      const ms = start + hours * 3_600_000;
      const minutes = solarCoordinates(ms).equationOfTimeMin;
      if (minutes > highest.minutes) highest = { minutes, ms };
      if (minutes < lowest.minutes) lowest = { minutes, ms };
    }
    // Within a tenth of a minute, a fortieth of a degree of the sun's hour angle.
    expect(Math.abs(highest.minutes - 16.4)).toBeLessThan(0.1);
    expect(Math.abs(highest.ms - at('2026-11-03T12:00:00Z'))).toBeLessThan(2 * 86_400_000);
    expect(Math.abs(lowest.minutes + 14.2)).toBeLessThan(0.1);
    expect(Math.abs(lowest.ms - at('2026-02-11T12:00:00Z'))).toBeLessThan(2 * 86_400_000);
    // A sundial's noon at Greenwich: at 12:00 UTC the sun stands a quarter degree west for each minute it runs ahead.
    const noon = at('2026-11-14T12:00:00Z');
    expect(Math.abs(subsolarPoint(noon)[0] + solarCoordinates(noon).equationOfTimeMin / 4)).toBeLessThan(TOLERANCE_DEG);
  });

  it('the subsolar point has the sun at 90° and its antipode at −90°, within 0.05°', () => {
    for (const instant of ['2026-03-20T14:46:00Z', '2026-06-21T08:24:00Z', '2026-11-14T16:00:00Z', '2027-01-02T03:30:00Z']) {
      const [lng, lat] = subsolarPoint(at(instant));
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThan(180);
      expect(Math.abs(lat)).toBeLessThan(23.45);
      expect(sunPosition(at(instant), [lng, lat]).elevationDeg, instant).toBeGreaterThan(90 - TOLERANCE_DEG);
      const antipode = [lng >= 0 ? lng - 180 : lng + 180, -lat];
      expect(sunPosition(at(instant), antipode).elevationDeg, instant).toBeLessThan(-90 + TOLERANCE_DEG);
    }
  });

  it('at Punta Cana the elevation is 90° minus the angular distance to the subsolar point, and local noon on the June solstice is 85.13°', () => {
    const start = at('2026-01-01T00:00:00Z');
    for (let hours = 0; hours < 365 * 24; hours += 97) {
      const ms = start + hours * 3_600_000;
      const expected = 90 - centralAngleDeg(MDPC, subsolarPoint(ms));
      expect(Math.abs(sunPosition(ms, MDPC).elevationDeg - expected)).toBeLessThan(TOLERANCE_DEG);
    }
    // At noon on 21 June the sun is 4.87° north of the zenith: 90° − (23.436° − 18.567°).
    const noon = solarNoon(at('2026-06-21T16:30:00Z'), MDPC);
    expect(Math.abs(noon - at('2026-06-21T16:35:00Z'))).toBeLessThan(120_000);
    const sun = sunPosition(noon, MDPC);
    expect(Math.abs(sun.elevationDeg - 85.13)).toBeLessThan(TOLERANCE_DEG);
    expect(angleGap(sun.azimuthDeg, 0)).toBeLessThan(TOLERANCE_DEG);
    expect(() => sunPosition(noon, [Number.NaN, 18])).toThrow(RangeError);
  });

  it('the azimuth is east in the morning and west in the afternoon at the equinox, and south at noon in December', () => {
    // 08:30 and 16:30 at Punta Cana (UTC−4).
    const morning = sunPosition(at('2026-03-20T12:30:00Z'), MDPC);
    const afternoon = sunPosition(at('2026-03-20T20:30:00Z'), MDPC);
    expect(morning.elevationDeg).toBeGreaterThan(0);
    expect(angleGap(morning.azimuthDeg, 90)).toBeLessThan(15);
    expect(afternoon.elevationDeg).toBeGreaterThan(0);
    expect(angleGap(afternoon.azimuthDeg, 270)).toBeLessThan(15);
    // Before noon the sun climbs, after noon it sinks.
    expect(sunPosition(at('2026-03-20T13:30:00Z'), MDPC).elevationDeg).toBeGreaterThan(morning.elevationDeg);
    expect(sunPosition(at('2026-03-20T21:30:00Z'), MDPC).elevationDeg).toBeLessThan(afternoon.elevationDeg);
    // At noon on the December solstice the sun is due south, 90° − (18.567° + 23.436°) high.
    const noon = solarNoon(at('2026-12-21T16:30:00Z'), MDPC);
    const december = sunPosition(noon, MDPC);
    expect(angleGap(december.azimuthDeg, 180)).toBeLessThan(TOLERANCE_DEG);
    expect(Math.abs(december.elevationDeg - (90 - (18.5674 + 23.436)))).toBeLessThan(TOLERANCE_DEG);
    expect(december.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(december.azimuthDeg).toBeLessThan(360);
  });

  it('MDPC is in the dark at 04:00 UTC and in the light at 16:00 UTC (dayPhase)', () => {
    for (const day of ['2026-03-20', '2026-06-21', '2026-11-14', '2026-12-21']) {
      expect(dayPhase(sunPosition(at(`${day}T04:00:00Z`), MDPC).elevationDeg), day).toBe('night');
      expect(dayPhase(sunPosition(at(`${day}T16:00:00Z`), MDPC).elevationDeg), day).toBe('day');
    }
    // The bounds: the sun's centre on the horizon is day; the end of the civil twilight is still twilight.
    expect(CIVIL_TWILIGHT_DEG).toBe(-6);
    expect([0, -0.01, -6, -6.01, 90, -90].map(dayPhase)).toEqual(['day', 'twilight', 'twilight', 'night', 'day', 'night']);
    // Dusk at Punta Cana passes through the twilight: the sun sets around 17:50 local time in mid-November.
    const dusk = [];
    for (let minutes = 0; minutes <= 90; minutes += 15) {
      dusk.push(dayPhase(sunPosition(at('2026-11-14T21:00:00Z') + minutes * 60_000, MDPC).elevationDeg));
    }
    expect(dusk[0]).toBe('day');
    expect(dusk).toContain('twilight');
    expect(dusk.at(-1)).toBe('night');
    expect(() => dayPhase(Number.NaN)).toThrow(RangeError);
    expect(() => dayPhase(null)).toThrow(RangeError);
  });
});
