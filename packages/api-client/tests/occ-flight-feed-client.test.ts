import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError, normalizedFlightImport } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const arrivalId = "70000000-0000-7000-8000-000000000001";
const departureId = "70000000-0000-7000-8000-000000000002";
const typeId = "20000000-0000-7000-8000-000000000020";
const standId = "20000000-0000-7000-8000-000000000005";
const key = "a0000000-0000-7000-8000-000000000009";
const proposal = {
  proposalId: arrivalId, direction: "Arrival", flightNumber: "ZZ161", airlineId: "50000000-0000-7000-8000-000000000002",
  airlineName: "Demo Airlines", airlineIataCode: "ZZ", counterpartIata: "SDQ", counterpartName: "Santo Domingo",
  counterpartKnown: true, scheduledAt: "2026-11-03T14:05:00.000+00:00", revisedAt: null, runwayAt: null,
  providerStatus: "Expected", aircraftRegistration: "HI1055", aircraftModel: "Boeing 737", terminal: "B", gate: "22",
  status: "Proposed", turnaroundId: null, suggestedDepartureId: departureId, lastSeenAt: "2026-11-03T12:00:00.000+00:00",
  version: "AAAAAAAAB9E=", suggestedAircraftTypeId: typeId,
};
const feed = {
  stationId, stationCode: "PUJ", date: "2026-11-03", lastReadAt: "2026-11-03T12:00:00.000+00:00", nextManualRefreshAt: null,
  canImport: true, proposals: [proposal],
  budget: { configured: true, provider: "AeroDataBox", unitsToday: 12, dailyUnits: 1200, unitsThisMonth: 300,
    monthlyUnits: 38000, pausedUntil: null, pauseReason: null },
};

type Call = { url: string; method: string; headers: Headers; body: string };

function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
    calls.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
      headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    return answers.shift()!;
  } });
}

const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  Response.json({ title: "El vuelo propuesto cambió o no se puede importar así.", status, code, ...extra },
    { status, headers: { "content-type": "application/problem+json" } });

describe("OCC flight feed client (ADR-0028)", () => {
  it("reads proposals, refreshes, imports a pair and dismisses", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(feed), Response.json({ status: "Throttled", retryAt: "2026-11-03T12:10:00.000+00:00",
      flightsReceived: null, contractedLegs: null, newProposals: null }),
    Response.json({ turnaroundId: "30000000-0000-7000-8000-000000000009", operationCode: "EXT-1", replayed: false }),
    new Response(null, { status: 204 })], calls);
    await expect(api.getOccFlightFeed(stationId, "2026-11-03")).resolves.toMatchObject({ budget: { unitsToday: 12 } });
    await expect(api.refreshOccFlightFeed(stationId)).resolves.toMatchObject({ status: "Throttled" });
    await expect(api.importOccFlight(arrivalId, departureId)).resolves.toMatchObject({ operationCode: "EXT-1" });
    await api.dismissOccFlightProposal(arrivalId);
    expect(calls.map(item => [item.method, item.url])).toEqual([
      ["GET", `/api/v1/occ/flight-feed?stationId=${stationId}&date=2026-11-03`],
      ["POST", "/api/v1/occ/flight-feed/refresh"],
      ["POST", "/api/v1/occ/flight-feed/turnarounds"],
      ["POST", `/api/v1/occ/flight-feed/proposals/${arrivalId}/dismiss`],
    ]);
    expect(JSON.parse(calls[1]!.body)).toEqual({ stationId });
    // The older import keeps its body: no key, no versions.
    expect(JSON.parse(calls[2]!.body)).toEqual({ arrivalProposalId: arrivalId, departureProposalId: departureId });
    expect(calls[2]!.headers.get("idempotency-key")).toBeNull();
  });

  it("rejects unknown fields, statuses and an arrival paired with itself", async () => {
    const one = (body: unknown) => createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => Response.json(body) });
    await expect(one({ ...feed, proposals: [{ ...proposal, price: 10 }] }).getOccFlightFeed(stationId, "2026-11-03"))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(one({ ...feed, proposals: [{ ...proposal, status: "Dismissed" }] }).getOccFlightFeed(stationId, "2026-11-03"))
      .rejects.toMatchObject({ kind: "malformed-response" });
    // Every proposal carries the version of its import or restore (2-B, 2-N36).
    const { version: _version, ...withoutVersion } = proposal;
    await expect(one({ ...feed, proposals: [withoutVersion] }).getOccFlightFeed(stationId, "2026-11-03"))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(one({ ...feed, proposals: [{ ...proposal, suggestedAircraftTypeId: "A320" }] })
      .getOccFlightFeed(stationId, "2026-11-03")).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(one({ status: "Called", retryAt: null, flightsReceived: null, contractedLegs: null, newProposals: null })
      .refreshOccFlightFeed(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(one({}).importOccFlight(arrivalId, arrivalId)).rejects.toThrow(TypeError);
  });

  it("reads the charter candidates and the dismissed proposals as separate views (2-B, 2-N36)", async () => {
    const calls: Call[] = [];
    const dismissed = { ...proposal, status: "Dismissed", suggestedDepartureId: null };
    const api = client([Response.json(feed), Response.json({ ...feed, proposals: [dismissed] }),
      Response.json({ ...feed, proposals: [proposal] })], calls);
    await expect(api.getOccFlightFeed(stationId, "2026-11-03", { view: "Charter" })).resolves.toMatchObject({
      proposals: [{ flightNumber: "ZZ161" }] });
    await expect(api.getOccFlightFeed(stationId, "2026-11-03", { view: "Dismissed" })).resolves.toMatchObject({
      proposals: [{ status: "Dismissed" }] });
    // The dismissed view never lists a proposal under review.
    await expect(api.getOccFlightFeed(stationId, "2026-11-03", { view: "Dismissed" }))
      .rejects.toMatchObject({ kind: "malformed-response" });
    expect(calls.map(item => item.url)).toEqual([
      `/api/v1/occ/flight-feed?stationId=${stationId}&date=2026-11-03&view=Charter`,
      `/api/v1/occ/flight-feed?stationId=${stationId}&date=2026-11-03&view=Dismissed`,
      `/api/v1/occ/flight-feed?stationId=${stationId}&date=2026-11-03&view=Dismissed`,
    ]);
    await expect(api.getOccFlightFeed(stationId, "2026-11-03", { view: "Suspended" as never })).rejects.toThrow(TypeError);
  });

  it("imports with the intent's key, both versions, the type, the stand and the charter mode", async () => {
    const calls: Call[] = [];
    const answer = { turnaroundId: "30000000-0000-7000-8000-000000000009", operationCode: "EXT-1", replayed: false };
    const api = client([Response.json(answer), Response.json({ ...answer, replayed: true, extra: 1 })], calls);
    const command = { arrivalProposalId: arrivalId, departureProposalId: departureId, expectedArrivalVersion: "AAAAAAAAB9E=",
      expectedDepartureVersion: "AAAAAAAAB9F=", aircraftTypeId: typeId, standId, charter: true };
    await expect(api.importOccFlightProposals(command, key)).resolves.toEqual(answer);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/occ/flight-feed/turnarounds" });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(calls[0]!.body)).toEqual(command);
    await expect(api.importOccFlightProposals(command, key)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.importOccFlightProposals(command, "not-a-key")).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(2);
  });

  it("accepts the pair linked to the flight OCC had planned, and an older answer without the flag (3-N07)", async () => {
    const answer = { turnaroundId: "30000000-0000-7000-8000-000000000009", operationCode: "PUJ-20261105-001", replayed: false };
    const api = client([Response.json({ ...answer, linked: true }), Response.json(answer),
      Response.json({ ...answer, linked: "yes" })]);
    const command = { arrivalProposalId: arrivalId, departureProposalId: departureId, expectedArrivalVersion: "AAAAAAAAB9E=",
      expectedDepartureVersion: "AAAAAAAAB9F=" };
    await expect(api.importOccFlightProposals(command, key)).resolves.toEqual({ ...answer, linked: true });
    await expect(api.importOccFlightProposals(command, key)).resolves.toEqual(answer);
    await expect(api.importOccFlightProposals(command, key)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("normalizes the import body and refuses one without versions, unknown fields or a pair of one leg", () => {
    expect(normalizedFlightImport({ arrivalProposalId: arrivalId, departureProposalId: departureId,
      expectedArrivalVersion: "AAAAAAAAB9E=", expectedDepartureVersion: "AAAAAAAAB9F=" })).toEqual({
      arrivalProposalId: arrivalId, departureProposalId: departureId, aircraftTypeId: null, standId: null, charter: false,
      expectedArrivalVersion: "AAAAAAAAB9E=", expectedDepartureVersion: "AAAAAAAAB9F=" });
    const valid = { arrivalProposalId: arrivalId, departureProposalId: departureId, expectedArrivalVersion: "AAAAAAAAB9E=",
      expectedDepartureVersion: "AAAAAAAAB9F=" };
    expect(() => normalizedFlightImport({ ...valid, expectedDepartureVersion: " " })).toThrow(TypeError);
    expect(() => normalizedFlightImport({ ...valid, departureProposalId: arrivalId })).toThrow(TypeError);
    expect(() => normalizedFlightImport({ ...valid, standId: "A01" })).toThrow(TypeError);
    expect(() => normalizedFlightImport({ ...valid, gate: "22" } as never)).toThrow(TypeError);
  });

  it("keeps the flight feed codes and the stand rules of a refused import", async () => {
    const api = client([problem(409, "stand_unavailable", { reasons: ["stand_taken", "unknown_rule"] }),
      problem(409, "contract_not_in_force"), problem(409, "charter_required")]);
    const command = { arrivalProposalId: arrivalId, departureProposalId: departureId, expectedArrivalVersion: "AAAAAAAAB9E=",
      expectedDepartureVersion: "AAAAAAAAB9F=", standId };
    const taken = await api.importOccFlightProposals(command, key).catch((error: unknown) => error);
    expect(taken).toBeInstanceOf(ElevantApiError);
    expect(taken).toMatchObject({ status: 409, code: "stand_unavailable", reasons: ["stand_taken"] });
    await expect(api.importOccFlightProposals(command, key)).rejects.toMatchObject({ code: "contract_not_in_force" });
    await expect(api.importOccFlightProposals(command, key)).rejects.toMatchObject({ code: "charter_required" });
  });

  it("restores a dismissed proposal with its version and the intent's key", async () => {
    const calls: Call[] = [];
    const restored = { proposalId: arrivalId, status: "Proposed", version: "AAAAAAAAB+E=", replayed: false };
    const api = client([Response.json(restored), Response.json({ ...restored, proposalId: departureId }),
      problem(409, "flight_proposal_passed")], calls);
    await expect(api.restoreOccFlightProposal(arrivalId, "AAAAAAAAB9E=", key)).resolves.toEqual(restored);
    expect(calls[0]).toMatchObject({ method: "POST", url: `/api/v1/occ/flight-feed/proposals/${arrivalId}/restore` });
    expect(JSON.parse(calls[0]!.body)).toEqual({ expectedVersion: "AAAAAAAAB9E=" });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    // The answer is always the proposal of the route.
    await expect(api.restoreOccFlightProposal(arrivalId, "AAAAAAAAB9E=", key)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.restoreOccFlightProposal(arrivalId, "AAAAAAAAB9E=", key)).rejects.toMatchObject({
      status: 409, code: "flight_proposal_passed" });
    await expect(api.restoreOccFlightProposal(arrivalId, " ", key)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(3);
  });
});
