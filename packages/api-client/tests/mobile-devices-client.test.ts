import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError, isOccMobileDevice, isOccMobileDevices } from "../src";

// Phase 2, block E: shared tablets (2-N02) — the release at sign-out and OCC's tablet screen.
const stationId = "20000000-0000-7000-8000-000000000003";
const deviceId = "81000000-0000-7000-8000-0000000000a1";
const installationId = "81000000-0000-7000-8000-0000000000a2";
const key = "a0000000-0000-7000-8000-0000000000e1";
const agent = { accountId: "40000000-0000-7000-8000-000000000002", rampAgentId: "50000000-0000-7000-8000-000000000001",
  name: "Riley Ramp", employeeNumber: "DEV-RA-001" };
const bound = { id: deviceId, platform: "Android", deviceName: "Tablet T-07", appVersion: "1.2.3",
  operatingSystemVersion: "16", lastSeenAt: "2026-11-06T12:00:00.000Z", status: "Bound", agent,
  boundAt: "2026-11-06T11:00:00.000Z", unboundAt: null, revokedAt: null, agentHasOperationInProgress: true,
  version: "YjQxLjEuMA==" };
const free = { ...bound, status: "Unbound", unboundAt: "2026-11-06T13:00:00.000Z", agentHasOperationInProgress: false,
  version: "YjQxLjAuMA==" };
const revoked = { ...free, status: "Revoked", revokedAt: "2026-11-06T14:00:00.000Z", version: "YjQxLjAuMQ==" };

type Call = { url: string; method: string; headers: Headers; body: string };

function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers),
        body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
}

const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ status, title: "Raw title", code }), {
    status, headers: { "content-type": "application/problem+json" },
  });

describe("shared tablets", () => {
  it("releases the installation at sign-out with its key and explains a tablet another agent holds", async () => {
    const calls: Call[] = [];
    const api = client([new Response(null, { status: 204 }), problem(409, "device_not_bound"),
      problem(409, "device_in_use_by_active_agent")], calls);
    await expect(api.releaseMobileDevice({ installationId: installationId.toUpperCase() }, key)).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe("https://api.example.test/api/v1/mobile/device/release");
    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body)).toEqual({ installationId });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    await expect(api.releaseMobileDevice({ installationId }, key)).rejects.toMatchObject({ status: 409,
      code: "device_not_bound" });
    // The registration of the deployed APK keeps its body; a refusal now names its cause.
    const refused = await api.registerMobileDevice({ installationId, platform: "Android", appVersion: "1.2.3" })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ElevantApiError);
    expect(refused).toMatchObject({ status: 409, code: "device_in_use_by_active_agent" });
    await expect(api.releaseMobileDevice({ installationId: "not-a-uuid" }, key)).rejects.toThrow(TypeError);
    await expect(api.releaseMobileDevice({ installationId }, "not-a-key")).rejects.toThrow(TypeError);
  });

  it("names the newest registration of the session as the expected version of a release", async () => {
    const calls: Call[] = [];
    const lastSeenAt = "2026-11-07T10:30:00.125+00:00";
    const api = client([new Response(null, { status: 204 }), problem(409, "version_conflict"),
      new Response(null, { status: 204 })], calls);
    await expect(api.releaseMobileDevice({ installationId, expectedVersion: lastSeenAt }, key)).resolves.toBeUndefined();
    expect(JSON.parse(calls[0]!.body)).toEqual({ installationId, expectedVersion: lastSeenAt });
    // The agent signed in on the tablet again meanwhile: the late release frees nothing and says why.
    await expect(api.releaseMobileDevice({ installationId, expectedVersion: lastSeenAt }, key)).rejects.toMatchObject({
      status: 409, code: "version_conflict" });
    // Without a version the body is the installation alone.
    await api.releaseMobileDevice({ installationId, expectedVersion: null }, key);
    expect(JSON.parse(calls[2]!.body)).toEqual({ installationId });
    for (const expectedVersion of ["", "ayer", "2026-11-07T10:30:00.125+00:00".padEnd(65, "0")])
      await expect(api.releaseMobileDevice({ installationId, expectedVersion }, key)).rejects.toThrow(TypeError);
    await expect(api.releaseMobileDevice({ installationId, lastSeenAt } as never, key)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(3);
  });

  it("validates OCC's tablet list strictly, each tablet once and the state it claims", async () => {
    const others = [{ ...free, id: "81000000-0000-7000-8000-0000000000a3" }, { ...revoked, id: "81000000-0000-7000-8000-0000000000a4" }];
    const list = { stationId, stationCode: "PUJ", canUnbind: true, canRevoke: false, devices: [bound, ...others] };
    expect(isOccMobileDevices(list, stationId)).toBe(true);
    expect(isOccMobileDevices({ ...list, devices: [bound, bound] }, stationId)).toBe(false);
    expect(isOccMobileDevices({ ...list, extra: true }, stationId)).toBe(false);
    expect(isOccMobileDevices(list, "20000000-0000-7000-8000-000000000099")).toBe(false);
    expect(isOccMobileDevice({ ...bound, agent: null })).toBe(false);
    expect(isOccMobileDevice({ ...free, agentHasOperationInProgress: true })).toBe(false);
    expect(isOccMobileDevice({ ...revoked, revokedAt: null })).toBe(false);
    expect(isOccMobileDevice({ ...free, revokedAt: "2026-11-06T14:00:00.000Z" })).toBe(false);
    expect(isOccMobileDevice({ ...bound, status: "Lost" })).toBe(false);
    expect(isOccMobileDevice({ ...bound, agent: { ...agent, extra: 1 } })).toBe(false);
    const calls: Call[] = [];
    const api = client([Response.json(list), Response.json({ ...list, stationId: deviceId })], calls);
    await expect(api.getOccMobileDevices(stationId)).resolves.toEqual(list);
    expect(calls[0]!.url).toBe(`https://api.example.test/api/v1/occ/devices?stationId=${stationId}`);
    await expect(api.getOccMobileDevices(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("frees and revokes a tablet with the binding token, a key and a trimmed reason", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(free), Response.json(revoked), Response.json(free),
      problem(409, "device_revoked")], calls);
    await expect(api.unbindOccMobileDevice(deviceId, { expectedVersion: bound.version, reason: "  " }, key))
      .resolves.toEqual(free);
    expect(calls[0]!.url).toBe(`https://api.example.test/api/v1/occ/devices/${deviceId}/unbinding`);
    expect(JSON.parse(calls[0]!.body)).toEqual({ expectedVersion: bound.version, reason: null });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    await expect(api.revokeOccMobileDevice(deviceId, { expectedVersion: free.version, reason: " Tablet extraviada " }, key))
      .resolves.toMatchObject({ status: "Revoked" });
    expect(JSON.parse(calls[1]!.body)).toEqual({ expectedVersion: free.version, reason: "Tablet extraviada" });
    // A revocation always answers a revoked tablet.
    await expect(api.revokeOccMobileDevice(deviceId, { expectedVersion: free.version, reason: "Tablet extraviada" }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.unbindOccMobileDevice(deviceId, { expectedVersion: free.version }, key))
      .rejects.toMatchObject({ status: 409, code: "device_revoked" });
    await expect(api.revokeOccMobileDevice(deviceId, { expectedVersion: free.version, reason: "no" }, key))
      .rejects.toThrow(TypeError);
    await expect(api.unbindOccMobileDevice(deviceId, { expectedVersion: "" }, key)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(4);
  });
});
