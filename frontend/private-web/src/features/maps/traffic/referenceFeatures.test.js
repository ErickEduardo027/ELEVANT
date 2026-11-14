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
  CENTRELINE_NM, NAVAID_KINDS, RANGE_RINGS_NM, REFERENCE_LEGEND_KINDS, RING_LABEL_BEARING, WIND_MAX_AGE_MINUTES,
  counterpartCodes, extendedCentrelines, mapRunwayInUse, navaidFeatures, rangeRing, recentLiveArrivals,
  referenceFeatures, referenceKindsOnScreen, referencesOnScreen, regionAirportFeatures, runwayInUseLabel, runwayWindOf,
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

// A live aircraft `nm` out on final of the runway end `ident`, flying its heading down to the threshold.
function onFinal(ident, nm = 6, extra = {}) {
  const runway = end(ident);
  const [lon, lat] = destinationPoint(runway.threshold, (runway.headingTrue + 180) % 360, nm * METRES_PER_NM);
  return { id: `h:${ident}-${nm}`, quality: 'live', onGround: false, altM: nm * 100, trackDeg: runway.headingTrue,
    vrateMs: -3.5, lon, lat, ...extra };
}

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
    const plain = referenceFeatures({ runway: usual });
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
    expect(labelOf(referenceFeatures({ runway: byWind }))).toEqual(['Pista 08 (estimada por el viento)']);
    // A westerly wind lands on 26.
    const westerly = mapRunwayInUse({ weather: weatherOf({ wind: { directionDeg: 270, speedKt: 15 } }), nowMs: NOON_MS });
    expect(westerly).toEqual({ arrival: '26', departure: '26', source: 'wind' });
    const fromWest = referenceFeatures({ runway: westerly });
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
    const arrivals = [onFinal('26', 6), onFinal('26', 3)];
    const byArrivals = mapRunwayInUse({ aircraft: arrivals, weather: live, nowMs: NOON_MS });
    expect(byArrivals).toEqual({ arrival: '26', departure: '26', source: 'live' });
    expect(labelOf(referenceFeatures({ runway: byArrivals }))).toEqual(['Pista 26 (según las llegadas)']);

    // In English.
    expect(runwayInUseLabel(byArrivals, 'en')).toBe('Runway 26 (from the arrivals)');
    expect(runwayInUseLabel(byWind, 'en')).toBe('Runway 08 (estimated from the wind)');
    expect(runwayInUseLabel(usual, 'en')).toBe('Runway 08 (usual)');
    expect(runwayInUseLabel({ arrival: '08', source: 'flight' })).toBe('Pista 08');
    expect(runwayInUseLabel({ arrival: null, source: 'default' })).toBeNull();
    expect(referenceFeatures({ runway: { arrival: null, departure: null, source: 'default' } }).features
      .filter(item => item.properties.inUse || item.properties.kind === 'centrelineLabel')).toEqual([]);
  });

  it('recentLiveArrivals keeps live airborne aircraft low and close to PUJ', () => {
    const final = onFinal('08', 6);
    expect(recentLiveArrivals([final])).toEqual([{ trackDeg: end('08').headingTrue }]);
    // Each of these is left out: estimated, stale, on the ground, too high, too far, climbing, without a track or an
    // altitude, and flying away from the airport or across it.
    const away = { ...final, trackDeg: (end('08').headingTrue + 180) % 360 };
    const across = { ...final, trackDeg: (end('08').headingTrue + 90) % 360 };
    const others = [
      { ...final, quality: 'estimated' }, { ...final, quality: 'stale' }, { ...final, onGround: true },
      { ...final, altM: 1200 }, onFinal('08', 13), { ...final, vrateMs: 4 }, { ...final, trackDeg: null },
      { ...final, altM: null }, away, across,
    ];
    for (const item of others) expect(recentLiveArrivals([item]), JSON.stringify(item)).toEqual([]);
    // A level aircraft and one whose climb is unknown still count, as does one on short final.
    expect(recentLiveArrivals([{ ...final, vrateMs: 0 }, { ...final, vrateMs: null }, onFinal('08', 0.5)])).toHaveLength(3);
    // The limits are options: farther and higher with them.
    expect(recentLiveArrivals([onFinal('08', 13)], { maxNm: 15, maxAltM: 2000 })).toHaveLength(1);
    expect(recentLiveArrivals(null)).toEqual([]);
    expect(Object.isFrozen(recentLiveArrivals([final])[0])).toBe(true);
  });

  it('regional airports from region.context.json without PUJ, labelled ICAO and IATA, counterparts of today\'s flights emphasised', () => {
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
    expect(airports).toHaveLength(31);
    expect(airports.map(item => item.properties.icao)).not.toContain('MDPC');
    const byIcao = Object.fromEntries(airports.map(item => [item.properties.icao, item.properties]));
    expect(byIcao.MDSD).toEqual({ kind: 'airport', icao: 'MDSD', iata: 'SDQ', label: 'MDSD SDQ', counterpart: true });
    // An airport without IATA keeps its ICAO code alone; one with no flight today is not emphasised.
    expect(byIcao.MDSI).toMatchObject({ iata: null, label: 'MDSI', counterpart: false });
    expect(byIcao.MDLR).toMatchObject({ label: 'MDLR LRM', counterpart: false });
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

  it('draws no FIR: without an extract of its boundary there is none to invent', () => {
    // The VATSpy file the plan allowed was not available (PR M8 notes), so the map has no FIR layer, key or data.
    expect(existsSync('src/features/maps/airport/data/fir.mdcs.json')).toBe(false);
    const kinds = new Set(referenceFeatures().features.map(item => item.properties.kind));
    expect([...kinds]).toEqual(['arp', 'ring', 'ringLabel', 'centreline', 'tick', 'centrelineLabel', 'airport', 'navaid']);
    expect(REFERENCE_LEGEND_KINDS).not.toContain('fir');
  });

  it('referenceKindsOnScreen reads back the kinds in order', () => {
    const collection = referenceFeatures({ runway: { arrival: '08', departure: '08', source: 'wind' },
      counterparts: ['SDQ'], language: 'es' });
    // As queryRenderedFeatures answers them: in any order, some twice (a feature drawn in two tiles), with other kinds.
    const drawn = [...collection.features].reverse().map(item => ({ properties: item.properties }));
    const night = { properties: { kind: 'night' } };
    expect(referenceKindsOnScreen([night, ...drawn, ...drawn, { properties: { kind: 'runway' } }])).toEqual([
      'rings', 'centrelines', 'runwayInUse', 'airports', 'counterparts', 'vor', 'ndb', 'night',
    ]);
    expect(REFERENCE_LEGEND_KINDS).toEqual(['rings', 'centrelines', 'runwayInUse', 'airports', 'counterparts', 'vor',
      'ndb', 'night']);
    // Only what is there: a ring alone; an airport without a flight today; a centreline that is not the one in use.
    expect(referenceKindsOnScreen([{ properties: { kind: 'ring', scope: 'region' } }])).toEqual(['rings']);
    expect(referenceKindsOnScreen([{ properties: { kind: 'airport', counterpart: false } }])).toEqual(['airports']);
    expect(referenceKindsOnScreen([{ properties: { kind: 'tick', inUse: false } }])).toEqual(['centrelines']);
    expect(referenceKindsOnScreen(null)).toEqual([]);
    // With the runway in use its centreline says.
    expect(referencesOnScreen(drawn)).toEqual({ kinds: ['rings', 'centrelines', 'runwayInUse', 'airports', 'counterparts',
      'vor', 'ndb'], runway: { arrival: '08', source: 'wind' } });
    expect(referencesOnScreen([{ properties: { kind: 'centreline', ident: '26', inUse: false } }]))
      .toEqual({ kinds: ['centrelines'], runway: null });
    // The module reads no clock and no JSON of its own beyond the region context.
    const source = readFileSync('src/features/maps/traffic/referenceFeatures.js', 'utf8');
    expect(source).not.toMatch(/Date\.now|new Date\(\)|fetch\(/);
  });
});
