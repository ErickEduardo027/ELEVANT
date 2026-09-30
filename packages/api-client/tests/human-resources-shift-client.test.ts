import { expect, it } from "vitest";
import { createElevantApiClient, type HumanResourcesShiftPage } from "../src";

const shift: HumanResourcesShiftPage["shifts"][number] = {
  id: "50000000-0000-7000-8000-000000000005",
  rampProfileId: "50000000-0000-7000-8000-000000000001",
  agentName: "Riley Ramp", employeeNumber: "DEV-RA-001",
  stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
  terminalId: "20000000-0000-7000-8000-000000000004", terminalCode: "A",
  positionId: "20000000-0000-7000-8000-000000000005", positionCode: "RAMP-AGENT",
  workDate: "2026-08-18", startsAtLocal: "06:00:00", endsAtLocal: "14:00:00", block: "Morning",
};

it("reads a bounded HR shift week with a fresh token", async () => {
  const urls: string[] = [];
  const page: HumanResourcesShiftPage = { from: "2026-08-17", to: "2026-08-23",
    page: 2, limit: 1, hasMore: false, shifts: [shift] };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "hr-token",
    fetch: async (url, init) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer hr-token");
      return new Response(JSON.stringify(page),
        { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.getHumanResourcesShifts({ from: "2026-08-17",
    to: "2026-08-23", page: 2, limit: 1 })).resolves.toEqual(page);
  expect(urls).toEqual([
    "https://api.example.test/api/v1/human-resources/shifts?from=2026-08-17&to=2026-08-23&page=2&limit=1",
  ]);
  await expect(client.getHumanResourcesShifts({ from: "2026-08-17", to: "2026-08-24" }))
    .rejects.toBeInstanceOf(TypeError);
});

it("rejects malformed shift rows, foreign weeks and mismatched pages", async () => {
  const query = { from: "2026-08-17", to: "2026-08-23" };
  const malformed = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...query, page: 1, limit: 50,
      hasMore: false, shifts: [{ ...shift, block: "Unknown" }] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(malformed.getHumanResourcesShifts(query))
    .rejects.toMatchObject({ kind: "malformed-response" });
  const foreignWeek = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...query, page: 1, limit: 50,
      hasMore: false, shifts: [{ ...shift, workDate: "2026-08-24" }] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(foreignWeek.getHumanResourcesShifts(query))
    .rejects.toMatchObject({ kind: "malformed-response" });
  const mismatched = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...query, page: 3, limit: 1,
      hasMore: false, shifts: [shift] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(mismatched.getHumanResourcesShifts({ ...query, page: 2, limit: 1 }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});

it("records a bounded HR shift with a stable UUID and rejects an overlong interval", async () => {
  const id = "50000000-0000-7000-8000-000000000050";
  const request = { rampProfileId: shift.rampProfileId, stationId: shift.stationId,
    terminalId: shift.terminalId, workDate: "2026-10-01",
    startsAtLocal: "06:00:00", endsAtLocal: "14:00:00", notes: "Development coverage" };
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async (url, init) => {
      expect(String(url)).toBe(`https://api.example.test/api/v1/human-resources/shifts/${id}`);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual(request);
      return new Response(JSON.stringify({ id }),
        { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.recordHumanResourcesShift(id, request)).resolves.toEqual({ id });
  await expect(client.recordHumanResourcesShift(id, { ...request,
    endsAtLocal: "04:00:00" })).rejects.toBeInstanceOf(TypeError);
});
