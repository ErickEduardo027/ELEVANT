import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const eventId = "a0000000-0000-7000-8000-000000000001";
const resourceId = "90000000-0000-7000-8000-000000000001";
const cursor = "eyJjaGFuZ2UiOjQyfQ";
const change = { eventId, cursor, resource: "notifications", resourceId,
  occurredAt: "2026-09-26T12:00:00.000Z" };

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { "content-type": "application/json" },
});

describe("account change feed client", () => {
  it("uses the versioned authenticated route and opaque continuation", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const answers = [
      { changes: [change], nextCursor: cursor, hasMore: true },
      { changes: [], nextCursor: cursor, hasMore: false },
    ];
    const api = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "short-lived-token", fetch: async (input, init) => {
        requests.push({ url: String(input),
          authorization: new Headers(init?.headers).get("authorization") });
        return json(answers[requests.length - 1]);
      } });

    await expect(api.getAccountChanges({ limit: 1 })).resolves.toEqual(answers[0]);
    await expect(api.getAccountChanges({ after: cursor, limit: 1 })).resolves.toEqual(answers[1]);
    expect(requests.map(item => item.url)).toEqual([
      "https://api.example.test/api/v1/changes?limit=1",
      `https://api.example.test/api/v1/changes?after=${cursor}&limit=1`,
    ]);
    expect(requests.every(item => item.authorization === "Bearer short-lived-token")).toBe(true);
  });

  it("rejects invalid parameters and untrusted response fields", async () => {
    let calls = 0;
    let answer: unknown = { changes: [{ ...change, content: "must not be here" }],
      nextCursor: cursor, hasMore: false };
    const api = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "token", fetch: async () => { calls++; return json(answer); } });
    await expect(api.getAccountChanges({ limit: 0 })).rejects.toThrow(TypeError);
    await expect(api.getAccountChanges({ after: "bad cursor" })).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
    await expect(api.getAccountChanges()).rejects.toMatchObject({ kind: "malformed-response" });
    answer = { changes: [change], nextCursor: "different", hasMore: false };
    await expect(api.getAccountChanges()).rejects.toMatchObject({ kind: "malformed-response" });
  });
});
