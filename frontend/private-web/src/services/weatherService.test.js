import { isOccAerodromeWeather } from '@elevant/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAerodromeWeather, createMetar, createWeatherScenario, WEATHER_NOON, WEATHER_STATION_ID,
} from '../features/maps/testing/weatherFixtures';
import { parseMetar } from '../features/weather/metar';
import { isObservationStale, observationAgeMinutes } from '../features/weather/useMdpcWeather';
import { createServerClock } from './serverClock';

const api = vi.hoisted(() => ({ getOccAerodromeWeather: vi.fn() }));
const auth = vi.hoisted(() => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../features/auth/authService', () => auth);
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

const {
  createRemoteWeatherAdapter, createSimulatedWeatherAdapter, loadRecentMetars, mergeDecodedMetar, toWeatherReading,
  weatherMessage, WEATHER_MESSAGES, weatherService, WeatherUnavailableError,
} = await import('./weatherService');

const NOON = Date.parse(WEATHER_NOON);
const SERVER_TITLE = 'One or more validation errors occurred.';
const failure = (status, code) => Object.assign(new Error(SERVER_TITLE), { status, code, title: SERVER_TITLE });
const NOAA = { name: 'NOAA Aviation Weather Center', url: 'https://aviationweather.gov', homeUrl: 'https://aviationweather.gov',
  official: false };

// A clock whose browser time the test moves by hand.
function manualClock(start) {
  let local = start;
  return { clock: createServerClock({ now: () => local }), advance: ms => { local += ms; } };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('aerodrome weather service (ADR-0043, contracts 1.4)', () => {
  it('the remote adapter reads occ/weather through the client with no-store and feeds the clock from serverTime', async () => {
    // The browser runs 2 minutes behind the server; the answer takes 200 ms.
    const { clock, advance } = manualClock(NOON - 120_000);
    const answer = createAerodromeWeather();
    api.getOccAerodromeWeather.mockImplementation(async () => { advance(200); return answer; });
    const adapter = createRemoteWeatherAdapter({ clock });
    const controller = new AbortController();

    await expect(adapter.getAerodromeWeather({ stationId: WEATHER_STATION_ID, signal: controller.signal })).resolves.toBe(answer);
    // Sent at −120 s and answered 200 ms later with the server's noon: the server is 119.9 s ahead.
    expect(clock.offsetMs()).toBe(119_900);
    expect(adapter.clock).toBe(clock);
    const [query, options] = api.getOccAerodromeWeather.mock.calls[0];
    expect(query).toEqual({ stationId: WEATHER_STATION_ID });
    expect(Object.keys(options).sort()).toEqual(['cache', 'signal']);
    expect(options.cache).toBe('no-store');
    // The read follows the caller's signal (and its own time limit).
    expect(options.signal.aborted).toBe(false);
    controller.abort();
    expect(options.signal.aborted).toBe(true);
    // Without a signal of the caller's, the time limit alone.
    await adapter.getAerodromeWeather({ stationId: WEATHER_STATION_ID });
    expect(api.getOccAerodromeWeather.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);

    // A read that does not answer is abandoned after the OCC's limit, with a TimeoutError, never left loading.
    api.getOccAerodromeWeather.mockImplementation((_, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    await expect(createRemoteWeatherAdapter({ clock, timeoutMs: 20 }).getAerodromeWeather({ stationId: WEATHER_STATION_ID }))
      .rejects.toMatchObject({ name: 'TimeoutError' });

    // The private web's adapter.
    expect(typeof weatherService.getAerodromeWeather).toBe('function');
  });

  it('a 401 signs out and every failure is thrown again with its status and code', async () => {
    const { clock } = manualClock(NOON);
    const adapter = createRemoteWeatherAdapter({ clock });
    api.getOccAerodromeWeather.mockRejectedValueOnce(failure(401));
    await expect(adapter.getAerodromeWeather({ stationId: WEATHER_STATION_ID })).rejects.toMatchObject({ status: 401 });
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });

    // Any other failure keeps its status and code and does not sign out; the clock learns nothing from it.
    for (const [status, code] of [[400, 'invalid_weather_query'], [403, 'forbidden'], [404, 'not_found'], [503, undefined]]) {
      api.getOccAerodromeWeather.mockRejectedValueOnce(failure(status, code));
      await expect(adapter.getAerodromeWeather({ stationId: WEATHER_STATION_ID })).rejects.toMatchObject({ status, code });
    }
    expect(auth.handleUnauthorizedResponse).toHaveBeenCalledTimes(1);
    expect(clock.isSynced()).toBe(false);
  });

  it('weatherMessage explains invalid_weather_query, forbidden and not_found in Spanish and never shows the server title', () => {
    expect(weatherMessage(failure(400, 'invalid_weather_query'))).toBe(WEATHER_MESSAGES.invalid_weather_query);
    expect(WEATHER_MESSAGES).toEqual({
      invalid_weather_query: 'No se pudo leer el clima con esos datos. Actualice la página.',
      not_found: 'Esta estación no tiene clima del aeródromo.',
    });
    expect(weatherMessage(failure(403, 'forbidden'))).toBe('No tiene permiso para ver el clima del aeródromo.');
    expect(weatherMessage(failure(404, 'not_found'))).toBe('Esta estación no tiene clima del aeródromo.');
    expect(weatherMessage(failure(401))).toBe('La sesión expiró. Vuelva a iniciar sesión.');
    for (const error of [new TypeError('Failed to fetch'), new DOMException('slow', 'TimeoutError'), failure(503)]) {
      expect(weatherMessage(error)).toBe('No se pudo leer el clima. Revise la conexión e intente de nuevo.');
    }
    for (const error of [failure(400, 'invalid_weather_query'), failure(403, 'forbidden'), failure(404, 'not_found'),
      failure(500), failure(503, 'unexpected')]) {
      expect(weatherMessage(error)).not.toContain(SERVER_TITLE);
    }
  });

  it('toWeatherReading keeps the METAR of Live and Stale, gives no observation for Unavailable and Disabled, and credits NOAA Aviation Weather Center as unofficial', () => {
    const receivedAt = NOON + 1_500;
    const live = createAerodromeWeather({ status: 'Live' });
    const reading = toWeatherReading(live, { receivedAt });
    expect(reading).toMatchObject({ apiStatus: 'Live', serverTime: NOON, retrievedAt: '2026-11-13T14:57:00.000Z',
      receivedAt: '2026-11-13T15:00:01.500Z', source: NOAA });
    expect(reading.observation).toEqual({
      station: 'MDPC',
      observedAt: '2026-11-13T14:50:00.000Z',
      metar: parseMetar(live.metar.raw),
      derived: { relativeHumidity: null, feelsLikeC: null, precipitationLastHourIn: null },
      source: NOAA,
      flightCategory: 'VFR',
      decoded: live.metar,
    });
    expect(reading.observation.metar).toMatchObject({ temperatureC: 29, qnhHpa: 1015, visibility: { meters: 10_000, orMore: true },
      wind: { directionDeg: 100, speedKt: 13, gustKt: null, variable: false } });
    expect(reading.taf.periods).toHaveLength(4);
    expect(Object.isFrozen(reading) && Object.isFrozen(reading.observation) && Object.isFrozen(reading.source)).toBe(true);

    const stale = toWeatherReading(createAerodromeWeather({ status: 'Stale' }));
    expect([stale.apiStatus, stale.observation.observedAt, stale.receivedAt]).toEqual(['Stale', '2026-11-13T12:00:00.000Z', null]);

    // Without a METAR there is no observation; the credit, the state and the TAF stay.
    const unavailable = toWeatherReading(createAerodromeWeather({ status: 'Unavailable' }));
    expect(unavailable).toMatchObject({ apiStatus: 'Unavailable', observation: null, source: NOAA,
      retrievedAt: '2026-11-13T14:57:00.000Z' });
    expect(unavailable.taf.raw).toMatch(/^TAF MDPC/);
    expect(toWeatherReading(createAerodromeWeather({ status: 'Disabled' })))
      .toMatchObject({ apiStatus: 'Disabled', observation: null, taf: null, retrievedAt: null, source: NOAA });

    // The instants as .NET writes them reach the readers as plain ISO texts.
    const dotNet = createAerodromeWeather({ observedAt: '2026-11-13T14:50:00.1234567+00:00',
      retrievedAt: '2026-11-13T10:57:00.5+00:00' });
    expect(isOccAerodromeWeather(dotNet, WEATHER_STATION_ID)).toBe(true);
    expect(toWeatherReading(dotNet)).toMatchObject({ retrievedAt: '2026-11-13T10:57:00.500Z',
      observation: { observedAt: '2026-11-13T14:50:00.123Z' } });
  });

  it('mergeDecodedMetar fills only what parseMetar could not read', () => {
    // What the raw text says wins, whatever the API decoded.
    const decoded = { ...createMetar(), temperatureCelsius: 31, windSpeedKnots: 20, altimeterHectopascals: 1009 };
    const parsed = parseMetar(decoded.raw);
    const kept = mergeDecodedMetar(parsed, decoded);
    expect(kept).toEqual(parsed);
    expect(kept).not.toBe(parsed);

    // A text the parser could not read fills from the decoded basics, in the parser's own shape and keys.
    const filled = mergeDecodedMetar(parseMetar('MDPC 131450Z'), { ...createMetar(), altimeterHectopascals: 1015.4 });
    expect(Object.keys(filled)).toEqual(Object.keys(parseMetar('')));
    expect(filled).toMatchObject({
      wind: { directionDeg: 100, variable: false, speedKt: 13, gustKt: null, variableFrom: null, variableTo: null },
      visibility: { meters: 9656, orMore: false },
      temperatureC: 29, dewPointC: 22, qnhHpa: 1015,
      clouds: [{ cover: 'SCT', baseFt: 2000, convective: null }],
    });
    // A variable wind fills without a direction; a cover the parser does not know is not added, nor is anything to
    // a CAVOK report; a value the API lacks stays empty.
    const variable = mergeDecodedMetar(parseMetar('MDPC 131450Z'), { ...createMetar({ wind: { variable: true, speedKt: 3 } }),
      clouds: [{ cover: 'OVX', baseFeet: 0 }], temperatureCelsius: null, visibilityStatuteMiles: null });
    expect(variable).toMatchObject({ wind: { directionDeg: null, variable: true, speedKt: 3 }, clouds: [],
      temperatureC: null, visibility: null });
    expect(mergeDecodedMetar(parseMetar('MDPC 131450Z 10013KT CAVOK 29/22 Q1015'), createMetar()).clouds).toEqual([]);
    expect(mergeDecodedMetar(parseMetar('MDPC 131450Z'), { ...createMetar(), windSpeedKnots: null }).wind).toBeNull();
    // Without the API's part, a copy of the parsed report.
    expect(mergeDecodedMetar(parsed, null)).toEqual(parsed);
  });

  describe('the simulated adapter', () => {
    it('the simulated adapter answers its scenario moved to now, validated, and records each call', async () => {
      // The simulated server runs 5 minutes after the scenario's noon.
      const serverNow = NOON + 300_000;
      const adapter = createSimulatedWeatherAdapter({ scenario: createWeatherScenario(), now: () => serverNow });
      const weather = await adapter.getAerodromeWeather({ stationId: WEATHER_STATION_ID });
      expect(isOccAerodromeWeather(weather, WEATHER_STATION_ID)).toBe(true);
      // Every instant moved with the scenario: the METAR is still ten minutes old, the TAF five minutes later.
      expect(weather.serverTime).toBe(new Date(serverNow).toISOString());
      expect(weather.metar.observedAt).toBe('2026-11-13T14:55:00.000Z');
      expect(weather.retrievedAt).toBe('2026-11-13T15:02:00.000Z');
      expect([weather.taf.issuedAt, weather.taf.validFrom, weather.taf.periods[1].from])
        .toEqual(['2026-11-13T11:05:00.000Z', '2026-11-13T12:05:00.000Z', '2026-11-13T16:05:00.000Z']);
      // The text is the scenario's: only instants move.
      expect(weather.metar.raw).toBe('MDPC 131450Z 10013KT 9999 SCT020 29/22 Q1015');

      // Another station gets the same scenario under its own id; a cancelled read never answers.
      const other = '5a000000-0000-4000-8000-000000000002';
      expect(isOccAerodromeWeather(await adapter.getAerodromeWeather({ stationId: other }), other)).toBe(true);
      const controller = new AbortController();
      controller.abort();
      await expect(adapter.getAerodromeWeather({ stationId: WEATHER_STATION_ID, signal: controller.signal }))
        .rejects.toMatchObject({ name: 'AbortError' });
      expect(adapter.calls).toEqual([
        { read: 'aerodromeWeather', at: serverNow, stationId: WEATHER_STATION_ID },
        { read: 'aerodromeWeather', at: serverNow, stationId: other },
        { read: 'aerodromeWeather', at: serverNow, stationId: WEATHER_STATION_ID },
      ]);
      // The reads set its own clock to the simulated server's time (the browser's is the test's).
      expect(Math.abs(adapter.clock.now() - serverNow)).toBeLessThan(1_000);

      // The weather may be written at each read; a scenario without it answers 404.
      const written = createSimulatedWeatherAdapter({ scenario: { weather: ({ nowMs }) => ({
        ...createAerodromeWeather({ status: 'Disabled' }), serverTime: new Date(nowMs).toISOString() }) } });
      await expect(written.getAerodromeWeather({ stationId: WEATHER_STATION_ID })).resolves.toMatchObject({ status: 'Disabled' });
      await expect(createSimulatedWeatherAdapter().getAerodromeWeather({ stationId: WEATHER_STATION_ID }))
        .rejects.toMatchObject({ status: 404, code: 'not_found' });
    });

    it('rejects a scenario that fails isOccAerodromeWeather', async () => {
      // A METAR three hours old cannot be Live; an answer with a key the contract does not have is not one either.
      for (const weather of [createAerodromeWeather({ status: 'Live', observedAt: '2026-11-13T12:00:00.000Z' }),
        { ...createAerodromeWeather(), runway: '08' }, { ...createAerodromeWeather({ status: 'Disabled' }), taf: createAerodromeWeather().taf }]) {
        const adapter = createSimulatedWeatherAdapter({ scenario: { at: WEATHER_NOON, weather }, now: () => NOON });
        await expect(adapter.getAerodromeWeather({ stationId: WEATHER_STATION_ID }))
          .rejects.toMatchObject({ status: 200, code: 'malformed_simulation' });
        expect(adapter.clock.isSynced()).toBe(false);
      }
    });

    it('throws the scenario failure with status and code', async () => {
      const refused = createSimulatedWeatherAdapter({ scenario: { ...createWeatherScenario(),
        failure: { status: 403, code: 'forbidden' } }, now: () => NOON });
      const error = await refused.getAerodromeWeather({ stationId: WEATHER_STATION_ID }).catch(caught => caught);
      expect(error).toMatchObject({ status: 403, code: 'forbidden' });
      // Its server title is never what the screen says.
      expect(error.title).toEqual(expect.any(String));
      expect(weatherMessage(error)).toBe('No tiene permiso para ver el clima del aeródromo.');
      expect(weatherMessage(error)).not.toContain(error.title);

      // A failure written per read: the second one fails without a code, the others answer.
      const flaky = createSimulatedWeatherAdapter({ scenario: { ...createWeatherScenario(),
        failure: ({ call }) => (call === 2 ? { status: 503 } : null) }, now: () => NOON });
      await expect(flaky.getAerodromeWeather({ stationId: WEATHER_STATION_ID })).resolves.toMatchObject({ status: 'Live' });
      await expect(flaky.getAerodromeWeather({ stationId: WEATHER_STATION_ID })).rejects.toMatchObject({ status: 503, code: undefined });
      await expect(flaky.getAerodromeWeather({ stationId: WEATHER_STATION_ID })).resolves.toMatchObject({ status: 'Live' });
      expect(flaky.calls).toHaveLength(3);
    });
  });
});

describe('the old dashboard METAR history (Iowa Environmental Mesonet, until PR U3)', () => {
  function mockFetch(response) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  }

  it('parses recent METAR history newest first and rejects unexpected formats', async () => {
    mockFetch({ ok: true, text: async () => 'station,valid,metar\nMDPC,2026-10-11 18:00,MDPC 111800Z 10012KT 9999 FEW022 30/22 Q1016\nMDPC,2026-10-11 19:00,MDPC 111900Z 10013KT 9999 FEW022 30/23 Q1015\n' });
    const history = await loadRecentMetars();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/^https:\/\/mesonet\.agron\.iastate\.edu\/cgi-bin\/request\/asos\.py\?station=MDPC&data=metar&hours=3&/);
    expect(init.credentials).toBe('omit');
    expect(history.map(item => item.observedAt)).toEqual(['2026-10-11T19:00:00Z', '2026-10-11T18:00:00Z']);
    mockFetch({ ok: true, text: async () => '<html>' });
    await expect(loadRecentMetars()).rejects.toMatchObject({ reason: 'format' });
    mockFetch({ ok: false, text: async () => '' });
    await expect(loadRecentMetars()).rejects.toMatchObject({ reason: 'http' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(loadRecentMetars()).rejects.toBeInstanceOf(WeatherUnavailableError);
  });

  it('measures observation age and flags reports older than one routine cycle', () => {
    const now = Date.parse('2026-10-11T20:10:00Z');
    expect(observationAgeMinutes('2026-10-11T19:00:00Z', now)).toBe(70);
    expect(isObservationStale('2026-10-11T19:00:00Z', now)).toBe(false);
    expect(isObservationStale('2026-10-11T18:50:00Z', now)).toBe(true);
    expect(isObservationStale(null, now)).toBe(true);
  });
});
