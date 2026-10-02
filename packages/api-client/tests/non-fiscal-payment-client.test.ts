import { expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const invoiceId = "10000000-0000-7000-8000-000000000003";
const paymentId = "10000000-0000-7000-8000-000000000004";
const requestId = "10000000-0000-7000-8000-000000000005";

it("records an idempotent manual payment and reads the same server state", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const client = createElevantApiClient({
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === "POST") return new Response(JSON.stringify({
        id: paymentId, invoiceId, reference: "BANK-TEST-123", currencyCode: "USD",
        amount: 10, replayed: false,
      }), { status: 201 });
      return new Response(JSON.stringify({ invoiceId, payment: {
        id: paymentId, invoiceId, reference: "BANK-TEST-123", currencyCode: "USD",
        amount: 10, recordedAt: "2026-09-28T17:00:00Z",
      } }), { status: 200 });
    },
  });
  await expect(client.recordNonFiscalPayment({ invoiceId, requestId,
    reference: "BANK-TEST-123" })).resolves.toMatchObject({ id: paymentId });
  await expect(client.getFinancePaymentByInvoice(invoiceId)).resolves.toMatchObject({
    invoiceId, payment: { id: paymentId },
  });
  await expect(client.getAirlinePaymentByInvoice(invoiceId)).resolves.toMatchObject({
    invoiceId, payment: { id: paymentId },
  });
  expect(calls).toEqual([
    { url: "https://api.example.test/api/v1/finance/payments", method: "POST",
      body: { invoiceId, requestId, reference: "BANK-TEST-123" } },
    { url: `https://api.example.test/api/v1/finance/payments/by-invoice/${invoiceId}`,
      method: "GET", body: undefined },
    { url: `https://api.example.test/api/v1/airline/portal/invoices/${invoiceId}/payment`,
      method: "GET", body: undefined },
  ]);
});

it("rejects invalid input and cross-invoice responses", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ invoiceId: requestId,
      payment: null }), { status: 200 }) });
  await expect(client.recordNonFiscalPayment({ invoiceId, requestId,
    reference: "bad" })).rejects.toBeInstanceOf(TypeError);
  await expect(client.getAirlinePaymentByInvoice(invoiceId)).rejects.toMatchObject({
    kind: "malformed-response", status: 200,
  });
});
