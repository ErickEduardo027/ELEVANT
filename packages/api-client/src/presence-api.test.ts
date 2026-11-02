import { describe, expect, it, vi } from "vitest";
import { createElevantApiClient } from "./client";
const operation = "70000000-0000-4000-8000-000000000001";
const account = "40000000-0000-4000-8000-000000000001";
const clientId = "10000000-0000-4000-8000-000000000001";
const data = { asOf: "2026-10-30T12:00:00Z", operations: [{ operationId: operation, participants: [
  { accountId: account, name: "Agente QA", role: "agent", state: "active", lastActivityAt: "2026-10-30T11:59:59Z",
    availability: "busy", message: "Atendiendo operaciones de Arajet" },
] }] };

describe("authorized presence contracts", () => {
  it("uses the same authenticated API for grouped reads and sequenced heartbeats", async () => {
    const calls: Request[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push(request);
      return request.method === "PUT" ? new Response(null, { status: 204 }) : Response.json(data);
    });
    const api = createElevantApiClient({ baseUrl: "https://api.elevant.test", fetch, getAccessToken: () => "test-access-token" });
    expect(await api.getOperationalPresence([operation])).toEqual(data);
    expect(new URL(calls[0]!.url).searchParams.getAll("operationIds")).toEqual([operation]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer test-access-token");
    const heartbeat = { clientId, sequence: 2, mode: "foreground" as const, activityObserved: true };
    await api.putOperationalPresence(heartbeat);
    expect(JSON.parse(await calls[1]!.text())).toEqual(heartbeat);
    expect(calls[1]!.method).toBe("PUT");
  });

  it("rejects unsupported states, invalid counters and unbounded batches", async () => {
    const fetch = vi.fn(async () => Response.json({ ...data, operations: [{ operationId: operation,
      participants: [{ ...data.operations[0]!.participants[0]!, state: "available" }] }] }));
    const api = createElevantApiClient({ baseUrl: "https://api.elevant.test", fetch, getAccessToken: () => "test-access-token" });
    await expect(api.getOperationalPresence([operation])).rejects.toThrow();
    await expect(api.putOperationalPresence({ clientId, sequence: Number.MAX_SAFE_INTEGER + 1, mode: "foreground", activityObserved: true })).rejects.toThrow();
    await expect(api.getOperationalPresence(Array.from({ length: 101 }, () => operation))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reads and replaces the caller's chosen status", async () => {
    const calls: Request[] = [];
    const own = { state: "active", availability: "doNotDisturb", message: "Atendiendo operaciones de Arajet" };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return Response.json(own);
    });
    const api = createElevantApiClient({ baseUrl: "https://api.elevant.test", fetch, getAccessToken: () => "test-access-token" });
    expect(await api.getOwnOperationalPresence()).toEqual(own);
    expect(await api.putOwnOperationalPresenceStatus({ availability: "doNotDisturb", message: "  Atendiendo operaciones de Arajet " })).toEqual(own);
    expect(new URL(calls[1]!.url).pathname).toBe("/api/v1/chat/presence/status");
    expect(JSON.parse(await calls[1]!.text())).toEqual({ availability: "doNotDisturb", message: "Atendiendo operaciones de Arajet" });
    await expect(api.putOwnOperationalPresenceStatus({ availability: "active" as never, message: null })).rejects.toThrow();
    await expect(api.putOwnOperationalPresenceStatus({ availability: null, message: "x".repeat(81) })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown chosen availability", async () => {
    const fetch = vi.fn(async () => Response.json({ state: "active", availability: "invisible", message: null }));
    const api = createElevantApiClient({ baseUrl: "https://api.elevant.test", fetch, getAccessToken: () => "test-access-token" });
    await expect(api.getOwnOperationalPresence()).rejects.toThrow();
  });
});
