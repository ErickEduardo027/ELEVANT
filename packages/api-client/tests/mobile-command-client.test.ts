import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  type RampOperationStartResponse,
  type RegisterMobileDeviceRequest,
  type RegisterMobileDeviceResponse,
} from "../src";

const installationId = "90000000-0000-4000-8000-000000000001";
const operationId = "70000000-0000-4000-8000-000000000016";
const idempotencyKey = "90000000-0000-4000-8000-000000000002";

const registration: RegisterMobileDeviceRequest = {
  installationId,
  platform: "Android",
  appVersion: "1.0.0",
  deviceName: "Ramp tablet",
  operatingSystemVersion: "15",
};

const registered: RegisterMobileDeviceResponse = {
  installationId,
  platform: "Android",
  appVersion: "1.0.0",
  lastSeenAt: "2026-09-17T20:00:00Z",
};

const started: RampOperationStartResponse = {
  receiptId: "90000000-0000-4000-8000-000000000003",
  operation: {
    id: operationId,
    status: "InProgress",
    plannedStartAt: "2026-09-17T20:00:00Z",
    plannedEndAt: "2026-09-17T21:00:00Z",
    actualStartAt: "2026-09-17T20:01:02.123Z",
    actualEndAt: null,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mobile device and command API client", () => {
  it("registers the authenticated installation with only contracted metadata", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody = "";
    let requestedHeaders = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "";
        requestedBody = String(init?.body ?? "");
        requestedHeaders = new Headers(init?.headers);
        return jsonResponse(registered);
      },
    });

    await expect(client.registerMobileDevice(registration)).resolves.toEqual(
      registered,
    );
    expect(requestedUrl).toBe("https://api.example.test/api/v1/mobile/device");
    expect(requestedMethod).toBe("PUT");
    expect(JSON.parse(requestedBody)).toEqual(registration);
    expect(requestedHeaders.get("authorization")).toBe("Bearer ramp-token");
    expect(requestedHeaders.get("content-type")).toBe("application/json");
  });

  it("starts an operation with server-owned time and explicit protected headers", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody: BodyInit | null | undefined;
    let requestedHeaders = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      defaultHeaders: { "content-type": "application/json" },
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "";
        requestedBody = init?.body;
        requestedHeaders = new Headers(init?.headers);
        return jsonResponse(started);
      },
    });

    await expect(
      client.startRampOperation(operationId, installationId, idempotencyKey, {
        headers: {
          "X-Elevant-Installation-Id": "90000000-0000-4000-8000-999999999999",
          "Idempotency-Key": "90000000-0000-4000-8000-999999999998",
        },
      }),
    ).resolves.toEqual(started);

    expect(requestedUrl).toBe(
      `https://api.example.test/api/v1/ramp/operations/${operationId}/start`,
    );
    expect(requestedMethod).toBe("POST");
    expect(requestedBody).toBeUndefined();
    expect(requestedHeaders.has("content-type")).toBe(false);
    expect(requestedHeaders.get("authorization")).toBe("Bearer ramp-token");
    expect(requestedHeaders.get("x-elevant-installation-id")).toBe(
      installationId,
    );
    expect(requestedHeaders.get("idempotency-key")).toBe(idempotencyKey);
  });

  // 3-I: the queued start carries the tapped time; without it the request is the first version's.
  it("sends the tapped start only when there is one", async () => {
    const observed: { body: BodyInit | null | undefined; contentType: string | null }[] = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (_input, init) => {
        observed.push({ body: init?.body, contentType: new Headers(init?.headers).get("content-type") });
        return jsonResponse(started);
      },
    });

    await client.startRampOperation(operationId, installationId, idempotencyKey, undefined,
      { startedAt: "2026-09-17T16:01:02.123-04:00" });
    await client.startRampOperation(operationId, installationId, idempotencyKey, undefined, { startedAt: null });
    await client.startRampOperation(operationId, installationId, idempotencyKey, undefined, {});

    expect(observed).toEqual([
      { body: JSON.stringify({ startedAt: "2026-09-17T16:01:02.123-04:00" }), contentType: "application/json" },
      { body: undefined, contentType: null },
      { body: undefined, contentType: null },
    ]);
  });

  it("rejects a start body with another field or an invalid time before fetch", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => {
        calls += 1;
        return jsonResponse(started);
      },
    });

    await expect(client.startRampOperation(operationId, installationId, idempotencyKey, undefined,
      { startedAt: "ayer" })).rejects.toThrow(TypeError);
    await expect(client.startRampOperation(operationId, installationId, idempotencyKey, undefined,
      { startedAt: "2026-09-17T20:00:00Z", agentId: operationId } as never)).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("rejects invalid client authority data before fetch", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => {
        calls += 1;
        return jsonResponse(started);
      },
    });

    await expect(
      client.startRampOperation("not-a-uuid", installationId, idempotencyKey),
    ).rejects.toThrow(TypeError);
    await expect(
      client.registerMobileDevice({
        ...registration,
        platform: "android" as "Android",
      }),
    ).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("rejects uncontracted fields in command responses", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => jsonResponse({ ...started, replayed: false }),
    });

    await expect(
      client.startRampOperation(operationId, installationId, idempotencyKey),
    ).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });

  it.each([
    { ...started, operation: { ...started.operation, status: "Assigned" } },
    { ...started, operation: { ...started.operation, actualStartAt: null } },
    {
      ...started,
      operation: {
        ...started.operation,
        actualEndAt: "2026-09-17T20:02:00Z",
      },
    },
  ])("rejects a non-canonical successful start response", async (response) => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => jsonResponse(response),
    });

    await expect(
      client.startRampOperation(operationId, installationId, idempotencyKey),
    ).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });
});
