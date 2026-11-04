import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const terminalId = "20000000-0000-7000-8000-000000000004";
const standId = "20000000-0000-7000-8000-000000000005";
const otherStandId = "20000000-0000-7000-8000-000000000011";
const agentId = "33000000-0000-7000-8000-000000000001";
const coverageId = "60000000-0000-7000-8000-000000000001";
const board = {
  stationId, stationCode: "PUJ", date: "2026-08-19", canAssign: true, canConfigure: true,
  terminals: [{ terminalId, code: "A", name: "Terminal A", maxStandsPerAgent: 3, requiresBridgeQualification: false }],
  stands: [{ standId, code: "A01", terminalId, isActive: true, hasBoardingBridge: false, isRemote: false,
    maxAircraftSize: null, coveredBy: ["Riley Ramp"] }],
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
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
        body: String(init?.body ?? "") });
      return String(input).endsWith("/assignment/release") ? new Response(null, { status: 204 }) : Response.json(board);
    } });
    await expect(client.getOccCoverage(stationId, "2026-08-19")).resolves.toMatchObject({ canConfigure: true });
    await client.createOccCoverage({ stationId, date: "2026-08-19", agentId, terminalId, standIds: [standId, otherStandId],
      vehicleCode: " VH-07 ", isReinforcement: false });
    await client.releaseOccCoverage(coverageId, "2026-08-19");
    await client.updateOccStandAttributes(standId, { date: "2026-08-19", hasBoardingBridge: true, isRemote: false,
      maxAircraftSize: "Narrowbody", isActive: true });
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
