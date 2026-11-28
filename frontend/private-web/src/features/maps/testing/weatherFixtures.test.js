import { isOccAerodromeWeather, OCC_AERODROME_WEATHER_STATUSES } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import regionContext from '../airport/data/region.context.json';
import { TRAFFIC_NOON, TRAFFIC_STATION_ID } from './trafficFixtures';
import {
  createAerodromeWeather, createRadarFrames, createRegionWeather, createSigmets, createWeatherScenario, createWindGrid,
  REGION_CREDIT, REGION_STATIONS, WEATHER_CREDIT, WEATHER_NOON, WEATHER_OBSERVED_AT, WEATHER_STATION_ID, WEATHER_TAF_RAW,
} from './weatherFixtures';

describe('synthetic aerodrome weather fixtures', () => {
  it('every synthetic answer passes isOccAerodromeWeather for its station', () => {
    expect([WEATHER_NOON, WEATHER_STATION_ID]).toEqual([TRAFFIC_NOON, TRAFFIC_STATION_ID]);
    for (const status of OCC_AERODROME_WEATHER_STATUSES) {
      const answer = createAerodromeWeather({ status });
      expect(isOccAerodromeWeather(answer, WEATHER_STATION_ID), status).toBe(true);
      expect(answer.source, status).toEqual(WEATHER_CREDIT);
    }
    // The four cases: Live observed at 14:50Z and Stale at 12:00Z, both with their TAF; Unavailable without a METAR
    // and with the TAF; Disabled with neither and never retrieved.
    const [live, stale, unavailable, disabled] = OCC_AERODROME_WEATHER_STATUSES.map(status => createAerodromeWeather({ status }));
    expect([live.metar.observedAt, stale.metar.observedAt]).toEqual(['2026-11-13T14:50:00.000Z', '2026-11-13T12:00:00.000Z']);
    expect(WEATHER_OBSERVED_AT).toEqual({ Live: live.metar.observedAt, Stale: stale.metar.observedAt });
    expect(live.metar.raw).toBe('MDPC 131450Z 10013KT 9999 SCT020 29/22 Q1015');
    expect(stale.metar.raw).toBe('MDPC 131200Z 10013KT 9999 SCT020 29/22 Q1015');
    expect([unavailable.metar, unavailable.taf?.raw, unavailable.retrievedAt]).toEqual([null, WEATHER_TAF_RAW, '2026-11-13T14:57:00.000Z']);
    expect([disabled.metar, disabled.taf, disabled.retrievedAt]).toEqual([null, null, null]);
    expect(live.taf.periods.map(period => [period.change, period.from, period.to])).toEqual([
      [null, '2026-11-13T12:00:00.000Z', '2026-11-13T22:00:00.000Z'],
      ['TEMPO', '2026-11-13T16:00:00.000Z', '2026-11-13T20:00:00.000Z'],
      ['FM', '2026-11-13T22:00:00.000Z', '2026-11-14T12:00:00.000Z'],
      ['PROB', '2026-11-14T04:00:00.000Z', '2026-11-14T08:00:00.000Z'],
    ]);

    // The options keep every answer valid: another wind writes the report's group too, and no TAF is null.
    const gusty = createAerodromeWeather({ wind: { directionDeg: 270, speedKt: 18, gustKt: 28 }, taf: null });
    expect(isOccAerodromeWeather(gusty, WEATHER_STATION_ID)).toBe(true);
    expect(gusty.metar.raw).toBe('MDPC 131450Z 27018G28KT 9999 SCT020 29/22 Q1015');
    expect([gusty.metar.windDirectionDegrees, gusty.metar.windSpeedKnots, gusty.metar.windGustKnots, gusty.taf])
      .toEqual([270, 18, 28, null]);
    const variable = createAerodromeWeather({ status: 'Stale', wind: { variable: true, speedKt: 3 } });
    expect(isOccAerodromeWeather(variable, WEATHER_STATION_ID)).toBe(true);
    expect([variable.metar.raw.split(' ')[2], variable.metar.windDirectionDegrees]).toEqual(['VRB03KT', null]);

    const scenario = createWeatherScenario({ status: 'Unavailable' });
    expect(scenario.at).toBe(WEATHER_NOON);
    expect(scenario.failure).toBeNull();
    expect(isOccAerodromeWeather(scenario.weather, WEATHER_STATION_ID)).toBe(true);
  });

  it('holds invented data only, and the credit of the weather service', () => {
    expect(WEATHER_CREDIT).toEqual({ name: 'NOAA Aviation Weather Center', homeUrl: 'https://aviationweather.gov' });
    // The same invented station as the traffic fixtures; its airport is MDPC.
    expect(createAerodromeWeather().icaoCode).toBe('MDPC');
    expect(WEATHER_STATION_ID).toMatch(/^5a000000-0000-4000-8000-/);
  });
});

describe('synthetic regional weather fixtures (lane M7)', () => {
  const ENVELOPE = ['stationId', 'status', 'reason', 'serverTime', 'refreshAfterSeconds', 'credit'];

  it('answer in the shapes of lane M6 in their four states', () => {
    for (const status of ['Live', 'Stale', 'Unavailable', 'Disabled']) {
      const answers = [createRegionWeather({ status }), createSigmets({ status }), createRadarFrames({ status }),
        createWindGrid({ status })];
      for (const answer of answers) {
        expect(Object.keys(answer).slice(0, ENVELOPE.length), status).toEqual(ENVELOPE);
        expect([answer.stationId, answer.status, answer.credit], status).toEqual([WEATHER_STATION_ID, status, REGION_CREDIT]);
      }
      const reporting = status === 'Live' || status === 'Stale';
      expect(answers[0].stations.length > 0, status).toBe(reporting);
      expect(answers[1].sigmets.length > 0, status).toBe(reporting);
      expect(answers[2].frames.length > 0, status).toBe(reporting);
      expect(answers[3].grid !== null, status).toBe(reporting);
    }
    expect(createRegionWeather().reason).toBeNull();
    expect(createRegionWeather({ status: 'Disabled' }).reason).toBe('disabled');
  });

  it('places the invented reports at the real airports of the region', () => {
    const airports = new Map(regionContext.airports.map(airport => [airport.icao, airport.p]));
    for (const station of REGION_STATIONS) expect(station.p, station.icao).toEqual(airports.get(station.icao));
    const [mdpc] = createRegionWeather().stations;
    expect(Object.keys(mdpc)).toEqual(['icao', 'iata', 'name', 'latitude', 'longitude', 'metar', 'taf']);
    expect(Object.keys(mdpc.metar)).toEqual(['raw', 'observedAt', 'windDirectionDegrees', 'windSpeedKnots', 'windGustKnots',
      'visibilityStatuteMiles', 'ceilingFeet', 'flightCategory', 'temperatureCelsius', 'dewpointCelsius',
      'altimeterHectopascals']);
    expect(mdpc.metar.raw).toBe('MDPC 131450Z 10013KT 9999 SCT020 28/22 Q1014');
    expect(Object.keys(mdpc.taf)).toEqual(['raw', 'issuedAt', 'validFrom', 'validTo']);
    expect(createRegionWeather().stations.find(station => station.icao === 'MDCY').metar).toBeNull();
    const [sigmet] = createSigmets().sigmets;
    expect(Object.keys(sigmet)).toEqual(['id', 'firId', 'hazard', 'qualifier', 'validFrom', 'validTo', 'baseFeet', 'topFeet',
      'raw', 'polygon']);
    const radar = createRadarFrames();
    expect([radar.provider, radar.maxZoom, radar.frames.length]).toEqual(['iem-tjua', 8, 8]);
    expect(radar.frames.every(frame => frame.tileUrlTemplate.startsWith('https://mesonet.agron.iastate.edu/'))).toBe(true);
    expect(createWindGrid().grid.points).toHaveLength(9);
  });
});
