import { afterEach, expect, it, vi } from 'vitest';
import { WeatherUnavailableError, loadCurrentObservation, loadRecentMetars } from './weatherService';
import { isObservationStale, observationAgeMinutes } from '../features/weather/useMdpcWeather';

const currents = { data: [{ station: 'MDPC', utc_valid: '2026-10-11T19:00:00Z',
  raw: 'MDPC 111900Z 10013KT 9999 FEW022 30/23 Q1015', relh: 66.2, feel: 93.5, phour: 0 }] };

function mockFetch(response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

afterEach(() => vi.unstubAllGlobals());

it('reads the public MDPC observation without credentials and decodes its METAR', async () => {
  mockFetch({ ok: true, json: async () => currents });
  const observation = await loadCurrentObservation();
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('https://mesonet.agron.iastate.edu/api/1/currents.json?station=MDPC');
  expect(init.credentials).toBe('omit');
  expect(observation.observedAt).toBe('2026-10-11T19:00:00Z');
  expect(observation.metar).toMatchObject({ temperatureC: 30, qnhHpa: 1015, wind: { directionDeg: 100, speedKt: 13 } });
  expect(observation.derived).toEqual({ relativeHumidity: 66, feelsLikeC: 34, precipitationLastHourIn: 0 });
  expect(observation.source.official).toBe(false);
});

it('discards impossible derived humidity and negative precipitation', async () => {
  mockFetch({ ok: true, json: async () => ({ data: [{ ...currents.data[0], relh: 125, phour: -1 }] }) });
  const observation = await loadCurrentObservation();
  expect(observation.derived.relativeHumidity).toBeNull();
  expect(observation.derived.precipitationLastHourIn).toBeNull();
});

it('fails explicitly on empty, malformed or unreachable responses', async () => {
  mockFetch({ ok: true, json: async () => ({ data: [] }) });
  await expect(loadCurrentObservation()).rejects.toMatchObject({ reason: 'empty' });
  mockFetch({ ok: false, json: async () => ({}) });
  await expect(loadCurrentObservation()).rejects.toMatchObject({ reason: 'http' });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(loadCurrentObservation()).rejects.toBeInstanceOf(WeatherUnavailableError);
});

it('parses recent METAR history newest first and rejects unexpected formats', async () => {
  mockFetch({ ok: true, text: async () => 'station,valid,metar\nMDPC,2026-10-11 18:00,MDPC 111800Z 10012KT 9999 FEW022 30/22 Q1016\nMDPC,2026-10-11 19:00,MDPC 111900Z 10013KT 9999 FEW022 30/23 Q1015\n' });
  const history = await loadRecentMetars();
  expect(history.map(item => item.observedAt)).toEqual(['2026-10-11T19:00:00Z', '2026-10-11T18:00:00Z']);
  mockFetch({ ok: true, text: async () => '<html>' });
  await expect(loadRecentMetars()).rejects.toMatchObject({ reason: 'format' });
});

it('measures observation age and flags reports older than one routine cycle', () => {
  const now = Date.parse('2026-10-11T20:10:00Z');
  expect(observationAgeMinutes('2026-10-11T19:00:00Z', now)).toBe(70);
  expect(isObservationStale('2026-10-11T19:00:00Z', now)).toBe(false);
  expect(isObservationStale('2026-10-11T18:50:00Z', now)).toBe(true);
  expect(isObservationStale(null, now)).toBe(true);
});
