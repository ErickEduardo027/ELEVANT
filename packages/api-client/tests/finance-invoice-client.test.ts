import { expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const preinvoiceId = "10000000-0000-7000-8000-000000000001";
const requestId = "10000000-0000-7000-8000-000000000002";
const invoiceId = "10000000-0000-7000-8000-000000000003";

it("issues a non-fiscal invoice with the Finance bearer and stable key", async () => {
  const calls: Array<{ url: string; method: string; body: unknown; token: string | null }> = [];
  const response = { id: invoiceId, preinvoiceId,
    number: `NF-${invoiceId.replaceAll("-", "")}`, kind: "NonFiscal", replayed: false };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "finance-token",
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET",
        body: JSON.parse(String(init?.body)),
        token: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(response),
        { status: 201, headers: { "content-type": "application/json" } });
    } });
  await expect(client.issueFinanceInvoice({ preinvoiceId, requestId }))
    .resolves.toEqual(response);
  expect(calls).toEqual([{ url: "https://api.example.test/api/v1/finance/invoices",
    method: "POST", body: { preinvoiceId, requestId }, token: "Bearer finance-token" }]);
});

it("rejects an invalid invoice request before sending", async () => {
  let called = false;
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => { called = true; return new Response(); } });
  await expect(client.issueFinanceInvoice({ preinvoiceId: "not-a-guid", requestId }))
    .rejects.toBeInstanceOf(TypeError);
  expect(called).toBe(false);
});

it("reads the same frozen invoice through Finance and tenant portal routes", async () => {
  const response = { id: invoiceId, preinvoiceId,
    airlineId: "10000000-0000-7000-8000-000000000004",
    stationId: "10000000-0000-7000-8000-000000000005",
    number: `NF-${invoiceId.replaceAll("-", "")}`, kind: "NonFiscal",
    currencyCode: "USD", total: 10, issuedAt: "2026-09-28T16:00:00Z",
    lines: [{ id: "10000000-0000-7000-8000-000000000006", lineNumber: 1,
      operationCode: "DEV-TAT-2", operationDate: "2026-09-28",
      serviceCode: "GPU", serviceName: "Ground power", executedQuantity: 1,
      billingUnit: "hour", unitPrice: 10, amount: 10 }] };
  const urls: string[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async url => {
      urls.push(String(url));
      return new Response(JSON.stringify(response),
        { headers: { "content-type": "application/json" } });
    } });
  await expect(client.getFinanceInvoiceByPreinvoice(preinvoiceId)).resolves.toEqual(response);
  await expect(client.getAirlineInvoiceByPreinvoice(preinvoiceId)).resolves.toEqual(response);
  expect(urls).toEqual([
    `https://api.example.test/api/v1/finance/invoices/by-preinvoice/${preinvoiceId}`,
    `https://api.example.test/api/v1/airline/portal/preinvoices/${preinvoiceId}/invoice`,
  ]);
});

it("accepts a valid large SQL decimal invoice despite JavaScript rounding", async () => {
  const response = { id: invoiceId, preinvoiceId,
    airlineId: "10000000-0000-7000-8000-000000000004",
    stationId: "10000000-0000-7000-8000-000000000005",
    number: `NF-${invoiceId.replaceAll("-", "")}`, kind: "NonFiscal",
    currencyCode: "USD", total: 100000000000000.02,
    issuedAt: "2026-09-28T16:00:00Z",
    lines: [{ id: "10000000-0000-7000-8000-000000000006", lineNumber: 1,
      operationCode: "DEV-TAT-2", operationDate: "2026-09-28",
      serviceCode: "GPU", serviceName: "Ground power", executedQuantity: 1,
      billingUnit: "hour", unitPrice: 100000000000000.01,
      amount: 100000000000000.01 },
    { id: "10000000-0000-7000-8000-000000000007", lineNumber: 2,
      operationCode: "DEV-TAT-2", operationDate: "2026-09-28",
      serviceCode: "WATER", serviceName: "Water", executedQuantity: 1,
      billingUnit: "service", unitPrice: 0.01, amount: 0.01 }] };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify(response),
      { headers: { "content-type": "application/json" } }) });
  await expect(client.getAirlineInvoiceByPreinvoice(preinvoiceId))
    .resolves.toEqual(response);
});

it("issues an e-CF invoice from approved operations and validates the e-NCF", async () => {
  const stationId = "10000000-0000-7000-8000-000000000008";
  const operationIds = ["10000000-0000-7000-8000-000000000009", "10000000-0000-7000-8000-00000000000a"];
  const response = { invoiceId, number: `NF-${invoiceId.replaceAll("-", "")}`,
    fiscalNumber: "E310000000001", total: 118, currencyCode: "USD", replayed: false };
  const calls: Array<{ url: string; body: unknown }> = [];
  let reply: unknown = response;
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(reply), { status: 201, headers: { "content-type": "application/json" } });
    } });
  await expect(client.issueInvoiceFromOperations({ stationId, operationIds, requestId })).resolves.toEqual(response);
  expect(calls).toEqual([{ url: "https://api.example.test/api/v1/finance/invoices/from-operations",
    body: { stationId, operationIds, requestId } }]);
  reply = { ...response, fiscalNumber: "B0100000001" };
  await expect(client.issueInvoiceFromOperations({ stationId, operationIds, requestId })).rejects.toThrow();
  await expect(client.issueInvoiceFromOperations({ stationId, operationIds: [], requestId }))
    .rejects.toBeInstanceOf(TypeError);
  await expect(client.issueInvoiceFromOperations({ stationId, operationIds: [operationIds[0]!, operationIds[0]!], requestId }))
    .rejects.toBeInstanceOf(TypeError);
  expect(calls).toHaveLength(2);
});

it("downloads the invoice PDF by invoice id for Finance and the airline portal", async () => {
  const urls: string[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async url => {
      urls.push(String(url));
      return new Response(new Blob(["%PDF-1.7"]), { headers: { "content-type": "application/pdf" } });
    } });
  await client.getFinanceInvoiceDocumentById(invoiceId);
  await client.getAirlineInvoiceDocumentById(invoiceId);
  expect(urls).toEqual([
    `https://api.example.test/api/v1/finance/invoices/${invoiceId}/document`,
    `https://api.example.test/api/v1/airline/portal/invoices/${invoiceId}/document`,
  ]);
});
