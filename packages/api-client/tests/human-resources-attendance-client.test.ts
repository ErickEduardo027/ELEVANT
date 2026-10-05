import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  type HumanResourcesAttendancePageResponse,
  type AttendanceValidationWriteResponse,
  type ValidateAttendanceRequest,
} from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const assignmentId = "70000000-0000-7000-8000-000000000006";
const operationId = "70000000-0000-7000-8000-000000000005";
const accountId = "40000000-0000-7000-8000-000000000004";
const key = "82000000-0000-7000-8000-000000000052";
const request: ValidateAttendanceRequest = {
  expectedOccRevision: 1,
  expectedRampAgentRevision: 2,
  startSource: "Occ",
  endSource: "RampAgent",
  reason: "Diferencia revisada",
};
const page: HumanResourcesAttendancePageResponse = {
  stationId, from: "2026-10-01", to: "2026-10-05", page: 1, limit: 20,
  hasMore: false,
  items: [{ operationId, assignmentId, stationId, operationDate: "2026-10-02",
    operationCode: "EV 311", agentName: "Agente de prueba",
    occ: { revision: 1, authorAccountId: accountId,
      recordedAt: "2026-10-02T12:00:00Z", observedStartAt: "2026-10-02T12:00:00Z",
      observedEndAt: "2026-10-02T14:00:00Z", incidentNote: null },
    rampAgent: null, latestDecision: null, isDecisionCurrent: false }],
};
const written: AttendanceValidationWriteResponse = {
  replayed: false,
  decision: { id: "83000000-0000-7000-8000-000000000052",
    assignmentId, occRevision: 1, rampAgentRevision: 2,
    startSource: "Occ", endSource: "RampAgent",
    startAt: "2026-10-02T12:00:00Z", endAt: "2026-10-02T14:05:00Z",
    reason: "Diferencia revisada", validatedByAccountId: accountId,
    validatedAt: "2026-10-02T15:00:00Z" },
};

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

describe("G.H. attendance validation API client", () => {
  it("reads a bounded station/date page with a fresh token", async () => {
    let url = "";
    let authorization = "";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "current-token",
      fetch: async (input, init) => {
        url = String(input);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return response(page);
      },
    });
    await expect(client.getHumanResourcesAttendance({
      stationId, from: "2026-10-01", to: "2026-10-05", page: 1, limit: 20,
    })).resolves.toEqual(page);
    expect(new URL(url).searchParams.get("stationId")).toBe(stationId);
    expect(new URL(url).searchParams.get("from")).toBe("2026-10-01");
    expect(authorization).toBe("Bearer current-token");
  });

  it("uses caller's stable key rather than an injected header", async () => {
    let headers = new Headers();
    let body: unknown;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "current-token",
      fetch: async (_, init) => {
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body));
        return response(written);
      },
    });
    await expect(client.validateHumanResourcesAttendance(assignmentId,
      stationId, request, key,
      { headers: { "Idempotency-Key": crypto.randomUUID() } }))
      .resolves.toEqual(written);
    expect(headers.get("idempotency-key")).toBe(key);
    expect(body).toEqual(request);
  });

  it("rejects forged inputs and a malformed canonical decision", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "current-token",
      fetch: async () => {
        calls += 1;
        return response({ ...written, decision: { ...written.decision,
          startAt: "2026-10-02T16:00:00Z" } });
      },
    });
    await expect(client.validateHumanResourcesAttendance(assignmentId,
      stationId, { ...request, validatedByAccountId: accountId } as ValidateAttendanceRequest,
      key)).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
    await expect(client.validateHumanResourcesAttendance(assignmentId,
      stationId, request, key)).rejects.toMatchObject({
      kind: "malformed-response", status: 200,
    });
  });
});
