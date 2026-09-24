import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  type OccReviewQueueResponse,
  type OccReviewDetailResponse,
  type OccReviewSubmissionHistoryResponse,
  type DecideOccReviewResponse,
} from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const operationId = "70000000-0000-7000-8000-000000000005";
const submissionId = "85000000-0000-7000-8000-000000000022";
const etag = `"${"a".repeat(64)}"`;
const submittedAt = "2026-09-23T12:00:00.000Z";
const queue: OccReviewQueueResponse = {
  stationId, stationCode: "PUJ", stationName: "Punta Cana",
  ianaTimeZone: "America/Santo_Domingo", hasMore: false,
  operations: [{ operationId, submissionId, revisionNumber: 1,
    status: "PendingReview", operationCode: "DEV-TAT-0002", operationDate: "2026-09-23",
    airlineName: "Demo Air", agentName: "Riley Ramp", submittedAt,
    serviceCount: 1, incidentCount: 0 }],
};
const detail: OccReviewDetailResponse = {
  operationId, submissionId, revisionNumber: 1, status: "PendingReview",
  operationCode: "DEV-TAT-0002", operationDate: "2026-09-23",
  airlineName: "Demo Air", agentName: "Riley Ramp", submittedAt,
  stationId, stationCode: "PUJ", ianaTimeZone: "America/Santo_Domingo",
  plannedStartAt: null, plannedEndAt: null, actualStartAt: submittedAt,
  actualEndAt: submittedAt, agentNote: null, checklistStatus: "Submitted",
  checklistAnswers: [{ section: "Seguridad", code: "SAFE-01", label: "Área segura", value: "Ok", note: null }],
  services: [{ id: "70000000-0000-7000-8000-000000000017", code: "PASSENGER-BRIDGE",
    name: "Puente", status: "Completed", contractedQuantity: 1, executedQuantity: 1, unit: "uso" }],
  incidents: [], decision: null, reviewVersion: etag,
};
const decision: DecideOccReviewResponse = {
  operationId, submissionId, status: "Returned", outcome: "Returned",
  decidedAt: "2026-09-23T12:05:00.000Z", reason: "Corregir el servicio",
};
const history: OccReviewSubmissionHistoryResponse = {
  operationId, hasMore: false,
  submissions: [{ submissionId, revisionNumber: 1, status: "Returned",
    submittedAt, outcome: "Returned", decidedAt: "2026-09-23T12:05:00.000Z" }],
};

function json(body: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("OCC review API client", () => {
  it("loads station queue and a detail whose ETag matches its body", async () => {
    const paths: string[] = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async (input) => {
        paths.push(String(input));
        return paths.length === 1 ? json(queue) : json(detail, { etag });
      },
    });
    await expect(client.getOccReviewQueue(stationId)).resolves.toEqual(queue);
    await expect(client.getOccReviewDetail(operationId)).resolves.toEqual(detail);
    expect(paths).toEqual([
      `https://api.example.test/api/v1/occ/review/queue?stationId=${stationId}`,
      `https://api.example.test/api/v1/occ/review/operations/${operationId}`,
    ]);
  });

  it("rejects forged scope or a mismatched concurrency token", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => {
        calls += 1;
        return calls === 1 ? json({ ...queue, stationId: crypto.randomUUID() })
          : json(detail, { etag: `"${"b".repeat(64)}"` });
      },
    });
    await expect(client.getOccReviewQueue(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client.getOccReviewDetail(operationId)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("loads one historical handoff by both IDs and rejects a different submission", async () => {
    const paths: string[] = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async (input) => {
        paths.push(String(input));
        return json({ ...detail, status: "Returned", decision: {
          outcome: "Returned", reason: "Corregir el servicio",
          decidedAt: "2026-09-23T12:05:00.000Z",
        } });
      },
    });
    await expect(client.getOccReviewSubmissionDetail(operationId, submissionId))
      .resolves.toMatchObject({ submissionId, status: "Returned" });
    expect(paths).toEqual([
      `https://api.example.test/api/v1/occ/review/operations/${operationId}/submissions/${submissionId}`,
    ]);
    await expect(client.getOccReviewSubmissionDetail(operationId, crypto.randomUUID()))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("loads scoped immutable revision history and rejects malformed revisions", async () => {
    const paths: string[] = [];
    let result: unknown = history;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async (input) => { paths.push(String(input)); return json(result); },
    });
    await expect(client.getOccReviewSubmissionHistory(operationId)).resolves.toEqual(history);
    expect(paths).toEqual([
      `https://api.example.test/api/v1/occ/review/operations/${operationId}/submissions`,
    ]);
    result = { ...history, submissions: [history.submissions[0], history.submissions[0]] };
    await expect(client.getOccReviewSubmissionHistory(operationId))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("sends one scoped decision with If-Match and rejects malformed results", async () => {
    let headers = new Headers();
    let body = "";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async (_input, init) => {
        headers = new Headers(init?.headers);
        body = String(init?.body);
        return json(decision);
      },
    });
    await expect(client.decideOccReview(operationId,
      { submissionId, outcome: "Returned", reason: "  Corregir el servicio  " }, etag))
      .resolves.toEqual(decision);
    expect(headers.get("if-match")).toBe(etag);
    expect(headers.get("authorization")).toBe("Bearer occ-token");
    expect(JSON.parse(body)).toEqual({ submissionId, outcome: "Returned", reason: "Corregir el servicio" });
    await expect(client.decideOccReview(operationId,
      { submissionId, outcome: "Returned", reason: "Falta" }, etag)).rejects.toThrow(TypeError);
  });
});
