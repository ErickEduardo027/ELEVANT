import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const arrivalId = "70000000-0000-7000-8000-000000000001";
const departureId = "70000000-0000-7000-8000-000000000002";
const proposal = {
  proposalId: arrivalId, direction: "Arrival", flightNumber: "ZZ161", airlineId: "50000000-0000-7000-8000-000000000002",
  airlineName: "Demo Airlines", airlineIataCode: "ZZ", counterpartIata: "SDQ", counterpartName: "Santo Domingo",
  counterpartKnown: true, scheduledAt: "2026-11-03T14:05:00.000+00:00", revisedAt: null, runwayAt: null,
  providerStatus: "Expected", aircraftRegistration: "HI1055", aircraftModel: "Boeing 737", terminal: "B", gate: "22",
  status: "Proposed", turnaroundId: null, suggestedDepartureId: departureId, lastSeenAt: "2026-11-03T12:00:00.000+00:00",
};
const feed = {
  stationId, stationCode: "PUJ", date: "2026-11-03", lastReadAt: "2026-11-03T12:00:00.000+00:00", nextManualRefreshAt: null,
  canImport: true, proposals: [proposal],
  budget: { configured: true, provider: "AeroDataBox", unitsToday: 12, dailyUnits: 1200, unitsThisMonth: 300,
    monthlyUnits: 38000, pausedUntil: null, pauseReason: null },
};

describe("OCC flight feed client (ADR-0028)", () => {
  it("reads proposals, refreshes, imports a pair and dismisses", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const replies = [Response.json(feed), Response.json({ status: "Throttled", retryAt: "2026-11-03T12:10:00.000+00:00",
      flightsReceived: null, contractedLegs: null, newProposals: null }),
    Response.json({ turnaroundId: "30000000-0000-7000-8000-000000000009", operationCode: "EXT-1", replayed: false }),
    new Response(null, { status: 204 })];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
        body: String(init?.body ?? "") });
      return replies.shift()!;
    } });
    await expect(client.getOccFlightFeed(stationId, "2026-11-03")).resolves.toMatchObject({ budget: { unitsToday: 12 } });
    await expect(client.refreshOccFlightFeed(stationId)).resolves.toMatchObject({ status: "Throttled" });
    await expect(client.importOccFlight(arrivalId, departureId)).resolves.toMatchObject({ operationCode: "EXT-1" });
    await client.dismissOccFlightProposal(arrivalId);
    expect(requests.map(item => [item.method, item.url])).toEqual([
      ["GET", `/api/v1/occ/flight-feed?stationId=${stationId}&date=2026-11-03`],
      ["POST", "/api/v1/occ/flight-feed/refresh"],
      ["POST", "/api/v1/occ/flight-feed/turnarounds"],
      ["POST", `/api/v1/occ/flight-feed/proposals/${arrivalId}/dismiss`],
    ]);
    expect(JSON.parse(requests[1]!.body)).toEqual({ stationId });
    expect(JSON.parse(requests[2]!.body)).toEqual({ arrivalProposalId: arrivalId, departureProposalId: departureId });
  });

  it("rejects unknown fields, statuses and an arrival paired with itself", async () => {
    const client = (body: unknown) => createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => Response.json(body) });
    await expect(client({ ...feed, proposals: [{ ...proposal, price: 10 }] }).getOccFlightFeed(stationId, "2026-11-03"))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client({ ...feed, proposals: [{ ...proposal, status: "Dismissed" }] }).getOccFlightFeed(stationId, "2026-11-03"))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client({ status: "Called", retryAt: null, flightsReceived: null, contractedLegs: null, newProposals: null })
      .refreshOccFlightFeed(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client({}).importOccFlight(arrivalId, arrivalId)).rejects.toThrow(TypeError);
  });
});
