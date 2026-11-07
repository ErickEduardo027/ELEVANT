import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError, normalizedStandAttributes } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const terminalId = "20000000-0000-7000-8000-000000000004";
const standId = "20000000-0000-7000-8000-000000000005";
const otherStandId = "20000000-0000-7000-8000-000000000011";
const agentId = "33000000-0000-7000-8000-000000000001";
const coverageId = "60000000-0000-7000-8000-000000000001";
const key = "a0000000-0000-7000-8000-000000000009";
const board = {
  stationId, stationCode: "PUJ", date: "2026-08-19", canAssign: true, canConfigure: true,
  terminals: [{ terminalId, code: "A", name: "Terminal A", maxStandsPerAgent: 3, requiresBridgeQualification: false }],
  stands: [{ standId, code: "A01", terminalId, isActive: true, hasBoardingBridge: false, isRemote: false,
    maxAircraftSize: null, coveredBy: ["Riley Ramp"], version: "AAAAAAAAB9E=" }],
  constraints: [{ id: coverageId, standId, standCode: "A01", affectedStandId: otherStandId, affectedStandCode: "A02", kind: "Cancels" }],
  agents: [{ agentId, name: "Riley Ramp", employeeNumber: "DEV-RA-001", terminalId, terminalCode: "A",
    shiftStartsAt: "2026-08-19T10:00:00.000Z", shiftEndsAt: "2026-08-19T18:00:00.000Z", isJunior: false,
    hasAirportPermit: true, hasDriverLicense: true, hasBridgeQualification: false, isAbsent: false }],
  coverages: [{ id: coverageId, agentId, agentName: "Riley Ramp", terminalId, terminalCode: "A",
    stands: [{ standId, code: "A01" }], startsAt: "2026-08-19T10:00:00.000Z", endsAt: "2026-08-19T18:00:00.000Z",
    mentorAgentId: null, mentorName: null, vehicleCode: null, isReinforcement: false }],
};

describe("OCC position coverage client (ADR-0030)", () => {
  it("reads the board and sends coverage and configuration commands", async () => {
    const requests: Array<{ url: string; method: string; body: string; headers: Headers }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
        body: String(init?.body ?? ""), headers: new Headers(init?.headers) });
      return String(input).endsWith("/assignment/release") ? new Response(null, { status: 204 }) : Response.json(board);
    } });
    await expect(client.getOccCoverage(stationId, "2026-08-19")).resolves.toMatchObject({ canConfigure: true });
    await client.createOccCoverage({ stationId, date: "2026-08-19", agentId, terminalId, standIds: [standId, otherStandId],
      vehicleCode: " VH-07 ", isReinforcement: false });
    await client.releaseOccCoverage(coverageId, "2026-08-19");
    await client.updateOccStandAttributes(standId, { date: "2026-08-19", hasBoardingBridge: true, isRemote: false,
      maxAircraftSize: "Narrowbody", isActive: true, expectedVersion: "AAAAAAAAB9E=" }, key);
    await client.updateOccTerminalRules(terminalId, { date: "2026-08-19", maxStandsPerAgent: 2, requiresBridgeQualification: true });
    await client.addOccStandConstraint({ date: "2026-08-19", standId, affectedStandId: otherStandId, kind: "Cancels" });
    await client.removeOccStandConstraint(coverageId, "2026-08-19");
    await client.releaseOccOperationAgent(agentId);
    expect(requests.map(item => [item.method, item.url])).toEqual([
      ["GET", `/api/v1/occ/coverage?stationId=${stationId}&date=2026-08-19`],
      ["POST", "/api/v1/occ/coverage"],
      ["POST", `/api/v1/occ/coverage/${coverageId}/release?date=2026-08-19`],
      ["PUT", `/api/v1/occ/stands/${standId}/attributes`],
      ["PUT", `/api/v1/occ/terminals/${terminalId}/coverage-rules`],
      ["POST", "/api/v1/occ/stand-constraints"],
      ["DELETE", `/api/v1/occ/stand-constraints/${coverageId}?date=2026-08-19`],
      ["POST", `/api/v1/occ/planning/turnarounds/${agentId}/assignment/release`],
    ]);
    expect(JSON.parse(requests[1]!.body)).toMatchObject({ standIds: [standId, otherStandId], vehicleCode: "VH-07",
      startsAt: null, endsAt: null, mentorAgentId: null });
    // The stand attributes carry the version on the board and the intent's key (2-A).
    expect(JSON.parse(requests[3]!.body)).toEqual({ date: "2026-08-19", hasBoardingBridge: true, isRemote: false,
      maxAircraftSize: "Narrowbody", isActive: true, expectedVersion: "AAAAAAAAB9E=" });
    expect(requests[3]!.headers.get("idempotency-key")).toBe(key);
    expect(requests[3]!.headers.get("content-type")).toBe("application/json");
  });

  it("needs every stand's version on the board, and the version and the key of a stand change (2-A)", async () => {
    let calls = 0;
    const { version: _version, ...withoutVersion } = board.stands[0]!;
    const one = (body: unknown) => createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => { calls += 1; return Response.json(body); } });
    await expect(one({ ...board, stands: [withoutVersion] }).getOccCoverage(stationId, "2026-08-19"))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(one({ ...board, stands: [{ ...board.stands[0], version: "" }] }).getOccCoverage(stationId, "2026-08-19"))
      .rejects.toMatchObject({ kind: "malformed-response" });
    const attributes = { date: "2026-08-19", hasBoardingBridge: false, isRemote: false, maxAircraftSize: null,
      isActive: false, expectedVersion: "AAAAAAAAB9E=" } as const;
    await expect(one(board).updateOccStandAttributes(standId, { ...attributes, expectedVersion: " " }, key))
      .rejects.toThrow(TypeError);
    await expect(one(board).updateOccStandAttributes(standId, attributes, "not-a-key")).rejects.toThrow(TypeError);
    expect(calls).toBe(2);
    // The screens validate with the same rules before sending, so invalid data is never taken for a network failure.
    expect(normalizedStandAttributes({ ...attributes, extra: 1 } as never)).toEqual(attributes);
    expect(() => normalizedStandAttributes({ ...attributes, maxAircraftSize: "Huge" as never })).toThrow(TypeError);
    expect(() => normalizedStandAttributes({ ...attributes, expectedVersion: "x".repeat(65) })).toThrow(TypeError);
  });

  it("keeps the stand rules of a refused stand change: in use or of an inactive terminal (2-A)", async () => {
    const answers = [Response.json({ status: 422, title: "The coverage breaks assignment rules.", code: "terminal_inactive",
      reasons: ["terminal_inactive"] }, { status: 422, headers: { "content-type": "application/problem+json" } }),
    Response.json({ status: 409, title: "The data changed; read the board again.", code: "version_conflict" },
      { status: 409, headers: { "content-type": "application/problem+json" } })];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async () => answers.shift()! });
    const attributes = { date: "2026-08-19", hasBoardingBridge: false, isRemote: false, maxAircraftSize: null,
      isActive: true, expectedVersion: "AAAAAAAAB9E=" } as const;
    await expect(client.updateOccStandAttributes(standId, attributes, key)).rejects.toMatchObject({
      status: 422, code: "terminal_inactive", reasons: ["terminal_inactive"] });
    await expect(client.updateOccStandAttributes(standId, attributes, key)).rejects.toMatchObject({
      status: 409, code: "version_conflict" });
  });

  it("rejects invalid commands before calling and keeps only known rule reasons", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async () => Response.json(
      { status: 422, title: "The coverage breaks assignment rules.", reasons: ["too_many_stands", "<script>", "vehicle_required"] },
      { status: 422, headers: { "content-type": "application/problem+json" } }) });
    await expect(client.createOccCoverage({ stationId, date: "2026-08-19", agentId, terminalId, standIds: [],
      isReinforcement: false })).rejects.toThrow(TypeError);
    await expect(client.updateOccTerminalRules(terminalId, { date: "2026-08-19", maxStandsPerAgent: 9,
      requiresBridgeQualification: false })).rejects.toThrow(TypeError);
    const failure = await client.createOccCoverage({ stationId, date: "2026-08-19", agentId, terminalId,
      standIds: [standId], isReinforcement: false }).catch(error => error);
    expect(failure).toBeInstanceOf(ElevantApiError);
    expect(failure.status).toBe(422);
    expect(failure.reasons).toEqual(["too_many_stands", "vehicle_required"]);
  });

  it("reads the ramp agent's own coverage", async () => {
    const own = { coverages: [{ id: coverageId, stationCode: "PUJ", terminalCode: "A", stands: ["A01", "A02"],
      startsAt: "2026-08-19T10:00:00.000Z", endsAt: "2026-08-19T18:00:00.000Z", partner: null, vehicleCode: null,
      isReinforcement: false }] };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async () => Response.json(own) });
    await expect(client.getOwnRampCoverage()).resolves.toEqual(own);
  });
});
