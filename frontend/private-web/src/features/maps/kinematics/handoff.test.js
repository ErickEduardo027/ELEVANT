import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { destinationPoint, haversineM, measurePolyline, nearestOnPolyline, pointAlong, toLocal } from '../airport/geo.js';
import { runwayEnd } from '../airport/runwayInUse.js';
import { assembleTrajectory, buildArrivalTrajectory, sampleTrajectory, trajectoryLine } from './estimator.js';
import { buildFlightRoute } from './flightRoute.js';
import {
  TRACK_CONFIG, createTrack, needsReplan, reduceTrack, renderTrack, trackConfigFor, trackMode,
} from './handoff.js';
import { createKinematicsLayout, kinematicsPoint } from './kinematicsFixtures.js';
import { STATUS_MESSAGES, kinematicsMessages } from './kinematicsMessages.js';
import { moveLeg } from './legs.js';
import { perfFor } from './perfProfiles.js';
import { angleDiff } from './smoothing.js';
import { ftToM, ktToMs, normalizeDeg } from './units.js';

// The hand-off on the synthetic aerodrome (kinematicsFixtures.js): fixes in the map's units (traffic/situationModel.js)
// and plans built with the real estimator, all on an explicit clock.
const T0 = Date.parse('2026-11-14T15:00:00Z');
const s = seconds => T0 + seconds * 1000;
const at = state => [state.lon, state.lat];
const lonLat = ([lon, lat]) => ({ lon, lat });
const PERF = perfFor({ typeIcao: 'A320' });

/** A fix seen `seconds` after T0, `x` metres east and `y` north of the aerodrome's origin (or at `point`). */
function fixAt(seconds, { x = 0, y = 0, point = null, ...rest } = {}) {
  return {
    ...lonLat(point ?? kinematicsPoint(x, y)), altM: 900, gsMs: 80, trackDeg: 90, vrateMs: 0, onGround: false,
    positionAt: s(seconds), ...rest,
  };
}

const withFix = (track, fix, atMs = fix?.positionAt) => reduceTrack(track, { type: 'fix', fix, atMs });
const withPlan = (track, trajectory, atMs) => reduceTrack(track, { type: 'plan', trajectory, atMs });
const tick = (track, tMs) => reduceTrack(track, { type: 'tick', tMs });

/** A planned path that turns: east from the origin, curving left on a 3 km radius until it heads north. */
function arcPlan({ radiusM = 3_000, speedMs = 80, altM = 900 } = {}) {
  const coords = [];
  for (let degrees = 0; degrees <= 90; degrees += 0.5) {
    const phi = (degrees * Math.PI) / 180;
    coords.push(kinematicsPoint(radiusM * Math.sin(phi), radiusM * (1 - Math.cos(phi))));
  }
  const leg = moveLeg({ phase: 'approach', path: coords, v0: speedMs, v1: speedMs, alt0: altM, alt1: altM, part: 'air' });
  return assembleTrajectory({ kind: 'arrival', parts: [{ startMs: s(0), legs: [leg] }] });
}

/** A straight planned path of 50 km from `point` (or the origin) on `bearingDeg`, flown at `speedMs` from `startSeconds`. */
function straightPlan({ point = null, bearingDeg = 90, speedMs = 100, startSeconds = 0, altM = 900 } = {}) {
  const start = point ?? kinematicsPoint(0, 0);
  const leg = moveLeg({
    phase: 'approach', path: [start, destinationPoint(start, bearingDeg, 50_000)], v0: speedMs, v1: speedMs, alt0: altM,
    alt1: altM, part: 'air',
  });
  return assembleTrajectory({ kind: 'arrival', parts: [{ startMs: s(startSeconds), legs: [leg] }] });
}

/** The point half way from `a` to `b` in the east-north plane of `a`, as the hand-off mixes positions. */
function planeMix(a, b, w) {
  const plane = toLocal(a);
  const [x, y] = plane.forward(b);
  return plane.inverse([x * w, y * w]);
}

/**
 * The longest distance the drawn aircraft covers in one `stepMs` from `fromMs` to `toMs`: `track` is drawn from
 * `changedAtMs` on, and `earlier` (the track before its last event) until then, as a map's clock runs.
 */
function longestStep(track, fromMs, toMs, stepMs, { earlier = track, changedAtMs = fromMs } = {}) {
  const draw = t => renderTrack(t < changedAtMs ? earlier : track, t);
  let previous = draw(fromMs);
  let longest = 0;
  for (let t = fromMs + stepMs; t <= toMs; t += stepMs) {
    const next = draw(t);
    if (previous && next) longest = Math.max(longest, haversineM(at(previous), at(next)));
    previous = next;
  }
  return longest;
}

describe('hand-off between live positions and estimates', () => {
  it('live up to 15 s by dead reckoning from the fix', () => {
    expect(createTrack()).toEqual({
      id: null, kind: 'other', lastFix: null, plan: null, blend: null, trailEpoch: 0, snapAtMs: null, dropped: false,
    });
    expect(createTrack({ id: 'f:p:1', kind: 'aviam' }).kind).toBe('aviam');
    expect(createTrack({ kind: 'drone' }).kind).toBe('other');
    expect(renderTrack(createTrack(), s(0))).toBeNull();

    const fix = fixAt(0, { gsMs: 100, trackDeg: 90, altM: 1_000, vrateMs: -5 });
    for (const kind of ['other', 'aviam']) {
      const track = withFix(createTrack({ kind }), fix);
      expect(Object.isFrozen(track) && Object.isFrozen(track.lastFix)).toBe(true);
      for (const age of [0, 5, 10, 15]) {
        const drawn = renderTrack(track, s(age));
        expect(drawn, `${kind} ${age} s`).toMatchObject({
          mode: 'live', quality: 'live', statusKey: null, opacity: 1, ageS: age, trackDeg: 90, gsMs: 100, vrateMs: -5,
          onGround: false, phase: null, trailEpoch: 0,
        });
        expect(haversineM(at(drawn), destinationPoint(at(fix), 90, 100 * age)), `${kind} ${age} s`).toBeLessThan(0.01);
        expect(drawn.altM).toBeCloseTo(1_000 - 5 * age, 9);
      }
      expect(trackMode(track, s(15))).toBe('live');
      expect(renderTrack(track, s(15.001)).mode).toBe('coast');
    }
    // The keys of a trajectory sample (traffic/situationModel.js takes the first eight as an estimate), frozen.
    const drawn = renderTrack(withFix(createTrack(), fix), s(5));
    expect(Object.keys(drawn)).toEqual([
      'lon', 'lat', 'altM', 'gsMs', 'trackDeg', 'vrateMs', 'onGround', 'phase', 'mode', 'quality', 'ageS', 'statusKey',
      'opacity', 'timeScale', 'trailEpoch',
    ]);
    expect(drawn.timeScale).toBe(1);
    expect(Object.isFrozen(drawn)).toBe(true);
    // A fix without speed or track stays where it was seen; so does one stopped on the ground, whatever its track.
    const still = withFix(createTrack(), fixAt(0, { gsMs: null, trackDeg: null }));
    expect(haversineM(at(renderTrack(still, s(10))), at(fix))).toBeLessThan(0.01);
    const stopped = withFix(createTrack(), fixAt(0, { gsMs: ktToMs(1), trackDeg: 45, onGround: true, altM: 14 }));
    expect(haversineM(at(renderTrack(stopped, s(10))), at(fix))).toBeLessThan(0.01);
    expect(renderTrack(stopped, s(10)).altM).toBe(14);
    // Descending, the height never goes below sea level.
    expect(renderTrack(withFix(createTrack(), fixAt(0, { altM: 20, vrateMs: -5 })), s(10)).altM).toBe(0);
  });

  it('coasts up to 60 s in the air and 20 s on the ground, saying there is no signal for N s', () => {
    const fix = fixAt(0);
    const air = withFix(createTrack(), fix);
    for (const age of [16, 30, 45, 60]) {
      expect(renderTrack(air, s(age)), `${age} s`).toMatchObject({
        mode: 'coast', quality: 'coasted', statusKey: 'noSignal', ageS: age, opacity: 1,
      });
      // Other traffic coasts straight on at its speed.
      expect(haversineM(at(renderTrack(air, s(age))), destinationPoint(at(fix), 90, 80 * age))).toBeLessThan(0.01);
    }
    expect(trackMode(air, s(60))).toBe('coast');
    expect(trackMode(air, s(60.5))).toBe('estimate');
    expect(renderTrack(air, s(60.5)).mode).toBe('estimate');

    const ground = withFix(createTrack(), fixAt(0, { onGround: true, gsMs: ktToMs(12), altM: 14 }));
    expect(renderTrack(ground, s(16))).toMatchObject({ mode: 'coast', statusKey: 'noSignal', ageS: 16, onGround: true });
    expect(renderTrack(ground, s(20)).mode).toBe('coast');
    expect(renderTrack(ground, s(20.5)).mode).toBe('estimate');

    // What the data block says, in Spanish and English.
    const drawn = renderTrack(air, s(45.6));
    const words = language => createTranslator(kinematicsMessages, language)(
      STATUS_MESSAGES[drawn.statusKey], { seconds: Math.floor(drawn.ageS) });
    expect(words('es')).toBe('Sin señal desde hace 45 s');
    expect(words('en')).toBe('No signal for 45 s');
  });

  it('a coasting AVIAM flight advances along its planned path re-anchored at the fix; other traffic goes straight', () => {
    const plan = arcPlan();
    const line = measurePolyline(trajectoryLine(plan).coords);
    // 20 m south of where the path starts, flying east at 80 m/s.
    const fix = fixAt(0, { x: 0, y: -20 });
    const aviam = withPlan(withFix(createTrack({ id: 'f:p:7', kind: 'aviam' }), fix), plan, s(0));
    const other = withFix(createTrack({ id: 'h:abc123', kind: 'other' }), fix);
    const anchor = nearestOnPolyline(line, at(fix)).alongM;
    for (const age of [25, 40, 55]) {
      const expected = pointAlong(line, anchor + 80 * age);
      const drawn = renderTrack(aviam, s(age));
      expect(drawn, `${age} s`).toMatchObject({ mode: 'coast', quality: 'coasted', statusKey: 'noSignal', phase: 'approach' });
      expect(haversineM(at(drawn), expected.p), `${age} s`).toBeLessThan(0.5);
      expect(Math.abs(angleDiff(drawn.trackDeg, expected.bearingDeg)), `${age} s`).toBeLessThan(0.6);
      // The same fix as other traffic goes straight on its track, far from the turn.
      const straight = renderTrack(other, s(age));
      expect(haversineM(at(straight), destinationPoint(at(fix), 90, 80 * age))).toBeLessThan(0.01);
      expect(straight.trackDeg).toBe(90);
      expect(haversineM(at(drawn), at(straight))).toBeGreaterThan(age === 25 ? 300 : 1_000);
    }
    // 40 s and 3 200 m along the arc it heads 61° left of east.
    expect(Math.abs(angleDiff(renderTrack(aviam, s(40)).trackDeg, 90 - (3_200 / 3_000) * (180 / Math.PI)))).toBeLessThan(1);
    // While live it is drawn from the fix, with the phase the plan has there.
    expect(haversineM(at(renderTrack(aviam, s(10))), destinationPoint(at(fix), 90, 800))).toBeLessThan(0.01);
    expect(renderTrack(aviam, s(10)).phase).toBe('approach');
    // No jump where the coast takes over at 15 s, nor where its easing ends at 21 s.
    for (const boundary of [15, 21]) {
      expect(haversineM(at(renderTrack(aviam, s(boundary))), at(renderTrack(aviam, s(boundary + 0.001))))).toBeLessThan(1);
    }
    // Easing onto the path it may close in sideways faster than it flies, never by a jump.
    expect(longestStep(aviam, s(0), s(60), 250)).toBeLessThan(3 * 80 * 0.25);

    // Re-anchored at a new fix further along the path: it coasts on from there.
    const ahead = pointAlong(line, 1_000);
    const later = fixAt(10, { point: ahead.p, trackDeg: ahead.bearingDeg });
    const reanchored = withFix(aviam, later, s(10));
    const from = nearestOnPolyline(line, at(later)).alongM;
    expect(from).toBeCloseTo(1_000, 0);
    expect(haversineM(at(renderTrack(reanchored, s(50))), pointAlong(line, from + 80 * 40).p)).toBeLessThan(0.5);
    // A plan whose line passes farther than the snap distance from the fix does not guide it.
    const far = withPlan(withFix(createTrack({ kind: 'aviam' }), fixAt(0, { x: 0, y: -5_000 })), plan, s(0));
    expect(renderTrack(far, s(40)).phase).toBeNull();
    expect(haversineM(at(renderTrack(far, s(40))), destinationPoint(kinematicsPoint(0, -5_000), 90, 3_200))).toBeLessThan(0.01);
  });

  it('after the coast an AVIAM flight follows the trajectory rebuilt from its last fix and other traffic fades and is dropped at 120 s', () => {
    const layout = createKinematicsLayout();
    const end09 = runwayEnd(layout, '09');
    const stand = layout.stands.find(item => item.code === 'S2');
    // 12 km out on the extended centreline of 09, inbound at 160 kt and 2 500 ft, coming down.
    const fix = {
      ...lonLat(destinationPoint(end09.threshold, end09.headingTrue + 180, 12_000)), altM: ftToM(2_500), gsMs: ktToMs(160),
      trackDeg: end09.headingTrue, vrateMs: -4, onGround: false, positionAt: s(0),
    };
    let aviam = withFix(createTrack({ id: 'f:p:9', kind: 'aviam' }), fix);
    expect(needsReplan(aviam, s(10))).toBe(false);
    expect(needsReplan(aviam, s(59))).toBe(false);
    expect(needsReplan(aviam, s(61))).toBe(true);
    const rebuilt = buildArrivalTrajectory({ times: null, layout, runwayEnd: end09, stand, perf: PERF, anchor: { kind: 'fix', fix } });
    expect(rebuilt.meta.anchor.kind).toBe('fix');
    const before = renderTrack(aviam, s(61));
    aviam = withPlan(aviam, rebuilt, s(61));
    expect(aviam.plan).toMatchObject({ trajectory: rebuilt, atMs: s(61), anchorFixAt: s(0) });
    expect(needsReplan(aviam, s(61))).toBe(false);
    // It takes over from where it was drawn, and from the end of the blend it is exactly where the trajectory says.
    expect(haversineM(at(renderTrack(aviam, s(61))), at(before))).toBeLessThan(1e-6);
    for (const seconds of [67, 90, 150]) {
      const drawn = renderTrack(aviam, s(seconds));
      const sample = sampleTrajectory(rebuilt, s(seconds));
      expect(haversineM(at(drawn), [sample.lon, sample.lat]), `${seconds} s`).toBeLessThan(1e-6);
      expect(drawn, `${seconds} s`).toMatchObject({ mode: 'estimate', quality: 'estimated', phase: sample.phase, statusKey: 'noSignal' });
      expect(drawn.altM).toBeCloseTo(sample.altM, 9);
    }
    expect(longestStep(aviam, s(50), s(80), 250, { earlier: withFix(createTrack({ kind: 'aviam' }), fix), changedAtMs: s(61) }))
      .toBeLessThan(3 * ktToMs(160) * 0.25);
    // The trajectory lands it and parks it at its stand.
    const parked = renderTrack(aviam, s(3_600));
    expect(haversineM(at(parked), stand.center)).toBeLessThan(0.5);
    expect(parked).toMatchObject({ phase: 'parked', onGround: true, gsMs: 0 });
    // An ELEVANT flight with a plan is never dropped by age.
    expect(tick(aviam, s(3_600)).dropped).toBe(false);

    // Other traffic with the same fix goes straight on and fades out from 60 to 120 s, then it is gone.
    let other = withFix(createTrack({ kind: 'other' }), fix);
    expect(renderTrack(other, s(60)).opacity).toBe(1);
    expect(renderTrack(other, s(90))).toMatchObject({ mode: 'estimate', quality: 'coasted', statusKey: 'noSignal' });
    expect(renderTrack(other, s(90)).opacity).toBeCloseTo(0.5, 9);
    expect(renderTrack(other, s(119)).opacity).toBeCloseTo(1 / 60, 9);
    expect(haversineM(at(renderTrack(other, s(90))), destinationPoint(at(fix), fix.trackDeg, fix.gsMs * 90))).toBeLessThan(0.01);
    expect(renderTrack(other, s(120))).toBeNull();
    expect(needsReplan(other, s(90))).toBe(false);
    expect(tick(other, s(119))).toBe(other);
    other = tick(other, s(120));
    expect(other.dropped).toBe(true);
    expect(renderTrack(other, s(100))).toBeNull();

    // Without a plan an ELEVANT flight fades out the same way but is dropped only at 600 s; a late plan brings it back.
    const lost = withFix(createTrack({ kind: 'aviam' }), fix);
    expect(renderTrack(lost, s(90)).opacity).toBeCloseTo(0.5, 9);
    expect(renderTrack(lost, s(121))).toBeNull();
    expect(tick(lost, s(599)).dropped).toBe(false);
    expect(tick(lost, s(600)).dropped).toBe(true);
    const back = withPlan(lost, rebuilt, s(200));
    expect(back).toMatchObject({ dropped: false, snapAtMs: s(200), trailEpoch: 1 });
    expect(renderTrack(back, s(200)).opacity).toBe(0);
    expect(renderTrack(back, s(201))).toMatchObject({ quality: 'estimated', opacity: 1 });
    // A plan that is over cannot keep an aircraft: a demo flight is dropped once its trajectory ends.
    const ending = withPlan(createTrack({ kind: 'aviam' }), straightPlan({ speedMs: 100 }), s(0));
    expect(renderTrack(ending, s(400))).toMatchObject({ mode: 'estimate', quality: 'estimated', ageS: null, statusKey: null });
    expect(tick(ending, s(499)).dropped).toBe(false);
    expect(tick(ending, s(501)).dropped).toBe(true);
    // A rebuild that found no route is recorded, so the store does not ask again for that fix.
    const noRoute = reduceTrack(withFix(createTrack({ kind: 'aviam' }), fix), { type: 'plan', trajectory: null, atMs: s(61), anchorFixAt: s(0) });
    expect(noRoute.plan).toEqual({ trajectory: null, atMs: s(61), anchorFixAt: s(0) });
    expect(needsReplan(noRoute, s(62))).toBe(false);
  });

  it('a fix while estimating blends position and heading over 1.5 s (CN-31)', () => {
    let track = withPlan(createTrack({ id: 'f:p:2', kind: 'aviam' }), straightPlan({ bearingDeg: 350 }), s(0));
    const estimating = track;
    const atMs = s(100);
    const before = renderTrack(track, atMs);
    expect(before).toMatchObject({ mode: 'estimate', quality: 'estimated', ageS: null, altM: 900 });
    expect(before.trackDeg).toBeCloseTo(350, 1);
    // A fix 400 m east of the drawn aircraft, flying 020° at 950 m.
    const fixPoint = destinationPoint(at(before), 80, 400);
    const fix = { ...lonLat(fixPoint), altM: 950, gsMs: 100, trackDeg: 20, vrateMs: 0, onGround: false, positionAt: atMs };
    track = withFix(track, fix, atMs);
    expect(track.blend).toMatchObject({ startMs: atMs, durationMs: 1_500 });
    expect(track).toMatchObject({ trailEpoch: 0, snapAtMs: null });
    // Nothing moves when the fix arrives.
    expect(haversineM(at(renderTrack(track, atMs)), at(before))).toBeLessThan(1e-6);
    expect(renderTrack(track, atMs).trackDeg).toBeCloseTo(before.trackDeg, 9);
    // Half way it is half of each: the position in the east-north plane, the heading the short way across north.
    const middle = renderTrack(track, atMs + 750);
    const expected = planeMix(destinationPoint(at(before), before.trackDeg, 75), destinationPoint(fixPoint, 20, 75), 0.5);
    expect(haversineM(at(middle), expected)).toBeLessThan(0.01);
    expect(middle.trackDeg).toBeCloseTo(normalizeDeg(before.trackDeg + angleDiff(before.trackDeg, 20) / 2), 9);
    expect(middle.trackDeg).toBeLessThan(10);
    expect(middle.altM).toBeCloseTo(925, 9);
    expect(middle).toMatchObject({ mode: 'live', quality: 'live' });
    // After 1.5 s it is the fix, carried on.
    const done = renderTrack(track, atMs + 1_500);
    expect(haversineM(at(done), destinationPoint(fixPoint, 20, 150))).toBeLessThan(0.01);
    expect(done.trackDeg).toBe(20);
    // The heading turns through north, never the long way, and the position never jumps.
    for (let ms = 0; ms <= 1_500; ms += 100) {
      const heading = renderTrack(track, atMs + ms).trackDeg;
      expect(heading >= before.trackDeg - 1e-9 || heading <= 20 + 1e-9, `${ms} ms: ${heading}`).toBe(true);
    }
    // It closes the 400 m sideways in 1.5 s while it flies on (CN-31: close to the reported fix), never by a jump.
    expect(longestStep(track, atMs - 2_000, atMs + 8_000, 100, { earlier: estimating, changedAtMs: atMs }))
      .toBeLessThan(6 * 100 * 0.1);
    // The tick clears the blend once it is over, and the aircraft stays where it was drawn.
    expect(tick(track, atMs + 1_499)).toBe(track);
    const cleared = tick(track, atMs + 1_500);
    expect(cleared.blend).toBeNull();
    expect(renderTrack(cleared, atMs + 2_000)).toEqual(renderTrack(track, atMs + 2_000));
  });

  it('a gap above 2 NM in the air or 150 m on the ground snaps with a brief fade and starts a new trail part', () => {
    const estimating = withPlan(createTrack({ id: 'f:p:3', kind: 'aviam' }), straightPlan(), s(0));
    const atMs = s(100);
    const drawn = renderTrack(estimating, atMs);
    const fixAway = metres => ({
      ...lonLat(destinationPoint(at(drawn), 0, metres)), altM: 900, gsMs: 100, trackDeg: 90, vrateMs: 0, onGround: false,
      positionAt: atMs,
    });
    // In the air: 5 km away snaps, 3 km away blends (the limit is 2 NM, 3 704 m).
    expect(TRACK_CONFIG.snapAirM).toBe(2 * 1852);
    const snapped = withFix(estimating, fixAway(5_000), atMs);
    expect(snapped).toMatchObject({ trailEpoch: 1, blend: null, snapAtMs: atMs });
    expect(renderTrack(snapped, atMs)).toMatchObject({ mode: 'live', opacity: 0, trailEpoch: 1 });
    expect(haversineM(at(renderTrack(snapped, atMs)), at(fixAway(5_000)))).toBeLessThan(0.01);
    expect(renderTrack(snapped, atMs + 500).opacity).toBeCloseTo(0.5, 9);
    expect(renderTrack(snapped, atMs + 1_000).opacity).toBe(1);
    expect(tick(snapped, atMs + 999)).toBe(snapped);
    expect(tick(snapped, atMs + 1_000).snapAtMs).toBeNull();
    for (const metres of [3_000, 3_700]) {
      const blended = withFix(estimating, fixAway(metres), atMs);
      expect(blended, `${metres} m`).toMatchObject({ trailEpoch: 0, snapAtMs: null });
      expect(blended.blend).not.toBeNull();
      expect(renderTrack(blended, atMs).opacity).toBe(1);
    }
    expect(withFix(estimating, fixAway(3_710), atMs).trailEpoch).toBe(1);

    // On the ground: 200 m snaps, 100 m blends.
    const groundFix = fixAt(0, { x: 200, y: -500, onGround: true, gsMs: 0, trackDeg: 270, altM: 14 });
    const parked = withFix(createTrack({ kind: 'other' }), groundFix);
    const moved = metres => ({ ...groundFix, ...lonLat(destinationPoint(at(groundFix), 0, metres)), positionAt: s(5) });
    expect(withFix(parked, moved(200), s(5))).toMatchObject({ trailEpoch: 1, blend: null, snapAtMs: s(5) });
    const nudged = withFix(parked, moved(100), s(5));
    expect(nudged).toMatchObject({ trailEpoch: 0, snapAtMs: null });
    expect(nudged.blend).not.toBeNull();

    // A plan of a flight drawn from its plan alone slides over 20 s up to ten snap distances (CN-18), and snaps beyond.
    const slid = withPlan(estimating, straightPlan({ point: kinematicsPoint(0, 10_000) }), atMs);
    expect(slid).toMatchObject({ trailEpoch: 0, snapAtMs: null });
    expect(slid.blend.durationMs).toBe(20_000);
    const replanned = withPlan(estimating, straightPlan({ point: kinematicsPoint(0, 50_000) }), atMs);
    expect(replanned).toMatchObject({ trailEpoch: 1, blend: null, snapAtMs: atMs });

    // The trail a track store records from the renders breaks there: the route never joins across the snap.
    const trail = [97, 98, 99, 100, 101, 102].map(seconds => {
      const state = renderTrack(seconds < 100 ? estimating : snapped, s(seconds));
      return { at: s(seconds), lon: state.lon, lat: state.lat, altM: state.altM, onGround: state.onGround, trailEpoch: state.trailEpoch };
    });
    const route = buildFlightRoute({ flightKey: 'p:3', direction: 'Arrival' }, null, trail, s(102));
    const observed = route.features.filter(feature => feature.properties.part === 'flownObserved');
    expect(observed.map(feature => feature.geometry.coordinates.length)).toEqual([3, 3]);
    expect(observed[0].geometry.coordinates[2]).toEqual([trail[2].lon, trail[2].lat]);
    expect(observed[1].geometry.coordinates[0]).toEqual([trail[3].lon, trail[3].lat]);
  });

  it('a new plan blends from the drawn position', () => {
    const first = straightPlan({ bearingDeg: 90 });
    let track = withPlan(createTrack({ id: 'f:p:4', kind: 'aviam' }), first, s(0));
    const onFirst = track;
    const atMs = s(100);
    const before = renderTrack(track, atMs);
    // Another stand or another runway: a new route 300 m to the south, heading 120°, from now on.
    const second = straightPlan({ point: destinationPoint(at(before), 180, 300), bearingDeg: 120, startSeconds: 100 });
    track = withPlan(track, second, atMs);
    expect(track.plan).toEqual({ trajectory: second, atMs, anchorFixAt: null });
    expect(track.blend).toMatchObject({ startMs: atMs, durationMs: 6_000 });
    expect(track.trailEpoch).toBe(0);
    // It starts where it was drawn, is half way after 3 s and on the new plan after 6 s.
    expect(haversineM(at(renderTrack(track, atMs)), at(before))).toBeLessThan(1e-6);
    const onSecond = t => sampleTrajectory(second, t);
    const middle = renderTrack(track, atMs + 3_000);
    const expected = planeMix(destinationPoint(at(before), before.trackDeg, 300), at(onSecond(atMs + 3_000)), 0.5);
    expect(haversineM(at(middle), expected)).toBeLessThan(0.01);
    expect(middle.trackDeg).toBeCloseTo(before.trackDeg + angleDiff(before.trackDeg, onSecond(atMs + 3_000).trackDeg) / 2, 9);
    for (const ms of [6_000, 30_000]) {
      expect(haversineM(at(renderTrack(track, atMs + ms)), at(onSecond(atMs + ms)))).toBeLessThan(1e-6);
    }
    expect(longestStep(track, atMs - 2_000, atMs + 8_000, 100, { earlier: onFirst, changedAtMs: atMs }))
      .toBeLessThan(3 * 100 * 0.1);
    // An older plan or the same one again changes nothing.
    expect(withPlan(track, first, atMs - 1_000)).toBe(track);
    expect(withPlan(track, second, atMs + 1_000)).toBe(track);
    expect(reduceTrack(track, { type: 'plan', trajectory: second })).toBe(track);
    // Dropping the plan of an aircraft without a fix takes it off the map.
    expect(renderTrack(withPlan(track, null, atMs + 10_000), atMs + 10_000)).toBeNull();
    // A first plan has nothing to blend from.
    expect(withPlan(createTrack({ kind: 'aviam' }), first, s(0))).toMatchObject({ blend: null, snapAtMs: null, trailEpoch: 0 });
  });

  it('a new plan that puts the aircraft where it is drawn takes over without moving it', () => {
    // A trajectory continued from the one drawn (a demo flight given its stand, or cancelled): the same place, the same
    // way. No position blend, so it never cuts across a curve by dead reckoning.
    const curve = arcPlan();
    const track = withPlan(createTrack({ id: 'f:p:5', kind: 'aviam' }), curve, s(0));
    const continued = arcPlan();
    const atMs = s(30);
    const next = withPlan(track, continued, atMs);
    expect(next.plan.trajectory).toBe(continued);
    expect(next.blend).toBeNull();
    for (const seconds of [30, 31, 33, 36]) {
      expect(haversineM(at(renderTrack(next, s(seconds))), at(sampleTrajectory(curve, s(seconds)))), `${seconds} s`)
        .toBeLessThan(1e-6);
    }
    // The same place, fading out from then (a cancelled demo read 2 s late): only the opacity blends, from 1.
    const fading = assembleTrajectory({
      kind: 'demo', parts: [{ startMs: s(0), legs: curve.legs.map(leg => ({ ...leg })) }],
      meta: { fade: { startMs: s(28), endMs: s(36) }, statusKey: 'cancelledByProvider' },
    });
    const faded = withPlan(track, fading, atMs);
    expect(faded.blend).toMatchObject({ startMs: atMs, durationMs: 6_000, opacityOnly: true });
    const drawn = renderTrack(faded, s(31));
    expect(haversineM(at(drawn), at(sampleTrajectory(curve, s(31))))).toBeLessThan(1e-6);
    expect(drawn.opacity).toBeGreaterThan(sampleTrajectory(fading, s(31)).opacity);
    expect(drawn.opacity).toBeLessThan(1);
    expect(renderTrack(faded, s(30)).opacity).toBe(1);
    expect(renderTrack(faded, s(36))).toBeNull();
  });

  it('limits widen to 1.5 × refreshAfterSeconds for a slower feed', () => {
    expect(TRACK_CONFIG).toEqual({
      liveMaxAgeS: 15, coastMaxAgeS: 60, groundCoastMaxAgeS: 20, blendS: 6, fixBlendS: 1.5, groundReckonMaxS: 3,
      groundReckonFactor: 1.5, groundReckonCapS: 6, snapAirM: 3_704, snapGroundM: 150,
      dropOtherAfterS: 120, dropAviamAfterS: 600, snapFadeS: 1,
    });
    expect(Object.isFrozen(TRACK_CONFIG)).toBe(true);
    // The usual 10 s, a faster feed and nonsense keep the limits as they are.
    for (const refresh of [10, 8, 2, 0, -5, null, undefined, Number.NaN, '30']) expect(trackConfigFor(refresh)).toBe(TRACK_CONFIG);
    const slow = trackConfigFor(30);
    expect(slow).toEqual({
      ...TRACK_CONFIG, liveMaxAgeS: 45, coastMaxAgeS: 90, groundCoastMaxAgeS: 50, dropOtherAfterS: 150, dropAviamAfterS: 630,
    });
    expect(Object.isFrozen(slow)).toBe(true);
    // The slowest pace the API asks for (60 s): every limit is at least 1.5 × 60 s and every window keeps its length.
    const slowest = trackConfigFor(60);
    for (const key of ['liveMaxAgeS', 'coastMaxAgeS', 'groundCoastMaxAgeS', 'dropOtherAfterS', 'dropAviamAfterS']) {
      expect(slowest[key], key).toBeGreaterThanOrEqual(90);
    }
    expect(slowest.liveMaxAgeS).toBe(90);
    expect(slowest.coastMaxAgeS - slowest.liveMaxAgeS).toBe(45);
    expect(slowest.groundCoastMaxAgeS - slowest.liveMaxAgeS).toBe(5);
    expect(slowest.dropOtherAfterS - slowest.coastMaxAgeS).toBe(60);
    expect([slowest.blendS, slowest.snapAirM, slowest.snapGroundM, slowest.snapFadeS]).toEqual([6, 3_704, 150, 1]);
    // With the slower feed a 40 s old fix is still live and the fade runs from 90 to 150 s.
    const track = withFix(createTrack({ kind: 'aviam' }), fixAt(0));
    expect(renderTrack(track, s(40)).mode).toBe('coast');
    expect(renderTrack(track, s(40), slow).mode).toBe('live');
    expect(trackMode(track, s(80), slow)).toBe('coast');
    expect(renderTrack(track, s(100), slow).opacity).toBeCloseTo(1 - 10 / 60, 9);
    expect(needsReplan(track, s(80))).toBe(true);
    expect(needsReplan(track, s(80), slow)).toBe(false);
    expect(tick(withFix(createTrack(), fixAt(0)), s(130)).dropped).toBe(true);
    expect(reduceTrack(withFix(createTrack(), fixAt(0)), { type: 'tick', tMs: s(130) }, slow).dropped).toBe(false);
  });

  it('a render carries the time scale of its plan\'s part', () => {
    // A plan of two parts, as demoProfile.js fits one: the air part compressed ×1.4, the ground part in real time.
    const start = kinematicsPoint(0, 0);
    const turn = destinationPoint(start, 90, 8_000);
    const air = moveLeg({ phase: 'final', path: [start, turn], v0: 100, v1: 100, alt0: 600, alt1: 600, part: 'air' });
    const ground = moveLeg({
      phase: 'taxiIn', path: [turn, destinationPoint(turn, 90, 2_000)], v0: 8, v1: 8, alt0: 0, alt1: 0, onGround: true,
      part: 'taxiIn',
    });
    const fitted = () => assembleTrajectory({
      kind: 'demo', parts: [{ startMs: s(0), legs: [{ ...air, timeScale: 1.4 }, { ...ground, timeScale: 1 }] }],
      timeScale: 1.4, scaledParts: ['air'],
    });
    const trajectory = fitted();
    const planned = withPlan(createTrack({ id: 'f:p:9', kind: 'aviam' }), trajectory, s(0));
    expect(renderTrack(planned, s(10))).toMatchObject({ mode: 'estimate', phase: 'final', timeScale: 1.4 });
    expect(renderTrack(planned, s(85))).toMatchObject({ mode: 'estimate', phase: 'taxiIn', timeScale: 1 });
    // A leg without a scale runs in real time.
    const plain = withPlan(createTrack({ kind: 'aviam' }), straightPlan(), s(0));
    expect(renderTrack(plain, s(10)).timeScale).toBe(1);
    // A fix runs in real time, live and coasting; once the plan rebuilt from it places the aircraft, the plan's scale.
    const fix = fixAt(0, { point: start, gsMs: 100, trackDeg: 90, altM: 600 });
    const live = withFix(planned, fix, s(0));
    expect(renderTrack(live, s(5))).toMatchObject({ mode: 'live', timeScale: 1 });
    expect(renderTrack(live, s(30))).toMatchObject({ mode: 'coast', timeScale: 1 });
    const rebuilt = reduceTrack(live, { type: 'plan', trajectory: fitted(), atMs: s(61), anchorFixAt: fix.positionAt });
    expect(renderTrack(rebuilt, s(70))).toMatchObject({ mode: 'estimate', quality: 'estimated', timeScale: 1.4 });
  });

  it('an older fix never moves the track back', () => {
    const track = withFix(createTrack({ kind: 'aviam' }), fixAt(10, { x: 1_000 }));
    const drawn = renderTrack(track, s(12));
    expect(withFix(track, fixAt(5, { x: 0 }), s(12))).toBe(track);
    // The same instant again, a fix without a position and no fix at all change nothing either.
    expect(withFix(track, fixAt(10, { x: 500 }), s(12))).toBe(track);
    expect(withFix(track, { ...fixAt(11), lon: Number.NaN }, s(12))).toBe(track);
    expect(withFix(track, null, s(12))).toBe(track);
    expect(renderTrack(track, s(12))).toEqual(drawn);
    // A newer one moves it on.
    const newer = withFix(track, fixAt(12, { x: 1_160 }), s(12));
    expect(newer.lastFix.positionAt).toBe(s(12));
    expect(newer).not.toBe(track);
    // Unknown events and a tick without a time change nothing; without a track a fix starts one.
    expect(reduceTrack(track, { type: 'unknown' })).toBe(track);
    expect(reduceTrack(track, null)).toBe(track);
    expect(tick(track, Number.NaN)).toBe(track);
    expect(reduceTrack(undefined, { type: 'fix', fix: fixAt(0), atMs: s(0) }).lastFix.positionAt).toBe(s(0));
  });
});

describe('smooth motion (CN-18)', () => {
  // Truth: 80 m/s from the origin heading east, turning right at 2°/s; a fix every 10 s that reaches the map 4 s late.
  const SPEED = 80;
  const RATE = 2;
  function truthAt(seconds) {
    const omega = (RATE * Math.PI) / 180;
    const h0 = Math.PI / 2;
    const h = h0 + omega * seconds;
    const x = (SPEED / omega) * (Math.cos(h0) - Math.cos(h));
    const y = (SPEED / omega) * (Math.sin(h) - Math.sin(h0));
    return { point: kinematicsPoint(x, y), trackDeg: normalizeDeg(90 + RATE * seconds) };
  }
  const turningFix = seconds => {
    const { point, trackDeg } = truthAt(seconds);
    return fixAt(seconds, { point, gsMs: SPEED, trackDeg });
  };

  it('a turning aircraft is carried on along its turn: no pull-back when a fix arrives, close to where it flies', () => {
    let track = createTrack({ id: 'h:f0c0aa', kind: 'other' });
    const fixes = [0, 10, 20, 30, 40, 50].map(turningFix);
    const lateMs = 4_000;
    let previous = null;
    let direction = null;
    let backward = 0;
    let farthest = 0;
    let longest = 0;
    for (let t = s(4); t <= s(60); t += 50) {
      for (const fix of fixes) if (fix.positionAt + lateMs === t) track = withFix(track, fix, t);
      track = tick(track, t);
      const drawn = renderTrack(track, t);
      // From the second fix on the turn is known (the first is carried straight on: one fix has no turn rate).
      if (t < s(24)) {
        previous = drawn;
        continue;
      }
      farthest = Math.max(farthest, haversineM(at(drawn), truthAt((t - T0) / 1000).point));
      if (previous !== null) {
        const plane = toLocal(at(previous));
        const [dx, dy] = plane.forward(at(drawn));
        const step = Math.hypot(dx, dy);
        longest = Math.max(longest, step);
        if (direction !== null && (dx * direction[0] + dy * direction[1]) / step < 0) backward += 1;
        direction = [dx / step, dy / step];
      }
      previous = drawn;
    }
    expect(backward).toBe(0);
    // 80 m/s for 50 ms is 4 m; never a step much longer than that.
    expect(longest).toBeLessThan(6);
    // Straight on from each fix it would drift some 100 m outside the turn; along the arc it stays within metres.
    expect(farthest).toBeLessThan(15);
  });

  it('carries no turn on the ground, nor between fixes too far apart', () => {
    const straight = withFix(withFix(createTrack({ kind: 'other' }), turningFix(0)), turningFix(40));
    const drawn = renderTrack(straight, s(50));
    expect(drawn.trackDeg).toBeCloseTo(normalizeDeg(90 + RATE * 40), 6);
    const ground = withFix(withFix(createTrack({ kind: 'other' }), { ...turningFix(0), onGround: true, gsMs: 8 }),
      { ...turningFix(10), onGround: true, gsMs: 8 });
    expect(renderTrack(ground, s(17)).trackDeg).toBeCloseTo(normalizeDeg(90 + RATE * 10), 6);
  });

  it('a new plan of a flight drawn from its plan alone slides over 10 to 20 s instead of snapping', () => {
    const first = withPlan(createTrack({ id: 'f:x', kind: 'aviam' }), straightPlan(), s(0));
    // The estimate moved 6 km further on: beyond the 2 NM snap, within ten times it.
    const moved = straightPlan({ point: kinematicsPoint(6_000, 0) });
    const next = withPlan(first, moved, s(30));
    expect(next.snapAtMs).toBeNull();
    expect(next.trailEpoch).toBe(first.trailEpoch);
    expect(next.blend.durationMs).toBeGreaterThanOrEqual(10_000);
    expect(next.blend.durationMs).toBeLessThanOrEqual(20_000);
    expect(longestStep(next, s(30), s(52), 100, { earlier: first, changedAtMs: s(30) })).toBeLessThan(80);
    // A track with a fix still snaps beyond the snap distance.
    const fixed = withFix(createTrack({ id: 'f:y', kind: 'aviam' }), fixAt(0, { gsMs: 100 }));
    const far = withFix(fixed, fixAt(10, { x: 20_000, gsMs: 100 }));
    expect(far.snapAtMs).toBe(s(10));
  });

  it('a blend that starts after the drawn instant holds where it starts from', () => {
    const one = withFix(createTrack({ kind: 'other' }), fixAt(0));
    const two = withFix(one, fixAt(10, { x: 900, trackDeg: 95 }), s(12));
    const before = renderTrack(two, s(11.9));
    const from = renderTrack(one, s(12));
    expect(haversineM(at(before), at(from))).toBeLessThan(1);
  });
});
