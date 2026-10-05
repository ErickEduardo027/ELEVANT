import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  type AttendanceDraftContributionResponse,
  type AttendanceDraftSnapshotResponse,
  type AttendanceDraftWriteResponse,
  type SaveAttendanceDraftRequest,
} from "../src";

const operationId = "70000000-0000-7000-8000-000000000005";
const assignmentId = "70000000-0000-7000-8000-000000000006";
const stationId = "20000000-0000-7000-8000-000000000003";
const accountId = "40000000-0000-7000-8000-000000000001";
const installationId = "81000000-0000-7000-8000-000000000041";
const key = "82000000-0000-7000-8000-000000000041";
const url = `https://api.example.test/api/v1/operations/${operationId}/assignments/${assignmentId}/attendance-draft`;
const request: SaveAttendanceDraftRequest = {
  expectedRevision: 0,
  observedStartAt: "2026-10-02T12:00:00.000Z",
  observedEndAt: null,
  incidentNote: "Equipo listo",
};
const contribution: AttendanceDraftContributionResponse = {
  revision: 1,
  authorAccountId: accountId,
  recordedAt: "2026-10-02T12:01:00.000Z",
  observedStartAt: "2026-10-02T12:00:00.000Z",
  observedEndAt: null,
  incidentNote: "Equipo listo",
};
const snapshot: AttendanceDraftSnapshotResponse = {
  operationId, assignmentId, stationId, occ: contribution, rampAgent: null,
};
const written: AttendanceDraftWriteResponse = { contribution, replayed: false };

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("shared attendance draft API client", () => {
  it("reads both lanes through a token-fresh request and forwards the optional device", async () => {
    let requestedUrl = "";
    let headers = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "fresh-token",
      fetch: async (input, init) => {
        requestedUrl = String(input);
        headers = new Headers(init?.headers);
        return response(snapshot);
      },
    });
    await expect(client.getOperationAttendanceDraft(operationId, assignmentId, {
      installationId,
    })).resolves.toEqual(snapshot);
    expect(requestedUrl).toBe(url);
    expect(headers.get("authorization")).toBe("Bearer fresh-token");
    expect(headers.get("x-elevant-installation-id")).toBe(installationId);
  });

  it("sends lane-specific writes with protected idempotency and device headers", async () => {
    const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "fresh-token",
      fetch: async (input, init) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) });
        return response(written);
      },
    });
    await client.saveOccAttendanceDraft(operationId, assignmentId, request, key,
      { headers: { "Idempotency-Key": crypto.randomUUID() } });
    await client.saveRampAttendanceDraft(operationId, assignmentId, request,
      key, installationId);
    expect(calls.map(call => call.url)).toEqual([`${url}/occ`, `${url}/ramp-agent`]);
    expect(calls[0]?.headers.get("idempotency-key")).toBe(key);
    expect(calls[0]?.headers.get("x-elevant-installation-id")).toBeNull();
    expect(calls[1]?.headers.get("idempotency-key")).toBe(key);
    expect(calls[1]?.headers.get("x-elevant-installation-id")).toBe(installationId);
    expect(calls.map(call => call.body)).toEqual([request, request]);
  });

  it("rejects forged input and malformed canonical output", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "fresh-token",
      fetch: async () => {
        calls += 1;
        return response({ ...snapshot, stationId: "not-a-uuid" });
      },
    });
    await expect(client.saveOccAttendanceDraft(operationId, assignmentId,
      { ...request, lane: "Occ" } as SaveAttendanceDraftRequest, key))
      .rejects.toThrow(TypeError);
    expect(calls).toBe(0);
    await expect(client.getOperationAttendanceDraft(operationId, assignmentId))
      .rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });

  it("rejects an invented lane revision or mismatched reply", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "fresh-token",
      fetch: async () => response({ contribution: { ...contribution, revision: 2 }, replayed: false }),
    });
    await expect(client.saveOccAttendanceDraft(operationId, assignmentId, request, key))
      .rejects.toMatchObject({ kind: "malformed-response", status: 200 });

    const wrongNoteClient = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "fresh-token",
      fetch: async () => response({ contribution: { ...contribution,
        incidentNote: "Otro dato" }, replayed: false }),
    });
    await expect(wrongNoteClient.saveOccAttendanceDraft(operationId,
      assignmentId, request, key))
      .rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });
});
