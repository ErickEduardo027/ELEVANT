import { expect, it } from "vitest";
import { createElevantApiClient, type HumanResourcesAvailabilityRequestPage } from "../src";

const query = { from: "2026-09-28", to: "2026-10-04", page: 2, limit: 1 };
const request: HumanResourcesAvailabilityRequestPage["requests"][number] = {
  id: "50000000-0000-7000-8000-000000000071",
  rampProfileId: "50000000-0000-7000-8000-000000000001",
  agentName: "Riley Ramp", employeeNumber: "DEV-RA-001",
  startsOn: "2026-10-01", endsOn: "2026-10-02", type: "DayOff",
  status: "Approved", reason: "Synthetic leave",
  requestedAt: "2026-09-30T12:00:00Z", resolvedAt: "2026-09-30T13:00:00Z",
  resolutionNote: null,
};

it("reads an HR availability window with a fresh token and explicit paging", async () => {
  const page: HumanResourcesAvailabilityRequestPage = {
    ...query, hasMore: false, requests: [request],
  };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "hr-token",
    fetch: async (url, init) => {
      expect(String(url)).toBe("https://api.example.test/api/v1/human-resources/" +
        "availability-requests?from=2026-09-28&to=2026-10-04&page=2&limit=1");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer hr-token");
      return new Response(JSON.stringify(page),
        { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.getHumanResourcesAvailabilityRequests(query)).resolves.toEqual(page);
  await expect(client.getHumanResourcesAvailabilityRequests({ ...query,
    to: "2026-10-29" })).rejects.toBeInstanceOf(TypeError);
});

it("rejects malformed, duplicate and out-of-window availability rows", async () => {
  const malformedPages = [
    { ...query, hasMore: false, requests: [{ ...request, status: "Unknown" }] },
    { ...query, hasMore: false, requests: [{ ...request, startsOn: "2026-10-05",
      endsOn: "2026-10-06" }] },
    { ...query, hasMore: false, requests: [request, request] },
    { ...query, page: 3, hasMore: false, requests: [request] },
  ];
  for (const page of malformedPages) {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify(page),
        { headers: { "content-type": "application/json" } }),
    });
    await expect(client.getHumanResourcesAvailabilityRequests(query))
      .rejects.toMatchObject({ kind: "malformed-response" });
  }
});

it("records and resolves HR availability with explicit UUID, fresh auth and guarded responses", async () => {
  const id = "50000000-0000-7000-8000-000000000071";
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "hr-token",
    fetch: async (url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer hr-token");
      calls.push({ url: String(url), method: init?.method ?? "",
        body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id, status: calls.length === 1
        ? "Pending" : "Approved" }),
      { headers: { "content-type": "application/json" } });
    },
  });
  const intent = { rampProfileId: request.rampProfileId,
    startsOn: "2026-10-01", endsOn: "2026-10-02", type: "DayOff",
    reason: "Synthetic leave" };
  await expect(client.recordHumanResourcesAvailabilityRequest(id, intent))
    .resolves.toEqual({ id, status: "Pending" });
  await expect(client.resolveHumanResourcesAvailabilityRequest(id,
    { decision: "Approve", note: "Coverage arranged" }))
    .resolves.toEqual({ id, status: "Approved" });
  expect(calls).toEqual([
    { url: `https://api.example.test/api/v1/human-resources/availability-requests/${id}`,
      method: "PUT", body: intent },
    { url: `https://api.example.test/api/v1/human-resources/availability-requests/${id}/resolution`,
      method: "POST", body: { decision: "Approve", note: "Coverage arranged" } },
  ]);
  await expect(client.recordHumanResourcesAvailabilityRequest(id,
    { ...intent, endsOn: "2026-11-03" })).rejects.toBeInstanceOf(TypeError);
  await expect(client.resolveHumanResourcesAvailabilityRequest(id,
    { decision: "Cancel" })).rejects.toBeInstanceOf(TypeError);
  expect(calls).toHaveLength(2);
});

it("rejects a mismatched availability write acknowledgement", async () => {
  const id = "50000000-0000-7000-8000-000000000071";
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ id: request.rampProfileId,
      status: "Pending" }), { headers: { "content-type": "application/json" } }),
  });
  await expect(client.recordHumanResourcesAvailabilityRequest(id,
    { rampProfileId: request.rampProfileId, startsOn: "2026-10-01",
      endsOn: "2026-10-02", type: "Restriction", reason: "Synthetic" }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
