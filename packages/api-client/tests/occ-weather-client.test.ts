import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  isOccAerodromeWeather,
  normalizedOccAerodromeWeatherQuery,
  OCC_AERODROME_WEATHER_LIMITS,
  OCC_AERODROME_WEATHER_STATUSES,
  OCC_TAF_CHANGES,
  OCC_WEATHER_FLIGHT_CATEGORIES,
  type OccAerodromeWeatherQuery,
} from "../src";

// ADR-0043 (contracts 1.4): the OCC's weather, the METAR and the TAF of the station's airport. Synthetic answers only (the
// shape the API publishes, with invented reports); no network and no weather service is involved.
const stationId = "20000000-0000-7000-8000-000000000003";
const otherStationId = "20000000-0000-7000-8000-000000000004";
const at = (hour: number, minute = 0) =>
  `2026-11-13T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+00:00`;

const source = { name: "NOAA Aviation Weather Center", homeUrl: "https://aviationweather.gov" };
const cloud = (cover: string, baseFeet: number | null) => ({ cover, baseFeet });
/** An invented METAR of Punta Cana observed at 15:00. */
const metar = {
  raw: "MDPC 131500Z 09014G24KT 9999 VCSH FEW018 SCT035 BKN080 29/22 Q1015 NOSIG", observedAt: at(15),
  flightCategory: "VFR", windDirectionDegrees: 90, windVariable: false, windSpeedKnots: 14, windGustKnots: 24,
  visibilityStatuteMiles: 6, temperatureCelsius: 29, dewpointCelsius: 22, altimeterHectopascals: 1015, weather: "VCSH",
  clouds: [cloud("FEW", 1800), cloud("SCT", 3500), cloud("BKN", 8000)],
};
/** The first period of an invented TAF: no change group, no probability. */
const firstPeriod = {
  from: at(12), to: at(22), change: null, probabilityPercent: null, windDirectionDegrees: 90, windVariable: false,
  windSpeedKnots: 12, windGustKnots: null, visibilityStatuteMiles: 6, weather: null, clouds: [cloud("FEW", 2000)],
};
/** A TEMPO with a variable wind (no direction) and a PROB30 group. */
const tempo = { ...firstPeriod, from: at(16), to: at(20), change: "TEMPO", windDirectionDegrees: null, windVariable: true,
  windSpeedKnots: 15, windGustKnots: 25, visibilityStatuteMiles: 2.49, weather: "SHRA", clouds: [cloud("BKN", 1500)] };
const prob = { ...firstPeriod, from: "2026-11-14T04:00:00+00:00", to: "2026-11-14T08:00:00+00:00", change: "PROB",
  probabilityPercent: 30, windDirectionDegrees: null, windSpeedKnots: null, visibilityStatuteMiles: 1.86, weather: "TSRA",
  clouds: [cloud("BKN", 1200)] };
const taf = {
  raw: "TAF MDPC 131100Z 1312/1412 09012KT 9999 FEW020 TEMPO 1316/1320 10015G25KT 4000 SHRA BKN015 PROB30 1404/1408 3000 TSRA",
  issuedAt: at(11), validFrom: at(12), validTo: "2026-11-14T12:00:00+00:00", periods: [firstPeriod, tempo, prob],
};
const live = { stationId, icaoCode: "MDPC", status: "Live", serverTime: "2026-11-13T15:20:00.1234567+00:00",
  retrievedAt: at(15, 18), source, metar, taf };
/** The service failed: the METAR kept from the last read, two hours old. */
const stale = { ...live, status: "Stale", serverTime: at(17) };
/** No METAR to show; the TAF still comes. */
const unavailable = { ...live, status: "Unavailable", metar: null };
/** No weather service here: no report, no retrieval, the credit only. */
const disabled = { stationId, icaoCode: "MDPC", status: "Disabled", serverTime: at(15, 20), retrievedAt: null, source,
  metar: null, taf: null };

type Call = { url: string; method: string; headers: Headers };

function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
        headers: new Headers(init?.headers) });
      return answers.shift()!;
    } });
}

/** Drops one key from a copy, as a server leaving a null value out would. */
const without = <T extends Record<string, unknown>>(value: T, key: keyof T) => {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key as string];
  return copy;
};

const withMetar = (changes: Record<string, unknown>) => ({ ...live, metar: { ...metar, ...changes } });
const withTaf = (changes: Record<string, unknown>) => ({ ...live, taf: { ...taf, ...changes } });
const withPeriod = (changes: Record<string, unknown>) => withTaf({ periods: [{ ...firstPeriod, ...changes }] });

describe("OCC weather client (ADR-0043)", () => {
  it("accepts every status the server answers", () => {
    expect(OCC_AERODROME_WEATHER_STATUSES).toEqual(["Live", "Stale", "Unavailable", "Disabled"]);
    expect(OCC_WEATHER_FLIGHT_CATEGORIES).toEqual(["VFR", "MVFR", "IFR", "LIFR"]);
    expect(OCC_TAF_CHANGES).toEqual(["FM", "BECMG", "TEMPO", "PROB"]);
    expect(OCC_AERODROME_WEATHER_LIMITS).toEqual({ liveMetarMinutes: 90, maxClouds: 8, maxTafPeriods: 30 });

    // Live with its METAR and TAF, Stale, Unavailable with the TAF alone, Unavailable never retrieved, Disabled.
    for (const weather of [live, stale, unavailable, { ...unavailable, taf: null, retrievedAt: null }, disabled])
      expect(isOccAerodromeWeather(weather, stationId)).toBe(true);
    expect(isOccAerodromeWeather(live)).toBe(true);
    expect(isOccAerodromeWeather(live, stationId.toUpperCase())).toBe(true);

    // The keys the server may leave out where they are null, at every level.
    for (const weather of [without(disabled, "metar"), without(without(disabled, "taf"), "retrievedAt"),
      without(live, "retrievedAt"), without(live, "taf"), without(unavailable, "metar"),
      { ...live, metar: without(without(metar, "flightCategory"), "weather") },
      { ...live, metar: { ...metar, clouds: [without(cloud("OVC", null), "baseFeet")] } },
      { ...live, taf: { ...taf, periods: [without(without(firstPeriod, "change"), "probabilityPercent")] } }])
      expect(isOccAerodromeWeather(weather, stationId)).toBe(true);

    // The edges: exactly 90 minutes old is still live, and a report a little ahead of the server's clock too; a variable
    // wind without a direction; the bounds of every value; eight layers and thirty periods; no layer and no period.
    for (const weather of [
      { ...live, serverTime: at(16, 30) }, { ...live, serverTime: at(14, 58) },
      withMetar({ windDirectionDegrees: null, windVariable: true }),
      withMetar({ windDirectionDegrees: 0, windSpeedKnots: 0, windGustKnots: 0, visibilityStatuteMiles: 0,
        temperatureCelsius: -100, dewpointCelsius: -100, altimeterHectopascals: 800 }),
      withMetar({ windDirectionDegrees: 360, windSpeedKnots: 300, windGustKnots: 400, visibilityStatuteMiles: 100,
        temperatureCelsius: 100, dewpointCelsius: 100, altimeterHectopascals: 1100, clouds: [cloud("VV", 0)] }),
      withMetar({ temperatureCelsius: 28.5, dewpointCelsius: -0.5, altimeterHectopascals: 1013.2,
        visibilityStatuteMiles: 0.25 }),
      withMetar({ clouds: Array.from({ length: 8 }, (_, index) => cloud("BKN", 1000 * index)) }),
      withMetar({ clouds: [cloud("CAVOK", null), cloud("FEW", 100_000)], flightCategory: "LIFR" }), withMetar({ clouds: [] }),
      withTaf({ periods: Array.from({ length: 30 }, () => firstPeriod) }), withTaf({ periods: [] }),
      withTaf({ validFrom: at(12), validTo: at(12) }), withPeriod({ to: at(12) }),
      ...OCC_TAF_CHANGES.map(change => withPeriod({ change })),
      ...OCC_WEATHER_FLIGHT_CATEGORIES.map(flightCategory => withMetar({ flightCategory })),
      withPeriod({ probabilityPercent: 0 }), withPeriod({ probabilityPercent: 100 }),
      { ...live, retrievedAt: "2026-11-13T15:18:00.1234567Z" },
    ])
      expect(isOccAerodromeWeather(weather, stationId)).toBe(true);
  });

  it("rejects unknown keys at every level", () => {
    for (const bad of [
      { ...live, reason: "provider_error" }, { ...live, refreshAfterSeconds: 300 },
      { ...live, source: { ...source, licenseName: "Public domain" } },
      withMetar({ humidity: 70 }), withMetar({ clouds: [{ ...cloud("FEW", 1800), type: "CB" }] }),
      withTaf({ station: "MDPC" }), withPeriod({ temperatureCelsius: 30 }),
      withPeriod({ clouds: [{ ...cloud("FEW", 2000), height: 2000 }] }),
      { ...disabled, metar: undefined, extra: null },
    ])
      expect(isOccAerodromeWeather(bad, stationId)).toBe(false);
    // The required keys too: a missing one is never taken for a null.
    for (const bad of [without(live, "status"), without(live, "source"), without(live, "serverTime"),
      without(live, "icaoCode"), without(live, "stationId"), { ...live, metar: without(metar, "raw") },
      { ...live, metar: without(metar, "windVariable") }, { ...live, metar: without(metar, "clouds") },
      { ...live, taf: without(taf, "periods") }, { ...live, taf: without(taf, "validTo") },
      withTaf({ periods: [without(firstPeriod, "windVariable")] }), withTaf({ periods: [without(firstPeriod, "from")] }),
      { ...live, metar: { ...metar, clouds: [without(cloud("FEW", 1800), "cover")] } },
      { ...live, source: without(source, "homeUrl") }])
      expect(isOccAerodromeWeather(bad, stationId)).toBe(false);
  });

  it("rejects a status outside its closed list and states that disagree with their parts", () => {
    for (const bad of [
      { ...live, status: "live" }, { ...live, status: "Warming" }, { ...live, status: "Cached" }, { ...live, status: null },
      // Live and Stale show a METAR; a live one is at most 90 minutes older than the server's time.
      { ...live, metar: null }, without(live, "metar"), { ...stale, metar: null }, { ...live, serverTime: at(16, 31) },
      { ...live, serverTime: at(17) },
      // Unavailable and Disabled have none; Disabled has no TAF and was never retrieved.
      { ...unavailable, metar }, { ...disabled, metar }, { ...disabled, taf }, { ...disabled, retrievedAt: at(15) },
      // A variable wind has no direction, in the METAR as in a period.
      withMetar({ windVariable: true }), withPeriod({ windVariable: true }),
      // A validity or a period that ends before it starts.
      withTaf({ validFrom: at(13), validTo: at(12) }), withPeriod({ from: at(13), to: at(12) }),
      // Values outside their closed lists.
      withMetar({ flightCategory: "VMC" }), withMetar({ flightCategory: "vfr" }), withPeriod({ change: "INTER" }),
      withPeriod({ change: "tempo" }), withMetar({ windVariable: "no" }),
    ])
      expect(isOccAerodromeWeather(bad, stationId)).toBe(false);
  });

  it("rejects another station, a malformed ICAO, bad instants and out-of-range values", () => {
    expect(isOccAerodromeWeather(live, otherStationId)).toBe(false);
    for (const bad of [
      { ...live, stationId: "00000000-0000-0000-0000-000000000000" }, { ...live, stationId: "PUJ" },
      { ...live, icaoCode: "mdpc" }, { ...live, icaoCode: "MDP" }, { ...live, icaoCode: "MDPCX" },
      { ...live, icaoCode: "MD1C" }, { ...live, icaoCode: " MDPC" }, { ...live, icaoCode: null },
      // Instants: not ISO 8601 with a zone, not a text, not a real date.
      { ...live, serverTime: "2026-11-13 15:20:00" }, { ...live, serverTime: "2026-11-13T15:20:00" },
      { ...live, serverTime: 1794583200 }, { ...live, retrievedAt: "yesterday" },
      withMetar({ observedAt: "2026-13-13T15:00:00+00:00" }), withMetar({ observedAt: null }),
      withTaf({ issuedAt: "soon" }), withTaf({ validFrom: null }), withPeriod({ to: "2026-11-13T25:00:00+00:00" }),
      // The credit: a name and an https home page.
      { ...live, source: { ...source, homeUrl: "http://aviationweather.gov" } }, { ...live, source: { ...source, name: "" } },
      { ...live, source: null },
      // Out of range, or not a whole number where the server sends one.
      withMetar({ windDirectionDegrees: 361 }), withMetar({ windDirectionDegrees: -1 }),
      withMetar({ windDirectionDegrees: 90.5 }), withMetar({ windSpeedKnots: 301 }), withMetar({ windGustKnots: 401 }),
      withMetar({ windSpeedKnots: -1 }), withMetar({ visibilityStatuteMiles: 100.5 }),
      withMetar({ visibilityStatuteMiles: -0.25 }), withMetar({ temperatureCelsius: 101 }),
      withMetar({ dewpointCelsius: -101 }), withMetar({ altimeterHectopascals: 799.9 }),
      withMetar({ altimeterHectopascals: 1100.1 }), withMetar({ altimeterHectopascals: 29.92 }),
      withMetar({ temperatureCelsius: "29" }), withMetar({ temperatureCelsius: Number.NaN }),
      withMetar({ clouds: [cloud("FEW", -1)] }), withMetar({ clouds: [cloud("FEW", 100_001)] }),
      withMetar({ clouds: [cloud("FEW", 1800.5)] }), withMetar({ clouds: [cloud("few", 1800)] }),
      withMetar({ clouds: [cloud("F3W", 1800)] }), withMetar({ clouds: [cloud("OVERCAST", 1800)] }),
      withMetar({ clouds: Array.from({ length: 9 }, () => cloud("BKN", 1000)) }),
      withTaf({ periods: Array.from({ length: 31 }, () => firstPeriod) }),
      withPeriod({ probabilityPercent: 101 }), withPeriod({ probabilityPercent: 30.5 }),
      withPeriod({ windGustKnots: 401 }), withPeriod({ visibilityStatuteMiles: 101 }),
      // Texts: blank, too long, or not a text.
      withMetar({ raw: "  " }), withMetar({ raw: "X".repeat(1001) }), withTaf({ raw: "X".repeat(4001) }),
      withMetar({ weather: "R".repeat(65) }), withMetar({ weather: "" }), withPeriod({ weather: 42 }),
      { ...live, metar: [metar] }, { ...live, taf: "TAF MDPC" },
    ])
      expect(isOccAerodromeWeather(bad, stationId)).toBe(false);
    // The longest texts the server reads are fine.
    for (const weather of [withMetar({ raw: "X".repeat(1000), weather: "R".repeat(64) }), withTaf({ raw: "X".repeat(4000) })])
      expect(isOccAerodromeWeather(weather, stationId)).toBe(true);
  });

  it("checks the query before it is sent", async () => {
    const calls: Call[] = [];
    const api = client([], calls);
    for (const query of [{ stationId: "PUJ" }, { stationId: "00000000-0000-0000-0000-000000000000" }, { stationId: "" },
      { stationId: 42 }, {}, { stationId, icaoCode: "MDPC" }, { stationId, trails: "none" }, null])
      await expect(api.getOccAerodromeWeather(query as OccAerodromeWeatherQuery)).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);

    // What is valid is normalized: the station in lower case, and nothing else.
    expect(normalizedOccAerodromeWeatherQuery({ stationId: stationId.toUpperCase() })).toEqual({ stationId });
    expect(() => normalizedOccAerodromeWeatherQuery({ stationId, extra: 1 } as unknown as OccAerodromeWeatherQuery))
      .toThrow(TypeError);
  });

  it("getOccAerodromeWeather sends GET /api/v1/occ/weather?stationId= and throws on a malformed answer", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(live), Response.json(disabled), Response.json(unavailable)], calls);
    await expect(api.getOccAerodromeWeather({ stationId: stationId.toUpperCase() })).resolves.toEqual(live);
    await expect(api.getOccAerodromeWeather({ stationId })).resolves.toEqual(disabled);
    await expect(api.getOccAerodromeWeather({ stationId })).resolves.toEqual(unavailable);
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ["GET", `/api/v1/occ/weather?stationId=${stationId}`],
      ["GET", `/api/v1/occ/weather?stationId=${stationId}`],
      ["GET", `/api/v1/occ/weather?stationId=${stationId}`],
    ]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");

    // An unknown key, another station's weather, a state that disagrees with its parts, and a success that is not a 200.
    const malformed = client([Response.json({ ...live, reason: null }), Response.json({ ...live, stationId: otherStationId }),
      Response.json({ ...disabled, taf }), Response.json(live, { status: 202 })]);
    for (let attempt = 0; attempt < 4; attempt++)
      await expect(malformed.getOccAerodromeWeather({ stationId })).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("keeps the weather's problem codes", async () => {
    const problem = (status: number, code: string) => Response.json(
      { title: "La consulta del clima no es válida.", status, code },
      { status, headers: { "content-type": "application/problem+json" } });
    const api = client([problem(400, "invalid_weather_query"), problem(403, "forbidden"), problem(404, "not_found"),
      problem(400, "weather_down")]);

    const invalid = await api.getOccAerodromeWeather({ stationId }).catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(ElevantApiError);
    expect(invalid).toMatchObject({ kind: "http", status: 400, code: "invalid_weather_query" });
    await expect(api.getOccAerodromeWeather({ stationId })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(api.getOccAerodromeWeather({ stationId })).rejects.toMatchObject({ status: 404, code: "not_found" });
    // A code the client does not know is dropped, never passed on.
    const unknown = await api.getOccAerodromeWeather({ stationId }).catch((error: unknown) => error);
    expect(unknown).toMatchObject({ kind: "http", status: 400, code: undefined });
  });
});
