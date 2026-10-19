import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const body = {
  source: "OpenSky Network",
  providerTime: "2026-10-17T20:00:00Z",
  retrievedAt: "2026-10-17T20:00:04Z",
  stale: false,
  aircraft: [{
    icao24: "a1b2c3", callsign: null, originCountry: null,
    latitude: 18.56, longitude: -68.36, lastPositionAt: null,
    lastContactAt: null, barometricAltitudeMeters: null,
    geometricAltitudeMeters: null, groundSpeedMetersPerSecond: null,
    trueTrackDegrees: null, verticalRateMetersPerSecond: null,
    onGround: false, squawk: null, positionSource: null, category: null,
  }],
};

describe("OCC aircraft traffic client", () => {
  it("sends only the station ID with bearer auth and preserves null telemetry", async () => {
    let url = "";
    let headers = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "fixture-token",
      fetch: async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        return new Response(JSON.stringify(body), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
    });
    await expect(client.getOccAircraftTraffic({ stationId })).resolves.toEqual(body);
    expect(url).toBe(`https://api.example.test/api/v1/occ/traffic/aircraft?stationId=${stationId}`);
    expect(headers.get("authorization")).toBe("Bearer fixture-token");
  });

  it("rejects additional client parameters and malformed positions", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "fixture-token",
      fetch: async () => {
        calls++;
        return new Response(JSON.stringify({ ...body,
          aircraft: [{ ...body.aircraft[0], latitude: 25 }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
    });
    await expect(client.getOccAircraftTraffic({ stationId, lamin: 0 } as never))
      .rejects.toBeInstanceOf(TypeError);
    expect(calls).toBe(0);
    await expect(client.getOccAircraftTraffic({ stationId }))
      .rejects.toBeInstanceOf(ElevantApiError);
  });
});
