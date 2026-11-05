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

it("pays an invoice by card with the idempotency key and accepts only brand and last four digits back", async () => {
  const key = "10000000-0000-7000-8000-00000000000b";
  const attempt = { id: "10000000-0000-7000-8000-00000000000c", invoiceId, status: "Approved", brand: "Visa", last4: "1111",
    amount: 118, currencyCode: "USD", authorizationCode: "ABC234", declineCode: null,
    receiptId: "10000000-0000-7000-8000-00000000000d", attemptedAt: "2026-11-05T12:00:00Z" };
  const calls: Array<{ url: string; key: string | null; body: unknown }> = [];
  let reply: unknown = { attempt, invoiceBalance: 0, replayed: false };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async (url, init) => {
      calls.push({ url: String(url), key: new Headers(init?.headers).get("idempotency-key"),
        body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(reply), { status: 201, headers: { "content-type": "application/json" } });
    } });
  const card = { cardholderName: " Casey Airline ", cardNumber: "4111 1111 1111 1111", expiryMonth: 12, expiryYear: 2030,
    securityCode: "123", amount: 118 };
  await expect(client.payAirlineInvoiceByCard(invoiceId, card, key)).resolves.toEqual({ attempt, invoiceBalance: 0, replayed: false });
  expect(calls[0]).toEqual({ url: `https://api.example.test/api/v1/airline/portal/invoices/${invoiceId}/card-payments`, key,
    body: { ...card, cardholderName: "Casey Airline" } });
  reply = { attempt: { ...attempt, last4: "4111111111111111" }, invoiceBalance: 0, replayed: false };
  await expect(client.payAirlineInvoiceByCard(invoiceId, card, key)).rejects.toThrow();
  reply = { attempt: { ...attempt, status: "Declined", authorizationCode: null, receiptId: null, declineCode: "insufficient_funds" },
    invoiceBalance: 118, replayed: false };
  await expect(client.payAirlineInvoiceByCard(invoiceId, card, key)).resolves.toMatchObject({ invoiceBalance: 118 });
  await expect(client.payAirlineInvoiceByCard(invoiceId, { ...card, securityCode: "12a" }, key)).rejects.toBeInstanceOf(TypeError);
  await expect(client.payAirlineInvoiceByCard(invoiceId, card, "not-a-key")).rejects.toBeInstanceOf(TypeError);
  expect(calls).toHaveLength(3);
});

it("lists card attempts for Finance and the portal and downloads the card receipt", async () => {
  const urls: string[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async url => {
      urls.push(String(url));
      return String(url).endsWith("/receipt")
        ? new Response(new Blob(["%PDF-1.7"]), { headers: { "content-type": "application/pdf" } })
        : new Response(JSON.stringify({ invoiceId, attempts: [] }), { headers: { "content-type": "application/json" } });
    } });
  await expect(client.getAirlineInvoiceCardPayments(invoiceId)).resolves.toEqual({ invoiceId, attempts: [] });
  await expect(client.getFinanceInvoiceCardPayments(invoiceId)).resolves.toEqual({ invoiceId, attempts: [] });
  await client.getAirlineCardPaymentReceipt("10000000-0000-7000-8000-00000000000c");
  expect(urls).toEqual([
    `https://api.example.test/api/v1/airline/portal/invoices/${invoiceId}/card-payments`,
    `https://api.example.test/api/v1/finance/invoices/${invoiceId}/card-payments`,
    "https://api.example.test/api/v1/airline/portal/card-payments/10000000-0000-7000-8000-00000000000c/receipt",
  ]);
});
