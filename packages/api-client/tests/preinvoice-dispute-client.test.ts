import { expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const preinvoiceId = "10000000-0000-7000-8000-000000000001";
const lineId = "10000000-0000-7000-8000-000000000002";
const requestId = "10000000-0000-7000-8000-000000000003";

it("submits selected published lines with the airline bearer and a stable key", async () => {
  const calls: Array<{ url: string; method: string; token: string | null; body: unknown }> = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "airline-token",
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET",
        token: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: preinvoiceId, disputeId: requestId,
        status: "Disputed", replayed: false }),
      { headers: { "content-type": "application/json" } });
    } });
  const body = { requestId, subject: "Cantidad incorrecta",
    description: "La cantidad de GPU no coincide.", lineIds: [lineId] };
  await expect(client.disputeAirlinePreinvoice(preinvoiceId, body))
    .resolves.toEqual({ id: preinvoiceId, disputeId: requestId,
      status: "Disputed", replayed: false });
  expect(calls).toEqual([{ url: `https://api.example.test/api/v1/airline/portal/preinvoices/${preinvoiceId}/dispute`,
    method: "POST", token: "Bearer airline-token", body }]);
});

it("rejects duplicate lines and a receipt for another preinvoice", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ id: crypto.randomUUID(),
      disputeId: requestId, status: "Disputed", replayed: false }),
    { headers: { "content-type": "application/json" } }) });
  await expect(client.disputeAirlinePreinvoice(preinvoiceId,
    { requestId, subject: "Cantidad", description: "Diferencia.", lineIds: [lineId, lineId] }))
    .rejects.toBeInstanceOf(TypeError);
  await expect(client.disputeAirlinePreinvoice(preinvoiceId,
    { requestId, subject: "Cantidad", description: "Diferencia.", lineIds: [lineId] }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});

it("reads authorized airline and Finance disputes through additive routes", async () => {
  const calls: string[] = [];
  const response = { preinvoiceId, disputes: [{ id: requestId,
    subject: "Cantidad", description: "Diferencia.",
    createdAt: "2026-09-28T15:00:00Z", lineIds: [lineId] }] };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "bearer",
    fetch: async (url, init) => {
      calls.push(`${init?.method} ${url}`);
      return new Response(JSON.stringify(response),
        { headers: { "content-type": "application/json" } });
    } });
  await expect(client.getAirlinePreinvoiceDisputes(preinvoiceId)).resolves.toEqual(response);
  await expect(client.getFinancePreinvoiceDisputes(preinvoiceId)).resolves.toEqual(response);
  expect(calls).toEqual([
    `GET https://api.example.test/api/v1/airline/portal/preinvoices/${preinvoiceId}/disputes`,
    `GET https://api.example.test/api/v1/finance/preinvoices/${preinvoiceId}/disputes`,
  ]);
});

it("rejects a dispute list for another preinvoice", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ preinvoiceId: crypto.randomUUID(),
      disputes: [] }), { headers: { "content-type": "application/json" } }) });
  await expect(client.getAirlinePreinvoiceDisputes(preinvoiceId))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
