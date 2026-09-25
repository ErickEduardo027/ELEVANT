import { describe, expect, it } from "vitest";
import { createElevantApiClient, type AirlinePortalBootstrapResponse } from "../src";

const bootstrap: AirlinePortalBootstrapResponse = {
  airlineId: "20000000-0000-7000-8000-000000000001",
  organizationId: "10000000-0000-7000-8000-000000000002",
  iataCode: "ZZ",
  icaoCode: "DVA",
  name: "Demo Airlines",
  stations: [{
    id: "20000000-0000-7000-8000-000000000003",
    code: "PUJ",
    name: "Punta Cana",
    ianaTimeZone: "America/Santo_Domingo",
  }],
  currentOperations: [{
    id: "70000000-0000-7000-8000-000000000005",
    code: "DEV-TAT-0001",
    stationId: "20000000-0000-7000-8000-000000000003",
    stationCode: "PUJ",
    operationDate: "2026-09-25",
    status: "Assigned",
    arrivalFlightNumber: "ZZ100",
    departureFlightNumber: "ZZ101",
    plannedStartAt: "2026-09-25T12:45:00Z",
    plannedEndAt: "2026-09-25T14:30:00Z",
  }],
};

describe("airline portal bootstrap client", () => {
  it("gets server-resolved tenant scope without client authority parameters", async () => {
    const requests: Array<{ url: string; method: string | undefined;
      body: BodyInit | null | undefined; headers: Headers }> = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "airline-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), method: init?.method, body: init?.body,
          headers: new Headers(init?.headers) });
        return new Response(JSON.stringify(bootstrap), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(client.getAirlinePortalBootstrap()).resolves.toEqual(bootstrap);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.example.test/api/v1/airline/portal/bootstrap");
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.body).toBeUndefined();
    expect(requests[0]?.headers.get("authorization"))
      .toBe("Bearer airline-token");
  });

  it("rejects a malformed or mixed-tenant response", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({
        ...bootstrap,
        stations: [{ ...bootstrap.stations[0], airlineId: crypto.randomUUID() }],
      }), { headers: { "content-type": "application/json" } }),
    });

    await expect(client.getAirlinePortalBootstrap()).rejects.toMatchObject({
      kind: "malformed-response",
    });
  });

  it("rejects a mixed-station operation payload", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({
        ...bootstrap,
        currentOperations: [{ ...bootstrap.currentOperations[0], stationId: crypto.randomUUID() }],
      }), { headers: { "content-type": "application/json" } }),
    });

    await expect(client.getAirlinePortalBootstrap()).rejects.toMatchObject({
      kind: "malformed-response",
    });
  });
});
