import { describe, expect, it } from 'vitest';
import { createKinematicsLayout } from '../kinematics/kinematicsFixtures.js';
import { MDPC_LAYOUT } from './airportLayout.js';
import { haversineM, initialBearing, pointToPolylineM } from './geo.js';
import { demoRunway, runwayEnd, runwayEnds, runwayIdsInUse, runwayInUse } from './runwayInUse.js';

const westerly = { directionDeg: 270, speedMs: 8 };
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

describe('runway in use', () => {
  it('a runway the flight carries wins over live arrivals and wind', () => {
    const everything = { layout: MDPC_LAYOUT, wind: westerly, recentLiveArrivals: [{ trackDeg: 265 }, { trackDeg: 264 }] };
    // A demo flight carries the layout's own runway: 08, whatever the wind and the live traffic say.
    expect(runwayInUse({ ...everything, flightRunway: demoRunway(MDPC_LAYOUT) }))
      .toEqual({ arrival: '08', departure: '08', source: 'flight' });
    expect(runwayInUse({ ...everything, flightRunway: '09' })).toEqual({ arrival: '09', departure: '09', source: 'flight' });
    expect(runwayInUse({ ...everything, flightRunway: { arrival: '26', departure: '08' } }))
      .toEqual({ arrival: '26', departure: '08', source: 'flight' });
    // A runway the layout does not know is not a runway: the live arrivals decide.
    expect(runwayInUse({ ...everything, flightRunway: '18' }).source).toBe('live');
    expect(Object.isFrozen(runwayInUse({ ...everything, flightRunway: '08' }))).toBe(true);
  });

  it('live arrivals aligned within 10° pick their runway; one 15° off is ignored', () => {
    // Three arrivals on 27 (heading 264.9°): they land on 27, and departures keep the preferred runway, 26.
    expect(runwayInUse({ layout: MDPC_LAYOUT, recentLiveArrivals: [{ trackDeg: 263 }, { trackDeg: 266 }, { trackDeg: 268 }] }))
      .toEqual({ arrival: '27', departure: '26', source: 'live' });
    // Each votes for its nearest end: 76° is 08 (73.8°), 87° is 09 (84.9°). One each is a tie, which goes to 08.
    expect(runwayInUse({ layout: MDPC_LAYOUT, recentLiveArrivals: [{ trackDeg: 76 }, { trackDeg: 87 }] }))
      .toEqual({ arrival: '08', departure: '08', source: 'live' });
    expect(runwayInUse({ layout: MDPC_LAYOUT, recentLiveArrivals: [{ trackDeg: 87 }, { trackDeg: 86 }] }).arrival).toBe('09');
    // 15° off any runway (58.8° is 15° from 08): not an arrival on final, so the wind decides.
    expect(runwayInUse({ layout: MDPC_LAYOUT, recentLiveArrivals: [{ trackDeg: 58.8 }], wind: westerly }).source).toBe('wind');
    expect(runwayInUse({ layout: MDPC_LAYOUT, recentLiveArrivals: [{ trackDeg: 58.8 }, { trackDeg: null }, {}] }).source)
      .toBe('default');
  });

  it('the largest head wind picks the runway end; calm or variable wind falls back to 08', () => {
    // One runway: the end facing the wind.
    const single = createKinematicsLayout();
    expect(runwayInUse({ layout: single, wind: { directionDeg: 280, speedMs: 6 } }))
      .toEqual({ arrival: '27', departure: '27', source: 'wind' });
    expect(runwayInUse({ layout: single, wind: { directionDeg: 100, speedMs: 6 } }).arrival).toBe('09');
    // At Punta Cana a westerly wind has its largest head wind on 27, so the flow is westerly and the preferred runway
    // keeps it: 26. An easterly wind lands on 08.
    expect(runwayInUse({ layout: MDPC_LAYOUT, wind: westerly })).toEqual({ arrival: '26', departure: '26', source: 'wind' });
    expect(runwayInUse({ layout: MDPC_LAYOUT, wind: { directionDeg: 60, speedMs: 5 } }))
      .toEqual({ arrival: '08', departure: '08', source: 'wind' });
    // Calm, variable or no wind says nothing.
    for (const wind of [{ directionDeg: 270, speedMs: 1 }, { directionDeg: null, speedMs: 6 }, { speedMs: 6 }, null]) {
      expect(runwayInUse({ layout: MDPC_LAYOUT, wind })).toEqual({ arrival: '08', departure: '08', source: 'default' });
    }
  });

  it('with nothing known both directions use 08 from the dataset', () => {
    expect(runwayInUse({ layout: MDPC_LAYOUT })).toEqual({ arrival: '08', departure: '08', source: 'default' });
    expect(runwayIdsInUse(MDPC_LAYOUT, runwayInUse({ layout: MDPC_LAYOUT }))).toEqual(['08/26']);
    expect(runwayIdsInUse(MDPC_LAYOUT, { arrival: '27', departure: '26' })).toEqual(['09/27', '08/26']);
  });

  it('the demo runway is 08 on the MDPC layout', () => {
    expect(demoRunway(MDPC_LAYOUT)).toEqual({ arrival: '08', departure: '08' });
    expect(MDPC_LAYOUT.operations.basis).toBe('owner-decision-19');
    expect(demoRunway(createKinematicsLayout())).toEqual({ arrival: '09', departure: '09' });
    expect(demoRunway({ runways: [] })).toBeNull();
    // Idents are matched as pilots write them.
    for (const ident of ['08', '8', 'rwy 08', ' RWY08 ']) expect(runwayEnd(MDPC_LAYOUT, ident)?.ident, ident).toBe('08');
    expect(runwayEnd(MDPC_LAYOUT, '18')).toBeNull();
    expect(runwayEnd(MDPC_LAYOUT, null)).toBeNull();
  });

  it('runwayEnds of MDPC are 08, 26, 09 and 27, each centreline oriented from its threshold', () => {
    const ends = runwayEnds(MDPC_LAYOUT);
    expect(ends.map(end => end.ident)).toEqual(['08', '26', '09', '27']);
    expect(ends.map(end => end.runwayId)).toEqual(['08/26', '08/26', '09/27', '09/27']);
    expect(runwayEnds(MDPC_LAYOUT)).toBe(ends);
    expect(Object.isFrozen(ends[0].centerline)).toBe(true);
    const exits = MDPC_LAYOUT.taxiGraph.nodes.filter(node => node.kind === 'exit');
    for (const end of ends) {
      const runway = MDPC_LAYOUT.runways.find(candidate => candidate.id === end.runwayId);
      const opposite = runway.ends.find(candidate => candidate.ident !== end.ident);
      expect(end.centerline[0], end.ident).toEqual(end.threshold);
      expect(end.centerline[end.centerline.length - 1], end.ident).toEqual(opposite.threshold);
      expect(end.oppositeThreshold, end.ident).toEqual(opposite.threshold);
      // It leaves its threshold on the runway heading and walks steadily away from it.
      expect(angleBetween(initialBearing(end.centerline[0], end.centerline[1]), end.headingTrue), end.ident).toBeLessThan(6);
      for (let at = 1; at < end.centerline.length; at += 1) {
        expect(haversineM(end.threshold, end.centerline[at])).toBeGreaterThan(haversineM(end.threshold, end.centerline[at - 1]));
      }
      expect(end.lengthM, end.ident).toBeGreaterThan(3090);
      expect(end.lengthM, end.ident).toBeLessThan(3120);
      expect(end.elevationFt, end.ident).toBe(runway.ends.find(candidate => candidate.ident === end.ident).elevationFt);
      // The runway's exits lie on it (the layout's own vertices).
      const onIt = exits.filter(node => pointToPolylineM(node.p, end.centerline).distanceM <= 1);
      expect(onIt.length, end.ident).toBe(end.runwayId === '08/26' ? 8 : 10);
    }
  });
});
