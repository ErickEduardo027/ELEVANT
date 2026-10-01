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
