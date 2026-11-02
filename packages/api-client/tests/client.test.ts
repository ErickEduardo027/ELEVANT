import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  type SessionResponse,
  type SystemPingResponse,
} from "../src";

const ping: SystemPingResponse = {
  application: "Elevant.Api",
  environment: "Testing",
  status: "ok",
  timestampUtc: "2026-09-05T13:11:41Z",
};

const session: SessionResponse = {
  accessToken: "signed-short-lived-token",
  tokenType: "Bearer",
  expiresAt: "2026-09-16T12:15:00Z",
  actor: {
    accountId: "40000000-0000-7000-8000-000000000001",
    email: "admin.occ@dev.elevant.test",
    displayName: "Avery Operations",
    roles: [
      {
        roleId: "41000000-0000-7000-8000-000000000001",
        code: "ADMIN_OCC",
        name: "Admin OCC",
        portal: "back_office",
        userType: "admin_occ",
      },
    ],
    memberships: [
      {
        membershipId: "42000000-0000-7000-8000-000000000001",
        organizationId: "43000000-0000-7000-8000-000000000001",
        organizationCode: "AVIAM",
        organizationName: "AVIAM",
        organizationType: "aviam_operator",
        kind: "internal_staff",
      },
    ],
    stationScopes: [
      {
        stationId: "44000000-0000-7000-8000-000000000001",
        stationCode: "SDQ",
      },
    ],
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createElevantApiClient", () => {
  it.each([
    "",
    " api.example.test",
    "/relative",
    "ftp://api.example.test",
    "https://user:password@api.example.test",
    "https://api.example.test/v1",
    "https://api.example.test?tenant=one",
    "https://api.example.test#fragment",
  ])("rejects unsafe base URL %j", (baseUrl) => {
    expect(() =>
      createElevantApiClient({
        baseUrl,
        fetch: async () => jsonResponse(ping),
      }),
    ).toThrow(TypeError);
  });

  it("normalizes a trailing slash and returns a typed ping response", async () => {
    let requestedUrl = "";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test/",
      getAccessToken: () => {
        throw new Error("getSystemPing must not request an access token");
      },
      fetch: async (input) => {
        requestedUrl = String(input);
        return jsonResponse(ping);
      },
    });

    await expect(client.getSystemPing()).resolves.toEqual(ping);
    expect(requestedUrl).toBe("https://api.example.test/api/v1/system/ping");
  });

  it("creates a session without sending a stale bearer token", async () => {
    let requestedUrl = "";
    let requestMethod = "";
    let requestAuthorization: string | null = null;
    let requestBody = "";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => {
        throw new Error("createSession must not request an access token");
      },
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestMethod = init?.method ?? "";
        requestAuthorization = new Headers(init?.headers).get("authorization");
        requestBody = String(init?.body);
        return jsonResponse(session);
      },
    });

    await expect(
      client.createSession({
        email: "admin.occ@dev.elevant.test",
        password: "Synthetic-AccountPassword!2026",
      }),
    ).resolves.toEqual(session);
    expect(requestedUrl).toBe("https://api.example.test/api/v1/auth/session");
    expect(requestMethod).toBe("POST");
    expect(requestAuthorization).toBeNull();
    expect(JSON.parse(requestBody)).toEqual({
      email: "admin.occ@dev.elevant.test",
      password: "Synthetic-AccountPassword!2026",
    });
  });

  it("renews and ends a session with the refresh token, never with the bearer", async () => {
    const refreshToken = "aB3-dE5_fG7hI9jK1lM3nO5pQ7rS9tU1";
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => { throw new Error("Refreshing must not request a bearer token"); },
      fetch: async (input, init) => {
        requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body)) });
        return String(input).endsWith("/logout") ? new Response(null, { status: 204 })
          : jsonResponse({ ...session, refreshToken: "zZ9-yY8_xX7wW6vV5uU4tT3sS2rR1qQ0", refreshExpiresAt: "2026-12-01T00:00:00.000Z" });
      },
    });
    await expect(client.refreshSession(refreshToken)).resolves.toMatchObject({ refreshToken: "zZ9-yY8_xX7wW6vV5uU4tT3sS2rR1qQ0" });
    await client.endSession(refreshToken);
    expect(requests).toEqual([
      { url: "https://api.example.test/api/v1/auth/session/refresh", authorization: null, body: { refreshToken } },
      { url: "https://api.example.test/api/v1/auth/session/logout", authorization: null, body: { refreshToken } },
    ]);
    await expect(client.refreshSession("short")).rejects.toThrow(TypeError);
  });

  it("changes a password without sending a stale bearer or retaining secrets", async () => {
    let requestedUrl = "";
    let authorization: string | null = null;
    let payload: unknown;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => { throw new Error("Password change must not request a bearer token"); },
      fetch: async (input, init) => {
        requestedUrl = String(input);
        authorization = new Headers(init?.headers).get("authorization");
        payload = JSON.parse(String(init?.body));
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.changePassword({
      email: "contratos@dev.elevant.test",
      currentPassword: "Temporary-Development!2026",
      newPassword: "New-Development-Password!2026",
    })).resolves.toBeUndefined();
    expect(requestedUrl).toBe("https://api.example.test/api/v1/auth/password-change");
    expect(authorization).toBeNull();
    expect(payload).toEqual({
      email: "contratos@dev.elevant.test",
      currentPassword: "Temporary-Development!2026",
      newPassword: "New-Development-Password!2026",
    });
    expect(client).not.toHaveProperty("currentPassword");
    expect(client).not.toHaveProperty("newPassword");
  });

  it("resolves the current session with a fresh bearer token", async () => {
    let authorization: string | null = null;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => session.accessToken,
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        return jsonResponse({ actor: session.actor });
      },
    });

    await expect(client.getCurrentSession()).resolves.toEqual({ actor: session.actor });
    expect(authorization).toBe(`Bearer ${session.accessToken}`);
  });

  it("rejects malformed session payloads without retaining credentials", async () => {
    const password = "Synthetic-AccountPassword!2026";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => jsonResponse({ accessToken: "incomplete" }),
    });

    const error = await client
      .createSession({ email: "admin.occ@dev.elevant.test", password })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "malformed-response", status: 200 });
    if (!(error instanceof ElevantApiError)) throw new Error("Expected API error");
    expect(error.message).not.toContain(password);
    expect(client).not.toHaveProperty("password");
    expect(client).not.toHaveProperty("accessToken");
  });

  it("requests a fresh access token for every authenticated request without retaining it", async () => {
    const authorization: Array<string | null> = [];
    let tokenNumber = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: async () => `short-lived-${++tokenNumber}`,
      fetch: async (_input, init) => {
        authorization.push(new Headers(init?.headers).get("authorization"));
        return jsonResponse({ actor: session.actor });
      },
    });

    await client.getCurrentSession();
    await client.getCurrentSession();

    expect(authorization).toEqual([
      "Bearer short-lived-1",
      "Bearer short-lived-2",
    ]);
    expect(client).not.toHaveProperty("accessToken");
    expect(Object.isFrozen(client)).toBe(true);
  });

  it("merges Headers and omits Content-Type from a bodyless request", async () => {
    const defaults = new Headers({
      "content-type": "application/json",
      "x-default": "original",
      "x-shared": "default",
    });
    let observed = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      defaultHeaders: defaults,
      fetch: async (_input, init) => {
        observed = new Headers(init?.headers);
        return jsonResponse(ping);
      },
    });
    defaults.set("x-default", "mutated");

    await client.getSystemPing({
      headers: new Headers({ "X-Shared": "request", "x-request": "present" }),
    });

    expect(observed.get("x-default")).toBe("original");
    expect(observed.get("x-shared")).toBe("request");
    expect(observed.get("x-request")).toBe("present");
    expect(observed.has("content-type")).toBe(false);
  });

  it("preserves the caller signal and original AbortError", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    let observedSignal: AbortSignal | null | undefined;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async (_input, init) => {
        observedSignal = init?.signal;
        throw abortError;
      },
    });

    await expect(client.getSystemPing({ signal: controller.signal })).rejects.toBe(
      abortError,
    );
    expect(observedSignal).toBe(controller.signal);
  });

  it("preserves an AbortError raised while consuming the response body", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const response = new Response("ignored", { status: 200 });
    Object.defineProperty(response, "text", {
      value: async () => {
        throw abortError;
      },
    });
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => response,
    });

    await expect(client.getSystemPing()).rejects.toBe(abortError);
  });

  it.each([204, 205])("handles HTTP %i as a safe malformed typed response", async (status) => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(null, { status }),
    });

    await expect(client.getSystemPing()).rejects.toMatchObject({
      kind: "malformed-response",
      status,
    });
  });

  it("handles an empty successful body", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response("", { status: 200 }),
    });

    await expect(client.getSystemPing()).rejects.toMatchObject({
      kind: "malformed-response",
      status: 200,
    });
  });

  it("keeps Problem Details detail, body, and token out of errors", async () => {
    const token = "super-secret-access-token";
    const detail = `database failure containing ${token}`;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => token,
      fetch: async () =>
        new Response(
          JSON.stringify({
            title: "Invalid request",
            status: 422,
            detail,
            traceId: "trace-123",
          }),
          { status: 422, headers: { "content-type": "application/problem+json" } },
        ),
    });

    const error = await client.getCurrentSession().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ElevantApiError);
    expect(error).toMatchObject({
      kind: "http",
      status: 422,
      title: "Invalid request",
      traceId: "trace-123",
    });
    expect(error).not.toHaveProperty("detail");
    expect(error).not.toHaveProperty("body");
    if (!(error instanceof ElevantApiError)) throw new Error("Expected API error");
    expect(error.message).not.toContain(detail);
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain("Invalid request");
  });

  it("exposes only the known password-change problem code", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () =>
        new Response(
          JSON.stringify({
            title: "Password change required.",
            code: "password_change_required",
            detail: "private server detail",
          }),
          { status: 409, headers: { "content-type": "application/problem+json" } },
        ),
    });

    await expect(
      client.createSession({ email: "airline.client@dev.elevant.test", password: "Synthetic-Password!2026" }),
    ).rejects.toMatchObject({ status: 409, code: "password_change_required" });

    const unknownCode = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () =>
        new Response(JSON.stringify({ code: "private_server_code" }), { status: 409 }),
    });
    const error = await unknownCode.getCurrentSession().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ElevantApiError);
    expect(error).not.toHaveProperty("code", "private_server_code");
  });

  it("uses a safe fallback for a non-JSON error body", async () => {
    const rawBody = "raw response containing private-server-data";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(rawBody, { status: 503 }),
    });

    const error = await client.getSystemPing().catch((reason) => reason);
    expect(error).toMatchObject({ kind: "http", status: 503 });
    expect(error.message).not.toContain(rawBody);
  });

  it("throws safely for malformed JSON or a malformed typed payload", async () => {
    const rawBody = "not-json super-secret-response";
    const malformedJsonClient = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(rawBody, { status: 200 }),
    });
    const malformedJsonError = await malformedJsonClient
      .getSystemPing()
      .catch((reason) => reason);
    expect(malformedJsonError).toMatchObject({
      kind: "malformed-response",
      status: 200,
    });
    expect(malformedJsonError.message).not.toContain(rawBody);

    const malformedPingClient = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => jsonResponse({ status: "ok" }),
    });
    await expect(malformedPingClient.getSystemPing()).rejects.toMatchObject({
      kind: "malformed-response",
      status: 200,
    });
  });

  it("rejects durable Authorization defaults", () => {
    expect(() =>
      createElevantApiClient({
        baseUrl: "https://api.example.test",
        defaultHeaders: { authorization: "Bearer do-not-store" },
        fetch: async () => jsonResponse(ping),
      }),
    ).toThrow("use getAccessToken");
  });

  it("rejects unsafe tokens without echoing them", async () => {
    const token = "secret-token\r\ninjected: true";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => token,
      fetch: async () => jsonResponse({ actor: session.actor }),
    });
    const error = await client.getCurrentSession().catch((reason) => reason);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).not.toContain(token);
  });
});
