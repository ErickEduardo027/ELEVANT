import {
  getAssignOccPlanningOperationUrl,
  getCreateSessionUrl,
  getGetCurrentSessionUrl,
  getGetOccPlanningOptionsUrl,
  getGetOccPlanningSnapshotUrl,
  getGetSystemPingUrl,
  type AssignOccOperationRequest,
  type CreateSessionRequest,
  type CurrentSessionResponse,
  type GetOccPlanningOptionsParams,
  type GetOccPlanningSnapshotParams,
  type OccPlanningOptionsResponse,
  type OccPlanningSnapshotResponse,
  type OccAssignmentResponse,
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
export type GetOccPlanningSnapshotOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetOccPlanningOptionsOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type AssignOccPlanningOperationOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;

export interface OccPlanningOptionsWithMetadata {
  readonly options: OccPlanningOptionsResponse;
  readonly etag: string;
}

export interface OccAssignmentWithMetadata {
  readonly assignment: OccAssignmentResponse;
  readonly etag: string;
}

export interface ElevantApiClient {
  createSession(
    request: CreateSessionRequest,
    options?: CreateSessionOptions,
  ): Promise<SessionResponse>;
  getCurrentSession(options?: GetCurrentSessionOptions): Promise<CurrentSessionResponse>;
  getOccPlanningSnapshot(
    parameters?: GetOccPlanningSnapshotParams,
    options?: GetOccPlanningSnapshotOptions,
  ): Promise<OccPlanningSnapshotResponse>;
  getOccPlanningOptions(
    turnaroundId: string,
    options?: GetOccPlanningOptionsOptions,
  ): Promise<OccPlanningOptionsResponse>;
  getOccPlanningOptionsWithMetadata(
    turnaroundId: string,
    options?: GetOccPlanningOptionsOptions,
  ): Promise<OccPlanningOptionsWithMetadata>;
  assignOccPlanningOperation(
    turnaroundId: string,
    request: AssignOccOperationRequest,
    etag: string,
    options?: AssignOccPlanningOperationOptions,
  ): Promise<OccAssignmentResponse>;
  assignOccPlanningOperationWithMetadata(
    turnaroundId: string,
    request: AssignOccOperationRequest,
    etag: string,
    options?: AssignOccPlanningOperationOptions,
  ): Promise<OccAssignmentWithMetadata>;
  getSystemPing(options?: GetSystemPingOptions): Promise<SystemPingResponse>;
}

interface ApiResult {
  readonly status: number;
  readonly data: unknown | undefined;
  readonly etag: string | null;
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ) &&
    value.toLowerCase() !== "00000000-0000-0000-0000-000000000000"
  );
}

function isDateOnly(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000-")
  ) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isDateTimeOffset(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?([zZ]|[+-](\d{2}):(\d{2}))$/.exec(
    value,
  );
  if (!match || !isDateOnly(match[1])) return false;

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return false;

  if (match[5]?.toLowerCase() !== "z") {
    const offsetHour = Number(match[6]);
    const offsetMinute = Number(match[7]);
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      return false;
    }
  }

  return !Number.isNaN(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInt32(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= -2_147_483_648 &&
    value <= 2_147_483_647
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isOptionalNullable(
  value: unknown,
  predicate: (candidate: unknown) => boolean,
) {
  return value === undefined || value === null || predicate(value);
}

function isOccStationResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "name", "ianaTimeZone"]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.name) &&
    isString(value.ianaTimeZone)
  );
}

function isOccTerminalResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "name"]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.name)
  );
}

function isOccStandResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "terminal"]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isOptionalNullable(value.terminal, isOccTerminalResponse)
  );
}

function isOccAirlineResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "iataCode", "icaoCode", "name"]) &&
    isUuid(value.id) &&
    isString(value.iataCode) &&
    isString(value.icaoCode) &&
    isString(value.name)
  );
}

function isOccAircraftResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "icaoCode",
      "iataCode",
      "manufacturer",
      "model",
      "registration",
    ]) &&
    isUuid(value.id) &&
    isString(value.icaoCode) &&
    isOptionalNullable(value.iataCode, isString) &&
    isString(value.manufacturer) &&
    isString(value.model) &&
    isOptionalNullable(value.registration, isString)
  );
}

function isOccAirportResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "iataCode", "icaoCode", "name"]) &&
    isUuid(value.id) &&
    isString(value.iataCode) &&
    isString(value.icaoCode) &&
    isString(value.name)
  );
}

function isOccFlightLegResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "flightNumber",
      "origin",
      "destination",
      "scheduledAt",
      "estimatedAt",
      "actualAt",
    ]) &&
    isUuid(value.id) &&
    isString(value.flightNumber) &&
    isOccAirportResponse(value.origin) &&
    isOccAirportResponse(value.destination) &&
    isDateTimeOffset(value.scheduledAt) &&
    isOptionalNullable(value.estimatedAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualAt, isDateTimeOffset)
  );
}

function isOccGroundOperationResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "status",
      "plannedStartAt",
      "plannedEndAt",
      "actualStartAt",
      "actualEndAt",
    ]) &&
    isUuid(value.id) &&
    isString(value.status) &&
    isOptionalNullable(value.plannedStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.plannedEndAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualEndAt, isDateTimeOffset)
  );
}

function isOccAssignedAgentResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "assignmentId",
      "agentId",
      "displayName",
      "employeeNumber",
      "positionId",
      "positionCode",
      "positionName",
      "assignmentRole",
      "assignedAt",
    ]) &&
    isUuid(value.assignmentId) &&
    isUuid(value.agentId) &&
    isString(value.displayName) &&
    isString(value.employeeNumber) &&
    isOptionalNullable(value.positionId, isUuid) &&
    isOptionalNullable(value.positionCode, isString) &&
    isOptionalNullable(value.positionName, isString) &&
    isString(value.assignmentRole) &&
    isDateTimeOffset(value.assignedAt)
  );
}

function isOccAssignedEquipmentResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "assignmentId",
      "equipmentId",
      "assetCode",
      "equipmentTypeId",
      "equipmentTypeCode",
      "equipmentTypeName",
      "status",
      "assignedAt",
    ]) &&
    isUuid(value.assignmentId) &&
    isUuid(value.equipmentId) &&
    isString(value.assetCode) &&
    isUuid(value.equipmentTypeId) &&
    isString(value.equipmentTypeCode) &&
    isString(value.equipmentTypeName) &&
    isString(value.status) &&
    isDateTimeOffset(value.assignedAt)
  );
}

function isOccOperationServiceResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "lineNumber",
      "serviceDefinitionId",
      "code",
      "name",
      "contractedQuantity",
      "executedQuantity",
      "billingUnit",
      "status",
    ]) &&
    isUuid(value.id) &&
    isInt32(value.lineNumber) &&
    isUuid(value.serviceDefinitionId) &&
    isString(value.code) &&
    isString(value.name) &&
    isFiniteNumber(value.contractedQuantity) &&
    isFiniteNumber(value.executedQuantity) &&
    isString(value.billingUnit) &&
    isString(value.status)
  );
}

function isOccTurnaroundResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "operationCode",
      "operationDate",
      "status",
      "airline",
      "aircraft",
      "stand",
      "arrival",
      "departure",
      "operation",
      "agents",
      "equipment",
      "services",
    ]) &&
    isUuid(value.id) &&
    isString(value.operationCode) &&
    isDateOnly(value.operationDate) &&
    isString(value.status) &&
    isOccAirlineResponse(value.airline) &&
    isOptionalNullable(value.aircraft, isOccAircraftResponse) &&
    isOptionalNullable(value.stand, isOccStandResponse) &&
    isOptionalNullable(value.arrival, isOccFlightLegResponse) &&
    isOptionalNullable(value.departure, isOccFlightLegResponse) &&
    isOptionalNullable(value.operation, isOccGroundOperationResponse) &&
    Array.isArray(value.agents) &&
    value.agents.every(isOccAssignedAgentResponse) &&
    Array.isArray(value.equipment) &&
    value.equipment.every(isOccAssignedEquipmentResponse) &&
    Array.isArray(value.services) &&
    value.services.every(isOccOperationServiceResponse)
  );
}

function isOccPlanningSnapshotResponse(
  value: unknown,
): value is OccPlanningSnapshotResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["station", "date", "turnarounds"]) &&
    isOccStationResponse(value.station) &&
    isDateOnly(value.date) &&
    Array.isArray(value.turnarounds) &&
    value.turnarounds.every(isOccTurnaroundResponse)
  );
}

function isOccContractOptionResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "code",
      "version",
      "validFrom",
      "validTo",
      "currencyCode",
    ]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isInt32(value.version) &&
    isDateOnly(value.validFrom) &&
    isOptionalNullable(value.validTo, isDateOnly) &&
    isString(value.currencyCode)
  );
}

function isOccServiceOptionResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "serviceDefinitionId",
      "code",
      "name",
      "billingUnit",
      "minimumQuantity",
      "unitPrice",
      "currencyCode",
    ]) &&
    isUuid(value.id) &&
    isUuid(value.serviceDefinitionId) &&
    isString(value.code) &&
    isString(value.name) &&
    isString(value.billingUnit) &&
    isFiniteNumber(value.minimumQuantity) &&
    isFiniteNumber(value.unitPrice) &&
    isString(value.currencyCode)
  );
}

function isOccAgentOptionResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "displayName",
      "employeeNumber",
      "eligible",
      "eligibilityReasons",
    ]) &&
    isUuid(value.id) &&
    isString(value.displayName) &&
    isString(value.employeeNumber) &&
    typeof value.eligible === "boolean" &&
    Array.isArray(value.eligibilityReasons) &&
    value.eligibilityReasons.every(isString)
  );
}

function isOccPlanningTurnaroundContextResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "operationCode",
      "operationDate",
      "station",
      "stand",
      "referenceTime",
    ]) &&
    isUuid(value.id) &&
    isString(value.operationCode) &&
    isDateOnly(value.operationDate) &&
    isOccStationResponse(value.station) &&
    isOptionalNullable(value.stand, isOccStandResponse) &&
    isDateTimeOffset(value.referenceTime)
  );
}

function isOccPlanningOptionsResponse(
  value: unknown,
): value is OccPlanningOptionsResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["turnaround", "contract", "services", "agents"]) &&
    isOccPlanningTurnaroundContextResponse(value.turnaround) &&
    isOptionalNullable(value.contract, isOccContractOptionResponse) &&
    Array.isArray(value.services) &&
    value.services.every(isOccServiceOptionResponse) &&
    Array.isArray(value.agents) &&
    value.agents.every(isOccAgentOptionResponse)
  );
}

function isOccAssignmentResponse(value: unknown): value is OccAssignmentResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["turnaroundId", "operation", "assignment", "services"]) &&
    isUuid(value.turnaroundId) &&
    isOccGroundOperationResponse(value.operation) &&
    isOccAssignedAgentResponse(value.assignment) &&
    Array.isArray(value.services) &&
    value.services.every(isOccOperationServiceResponse)
  );
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

function validatedOccPlanningSnapshotParams(
  parameters: GetOccPlanningSnapshotParams,
): GetOccPlanningSnapshotParams {
  if (!isRecord(parameters)) {
    throw new TypeError("OCC planning parameters must be an object.");
  }

  const stationId = parameters.stationId;
  const date = parameters.date;
  if (stationId !== undefined && !isUuid(stationId)) {
    throw new TypeError("stationId must be a non-empty canonical UUID.");
  }
  if (date !== undefined && !isDateOnly(date)) {
    throw new TypeError("date must be a valid calendar date in YYYY-MM-DD format.");
  }

  return {
    ...(stationId === undefined ? {} : { stationId }),
    ...(date === undefined ? {} : { date }),
  };
}

function validatedOccPlanningOptionsParams(
  turnaroundId: string,
): GetOccPlanningOptionsParams {
  if (!isUuid(turnaroundId)) {
    throw new TypeError("turnaroundId must be a non-empty canonical UUID.");
  }

  return { turnaroundId };
}

function validatedOccAssignmentRequest(
  request: AssignOccOperationRequest,
): AssignOccOperationRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["agentId"]) ||
    !isUuid(request.agentId)
  ) {
    throw new TypeError("OCC assignment must contain only a valid agentId UUID.");
  }

  return { agentId: request.agentId };
}

function isStrongEtag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.trim() === value &&
    value.startsWith('"') &&
    value.endsWith('"') &&
    !value.startsWith('W/"') &&
    !/["\u0000-\u0020\u007f]/.test(value.slice(1, -1))
  );
}

function validatedStrongEtag(value: string) {
  if (!isStrongEtag(value)) {
    throw new TypeError("etag must be the strong OCC ETag returned by the API.");
  }

  return value;
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

    return {
      status: response.status,
      data: await readSuccessBody(response),
      etag: response.headers.get("etag"),
    };
  };

  const executeOccAssignment = async (
    turnaroundId: string,
    request: AssignOccOperationRequest,
    etag: string,
    requestOptions?: AssignOccPlanningOperationOptions,
  ) => {
    const body = validatedOccAssignmentRequest(request);
    const headers = headersFrom(requestOptions?.headers, "Request headers");
    headers.set("content-type", "application/json");
    headers.set("if-match", validatedStrongEtag(etag));
    const result = await execute(
      getAssignOccPlanningOperationUrl(
        validatedOccPlanningOptionsParams(turnaroundId).turnaroundId,
      ),
      {
        ...requestOptions,
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      true,
    );
    if (!isOccAssignmentResponse(result.data)) {
      throw malformedResponse(result.status);
    }

    return { assignment: result.data, etag: result.etag, status: result.status };
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
    async getOccPlanningSnapshot(
      parameters: GetOccPlanningSnapshotParams = {},
      options?: GetOccPlanningSnapshotOptions,
    ) {
      const result = await execute(
        getGetOccPlanningSnapshotUrl(validatedOccPlanningSnapshotParams(parameters)),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isOccPlanningSnapshotResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getOccPlanningOptions(
      turnaroundId: string,
      options?: GetOccPlanningOptionsOptions,
    ) {
      const result = await execute(
        getGetOccPlanningOptionsUrl(
          validatedOccPlanningOptionsParams(turnaroundId),
        ),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isOccPlanningOptionsResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getOccPlanningOptionsWithMetadata(
      turnaroundId: string,
      options?: GetOccPlanningOptionsOptions,
    ) {
      const result = await execute(
        getGetOccPlanningOptionsUrl(
          validatedOccPlanningOptionsParams(turnaroundId),
        ),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isOccPlanningOptionsResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      if (!isStrongEtag(result.etag)) {
        throw malformedResponse(result.status);
      }
      return { options: result.data, etag: result.etag };
    },
    async assignOccPlanningOperation(
      turnaroundId: string,
      request: AssignOccOperationRequest,
      etag: string,
      options?: AssignOccPlanningOperationOptions,
    ) {
      const result = await executeOccAssignment(
        turnaroundId,
        request,
        etag,
        options,
      );
      return result.assignment;
    },
    async assignOccPlanningOperationWithMetadata(
      turnaroundId: string,
      request: AssignOccOperationRequest,
      etag: string,
      options?: AssignOccPlanningOperationOptions,
    ) {
      const result = await executeOccAssignment(
        turnaroundId,
        request,
        etag,
        options,
      );
      if (!isStrongEtag(result.etag)) {
        throw malformedResponse(result.status);
      }
      return { assignment: result.assignment, etag: result.etag };
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
