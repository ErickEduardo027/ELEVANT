import {
  getGetAccountChangesUrl,
  getGetAirlinePortalBootstrapUrl,
  getAssignOccPlanningOperationUrl,
  getCreateSessionUrl,
  getChangePasswordUrl,
  getGetCurrentSessionUrl,
  getGetOccPlanningOptionsUrl,
  getGetOccPlanningSnapshotUrl,
  getGetOccReviewQueueUrl,
  getGetOccReviewDetailUrl,
  getGetOccReviewSubmissionDetailUrl,
  getGetOccReviewSubmissionHistoryUrl,
  getGetOperationalConversationsUrl,
  getGetOperationalMessagesUrl,
  getSendOperationalMessageUrl,
  getGetOperationalNotificationsUrl,
  getSetOperationalNotificationReadUrl,
  getDecideOccReviewUrl,
  getGetRampOperationChecklistUrl,
  getGetRampIncidentsUrl,
  getGetRampAssignedOperationsUrl,
  getGetSystemPingUrl,
  getRegisterMobileDeviceUrl,
  getReopenRampOperationCorrectionUrl,
  getReportRampIncidentUrl,
  getSubmitRampOperationUrl,
  getStartRampOperationUrl,
  getSubmitRampOperationChecklistUrl,
  getTransitionRampOperationServiceUrl,
  type AssignOccOperationRequest,
  type AccountChangeListResponse,
  type GetAccountChangesParams,
  type AirlinePortalBootstrapResponse,
  type CreateSessionRequest,
  type ChangePasswordRequest,
  type CurrentSessionResponse,
  type GetRampOperationChecklistResponse,
  type GetRampIncidentsResponse,
  type GetOccPlanningOptionsParams,
  type GetOccPlanningSnapshotParams,
  type GetOccReviewQueueParams,
  type OccReviewQueueResponse,
  type OccReviewDetailResponse,
  type OccReviewSubmissionHistoryResponse,
  type OperationConversationListResponse,
  type OperationMessageListResponse,
  type OperationMessageResponse,
  type OperationalNotificationListResponse,
  type OperationalNotificationResponse,
  type SendOperationMessageRequest,
  type DecideOccReviewRequest,
  type DecideOccReviewResponse,
  type OccPlanningOptionsResponse,
  type OccPlanningSnapshotResponse,
  type OccAssignmentResponse,
  type RampGroundOperationResponse,
  type RampChecklistSubmissionResponse,
  type RampIncidentReceiptResponse,
  type RampOperationSubmissionResponse,
  type RampOperationCorrectionResponse,
  type ReportRampIncidentRequest,
  type SubmitRampOperationRequest,
  type RampOperationServiceTransitionResponse,
  type RampOperationStartResponse,
  type RampAssignedOperationsResponse,
  type RegisterMobileDeviceRequest,
  type RegisterMobileDeviceResponse,
  type SessionActorResponse,
  type SessionResponse,
  type SubmitRampOperationChecklistRequest,
  type SystemPingResponse,
  type TransitionRampOperationServiceRequest,
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
export type ChangePasswordOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetCurrentSessionOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlinePortalBootstrapOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetOccPlanningSnapshotOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetOccPlanningOptionsOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetOccReviewOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetOperationalCommunicationOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAccountChangesOptions = Omit<ElevantRequestInit, "body" | "method">;
export type DecideOccReviewOptions = Omit<ElevantRequestInit, "body" | "method">;
export type AssignOccPlanningOperationOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetRampAssignedOperationsOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type RegisterMobileDeviceOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type StartRampOperationOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetRampOperationChecklistOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetRampIncidentsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ReportRampIncidentOptions = Omit<ElevantRequestInit, "body" | "method">;
export type SubmitRampOperationOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ReopenRampOperationCorrectionOptions = Omit<ElevantRequestInit, "body" | "method">;
export type SubmitRampOperationChecklistOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type TransitionRampOperationServiceOptions = Omit<
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
  getAccountChanges(
    parameters?: GetAccountChangesParams,
    options?: GetAccountChangesOptions,
  ): Promise<AccountChangeListResponse>;
  createSession(
    request: CreateSessionRequest,
    options?: CreateSessionOptions,
  ): Promise<SessionResponse>;
  changePassword(
    request: ChangePasswordRequest,
    options?: ChangePasswordOptions,
  ): Promise<void>;
  getCurrentSession(options?: GetCurrentSessionOptions): Promise<CurrentSessionResponse>;
  getAirlinePortalBootstrap(
    options?: GetAirlinePortalBootstrapOptions,
  ): Promise<AirlinePortalBootstrapResponse>;
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
  getOccReviewQueue(
    stationId: string,
    options?: GetOccReviewOptions,
  ): Promise<OccReviewQueueResponse>;
  getOccReviewDetail(
    operationId: string,
    options?: GetOccReviewOptions,
  ): Promise<OccReviewDetailResponse>;
  getOccReviewSubmissionDetail(
    operationId: string,
    submissionId: string,
    options?: GetOccReviewOptions,
  ): Promise<OccReviewDetailResponse>;
  getOccReviewSubmissionHistory(
    operationId: string,
    options?: GetOccReviewOptions,
  ): Promise<OccReviewSubmissionHistoryResponse>;
  getOperationalConversations(
    stationId?: string,
    options?: GetOperationalCommunicationOptions,
  ): Promise<OperationConversationListResponse>;
  getOperationalMessages(
    operationId: string,
    options?: GetOperationalCommunicationOptions,
  ): Promise<OperationMessageListResponse>;
  sendOperationalMessage(
    operationId: string,
    request: SendOperationMessageRequest,
    idempotencyKey: string,
    installationId?: string,
    options?: GetOperationalCommunicationOptions,
  ): Promise<OperationMessageResponse>;
  getOperationalNotifications(
    options?: GetOperationalCommunicationOptions,
  ): Promise<OperationalNotificationListResponse>;
  setOperationalNotificationRead(
    notificationId: string,
    read: boolean,
    options?: GetOperationalCommunicationOptions,
  ): Promise<OperationalNotificationResponse>;
  decideOccReview(
    operationId: string,
    request: DecideOccReviewRequest,
    etag: string,
    options?: DecideOccReviewOptions,
  ): Promise<DecideOccReviewResponse>;
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
  getRampAssignedOperations(
    options?: GetRampAssignedOperationsOptions,
  ): Promise<RampAssignedOperationsResponse>;
  registerMobileDevice(
    request: RegisterMobileDeviceRequest,
    options?: RegisterMobileDeviceOptions,
  ): Promise<RegisterMobileDeviceResponse>;
  startRampOperation(
    operationId: string,
    installationId: string,
    idempotencyKey: string,
    options?: StartRampOperationOptions,
  ): Promise<RampOperationStartResponse>;
  getRampOperationChecklist(
    operationId: string,
    options?: GetRampOperationChecklistOptions,
  ): Promise<GetRampOperationChecklistResponse>;
  getRampIncidents(
    operationId: string,
    options?: GetRampIncidentsOptions,
  ): Promise<GetRampIncidentsResponse>;
  reportRampIncident(
    operationId: string,
    request: ReportRampIncidentRequest,
    installationId: string,
    idempotencyKey: string,
    options?: ReportRampIncidentOptions,
  ): Promise<RampIncidentReceiptResponse>;
  submitRampOperation(
    operationId: string,
    request: SubmitRampOperationRequest,
    installationId: string,
    idempotencyKey: string,
    options?: SubmitRampOperationOptions,
  ): Promise<RampOperationSubmissionResponse>;
  reopenRampOperationCorrection(
    operationId: string,
    installationId: string,
    idempotencyKey: string,
    options?: ReopenRampOperationCorrectionOptions,
  ): Promise<RampOperationCorrectionResponse>;
  submitRampOperationChecklist(
    operationId: string,
    request: SubmitRampOperationChecklistRequest,
    installationId: string,
    idempotencyKey: string,
    options?: SubmitRampOperationChecklistOptions,
  ): Promise<RampChecklistSubmissionResponse>;
  transitionRampOperationService(
    operationId: string,
    serviceId: string,
    request: TransitionRampOperationServiceRequest,
    installationId: string,
    idempotencyKey: string,
    options?: TransitionRampOperationServiceOptions,
  ): Promise<RampOperationServiceTransitionResponse>;
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
  readonly code?: "password_change_required";
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
    ...(record.code === "password_change_required" ? { code: record.code } : {}),
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

function isChangeCursor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function isAccountChangeListResponse(
  value: unknown, after: string | undefined, limit: number,
): value is AccountChangeListResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["changes", "nextCursor", "hasMore"]) ||
      !Array.isArray(value.changes) || value.changes.length > limit ||
      typeof value.hasMore !== "boolean" ||
      (value.hasMore && value.changes.length === 0)) return false;
  if (!value.changes.every((item: unknown) =>
    isRecord(item) &&
    hasOnlyKeys(item, ["eventId", "cursor", "resource", "resourceId", "occurredAt"]) &&
    isUuid(item.eventId) && isChangeCursor(item.cursor) &&
    isNonEmptyString(item.resource) && item.resource.length <= 64 &&
    /^[a-z0-9_-]+$/.test(item.resource) && isUuid(item.resourceId) &&
    isDateTimeOffset(item.occurredAt))) return false;
  const last = value.changes.at(-1) as { cursor: string } | undefined;
  return last ? value.nextCursor === last.cursor :
    (after === undefined ? value.nextCursor === null || value.nextCursor === undefined
      : value.nextCursor === after);
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

function isOccGroundOperationResponse(
  value: unknown,
): value is RampGroundOperationResponse {
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

function isRampOperationalPositionResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "code", "name"]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.name)
  );
}

function isRampAgentAssignmentResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "agentId",
      "position",
      "assignmentRole",
      "assignedAt",
    ]) &&
    isUuid(value.id) &&
    isUuid(value.agentId) &&
    isOptionalNullable(value.position, isRampOperationalPositionResponse) &&
    isString(value.assignmentRole) &&
    isDateTimeOffset(value.assignedAt)
  );
}

function isRampTurnaroundResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "operationCode",
      "operationDate",
      "status",
      "station",
      "airline",
      "aircraft",
      "stand",
      "arrival",
      "departure",
    ]) &&
    isUuid(value.id) &&
    isString(value.operationCode) &&
    isDateOnly(value.operationDate) &&
    isString(value.status) &&
    isOccStationResponse(value.station) &&
    isOccAirlineResponse(value.airline) &&
    isOptionalNullable(value.aircraft, isOccAircraftResponse) &&
    isOptionalNullable(value.stand, isOccStandResponse) &&
    isOptionalNullable(value.arrival, isOccFlightLegResponse) &&
    isOptionalNullable(value.departure, isOccFlightLegResponse)
  );
}

function isRampAssignedOperationResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["assignment", "operation", "turnaround", "services", "review"]) &&
    isRampAgentAssignmentResponse(value.assignment) &&
    isOccGroundOperationResponse(value.operation) &&
    isRampTurnaroundResponse(value.turnaround) &&
    Array.isArray(value.services) &&
    value.services.every(isOccOperationServiceResponse) &&
    isOptionalNullable(value.review, (review) =>
      isRecord(review) &&
      hasOnlyKeys(review, ["submissionId", "revisionNumber", "status", "returnReason"]) &&
      isUuid(review.submissionId) &&
      isInt32(review.revisionNumber) && review.revisionNumber > 0 &&
      isOneOf(review.status, ["PendingReview", "InReview", "Approved", "Returned"] as const) &&
      isOptionalNullable(review.returnReason, (reason) =>
        typeof reason === "string" && reason.length >= 8 && reason.length <= 2000) &&
      (review.status !== "Returned" || typeof review.returnReason === "string"))
  );
}

function isRampAssignedOperationsResponse(
  value: unknown,
): value is RampAssignedOperationsResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["operations"]) &&
    Array.isArray(value.operations) &&
    value.operations.every(isRampAssignedOperationResponse)
  );
}

function isRegisterMobileDeviceResponse(
  value: unknown,
): value is RegisterMobileDeviceResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["installationId", "platform", "appVersion", "lastSeenAt"]) &&
    isUuid(value.installationId) &&
    (value.platform === "Android" || value.platform === "Ios") &&
    isNonEmptyString(value.appVersion) &&
    isDateTimeOffset(value.lastSeenAt)
  );
}

function isRampOperationStartResponse(
  value: unknown,
): value is RampOperationStartResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "operation"]) &&
    isUuid(value.receiptId) &&
    isOccGroundOperationResponse(value.operation) &&
    value.operation.status === "InProgress" &&
    isDateTimeOffset(value.operation.actualStartAt) &&
    value.operation.actualEndAt === null
  );
}

const rampChecklistStatuses = ["NotStarted", "InProgress", "Submitted"] as const;
const rampIncidentTypes = ["Operational", "Safety", "Equipment", "Documentation"] as const;
const rampIncidentSeverities = ["Low", "Medium", "High", "Critical"] as const;
const rampIncidentStatuses = ["Open", "InReview", "Resolved", "Closed"] as const;
const rampChecklistAnswerValues = ["Ok", "NotApplicable", "NotOk"] as const;
const rampServiceTargetStatuses = [
  "InProgress",
  "Completed",
  "NotPerformed",
  "Exception",
] as const;
const maximumExecutedQuantityExclusive = 100_000_000_000_000;

function isOneOf<const TValue extends readonly string[]>(
  value: unknown,
  values: TValue,
): value is TValue[number] {
  return typeof value === "string" && values.includes(value);
}

function isRampChecklistAnswerResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["value", "note", "answeredAt"]) &&
    isOneOf(value.value, rampChecklistAnswerValues) &&
    isOptionalNullable(value.note, isString) &&
    isDateTimeOffset(value.answeredAt)
  );
}

function isRampChecklistItemResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "code",
      "label",
      "sortOrder",
      "isRequired",
      "requiresNoteWhenNotOk",
      "answer",
    ]) &&
    isUuid(value.id) &&
    isString(value.code) &&
    isString(value.label) &&
    isInt32(value.sortOrder) &&
    value.sortOrder >= 0 &&
    typeof value.isRequired === "boolean" &&
    typeof value.requiresNoteWhenNotOk === "boolean" &&
    isOptionalNullable(value.answer, isRampChecklistAnswerResponse)
  );
}

function isRampChecklistResponse(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "status",
      "startedAt",
      "submittedAt",
      "template",
      "sections",
    ]) ||
    !isUuid(value.id) ||
    !isOneOf(value.status, rampChecklistStatuses) ||
    !isOptionalNullable(value.startedAt, isDateTimeOffset) ||
    !isOptionalNullable(value.submittedAt, isDateTimeOffset) ||
    !isRecord(value.template) ||
    !hasOnlyKeys(value.template, ["code", "name", "version"]) ||
    !isString(value.template.code) ||
    !isString(value.template.name) ||
    !isInt32(value.template.version) ||
    value.template.version < 1 ||
    !Array.isArray(value.sections)
  ) {
    return false;
  }

  if (
    value.status === "Submitted" &&
    (!isDateTimeOffset(value.startedAt) || !isDateTimeOffset(value.submittedAt))
  ) {
    return false;
  }

  const itemIds = new Set<string>();
  for (const section of value.sections) {
    if (
      !isRecord(section) ||
      !hasOnlyKeys(section, ["name", "items"]) ||
      !isString(section.name) ||
      !Array.isArray(section.items) ||
      !section.items.every(isRampChecklistItemResponse)
    ) {
      return false;
    }

    for (const item of section.items) {
      const itemId = (item as Record<string, unknown>).id as string;
      if (itemIds.has(itemId.toLowerCase())) return false;
      itemIds.add(itemId.toLowerCase());
    }
  }

  return true;
}

function isGetRampOperationChecklistResponse(
  value: unknown,
  operationId: string,
): value is GetRampOperationChecklistResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["operationId", "checklist"]) &&
    isUuid(value.operationId) &&
    value.operationId.toLowerCase() === operationId &&
    isRampChecklistResponse(value.checklist)
  );
}

function isRampChecklistSubmissionResponse(
  value: unknown,
  checklistId: string,
  answerCount: number,
): value is RampChecklistSubmissionResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "checklist"]) &&
    isUuid(value.receiptId) &&
    isRecord(value.checklist) &&
    hasOnlyKeys(value.checklist, [
      "id",
      "status",
      "startedAt",
      "submittedAt",
      "answerCount",
    ]) &&
    isUuid(value.checklist.id) &&
    value.checklist.id.toLowerCase() === checklistId &&
    value.checklist.status === "Submitted" &&
    isDateTimeOffset(value.checklist.startedAt) &&
    isDateTimeOffset(value.checklist.submittedAt) &&
    isInt32(value.checklist.answerCount) &&
    value.checklist.answerCount === answerCount
  );
}

function isRampOperationServiceTransitionResponse(
  value: unknown,
  serviceId: string,
  targetStatus: string,
): value is RampOperationServiceTransitionResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "service"]) &&
    isUuid(value.receiptId) &&
    isRecord(value.service) &&
    hasOnlyKeys(value.service, [
      "id",
      "status",
      "contractedQuantity",
      "executedQuantity",
      "billingUnit",
    ]) &&
    isUuid(value.service.id) &&
    value.service.id.toLowerCase() === serviceId &&
    value.service.status === targetStatus &&
    isFiniteNumber(value.service.contractedQuantity) &&
    value.service.contractedQuantity >= 0 &&
    isFiniteNumber(value.service.executedQuantity) &&
    value.service.executedQuantity >= 0 &&
    isString(value.service.billingUnit)
  );
}

function isRampIncidentResponse(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id", "incidentType", "severity", "status", "description", "occurredAt", "reportedAt",
    ]) &&
    isUuid(value.id) &&
    typeof value.incidentType === "string" &&
    value.incidentType.length > 0 &&
    value.incidentType.length <= 80 &&
    isOneOf(value.severity, rampIncidentSeverities) &&
    isOneOf(value.status, rampIncidentStatuses) &&
    typeof value.description === "string" &&
    value.description.length > 0 &&
    value.description.length <= 4_000 &&
    isDateTimeOffset(value.occurredAt) &&
    isDateTimeOffset(value.reportedAt)
  );
}

function isGetRampIncidentsResponse(
  value: unknown,
  operationId: string,
): value is GetRampIncidentsResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["operationId", "incidents"]) ||
    !isUuid(value.operationId) ||
    value.operationId.toLowerCase() !== operationId ||
    !Array.isArray(value.incidents) ||
    !value.incidents.every(isRampIncidentResponse)
  ) return false;
  const ids = value.incidents.map(item => item.id.toLowerCase());
  return new Set(ids).size === ids.length;
}

function isRampIncidentReceiptResponse(
  value: unknown,
  operationId: string,
  idempotencyKey: string,
  occurredAt: string,
): value is RampIncidentReceiptResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "operationId", "incidentId", "status", "occurredAt", "reportedAt"]) &&
    isUuid(value.receiptId) &&
    isUuid(value.operationId) &&
    value.operationId.toLowerCase() === operationId &&
    isUuid(value.incidentId) &&
    value.incidentId.toLowerCase() === idempotencyKey &&
    isOneOf(value.status, rampIncidentStatuses) &&
    isDateTimeOffset(value.occurredAt) &&
    Date.parse(value.occurredAt) === Date.parse(occurredAt) &&
    isDateTimeOffset(value.reportedAt)
  );
}

function isRampOperationSubmissionResponse(
  value: unknown,
  operationId: string,
  idempotencyKey: string,
  agentNote: string | null,
): value is RampOperationSubmissionResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "receiptId", "operationId", "submissionId", "checklistId", "revisionNumber",
      "status", "submittedAt", "actualEndAt", "agentNote",
    ]) &&
    isUuid(value.receiptId) &&
    isUuid(value.operationId) &&
    value.operationId.toLowerCase() === operationId &&
    isUuid(value.submissionId) &&
    value.submissionId.toLowerCase() === idempotencyKey &&
    isUuid(value.checklistId) &&
    Number.isInteger(value.revisionNumber) &&
    (value.revisionNumber as number) > 0 &&
    isOneOf(value.status, ["PendingReview", "InReview", "Approved", "Returned"] as const) &&
    isDateTimeOffset(value.submittedAt) &&
    isDateTimeOffset(value.actualEndAt) &&
    (value.agentNote ?? null) === agentNote
  );
}

function isRampOperationCorrectionResponse(
  value: unknown, operationId: string, checklistId: string,
): value is RampOperationCorrectionResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["receiptId", "operationId", "previousSubmissionId",
      "checklistId", "revisionNumber", "status", "returnReason"]) &&
    isUuid(value.receiptId) && isUuid(value.operationId) &&
    value.operationId.toLowerCase() === operationId &&
    isUuid(value.previousSubmissionId) && isUuid(value.checklistId) &&
    value.checklistId.toLowerCase() === checklistId &&
    isInt32(value.revisionNumber) && value.revisionNumber > 1 &&
    value.status === "InProgress" &&
    typeof value.returnReason === "string" &&
    value.returnReason.length >= 8 && value.returnReason.length <= 2000;
}

const occReviewStatuses = ["PendingReview", "InReview", "Approved", "Returned"] as const;

function isOperationMessageResponse(value: unknown, operationId?: string): value is OperationMessageResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "operationId", "senderAccountId", "senderRole", "senderName", "content", "sentAt"]) &&
    isUuid(value.id) && isUuid(value.operationId) &&
    (operationId === undefined || value.operationId.toLowerCase() === operationId) &&
    isUuid(value.senderAccountId) &&
    isOneOf(value.senderRole, ["occ", "agent"] as const) &&
    isNonEmptyString(value.senderName) &&
    isNonEmptyString(value.content) && value.content.length <= 2_000 &&
    isDateTimeOffset(value.sentAt);
}

function isOperationConversationListResponse(value: unknown): value is OperationConversationListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["conversations", "hasMore"]) &&
    typeof value.hasMore === "boolean" && Array.isArray(value.conversations) &&
    value.conversations.length <= 100 && value.conversations.every((item: unknown) =>
      isRecord(item) && hasOnlyKeys(item, ["operationId", "operationCode", "operationDate",
        "stationCode", "airlineName", "agentName", "status", "lastMessage"]) &&
      isUuid(item.operationId) && isNonEmptyString(item.operationCode) &&
      isDateOnly(item.operationDate) && isNonEmptyString(item.stationCode) &&
      isNonEmptyString(item.airlineName) &&
      isOptionalNullable(item.agentName, isString) && isNonEmptyString(item.status) &&
      isOptionalNullable(item.lastMessage, candidate =>
        isOperationMessageResponse(candidate, (item.operationId as string).toLowerCase())));
}

function isOperationMessageListResponse(value: unknown, operationId: string): value is OperationMessageListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["operationId", "messages", "hasMore"]) &&
    isUuid(value.operationId) && value.operationId.toLowerCase() === operationId &&
    typeof value.hasMore === "boolean" && Array.isArray(value.messages) &&
    value.messages.length <= 200 && value.messages.every((item: unknown) =>
      isOperationMessageResponse(item, operationId));
}

function isOperationalNotificationResponse(value: unknown): value is OperationalNotificationResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id", "operationId", "operationCode",
    "stationCode", "kind", "sourceId", "occurredAt", "readAt"]) &&
    isUuid(value.id) && isUuid(value.operationId) &&
    isNonEmptyString(value.operationCode) && isNonEmptyString(value.stationCode) &&
    isNonEmptyString(value.kind) && isUuid(value.sourceId) &&
    isDateTimeOffset(value.occurredAt) && isOptionalNullable(value.readAt, isDateTimeOffset);
}

function isOperationalNotificationListResponse(value: unknown): value is OperationalNotificationListResponse {
  return isRecord(value) && hasOnlyKeys(value, ["notifications", "hasMore"]) &&
    typeof value.hasMore === "boolean" && Array.isArray(value.notifications) &&
    value.notifications.length <= 100 && value.notifications.every(isOperationalNotificationResponse);
}

function isOccReviewSubmissionHistoryResponse(
  value: unknown, operationId: string,
): value is OccReviewSubmissionHistoryResponse {
  if (!isRecord(value) ||
      !hasOnlyKeys(value, ["operationId", "submissions", "hasMore"]) ||
      !isUuid(value.operationId) || value.operationId.toLowerCase() !== operationId ||
      typeof value.hasMore !== "boolean" ||
      !Array.isArray(value.submissions) || value.submissions.length < 1 ||
      value.submissions.length > 100) return false;
  const revisions = new Set<number>();
  const ids = new Set<string>();
  return value.submissions.every((item: unknown) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["submissionId", "revisionNumber",
      "status", "submittedAt", "outcome", "decidedAt"]) ||
      !isUuid(item.submissionId) || !isInt32(item.revisionNumber) ||
      item.revisionNumber < 1 || !isOneOf(item.status, occReviewStatuses) ||
      !isDateTimeOffset(item.submittedAt) ||
      !isOptionalNullable(item.outcome, outcome =>
        isOneOf(outcome, ["Approved", "Returned"] as const)) ||
      !isOptionalNullable(item.decidedAt, isDateTimeOffset)) return false;
    const id = item.submissionId.toLowerCase();
    if (revisions.has(item.revisionNumber) || ids.has(id)) return false;
    revisions.add(item.revisionNumber);
    ids.add(id);
    return true;
  });
}

function isOccReviewQueueResponse(value: unknown, stationId: string): value is OccReviewQueueResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["stationId", "stationCode", "stationName", "ianaTimeZone", "operations", "hasMore"]) &&
    isUuid(value.stationId) && value.stationId.toLowerCase() === stationId &&
    isNonEmptyString(value.stationCode) && isNonEmptyString(value.stationName) &&
    isNonEmptyString(value.ianaTimeZone) && typeof value.hasMore === "boolean" &&
    Array.isArray(value.operations) && value.operations.length <= 100 &&
    value.operations.every((item: unknown) => isRecord(item) &&
      hasOnlyKeys(item, ["operationId", "submissionId", "revisionNumber", "status",
        "operationCode", "operationDate", "airlineName", "agentName", "submittedAt",
        "serviceCount", "incidentCount"]) &&
      isUuid(item.operationId) && isUuid(item.submissionId) &&
      isInt32(item.revisionNumber) && item.revisionNumber > 0 &&
      isOneOf(item.status, occReviewStatuses) && isNonEmptyString(item.operationCode) &&
      isDateOnly(item.operationDate) && isNonEmptyString(item.airlineName) &&
      isNonEmptyString(item.agentName) && isDateTimeOffset(item.submittedAt) &&
      isInt32(item.serviceCount) && item.serviceCount >= 0 &&
      isInt32(item.incidentCount) && item.incidentCount >= 0);
}

function isOccReviewDetailResponse(
  value: unknown, operationId: string,
): value is OccReviewDetailResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["operationId", "submissionId", "revisionNumber", "status",
      "operationCode", "operationDate", "stationId", "stationCode", "ianaTimeZone",
      "airlineName", "agentName", "plannedStartAt", "plannedEndAt", "actualStartAt",
      "actualEndAt", "submittedAt", "agentNote", "checklistStatus", "checklistAnswers",
      "services", "incidents", "decision", "reviewVersion"]) &&
    isUuid(value.operationId) && value.operationId.toLowerCase() === operationId &&
    isUuid(value.submissionId) && isInt32(value.revisionNumber) && value.revisionNumber > 0 &&
    isOneOf(value.status, occReviewStatuses) && isNonEmptyString(value.operationCode) &&
    isDateOnly(value.operationDate) && isUuid(value.stationId) &&
    isNonEmptyString(value.stationCode) && isNonEmptyString(value.ianaTimeZone) &&
    isNonEmptyString(value.airlineName) && isNonEmptyString(value.agentName) &&
    isOptionalNullable(value.plannedStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.plannedEndAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.actualEndAt, isDateTimeOffset) &&
    isDateTimeOffset(value.submittedAt) &&
    isOptionalNullable(value.agentNote, (note) => typeof note === "string" && note.length <= 2000) &&
    value.checklistStatus === "Submitted" &&
    Array.isArray(value.checklistAnswers) && value.checklistAnswers.every((answer: unknown) =>
      isRecord(answer) && hasOnlyKeys(answer, ["section", "code", "label", "value", "note"]) &&
      isNonEmptyString(answer.section) && isNonEmptyString(answer.code) &&
      isNonEmptyString(answer.label) && isOneOf(answer.value, ["Ok", "NotOk", "NotApplicable"] as const) &&
      isOptionalNullable(answer.note, (note) => typeof note === "string" && note.length <= 1000)) &&
    Array.isArray(value.services) && value.services.every((service: unknown) =>
      isRecord(service) && hasOnlyKeys(service, ["id", "code", "name", "status",
        "contractedQuantity", "executedQuantity", "unit"]) &&
      isUuid(service.id) && isNonEmptyString(service.code) && isNonEmptyString(service.name) &&
      isOneOf(service.status, ["Planned", "InProgress", "Completed", "NotPerformed", "Exception"] as const) &&
      isFiniteNumber(service.contractedQuantity) && isFiniteNumber(service.executedQuantity) &&
      isNonEmptyString(service.unit)) &&
    Array.isArray(value.incidents) && value.incidents.every((incident: unknown) =>
      isRecord(incident) && hasOnlyKeys(incident, ["id", "type", "severity", "status",
        "description", "occurredAt"]) && isUuid(incident.id) &&
      isNonEmptyString(incident.type) &&
      isOneOf(incident.severity, ["Low", "Medium", "High", "Critical"] as const) &&
      isOneOf(incident.status, ["Open", "InReview", "Resolved", "Closed"] as const) &&
      isNonEmptyString(incident.description) && isDateTimeOffset(incident.occurredAt)) &&
    isOptionalNullable(value.decision, (decision) => isRecord(decision) &&
      hasOnlyKeys(decision, ["outcome", "reason", "decidedAt"]) &&
      isOneOf(decision.outcome, ["Approved", "Returned"] as const) &&
      isOptionalNullable(decision.reason, (reason) => typeof reason === "string" && reason.length <= 2000) &&
      isDateTimeOffset(decision.decidedAt)) &&
    isStrongEtag(value.reviewVersion);
}

function validatedOccReviewDecisionRequest(request: DecideOccReviewRequest): DecideOccReviewRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, ["submissionId", "outcome", "reason"]) ||
      !isUuid(request.submissionId) ||
      !isOneOf(request.outcome, ["Approved", "Returned"] as const)) {
    throw new TypeError("OCC review decision is invalid.");
  }
  if (request.outcome === "Approved") {
    if (request.reason !== undefined && request.reason !== null && request.reason.trim()) {
      throw new TypeError("Approval cannot carry a correction reason.");
    }
    return { submissionId: request.submissionId.toLowerCase(), outcome: "Approved" };
  }
  if (typeof request.reason !== "string" || request.reason.trim().length < 8 ||
      request.reason.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.reason)) {
    throw new TypeError("A correction reason is required.");
  }
  return { submissionId: request.submissionId.toLowerCase(),
    outcome: "Returned", reason: request.reason.trim() };
}

function isOccReviewDecisionResponse(
  value: unknown, operationId: string, request: DecideOccReviewRequest,
): value is DecideOccReviewResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["operationId", "submissionId", "status", "outcome", "decidedAt", "reason"]) &&
    isUuid(value.operationId) && value.operationId.toLowerCase() === operationId &&
    isUuid(value.submissionId) && value.submissionId.toLowerCase() === request.submissionId &&
    value.status === request.outcome && value.outcome === request.outcome &&
    isDateTimeOffset(value.decidedAt) &&
    (value.reason ?? null) === (request.reason ?? null);
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

function isAirlinePortalBootstrapResponse(
  value: unknown,
): value is AirlinePortalBootstrapResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["airlineId", "organizationId", "iataCode", "icaoCode", "name", "stations", "currentOperations"]) &&
    isUuid(value.airlineId) && isUuid(value.organizationId) &&
    isNonEmptyString(value.iataCode) && isNonEmptyString(value.icaoCode) &&
    isNonEmptyString(value.name) && Array.isArray(value.stations) &&
    value.stations.every((station) => isRecord(station) &&
      hasOnlyKeys(station, ["id", "code", "name", "ianaTimeZone"]) &&
      isUuid(station.id) && isNonEmptyString(station.code) &&
      isNonEmptyString(station.name) && isNonEmptyString(station.ianaTimeZone)) &&
    Array.isArray(value.currentOperations) &&
    value.currentOperations.length <= 50 &&
    value.currentOperations.every((operation) => isRecord(operation) &&
      hasOnlyKeys(operation, ["id", "code", "stationId", "stationCode", "operationDate",
        "status", "arrivalFlightNumber", "departureFlightNumber", "plannedStartAt", "plannedEndAt"]) &&
      isUuid(operation.id) && isNonEmptyString(operation.code) &&
      isUuid(operation.stationId) && isNonEmptyString(operation.stationCode) &&
      (value.stations as unknown[]).some((station) => isRecord(station) &&
        station.id === operation.stationId && station.code === operation.stationCode) &&
      isDateOnly(operation.operationDate) && isNonEmptyString(operation.status) &&
      isOptionalNullable(operation.arrivalFlightNumber, isNonEmptyString) &&
      isOptionalNullable(operation.departureFlightNumber, isNonEmptyString) &&
      isOptionalNullable(operation.plannedStartAt, isDateTimeOffset) &&
      isOptionalNullable(operation.plannedEndAt, isDateTimeOffset));
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

function validatedChangePasswordRequest(request: ChangePasswordRequest): ChangePasswordRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["email", "currentPassword", "newPassword"]) ||
    !isNonEmptyString(request.email) ||
    request.email.length > 256 ||
    !isNonEmptyString(request.currentPassword) ||
    request.currentPassword.length > 256 ||
    !isNonEmptyString(request.newPassword) ||
    request.newPassword.length > 256
  ) {
    throw new TypeError("Password change request is invalid.");
  }

  return request as unknown as ChangePasswordRequest;
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

function validatedOptionalDeviceText(
  value: unknown,
  field: string,
  maximumLength: number,
) {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${field} is not a valid mobile device value.`);
  }
  return value;
}

function validatedMobileDeviceRequest(
  request: RegisterMobileDeviceRequest,
): RegisterMobileDeviceRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, [
      "installationId",
      "platform",
      "appVersion",
      "deviceName",
      "operatingSystemVersion",
    ]) ||
    !isUuid(request.installationId) ||
    (request.platform !== "Android" && request.platform !== "Ios") ||
    typeof request.appVersion !== "string" ||
    request.appVersion.length === 0 ||
    request.appVersion.length > 32 ||
    request.appVersion.trim() !== request.appVersion ||
    /[\u0000-\u001f\u007f]/.test(request.appVersion)
  ) {
    throw new TypeError("Mobile device registration is invalid.");
  }

  const deviceName = validatedOptionalDeviceText(
    request.deviceName,
    "deviceName",
    120,
  );
  const operatingSystemVersion = validatedOptionalDeviceText(
    request.operatingSystemVersion,
    "operatingSystemVersion",
    64,
  );
  return {
    installationId: request.installationId,
    platform: request.platform,
    appVersion: request.appVersion,
    ...(deviceName === undefined ? {} : { deviceName }),
    ...(operatingSystemVersion === undefined
      ? {}
      : { operatingSystemVersion }),
  };
}

function validatedChecklistSubmissionRequest(
  request: SubmitRampOperationChecklistRequest,
): SubmitRampOperationChecklistRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["checklistId", "answers"]) ||
    !isUuid(request.checklistId) ||
    !Array.isArray(request.answers) ||
    request.answers.length < 1 ||
    request.answers.length > 256
  ) {
    throw new TypeError("Ramp checklist submission is invalid.");
  }

  const itemIds = new Set<string>();
  const answers = request.answers.map((answer) => {
    if (
      !isRecord(answer) ||
      !hasOnlyKeys(answer, ["itemId", "value", "note"]) ||
      !isUuid(answer.itemId) ||
      !isOneOf(answer.value, rampChecklistAnswerValues) ||
      !isOptionalNullable(
        answer.note,
        (note) => typeof note === "string" && note.length <= 1_000,
      )
    ) {
      throw new TypeError("Ramp checklist submission is invalid.");
    }

    const itemId = answer.itemId.toLowerCase();
    if (itemIds.has(itemId)) {
      throw new TypeError("Ramp checklist submission contains duplicate items.");
    }
    itemIds.add(itemId);

    return {
      itemId,
      value: answer.value,
      ...(answer.note === undefined ? {} : { note: answer.note }),
    };
  });

  return { checklistId: request.checklistId.toLowerCase(), answers };
}

function hasAtMostFourDecimalPlaces(value: number) {
  const [coefficient = "", exponentText] = value
    .toString()
    .toLowerCase()
    .split("e");
  const decimalPlaces = coefficient.includes(".")
    ? coefficient.length - coefficient.indexOf(".") - 1
    : 0;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  return Number.isInteger(exponent) && Math.max(0, decimalPlaces - exponent) <= 4;
}

function validatedServiceTransitionRequest(
  request: TransitionRampOperationServiceRequest,
): TransitionRampOperationServiceRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["targetStatus", "executedQuantity", "note"]) ||
    !isOneOf(request.targetStatus, rampServiceTargetStatuses) ||
    !isOptionalNullable(
      request.note,
      (note) => typeof note === "string" && note.length <= 1_000,
    )
  ) {
    throw new TypeError("Ramp service transition is invalid.");
  }

  const quantity = request.executedQuantity;
  if (request.targetStatus === "InProgress") {
    if (quantity !== undefined && quantity !== null) {
      throw new TypeError("InProgress service transitions cannot set a quantity.");
    }
  } else if (
    !isFiniteNumber(quantity) ||
    quantity < 0 ||
    quantity >= maximumExecutedQuantityExclusive ||
    !hasAtMostFourDecimalPlaces(quantity)
  ) {
    throw new TypeError("Terminal service transitions require a valid quantity.");
  }

  if (
    request.targetStatus === "NotPerformed" &&
    (quantity !== 0 ||
      typeof request.note !== "string" ||
      request.note.trim().length === 0)
  ) {
    throw new TypeError("NotPerformed service transitions require a zero quantity and note.");
  }
  if (
    request.targetStatus === "Exception" &&
    (typeof request.note !== "string" || request.note.trim().length === 0)
  ) {
    throw new TypeError("Exception service transitions require a note.");
  }

  return {
    targetStatus: request.targetStatus,
    ...(quantity === undefined ? {} : { executedQuantity: quantity }),
    ...(request.note === undefined ? {} : { note: request.note }),
  };
}

function validatedIncidentReportRequest(
  request: ReportRampIncidentRequest,
): ReportRampIncidentRequest {
  if (
    !isRecord(request) ||
    !hasOnlyKeys(request, ["incidentType", "severity", "description", "occurredAt"]) ||
    !isOneOf(request.incidentType, rampIncidentTypes) ||
    !isOneOf(request.severity, rampIncidentSeverities) ||
    typeof request.description !== "string" ||
    request.description.length > 2_000 ||
    request.description.trim().length < 8 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.description) ||
    !isDateTimeOffset(request.occurredAt)
  ) throw new TypeError("Ramp incident report is invalid.");

  return {
    incidentType: request.incidentType,
    severity: request.severity,
    description: request.description.trim(),
    occurredAt: request.occurredAt,
  };
}

function validatedRampOperationSubmissionRequest(
  request: SubmitRampOperationRequest,
): SubmitRampOperationRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, ["agentNote"])) {
    throw new TypeError("Ramp operation submission is invalid.");
  }
  if (request.agentNote === null || request.agentNote === undefined) return {};
  if (
    typeof request.agentNote !== "string" ||
    request.agentNote.length > 2_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.agentNote)
  ) throw new TypeError("Ramp operation note is invalid.");
  const note = request.agentNote.trim();
  return note.length > 0 ? { agentNote: note } : {};
}

function validatedUuid(value: string, field: string) {
  if (!isUuid(value)) {
    throw new TypeError(`${field} must be a non-empty canonical UUID.`);
  }
  return value.toLowerCase();
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
        code: metadata.code,
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
    async getAccountChanges(
      parameters?: GetAccountChangesParams,
      options?: GetAccountChangesOptions,
    ) {
      if (parameters !== undefined &&
          (!isRecord(parameters) || !hasOnlyKeys(parameters, ["after", "limit"])))
        throw new TypeError("Change feed parameters are invalid.");
      const after = parameters?.after;
      const limit = parameters?.limit ?? 50;
      if (after !== undefined && !isChangeCursor(after))
        throw new TypeError("Change feed cursor is invalid.");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new TypeError("Change feed limit must be an integer from 1 to 100.");
      const result = await execute(getGetAccountChangesUrl(parameters),
        { ...options, method: "GET" }, true);
      if (!isAccountChangeListResponse(result.data, after, limit))
        throw malformedResponse(result.status);
      return result.data;
    },
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
    async changePassword(request: ChangePasswordRequest, options?: ChangePasswordOptions) {
      const body = validatedChangePasswordRequest(request);
      const result = await execute(
        getChangePasswordUrl(),
        {
          ...options,
          method: "POST",
          headers: {
            ...Object.fromEntries(headersFrom(options?.headers, "Request headers")),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
        false,
      );
      if (result.status !== 204 || result.data !== undefined) {
        throw malformedResponse(result.status);
      }
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
    async getAirlinePortalBootstrap(options?: GetAirlinePortalBootstrapOptions) {
      const result = await execute(
        getGetAirlinePortalBootstrapUrl(),
        { ...options, method: "GET" },
        true,
      );
      if (!isAirlinePortalBootstrapResponse(result.data)) {
        throw malformedResponse(result.status);
      }
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
    async getOccReviewQueue(stationId: string, options?: GetOccReviewOptions) {
      const station = validatedUuid(stationId, "stationId");
      const result = await execute(
        getGetOccReviewQueueUrl({ stationId: station }),
        { ...options, method: "GET" }, true);
      if (!isOccReviewQueueResponse(result.data, station)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOccReviewDetail(operationId: string, options?: GetOccReviewOptions) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(
        getGetOccReviewDetailUrl(operation), { ...options, method: "GET" }, true);
      if (!isOccReviewDetailResponse(result.data, operation) ||
          result.data.reviewVersion !== result.etag) throw malformedResponse(result.status);
      return result.data;
    },
    async getOccReviewSubmissionDetail(
      operationId: string, submissionId: string, options?: GetOccReviewOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const submission = validatedUuid(submissionId, "submissionId");
      const result = await execute(
        getGetOccReviewSubmissionDetailUrl(operation, submission),
        { ...options, method: "GET" }, true);
      if (!isOccReviewDetailResponse(result.data, operation) ||
          result.data.submissionId.toLowerCase() !== submission)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getOccReviewSubmissionHistory(
      operationId: string, options?: GetOccReviewOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(
        getGetOccReviewSubmissionHistoryUrl(operation),
        { ...options, method: "GET" }, true);
      if (!isOccReviewSubmissionHistoryResponse(result.data, operation))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getOperationalConversations(
      stationId?: string, options?: GetOperationalCommunicationOptions,
    ) {
      const station = stationId === undefined ? undefined : validatedUuid(stationId, "stationId");
      const result = await execute(getGetOperationalConversationsUrl(
        station ? { stationId: station } : undefined,
      ), { ...options, method: "GET" }, true);
      if (!isOperationConversationListResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOperationalMessages(
      operationId: string, options?: GetOperationalCommunicationOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(getGetOperationalMessagesUrl(operation),
        { ...options, method: "GET" }, true);
      if (!isOperationMessageListResponse(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    async sendOperationalMessage(
      operationId: string, request: SendOperationMessageRequest,
      idempotencyKey: string, installationId?: string,
      options?: GetOperationalCommunicationOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const key = validatedUuid(idempotencyKey, "idempotencyKey");
      if (!isRecord(request) || !hasOnlyKeys(request, ["content"]) ||
          typeof request.content !== "string" || request.content.trim().length === 0 ||
          request.content.length > 2_000 ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.content))
        throw new TypeError("Operational message is invalid.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", key);
      if (installationId !== undefined) headers.set("x-elevant-installation-id",
        validatedUuid(installationId, "installationId"));
      const result = await execute(getSendOperationalMessageUrl(operation),
        { ...options, method: "POST", headers, body: JSON.stringify({ content: request.content.trim() }) }, true);
      if (!isOperationMessageResponse(result.data, operation)) throw malformedResponse(result.status);
      return result.data;
    },
    async getOperationalNotifications(options?: GetOperationalCommunicationOptions) {
      const result = await execute(getGetOperationalNotificationsUrl(),
        { ...options, method: "GET" }, true);
      if (!isOperationalNotificationListResponse(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async setOperationalNotificationRead(
      notificationId: string, read: boolean,
      options?: GetOperationalCommunicationOptions,
    ) {
      const notification = validatedUuid(notificationId, "notificationId");
      if (typeof read !== "boolean") throw new TypeError("read must be a boolean.");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getSetOperationalNotificationReadUrl(notification),
        { ...options, method: "PUT", headers, body: JSON.stringify({ read }) }, true);
      if (!isOperationalNotificationResponse(result.data) || result.data.id.toLowerCase() !== notification ||
          (read && result.data.readAt == null) || (!read && result.data.readAt != null))
        throw malformedResponse(result.status);
      return result.data;
    },
    async decideOccReview(
      operationId: string,
      request: DecideOccReviewRequest,
      etag: string,
      options?: DecideOccReviewOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const decision = validatedOccReviewDecisionRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("if-match", validatedStrongEtag(etag));
      const result = await execute(getDecideOccReviewUrl(operation),
        { ...options, method: "POST", headers, body: JSON.stringify(decision) }, true);
      if (!isOccReviewDecisionResponse(result.data, operation, decision))
        throw malformedResponse(result.status);
      return result.data;
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
    async getRampAssignedOperations(options?: GetRampAssignedOperationsOptions) {
      const result = await execute(
        getGetRampAssignedOperationsUrl(),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isRampAssignedOperationsResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async registerMobileDevice(
      request: RegisterMobileDeviceRequest,
      options?: RegisterMobileDeviceOptions,
    ) {
      const registration = validatedMobileDeviceRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(
        getRegisterMobileDeviceUrl(),
        {
          ...options,
          method: "PUT",
          headers,
          body: JSON.stringify(registration),
        },
        true,
      );
      if (!isRegisterMobileDeviceResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async startRampOperation(
      operationId: string,
      installationId: string,
      idempotencyKey: string,
      options?: StartRampOperationOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getStartRampOperationUrl(operation),
        {
          ...options,
          method: "POST",
          headers,
        },
        true,
      );
      if (!isRampOperationStartResponse(result.data)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getRampOperationChecklist(
      operationId: string,
      options?: GetRampOperationChecklistOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(
        getGetRampOperationChecklistUrl(operation),
        {
          ...options,
          method: "GET",
        },
        true,
      );
      if (!isGetRampOperationChecklistResponse(result.data, operation)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async getRampIncidents(
      operationId: string,
      options?: GetRampIncidentsOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const result = await execute(
        getGetRampIncidentsUrl(operation),
        { ...options, method: "GET" },
        true,
      );
      if (!isGetRampIncidentsResponse(result.data, operation)) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async reportRampIncident(
      operationId: string,
      request: ReportRampIncidentRequest,
      installationId: string,
      idempotencyKey: string,
      options?: ReportRampIncidentOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const report = validatedIncidentReportRequest(request);
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getReportRampIncidentUrl(operation),
        { ...options, method: "POST", headers, body: JSON.stringify(report) },
        true,
      );
      if (!isRampIncidentReceiptResponse(
        result.data, operation, commandKey, report.occurredAt,
      )) throw malformedResponse(result.status);
      return result.data;
    },
    async submitRampOperation(
      operationId: string,
      request: SubmitRampOperationRequest,
      installationId: string,
      idempotencyKey: string,
      options?: SubmitRampOperationOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const submission = validatedRampOperationSubmissionRequest(request);
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getSubmitRampOperationUrl(operation),
        { ...options, method: "POST", headers, body: JSON.stringify(submission) },
        true,
      );
      if (!isRampOperationSubmissionResponse(
        result.data, operation, commandKey, submission.agentNote ?? null,
      )) throw malformedResponse(result.status);
      return result.data;
    },
    async reopenRampOperationCorrection(
      operationId: string, installationId: string,
      idempotencyKey: string, options?: ReopenRampOperationCorrectionOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(getReopenRampOperationCorrectionUrl(operation),
        { ...options, method: "POST", headers }, true);
      if (!isRampOperationCorrectionResponse(result.data, operation, commandKey))
        throw malformedResponse(result.status);
      return result.data;
    },
    async submitRampOperationChecklist(
      operationId: string,
      request: SubmitRampOperationChecklistRequest,
      installationId: string,
      idempotencyKey: string,
      options?: SubmitRampOperationChecklistOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const submission = validatedChecklistSubmissionRequest(request);
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getSubmitRampOperationChecklistUrl(operation),
        {
          ...options,
          method: "POST",
          headers,
          body: JSON.stringify(submission),
        },
        true,
      );
      if (
        !isRampChecklistSubmissionResponse(
          result.data,
          submission.checklistId,
          submission.answers.length,
        )
      ) {
        throw malformedResponse(result.status);
      }
      return result.data;
    },
    async transitionRampOperationService(
      operationId: string,
      serviceId: string,
      request: TransitionRampOperationServiceRequest,
      installationId: string,
      idempotencyKey: string,
      options?: TransitionRampOperationServiceOptions,
    ) {
      const operation = validatedUuid(operationId, "operationId");
      const service = validatedUuid(serviceId, "serviceId");
      const transition = validatedServiceTransitionRequest(request);
      const installation = validatedUuid(installationId, "installationId");
      const commandKey = validatedUuid(idempotencyKey, "idempotencyKey");
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      headers.set("x-elevant-installation-id", installation);
      headers.set("idempotency-key", commandKey);
      const result = await execute(
        getTransitionRampOperationServiceUrl(operation, service),
        {
          ...options,
          method: "POST",
          headers,
          body: JSON.stringify(transition),
        },
        true,
      );
      if (
        !isRampOperationServiceTransitionResponse(
          result.data,
          service,
          transition.targetStatus,
        )
      ) {
        throw malformedResponse(result.status);
      }
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
