import { describe, expect, it } from "vitest";
import { createElevantApiClient, type CreatePreinvoiceDraftRequest,
  type PreinvoiceDraftResponse } from "../src";

const draftId = "10000000-0000-7000-8000-000000000001";
const stationId = "20000000-0000-7000-8000-000000000003";
const serviceId = "30000000-0000-7000-8000-000000000004";
const request: CreatePreinvoiceDraftRequest = {
  stationId, from: "2026-09-26", to: "2026-09-26",
  requestId: "40000000-0000-7000-8000-000000000005", serviceIds: [serviceId],
};
const detail: PreinvoiceDraftResponse = {
  id: draftId, airlineId: "50000000-0000-7000-8000-000000000006",
  airlineName: "Test Airline", stationId, from: request.from, to: request.to,
  currencyCode: "USD", total: 10, status: "Draft",
  lines: [{ id: "60000000-0000-7000-8000-000000000007",
    operationServiceId: serviceId,
    approvedSubmissionId: "70000000-0000-7000-8000-000000000008",
    lineNumber: 1, operationCode: "DEV-TAT-0002", operationDate: request.from,
    serviceCode: "GPU", serviceName: "GPU", executedQuantity: 1,
    billingUnit: "hour", unitPrice: 10, currencyCode: "USD", amount: 10 }],
};

describe("preinvoice draft client", () => {
  it("creates then reads a bounded, authenticated draft", async () => {
    const calls: Array<{ url: string; method: string; token: string | null }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "finance-token",
      fetch: async (url, init) => {
        calls.push({ url: String(url), method: init?.method ?? "GET",
          token: new Headers(init?.headers).get("authorization") });
        const payload = init?.method === "POST" ? { id: draftId, replayed: false } : detail;
        return new Response(JSON.stringify(payload), { status: init?.method === "POST" ? 201 : 200,
          headers: { "content-type": "application/json" } });
      } });

    await expect(client.createPreinvoiceDraft(request)).resolves.toEqual({ id: draftId, replayed: false });
    await expect(client.getPreinvoiceDraft(draftId, stationId)).resolves.toEqual(detail);
    expect(calls).toEqual([
      { url: "https://api.example.test/api/v1/finance/preinvoices",
        method: "POST", token: "Bearer finance-token" },
      { url: `https://api.example.test/api/v1/finance/preinvoices/${draftId}`,
        method: "GET", token: "Bearer finance-token" },
    ]);
  });

  it("rejects duplicate source lines and a forged draft scope", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ ...detail, stationId: crypto.randomUUID() }),
        { headers: { "content-type": "application/json" } }) });
    await expect(client.createPreinvoiceDraft({ ...request, serviceIds: [serviceId, serviceId] }))
      .rejects.toBeInstanceOf(TypeError);
    await expect(client.getPreinvoiceDraft(draftId, stationId))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });
});
