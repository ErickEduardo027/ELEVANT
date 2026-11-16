import { describe, expect, it, vi } from 'vitest';
import { createAirPicture, createTrack, TRAFFIC_HEX as HEX, TRAFFIC_NOON } from '../testing/trafficFixtures';
import { toPictureModel, toTrackModel } from './situationModel';
import { createTrailStore, trailBreakMs, trailFeatures } from './trailStore';

const T0 = Date.parse(TRAFFIC_NOON);
const s = seconds => T0 + seconds * 1_000;

// A fix of one aircraft in the map model's shape, moving east 100 m a second along 18.5° N.
const fix = (hex, second, { matched = false, trail = [] } = {}) => ({
  hex, positionAt: s(second), lon: -68.5 + second * 0.00095, lat: 18.5, altM: 900, onGround: false,
  matchedFlightKey: matched ? 'p:5b000000-0000-4000-8000-000000000161' : null, trail,
});
// An air picture model read at `readAt` seconds, asking again every `refresh` seconds.
const picture = (readAt, aircraft, refresh = 10) => ({ serverTime: s(readAt), refreshAfterSeconds: refresh, aircraft });
const point = second => ({ at: s(second), lon: -68.5 + second * 0.00095, lat: 18.5, altM: 900, onGround: false });
const times = parts => parts.map(part => part.map(item => (item.at - T0) / 1_000));

describe('trail store (design E5, contracts 2.7)', () => {
  it('never joins two points more than max(60 s, 3 × refreshAfterSeconds) apart', () => {
    expect([2, 10, 20, 30, 60].map(trailBreakMs)).toEqual([60_000, 60_000, 60_000, 90_000, 180_000]);
    expect(trailBreakMs(undefined)).toBe(60_000);

    // Read every 10 s; the fix stops at 20 s and the next one comes 65 s later.
    const fixes = [0, 10, 20, 20, 20, 20, 20, 20, 20, 85];
    const run = refresh => {
      const store = createTrailStore();
      fixes.forEach((second, index) => store.ingestPicture(picture(index * 10 + 1, [fix('aaa001', second)], refresh)));
      return times(store.segmentsOf('aaa001'));
    };
    expect(run(10)).toEqual([[0, 10, 20], [85]]);
    // With the server asking every 30 s, the limit is 90 s and the same 65 s stay one part.
    expect(run(30)).toEqual([[0, 10, 20, 85]]);
  });

  it('a read after a hidden tab longer than the break starts a new part', () => {
    const run = hiddenSeconds => {
      const store = createTrailStore();
      [0, 10, 20].forEach(second => store.ingestPicture(picture(second + 1, [fix('aaa001', second)])));
      // Back from the hidden tab: the network's newest fix is only 30 s after the last one drawn.
      store.ingestPicture(picture(21 + hiddenSeconds, [fix('aaa001', 50)]));
      store.ingestPicture(picture(31 + hiddenSeconds, [fix('aaa001', 60)]));
      return times(store.segmentsOf('aaa001'));
    };
    expect(run(61)).toEqual([[0, 10, 20], [50, 60]]);
    // A shorter absence keeps one part.
    expect(run(50)).toEqual([[0, 10, 20, 50, 60]]);
  });

  it('the short trail and later reads merge in time order without duplicates', () => {
    const store = createTrailStore();
    store.ingestPicture(picture(1, [fix('aaa001', 0, { trail: [point(-30), point(-20), point(-10)] })]));
    // The same fix read twice, then a later read whose trail repeats points already kept, out of order.
    store.ingestPicture(picture(11, [fix('aaa001', 0)]));
    store.ingestPicture(picture(21, [fix('aaa001', 20, { trail: [point(10), point(-10), point(0)] })]));
    expect(times(store.segmentsOf('aaa001'))).toEqual([[-30, -20, -10, 0, 10, 20]]);

    // From the synthetic picture: the arrival's three short-trail points and its fix, in order.
    const fromFixtures = createTrailStore();
    fromFixtures.ingestPicture(toPictureModel(createAirPicture()));
    expect(times(fromFixtures.segmentsOf(HEX.arrival))).toEqual([[-34, -24, -14, -4]]);
    expect(times(fromFixtures.segmentsOf(HEX.groundInOwnedStand))).toEqual([[-8]]);
  });

  it('keeps at most 600 points for AVIAM and 60 for other traffic', () => {
    const store = createTrailStore();
    // An ELEVANT flight read every second for 700 s, and another aircraft alongside it.
    for (let second = 0; second < 700; second += 1) {
      store.ingestPicture(picture(second + 1, [fix('aaa001', second, { matched: true }), fix('bbb002', second)]));
    }
    const flight = store.segmentsOf('aaa001').flat();
    expect(flight).toHaveLength(600);
    expect(flight[0].at).toBe(s(100));
    const other = store.segmentsOf('bbb002').flat();
    expect(other).toHaveLength(60);
    expect(other.at(-1).at).toBe(s(699));

    // Read every 10 s, other traffic keeps only its last 2 minutes.
    const sparse = createTrailStore();
    for (let second = 0; second <= 300; second += 10) sparse.ingestPicture(picture(second + 1, [fix('bbb002', second)]));
    expect(times(sparse.segmentsOf('bbb002'))[0][0]).toBe(190);
  });

  it('a track read replaces the older part of the trail', () => {
    const store = createTrailStore();
    // Two reads drew the aircraft on a slightly different line.
    const drawn = second => ({ ...fix('bbb002', second), lat: 18.6 });
    [0, 10, 20, 30].forEach(second => store.ingestPicture(picture(second + 1, [drawn(second)])));
    // The server's memory, every 5 s up to 20 s, arrives after the read of 30 s.
    const track = Array.from({ length: 25 }, (_, index) => point(-100 + index * 5));
    store.ingestTrack('BBB002', track);
    const kept = store.segmentsOf('bbb002').flat();
    expect(kept.map(item => (item.at - T0) / 1_000)).toEqual([...track.map(item => (item.at - T0) / 1_000), 30]);
    expect(kept.slice(0, -1).every(item => item.lat === 18.5)).toBe(true);
    expect(kept.at(-1).lat).toBe(18.6);

    // The chosen aircraft keeps its whole trail from then on, beyond the 2 minutes of other traffic.
    for (let second = 40; second <= 200; second += 10) store.ingestPicture(picture(second + 1, [fix('bbb002', second)]));
    expect(store.segmentsOf('bbb002').flat()[0].at).toBe(s(-100));

    // A track of the synthetic fixtures: 30 points up to the arrival's fix.
    const fixtures = createTrailStore();
    fixtures.ingestTrack(HEX.arrival, toTrackModel(createTrack(HEX.arrival)).points);
    expect(fixtures.segmentsOf(HEX.arrival).flat()).toHaveLength(30);
  });

  it('forgets an aircraft absent for longer than the break, and on request', () => {
    const store = createTrailStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.ingestPicture(picture(1, [fix('aaa001', 0), fix('bbb002', 0)]));
    store.ingestPicture(picture(51, [fix('aaa001', 50)]));
    expect(store.segmentsOf('bbb002')).toHaveLength(1);
    store.ingestPicture(picture(71, [fix('aaa001', 70)]));
    expect(store.segmentsOf('bbb002')).toEqual([]);
    expect(store.segmentsOf('aaa001')).toHaveLength(1);

    store.forget(['aaa001']);
    expect(store.segmentsOf('aaa001')).toEqual([]);
    store.ingestPicture(picture(81, [fix('aaa001', 80)]));
    const before = store.getSnapshot();
    store.clear();
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().entries.size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(6);
  });

  it('draws the trails of ELEVANT flights and of the chosen aircraft, and of all traffic only on request', () => {
    const store = createTrailStore();
    for (let second = 0; second <= 200; second += 10) {
      store.ingestPicture(picture(second + 1, [fix('aaa001', second, { matched: true }), fix('bbb002', second),
        fix('ccc003', second)]));
    }
    const drawn = options => trailFeatures(store.getSnapshot(), { aviamHexes: new Set(['aaa001']), nowMs: s(201), ...options })
      .features.map(feature => [feature.properties.hex, feature.properties.kind, feature.geometry.coordinates.length,
        feature.properties.selected]);
    expect(drawn()).toEqual([['aaa001', 'aviam', 21, false]]);
    expect(drawn({ selectedHex: 'BBB002' })).toEqual([['aaa001', 'aviam', 21, false], ['bbb002', 'other', 12, true]]);
    // All traffic: the others' last 2 minutes only.
    expect(drawn({ includeOther: true })).toEqual([['aaa001', 'aviam', 21, false], ['bbb002', 'other', 12, false],
      ['ccc003', 'other', 12, false]]);
    // An aircraft with no fix for longer than the stale limit draws its trail as stale.
    const late = trailFeatures(store.getSnapshot(), { aviamHexes: ['aaa001'], nowMs: s(240) }).features[0].properties;
    expect(late).toMatchObject({ hex: 'aaa001', quality: 'stale' });
    expect(store.features({ aviamHexes: ['aaa001'], nowMs: s(201) }).features[0].properties.quality).toBe('live');
  });
});
