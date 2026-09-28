import { expect, it } from "vitest";
import { createElevantApiClient, type HumanResourcesQualificationPage } from "../src";

const qualification: HumanResourcesQualificationPage["qualifications"][number] = {
  id: "50000000-0000-7000-8000-000000000002",
  rampProfileId: "50000000-0000-7000-8000-000000000001",
  agentName: "Riley Ramp",
  employeeNumber: "DEV-RA-001",
  equipmentTypeId: "20000000-0000-7000-8000-000000000007",
  equipmentCode: "GPU",
  equipmentName: "Ground power unit",
  cycleNumber: 1,
  trainingDate: "2026-01-02",
  obtainedOn: "2026-01-03",
  expiresOn: "2099-12-31",
  certifyingEntity: "Synthetic Training Center",
  instructorName: "Development Instructor",
};

it("reads a bounded authorized qualification page using a fresh token", async () => {
  const urls: string[] = [];
  const page: HumanResourcesQualificationPage = { page: 2, limit: 1,
    hasMore: false, qualifications: [qualification] };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "hr-token",
    fetch: async (url, init) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer hr-token");
      return new Response(JSON.stringify(page),
        { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.getHumanResourcesQualifications({ page: 2, limit: 1 }))
    .resolves.toEqual(page);
  expect(urls).toEqual([
    "https://api.example.test/api/v1/human-resources/qualifications?page=2&limit=1",
  ]);
  await expect(client.getHumanResourcesQualifications({ limit: 101 }))
    .rejects.toBeInstanceOf(TypeError);
});

it("rejects malformed qualification dates and mismatched pages", async () => {
  const malformed = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ page: 1, limit: 50,
      hasMore: false, qualifications: [{ ...qualification, expiresOn: "2025-01-01" }] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(malformed.getHumanResourcesQualifications())
    .rejects.toMatchObject({ kind: "malformed-response" });
  const mismatched = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ page: 3, limit: 1,
      hasMore: false, qualifications: [qualification] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(mismatched.getHumanResourcesQualifications({ page: 2, limit: 1 }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
