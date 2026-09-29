import { expect, it } from "vitest";
import { createElevantApiClient, type HumanResourcesPermitPage } from "../src";

const permit: HumanResourcesPermitPage["permits"][number] = {
  id: "50000000-0000-7000-8000-000000000003",
  rampProfileId: "50000000-0000-7000-8000-000000000001",
  agentName: "Riley Ramp",
  employeeNumber: "DEV-RA-001",
  documentType: "AirportId",
  cycleNumber: 1,
  documentNumber: "DEV-AIRPORT-ID",
  issuedOn: "2026-01-01",
  expiresOn: "2099-12-31",
};

it("reads a bounded authorized permit page using a fresh token", async () => {
  const urls: string[] = [];
  const page: HumanResourcesPermitPage = { page: 2, limit: 1,
    hasMore: false, permits: [permit] };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "hr-token",
    fetch: async (url, init) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer hr-token");
      return new Response(JSON.stringify(page),
        { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.getHumanResourcesPermits({ page: 2, limit: 1 }))
    .resolves.toEqual(page);
  expect(urls).toEqual([
    "https://api.example.test/api/v1/human-resources/permits?page=2&limit=1",
  ]);
  await expect(client.getHumanResourcesPermits({ limit: 101 }))
    .rejects.toBeInstanceOf(TypeError);
});

it("rejects invalid document types, dates and mismatched pages", async () => {
  const malformed = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ page: 1, limit: 50,
      hasMore: false, permits: [{ ...permit, documentType: "Unknown" }] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(malformed.getHumanResourcesPermits())
    .rejects.toMatchObject({ kind: "malformed-response" });
  const invalidDate = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ page: 1, limit: 50,
      hasMore: false, permits: [{ ...permit, expiresOn: "2025-01-01" }] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(invalidDate.getHumanResourcesPermits())
    .rejects.toMatchObject({ kind: "malformed-response" });
  const mismatched = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ page: 3, limit: 1,
      hasMore: false, permits: [permit] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(mismatched.getHumanResourcesPermits({ page: 2, limit: 1 }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});

it("looks up the current document cycle for exactly one agent and type", async () => {
  const scope = { page: 1, limit: 1, rampProfileId: permit.rampProfileId,
    documentType: "AirportId" as const };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async url => {
      expect(String(url)).toBe(`https://api.example.test/api/v1/human-resources/permits?page=1&limit=1&rampProfileId=${scope.rampProfileId}&documentType=AirportId`);
      return new Response(JSON.stringify({ page: 1, limit: 1, hasMore: false,
        permits: [permit] }), { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.getHumanResourcesPermits(scope))
    .resolves.toMatchObject({ permits: [permit] });
  await expect(client.getHumanResourcesPermits({ rampProfileId: permit.rampProfileId }))
    .rejects.toBeInstanceOf(TypeError);
  const foreign = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ page: 1, limit: 1,
      hasMore: false, permits: [{ ...permit, rampProfileId:
        "50000000-0000-7000-8000-000000000099" }] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(foreign.getHumanResourcesPermits(scope))
    .rejects.toMatchObject({ kind: "malformed-response" });
});

it("records a permit cycle with a stable UUID and expected-current precondition", async () => {
  const nextId = "50000000-0000-7000-8000-000000000040";
  const request = { rampProfileId: permit.rampProfileId, documentType: "AirportId",
    expectedCurrentId: permit.id, documentNumber: "DEV-AIRPORT-ID-RENEWED",
    issuedOn: "2026-02-01", expiresOn: "2099-12-31" };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async (url, init) => {
      expect(String(url)).toBe(`https://api.example.test/api/v1/human-resources/permits/${nextId}`);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual(request);
      return new Response(JSON.stringify({ id: nextId, cycleNumber: 2 }),
        { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.recordHumanResourcesPermit(nextId, request))
    .resolves.toEqual({ id: nextId, cycleNumber: 2 });
  await expect(client.recordHumanResourcesPermit(nextId, { ...request,
    expectedCurrentId: "not-a-uuid" })).rejects.toBeInstanceOf(TypeError);
});
