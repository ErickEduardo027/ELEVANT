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
  notes: null,
  recordedAt: "2026-01-03T12:00:00.000+00:00",
  validity: "Valid",
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

it("looks up one authorized agent/equipment pair without scanning a global page", async () => {
  const scope = { page: 1, limit: 1, rampProfileId: qualification.rampProfileId,
    equipmentTypeId: qualification.equipmentTypeId };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async url => {
      expect(String(url)).toBe(`https://api.example.test/api/v1/human-resources/qualifications?page=1&limit=1&rampProfileId=${scope.rampProfileId}&equipmentTypeId=${scope.equipmentTypeId}`);
      return new Response(JSON.stringify({ page: 1, limit: 1, hasMore: false,
        qualifications: [qualification] }), { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.getHumanResourcesQualifications(scope))
    .resolves.toMatchObject({ qualifications: [qualification] });
  await expect(client.getHumanResourcesQualifications({
    rampProfileId: qualification.rampProfileId, validity: "valid",
  })).rejects.toBeInstanceOf(TypeError);
  await expect(client.getHumanResourcesQualifications({ search: "x".repeat(101) }))
    .rejects.toBeInstanceOf(TypeError);
  const foreign = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ page: 1, limit: 1,
      hasMore: false, qualifications: [{ ...qualification, rampProfileId:
        "50000000-0000-7000-8000-000000000099" }] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(foreign.getHumanResourcesQualifications(scope))
    .rejects.toMatchObject({ kind: "malformed-response" });
});

it("reads the authorized equipment catalog and rejects malformed options", async () => {
  const catalog = [{ id: qualification.equipmentTypeId, code: "GPU", name: "Ground power unit" }];
  const urls: string[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "fresh-hr-token",
    fetch: async (url, init) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fresh-hr-token");
      return new Response(JSON.stringify(catalog), { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.getHumanResourcesQualificationEquipmentTypes()).resolves.toEqual(catalog);
  expect(urls).toEqual(["https://api.example.test/api/v1/human-resources/qualifications/equipment-types"]);

  const malformed = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify([{ ...catalog[0], id: "not-a-uuid" }]),
      { headers: { "content-type": "application/json" } }),
  });
  await expect(malformed.getHumanResourcesQualificationEquipmentTypes())
    .rejects.toMatchObject({ kind: "malformed-response" });
});

it("records a qualification with a stable UUID and expected current cycle", async () => {
  const id = "50000000-0000-7000-8000-000000000009";
  const request = {
    rampProfileId: qualification.rampProfileId,
    equipmentTypeId: qualification.equipmentTypeId,
    expectedCurrentId: qualification.id,
    trainingDate: "2026-01-02", obtainedOn: "2026-01-03", expiresOn: "2099-12-31",
    certifyingEntity: "Synthetic Training Center", instructorName: "Development Instructor",
    notes: "Annual renewal",
  };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "fresh-hr-token",
    fetch: async (url, init) => {
      expect(String(url)).toBe(`https://api.example.test/api/v1/human-resources/qualifications/${id}`);
      expect(init?.method).toBe("PUT");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fresh-hr-token");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual(request);
      return new Response(JSON.stringify({ id, cycleNumber: 2 }),
        { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.recordHumanResourcesQualification(id, request))
    .resolves.toEqual({ id, cycleNumber: 2 });
  await expect(client.recordHumanResourcesQualification("bad", request)).rejects.toBeInstanceOf(TypeError);
  await expect(client.recordHumanResourcesQualification(id,
    { ...request, expiresOn: "2020-01-01" })).rejects.toBeInstanceOf(TypeError);
});

it("does not turn a stale-cycle conflict or a mismatched receipt into success", async () => {
  const id = "50000000-0000-7000-8000-000000000009";
  const request = {
    rampProfileId: qualification.rampProfileId,
    equipmentTypeId: qualification.equipmentTypeId,
    expectedCurrentId: qualification.id,
    trainingDate: "2026-01-02", obtainedOn: "2026-01-03", expiresOn: "2099-12-31",
    certifyingEntity: "Synthetic Training Center", instructorName: "Development Instructor",
  };
  const stale = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ title: "Conflict" }),
      { status: 409, headers: { "content-type": "application/problem+json" } }),
  });
  await expect(stale.recordHumanResourcesQualification(id, request))
    .rejects.toMatchObject({ kind: "http", status: 409 });
  const mismatched = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ id: qualification.id, cycleNumber: 2 }),
      { headers: { "content-type": "application/json" } }),
  });
  await expect(mismatched.recordHumanResourcesQualification(id, request))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
