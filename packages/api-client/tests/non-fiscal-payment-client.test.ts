import { expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const invoiceId = "10000000-0000-7000-8000-000000000003";
const paymentId = "10000000-0000-7000-8000-000000000004";
const otherInvoiceId = "10000000-0000-7000-8000-000000000005";

it("reads the legacy payment of an invoice through Finance and the tenant portal", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const client = createElevantApiClient({
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ invoiceId, payment: {
        id: paymentId, invoiceId, reference: "BANK-TEST-123", currencyCode: "USD",
        amount: 10, recordedAt: "2026-09-28T17:00:00Z",
      } }), { status: 200 });
    },
  });
  await expect(client.getFinancePaymentByInvoice(invoiceId)).resolves.toMatchObject({
    invoiceId, payment: { id: paymentId },
  });
  await expect(client.getAirlinePaymentByInvoice(invoiceId)).resolves.toMatchObject({
    invoiceId, payment: { id: paymentId },
  });
  expect(calls).toEqual([
    { url: `https://api.example.test/api/v1/finance/payments/by-invoice/${invoiceId}`, method: "GET" },
    { url: `https://api.example.test/api/v1/airline/portal/invoices/${invoiceId}/payment`, method: "GET" },
  ]);
});

it("no longer writes legacy payments (4-N12): payments are treasury receipts", () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(null, { status: 410 }) });
  expect("recordNonFiscalPayment" in client).toBe(false);
  expect("issueFinanceInvoice" in client).toBe(false);
});

it("rejects invalid identifiers and cross-invoice responses", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ invoiceId: otherInvoiceId,
      payment: null }), { status: 200 }) });
  await expect(client.getFinancePaymentByInvoice("bad")).rejects.toBeInstanceOf(TypeError);
  await expect(client.getAirlinePaymentByInvoice(invoiceId)).rejects.toMatchObject({
    kind: "malformed-response", status: 200,
  });
});
