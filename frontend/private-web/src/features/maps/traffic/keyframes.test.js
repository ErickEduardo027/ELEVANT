import { describe, expect, it } from 'vitest';
import { destinationPoint, haversineM } from '../airport/geo';
import { TRACK_CONFIG } from '../kinematics/handoff';
import {
  createAirPicture, createDemoBlock, createDemoFlights, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import {
  HOLD_AFTER_MS, createKeyframes, interpolate, interpolateOne, keyframesMoving, writeKeyframes,
} from './keyframes';
import { createMotionStore } from './motionStore';
import { buildSituation, toFlightsModel, toPictureModel } from './situationModel';

// The traffic layer's keyframes (PR M2): two states per write, interpolated each frame. The demo approach runs on the
// real motion store; the rest on hand-made states. Every instant is explicit.
const NOON = Date.parse(TRAFFIC_NOON);
const at = seconds => NOON + seconds * 1_000;
const DISABLED = toPictureModel(createAirPicture({ status: 'Disabled' }));
const PUJ = [-68.3634, 18.5674];
const FRAME_MS = 1000 / 60;
const WRITE_MS = 500;
/** Metres per CSS pixel of MapLibre (512 px tiles) at `zoom` and `lat`. */
const metresPerPx = (zoom, lat) => (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
const point = item => [item.lon, item.lat];
const state = (lon, lat, extra = {}) => ({ id: 'a', lon, lat, altM: 300, gsMs: 70, trackDeg: 90, onGround: false, opacity: 1, ...extra });

function demoApproach() {
  const store = createMotionStore();
  const response = createDemoFlights(createDemoBlock({ appearAt: at(-60) }));
  const flights = toFlightsModel({ ...response, flights: response.flights.filter(row => row.isDemo) });
  store.ingest({ picture: DISABLED, flights });
  const situation = buildSituation({ picture: DISABLED, flights, nowMs: NOON, estimates: store.estimatesAt(NOON),
    estimatesChangeAt: store.nextChangeAt(NOON) });
  return { store, item: situation.byId.get(`f:${KEY.demoArrival}`) };
}

describe('traffic keyframes (PR M2)', () => {
  it('moves the demo approach under 2 px a frame at zoom 15 between writes at 2 Hz, close to the motion store', () => {
    const { store, item } = demoApproach();
    expect(item).toBeDefined();
    const truth = createMotionStore();
    const response = createDemoFlights(createDemoBlock({ appearAt: at(-60) }));
    truth.ingest({ picture: DISABLED, flights: toFlightsModel({ ...response, flights: response.flights.filter(row => row.isDemo) }) });
    const keyframes = createKeyframes();
    const pxM = metresPerPx(15, PUJ[1]);
    let previous = null;
    let maxStepPx = 0;
    let maxErrorM = 0;
    let moved = 0;
    for (let write = at(0); write < at(30); write += WRITE_MS) {
      const [sampled] = store.sample([item], write);
      expect(sampled).not.toBeNull();
      expect(sampled.onGround).toBe(false);
      writeKeyframes(keyframes, { t0Ms: write, t1Ms: write + WRITE_MS, from: [sampled],
        ahead: store.sampleAhead([sampled], write + WRITE_MS) });
      for (let frame = write; frame < write + WRITE_MS; frame += FRAME_MS) {
        const drawn = interpolate(keyframes, frame).get(item.id);
        if (previous !== null) {
          const stepPx = haversineM(point(previous), point(drawn)) / pxM;
          maxStepPx = Math.max(maxStepPx, stepPx);
          moved += stepPx;
        }
        maxErrorM = Math.max(maxErrorM, haversineM(point(drawn), point(truth.sampleOne(item.id, frame, item))));
        previous = drawn;
      }
    }
    // It moves (an approach), smoothly: no frame jumps, across the writes too.
    expect(moved).toBeGreaterThan(100);
    expect(maxStepPx).toBeLessThan(2);
    // Between two writes it stays where the motion store places it, within a pixel.
    expect(maxErrorM).toBeLessThan(pxM);
  });

  it('a frame between writes does not ask the motion store, and sampleAhead changes nothing in it', () => {
    const one = demoApproach();
    const other = demoApproach();
    for (let write = at(0); write < at(10); write += WRITE_MS) {
      const [a] = one.store.sample([one.item], write);
      one.store.sampleAhead([a], write + WRITE_MS);
      one.store.sampleAhead([a], write + 4 * WRITE_MS);
      const [b] = other.store.sample([other.item], write);
      expect(a).toEqual(b);
    }
  });

  it('interpolateOne answers one aircraft as interpolate does, and null for one without a pair', () => {
    const keyframes = createKeyframes();
    writeKeyframes(keyframes, { t0Ms: 0, t1Ms: 500, from: [state(...PUJ, { trackDeg: 90 })],
      ahead: [state(PUJ[0] + 0.001, PUJ[1], { trackDeg: 90 })] });
    for (const t of [0, 125, 250, 500, 800]) expect(interpolateOne(keyframes, 'a', t)).toEqual(interpolate(keyframes, t).get('a'));
    expect(interpolateOne(keyframes, 'gone', 250)).toBeNull();
    expect(interpolateOne(null, 'a', 250)).toBeNull();
  });

  it('turns the short way across north: 359° to 1° passes 0°', () => {
    const keyframes = createKeyframes();
    writeKeyframes(keyframes, { t0Ms: 0, t1Ms: 500, from: [state(...PUJ, { trackDeg: 359 })],
      ahead: [state(PUJ[0] + 0.0001, PUJ[1], { trackDeg: 1 })] });
    expect(interpolate(keyframes, 250).get('a').trackDeg).toBeCloseTo(0, 6);
    expect(interpolate(keyframes, 125).get('a').trackDeg).toBeCloseTo(359.5, 6);
    expect(interpolate(keyframes, 375).get('a').trackDeg).toBeCloseTo(0.5, 6);
    for (let t = 0; t <= 500; t += 25) {
      const deg = interpolate(keyframes, t).get('a').trackDeg;
      expect(deg >= 359 || deg <= 1, `${t} ms: ${deg}`).toBe(true);
    }
  });

  it('holds at its first state before the write and at its last after the next is due, without extrapolating', () => {
    const keyframes = createKeyframes();
    const from = state(...PUJ, { altM: 300, gsMs: 70 });
    const [lon, lat] = destinationPoint(PUJ, 90, 35);
    writeKeyframes(keyframes, { t0Ms: 1_000, t1Ms: 1_500, from: [from], ahead: [state(lon, lat, { altM: 290, gsMs: 68 })] });
    expect(point(interpolate(keyframes, 900).get('a'))).toEqual(PUJ);
    const end = interpolate(keyframes, 1_500).get('a');
    expect(haversineM(point(end), [lon, lat])).toBeLessThan(0.01);
    expect(end).toMatchObject({ altM: 290, gsMs: 68 });
    // A frame or so late it carries on at its end velocity (70 m/s: 3.5 m in 50 ms), then holds.
    const carried = interpolate(keyframes, 1_500 + HOLD_AFTER_MS).get('a');
    expect(haversineM(point(carried), [lon, lat])).toBeCloseTo(3.5, 1);
    for (const late of [1_600, 2_000, 60_000]) {
      expect(point(interpolate(keyframes, late).get('a'))).toEqual(point(carried));
    }
    expect(keyframesMoving(keyframes, 1_200)).toBe(true);
    expect(keyframesMoving(keyframes, 1_500)).toBe(false);
  });

  it('a steady straight path stays straight and on time across writes', () => {
    const keyframes = createKeyframes();
    const start = PUJ;
    const along = seconds => destinationPoint(start, 90, 70 * seconds);
    for (let write = 0; write < 3_000; write += WRITE_MS) {
      const [lon, lat] = along(write / 1000);
      const [lon1, lat1] = along((write + WRITE_MS) / 1000);
      writeKeyframes(keyframes, { t0Ms: write, t1Ms: write + WRITE_MS, from: [state(lon, lat)], ahead: [state(lon1, lat1)] });
      for (const offset of [0, 125, 250, 375]) {
        const drawn = interpolate(keyframes, write + offset).get('a');
        expect(haversineM(point(drawn), along((write + offset) / 1000))).toBeLessThan(0.05);
        expect(drawn.epoch).toBe(0);
      }
    }
  });

  it('absorbs a small difference at a new write, and snaps beyond the motion store snap distances', () => {
    const keyframes = createKeyframes();
    const ahead = destinationPoint(PUJ, 90, 35);
    writeKeyframes(keyframes, { t0Ms: 0, t1Ms: 500, from: [state(...PUJ)], ahead: [state(...ahead)] });
    // The next write finds it 20 m off where it is drawn (a fix blended in): it starts where it is drawn and reaches
    // the motion store's next state at the next write.
    const near = destinationPoint(ahead, 0, 20);
    const nearNext = destinationPoint(near, 90, 35);
    writeKeyframes(keyframes, { t0Ms: 500, t1Ms: 1_000, from: [state(...near)], ahead: [state(...nearNext)] });
    const first = interpolate(keyframes, 500).get('a');
    expect(haversineM(point(first), ahead)).toBeLessThan(0.01);
    expect(first.epoch).toBe(0);
    expect(haversineM(point(interpolate(keyframes, 1_000).get('a')), nearNext)).toBeLessThan(0.01);
    // In the air, beyond 2 NM: it snaps to the motion store's state, and its epoch moves on.
    const far = destinationPoint(nearNext, 0, TRACK_CONFIG.snapAirM + 100);
    writeKeyframes(keyframes, { t0Ms: 1_000, t1Ms: 1_500, from: [state(...far)], ahead: [state(...destinationPoint(far, 90, 35))] });
    const snapped = interpolate(keyframes, 1_000).get('a');
    expect(haversineM(point(snapped), far)).toBeLessThan(0.01);
    expect(snapped.epoch).toBe(1);
    // On the ground 150 m is the limit: 200 m snaps, 100 m does not.
    const ground = createKeyframes();
    const onGround = (lon, lat) => state(lon, lat, { onGround: true, gsMs: 8, altM: 0 });
    writeKeyframes(ground, { t0Ms: 0, t1Ms: 500, from: [onGround(...PUJ)], ahead: [onGround(...PUJ)] });
    writeKeyframes(ground, { t0Ms: 500, t1Ms: 1_000, from: [onGround(...destinationPoint(PUJ, 0, 100))], ahead: [] });
    expect(interpolate(ground, 500).get('a').epoch).toBe(0);
    expect(haversineM(point(interpolate(ground, 500).get('a')), PUJ)).toBeLessThan(0.01);
    const jumped = destinationPoint(PUJ, 0, 300);
    writeKeyframes(ground, { t0Ms: 1_000, t1Ms: 1_500, from: [onGround(...jumped)], ahead: [] });
    expect(interpolate(ground, 1_000).get('a').epoch).toBe(1);
    expect(haversineM(point(interpolate(ground, 1_000).get('a')), jumped)).toBeLessThan(0.01);
  });

  it('a new trail part snaps even when close, and an aircraft no longer drawn leaves', () => {
    const keyframes = createKeyframes();
    writeKeyframes(keyframes, { t0Ms: 0, t1Ms: 500, from: [state(...PUJ)], ahead: [state(...PUJ, { trailEpoch: 0 })] });
    const next = destinationPoint(PUJ, 0, 10);
    writeKeyframes(keyframes, { t0Ms: 500, t1Ms: 1_000, from: [state(...next)], ahead: [state(...next, { trailEpoch: 1 })] });
    const drawn = interpolate(keyframes, 500).get('a');
    expect(drawn.epoch).toBe(1);
    expect(haversineM(point(drawn), next)).toBeLessThan(0.01);
    writeKeyframes(keyframes, { t0Ms: 1_000, t1Ms: 1_500, from: [state(...next, { id: 'b' })], ahead: null });
    expect([...interpolate(keyframes, 1_000).keys()]).toEqual(['b']);
    // Without a later state it holds where the write drew it.
    expect(point(interpolate(keyframes, 1_400).get('b'))).toEqual(next);
  });
});
