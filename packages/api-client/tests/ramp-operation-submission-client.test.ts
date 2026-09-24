import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  type RampOperationSubmissionResponse,
  type SubmitRampOperationRequest,
} from "../src";

const operationId = "70000000-0000-7000-8000-000000000005";
const checklistId = "70000000-0000-7000-8000-000000000011";
const installationId = "81000000-0000-7000-8000-000000000001";
const key = "82000000-0000-7000-8000-000000000041";
const receipt: RampOperationSubmissionResponse = {
  receiptId: "83000000-0000-7000-8000-000000000041",
  operationId,
  submissionId: key,
  checklistId,
  revisionNumber: 1,
  status: "PendingReview",
  submittedAt: "2026-09-23T12:00:00.000Z",
  actualEndAt: "2026-09-23T12:00:00.000Z",
  agentNote: "Entrega lista",
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ramp operation submission API client", () => {
  it("uses a device-scoped stable key and sends only the note", async () => {
    let url = "";
    let headers = new Headers();
    let body = "";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        body = String(init?.body ?? "");
        return jsonResponse(receipt);
      },
    });
    await expect(client.submitRampOperation(
      operationId,
      { agentNote: "  Entrega lista  " },
      installationId,
      key,
    )).resolves.toEqual(receipt);
    expect(url).toBe(`https://api.example.test/api/v1/ramp/operations/${operationId}/submit`);
    expect(headers.get("authorization")).toBe("Bearer ramp-token");
    expect(headers.get("x-elevant-installation-id")).toBe(installationId);
    expect(headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(body)).toEqual({ agentNote: "Entrega lista" });
  });

  it("rejects forged authority fields before network and wrong canonical IDs after", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => {
        calls += 1;
        return jsonResponse({ ...receipt, submissionId: crypto.randomUUID() });
      },
    });
    await expect(client.submitRampOperation(
      operationId,
      { agentNote: "Entrega lista", actorId: key } as SubmitRampOperationRequest,
      installationId,
      key,
    )).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
    await expect(client.submitRampOperation(
      operationId,
      { agentNote: "Entrega lista" },
      installationId,
      key,
    )).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });

  it("supports an optional note without allowing controls", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (_input, init) => {
        expect(init?.body).toBe("{}");
        return jsonResponse({ ...receipt, agentNote: null });
      },
    });
    await expect(client.submitRampOperation(
      operationId, {}, installationId, key,
    )).resolves.toMatchObject({ status: "PendingReview" });
    await expect(client.submitRampOperation(
      operationId, { agentNote: "Unsafe\0Note" }, installationId, key,
    )).rejects.toThrow(TypeError);
  });
});
