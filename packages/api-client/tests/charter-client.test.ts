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
    await expect(client.confirmFinanceCharterPrepayment(charter.charterId,
      { amount: 260, reference: "<x>", version: "AAAA" }, key)).rejects.toThrow(TypeError);
  });

  it("confirms and corrects a prepayment with its key, the version and a reason (4-N22)", async () => {
    const financeCharter = {
      id: "90000000-0000-7000-8000-000000000001", operationId, operationCode: "PUJ-20261108-001",
      operationDate: "2026-11-08", stationCode: "PUJ", airlineName: "Charter Air", currencyCode: "USD", servicesTotal: 260,
      requestSigned: true, prepaymentStatus: "Confirmed", prepaymentAmount: 1500, prepaymentReference: "TRF-0001",
      prepaymentConfirmedAt: "2026-11-08T12:00:00Z", version: "AAAAAAAAB9E=",
    };
    const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
    let answer: unknown = financeCharter;
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input).replace("https://api.example.test", ""), method: String(init?.method),
        headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return Response.json(answer);
    } });
    await expect(client.confirmFinanceCharterPrepayment(financeCharter.id,
      { amount: 15000, reference: " TRF-0001 ", version: " AAAAAAAAB9A= " }, key)).resolves.toEqual(financeCharter);
    expect([requests[0]!.method, requests[0]!.url])
      .toEqual(["PUT", `/api/v1/finance/charters/${financeCharter.id}/prepayment`]);
    expect(JSON.parse(requests[0]!.body)).toEqual({ amount: 15000, reference: "TRF-0001", version: "AAAAAAAAB9A=" });
    expect(requests[0]!.headers.get("idempotency-key")).toBe(key);
    // A correction carries its reason; a blank one is no reason at all.
    await client.confirmFinanceCharterPrepayment(financeCharter.id,
      { amount: 1500, reference: "TRF-0001", version: "AAAAAAAAB9E=", reason: "  Se capturó   15 000 " }, key);
    expect(JSON.parse(requests[1]!.body)).toEqual({ amount: 1500, reference: "TRF-0001", version: "AAAAAAAAB9E=",
      reason: "Se capturó 15 000" });
    await client.confirmFinanceCharterPrepayment(financeCharter.id,
      { amount: 1500, reference: "TRF-0001", version: "AAAAAAAAB9E=", reason: "   " }, key);
    expect(JSON.parse(requests[2]!.body)).toEqual({ amount: 1500, reference: "TRF-0001", version: "AAAAAAAAB9E=" });
    // Without a version, with a short or long reason, or without a valid key, nothing is sent.
    const sent = requests.length;
    for (const command of [{ amount: 1500, reference: "TRF-0001", version: "" },
      { amount: 1500, reference: "TRF-0001", version: "AAAA", reason: "Mal" },
      { amount: 1500, reference: "TRF-0001", version: "AAAA", reason: "x".repeat(501) }])
      await expect(client.confirmFinanceCharterPrepayment(financeCharter.id, command, key)).rejects.toBeInstanceOf(TypeError);
    await expect(client.confirmFinanceCharterPrepayment(financeCharter.id,
      { amount: 1500, reference: "TRF-0001", version: "AAAA" }, "not-a-key")).rejects.toBeInstanceOf(TypeError);
    expect(requests).toHaveLength(sent);
    // The answer is the same charter, with the strict shape.
    answer = { ...financeCharter, id: "90000000-0000-7000-8000-000000000099" };
    await expect(client.confirmFinanceCharterPrepayment(financeCharter.id,
      { amount: 1500, reference: "TRF-0001", version: "AAAA" }, key)).rejects.toMatchObject({ kind: "malformed-response" });
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

  it("reopens a confirmed prepayment with its key, reason and version (3-N24)", async () => {
    const financeCharter = {
      id: "90000000-0000-7000-8000-000000000001", operationId, operationCode: "PUJ-20261108-001",
      operationDate: "2026-11-08", stationCode: "PUJ", airlineName: "Charter Air", currencyCode: "USD", servicesTotal: 260,
      requestSigned: true, prepaymentStatus: "Pending", prepaymentAmount: 260, prepaymentReference: "TRF-0001",
      prepaymentConfirmedAt: null, version: "AAAAAAAAB9E=",
    };
    const requests: Array<{ url: string; headers: Headers; body: string }> = [];
    let answer: unknown = financeCharter;
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input).replace("https://api.example.test", ""), headers: new Headers(init?.headers),
        body: String(init?.body ?? "") });
      return Response.json(answer);
    } });
    await expect(client.reopenFinanceCharterPrepayment(financeCharter.id,
      { reason: "  El transportista   pidió más servicios ", version: "AAAAAAAAB9A=" }, key))
      .resolves.toEqual(financeCharter);
    expect(requests[0]!.url).toBe(`/api/v1/finance/charters/${financeCharter.id}/prepayment/reopening`);
    expect(JSON.parse(requests[0]!.body)).toEqual({ reason: "El transportista pidió más servicios", version: "AAAAAAAAB9A=" });
    expect(requests[0]!.headers.get("idempotency-key")).toBe(key);
    await expect(client.reopenFinanceCharterPrepayment(financeCharter.id, { reason: "corta", version: "AAAA" }, key))
      .rejects.toBeInstanceOf(TypeError);
    // An older server does not send the version; another charter in the answer is refused.
    const { version: _version, ...older } = financeCharter;
    answer = { charters: [older] };
    await expect(client.getFinanceCharters()).resolves.toEqual({ charters: [older] });
    answer = { ...financeCharter, id: "90000000-0000-7000-8000-000000000099" };
    await expect(client.reopenFinanceCharterPrepayment(financeCharter.id,
      { reason: "El transportista pidió más servicios", version: "AAAAAAAAB9A=" }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
    answer = { charters: [{ ...financeCharter, version: 7 }] };
    await expect(client.getFinanceCharters()).rejects.toMatchObject({ kind: "malformed-response" });
  });
});
