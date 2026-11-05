import { describe, expect, it } from "vitest";
import { createElevantApiClient, normalizedSignature, OPERATION_DOCUMENT_SIGNERS } from "../src";

const operationId = "70000000-0000-7000-8000-000000000012";
const installationId = "81000000-0000-7000-8000-000000000071";
const key = "82000000-0000-7000-8000-000000000071";
const serviceId = "30000000-0000-7000-8000-000000000001";
const charter = {
  operationId, charterId: "90000000-0000-7000-8000-000000000001", currencyCode: "USD", carrierAddress: null,
  chargesPayableBy: null, prepaymentStatus: "Pending", prepaymentAmount: null,
  catalog: [{ serviceDefinitionId: serviceId, code: "BAGGAGE", name: "Baggage handling", billingUnit: "operation",
    unitPrice: 130, minimumQuantity: 1 },
    // The Development seed derives deterministic ids without an RFC version; they are still valid ids.
    { serviceDefinitionId: "8986b689-14bd-a57e-9e2b-5f9756c5a1dc", code: "PASSENGER-BRIDGE",
      name: "Passenger boarding bridge operation", billingUnit: "operation", unitPrice: 100, minimumQuantity: 1 }],
};

describe("Charter client (ADR-0033)", () => {
  it("adds services and carrier data with the device headers", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input).replace("https://api.example.test", ""), method: String(init?.method),
        headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return Response.json(charter);
    } });
    await expect(client.getRampCharter(operationId)).resolves.toMatchObject({ catalog: [{ code: "BAGGAGE" }, { code: "PASSENGER-BRIDGE" }] });
    await client.addRampCharterService(operationId, { serviceDefinitionId: serviceId, quantity: 2 }, installationId, key);
    await client.updateRampCharterDetails(operationId, { carrierAddress: "  1200 NW  72nd Ave ", chargesPayableBy: "" },
      installationId, key);
    expect(requests.map(item => [item.method, item.url])).toEqual([
      ["GET", `/api/v1/ramp/operations/${operationId}/charter`],
      ["POST", `/api/v1/ramp/operations/${operationId}/charter/services`],
      ["PUT", `/api/v1/ramp/operations/${operationId}/charter/details`],
    ]);
    expect(JSON.parse(requests[2]!.body)).toEqual({ carrierAddress: "1200 NW 72nd Ave", chargesPayableBy: null });
    expect(requests[1]!.headers.get("idempotency-key")).toBe(key);
  });

  it("asks the signer's ID only as a write and refuses implausible charter commands", async () => {
    expect(OPERATION_DOCUMENT_SIGNERS.CharterServiceRequest).toEqual(["AirlineRepresentative", "AviamAgent"]);
    expect(normalizedSignature({ signerName: "Ana Pérez", documentSha256: "a".repeat(64), strokes: [[0.1, 0.1, 0.2, 0.2]],
      signerIdentification: " pa 1234567 " })?.signerIdentification).toBe("PA1234567");
    expect(normalizedSignature({ signerName: "Ana Pérez", documentSha256: "a".repeat(64), strokes: [[0.1, 0.1, 0.2, 0.2]],
      signerIdentification: "x#" })).toBeNull();
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => { throw new Error("must not call"); } });
    await expect(client.addRampCharterService(operationId, { serviceDefinitionId: serviceId, quantity: 0 }, installationId, key))
      .rejects.toThrow(TypeError);
    await expect(client.confirmFinanceCharterPrepayment(charter.charterId, { amount: 260, reference: "<x>" }))
      .rejects.toThrow(TypeError);
  });

  it("reads planning options that carry the charter flag", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async () => Response.json({
      turnaround: { id: operationId, operationCode: "MAN-1", operationDate: "2026-08-18",
        station: { id: "20000000-0000-7000-8000-000000000003", code: "PUJ", name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" },
        stand: null, referenceTime: "2026-08-18T12:00:00Z" },
      contract: null, services: [], agents: [], isCharter: true,
    }, { headers: { etag: `"${"a".repeat(64)}"` } }) });
    await expect(client.getOccPlanningOptions(operationId)).resolves.toMatchObject({ isCharter: true, contract: null });
  });
});
