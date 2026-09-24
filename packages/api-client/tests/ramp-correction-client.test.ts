import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  type RampOperationCorrectionResponse,
} from "../src";

const operationId = "70000000-0000-4000-8000-000000000001";
const previousSubmissionId = "80000000-0000-4000-8000-000000000001";
const installationId = "40000000-0000-4000-8000-000000000001";
const idempotencyKey = "50000000-0000-4000-8000-000000000001";
const correction: RampOperationCorrectionResponse = {
  receiptId: "60000000-0000-4000-8000-000000000001",
  operationId,
  previousSubmissionId,
  checklistId: idempotencyKey,
  revisionNumber: 2,
  status: "InProgress",
  returnReason: "Corrige la cantidad del servicio.",
};

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ramp correction API client", () => {
  it("sends the reserved key and installation without a request body", async () => {
    let url = "";
    let request: RequestInit | undefined;
    let capturedHeaders = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (input, init) => {
        url = String(input);
        request = init;
        capturedHeaders = new Headers(init?.headers);
        return json(correction);
      },
    });

    await expect(client.reopenRampOperationCorrection(
      operationId, installationId, idempotencyKey,
      { headers: { "Idempotency-Key": previousSubmissionId } },
    )).resolves.toEqual(correction);
    expect(url).toBe(`https://api.example.test/api/v1/ramp/operations/${operationId}/correction`);
    expect(request?.method).toBe("POST");
    expect(request?.body).toBeUndefined();
    const headers = capturedHeaders;
    expect(headers.get("authorization")).toBe("Bearer ramp-token");
    expect(headers.get("x-elevant-installation-id")).toBe(installationId);
    expect(headers.get("idempotency-key")).toBe(idempotencyKey);
  });

  it.each([
    { ...correction, operationId: previousSubmissionId },
    { ...correction, checklistId: previousSubmissionId },
    { ...correction, revisionNumber: 1 },
    { ...correction, returnReason: "" },
    { ...correction, injected: "uncontracted" },
  ])("rejects an incompatible correction response", async (response) => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => json(response),
    });
    await expect(client.reopenRampOperationCorrection(
      operationId, installationId, idempotencyKey,
    )).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });
});
