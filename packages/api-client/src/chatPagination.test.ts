import { expect, it, vi } from "vitest";
import { createElevantApiClient } from "./client";
const station = "20000000-0000-7000-8000-000000000003";
const operation = "70000000-0000-7000-8000-000000000005";
it("keeps legacy signal calls and encodes offsets only when supplied", async () => {
 const fetch = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(String(url).includes("/messages") ? { operationId: operation, messages: [], hasMore: false } : { conversations: [], hasMore: false }), { headers: { "content-type": "application/json" } }));
 const client = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "synthetic-test-token", fetch });
 const signal = new AbortController().signal;
 await client.getOperationalConversations(station, { signal });
 expect(new URL(fetch.mock.calls[0]?.[0] ?? '').searchParams.has("offset")).toBe(false);
 await client.getOperationalConversations(station, { signal, offset: 100 });
 expect(new URL(fetch.mock.calls[1]?.[0] ?? '').searchParams.get("offset")).toBe("100");
 await client.getOperationalMessages(operation, { signal, offset: 200 });
 expect(new URL(fetch.mock.calls[2]?.[0] ?? '').searchParams.get("offset")).toBe("200");
 expect(fetch.mock.calls[2]?.[1]).not.toHaveProperty("offset");
});
it.each([-1, 1.5, Infinity, 2147483648])("rejects invalid offset %s before transport", async offset => {
 const fetch = vi.fn();
 const client = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "synthetic-test-token", fetch });
 await expect(client.getOperationalConversations(station, { offset })).rejects.toThrow(RangeError);
 await expect(client.getOperationalMessages(operation, { offset })).rejects.toThrow(RangeError);
 expect(fetch).not.toHaveBeenCalled();
});
