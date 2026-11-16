import { expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError } from "../src";

const invoiceId = "10000000-0000-7000-8000-000000000002";
const pdf = new TextEncoder().encode("%PDF-1.7\nsynthetic test document\n%%EOF");

it("downloads private airline PDFs only with the current bearer", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "airline-token",
    fetch: async (url, init) => {
      calls.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
      return new Response(pdf, { headers: { "content-type": "application/pdf" } });
    } });
  const invoice = await client.getAirlineInvoiceDocumentById(invoiceId);
  const receipt = await client.getAirlinePaymentReceipt(invoiceId);
  expect(invoice.type).toBe("application/pdf");
  expect(new Uint8Array(await receipt.arrayBuffer())).toEqual(pdf);
  expect(calls).toEqual([
    { url: `https://api.example.test/api/v1/airline/portal/invoices/${invoiceId}/document`,
      authorization: "Bearer airline-token" },
    { url: `https://api.example.test/api/v1/airline/portal/invoices/${invoiceId}/receipt`,
      authorization: "Bearer airline-token" },
  ]);
});

it("rejects HTML, empty, and oversized bodies masquerading as a PDF", async () => {
  for (const [body, contentType] of [
    ["<html>Login</html>", "text/html"],
    ["", "application/pdf"],
    ["not a PDF", "application/pdf"],
  ] as const) {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(body, { headers: { "content-type": contentType } }) });
    await expect(client.getAirlineInvoiceDocumentById(invoiceId))
      .rejects.toMatchObject({ kind: "malformed-response" });
  }
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(pdf, { headers: {
      "content-type": "application/pdf", "content-length": "9000000" } }) });
  await expect(client.getAirlineInvoiceDocumentById(invoiceId))
    .rejects.toMatchObject({ kind: "malformed-response" });
});

it("preserves authorization failures and rejects malformed identifiers before fetch", async () => {
  let called = false;
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => { called = true; return new Response(null, { status: 404 }); } });
  expect(() => client.getAirlinePaymentReceipt("invalid")).toThrow(TypeError);
  expect(called).toBe(false);
  await expect(client.getAirlinePaymentReceipt(invoiceId)).rejects.toBeInstanceOf(ElevantApiError);
});
