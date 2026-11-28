import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../services/serverClock';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, haversineM, pointToPolylineM } from '../airport/geo';
import { GROUND_TURN_DEG, TRACK_CONFIG, createTrack, reduceTrack, renderTrack } from '../kinematics/handoff';
import { ktToMs } from '../kinematics/units';
import { createAirPicture, createMapFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_NOON } from '../testing/trafficFixtures';
import { STAND_PARKING, createMotionStore } from './motionStore';
import { buildSituation, toFlightsModel, toPictureModel } from './situationModel';

// CN-31: real aircraft drawn where they really are. A live track follows its fixes closely (a short blend, a few seconds
// of dead reckoning on the ground: 1.5 × the spacing of its fixes, from 3 s up to 6 s, M3), never an estimated taxi route; a silent one holds where it was reported; an
// ELEVANT aircraft stopped in a stand stands on its parking point, on its assigned stand after the tablet's BLOCK_ON,
// and a stand other than the assigned one is shown where it is, with the mismatch said.

const NOON = Date.parse(TRAFFIC_NOON);
const at = seconds => NOON + seconds * 1_000;
const standOf = code => MDPC_LAYOUT.stands.find(stand => stand.code === code);
const point = item => [item.lon, item.lat];

/**
 * A taxi along a straight line and then a 90° turn of 45 m radius at 14 kt, reported every `everyS` seconds: the fixes
 * `{ lon, lat, gsMs, trackDeg, onGround, positionAt }` from NOON.
 */
function taxiFixes(everyS = 3, totalS = 60) {
  const speed = ktToMs(14);
  const radius = 45;
  const start = [-68.3700, 18.5700];
  const straightS = 20;
  const turnS = (Math.PI / 2) * radius / speed;
  const fixes = [];
  for (let t = 0; t <= totalS; t += everyS) {
    let p;
    let track;
    if (t <= straightS) {
      p = destinationPoint(start, 90, speed * t);
      track = 90;
    } else if (t <= straightS + turnS) {
      const turned = ((t - straightS) * speed) / radius;
      const corner = destinationPoint(start, 90, speed * straightS);
      const centre = destinationPoint(corner, 180, radius);
      p = destinationPoint(centre, (turned * 180) / Math.PI, radius);
      track = 90 + (turned * 180) / Math.PI;
    } else {
      const corner = destinationPoint(start, 90, speed * straightS);
      const centre = destinationPoint(corner, 180, radius);
      const exit = destinationPoint(centre, 90, radius);
      p = destinationPoint(exit, 180, speed * (t - straightS - turnS));
      track = 180;
    }
    fixes.push({ lon: p[0], lat: p[1], altM: 0, gsMs: speed, trackDeg: track, vrateMs: 0, onGround: true, positionAt: at(t) });
  }
  return fixes;
}

describe('real aircraft where they really are (CN-31)', () => {
  it('a live ground track stays within a few metres of the line through its fixes', () => {
    for (const everyS of [2, 3, 5]) {
      const fixes = taxiFixes(everyS);
      const line = fixes.map(point);
      let track = createTrack({ id: 'h:abc123', kind: 'other' });
      let worst = 0;
      let next = 0;
      for (let ms = at(0); ms <= fixes[fixes.length - 1].positionAt; ms += 100) {
        while (next < fixes.length && fixes[next].positionAt <= ms) {
          track = reduceTrack(track, { type: 'fix', fix: fixes[next], atMs: fixes[next].positionAt });
          next += 1;
        }
        const drawn = renderTrack(track, ms);
        worst = Math.max(worst, pointToPolylineM(point(drawn), line).distanceM);
      }
      // Fixes every 2, 3 or 5 s: the drawn aircraft never leaves the line of its fixes by more than a few metres. M3
      // (27-11-2026): fixes 5 s apart are carried on to the next one (6 s), so where the taxi turns between two fixes the
      // aircraft rolls straight on until the next fix shows the turn: up to 15 m off the chord of that turn (12 m before).
      expect(worst, `fixes every ${everyS} s`).toBeLessThan(everyS <= 3 ? 6 : 15);
    }
  });

  it('a new fix blends in over 1.5 s and dead reckoning on the ground stops after 3 s', () => {
    expect(TRACK_CONFIG.fixBlendS).toBe(1.5);
    expect(TRACK_CONFIG.groundReckonMaxS).toBe(3);
    const [fix] = taxiFixes();
    const track = reduceTrack(createTrack({ kind: 'other' }), { type: 'fix', fix, atMs: fix.positionAt });
    const after = seconds => point(renderTrack(track, fix.positionAt + seconds * 1_000));
    expect(haversineM(after(3), point(fix))).toBeCloseTo(fix.gsMs * 3, 1);
    // Held from then on, where three seconds of its own speed and track left it.
    expect(haversineM(after(10), after(3))).toBeLessThan(0.01);
    expect(haversineM(after(40), after(3))).toBeLessThan(0.01);
  });

  it('on the ground a fix is carried on 1.5 × the spacing of its fixes, from 3 s up to 6 s (M3)', () => {
    expect(TRACK_CONFIG.groundReckonFactor).toBe(1.5);
    expect(TRACK_CONFIG.groundReckonCapS).toBe(6);
    // How many seconds of its own speed the last of two fixes `gapS` apart is carried on, read 30 s after it.
    const carriedS = gapS => {
      const fixes = taxiFixes(gapS, gapS);
      let track = createTrack({ kind: 'other' });
      for (const fix of fixes) track = reduceTrack(track, { type: 'fix', fix, atMs: fix.positionAt });
      const last = fixes[fixes.length - 1];
      return haversineM(point(renderTrack(track, last.positionAt + 30_000)), point(last)) / last.gsMs;
    };
    // Fixes 1 or 2 s apart keep the least (3 s), 3 s apart 4.5 s, 4 s apart and more 6 s.
    for (const [gapS, reckonS] of [[1, 3], [2, 3], [3, 4.5], [4, 6], [5, 6], [10, 6]]) {
      expect(carriedS(gapS), `fixes ${gapS} s apart`).toBeCloseTo(reckonS, 2);
    }
    // Read every 5 s (the airfield pace), a taxiing aircraft rolls on until its next fix: never still between two.
    const fixes = taxiFixes(5, 20);
    let track = createTrack({ kind: 'other' });
    for (const fix of fixes.slice(0, 2)) track = reduceTrack(track, { type: 'fix', fix, atMs: fix.positionAt });
    const stepM = ms => haversineM(point(renderTrack(track, ms)), point(renderTrack(track, ms + 500)));
    for (let ms = fixes[1].positionAt; ms < fixes[2].positionAt; ms += 500) expect(stepM(ms)).toBeGreaterThan(1);
    // In a turn (tracks more than 10° apart) it keeps the least: carried straight on it would leave the curve.
    expect(GROUND_TURN_DEG).toBe(10);
    const [before, turning] = [fixes[4], taxiFixes(5, 25)[5]];
    expect(Math.abs(turning.trackDeg - before.trackDeg)).toBeGreaterThan(10);
    let turn = createTrack({ kind: 'other' });
    for (const fix of [before, turning]) turn = reduceTrack(turn, { type: 'fix', fix, atMs: fix.positionAt });
    const heldM = haversineM(point(renderTrack(turn, turning.positionAt + 30_000)), point(turning));
    expect(heldM / turning.gsMs).toBeCloseTo(3, 2);
  });

  it('never moves a real ELEVANT aircraft along its estimated taxi route, and holds it where it was last reported', () => {
    // A plan that would taxi it 400 m elsewhere: with fresh fixes the aircraft follows its fixes, not the plan.
    const fixes = taxiFixes(3, 18);
    const elsewhere = destinationPoint(point(fixes[0]), 0, 400);
    const plan = {
      kind: 'arrival', startMs: at(0), endMs: at(600), legs: [], meta: {},
    };
    let track = createTrack({ id: 'f:p:1', kind: 'aviam' });
    track = reduceTrack(track, { type: 'plan', trajectory: plan, atMs: at(0) });
    for (const fix of fixes) track = reduceTrack(track, { type: 'fix', fix, atMs: fix.positionAt });
    const last = fixes[fixes.length - 1];
    for (const seconds of [0, 2, 20, 60, 300, 900]) {
      const drawn = renderTrack(track, last.positionAt + seconds * 1_000);
      expect(drawn, `${seconds} s`).not.toBeNull();
      expect(haversineM(point(drawn), elsewhere)).toBeGreaterThan(350);
      // At most the 4.5 s of dead reckoning (1.5 × its fixes 3 s apart, M3) ahead of its last fix, then still.
      expect(haversineM(point(drawn), point(last))).toBeLessThanOrEqual(last.gsMs * 4.5 + 0.01);
    }
    const silent = renderTrack(track, last.positionAt + 120_000);
    expect(silent).toMatchObject({ onGround: true, quality: 'coasted', statusKey: 'noSignal', opacity: 1 });
  });
});

// The ELEVANT aircraft of the lab's noon parked at A2 (ZZ300 arrived, ZZ301 departs), with its fix at `where`.
function parkedRead({ where = null, key = KEY.parkedArrival, status = 'Live', flights = null, gsMs = 0 } = {}) {
  const base = createAirPicture();
  const parked = base.aircraft[2];
  const moved = where === null ? parked : { ...parked, longitude: where[0], latitude: where[1] };
  const picture = toPictureModel({ ...base, status, ...(status === 'Stale' ? { reason: 'provider_error' } : {}),
    aircraft: [{ ...moved, groundSpeedKnots: gsMs, matchedFlightKey: key, matchedBy: 'Registration' }] });
  return { picture, flights: flights ?? toFlightsModel(createMapFlights()) };
}

function drawnOf(store, read, tMs, key = KEY.parkedArrival) {
  const situation = buildSituation({ ...read, nowMs: NOON, estimates: store.estimatesAt(NOON),
    estimatesChangeAt: store.nextChangeAt(NOON) });
  const item = situation.aircraft.find(entry => entry.id === `f:${key}`);
  return store.sample([item], tMs)[0];
}

describe('ELEVANT aircraft on their stands (CN-31)', () => {
  it('stopped in its stand box it eases onto the stand point with the stand heading', () => {
    const a2 = standOf('A2');
    const offset = destinationPoint(a2.center, a2.headingTrue + 90, 4);
    const store = createMotionStore();
    const read = parkedRead({ where: offset });
    store.ingest(read);
    const first = drawnOf(store, read, NOON);
    expect(haversineM(point(first), offset)).toBeLessThan(0.5);
    const middle = drawnOf(store, read, NOON + STAND_PARKING.easeMs / 2);
    expect(haversineM(point(middle), a2.center)).toBeLessThan(haversineM(offset, a2.center));
    const done = drawnOf(store, read, NOON + STAND_PARKING.easeMs + 100);
    expect(haversineM(point(done), a2.center)).toBeLessThan(0.05);
    expect(done.trackDeg).toBeCloseTo(a2.headingTrue, 6);
    expect(done).toMatchObject({ parkedStand: 'A2', standMismatch: null });
    // Never a jump: each 100 ms step moves it less than a metre.
    let previous = first;
    for (let ms = NOON; ms <= NOON + STAND_PARKING.easeMs; ms += 100) {
      const drawn = drawnOf(store, read, ms);
      expect(haversineM(point(drawn), point(previous))).toBeLessThan(1);
      previous = drawn;
    }
  });

  it('parked at another stand than its assigned one it stays there and says so', () => {
    const other = MDPC_LAYOUT.stands.find(stand => stand.code !== 'A2' && stand.retired !== true
      && haversineM(stand.center, standOf('A2').center) > 60);
    const store = createMotionStore();
    const read = parkedRead({ where: other.center });
    store.ingest(read);
    const drawn = drawnOf(store, read, NOON + 5_000);
    expect(haversineM(point(drawn), other.center)).toBeLessThan(0.05);
    expect(drawn.standMismatch).toEqual({ assigned: 'A2', actual: other.code });
    expect(drawn.parkedStand).toBe(other.code);
  });

  it('with its BLOCK_ON recorded and its transponder off it stays on its assigned stand, reported, not estimated', () => {
    // Its last fix on the lead-in, 80 m short of A2 (outside its box), stopped; the picture goes Stale and the fix ages.
    const a2 = standOf('A2');
    const short = destinationPoint(a2.center, a2.headingTrue + 180, 80);
    const store = createMotionStore();
    const read = parkedRead({ where: short, status: 'Stale' });
    store.ingest(read);
    const row = read.flights.byKey.get(KEY.parkedArrival);
    expect(row.milestones.some(item => item.code === 'BLOCK_ON')).toBe(true);
    const fixAt = parseInstant(createAirPicture().aircraft[2].positionAt);
    // While the fix is live it is where the fix is; once it is gone, it eases onto A2 and stays there.
    expect(haversineM(point(drawnOf(store, read, fixAt + 1_000)), short)).toBeLessThan(0.5);
    drawnOf(store, read, fixAt + 600_000);
    const later = drawnOf(store, read, fixAt + 600_000 + STAND_PARKING.easeMs + 100);
    expect(haversineM(point(later), a2.center)).toBeLessThan(0.05);
    expect(later).toMatchObject({ quality: 'reported', parkedStand: 'A2', onGround: true });
  });

  it('a departure stays on its stand until it moves, from its real fixes', () => {
    const a2 = standOf('A2');
    const store = createMotionStore();
    const waiting = parkedRead({ key: KEY.parkedDeparture });
    store.ingest(waiting);
    expect(haversineM(point(drawnOf(store, waiting, NOON + 60_000, KEY.parkedDeparture)), a2.center)).toBeLessThan(0.05);
    // Push-back from its fixes: moving at 3 kt, 20 m behind the stand point.
    const behind = destinationPoint(a2.center, a2.headingTrue + 180, 20);
    const moving = parkedRead({ key: KEY.parkedDeparture, where: behind, gsMs: 3 });
    const pictureAt = { ...moving, picture: { ...moving.picture, serverTime: NOON + 70_000,
      aircraft: moving.picture.aircraft.map(item => ({ ...item, positionAt: NOON + 70_000 })) } };
    store.ingest(pictureAt);
    const pushed = drawnOf(store, pictureAt, NOON + 72_000, KEY.parkedDeparture);
    expect(pushed.parkedStand).toBeNull();
    expect(haversineM(point(pushed), behind)).toBeLessThan(5);
  });
});
