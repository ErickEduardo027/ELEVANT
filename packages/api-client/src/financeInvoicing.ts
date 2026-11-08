/**
 * «Por facturar» (phase 4, block A): the pending operations of a station with the limits of one invoice (4-N06,
 * 4-N16, 4-N18) and the closure without charge of operations whose valuation is zero (4-N07). Web only: the mobile
 * app never reads these endpoints, so their validators are strict.
 */
import type {
  FinanceOperationVersionRequest,
  FinancePendingOperationResponse,
  FinancePendingOperationsResponse,
  FinancePendingServiceResponse,
  NoChargeClosureResponse,
} from "../generated/elevant-api";

/** The filters and page of «Por facturar»; the dates and the airline are optional. */
export interface FinancePendingOperationsQuery {
  readonly stationId: string;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly airlineId?: string | null;
  /** The `nextCursor` of the previous page, opaque. */
  readonly cursor?: string | null;
  /** 1 to 100; 50 by default. */
  readonly limit?: number | null;
}

/** The closure of operations valued at zero: the versions Finance saw and its reason (5 to 500 characters). */
export interface CloseOperationsWithoutChargeCommand {
  readonly stationId: string;
  readonly operations: readonly FinanceOperationVersionRequest[];
  readonly reason: string;
}

export const PENDING_OPERATIONS_DEFAULT_LIMIT = 50;
export const PENDING_OPERATIONS_MAX_LIMIT = 100;
export const NO_CHARGE_REASON_MIN_LENGTH = 5;
export const NO_CHARGE_REASON_MAX_LENGTH = 500;
/** The limits of one invoice (4-N06); the server publishes them with every page. */
export const INVOICE_MAX_OPERATIONS = 100;

// Any well-formed UUID: the Development seed derives deterministic ids that carry no RFC version.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const CURRENCY = /^[A-Z]{3}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;
const isCount = (value: unknown, min = 0): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= 1_000_000;
const isMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isDate = (value: unknown): value is string =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isNullable = (value: unknown, predicate: (candidate: unknown) => boolean) =>
  value === null || value === undefined || predicate(value);
const isCode = (value: unknown) => typeof value === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(value);
const isVersion = (value: unknown): value is string => isText(value, 1, 64) && value.trim().length > 0;

/**
 * The query as the API takes it, or null when it cannot be sent: a station UUID, optional ordered ISO dates, an
 * optional airline UUID, a cursor this read wrote and a page of 1 to 100.
 */
export function normalizedPendingOperationsQuery(query: FinancePendingOperationsQuery):
  { stationId: string; from?: string; to?: string; airlineId?: string; cursor?: string; limit?: number } | null {
  if (!isRecord(query) || !isUuid(query.stationId)) return null;
  const result: { stationId: string; from?: string; to?: string; airlineId?: string; cursor?: string; limit?: number } =
    { stationId: query.stationId.toLowerCase() };
  if (query.from !== null && query.from !== undefined && query.from !== "") {
    if (!isDate(query.from)) return null;
    result.from = query.from;
  }
  if (query.to !== null && query.to !== undefined && query.to !== "") {
    if (!isDate(query.to)) return null;
    result.to = query.to;
  }
  if (result.from && result.to && result.from > result.to) return null;
  if (query.airlineId !== null && query.airlineId !== undefined && query.airlineId !== "") {
    if (!isUuid(query.airlineId)) return null;
    result.airlineId = query.airlineId.toLowerCase();
  }
  if (query.cursor !== null && query.cursor !== undefined && query.cursor !== "") {
    if (!CURSOR.test(query.cursor)) return null;
    result.cursor = query.cursor;
  }
  if (query.limit !== null && query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > PENDING_OPERATIONS_MAX_LIMIT) return null;
    result.limit = query.limit;
  }
  return result;
}

const SERVICE_KEYS = ["serviceId", "serviceCode", "serviceName", "ready", "blockingReason", "amount", "chargeCount"];

function isPendingService(value: unknown): value is FinancePendingServiceResponse {
  return isRecord(value) && hasOnlyKeys(value, SERVICE_KEYS) && isUuid(value.serviceId) &&
    isText(value.serviceCode, 1, 64) && isText(value.serviceName, 1, 300) && typeof value.ready === "boolean" &&
    isNullable(value.blockingReason, isCode) && (value.ready ? !value.blockingReason : isCode(value.blockingReason)) &&
    isNullable(value.amount, isMoney) && isCount(value.chargeCount);
}

const OPERATION_KEYS = ["operationId", "version", "operationCode", "operationDate", "airlineId", "airlineName",
  "flightNumber", "contractCode", "currencyCode", "serviceCount", "lineEstimate", "estimatedNet", "ready",
  "blockingReasons", "services"];

/** A pending operation: ready exactly when nothing blocks it, with one entry per billable service. */
export function isFinancePendingOperation(value: unknown): value is FinancePendingOperationResponse {
  return isRecord(value) && hasOnlyKeys(value, OPERATION_KEYS) && isUuid(value.operationId) &&
    isVersion(value.version) && isText(value.operationCode, 1, 64) && isDate(value.operationDate) &&
    isUuid(value.airlineId) && isText(value.airlineName, 1, 200) && isText(value.flightNumber, 0, 32) &&
    isNullable(value.contractCode, (code) => isText(code, 1, 64)) &&
    isNullable(value.currencyCode, (code) => typeof code === "string" && CURRENCY.test(code)) &&
    isCount(value.serviceCount, 1) && isCount(value.lineEstimate, 1) &&
    (value.lineEstimate as number) >= (value.serviceCount as number) && isMoney(value.estimatedNet) &&
    typeof value.ready === "boolean" && Array.isArray(value.blockingReasons) && value.blockingReasons.length <= 32 &&
    value.blockingReasons.every(isCode) && value.ready === (value.blockingReasons.length === 0) &&
    Array.isArray(value.services) && value.services.length === value.serviceCount &&
    value.services.every(isPendingService);
}

/** The page of «Por facturar» for `stationId`, with the limits of an invoice and the airline facet. */
export function isFinancePendingOperationsResponse(value: unknown, stationId: string):
  value is FinancePendingOperationsResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["stationId", "limits", "airlines", "operations", "nextCursor",
      "totalPending"]) || typeof value.stationId !== "string" ||
      value.stationId.toLowerCase() !== stationId.toLowerCase()) return false;
  const limits = value.limits;
  if (!isRecord(limits) || !hasOnlyKeys(limits, ["maxOperations", "maxLines", "maxDays"]) ||
      !isCount(limits.maxOperations, 1) || !isCount(limits.maxLines, 1) || !isCount(limits.maxDays, 1)) return false;
  if (!Array.isArray(value.airlines) || value.airlines.length > 1000 || !value.airlines.every((airline) =>
      isRecord(airline) && hasOnlyKeys(airline, ["airlineId", "airlineName", "pendingCount"]) &&
      isUuid(airline.airlineId) && isText(airline.airlineName, 1, 200) && isCount(airline.pendingCount, 1)))
    return false;
  return Array.isArray(value.operations) && value.operations.length <= PENDING_OPERATIONS_MAX_LIMIT &&
    value.operations.every(isFinancePendingOperation) &&
    new Set(value.operations.map((operation) => (operation as FinancePendingOperationResponse).operationId)).size ===
      value.operations.length &&
    isNullable(value.nextCursor, (cursor) => typeof cursor === "string" && CURSOR.test(cursor)) &&
    isCount(value.totalPending) && (value.totalPending as number) >= value.operations.length;
}

/**
 * The closure as the API takes it, or null: one to 100 distinct operations with their version and a reason of 5 to
 * 500 characters once trimmed.
 */
export function normalizedNoChargeClosure(command: CloseOperationsWithoutChargeCommand):
  { stationId: string; operations: FinanceOperationVersionRequest[]; reason: string } | null {
  if (!isRecord(command) || !isUuid(command.stationId) || !Array.isArray(command.operations) ||
      command.operations.length < 1 || command.operations.length > INVOICE_MAX_OPERATIONS ||
      typeof command.reason !== "string") return null;
  const operations = command.operations.map((operation) => isRecord(operation) && isUuid(operation.operationId) &&
    isVersion(operation.version) ? { operationId: operation.operationId.toLowerCase(), version: operation.version } : null);
  if (operations.some((operation) => operation === null) ||
      new Set(operations.map((operation) => operation!.operationId)).size !== operations.length) return null;
  const reason = command.reason.trim().replace(/\s+/g, " ");
  if (reason.length < NO_CHARGE_REASON_MIN_LENGTH || reason.length > NO_CHARGE_REASON_MAX_LENGTH) return null;
  return { stationId: command.stationId.toLowerCase(), operations: operations as FinanceOperationVersionRequest[], reason };
}

/** The closure answer: its id and exactly the operations it closed. */
export function isNoChargeClosureResponse(value: unknown, operationIds: readonly string[]):
  value is NoChargeClosureResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["closureId", "operationIds", "replayed"]) || !isUuid(value.closureId) ||
      typeof value.replayed !== "boolean" || !Array.isArray(value.operationIds) || !value.operationIds.every(isUuid))
    return false;
  const closed = (value.operationIds as string[]).map((id) => id.toLowerCase()).sort();
  const asked = operationIds.map((id) => id.toLowerCase()).sort();
  return closed.length === asked.length && closed.every((id, index) => id === asked[index]);
}
