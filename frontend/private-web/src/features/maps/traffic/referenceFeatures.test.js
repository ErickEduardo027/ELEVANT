import { existsSync, readFileSync } from 'node:fs';
import { OCC_AERODROME_WEATHER_LIMITS } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { toWeatherReading } from '../../../services/weatherService';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, haversineM, initialBearing, METRES_PER_NM } from '../airport/geo';
import { REGION_CONTEXT } from '../airport/regionContext';
import { runwayEnds, runwayInUse } from '../airport/runwayInUse';
import { PUJ_ARP } from '../core/cameraPresets';
import { createAerodromeWeather, WEATHER_NOON } from '../testing/weatherFixtures';
import { createMapFlights } from '../testing/trafficFixtures';
import {
  ARRIVAL_VOTE_MINUTES, CENTRELINE_NM, FINAL_LATERAL_NM, FINAL_MAX_ALT_M, FINAL_NM, NAVAID_KINDS, RANGE_RINGS_NM,
  REFERENCE_LEGEND_KINDS, RING_LABEL_BEARING, WIND_MAX_AGE_MINUTES, arrivalsOnFinal, counterpartCodes,
  extendedCentrelines, finalApproachEnd, mapRunwayInUse, navaidFeatures, ourAirportsFeatures, rangeRing,
  referenceFeatures, referenceKindsOnScreen, referencesOnScreen, regionAirportFeatures, rememberArrivals,
  runwayInUseLabel, runwayWindOf,
} from './referenceFeatures';

// The reference overlays of PR M8 (design E6, contracts 2.3): rings, extended centrelines, the runway in use, the
// region's airports and the navaids, built from the MDPC layout and region.context.json. Synthetic traffic and weather.
const NOON_MS = Date.parse(WEATHER_NOON);
const MINUTE = 60_000;
const ofKind = (collection, kind) => collection.features.filter(item => item.properties.kind === kind);
const nmBetween = (a, b) => haversineM(a, b) / METRES_PER_NM;
const end = ident => runwayEnds(MDPC_LAYOUT).find(item => item.ident === ident);

// The weather as useMdpcWeather answers it, from a synthetic answer of GET occ/weather.
function weatherOf(options = {}) {
  const reading = toWeatherReading(createAerodromeWeather(options), { receivedAt: NOON_MS });
  return { status: reading.observation ? 'success' : 'empty', data: reading.observation, apiStatus: reading.apiStatus };
}

// A live aircraft `nm` out on final of the runway end `ident`, `acrossNm` to the right of its extended centreline as
// seen from the threshold, flying its heading down to the threshold.
function onFinal(ident, nm = 6, extra = {}, acrossNm = 0) {
  const runway = end(ident);
  const outward = (runway.headingTrue + 180) % 360;
  const onLine = destinationPoint(runway.threshold, outward, nm * METRES_PER_NM);
  const [lon, lat] = acrossNm === 0 ? onLine : destinationPoint(onLine, (outward + 90) % 360, acrossNm * METRES_PER_NM);
  return { id: `h:${ident}-${nm}`, quality: 'live', onGround: false, altM: nm * 100, trackDeg: runway.headingTrue,
    vrateMs: -3.5, lon, lat, ...extra };
}
// A live aircraft at `point`, level at 600 m.
const liveAt = ([lon, lat], extra = {}) => ({ id: 'h:other', quality: 'live', onGround: false, altM: 600, vrateMs: 0,
  lon, lat, ...extra });
// The votes of `aircraft` on final at noon, as the map passes them to mapRunwayInUse.
const votesOf = aircraft => arrivalsOnFinal(aircraft, { nowMs: NOON_MS });

describe('reference features', () => {
  it('range rings of 5, 10, 20 and 40 NM in approach and 50 to 250 NM in region, closed, at their radius and labelled «20 NM»', () => {
    expect(RANGE_RINGS_NM).toEqual({ approach: [5, 10, 20, 40], region: [50, 100, 150, 200, 250] });
    const collection = referenceFeatures();
    const rings = ofKind(collection, 'ring');
    expect(rings.map(ring => [ring.properties.scope, ring.properties.radiusNm, ring.properties.label])).toEqual([
      ['region', 50, '50 NM'], ['region', 100, '100 NM'], ['region', 150, '150 NM'], ['region', 200, '200 NM'],
      ['region', 250, '250 NM'], ['approach', 5, '5 NM'], ['approach', 10, '10 NM'], ['approach', 20, '20 NM'],
      ['approach', 40, '40 NM'],
    ]);
    for (const ring of rings) {
      const { coordinates } = ring.geometry;
      expect(ring.geometry.type).toBe('LineString');
      expect(coordinates).toHaveLength(129);
      expect(coordinates.at(-1)).toEqual(coordinates[0]);
      // Every vertex within 0.1 % of its radius from the reference point of PUJ.
      for (const vertex of coordinates) {
        expect(Math.abs(nmBetween(PUJ_ARP, vertex) / ring.properties.radiusNm - 1), ring.properties.label).toBeLessThan(0.001);
      }
    }
    // One label per ring, on the ring, north-east of PUJ.
    const labels = ofKind(collection, 'ringLabel');
    expect(labels.map(label => label.properties.label)).toEqual(rings.map(ring => ring.properties.label));
    for (const label of labels) {
      const point = label.geometry.coordinates;
      expect(nmBetween(PUJ_ARP, point)).toBeCloseTo(label.properties.radiusNm, 1);
      expect(initialBearing(PUJ_ARP, point)).toBeCloseTo(RING_LABEL_BEARING, 0);
    }
    expect(rangeRing(PUJ_ARP, 20, 8)).toHaveLength(9);
  });

  it('extended centrelines run 10 NM out from each threshold with a tick per NM, longer at 5 and 10', () => {
    const features = extendedCentrelines(MDPC_LAYOUT, { runway: runwayInUse({ layout: MDPC_LAYOUT }) });
    const lines = features.filter(item => item.properties.kind === 'centreline');
    // One per runway end of the layout: 08, 26, 09 and 27.
    expect(lines.map(item => item.properties.ident)).toEqual(['08', '26', '09', '27']);
    for (const centreline of lines) {
      const runway = end(centreline.properties.ident);
      const [from, to] = centreline.geometry.coordinates;
      expect(nmBetween(from, runway.threshold)).toBeLessThan(0.001);
      expect(nmBetween(from, to)).toBeCloseTo(CENTRELINE_NM, 3);
      // Out along the approach: the opposite of the runway's heading.
      expect(initialBearing(from, to)).toBeCloseTo((runway.headingTrue + 180) % 360, 1);
      const ticks = features.filter(item => item.properties.kind === 'tick' && item.properties.ident === runway.ident);
      expect(ticks.map(tick => tick.properties.nm)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(ticks.filter(tick => tick.properties.major).map(tick => tick.properties.nm)).toEqual([5, 10]);
      for (const tick of ticks) {
        const [a, b] = tick.geometry.coordinates;
        const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        // Across the line at its mile, longer at 5 and 10.
        expect(nmBetween(runway.threshold, middle)).toBeCloseTo(tick.properties.nm, 2);
        expect(nmBetween(a, b)).toBeCloseTo(tick.properties.major ? 0.7 : 0.3, 2);
        const across = Math.abs(((initialBearing(a, b) - runway.headingTrue + 540) % 360) - 180);
        expect(Math.abs(across - 90)).toBeLessThan(0.5);
      }
    }
    // A layout without runways has no centrelines.
    expect(extendedCentrelines({ runways: [] })).toEqual([]);
  });

  it('the runway in use is emphasised and labelled by its source: arrivals, wind (Live only) or the usual 08', () => {
    const inUse = collection => ofKind(collection, 'centreline').filter(item => item.properties.inUse)
      .map(item => [item.properties.ident, item.properties.source]);
    const labelOf = collection => ofKind(collection, 'centrelineLabel').map(item => item.properties.label);

    // Nothing known: the usual 08 (owner decision 19).
    const usual = mapRunwayInUse({ nowMs: NOON_MS });
    expect(usual).toEqual({ arrival: '08', departure: '08', source: 'default' });
    const plain = ourAirportsFeatures({ runway: usual });
    expect(inUse(plain)).toEqual([['08', 'default']]);
    expect(labelOf(plain)).toEqual(['Pista 08 (habitual)']);
    // Its label sits past the end of its centreline, its text running on to the west, away from the airport.
    const [label] = ofKind(plain, 'centrelineLabel');
    expect(label.properties.anchor).toBe('right');
    expect(nmBetween(end('08').threshold, label.geometry.coordinates)).toBeGreaterThan(CENTRELINE_NM);
    // Every tick of the runway in use is emphasised with its line; the other ends are not.
    expect(ofKind(plain, 'tick').filter(tick => tick.properties.inUse).every(tick => tick.properties.ident === '08')).toBe(true);
    expect(ofKind(plain, 'tick').filter(tick => tick.properties.inUse)).toHaveLength(10);

    // A live METAR with the wind of 100° at 13 kt: the most head wind is on 09, which lands the flow on 08.
    const live = weatherOf();
    expect(runwayWindOf(live, NOON_MS)).toEqual({ directionDeg: 100, speedMs: expect.closeTo(6.69, 2) });
    const byWind = mapRunwayInUse({ weather: live, nowMs: NOON_MS });
    expect(byWind).toEqual({ arrival: '08', departure: '08', source: 'wind' });
    expect(labelOf(ourAirportsFeatures({ runway: byWind }))).toEqual(['Pista 08 (estimada por el viento)']);
    // A westerly wind lands on 26.
    const westerly = mapRunwayInUse({ weather: weatherOf({ wind: { directionDeg: 270, speedKt: 15 } }), nowMs: NOON_MS });
    expect(westerly).toEqual({ arrival: '26', departure: '26', source: 'wind' });
    const fromWest = ourAirportsFeatures({ runway: westerly });
    expect(inUse(fromWest)).toEqual([['26', 'wind']]);
    expect(labelOf(fromWest)).toEqual(['Pista 26 (estimada por el viento)']);
    expect(ofKind(fromWest, 'centrelineLabel')[0].properties.anchor).toBe('left');
    // Only a Live METAR counts, and only while it is no older than the API's live limit.
    expect(WIND_MAX_AGE_MINUTES).toBe(OCC_AERODROME_WEATHER_LIMITS.liveMetarMinutes);
    const stale = weatherOf({ status: 'Stale', wind: { directionDeg: 270, speedKt: 15 } });
    expect(runwayWindOf(stale, NOON_MS)).toBeNull();
    expect(mapRunwayInUse({ weather: stale, nowMs: NOON_MS }).source).toBe('default');
    const westerlyLive = weatherOf({ wind: { directionDeg: 270, speedKt: 15 } });
    expect(runwayWindOf(westerlyLive, NOON_MS + 80 * MINUTE)).not.toBeNull();
    expect(runwayWindOf(westerlyLive, NOON_MS + 81 * MINUTE)).toBeNull();
    expect(runwayWindOf(weatherOf({ status: 'Unavailable' }), NOON_MS)).toBeNull();
    expect(runwayWindOf(null, NOON_MS)).toBeNull();
    // Calm says nothing.
    expect(mapRunwayInUse({ weather: weatherOf({ wind: { directionDeg: 0, speedKt: 0 } }), nowMs: NOON_MS }).source).toBe('default');

    // Live arrivals on final win over the wind: two on 26 against a wind for 08.
    const arrivals = [onFinal('26', 6, { id: 'h:a' }), onFinal('26', 3, { id: 'h:b' })];
    const byArrivals = mapRunwayInUse({ arrivals: votesOf(arrivals), weather: live, nowMs: NOON_MS });
    expect(byArrivals).toEqual({ arrival: '26', departure: '26', source: 'live' });
    expect(labelOf(ourAirportsFeatures({ runway: byArrivals }))).toEqual(['Pista 26 (según las llegadas)']);

    // In English.
    expect(runwayInUseLabel(byArrivals, 'en')).toBe('Runway 26 (from the arrivals)');
    expect(runwayInUseLabel(byWind, 'en')).toBe('Runway 08 (estimated from the wind)');
    expect(runwayInUseLabel(usual, 'en')).toBe('Runway 08 (usual)');
    expect(runwayInUseLabel({ arrival: '08', source: 'flight' })).toBe('Pista 08');
    expect(runwayInUseLabel({ arrival: null, source: 'default' })).toBeNull();
    expect(ourAirportsFeatures({ runway: { arrival: null, departure: null, source: 'default' } }).features
      .filter(item => item.properties.inUse || item.properties.kind === 'centrelineLabel')).toEqual([]);
  });

  it('a live arrival counts only on final: on the extended centreline of a runway end, flying its course', () => {
    expect([FINAL_NM, FINAL_LATERAL_NM, FINAL_MAX_ALT_M]).toEqual([12, 1, 1000]);
    // On final for each runway end, from 12 NM out down to short final.
    for (const ident of ['08', '26', '09', '27']) {
      for (const nm of [0.5, 6, 11.9]) expect(finalApproachEnd(onFinal(ident, nm, { altM: 300 }))?.ident, `${ident} ${nm}`).toBe(ident);
    }
    // Up to 1 NM either side of the centreline and 10° off its course (airport/runwayInUse.js: ALIGNED_DEG).
    expect(finalApproachEnd(onFinal('08', 6, {}, 0.9))?.ident).toBe('08');
    expect(finalApproachEnd(onFinal('08', 6, {}, -0.9))?.ident).toBe('08');
    expect(finalApproachEnd(onFinal('08', 6, {}, 1.1))).toBeNull();
    expect(finalApproachEnd(onFinal('08', 6, {}, -1.1))).toBeNull();
    expect(finalApproachEnd(onFinal('26', 6, { trackDeg: end('26').headingTrue + 9 }))?.ident).toBe('26');
    expect(finalApproachEnd(onFinal('26', 6, { trackDeg: end('26').headingTrue + 11 }))).toBeNull();
    // Not beyond 12 NM, nor past the threshold over the runway.
    expect(finalApproachEnd(onFinal('08', 12.5))).toBeNull();
    expect(finalApproachEnd(onFinal('08', -0.5, { altM: 30 }))).toBeNull();

    // 08 in use, and an aircraft joining its downwind from the east: westbound at 262°, level at 600 m, 6 NM out along
    // 26 and 3 NM north of it. It flies towards PUJ and within 10° of 26 and 27, but on neither final: no vote, and the
    // wind still lands on 08 (the review of PR M8).
    const thresholdOf26 = end('26').threshold;
    const downwind = liveAt(destinationPoint(destinationPoint(thresholdOf26, 73.8, 6 * METRES_PER_NM), 343.8, 3 * METRES_PER_NM),
      { trackDeg: 262 });
    expect(finalApproachEnd(downwind)).toBeNull();
    expect(mapRunwayInUse({ arrivals: votesOf([downwind]), weather: weatherOf(), nowMs: NOON_MS }))
      .toEqual({ arrival: '08', departure: '08', source: 'wind' });
    // The same downwind further on, at 460 m and 900 m, 5 to 10 NM east of the field: never a vote.
    for (const nm of [5, 7.5, 10]) {
      for (const altM of [460, 900]) {
        const point = destinationPoint(destinationPoint(thresholdOf26, 73.8, nm * METRES_PER_NM), 343.8, 3 * METRES_PER_NM);
        expect(finalApproachEnd(liveAt(point, { altM, trackDeg: 258 })), `${nm} NM ${altM} m`).toBeNull();
      }
    }
    // An aircraft from the south-east flying west, towards PUJ and within 10° of 27's course but 4 NM south of its
    // centreline; and one on a base leg for 08.
    const southEast = liveAt(destinationPoint(PUJ_ARP, 115, 8 * METRES_PER_NM), { trackDeg: 270 });
    expect(finalApproachEnd(southEast)).toBeNull();
    expect(mapRunwayInUse({ arrivals: votesOf([southEast]), nowMs: NOON_MS }).source).toBe('default');
    expect(finalApproachEnd(onFinal('08', 5, { trackDeg: (end('08').headingTrue + 90) % 360 }))).toBeNull();
    // One on final for 08: it votes, and lands the flow on 08 against a westerly wind.
    const westerly = weatherOf({ wind: { directionDeg: 270, speedKt: 15 } });
    expect(mapRunwayInUse({ arrivals: votesOf([onFinal('08', 6)]), weather: westerly, nowMs: NOON_MS }))
      .toEqual({ arrival: '08', departure: '08', source: 'live' });

    // Each of these is left out: estimated, stale, demo, on the ground, too high, climbing, without a track, an altitude
    // or a position, and flying away from the airport.
    const final = onFinal('08', 6);
    const others = [
      { ...final, quality: 'estimated' }, { ...final, quality: 'stale' }, { ...final, isDemo: true },
      { ...final, onGround: true }, { ...final, altM: 1200 }, { ...final, vrateMs: 4 }, { ...final, trackDeg: null },
      { ...final, altM: null }, { ...final, lon: null }, { ...final, trackDeg: (end('08').headingTrue + 180) % 360 },
    ];
    for (const item of others) expect(finalApproachEnd(item), JSON.stringify(item)).toBeNull();
    // A level aircraft and one whose climb is unknown still count.
    expect(finalApproachEnd({ ...final, vrateMs: 0 })?.ident).toBe('08');
    expect(finalApproachEnd({ ...final, vrateMs: null })?.ident).toBe('08');
    expect(finalApproachEnd(null)).toBeNull();
    // A layout without runways has no final.
    expect(finalApproachEnd(final, { runways: [] })).toBeNull();
  });

  it('arrivalsOnFinal gives each arrival on final its vote: its address, its runway end, that course and its instant', () => {
    const votes = arrivalsOnFinal([
      onFinal('26', 6, { hex: 'aa0001', id: 'f:p:1', positionAt: NOON_MS - 5_000 }),
      onFinal('27', 4, { hex: null, id: 'h:bb0002' }),
      // Off the centreline, or without an address or an id: no vote.
      onFinal('26', 6, { hex: 'cc0003' }, 2),
      onFinal('08', 6, { hex: null, id: null }),
    ], { nowMs: NOON_MS });
    expect(votes).toEqual([
      { key: 'aa0001', ident: '26', trackDeg: end('26').headingTrue, at: NOON_MS - 5_000 },
      { key: 'h:bb0002', ident: '27', trackDeg: end('27').headingTrue, at: NOON_MS },
    ]);
    expect(Object.isFrozen(votes) && votes.every(vote => Object.isFrozen(vote))).toBe(true);
    // Each votes for its own end: the course of its final, whatever its track within 10° of it.
    expect(mapRunwayInUse({ arrivals: arrivalsOnFinal([onFinal('27', 4, { trackDeg: 258 })], { nowMs: NOON_MS }) }).arrival)
      .toBe('27');
    // Without an instant, a position without its own time has none.
    expect(arrivalsOnFinal([onFinal('08', 6)])[0].at).toBeNull();
    expect(arrivalsOnFinal(null)).toEqual([]);
  });

  it('the vote of an arrival lasts ten minutes of the server clock: through its landing and until the next arrival', () => {
    expect(ARRIVAL_VOTE_MINUTES).toBe(10);
    const live = weatherOf();
    const runwayAt = (votes, nowMs) => mapRunwayInUse({ arrivals: votes, weather: live, nowMs });
    // 12:00: an arrival on final for 26 against the METAR's wind for 08.
    const arrival = onFinal('26', 4, { hex: 'aa0001', id: 'h:aa0001', positionAt: NOON_MS });
    const first = rememberArrivals([], [arrival], { nowMs: NOON_MS });
    expect(first).toEqual([{ key: 'aa0001', ident: '26', trackDeg: end('26').headingTrue, at: NOON_MS }]);
    expect(runwayAt(first, NOON_MS)).toEqual({ arrival: '26', departure: '26', source: 'live' });
    // 12:03: it has landed, so it votes no more, and its vote stays.
    const landed = rememberArrivals(first, [{ ...arrival, onGround: true, altM: 0, positionAt: NOON_MS + 3 * MINUTE }],
      { nowMs: NOON_MS + 3 * MINUTE });
    expect(landed).toEqual(first);
    // 12:06: it is no longer in the picture; the runway is still 26 by the arrivals.
    const gone = rememberArrivals(landed, [], { nowMs: NOON_MS + 6 * MINUTE });
    expect(gone).toEqual(first);
    expect(runwayAt(gone, NOON_MS + 6 * MINUTE).source).toBe('live');
    // Ten minutes after its last position on final the vote still counts; a moment later the wind decides again.
    expect(runwayAt(gone, NOON_MS + 10 * MINUTE)).toEqual({ arrival: '26', departure: '26', source: 'live' });
    expect(runwayAt(gone, NOON_MS + 10 * MINUTE + 1)).toEqual({ arrival: '08', departure: '08', source: 'wind' });
    expect(rememberArrivals(gone, [], { nowMs: NOON_MS + 11 * MINUTE })).toEqual([]);

    // The next arrival keeps the runway from the arrivals: at 12:08 another one on final for 26.
    const next = onFinal('26', 6, { hex: 'aa0002', positionAt: NOON_MS + 8 * MINUTE });
    const both = rememberArrivals(gone, [next], { nowMs: NOON_MS + 8 * MINUTE });
    expect(both.map(vote => vote.key)).toEqual(['aa0001', 'aa0002']);
    const later = rememberArrivals(both, [], { nowMs: NOON_MS + 15 * MINUTE });
    expect(later.map(vote => vote.key)).toEqual(['aa0002']);
    expect(runwayAt(later, NOON_MS + 15 * MINUTE).source).toBe('live');
    // One vote per aircraft, its newest: the same aircraft on final for 27 at 12:09 votes for 27 alone; an older
    // position of it changes nothing.
    const moved = rememberArrivals(both, [onFinal('27', 3, { hex: 'aa0002', positionAt: NOON_MS + 9 * MINUTE })],
      { nowMs: NOON_MS + 9 * MINUTE });
    expect(moved.map(vote => [vote.key, vote.ident])).toEqual([['aa0001', '26'], ['aa0002', '27']]);
    expect(rememberArrivals(moved, [onFinal('26', 8, { hex: 'aa0002', positionAt: NOON_MS + 7 * MINUTE })],
      { nowMs: NOON_MS + 9 * MINUTE })).toEqual(moved);
    // Frozen; anything that is not a vote is dropped.
    expect(Object.isFrozen(moved)).toBe(true);
    expect(rememberArrivals([null, { key: 'x' }, ...first], null, { nowMs: NOON_MS })).toEqual(first);
    expect(mapRunwayInUse({ arrivals: [{ trackDeg: end('26').headingTrue }], weather: live, nowMs: NOON_MS }).source)
      .toBe('wind');
  });

  it('regional airports from region.context.json with MDPC as the home one, labelled ICAO/IATA, counterparts of today\'s flights emphasised', () => {
    // Today's flights of the fixtures come from Miami, New York and Toronto; one more, invented, from Santo Domingo.
    const { flights } = createMapFlights();
    const sdq = { ...flights[0], flightKey: 'p:sdq', counterpart: { iataCode: 'SDQ', icaoCode: 'MDSD',
      name: 'Las Américas', latitude: 18.43, longitude: -69.67 } };
    const cancelled = { ...flights[0], flightKey: 'p:cancelled', phase: 'cancelled',
      counterpart: { iataCode: 'SJU', icaoCode: 'TJSJ', name: 'San Juan', latitude: 18.44, longitude: -66 } };
    const codes = counterpartCodes([...flights, sdq, cancelled, null]);
    expect(codes).toEqual(['CYYZ', 'JFK', 'KJFK', 'KMIA', 'MDSD', 'MIA', 'SDQ', 'YYZ']);
    expect(counterpartCodes(undefined)).toEqual([]);

    const airports = regionAirportFeatures(REGION_CONTEXT, { counterparts: codes });
    expect(REGION_CONTEXT.airports).toHaveLength(32);
    expect(airports).toHaveLength(32);
    const byIcao = Object.fromEntries(airports.map(item => [item.properties.icao, item.properties]));
    // The home airport is drawn too, by its ICAO code, and never as a counterpart.
    expect(byIcao.MDPC).toMatchObject({ airportKind: 'home', label: 'MDPC', counterpart: false });
    expect(byIcao.MDSD).toEqual({ kind: 'airport', airportKind: 'international', icao: 'MDSD', iata: 'SDQ',
      label: 'MDSD/SDQ', counterpart: true });
    // An airport without IATA keeps its ICAO code alone; one with no flight today is not emphasised.
    expect(byIcao.MDSI).toMatchObject({ iata: null, label: 'MDSI', counterpart: false });
    expect(byIcao.MDLR).toMatchObject({ label: 'MDLR/LRM', counterpart: false });
    expect(byIcao.TJSJ.counterpart).toBe(false);
    expect(airports.filter(item => item.properties.counterpart).map(item => item.properties.icao)).toEqual(['MDSD']);
    // Each at its point of the region context.
    const santoDomingo = REGION_CONTEXT.airports.find(item => item.icao === 'MDSD');
    expect(airports.find(item => item.properties.icao === 'MDSD').geometry.coordinates).toEqual(santoDomingo.p);
    // Without counterparts none is emphasised.
    expect(regionAirportFeatures(REGION_CONTEXT).some(item => item.properties.counterpart)).toBe(false);
  });

  it('navaids PNA and PCA with ident, type and frequency in Spanish and English', () => {
    expect(navaidFeatures(REGION_CONTEXT, 'es').map(item => item.properties)).toEqual([
      { kind: 'navaid', ident: 'PNA', type: 'VOR-DME', label: 'PNA VOR-DME 112,7' },
      { kind: 'navaid', ident: 'PCA', type: 'NDB', label: 'PCA NDB 425' },
    ]);
    expect(navaidFeatures(REGION_CONTEXT, 'en').map(item => item.properties.label)).toEqual(['PNA VOR-DME 112.7', 'PCA NDB 425']);
    expect(navaidFeatures(REGION_CONTEXT).map(item => item.geometry.coordinates))
      .toEqual(REGION_CONTEXT.navaids.map(item => item.p));
    // Only the types the map has a symbol for.
    expect(Object.keys(NAVAID_KINDS)).toEqual(['VOR-DME', 'NDB']);
    expect(navaidFeatures({ navaids: [{ ident: 'XYZ', type: 'TACAN', frequencyKhz: 1, p: [-68, 18] }] })).toEqual([]);
  });

  it('splits the references by source: the reference point and the rings, and what is drawn from OurAirports', () => {
    const kindsOf = collection => [...new Set(collection.features.map(item => item.properties.kind))];
    // The reference point of PUJ and the rings around it: the same at every instant and in every language.
    expect(kindsOf(referenceFeatures())).toEqual(['arp', 'ring', 'ringLabel']);
    expect(referenceFeatures()).toEqual(referenceFeatures());
    // From OurAirports: the centrelines, drawn from the thresholds and headings of the runway ends (its rows, in the
    // layout's sources), the airports of the region and the navaids (region.context.json).
    expect(kindsOf(ourAirportsFeatures())).toEqual(['centreline', 'tick', 'centrelineLabel', 'airport', 'navaid']);
    expect(MDPC_LAYOUT.meta.sources.map(source => source.id)).toContain('ourairports');
    expect(REGION_CONTEXT.meta.source).toBe('OurAirports');
  });

  it('draws no FIR: without an extract of its boundary there is none to invent', () => {
    // The VATSpy file the plan allowed was not available (PR M8 notes), so the map has no FIR layer, key or data.
    expect(existsSync('src/features/maps/airport/data/fir.mdcs.json')).toBe(false);
    const kinds = new Set([...referenceFeatures().features, ...ourAirportsFeatures().features].map(item => item.properties.kind));
    expect([...kinds]).toEqual(['arp', 'ring', 'ringLabel', 'centreline', 'tick', 'centrelineLabel', 'airport', 'navaid']);
    expect(REFERENCE_LEGEND_KINDS).not.toContain('fir');
  });

  it('referenceKindsOnScreen reads back the kinds in order', () => {
    const collection = { features: [...referenceFeatures().features, ...ourAirportsFeatures({
      runway: { arrival: '08', departure: '08', source: 'wind' }, counterparts: ['SDQ'], language: 'es' }).features] };
    // As queryRenderedFeatures answers them: in any order, some twice (a feature drawn in two tiles), with other kinds.
    const drawn = [...collection.features].reverse().map(item => ({ properties: item.properties }));
    const night = { properties: { kind: 'night' } };
    expect(referenceKindsOnScreen([night, ...drawn, ...drawn, { properties: { kind: 'runway' } }])).toEqual([
      'rings', 'centrelines', 'runwayInUse', 'counterparts', 'vor', 'ndb', 'night',
    ]);
    expect(REFERENCE_LEGEND_KINDS).toEqual(['rings', 'centrelines', 'runwayInUse', 'counterparts', 'vor', 'ndb', 'night']);
    // Only what is there: a ring alone; a centreline that is not the one in use. An airport without a flight today is
    // listed by its kind while its layer is on (ui/MapLegend.jsx), not from the map.
    expect(referenceKindsOnScreen([{ properties: { kind: 'ring', scope: 'region' } }])).toEqual(['rings']);
    expect(referenceKindsOnScreen([{ properties: { kind: 'airport', counterpart: false } }])).toEqual([]);
    expect(referenceKindsOnScreen([{ properties: { kind: 'tick', inUse: false } }])).toEqual(['centrelines']);
    expect(referenceKindsOnScreen(null)).toEqual([]);
    // With the runway in use its centreline says.
    expect(referencesOnScreen(drawn)).toEqual({ kinds: ['rings', 'centrelines', 'runwayInUse', 'counterparts',
      'vor', 'ndb'], runway: { arrival: '08', source: 'wind' } });
    expect(referencesOnScreen([{ properties: { kind: 'centreline', ident: '26', inUse: false } }]))
      .toEqual({ kinds: ['centrelines'], runway: null });
    // The module reads no clock and no JSON of its own beyond the region context.
    const source = readFileSync('src/features/maps/traffic/referenceFeatures.js', 'utf8');
    expect(source).not.toMatch(/Date\.now|new Date\(\)|fetch\(/);
  });
});
