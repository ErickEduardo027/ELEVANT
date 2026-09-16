import {
  getCreateSessionUrl,
  getGetCurrentSessionUrl,
  getGetSystemPingUrl,
  type CreateSessionRequest,
  type CurrentSessionResponse,
  type SessionActorResponse,
  type SessionResponse,
  type SystemPingResponse,
} from "../generated/elevant-api";
import { ElevantApiError } from "./errors";

type AccessToken = string | null | undefined;
type FetchImplementation = typeof globalThis.fetch;

export interface ElevantApiClientOptions {
  /** Absolute HTTP(S) origin, without a path, query string, or fragment. */
  readonly baseUrl: string;
  /** Invoked immediately before each authenticated request. The token is not retained. */
  readonly getAccessToken?: () => AccessToken | Promise<AccessToken>;
  /** Request-scoped fetch implementation for SSR, Expo, and tests. */
  readonly fetch?: FetchImplementation;
  /** Headers copied at creation. Authorization is deliberately rejected. */
  readonly defaultHeaders?: HeadersInit;
}

export type ElevantRequestInit = Omit<RequestInit, "headers"> & {
  readonly headers?: HeadersInit;
};

export type GetSystemPingOptions = Omit<ElevantRequestInit, "body" | "method">;
export type CreateSessionOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetCurrentSessionOptions = Omit<ElevantRequestInit, "body" | "method">;

export interface ElevantApiClient {
  createSession(
    request: CreateSessionRequest,
    options?: CreateSessionOptions,
  ): Promise<SessionResponse>;
  getCurrentSession(options?: GetCurrentSessionOptions): Promise<CurrentSessionResponse>;
  getSystemPing(options?: GetSystemPingOptions): Promise<SystemPingResponse>;
}

interface ApiResult {
  readonly status: number;
  readonly data: unknown | undefined;
}

interface ProblemMetadata {
  readonly title?: string;
  readonly traceId?: string;
}

function validatedBaseUrl(input: string) {
  if (typeof input !== "string" || input.length === 0 || input.trim() !== input) {
    throw new TypeError("baseUrl must be a non-empty absolute HTTP(S) origin.");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError("baseUrl must be a non-empty absolute HTTP(S) origin.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("baseUrl must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new TypeError("baseUrl must not contain credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("baseUrl must be an origin without a path, query, or fragment.");
  }

  return url.origin;
}

function validatedRequestUrl(baseUrl: string, path: string) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("API request paths must start with one forward slash.");
  }

  const url = new URL(path, `${baseUrl}/`);
  if (url.origin !== baseUrl || url.hash) {
    throw new TypeError("API request paths must stay on the configured API origin.");
  }
  return url;
}

function headersFrom(input: HeadersInit | undefined, label: string) {
  try {
    return new Headers(input);
  } catch {
    throw new TypeError(`${label} contains an invalid HTTP header.`);
  }
}

function mergeHeaders(defaultHeaders: Headers, requestHeaders?: HeadersInit) {
  const merged = new Headers(defaultHeaders);
  headersFrom(requestHeaders, "Request headers").forEach((value, name) =>
    merged.set(name, value),
  );
  return merged;
}

function isAbortError(error: unknown): error is Error {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function validResponse(value: unknown): value is Response {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "status" in value &&
    typeof value.status === "number" &&
    "headers" in value &&
    typeof value.headers === "object" &&
    value.headers !== null &&
    "get" in value.headers &&
    typeof value.headers.get === "function" &&
    "text" in value &&
    typeof value.text === "function"
  );
}

function malformedResponse(status: number) {
  return new ElevantApiError({
    kind: "malformed-response",
    status,
    title: "Malformed API response",
  });
}

function problemMetadata(value: unknown): ProblemMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.traceId === "string" ? { traceId: record.traceId } : {}),
  };
}

async function readProblemMetadata(response: Response) {
  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {};
  }

  if (body.trim().length === 0) return {};
  try {
    return problemMetadata(JSON.parse(body));
  } catch {
    return {};
  }
}

async function readSuccessBody(response: Response) {
  if (response.status === 204 || response.status === 205) return undefined;

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw malformedResponse(response.status);
  }

  if (body.trim().length === 0) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw malformedResponse(response.status);
  }
}

function isSystemPingResponse(value: unknown): value is SystemPingResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.application === "string" &&
    typeof response.status === "string" &&
    typeof response.environment === "string" &&
    typeof response.timestampUtc === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSessionActorResponse(value: unknown): value is SessionActorResponse {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.accountId) ||
    !isNonEmptyString(value.email) ||
    !isNonEmptyString(value.displayName) ||
    !Array.isArray(value.roles) ||
    !Array.isArray(value.memberships) ||
    !Array.isArray(value.stationScopes)
  ) {
    return false;
  }

  return (
    value.roles.length > 0 &&
    value.memberships.length > 0 &&
    value.roles.every(
      (role) =>
        isRecord(role) &&
        isNonEmptyString(role.roleId) &&
        isNonEmptyString(role.code) &&
        isNonEmptyString(role.name) &&
        isNonEmptyString(role.userType) &&
        ["back_office", "ramp_mobile_app", "airline_portal"].includes(
          String(role.portal),
        ),
    ) &&
    value.memberships.every(
      (membership) =>
        isRecord(membership) &&
        isNonEmptyString(membership.membershipId) &&
        isNonEmptyString(membership.organizationId) &&
        isNonEmptyString(membership.organizationCode) &&
        isNonEmptyString(membership.organizationName) &&
        ["aviam_operator", "airline_customer"].includes(
          String(membership.organizationType),
        ) &&
        ["internal_staff", "airline_client"].includes(String(membership.kind)),
    ) &&
    value.stationScopes.every(
      (scope) =>
        isRecord(scope) &&
        isNonEmptyString(scope.stationId) &&
        isNonEmptyString(scope.stationCode),
    )
  );
}

function isSessionResponse(value: unknown): value is SessionResponse {
  return (
    isRecord(value) &&
    isNonEmptyString(value.accessToken) &&
    value.tokenType === "Bearer" &&
    isNonEmptyString(value.expiresAt) &&
    !Number.isNaN(Date.parse(value.expiresAt)) &&
    isSessionActorResponse(value.actor)
  );
}

function isCurrentSessionResponse(value: unknown): value is CurrentSessionResponse {
  return isRecord(value) && isSessionActorResponse(value.actor);
}

function validatedSessionRequest(request: CreateSessionRequest): CreateSessionRequest {
  if (
    !isRecord(request) ||
    !isNonEmptyString(request.email) ||
    typeof request.password !== "string" ||
    request.password.length === 0
  ) {
    throw new TypeError("Session credentials must include an email and password.");
  }

  return request;
}

function validatedAccessToken(value: AccessToken) {
  if (value === null || value === undefined || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError("getAccessToken returned an invalid access token.");
  }
  return value;
}

export function createElevantApiClient(options: ElevantApiClientOptions): ElevantApiClient {
  const baseUrl = validatedBaseUrl(options.baseUrl);
  const defaultHeaders = headersFrom(options.defaultHeaders, "defaultHeaders");
  if (defaultHeaders.has("authorization")) {
    throw new TypeError(
      "defaultHeaders must not contain Authorization; use getAccessToken instead.",
    );
  }

  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }
  const getAccessToken = options.getAccessToken;

  const execute = async (
    path: string,
    init: ElevantRequestInit = {},
    includeAccessToken = false,
  ): Promise<ApiResult> => {
    const url = validatedRequestUrl(baseUrl, path);
    const headers = mergeHeaders(defaultHeaders, init.headers);
    if (init.body === undefined || init.body === null) headers.delete("content-type");

    if (includeAccessToken && getAccessToken) {
      const token = validatedAccessToken(await getAccessToken());
      if (token) headers.set("authorization", `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetchImplementation(url, {
        ...init,
        method: init.method ?? "GET",
        headers,
      });
    } finally {
      headers.delete("authorization");
    }

    if (!validResponse(response)) throw malformedResponse(0);
    if (!response.ok) {
      const metadata = await readProblemMetadata(response);
      throw new ElevantApiError({
        kind: "http",
        status: response.status,
        title: metadata.title,
        traceId: metadata.traceId,
      });
    }

    return { status: response.status, data: await readSuccessBody(response) };
  };

  return Object.freeze({
    async createSession(request: CreateSessionRequest, options?: CreateSessionOptions) {
      const credentials = validatedSessionRequest(request);
      const result = await execute(
        getCreateSessionUrl(),
        {
          ...options,
          method: "POST",
          headers: {
            ...Object.fromEntries(headersFrom(options?.headers, "Request headers")),
            "content-type": "application/json",
          },
          body: JSON.stringify(credentials),
        },
        false,
      );
      if (!isSessionResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getCurrentSession(options?: GetCurrentSessionOptions) {
      const result = await execute(
        getGetCurrentSessionUrl(),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isCurrentSessionResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getSystemPing(options?: GetSystemPingOptions) {
      const result = await execute(getGetSystemPingUrl(), {
        ...options,
        method: "GET",
      });
      if (!isSystemPingResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
  });
}
