import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  type SystemPingResponse,
} from "../src";

const ping: SystemPingResponse = {
  application: "Elevant.Api",
  environment: "Testing",
  status: "ok",
  timestampUtc: "2026-09-05T13:11:41Z",
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
      fetch: async (input) => {
        requestedUrl = String(input);
        return jsonResponse(ping);
      },
    });

    await expect(client.getSystemPing()).resolves.toEqual(ping);
    expect(requestedUrl).toBe("https://api.example.test/api/v1/system/ping");
  });

  it("requests a fresh access token for every request without retaining it", async () => {
    const authorization: Array<string | null> = [];
    let tokenNumber = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: async () => `short-lived-${++tokenNumber}`,
      fetch: async (_input, init) => {
        authorization.push(new Headers(init?.headers).get("authorization"));
        return jsonResponse(ping);
      },
    });

    await client.getSystemPing();
    await client.getSystemPing();

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

    const error = await client.getSystemPing().catch((reason: unknown) => reason);

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
      fetch: async () => jsonResponse(ping),
    });
    const error = await client.getSystemPing().catch((reason) => reason);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).not.toContain(token);
  });
});
