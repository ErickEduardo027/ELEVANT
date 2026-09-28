import { expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const draftId = "10000000-0000-7000-8000-000000000001";

it("submits a draft once through the authenticated versioned API", async () => {
  const calls: Array<{ url: string; method: string; token: string | null;
    body: unknown }> = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "finance-token",
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET",
        token: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: draftId, status: "Submitted", replayed: false }),
        { headers: { "content-type": "application/json" } });
    } });

  await expect(client.submitPreinvoice(draftId, { requestId: draftId }))
    .resolves.toEqual({ id: draftId, status: "Submitted", replayed: false });
  expect(calls).toEqual([{ url: `https://api.example.test/api/v1/finance/preinvoices/${draftId}/submit`,
    method: "POST", token: "Bearer finance-token", body: { requestId: draftId } }]);
});

it("rejects an invalid key or mismatched submission receipt", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ id: crypto.randomUUID(),
      status: "Submitted", replayed: false }),
    { headers: { "content-type": "application/json" } }) });
  await expect(client.submitPreinvoice(draftId, { requestId: "invalid" }))
    .rejects.toBeInstanceOf(TypeError);
  await expect(client.submitPreinvoice(draftId, { requestId: draftId }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
