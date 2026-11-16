import { expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const requestId = "10000000-0000-7000-8000-000000000002";
const invoiceId = "10000000-0000-7000-8000-000000000003";

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

it("sends the versions on screen and keeps the code of a refusal (4-N29, 4-N07)", async () => {
  const stationId = "10000000-0000-7000-8000-000000000008";
  const operationIds = ["10000000-0000-7000-8000-000000000009", "10000000-0000-7000-8000-00000000000a"];
  const operationVersions = [{ operationId: operationIds[1]!, version: "AAAAAAAAB9E=" },
    { operationId: operationIds[0]!, version: "AAAAAAAAB9F=" }];
  const bodies: unknown[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ type: "about:blank", title: "The operations cannot be invoiced as they stand.",
        status: 422, code: "zero_total", reasons: ["zero_total"] }),
        { status: 422, headers: { "content-type": "application/problem+json" } });
    } });
  await expect(client.issueInvoiceFromOperations({ stationId, operationIds, requestId, operationVersions }))
    .rejects.toMatchObject({ status: 422, code: "zero_total" });
  expect(bodies).toEqual([{ stationId, operationIds, requestId, operationVersions }]);
  // Versions cover every operation exactly once, or nothing is sent.
  for (const versions of [[operationVersions[0]!], [operationVersions[0]!, operationVersions[0]!],
    [operationVersions[0]!, { operationId: "10000000-0000-7000-8000-00000000000b", version: "AAAAAAAAB9E=" }],
    [operationVersions[0]!, { operationId: operationIds[0]!, version: " " }]])
    await expect(client.issueInvoiceFromOperations({ stationId, operationIds, requestId, operationVersions: versions }))
      .rejects.toBeInstanceOf(TypeError);
  expect(bodies).toHaveLength(1);
});

it("keeps the reason a refused e-CF names: a charge the contract excludes or a service OCC excluded", async () => {
  const stationId = "10000000-0000-7000-8000-000000000008";
  const operationIds = ["10000000-0000-7000-8000-000000000009"];
  let reasons = ["charge_excluded_by_contract"];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ status: 422,
      title: "The operations cannot be invoiced together.", reasons }),
    { status: 422, headers: { "content-type": "application/problem+json" } }) });
  await expect(client.issueInvoiceFromOperations({ stationId, operationIds, requestId }))
    .rejects.toMatchObject({ status: 422, reasons: ["charge_excluded_by_contract"] });
  reasons = ["excluded_in_review"];
  await expect(client.issueInvoiceFromOperations({ stationId, operationIds, requestId }))
    .rejects.toMatchObject({ status: 422, reasons: ["excluded_in_review"] });
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

it("downloads the PDF of a credit or debit note for Finance and the airline portal (4-N17)", async () => {
  const noteId = "10000000-0000-7000-8000-0000000000e3";
  const urls: string[] = [];
  let reply = () => new Response(new Blob(["%PDF-1.7"]), { headers: { "content-type": "application/pdf" } });
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async url => { urls.push(String(url)); return reply(); } });
  await expect(client.getFinanceAdjustmentNoteDocument(noteId)).resolves.toBeInstanceOf(Blob);
  await expect(client.getAirlineAdjustmentNoteDocument(noteId)).resolves.toBeInstanceOf(Blob);
  expect(urls).toEqual([
    `https://api.example.test/api/v1/finance/adjustment-notes/${noteId}/document`,
    `https://api.example.test/api/v1/airline/portal/adjustment-notes/${noteId}/document`,
  ]);
  // A malformed id is never sent; what is not a PDF is refused.
  expect(() => client.getAirlineAdjustmentNoteDocument("not-a-note")).toThrow(TypeError);
  reply = () => Response.json({ title: "not a pdf" });
  await expect(client.getFinanceAdjustmentNoteDocument(noteId)).rejects.toMatchObject({ kind: "malformed-response" });
  expect(urls).toHaveLength(3);
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

it("reads whether card payments are available and accepts only the two flags (4-N05)", async () => {
  const urls: string[] = [];
  let reply: unknown = { available: true, simulated: true };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async url => {
      urls.push(String(url));
      return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
    } });
  await expect(client.getAirlineCardPaymentAvailability()).resolves.toEqual({ available: true, simulated: true });
  reply = { available: false, simulated: false };
  await expect(client.getAirlineCardPaymentAvailability()).resolves.toEqual({ available: false, simulated: false });
  expect(urls[0]).toBe("https://api.example.test/api/v1/airline/portal/card-payments/availability");
  // A simulation is always available; anything else the server sent is refused.
  for (const malformed of [{ available: false, simulated: true }, { available: "yes", simulated: false },
    { available: true, simulated: true, gateway: "simulated" }, { available: true }])
  {
    reply = malformed;
    await expect(client.getAirlineCardPaymentAvailability()).rejects.toMatchObject({ kind: "malformed-response" });
  }
});

it("keeps the code of a card payment refusal (4-N05)", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ title: "Card payments are not available.", status: 409,
      code: "card_payments_unavailable", reasons: ["card_payments_unavailable"] }),
    { status: 409, headers: { "content-type": "application/problem+json" } }) });
  await expect(client.payAirlineInvoiceByCard(invoiceId, { cardholderName: "Casey Airline",
    cardNumber: "4111 1111 1111 1111", expiryMonth: 12, expiryYear: 2030, securityCode: "123", amount: 118 },
  "10000000-0000-7000-8000-00000000000b")).rejects.toMatchObject({ status: 409, code: "card_payments_unavailable",
    reasons: ["card_payments_unavailable"] });
});
