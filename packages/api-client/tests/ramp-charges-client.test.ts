import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  type RampOperationChargesResponse,
  type RampServiceChargeCommandResponse,
} from "../src";

const operationId = "70000000-0000-4000-8000-000000000016";
const serviceId = "73000000-0000-4000-8000-000000000001";
const chargeId = "74000000-0000-4000-8000-000000000001";
const installationId = "90000000-0000-4000-8000-000000000001";
const idempotencyKey = "90000000-0000-4000-8000-000000000002";
const receiptId = "90000000-0000-4000-8000-000000000003";

const service = {
  serviceId,
  canEdit: true,
  available: [{ id: chargeId, code: "NIGHT", name: "Recargo nocturno", description: null,
    category: "Surcharge", allowMultiple: false }],
  applied: [{ id: "75000000-0000-4000-8000-000000000001", chargeId, code: "NIGHT",
    name: "Recargo nocturno", appliedAt: "2026-10-08T03:10:00.000+00:00", source: "Agent" }],
};
const charges: RampOperationChargesResponse = { operationId, services: [service] };
const command: RampServiceChargeCommandResponse = { receiptId, service };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function clientReturning(body: unknown, capture?: (input: string, init?: RequestInit) => void) {
  return createElevantApiClient({
    baseUrl: "https://api.example.test",
    getAccessToken: () => "ramp-token",
    fetch: async (input, init) => {
      capture?.(String(input), init);
      return jsonResponse(body);
    },
  });
}

describe("ramp service charges", () => {
  it("reads the charge options and marks of an operation without prices", async () => {
    let url = "";
    let headers = new Headers();
    await expect(clientReturning(charges, (input, init) => { url = input; headers = new Headers(init?.headers); })
      .getRampOperationCharges(operationId, installationId)).resolves.toEqual(charges);
    expect(url).toBe(`https://api.example.test/api/v1/ramp/operations/${operationId}/charges`);
    expect(headers.get("x-elevant-installation-id")).toBe(installationId);
    await expect(clientReturning(charges).getRampOperationCharges(operationId, "not-a-device"))
      .rejects.toBeInstanceOf(TypeError);
    await expect(clientReturning({ ...charges, services: [{ ...service, available: [{ ...service.available[0], unitPrice: 10 }] }] })
      .getRampOperationCharges(operationId, installationId)).rejects.toBeInstanceOf(ElevantApiError);
    await expect(clientReturning({ ...charges, operationId: serviceId }).getRampOperationCharges(operationId, installationId))
      .rejects.toBeInstanceOf(ElevantApiError);
  });

  it("sends one charge command with device and idempotency headers", async () => {
    let body = "";
    let headers = new Headers();
    const client = clientReturning(command, (_input, init) => {
      body = String(init?.body ?? "");
      headers = new Headers(init?.headers);
    });
    await expect(client.applyRampServiceCharge(operationId, serviceId, { chargeId, action: "Apply" },
      installationId, idempotencyKey)).resolves.toEqual(command);
    expect(JSON.parse(body)).toEqual({ chargeId, action: "Apply" });
    expect(headers.get("idempotency-key")).toBe(idempotencyKey);
    expect(headers.get("x-elevant-installation-id")).toBe(installationId);
  });

  it("rejects unknown actions and extra authority before fetch", async () => {
    let calls = 0;
    const client = clientReturning(command, () => { calls += 1; });
    await expect(client.applyRampServiceCharge(operationId, serviceId,
      { chargeId, action: "Delete" }, installationId, idempotencyKey)).rejects.toBeInstanceOf(TypeError);
    await expect(client.applyRampServiceCharge(operationId, serviceId,
      { chargeId, action: "Apply", amount: 5 } as never, installationId, idempotencyKey)).rejects.toBeInstanceOf(TypeError);
    expect(calls).toBe(0);
  });
});
