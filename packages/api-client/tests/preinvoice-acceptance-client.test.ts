import { expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const preinvoiceId = "10000000-0000-7000-8000-000000000001";

it("accepts a published preinvoice through the authenticated airline portal", async () => {
  const calls: Array<{ url: string; method: string; token: string | null;
    body: unknown }> = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "airline-token",
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET",
        token: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: preinvoiceId,
        status: "Accepted", replayed: false }),
      { headers: { "content-type": "application/json" } });
    } });

  await expect(client.acceptAirlinePreinvoice(preinvoiceId,
    { requestId: preinvoiceId }))
    .resolves.toEqual({ id: preinvoiceId, status: "Accepted", replayed: false });
  expect(calls).toEqual([{ url: `https://api.example.test/api/v1/airline/portal/preinvoices/${preinvoiceId}/accept`,
    method: "POST", token: "Bearer airline-token", body: { requestId: preinvoiceId } }]);
});

it("rejects an invalid key and an unrelated acceptance receipt", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ id: crypto.randomUUID(),
      status: "Accepted", replayed: false }),
    { headers: { "content-type": "application/json" } }) });
  await expect(client.acceptAirlinePreinvoice(preinvoiceId, { requestId: "invalid" }))
    .rejects.toBeInstanceOf(TypeError);
  await expect(client.acceptAirlinePreinvoice(preinvoiceId,
    { requestId: preinvoiceId }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
