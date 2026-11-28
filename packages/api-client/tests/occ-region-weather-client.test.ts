import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  isOccRadarFrames,
  isOccRegionWeather,
  isOccSigmets,
  isOccWindGrid,
  normalizedOccRegionWeatherQuery,
  OCC_RADAR_PROVIDERS,
  OCC_REGION_WEATHER_LIMITS,
  OCC_REGION_WEATHER_REASONS,
  type OccRegionWeatherQuery,
} from "../src";

// Plan M6 (contracts 1.4): the region's weather, four reads under `occ/weather`. Synthetic answers only (the shape the
// API publishes, with invented reports, areas and scans); no network and no weather service is involved.
const stationId = "20000000-0000-7000-8000-000000000003";
const otherStationId = "20000000-0000-7000-8000-000000000004";
const at = (hour: number, minute = 0) =>
  `2026-11-28T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+00:00`;
const serverTime = "2026-11-28T15:20:00.1234567+00:00";

const awc = { name: "NOAA Aviation Weather Center", url: "https://aviationweather.gov" };
const openMeteo = { name: "Open-Meteo", url: "https://open-meteo.com" };
const iem = { name: "Iowa Environmental Mesonet", url: "https://mesonet.agron.iastate.edu" };

/** An invented METAR of Punta Cana observed at 15:00, with a broken layer at 8 000 ft. */
const metar = {
  raw: "MDPC 281500Z 09014G24KT 9999 FEW018 BKN080 29/22 Q1015", observedAt: at(15), windDirectionDegrees: 90,
  windSpeedKnots: 14, windGustKnots: 24, visibilityStatuteMiles: 6, ceilingFeet: 8000, flightCategory: "VFR",
  temperatureCelsius: 29, dewpointCelsius: 22, altimeterHectopascals: 1015,
};
const taf = { raw: "TAF MDPC 281100Z 2812/2912 09012KT 9999 FEW020", issuedAt: at(11), validFrom: at(12),
  validTo: "2026-11-29T12:00:00+00:00" };
const puntaCana = { icao: "MDPC", iata: "PUJ", name: "Punta Cana", latitude: 18.567, longitude: -68.363, metar, taf };
/** An airport without IATA code or reports: it is still listed. */
const quiet = { icao: "TJNR", iata: null, name: null, latitude: 18.245, longitude: -65.643, metar: null, taf: null };
const region = { stationId, status: "Live", reason: null, serverTime, refreshAfterSeconds: 300, credit: awc,
  stations: [puntaCana, quiet] };

/** An invented SIGMET over the region, a closed ring of [longitude, latitude]. */
const sigmet = { id: "TJZS-A-202611281400", firId: "TJZS", hazard: "TS", qualifier: "EMBD", validFrom: at(14),
  validTo: at(18), baseFeet: null, topFeet: 45000, raw: "TJZS SIGMET A1 VALID 281400/281800 TJSJ- EMBD TS",
  polygon: [[-68, 17], [-66, 17], [-66, 19], [-68, 19], [-68, 17]] };
const sigmets = { stationId, status: "Live", reason: null, serverTime, refreshAfterSeconds: 600, credit: awc,
  sigmets: [sigmet] };

const point = (latitude: number, longitude: number) => ({ latitude, longitude, speedKnots: 12.4, directionDegrees: 80 });
const box = { lonMin: -76, lonMax: -60, latMin: 12, latMax: 24, columns: 10, rows: 8 };
const wind = { stationId, status: "Live", reason: null, serverTime, refreshAfterSeconds: 3600, credit: openMeteo,
  validAt: at(15), grid: { ...box, points: [point(12, -76), point(24, -60), point(18.857, -67.111)] } };

const tile = (stamp: string) =>
  `https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::JUA-N0B-${stamp}/{z}/{x}/{y}.png`;
const radar = { stationId, status: "Live", reason: null, serverTime, refreshAfterSeconds: 300, credit: iem,
  provider: "iem-tjua", maxZoom: 10, frames: [{ time: at(15, 5), tileUrlTemplate: tile("202611281505") },
    { time: at(15, 10), tileUrlTemplate: tile("202611281510") }] };

/** Each layer off: `not_configured`, the longest pace, nothing to draw. */
const disabledRegion = { ...region, status: "Disabled", reason: "not_configured", refreshAfterSeconds: 900,
  stations: [{ ...puntaCana, metar: null, taf: null }] };
const disabledSigmets = { ...sigmets, status: "Disabled", reason: "not_configured", refreshAfterSeconds: 900, sigmets: [] };
const disabledWind = { ...wind, status: "Disabled", reason: "not_configured", validAt: null,
  grid: { ...box, points: [] } };
const disabledRadar = { ...radar, status: "Disabled", reason: "not_configured", refreshAfterSeconds: 900,
  provider: null, maxZoom: 0, frames: [] };

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

describe("OCC region weather client (plan M6)", () => {
  it("names the closed lists and the limits the server applies", () => {
    expect(OCC_REGION_WEATHER_REASONS).toEqual(["not_configured", "rate_limited", "provider_error"]);
    expect(OCC_RADAR_PROVIDERS).toEqual(["iem-tjua"]);
    expect(OCC_REGION_WEATHER_LIMITS).toMatchObject({ regionRefreshSeconds: { min: 300, max: 900 },
      sigmetsRefreshSeconds: { min: 300, max: 900 }, windRefreshSeconds: { min: 300, max: 3600 },
      radarRefreshSeconds: { min: 300, max: 900 }, maxRadarFrames: 12, maxPolygonPoints: 1001 });
    expect(Object.isFrozen(OCC_REGION_WEATHER_LIMITS)).toBe(true);
  });

  it("accepts every state the server answers for each layer", () => {
    const stale = { status: "Stale", reason: "rate_limited", refreshAfterSeconds: 420 };
    const unavailable = { status: "Unavailable", reason: "provider_error" };
    for (const value of [region, without(region, "reason"), disabledRegion, { ...region, ...stale },
      { ...region, status: "Stale", reason: null, serverTime: at(18) },
      { ...region, ...unavailable, stations: [{ ...puntaCana, metar: null }, quiet] },
      { ...region, status: "Unavailable", reason: null, stations: [] }])
      expect(isOccRegionWeather(value, stationId)).toBe(true);
    for (const value of [sigmets, { ...sigmets, sigmets: [] }, disabledSigmets, { ...sigmets, ...stale },
      { ...sigmets, ...unavailable, sigmets: [] }, { ...sigmets, sigmets: [without(sigmet, "firId")] }])
      expect(isOccSigmets(value, stationId)).toBe(true);
    for (const value of [wind, disabledWind, { ...wind, ...stale, refreshAfterSeconds: 3600 },
      { ...wind, status: "Stale", serverTime: "2026-11-28T19:00:00+00:00" }, { ...disabledWind, ...unavailable }])
      expect(isOccWindGrid(value, stationId)).toBe(true);
    for (const value of [radar, disabledRadar, { ...radar, ...stale }, { ...radar, status: "Stale", serverTime: at(16) },
      { ...disabledRadar, status: "Unavailable", reason: null, refreshAfterSeconds: 300 }])
      expect(isOccRadarFrames(value, stationId)).toBe(true);
    // The station asked for may come in any case; without one, any station is fine.
    expect(isOccRegionWeather({ ...region, stationId: stationId.toUpperCase() }, stationId)).toBe(true);
    expect(isOccSigmets({ ...sigmets, stationId: otherStationId })).toBe(true);
  });

  it("rejects unknown keys at every level", () => {
    const extra = { extra: 1 };
    for (const bad of [{ ...region, ...extra }, { ...region, credit: { ...awc, ...extra } },
      { ...region, stations: [{ ...puntaCana, ...extra }] }, { ...region, stations: [{ ...puntaCana, metar: { ...metar,
        ...extra } }] }, { ...region, stations: [{ ...puntaCana, taf: { ...taf, periods: [] } }] },
      // The airport read's keys do not belong to the region's.
      { ...region, stations: [{ ...puntaCana, metar: { ...metar, windVariable: false } }] }])
      expect(isOccRegionWeather(bad, stationId)).toBe(false);
    for (const bad of [{ ...sigmets, ...extra }, { ...sigmets, sigmets: [{ ...sigmet, ...extra }] }])
      expect(isOccSigmets(bad, stationId)).toBe(false);
    for (const bad of [{ ...wind, ...extra }, { ...wind, grid: { ...wind.grid, ...extra } },
      { ...wind, grid: { ...wind.grid, points: [{ ...point(18, -68), ...extra }] } }])
      expect(isOccWindGrid(bad, stationId)).toBe(false);
    for (const bad of [{ ...radar, ...extra }, { ...radar, frames: [{ ...radar.frames[0]!, ...extra }] }])
      expect(isOccRadarFrames(bad, stationId)).toBe(false);
    // A required key cannot be left out.
    for (const key of ["stationId", "status", "serverTime", "refreshAfterSeconds", "credit", "stations"] as const)
      expect(isOccRegionWeather(without(region, key), stationId)).toBe(false);
    expect(isOccWindGrid(without(wind, "grid"), stationId)).toBe(false);
    expect(isOccRadarFrames(without(radar, "maxZoom"), stationId)).toBe(false);
  });

  it("rejects states that disagree with their reason, their pace or their parts", () => {
    for (const bad of [{ ...region, status: "Warming" }, { ...region, reason: "provider_error" },
      { ...region, reason: "quota_exceeded" }, { ...disabledRegion, reason: null },
      { ...region, status: "Stale", reason: "not_configured" }, { ...region, refreshAfterSeconds: 299 },
      { ...region, refreshAfterSeconds: 901 }, { ...region, refreshAfterSeconds: 300.5 },
      // Live and Stale need a METAR, and a live one at most 90 minutes old; Unavailable and Disabled have none.
      { ...region, stations: [quiet] }, { ...region, serverTime: at(16, 31) },
      { ...region, status: "Unavailable", reason: null }, { ...disabledRegion, stations: [puntaCana] },
      { ...disabledRegion, stations: [{ ...puntaCana, metar: null }] },
      // Every airport comes once.
      { ...region, stations: [puntaCana, puntaCana] }])
      expect(isOccRegionWeather(bad, stationId)).toBe(false);
    for (const bad of [{ ...sigmets, refreshAfterSeconds: 1200 }, { ...disabledSigmets, sigmets: [sigmet] },
      { ...sigmets, status: "Unavailable", sigmets: [sigmet] }, { ...sigmets, sigmets: [sigmet, sigmet] },
      // A SIGMET past its validity is never served.
      { ...sigmets, serverTime: at(18) }])
      expect(isOccSigmets(bad, stationId)).toBe(false);
    for (const bad of [{ ...wind, refreshAfterSeconds: 3601 }, { ...wind, validAt: null },
      { ...wind, grid: { ...box, points: [] } }, { ...disabledWind, grid: wind.grid, validAt: at(15) },
      { ...disabledWind, reason: "rate_limited" }])
      expect(isOccWindGrid(bad, stationId)).toBe(false);
    for (const bad of [{ ...radar, frames: [] }, { ...radar, provider: null }, { ...radar, maxZoom: 0 },
      { ...disabledRadar, provider: "iem-tjua" }, { ...disabledRadar, maxZoom: 10 },
      { ...disabledRadar, frames: radar.frames, provider: "iem-tjua", maxZoom: 10 },
      // Frames come oldest first, each scan once, and a live one's latest scan is at most 30 minutes old.
      { ...radar, frames: [...radar.frames].reverse() }, { ...radar, frames: [radar.frames[0], radar.frames[0]] },
      { ...radar, serverTime: at(15, 41) }])
      expect(isOccRadarFrames(bad, stationId)).toBe(false);
  });

  it("rejects another station, bad instants, codes, areas and out-of-range values", () => {
    expect(isOccRegionWeather({ ...region, stationId: otherStationId }, stationId)).toBe(false);
    expect(isOccSigmets({ ...sigmets, stationId: otherStationId }, stationId)).toBe(false);
    expect(isOccWindGrid({ ...wind, stationId: otherStationId }, stationId)).toBe(false);
    expect(isOccRadarFrames({ ...radar, stationId: otherStationId }, stationId)).toBe(false);
    expect(isOccRegionWeather({ ...region, stationId: "00000000-0000-0000-0000-000000000000" })).toBe(false);

    const withStation = (changes: Record<string, unknown>) => ({ ...region, stations: [{ ...puntaCana, ...changes }] });
    const withMetar = (changes: Record<string, unknown>) => withStation({ metar: { ...metar, ...changes } });
    for (const bad of [{ ...region, serverTime: "2026-11-28 15:20" }, { ...region, credit: { ...awc, url: "http://x.test" } },
      withStation({ icao: "mdpc" }), withStation({ iata: "PU" }), withStation({ latitude: 91 }),
      withStation({ longitude: -181 }), withStation({ name: "N".repeat(121) }),
      withStation({ taf: { ...taf, validTo: at(11) } }), withMetar({ observedAt: "yesterday" }),
      withMetar({ windDirectionDegrees: 361 }), withMetar({ windSpeedKnots: 12.5 }), withMetar({ ceilingFeet: -1 }),
      withMetar({ ceilingFeet: 100_001 }), withMetar({ flightCategory: "VMC" }), withMetar({ visibilityStatuteMiles: 101 }),
      withMetar({ altimeterHectopascals: 799 }), withMetar({ raw: " " })])
      expect(isOccRegionWeather(bad, stationId)).toBe(false);
    // A variable wind comes without direction, and the longest raw METAR is fine.
    expect(isOccRegionWeather(withMetar({ windDirectionDegrees: null, raw: "X".repeat(1000) }), stationId)).toBe(true);

    const withSigmet = (changes: Record<string, unknown>) => ({ ...sigmets, sigmets: [{ ...sigmet, ...changes }] });
    const ring = (points: number) => Array.from({ length: points - 1 }, (_, index) => [-68 + index * 0.001, 17 + (index % 2)])
      .concat([[-68, 17]]);
    for (const bad of [withSigmet({ hazard: "ts" }), withSigmet({ hazard: "T" }), withSigmet({ firId: "TJ" }),
      withSigmet({ validFrom: at(18) }), withSigmet({ topFeet: 100_001 }), withSigmet({ raw: "X".repeat(8001) }),
      withSigmet({ polygon: [[-68, 17], [-66, 17], [-66, 19], [-68, 19]] }), withSigmet({ polygon: [[-68, 17], [-66, 17],
        [-68, 17]] }), withSigmet({ polygon: [[-68, 17, 0], [-66, 17], [-66, 19], [-68, 17]] }),
      withSigmet({ polygon: [[17, -181], [-66, 17], [-66, 19], [17, -181]] }), withSigmet({ polygon: ring(1002) })])
      expect(isOccSigmets(bad, stationId)).toBe(false);
    expect(isOccSigmets(withSigmet({ polygon: ring(1001), raw: "X".repeat(8000), qualifier: null }), stationId)).toBe(true);

    const withGrid = (changes: Record<string, unknown>) => ({ ...wind, grid: { ...wind.grid, ...changes } });
    for (const bad of [withGrid({ lonMin: -60 }), withGrid({ latMax: 12 }), withGrid({ columns: 1 }),
      withGrid({ rows: 33 }), withGrid({ columns: 1.5 }),
      withGrid({ columns: 2, rows: 1, points: [point(12, -76), point(24, -60)] }),
      withGrid({ points: [point(25, -68)] }), withGrid({ points: [point(18, -59.9)] }),
      withGrid({ points: [{ ...point(18, -68), speedKnots: -1 }] }),
      withGrid({ points: [{ ...point(18, -68), directionDegrees: 80.5 }] }),
      withGrid({ points: [{ ...point(18, -68), directionDegrees: 361 }] }), { ...wind, validAt: "now" }])
      expect(isOccWindGrid(bad, stationId)).toBe(false);
    // The server rounds a point to three decimals, so a node may sit a hair outside the box.
    expect(isOccWindGrid(withGrid({ points: [point(24.0005, -76.0005)] }), stationId)).toBe(true);

    const withFrame = (changes: Record<string, unknown>) => ({ ...radar, frames: [{ ...radar.frames[0]!, ...changes }] });
    for (const bad of [{ ...radar, provider: "rainviewer" }, { ...radar, maxZoom: 23 },
      withFrame({ tileUrlTemplate: "http://mesonet.agron.iastate.edu/{z}/{x}/{y}.png" }),
      withFrame({ tileUrlTemplate: "https://mesonet.agron.iastate.edu/{z}/{x}.png" }), withFrame({ time: "15:05" }),
      { ...radar, frames: Array.from({ length: 13 }, (_, index) => ({ time: at(14, index * 4),
        tileUrlTemplate: tile("202611281400") })), serverTime: at(15) }])
      expect(isOccRadarFrames(bad, stationId)).toBe(false);
  });

  it("checks the query before it is sent", async () => {
    const calls: Call[] = [];
    const api = client([], calls);
    const reads = [api.getOccRegionWeather, api.getOccSigmets, api.getOccWindGrid, api.getOccRadarFrames];
    for (const read of reads)
      for (const query of [{ stationId: "PUJ" }, { stationId: "00000000-0000-0000-0000-000000000000" }, { stationId: "" },
        { stationId: 42 }, {}, { stationId, icaoCode: "MDPC" }, null])
        await expect(read(query as OccRegionWeatherQuery)).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);

    expect(normalizedOccRegionWeatherQuery({ stationId: stationId.toUpperCase() })).toEqual({ stationId });
    expect(() => normalizedOccRegionWeatherQuery({ stationId, extra: 1 } as unknown as OccRegionWeatherQuery))
      .toThrow(TypeError);
  });

  it("each read sends its GET with the station and returns the validated answer", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(region), Response.json(sigmets), Response.json(wind), Response.json(radar),
      Response.json(disabledRegion), Response.json(disabledSigmets), Response.json(disabledWind),
      Response.json(disabledRadar)], calls);
    const query = { stationId: stationId.toUpperCase() };
    await expect(api.getOccRegionWeather(query)).resolves.toEqual(region);
    await expect(api.getOccSigmets(query)).resolves.toEqual(sigmets);
    await expect(api.getOccWindGrid(query)).resolves.toEqual(wind);
    await expect(api.getOccRadarFrames(query)).resolves.toEqual(radar);
    await expect(api.getOccRegionWeather({ stationId })).resolves.toEqual(disabledRegion);
    await expect(api.getOccSigmets({ stationId })).resolves.toEqual(disabledSigmets);
    await expect(api.getOccWindGrid({ stationId })).resolves.toEqual(disabledWind);
    await expect(api.getOccRadarFrames({ stationId })).resolves.toEqual(disabledRadar);
    const urls = ["region", "sigmets", "wind", "radar"].map(read => ["GET",
      `/api/v1/occ/weather/${read}?stationId=${stationId}`]);
    expect(calls.map(call => [call.method, call.url])).toEqual([...urls, ...urls]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");
  });

  it("throws on a malformed answer, another station's or a success that is not a 200", async () => {
    const cases = [
      { read: "getOccRegionWeather", answers: [{ ...region, extra: 1 }, { ...region, stationId: otherStationId }] },
      { read: "getOccSigmets", answers: [{ ...sigmets, reason: "quota_exceeded" }, { ...sigmets, stationId: otherStationId }] },
      { read: "getOccWindGrid", answers: [{ ...wind, grid: null }, { ...wind, stationId: otherStationId }] },
      { read: "getOccRadarFrames", answers: [{ ...radar, provider: "rainviewer" }, { ...radar, stationId: otherStationId }] },
    ] as const;
    const live = { getOccRegionWeather: region, getOccSigmets: sigmets, getOccWindGrid: wind, getOccRadarFrames: radar };
    for (const { read, answers } of cases) {
      const api = client([...answers.map(answer => Response.json(answer)), Response.json(live[read], { status: 202 })]);
      for (let attempt = 0; attempt < 3; attempt++)
        await expect(api[read]({ stationId })).rejects.toMatchObject({ kind: "malformed-response" });
    }
  });

  it("keeps the weather's problem codes", async () => {
    const problem = (status: number, code: string) => Response.json(
      { title: "La consulta del clima no es válida.", status, code },
      { status, headers: { "content-type": "application/problem+json" } });
    const api = client([problem(400, "invalid_weather_query"), problem(403, "forbidden"), problem(404, "not_found"),
      problem(400, "weather_down")]);

    const invalid = await api.getOccRegionWeather({ stationId }).catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(ElevantApiError);
    expect(invalid).toMatchObject({ kind: "http", status: 400, code: "invalid_weather_query" });
    await expect(api.getOccSigmets({ stationId })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(api.getOccWindGrid({ stationId })).rejects.toMatchObject({ status: 404, code: "not_found" });
    // A code the client does not know is dropped, never passed on.
    const unknown = await api.getOccRadarFrames({ stationId }).catch((error: unknown) => error);
    expect(unknown).toMatchObject({ kind: "http", status: 400, code: undefined });
  });
});
