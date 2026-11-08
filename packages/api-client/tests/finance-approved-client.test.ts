import { describe, expect, it } from "vitest";
import { createElevantApiClient, type FinanceApprovedServicesResponse } from "../src";

const query = {
  stationId: "20000000-0000-7000-8000-000000000003",
  from: "2026-08-19",
  to: "2026-08-19",
};

const page: FinanceApprovedServicesResponse = {
  stationId: query.stationId,
  from: query.from,
  to: query.to,
  services: [{
    id: "70000000-0000-7000-8000-000000000017",
    operationId: "70000000-0000-7000-8000-000000000016",
    turnaroundId: "70000000-0000-7000-8000-000000000012",
    approvedSubmissionId: "70000000-0000-7000-8000-000000000019",
    operationCode: "DEV-TAT-0002",
    operationDate: query.from,
    airlineId: "50000000-0000-7000-8000-000000000006",
    airlineName: "Demo Airlines",
    flightNumber: "ZZ102",
    contractCode: "DEV-CONTRACT-0001",
    serviceCode: "BAG",
    serviceName: "Baggage",
    executionStatus: "Completed",
    contractedQuantity: 1,
    executedQuantity: 2,
    billingUnit: "operation",
    frozenUnitPrice: 40,
    frozenCurrency: "USD",
    ready: true,
    blockingReason: null,
    amount: 80,
    preinvoiceId: null,
  }],
  hasMore: false,
};

describe("finance approved-evidence client", () => {
  it("uses an authenticated, explicit station and bounded date window", async () => {
    const requests: string[] = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "finance-token",
      fetch: async (url, init) => {
        requests.push(`${url}|${new Headers(init?.headers).get("authorization")}`);
        return new Response(JSON.stringify(page), { headers: { "content-type": "application/json" } });
      },
    });

    await expect(client.getFinanceApprovedServices(query)).resolves.toEqual(page);
    expect(requests).toEqual([
      "https://api.example.test/api/v1/finance/approved-services" +
      `?stationId=${query.stationId}&from=${query.from}&to=${query.to}|Bearer finance-token`,
    ]);
    await expect(client.getFinanceApprovedServices({ ...query, to: "2026-10-02" }))
      .rejects.toBeInstanceOf(TypeError);
  });

  it("accepts a ready service in exception with its executed quantity (3-N11), never one not performed", async () => {
    let payload: unknown = { ...page, services: [{ ...page.services[0], executionStatus: "Exception" }] };
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify(payload),
        { headers: { "content-type": "application/json" } }),
    });
    await expect(client.getFinanceApprovedServices(query)).resolves.toEqual(payload);
    payload = { ...page, services: [{ ...page.services[0], executionStatus: "NotPerformed" }] };
    await expect(client.getFinanceApprovedServices(query))
      .rejects.toMatchObject({ kind: "malformed-response" });
    payload = { ...page, services: [{ ...page.services[0], executionStatus: "Exception", executedQuantity: 0 }] };
    await expect(client.getFinanceApprovedServices(query))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("rejects a changed scope, unexpected field or unpriced ready line", async () => {
    let payload: unknown = { ...page, stationId: crypto.randomUUID() };
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify(payload),
        { headers: { "content-type": "application/json" } }),
    });
    await expect(client.getFinanceApprovedServices(query))
      .rejects.toMatchObject({ kind: "malformed-response" });
    payload = { ...page, services: [{ ...page.services[0], tenantId: crypto.randomUUID() }] };
    await expect(client.getFinanceApprovedServices(query))
      .rejects.toMatchObject({ kind: "malformed-response" });
    payload = { ...page, services: [{ ...page.services[0], frozenUnitPrice: null }] };
    await expect(client.getFinanceApprovedServices(query))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });
});
