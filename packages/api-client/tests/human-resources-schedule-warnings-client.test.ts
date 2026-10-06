import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const shiftId = "50000000-0000-7000-8000-000000000011";
const query = { stationId, from: "2026-10-01", to: "2026-10-30", page: 1, limit: 20 };
const warning = { anchorShiftId: shiftId, rampProfileId: shiftId,
  agentName: "Synthetic agent", employeeNumber: "DEV-SCHEDULE-001",
  workDate: "2026-10-06", kind: "ShortRest", evidence: [{ shiftId,
    stationId, stationCode: "PUJ", startsAt: "2026-10-06T12:00:00Z",
    endsAt: "2026-10-06T20:00:00Z" }], hasRestrictedEvidence: true,
  measuredMinutes: null, thresholdMinutes: 720,
  ruleVersion: "dev-2026-10-05", ruleEffectiveOn: "2026-10-05", reason: null };
const page = { ...query, hasMore: false, asOf: "2026-10-05T12:00:00Z",
  ruleVersion: "dev-2026-10-05", ruleEffectiveOn: "2026-10-05",
  warnings: [warning] };

describe("G.H. schedule warning API client", () => {
  it("maps the exact scoped query and bearer token", async () => {
    let requests = 0;
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "fresh-token",
      fetch: async (input, init) => {
        requests++;
        const url = new URL(String(input));
        expect(url.pathname).toBe("/api/v1/human-resources/schedule-warnings");
        expect(Object.fromEntries(url.searchParams)).toEqual({
          stationId, from: query.from, to: query.to, page: "1", limit: "20",
        });
        expect(new Headers(init?.headers).get("authorization"))
          .toBe("Bearer fresh-token");
        return new Response(JSON.stringify(page), { status: 200,
          headers: { "content-type": "application/json" } });
      } });
    await expect(client.getHumanResourcesScheduleWarnings(query))
      .resolves.toEqual(page);
    expect(requests).toBe(1);
    await expect(client.getHumanResourcesScheduleWarnings({ ...query, limit: 101 }))
      .rejects.toThrow(TypeError);
    expect(requests).toBe(1);
  });

  it("propagates AbortSignal and rejects a wrong-station response", async () => {
    const controller = new AbortController();
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async (_input, init) => {
        expect(init?.signal).toBe(controller.signal);
        return new Response(JSON.stringify({ ...page,
          stationId: "20000000-0000-7000-8000-000000000091" }),
        { status: 200, headers: { "content-type": "application/json" } });
      } });
    await expect(client.getHumanResourcesScheduleWarnings(query,
      { signal: controller.signal })).rejects.toMatchObject({
      kind: "malformed-response", status: 200,
    });
  });

  it("preserves a Problem Details status without leaking a page", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({
        status: 403, title: "Human resources warning access is forbidden.",
      }), { status: 403, headers: {
        "content-type": "application/problem+json",
      } }) });
    await expect(client.getHumanResourcesScheduleWarnings(query)).rejects.toMatchObject({
      kind: "http", status: 403,
    });
  });

  it("lets an aborted request reject without delivering stale rows", async () => {
    const controller = new AbortController();
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(
          new DOMException("Aborted", "AbortError")), { once: true });
      }) });
    const pending = client.getHumanResourcesScheduleWarnings(query,
      { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
