import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  type GetRampIncidentsResponse,
  type RampIncidentReceiptResponse,
  type ReportRampIncidentRequest,
} from "../src";

const operationId = "70000000-0000-7000-8000-000000000005";
const installationId = "81000000-0000-7000-8000-000000000001";
const key = "82000000-0000-7000-8000-000000000031";
const request: ReportRampIncidentRequest = {
  incidentType: "Safety",
  severity: "High",
  description: "Equipo inmovilizado",
  occurredAt: "2026-09-23T12:00:00.000Z",
};
const receipt: RampIncidentReceiptResponse = {
  receiptId: "83000000-0000-7000-8000-000000000031",
  operationId,
  incidentId: key,
  status: "Open",
  occurredAt: request.occurredAt,
  reportedAt: "2026-09-23T12:01:00.000Z",
};
const read: GetRampIncidentsResponse = {
  operationId,
  incidents: [{
    id: key,
    incidentType: "Safety",
    severity: "High",
    status: "Open",
    description: request.description,
    occurredAt: request.occurredAt,
    reportedAt: receipt.reportedAt,
  }],
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ramp incidents API client", () => {
  it("reads the assigned operation without caller-supplied station or agent", async () => {
    let url = "";
    let method = "";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (input, init) => {
        url = String(input);
        method = init?.method ?? "";
        return jsonResponse(read);
      },
    });
    await expect(client.getRampIncidents(operationId)).resolves.toEqual(read);
    expect(url).toBe(`https://api.example.test/api/v1/ramp/operations/${operationId}/incidents`);
    expect(method).toBe("GET");
  });

  it("reports one incident with protected device and idempotency headers", async () => {
    let headers = new Headers();
    let body = "";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (_input, init) => {
        headers = new Headers(init?.headers);
        body = String(init?.body ?? "");
        return jsonResponse(receipt);
      },
    });
    await expect(client.reportRampIncident(
      operationId, request, installationId, key,
      { headers: { "Idempotency-Key": "90000000-0000-7000-8000-000000000001" } },
    )).resolves.toEqual(receipt);
    expect(headers.get("authorization")).toBe("Bearer ramp-token");
    expect(headers.get("x-elevant-installation-id")).toBe(installationId);
    expect(headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(body)).toEqual(request);
  });

  it("rejects forged authority fields and malformed canonical responses", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => {
        calls += 1;
        return jsonResponse({ ...receipt, incidentId: crypto.randomUUID() });
      },
    });
    await expect(client.reportRampIncident(
      operationId, { ...request, actorId: key } as ReportRampIncidentRequest,
      installationId, key,
    )).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
    await expect(client.reportRampIncident(
      operationId, request, installationId, key,
    )).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });
});
