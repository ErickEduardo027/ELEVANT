import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const profile = "20000000-0000-7000-8000-0000000000aa";
const shiftId = "21000000-0000-7000-8000-0000000000bb";
const readiness = { rampProfileId: profile, agentName: "Ana Ramp", employeeNumber: "E-1", ready: false, items: [
  { key: "mobile_account", status: "Missing", detail: "Sin cuenta.", expiresOn: null },
  { key: "airport_id", status: "Expiring", detail: "Vence pronto.", expiresOn: "2026-11-20" },
] };
const schedule = { rampProfileId: profile, agentName: "Ana Ramp", from: "2026-11-03", to: "2026-11-16",
  shifts: [{ id: shiftId, workDate: "2026-11-05", startsAtLocal: "06:00:00", endsAtLocal: "14:00:00", block: "Morning",
    stationCode: "PUJ", terminalCode: "T1" }],
  documents: [{ kind: "AirportId", label: "Carnet aeroportuario", number: "C-1", expiresOn: "2026-11-20", validity: "Expiring" }] };

describe("workforce readiness client (ADR-0026)", () => {
  it("lists readiness, reads the own schedule and removes a shift with the bearer", async () => {
    const calls: Array<{ method: string; url: string; auth: string | null }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ method: init?.method ?? "GET", url, auth: new Headers(init?.headers).get("authorization") });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return Response.json(url.includes("readiness") ? [readiness] : schedule);
      } });

    await expect(client.listRampAgentReadiness()).resolves.toEqual([readiness]);
    await expect(client.getOwnRampSchedule("2026-11-03", "2026-11-16")).resolves.toEqual(schedule);
    await expect(client.removeHumanResourcesShift(shiftId)).resolves.toBeUndefined();
    expect(calls.map(call => [call.method, call.url.replace("https://api.example.test/api/v1/", "")])).toEqual([
      ["GET", "human-resources/ramp-profiles/readiness"],
      ["GET", "ramp/me/schedule?from=2026-11-03&to=2026-11-16"],
      ["DELETE", `human-resources/shifts/${shiftId}`],
    ]);
    expect(calls.every(call => call.auth === "Bearer token")).toBe(true);
  });

  it("refuses malformed answers and bad ranges", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
      fetch: async () => Response.json([{ ...readiness, items: [{ key: "x", status: "Maybe", detail: null, expiresOn: null }] }]) });
    await expect(client.listRampAgentReadiness()).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client.getOwnRampSchedule("2026-11-16", "2026-11-03")).rejects.toThrow(TypeError);
  });
});
