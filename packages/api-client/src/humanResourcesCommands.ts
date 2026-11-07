/**
 * Gestión Humana commands and marks (phase 2, block D): the amendment of an approved absence (2-N22), the decision of
 * an availability request and the removal of a shift with the version on screen and an Idempotency-Key (2-N08,
 * 2-N11), the readiness warnings of the weekly schedule (2-N24) and the planning board's marks on assigned agents who
 * cannot do their operation (2-N25).
 */
import type { HumanResourcesAvailabilityAmended, OccAssignmentReadinessResponse } from "../generated/elevant-api";

/** The warnings every schedule read returns. */
export const SCHEDULE_WARNING_KINDS = ["Overlap", "ShortRest", "SevenDayLoad", "Unevaluable"] as const;
/** The warnings a schedule read returns only when it asks for them (`includeReadiness`, 2-N24). */
export const SCHEDULE_READINESS_WARNING_KINDS = ["ApprovedAbsence", "DocumentExpired"] as const;
export type ScheduleWarningKindName =
  (typeof SCHEDULE_WARNING_KINDS)[number] | (typeof SCHEDULE_READINESS_WARNING_KINDS)[number];
/** Documents named by a `DocumentExpired` warning, in this order. */
export const SCHEDULE_REQUIRED_DOCUMENTS = ["AirportId", "RampDriverLicense"] as const;

/** Why an assigned agent cannot do the operation on its date (2-N25). */
export const OCC_ASSIGNMENT_UNFIT_REASONS = ["agent_inactive", "approved_absence", "airport_id_not_current",
  "ramp_driver_license_not_current"] as const;
export type OccAssignmentUnfitReason = (typeof OCC_ASSIGNMENT_UNFIT_REASONS)[number];

/** `Cancel` an approved absence that has not started; `Shorten` one that has not ended (2-N22). */
export const AVAILABILITY_AMENDMENT_ACTIONS = ["Cancel", "Shorten"] as const;
export type AvailabilityAmendmentAction = (typeof AVAILABILITY_AMENDMENT_ACTIONS)[number];

/**
 * Gestión Humana cancels or shortens an approved absence with a reason (5 to 1000 characters) and the version on
 * screen. A shortening names the new last day (never before yesterday nor before the first day); a cancellation
 * names none. What the approval released does not come back.
 */
export interface AmendHumanResourcesAvailabilityCommand {
  readonly action: AvailabilityAmendmentAction;
  readonly endsOn?: string | null;
  readonly reason: string;
  readonly expectedVersion: string;
}

/** The station and the operation date of the planning board. */
export interface OccAssignmentReadinessQuery {
  readonly stationId: string;
  readonly date: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isOneOf = (value: unknown, options: readonly string[]) => typeof value === "string" && options.includes(value);
const isDate = (value: unknown): value is string =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** The version a decision or a removal compares: the rowversion in base64 the server read (`version`). */
export function isRecordVersion(value: unknown): value is string {
  return isText(value, 64);
}

/** The amendment body: the action, the new last day only to shorten, the trimmed reason and the version. */
export function normalizedAvailabilityAmendment(command: AmendHumanResourcesAvailabilityCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["action", "endsOn", "reason", "expectedVersion"]) ||
      !isOneOf(command.action, AVAILABILITY_AMENDMENT_ACTIONS) || !isRecordVersion(command.expectedVersion))
    throw new TypeError("The absence amendment is invalid.");
  const shorten = command.action === "Shorten";
  if (shorten ? !isDate(command.endsOn) : command.endsOn != null)
    throw new TypeError("Only a shortening names a new last day, and it needs one.");
  const reason = typeof command.reason === "string" ? command.reason.trim() : "";
  if (reason.length < 5 || reason.length > 1000) throw new TypeError("reason must have 5 to 1000 characters.");
  return { action: command.action, endsOn: shorten ? command.endsOn as string : null, reason,
    expectedVersion: command.expectedVersion };
}

/**
 * The amended request of the route. A cancellation answers Cancelled; a shortening answers its last day or, when the
 * key replays it after a later amendment, an earlier one (or the cancellation that followed).
 */
export function isHumanResourcesAvailabilityAmended(value: unknown, requestId: string,
  command: { readonly action: AvailabilityAmendmentAction; readonly endsOn: string | null }):
  value is HumanResourcesAvailabilityAmended {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "status", "endsOn", "version"]) || !isUuid(value.id) ||
      value.id.toLowerCase() !== requestId.toLowerCase() || !isDate(value.endsOn) || !isRecordVersion(value.version))
    return false;
  if (command.action === "Cancel") return value.status === "Cancelled";
  return isOneOf(value.status, ["Approved", "Cancelled"]) && command.endsOn !== null && value.endsOn <= command.endsOn;
}

/** The readiness query: a station and an operation date. */
export function validatedOccAssignmentReadinessQuery(query: OccAssignmentReadinessQuery): OccAssignmentReadinessQuery {
  if (!isRecord(query) || !hasOnlyKeys(query, ["stationId", "date"]) || !isUuid(query.stationId) || !isDate(query.date))
    throw new TypeError("The assignment readiness query is invalid.");
  return { stationId: query.stationId, date: query.date };
}

/**
 * The unfit assignments of the station's operations on the date: each one once, with at least one reason of the
 * eligibility vocabulary and no repeated reason. Fit assignments are not listed.
 */
export function isOccAssignmentReadiness(value: unknown, query: OccAssignmentReadinessQuery):
  value is OccAssignmentReadinessResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["stationId", "date", "assignments"]) || !isUuid(value.stationId) ||
      value.stationId.toLowerCase() !== query.stationId.toLowerCase() || value.date !== query.date ||
      !Array.isArray(value.assignments) || value.assignments.length > 2000) return false;
  const seen = new Set<string>();
  return value.assignments.every(item => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["assignmentId", "turnaroundId", "agentId", "reasons"]) ||
        !isUuid(item.assignmentId) || seen.has(item.assignmentId.toLowerCase()) || !isUuid(item.turnaroundId) ||
        !isUuid(item.agentId) || !Array.isArray(item.reasons) || item.reasons.length === 0 ||
        new Set(item.reasons).size !== item.reasons.length ||
        !item.reasons.every(reason => isOneOf(reason, OCC_ASSIGNMENT_UNFIT_REASONS))) return false;
    seen.add(item.assignmentId.toLowerCase());
    return true;
  });
}
