import {
  getGetAccountChangesUrl,
  getGetAirlineContractsUrl,
  getGetAirlineOperationsUrl,
  getGetAirlineOperationUrl,
  getGetAirlineOperationalRequestsUrl,
  getGetAirlinePreinvoicesUrl,
  getGetPublicCommercialCatalogUrl,
  getSubmitCommercialRequestUrl,
  getGetFinanceApprovedServicesUrl,
  getCreatePreinvoiceDraftUrl,
  getGetPreinvoiceDraftUrl,
  getGetAirlinePortalBootstrapUrl,
  getAssignOccPlanningOperationUrl,
  getCreateSessionUrl,
  getChangePasswordUrl,
  getGetCurrentSessionUrl,
  getGetOccPlanningOptionsUrl,
  getGetOccPlanningSnapshotUrl,
  getGetManualTurnaroundOptionsUrl,
  getCreateManualTurnaroundUrl,
  getProgramOccShiftUrl,
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
  type AirlineContractPageResponse,
  type AirlineOperationPageResponse,
  type AirlinePortalOperationResponse,
  type AirlineOperationalRequestPageResponse,
  type AirlinePreinvoicePageResponse,
  type PublicCommercialCatalog,
  type SubmitCommercialRequestRequest,
  type SubmitCommercialRequestResponse,
  type FinanceApprovedServicesResponse,
  type CreatePreinvoiceDraftRequest,
  type CreatePreinvoiceDraftResponse,
  type PreinvoiceDraftResponse,
  type GetAirlineContractsParams,
  type GetAirlineOperationsParams,
  type GetAirlineOperationalRequestsParams,
  type GetAirlinePreinvoicesParams,
  type GetAccountChangesParams,
  type AirlinePortalBootstrapResponse,
  type CreateSessionRequest,
  type ChangePasswordRequest,
  type CurrentSessionResponse,
  type GetRampOperationChecklistResponse,
  type GetRampIncidentsResponse,
  type GetOccPlanningOptionsParams,
  type GetOccPlanningSnapshotParams,
  type GetManualTurnaroundOptionsParams,
  type CreateManualTurnaroundRequest,
  type ManualTurnaroundOptionsResponse,
  type ManualTurnaroundResponse,
  type ProgramOccShiftRequest,
  type ProgramOccShiftResponse,
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
export type GetAirlineContractsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlineOperationsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlineOperationOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlineOperationalRequestsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetAirlinePreinvoicesOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetPublicCommercialCatalogOptions = Omit<ElevantRequestInit, "body" | "method">;
export type SubmitCommercialRequestOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetFinanceApprovedServicesOptions = Omit<ElevantRequestInit, "body" | "method">;
export type CreatePreinvoiceDraftOptions = Omit<ElevantRequestInit, "body" | "method">;
export type GetPreinvoiceDraftOptions = Omit<ElevantRequestInit, "body" | "method">;
export interface FinanceApprovedServicesQuery {
  readonly stationId: string;
  readonly from: string;
  readonly to: string;
}
export type GetOccPlanningSnapshotOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetOccPlanningOptionsOptions = Omit<
  ElevantRequestInit,
  "body" | "method"
>;
export type GetManualTurnaroundOptionsOptions = Omit<ElevantRequestInit, "body" | "method">;
export type CreateManualTurnaroundOptions = Omit<ElevantRequestInit, "body" | "method">;
export type ProgramOccShiftOptions = Omit<ElevantRequestInit, "body" | "method">;
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
  getAirlineContracts(
    parameters?: GetAirlineContractsParams,
    options?: GetAirlineContractsOptions,
  ): Promise<AirlineContractPageResponse>;
  getAirlineOperations(
    parameters?: GetAirlineOperationsParams,
    options?: GetAirlineOperationsOptions,
  ): Promise<AirlineOperationPageResponse>;
  getAirlineOperation(
    operationId: string,
    options?: GetAirlineOperationOptions,
  ): Promise<AirlinePortalOperationResponse>;
  getAirlineOperationalRequests(
    parameters?: GetAirlineOperationalRequestsParams,
    options?: GetAirlineOperationalRequestsOptions,
  ): Promise<AirlineOperationalRequestPageResponse>;
  getAirlinePreinvoices(
    parameters?: GetAirlinePreinvoicesParams,
    options?: GetAirlinePreinvoicesOptions,
  ): Promise<AirlinePreinvoicePageResponse>;
  getPublicCommercialCatalog(
    options?: GetPublicCommercialCatalogOptions,
  ): Promise<PublicCommercialCatalog>;
  submitCommercialRequest(
    request: SubmitCommercialRequestRequest,
    options?: SubmitCommercialRequestOptions,
  ): Promise<SubmitCommercialRequestResponse>;
  getFinanceApprovedServices(
    query: FinanceApprovedServicesQuery,
    options?: GetFinanceApprovedServicesOptions,
  ): Promise<FinanceApprovedServicesResponse>;
  createPreinvoiceDraft(
    request: CreatePreinvoiceDraftRequest,
    options?: CreatePreinvoiceDraftOptions,
  ): Promise<CreatePreinvoiceDraftResponse>;
  getPreinvoiceDraft(
    draftId: string, expectedStationId: string,
    options?: GetPreinvoiceDraftOptions,
  ): Promise<PreinvoiceDraftResponse>;
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
  getManualTurnaroundOptions(
    parameters: GetManualTurnaroundOptionsParams,
    options?: GetManualTurnaroundOptionsOptions,
  ): Promise<ManualTurnaroundOptionsResponse>;
  createManualTurnaround(
    request: CreateManualTurnaroundRequest,
    options?: CreateManualTurnaroundOptions,
  ): Promise<ManualTurnaroundResponse>;
  programOccShift(
    turnaroundId: string,
    request: ProgramOccShiftRequest,
    options?: ProgramOccShiftOptions,
  ): Promise<ProgramOccShiftResponse>;
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

function isManualTurnaroundOptionsResponse(
  value: unknown,
): value is ManualTurnaroundOptionsResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["station", "date", "stationAirport", "airlines", "airports", "stands"]) &&
    isOccStationResponse(value.station) && isDateOnly(value.date) &&
    isOccAirportResponse(value.stationAirport) &&
    Array.isArray(value.airlines) && value.airlines.every((airline: unknown) =>
      isRecord(airline) && hasOnlyKeys(airline, ["id", "iataCode", "name"]) &&
      isUuid(airline.id) && isString(airline.iataCode) && isString(airline.name)) &&
    Array.isArray(value.airports) && value.airports.every(isOccAirportResponse) &&
    Array.isArray(value.stands) && value.stands.every(isOccStandResponse);
}

function isManualTurnaroundResponse(value: unknown): value is ManualTurnaroundResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["turnaroundId", "operationCode", "replayed"]) &&
    isUuid(value.turnaroundId) && isNonEmptyString(value.operationCode) &&
    typeof value.replayed === "boolean";
}

function isProgramOccShiftResponse(value: unknown): value is ProgramOccShiftResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["turnaroundId", "shiftId", "replayed"]) &&
    isUuid(value.turnaroundId) && isUuid(value.shiftId) &&
    typeof value.replayed === "boolean";
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

function isAirlineContractPageResponse(value: unknown): value is AirlineContractPageResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["page", "limit", "hasMore", "contracts"]) &&
    isInt32(value.page) && value.page >= 1 &&
    isInt32(value.limit) && value.limit >= 1 && value.limit <= 50 &&
    typeof value.hasMore === "boolean" &&
    Array.isArray(value.contracts) && value.contracts.length <= value.limit &&
    value.contracts.every((contract) => isRecord(contract) &&
      hasOnlyKeys(contract, ["id", "code", "status", "signedOn", "terminatedOn", "approvedVersions"]) &&
      isUuid(contract.id) && isNonEmptyString(contract.code) &&
      ["Draft", "Active", "Suspended", "Terminated", "Expired"].includes(String(contract.status)) &&
      isOptionalNullable(contract.signedOn, isDateOnly) &&
      isOptionalNullable(contract.terminatedOn, isDateOnly) &&
      Array.isArray(contract.approvedVersions) && contract.approvedVersions.length > 0 &&
      contract.approvedVersions.every((version) => isRecord(version) &&
        hasOnlyKeys(version, ["id", "versionNumber", "validFrom", "validTo", "currencyCode", "stations", "rates"]) &&
        isUuid(version.id) && isInt32(version.versionNumber) && version.versionNumber > 0 &&
        isDateOnly(version.validFrom) && isOptionalNullable(version.validTo, isDateOnly) &&
        typeof version.currencyCode === "string" && /^[A-Z]{3}$/.test(version.currencyCode) &&
        Array.isArray(version.stations) && version.stations.every((station) =>
          isRecord(station) && hasOnlyKeys(station, ["id", "code", "name"]) &&
          isUuid(station.id) && isNonEmptyString(station.code) && isNonEmptyString(station.name)) &&
        Array.isArray(version.rates) && version.rates.every((rate) =>
          isRecord(rate) && hasOnlyKeys(rate, ["id", "serviceCode", "serviceName", "billingUnit",
            "unitPrice", "minimumQuantity"]) &&
          isUuid(rate.id) && isNonEmptyString(rate.serviceCode) &&
          isNonEmptyString(rate.serviceName) && isNonEmptyString(rate.billingUnit) &&
          isFiniteNumber(rate.unitPrice) && rate.unitPrice >= 0 &&
          isFiniteNumber(rate.minimumQuantity) && rate.minimumQuantity >= 0)));
}

function isAirlineOperationDetailResponse(value: unknown): value is AirlinePortalOperationResponse {
  return isRecord(value) && hasOnlyKeys(value,
    ["id", "code", "stationId", "stationCode", "operationDate", "status",
      "arrivalFlightNumber", "departureFlightNumber", "plannedStartAt", "plannedEndAt"]) &&
    isUuid(value.id) && isNonEmptyString(value.code) && isUuid(value.stationId) &&
    isNonEmptyString(value.stationCode) && isDateOnly(value.operationDate) &&
    ["Planned", "Assigned", "InProgress", "PendingReview", "InReview",
      "Approved", "Returned", "Cancelled"].includes(String(value.status)) &&
    isOptionalNullable(value.arrivalFlightNumber, isNonEmptyString) &&
    isOptionalNullable(value.departureFlightNumber, isNonEmptyString) &&
    isOptionalNullable(value.plannedStartAt, isDateTimeOffset) &&
    isOptionalNullable(value.plannedEndAt, isDateTimeOffset);
}

function isAirlineOperationPageResponse(value: unknown): value is AirlineOperationPageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["page", "limit", "hasMore", "operations"]) ||
      !isInt32(value.page) || value.page < 1 || !isInt32(value.limit) ||
      value.limit < 1 || value.limit > 50 || typeof value.hasMore !== "boolean" ||
      !Array.isArray(value.operations) || value.operations.length > value.limit ||
      (value.hasMore && value.operations.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.operations.every((operation) => {
    if (!isAirlineOperationDetailResponse(operation) || ids.has(operation.id)) return false;
    ids.add(operation.id);
    return true;
  });
}

function isAirlineOperationalRequestPageResponse(
  value: unknown,
): value is AirlineOperationalRequestPageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["page", "limit", "hasMore", "requests"]) ||
      !isInt32(value.page) || value.page < 1 || !isInt32(value.limit) ||
      value.limit < 1 || value.limit > 50 || typeof value.hasMore !== "boolean" ||
      !Array.isArray(value.requests) || value.requests.length > value.limit ||
      (value.hasMore && value.requests.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.requests.every(request => {
    if (!isRecord(request) || !hasOnlyKeys(request,
      ["id", "stationId", "stationCode", "serviceName", "description", "status",
        "requestedAt", "neededAt", "operationId", "operationCode", "resolvedAt"]) ||
        !isUuid(request.id) || ids.has(request.id) ||
        !isUuid(request.stationId) || !isNonEmptyString(request.stationCode) ||
        !isNonEmptyString(request.serviceName) || typeof request.description !== "string" ||
        !["Submitted", "InReview", "Accepted", "Rejected", "Completed", "Cancelled"]
          .includes(String(request.status)) ||
        !isDateTimeOffset(request.requestedAt) ||
        !isOptionalNullable(request.neededAt, isDateTimeOffset) ||
        !isOptionalNullable(request.operationId, isUuid) ||
        !isOptionalNullable(request.operationCode, isNonEmptyString) ||
        !isOptionalNullable(request.resolvedAt, isDateTimeOffset) ||
        Boolean(request.operationId) !== Boolean(request.operationCode)) return false;
    ids.add(request.id);
    return true;
  });
}

function isAirlinePreinvoicePageResponse(
  value: unknown,
): value is AirlinePreinvoicePageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["page", "limit", "hasMore", "preinvoices"]) ||
      !isInt32(value.page) || value.page < 1 || !isInt32(value.limit) ||
      value.limit < 1 || value.limit > 50 || typeof value.hasMore !== "boolean" ||
      !Array.isArray(value.preinvoices) || value.preinvoices.length > value.limit ||
      (value.hasMore && value.preinvoices.length !== value.limit)) return false;
  const ids = new Set<string>();
  return value.preinvoices.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item,
      ["id", "stationId", "stationCode", "from", "to", "currencyCode", "total",
        "status", "createdAt"]) || !isUuid(item.id) || ids.has(item.id) ||
        !isUuid(item.stationId) || !isNonEmptyString(item.stationCode) ||
        !isDateOnly(item.from) || !isDateOnly(item.to) || item.from > item.to ||
        typeof item.currencyCode !== "string" || !/^[A-Z]{3}$/.test(item.currencyCode) ||
        !isFiniteNumber(item.total) || item.total < 0 ||
        !["Submitted", "Disputed", "Accepted", "Invoiced"].includes(String(item.status)) ||
        !isDateTimeOffset(item.createdAt)) return false;
    ids.add(item.id);
    return true;
  });
}

function isPublicCommercialCatalog(value: unknown): value is PublicCommercialCatalog {
  if (!isRecord(value) || !hasOnlyKeys(value, ["services", "airlines"]) ||
      !Array.isArray(value.services) || !Array.isArray(value.airlines)) return false;
  const services = value.services.every((item: unknown) => isRecord(item) &&
    hasOnlyKeys(item, ["id", "name", "description", "imageUrl", "videoUrl", "displayOrder"]) &&
    isUuid(item.id) && isNonEmptyString(item.name) && isString(item.description) &&
    isOptionalNullable(item.imageUrl, isString) &&
    isOptionalNullable(item.videoUrl, isString) && isInt32(item.displayOrder));
  const airlines = value.airlines.every((item: unknown) => isRecord(item) &&
    hasOnlyKeys(item, ["id", "name", "region", "legalName", "countryCode",
      "iataCode", "icaoCode", "logoUrl", "isVerified"]) &&
    isUuid(item.id) && isNonEmptyString(item.name) && isNonEmptyString(item.region) &&
    isOptionalNullable(item.legalName, isString) &&
    isOptionalNullable(item.countryCode, isString) &&
    isOptionalNullable(item.iataCode, isString) &&
    isOptionalNullable(item.icaoCode, isString) &&
    isOptionalNullable(item.logoUrl, isString) && typeof item.isVerified === "boolean");
  return services && airlines &&
    new Set(value.services.map(item => item.id.toLowerCase())).size === value.services.length &&
    new Set(value.airlines.map(item => item.id.toLowerCase())).size === value.airlines.length;
}

function validatedCommercialRequest(
  request: SubmitCommercialRequestRequest,
): SubmitCommercialRequestRequest {
  if (!isRecord(request) || !hasOnlyKeys(request, ["requestId", "airlineProfileId",
    "serviceIds", "representativeName", "representativeTitle",
    "representativeEmail", "representativePhone", "authorityDeclared",
    "representativeNationalityCode", "representativeAddress", "representativeCountry",
    "representativeProvince", "representativeMunicipality",
    "representativeDocumentType", "representativeDocumentNumber"]) ||
    !isUuid(request.requestId) || !isUuid(request.airlineProfileId) ||
    !Array.isArray(request.serviceIds) || request.serviceIds.length < 1 ||
    request.serviceIds.length > 20 || !request.serviceIds.every(isUuid) ||
    new Set(request.serviceIds.map(id => id.toLowerCase())).size !== request.serviceIds.length ||
    !isNonEmptyString(request.representativeName) || request.representativeName.length > 160 ||
    !isNonEmptyString(request.representativeTitle) || request.representativeTitle.length > 120 ||
    !isNonEmptyString(request.representativeEmail) || request.representativeEmail.length > 256 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.representativeEmail) ||
    !isNonEmptyString(request.representativePhone) || request.representativePhone.length > 32 ||
    !/^\+[0-9 ()-]{7,31}$/.test(request.representativePhone) ||
    request.representativePhone.replace(/\D/g, "").length < 8 ||
    request.representativePhone.replace(/\D/g, "").length > 15 ||
    !isOptionalNullable(request.representativeNationalityCode,
      value => typeof value === "string" && /^[A-Z]{2}$/.test(value)) ||
    !isOptionalNullable(request.representativeAddress,
      value => typeof value === "string" && value.trim().length <= 250) ||
    !isOptionalNullable(request.representativeCountry,
      value => typeof value === "string" && value.trim().length <= 80) ||
    !isOptionalNullable(request.representativeProvince,
      value => typeof value === "string" && value.trim().length <= 80) ||
    !isOptionalNullable(request.representativeMunicipality,
      value => typeof value === "string" && value.trim().length <= 80) ||
    !isOptionalNullable(request.representativeDocumentType,
      value => value === "NationalId" || value === "Passport" || value === "Other") ||
    !isOptionalNullable(request.representativeDocumentNumber,
      value => typeof value === "string" && /^[A-Za-z0-9 /-]{3,40}$/.test(value)) ||
    Boolean(request.representativeDocumentType) !== Boolean(request.representativeDocumentNumber) ||
    request.authorityDeclared !== true)
    throw new TypeError("Commercial application is invalid.");
  return request as unknown as SubmitCommercialRequestRequest;
}

function isCommercialRequestReceipt(value: unknown): value is SubmitCommercialRequestResponse {
  return isRecord(value) && hasOnlyKeys(value, ["reference", "replayed"]) &&
    isNonEmptyString(value.reference) && value.reference.length <= 128 &&
    typeof value.replayed === "boolean";
}

function validatedFinanceApprovedServicesQuery(
  query: FinanceApprovedServicesQuery,
): FinanceApprovedServicesQuery {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "from", "to"]) ||
      !isUuid(query.stationId) || !isDateOnly(query.from) || !isDateOnly(query.to) ||
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) /
        86_400_000 > 30 || query.to < query.from)
    throw new TypeError("Finance evidence station and date range are invalid.");
  return query as unknown as FinanceApprovedServicesQuery;
}

function isFinanceApprovedServicesResponse(value: unknown): value is FinanceApprovedServicesResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["stationId", "from", "to", "services", "hasMore"]) &&
    isUuid(value.stationId) && isDateOnly(value.from) && isDateOnly(value.to) &&
    typeof value.hasMore === "boolean" && Array.isArray(value.services) &&
    value.services.length <= 200 &&
    value.services.every((service) => isRecord(service) &&
      hasOnlyKeys(service, ["id", "operationId", "turnaroundId", "approvedSubmissionId",
        "operationCode", "operationDate", "airlineId", "airlineName", "flightNumber", "contractCode",
        "serviceCode", "serviceName", "executionStatus", "contractedQuantity",
        "executedQuantity", "billingUnit", "frozenUnitPrice", "frozenCurrency",
        "ready", "blockingReason", "amount", "preinvoiceId"]) &&
      isUuid(service.id) && isUuid(service.operationId) && isUuid(service.turnaroundId) &&
      isUuid(service.approvedSubmissionId) && isNonEmptyString(service.operationCode) &&
      isDateOnly(service.operationDate) && isUuid(service.airlineId) &&
      isNonEmptyString(service.airlineName) &&
      isString(service.flightNumber) && isOptionalNullable(service.contractCode, isNonEmptyString) &&
      isNonEmptyString(service.serviceCode) && isNonEmptyString(service.serviceName) &&
      ["Planned", "InProgress", "Completed", "NotPerformed", "Exception"].includes(
        String(service.executionStatus)) &&
      isFiniteNumber(service.contractedQuantity) && service.contractedQuantity >= 0 &&
      isFiniteNumber(service.executedQuantity) && service.executedQuantity >= 0 &&
      isString(service.billingUnit) &&
      isOptionalNullable(service.frozenUnitPrice, value => isFiniteNumber(value) && value >= 0) &&
      isOptionalNullable(service.frozenCurrency, value =>
        typeof value === "string" && /^[A-Z]{3}$/.test(value)) &&
      isOptionalNullable(service.preinvoiceId, isUuid) &&
      typeof service.ready === "boolean" &&
      (service.ready
        ? service.executionStatus === "Completed" && service.executedQuantity > 0 &&
          isNonEmptyString(service.billingUnit) && isFiniteNumber(service.frozenUnitPrice) &&
          typeof service.frozenCurrency === "string" &&
          /^[A-Z]{3}$/.test(service.frozenCurrency) &&
          (service.blockingReason === null || service.blockingReason === undefined) &&
          isFiniteNumber(service.amount) && service.amount >= 0
        : isNonEmptyString(service.blockingReason) &&
          (service.amount === null || service.amount === undefined)));
}

function validatedPreinvoiceDraftRequest(
  request: CreatePreinvoiceDraftRequest,
): CreatePreinvoiceDraftRequest {
  if (!isRecord(request) ||
      !hasOnlyKeys(request, ["stationId", "from", "to", "requestId", "serviceIds"]) ||
      !isUuid(request.stationId) || !isUuid(request.requestId) ||
      !isDateOnly(request.from) || !isDateOnly(request.to) ||
      request.to < request.from ||
      (Date.parse(`${request.to}T00:00:00Z`) - Date.parse(`${request.from}T00:00:00Z`)) /
        86_400_000 > 30 || !Array.isArray(request.serviceIds) ||
      request.serviceIds.length < 1 || request.serviceIds.length > 100 ||
      !request.serviceIds.every(isUuid) ||
      new Set(request.serviceIds).size !== request.serviceIds.length)
    throw new TypeError("Preinvoice draft selection is invalid.");
  return request as unknown as CreatePreinvoiceDraftRequest;
}

function isPreinvoiceDraftCreateResponse(value: unknown): value is CreatePreinvoiceDraftResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id", "replayed"]) &&
    isUuid(value.id) && typeof value.replayed === "boolean";
}

function isPreinvoiceDraftResponse(value: unknown): value is PreinvoiceDraftResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "airlineId", "airlineName",
      "stationId", "from", "to", "currencyCode", "total", "status", "lines"]) ||
      !isUuid(value.id) || !isUuid(value.airlineId) || !isUuid(value.stationId) ||
      !isNonEmptyString(value.airlineName) || !isDateOnly(value.from) ||
      !isDateOnly(value.to) || value.to < value.from ||
      typeof value.currencyCode !== "string" || !/^[A-Z]{3}$/.test(value.currencyCode) ||
      !isFiniteNumber(value.total) || value.total < 0 ||
      !["Draft", "Submitted", "Disputed", "Accepted", "Invoiced", "Voided"].includes(String(value.status)) ||
      !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 100)
    return false;
  return value.lines.every((line, index) => isRecord(line) &&
    hasOnlyKeys(line, ["id", "operationServiceId", "approvedSubmissionId", "lineNumber",
      "operationCode", "operationDate", "serviceCode", "serviceName",
      "executedQuantity", "billingUnit", "unitPrice", "currencyCode", "amount"]) &&
    isUuid(line.id) && isUuid(line.operationServiceId) && isUuid(line.approvedSubmissionId) &&
    line.lineNumber === index + 1 && isNonEmptyString(line.operationCode) &&
    isDateOnly(line.operationDate) && String(line.operationDate) >= String(value.from) &&
    String(line.operationDate) <= String(value.to) && isNonEmptyString(line.serviceCode) &&
    isNonEmptyString(line.serviceName) && isFiniteNumber(line.executedQuantity) &&
    line.executedQuantity > 0 && isNonEmptyString(line.billingUnit) &&
    isFiniteNumber(line.unitPrice) && line.unitPrice >= 0 &&
    line.currencyCode === value.currencyCode &&
    isFiniteNumber(line.amount) && line.amount >= 0);
}

function validatedAirlineContractParams(parameters: GetAirlineContractsParams): GetAirlineContractsParams {
  if (!isRecord(parameters) ||
    (parameters.page !== undefined && (!isInt32(parameters.page) || parameters.page < 1 || parameters.page > 10_000)) ||
    (parameters.limit !== undefined && (!isInt32(parameters.limit) || parameters.limit < 1 || parameters.limit > 50)))
    throw new TypeError("Airline contract paging is invalid.");
  return {
    ...(parameters.page === undefined ? {} : { page: parameters.page }),
    ...(parameters.limit === undefined ? {} : { limit: parameters.limit }),
  };
}

function validatedAirlineOperationParams(parameters: GetAirlineOperationsParams): GetAirlineOperationsParams {
  if (!isRecord(parameters) || !hasOnlyKeys(parameters, ["page", "limit"]) ||
    (parameters.page !== undefined && (!isInt32(parameters.page) || parameters.page < 1 || parameters.page > 10_000)) ||
    (parameters.limit !== undefined && (!isInt32(parameters.limit) || parameters.limit < 1 || parameters.limit > 50)))
    throw new TypeError("Airline operation paging is invalid.");
  return {
    ...(parameters.page === undefined ? {} : { page: parameters.page }),
    ...(parameters.limit === undefined ? {} : { limit: parameters.limit }),
  };
}

function validatedAirlineRequestParams(
  parameters: GetAirlineOperationalRequestsParams,
): GetAirlineOperationalRequestsParams {
  if (!isRecord(parameters) || !hasOnlyKeys(parameters, ["page", "limit"]) ||
    (parameters.page !== undefined && (!isInt32(parameters.page) || parameters.page < 1 || parameters.page > 10_000)) ||
    (parameters.limit !== undefined && (!isInt32(parameters.limit) || parameters.limit < 1 || parameters.limit > 50)))
    throw new TypeError("Airline request paging is invalid.");
  return {
    ...(parameters.page === undefined ? {} : { page: parameters.page }),
    ...(parameters.limit === undefined ? {} : { limit: parameters.limit }),
  };
}

function validatedAirlinePreinvoiceParams(
  parameters: GetAirlinePreinvoicesParams,
): GetAirlinePreinvoicesParams {
  if (!isRecord(parameters) || !hasOnlyKeys(parameters, ["page", "limit"]) ||
    (parameters.page !== undefined && (!isInt32(parameters.page) || parameters.page < 1 || parameters.page > 10_000)) ||
    (parameters.limit !== undefined && (!isInt32(parameters.limit) || parameters.limit < 1 || parameters.limit > 50)))
    throw new TypeError("Airline preinvoice paging is invalid.");
  return {
    ...(parameters.page === undefined ? {} : { page: parameters.page }),
    ...(parameters.limit === undefined ? {} : { limit: parameters.limit }),
  };
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

function validatedManualTurnaroundOptionsParams(
  parameters: GetManualTurnaroundOptionsParams,
): GetManualTurnaroundOptionsParams {
  if (!isRecord(parameters) || !hasOnlyKeys(parameters, ["stationId", "date"]) ||
      !isUuid(parameters.stationId))
    throw new TypeError("stationId must be a canonical UUID.");
  if (!isDateOnly(parameters.date))
    throw new TypeError("date must be a valid calendar date.");
  return { stationId: parameters.stationId, date: parameters.date };
}

function validatedManualTurnaroundRequest(
  request: CreateManualTurnaroundRequest,
): CreateManualTurnaroundRequest {
  const keys = ["turnaroundId", "stationId", "airlineId", "standId", "operationDate",
    "arrivalFlightNumber", "arrivalOriginIata", "arrivalScheduledAt",
    "departureFlightNumber", "departureDestinationIata", "departureScheduledAt"];
  if (!isRecord(request) || !hasOnlyKeys(request, keys))
    throw new TypeError("manual turnaround request has unknown or invalid fields.");
  if (!isUuid(request.turnaroundId) || !isUuid(request.stationId) ||
      !isUuid(request.airlineId) || !isUuid(request.standId) ||
      !isDateOnly(request.operationDate))
    throw new TypeError("manual turnaround identifiers or operationDate are invalid.");
  const arrivalFlightNumber = typeof request.arrivalFlightNumber === "string"
    ? request.arrivalFlightNumber.replace(/\s+/g, "").toUpperCase() : "";
  const departureFlightNumber = typeof request.departureFlightNumber === "string"
    ? request.departureFlightNumber.replace(/\s+/g, "").toUpperCase() : "";
  const arrivalOriginIata = typeof request.arrivalOriginIata === "string"
    ? request.arrivalOriginIata.trim().toUpperCase() : "";
  const departureDestinationIata = typeof request.departureDestinationIata === "string"
    ? request.departureDestinationIata.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{2,16}$/.test(arrivalFlightNumber) ||
      !/^[A-Z0-9]{2,16}$/.test(departureFlightNumber) ||
      !/^[A-Z]{3}$/.test(arrivalOriginIata) ||
      !/^[A-Z]{3}$/.test(departureDestinationIata))
    throw new TypeError("manual turnaround flight or airport code is invalid.");
  if (typeof request.arrivalScheduledAt !== "string" ||
      typeof request.departureScheduledAt !== "string" ||
      !isDateTimeOffset(request.arrivalScheduledAt) ||
      !isDateTimeOffset(request.departureScheduledAt) ||
      !/(?:Z|\+00:00)$/.test(request.arrivalScheduledAt) ||
      !/(?:Z|\+00:00)$/.test(request.departureScheduledAt))
    throw new TypeError("manual turnaround scheduled times must be UTC instants.");
  const duration = Date.parse(request.departureScheduledAt) - Date.parse(request.arrivalScheduledAt);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60 * 1000)
    throw new TypeError("departureScheduledAt must follow arrivalScheduledAt within 24 hours.");
  return { turnaroundId: request.turnaroundId, stationId: request.stationId,
    airlineId: request.airlineId, standId: request.standId,
    operationDate: request.operationDate,
    arrivalFlightNumber, arrivalOriginIata, arrivalScheduledAt: request.arrivalScheduledAt,
    departureFlightNumber, departureDestinationIata,
    departureScheduledAt: request.departureScheduledAt };
}

function validatedOccShiftRequest(request: ProgramOccShiftRequest): ProgramOccShiftRequest {
  if (!isRecord(request) || !hasOnlyKeys(request,
      ["agentId", "startsAtLocal", "endsAtLocal"]) || !isUuid(request.agentId) ||
      typeof request.startsAtLocal !== "string" ||
      typeof request.endsAtLocal !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(request.startsAtLocal) ||
      !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(request.endsAtLocal) ||
      request.startsAtLocal === request.endsAtLocal)
    throw new TypeError("OCC shift requires an agentId and distinct local HH:mm:ss times.");
  const toSeconds = (value: string) => {
    const [hour, minute, second] = value.split(":").map(Number);
    return hour! * 3600 + minute! * 60 + second!;
  };
  const start = toSeconds(request.startsAtLocal);
  const end = toSeconds(request.endsAtLocal);
  const duration = end > start ? end - start : end + 86400 - start;
  if (duration > 16 * 3600)
    throw new TypeError("OCC shift cannot exceed sixteen hours.");
  return { agentId: request.agentId,
    startsAtLocal: request.startsAtLocal, endsAtLocal: request.endsAtLocal };
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
    async getAirlineContracts(
      parameters: GetAirlineContractsParams = {}, options?: GetAirlineContractsOptions,
    ) {
      const paging = validatedAirlineContractParams(parameters);
      const result = await execute(
        getGetAirlineContractsUrl(paging), { ...options, method: "GET" }, true,
      );
      if (!isAirlineContractPageResponse(result.data) ||
        result.data.page !== (paging.page ?? 1) ||
        result.data.limit !== (paging.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlineOperations(
      parameters: GetAirlineOperationsParams = {}, options?: GetAirlineOperationsOptions,
    ) {
      const paging = validatedAirlineOperationParams(parameters);
      const result = await execute(
        getGetAirlineOperationsUrl(paging), { ...options, method: "GET" }, true,
      );
      if (!isAirlineOperationPageResponse(result.data) ||
        result.data.page !== (paging.page ?? 1) ||
        result.data.limit !== (paging.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlineOperation(operationId: string, options?: GetAirlineOperationOptions) {
      if (!isUuid(operationId)) throw new TypeError("Operation ID must be a UUID.");
      const result = await execute(
        getGetAirlineOperationUrl(operationId), { ...options, method: "GET" }, true,
      );
      if (!isAirlineOperationDetailResponse(result.data) || result.data.id !== operationId)
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlineOperationalRequests(
      parameters: GetAirlineOperationalRequestsParams = {},
      options?: GetAirlineOperationalRequestsOptions,
    ) {
      const paging = validatedAirlineRequestParams(parameters);
      const result = await execute(getGetAirlineOperationalRequestsUrl(paging),
        { ...options, method: "GET" }, true);
      if (!isAirlineOperationalRequestPageResponse(result.data) ||
          result.data.page !== (paging.page ?? 1) ||
          result.data.limit !== (paging.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getAirlinePreinvoices(
      parameters: GetAirlinePreinvoicesParams = {},
      options?: GetAirlinePreinvoicesOptions,
    ) {
      const paging = validatedAirlinePreinvoiceParams(parameters);
      const result = await execute(getGetAirlinePreinvoicesUrl(paging),
        { ...options, method: "GET" }, true);
      if (!isAirlinePreinvoicePageResponse(result.data) ||
          result.data.page !== (paging.page ?? 1) ||
          result.data.limit !== (paging.limit ?? 20))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getPublicCommercialCatalog(options?: GetPublicCommercialCatalogOptions) {
      const result = await execute(getGetPublicCommercialCatalogUrl(),
        { ...options, method: "GET" });
      if (!isPublicCommercialCatalog(result.data)) throw malformedResponse(result.status);
      return result.data;
    },
    async submitCommercialRequest(
      request: SubmitCommercialRequestRequest,
      options?: SubmitCommercialRequestOptions,
    ) {
      const body = validatedCommercialRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getSubmitCommercialRequestUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(body) });
      if (!isCommercialRequestReceipt(result.data) ||
        result.status !== (result.data.replayed ? 200 : 201))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getFinanceApprovedServices(
      query: FinanceApprovedServicesQuery,
      options?: GetFinanceApprovedServicesOptions,
    ) {
      const scope = validatedFinanceApprovedServicesQuery(query);
      const result = await execute(getGetFinanceApprovedServicesUrl(scope),
        { ...options, method: "GET" }, true);
      if (!isFinanceApprovedServicesResponse(result.data) ||
          result.data.stationId !== scope.stationId ||
          result.data.from !== scope.from || result.data.to !== scope.to)
        throw malformedResponse(result.status);
      return result.data;
    },
    async createPreinvoiceDraft(
      request: CreatePreinvoiceDraftRequest,
      options?: CreatePreinvoiceDraftOptions,
    ) {
      const selection = validatedPreinvoiceDraftRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getCreatePreinvoiceDraftUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(selection) }, true);
      if (!isPreinvoiceDraftCreateResponse(result.data))
        throw malformedResponse(result.status);
      return result.data;
    },
    async getPreinvoiceDraft(
      draftId: string, expectedStationId: string,
      options?: GetPreinvoiceDraftOptions,
    ) {
      const draft = validatedUuid(draftId, "draftId");
      const station = validatedUuid(expectedStationId, "expectedStationId");
      const result = await execute(getGetPreinvoiceDraftUrl(draft),
        { ...options, method: "GET" }, true);
      if (!isPreinvoiceDraftResponse(result.data) ||
          result.data.id !== draft || result.data.stationId !== station)
        throw malformedResponse(result.status);
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
    async getManualTurnaroundOptions(
      parameters: GetManualTurnaroundOptionsParams,
      options?: GetManualTurnaroundOptionsOptions,
    ) {
      const query = validatedManualTurnaroundOptionsParams(parameters);
      const result = await execute(getGetManualTurnaroundOptionsUrl(query),
        { ...options, method: "GET" }, true);
      if (!isManualTurnaroundOptionsResponse(result.data) ||
          result.data.station.id !== query.stationId || result.data.date !== query.date)
        throw malformedResponse(result.status);
      return result.data;
    },
    async createManualTurnaround(
      request: CreateManualTurnaroundRequest,
      options?: CreateManualTurnaroundOptions,
    ) {
      const body = validatedManualTurnaroundRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getCreateManualTurnaroundUrl(),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (!isManualTurnaroundResponse(result.data) ||
          result.data.turnaroundId !== body.turnaroundId ||
          ![200, 201].includes(result.status) || result.data.replayed !== (result.status === 200))
        throw malformedResponse(result.status);
      return result.data;
    },
    async programOccShift(
      turnaroundId: string,
      request: ProgramOccShiftRequest,
      options?: ProgramOccShiftOptions,
    ) {
      if (!isUuid(turnaroundId))
        throw new TypeError("turnaroundId must be a canonical UUID.");
      const body = validatedOccShiftRequest(request);
      const headers = headersFrom(options?.headers, "Request headers");
      headers.set("content-type", "application/json");
      const result = await execute(getProgramOccShiftUrl(turnaroundId),
        { ...options, method: "POST", headers, body: JSON.stringify(body) }, true);
      if (!isProgramOccShiftResponse(result.data) ||
          result.data.turnaroundId !== turnaroundId ||
          ![200, 201].includes(result.status) ||
          result.data.replayed !== (result.status === 200))
        throw malformedResponse(result.status);
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
