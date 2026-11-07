/**
 * Airline permit dossier and portal standing (phase 2, block B): the submission and the review take an
 * Idempotency-Key (2-N09), Contratos revokes a verified permit with a reason and the version on screen, the
 * answers of a review or a revocation name the contracts they activated, resumed or suspended (2-N30), and the
 * portal reads where the airline stands: historical stations, read-only and why a contract waits (2-N32, 2-N35).
 */
import type {
  AirlinePermitContractChange,
  AirlinePermitData,
  AirlinePermitDecisionData,
  AirlinePortalStandingResponse,
} from "../generated/elevant-api";

export const AIRLINE_PERMIT_KINDS = ["OperatingPermit", "AirOperatorCertificate", "Insurance", "Other"] as const;
export type AirlinePermitKind = (typeof AIRLINE_PERMIT_KINDS)[number];
/** Submitted, Verified, Rejected or Revoked: a revoked permit keeps its original verification. */
export const AIRLINE_PERMIT_REVIEWS = ["Submitted", "Verified", "Rejected", "Revoked"] as const;
export type AirlinePermitReview = (typeof AIRLINE_PERMIT_REVIEWS)[number];
export const AIRLINE_PERMIT_VALIDITIES = ["Current", "Expiring", "Expired"] as const;
/** The overall standing of the airline with AVIAM. */
export const AIRLINE_STANDINGS = ["Active", "Pending", "Suspended", "Expired", "Terminated", "None"] as const;
export type AirlineStanding = (typeof AIRLINE_STANDINGS)[number];
/** Why a contract that never activated still waits. */
export const AIRLINE_CONTRACT_PENDING_REASONS = ["signatures", "operating_permit"] as const;
const CONTRACT_STATUSES = ["Draft", "Active", "Suspended", "Terminated", "Expired"] as const;

/** Contratos verifies or rejects a submitted permit; a rejection needs a note of 5 to 500 characters. */
export interface ReviewAirlinePermitCommand {
  readonly verified: boolean;
  readonly note?: string | null;
  readonly expectedVersion: string;
}

/** Contratos revokes a verified permit with a reason (5 to 500 characters) and the version on screen. */
export interface RevokeAirlinePermitCommand {
  readonly reason: string;
  readonly expectedVersion: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEDIA = /^\/api\/v1\/media\/[0-9a-f-]{36}$/i;
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
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isTimestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isOptional = <T>(value: unknown, valid: (item: unknown) => item is T) =>
  value === undefined || value === null || valid(value);

const PERMIT_KEYS = ["id", "airlineId", "airline", "kind", "number", "issuer", "issuedOn", "expiresOn", "validity", "review",
  "reviewNote", "documentUrl", "submittedAt", "reviewedAt", "version", "revokedAt", "revocationReason"] as const;

const isPermitFields = (value: Record<string, unknown>) =>
  isUuid(value.id) && isUuid(value.airlineId) && isText(value.airline, 200) && isOneOf(value.kind, AIRLINE_PERMIT_KINDS) &&
  isText(value.number, 60) && isText(value.issuer, 120) && isDate(value.issuedOn) && isDate(value.expiresOn) &&
  value.expiresOn >= value.issuedOn && isOneOf(value.validity, AIRLINE_PERMIT_VALIDITIES) &&
  isOneOf(value.review, AIRLINE_PERMIT_REVIEWS) && isOptional(value.reviewNote, (note): note is string => isText(note, 500)) &&
  isOptional(value.documentUrl, (url): url is string => typeof url === "string" && MEDIA.test(url)) &&
  isTimestamp(value.submittedAt) && isOptional(value.reviewedAt, isTimestamp) && isText(value.version, 64) &&
  // Only a revoked permit carries its revocation, and it always keeps the verification it had.
  (value.review === "Revoked"
    ? isTimestamp(value.revokedAt) && isOptional(value.revocationReason, (reason): reason is string => isText(reason, 2000)) &&
      isTimestamp(value.reviewedAt)
    : value.revokedAt == null && value.revocationReason == null);

/** A permit of the dossier, the same for the airline's portal and for Contratos. */
export function isAirlinePermit(value: unknown): value is AirlinePermitData {
  return isRecord(value) && hasOnlyKeys(value, PERMIT_KEYS) && isPermitFields(value);
}

const isContractChange = (value: unknown): value is AirlinePermitContractChange => isRecord(value) &&
  hasOnlyKeys(value, ["contractId", "contractCode", "status"]) && isUuid(value.contractId) &&
  isText(value.contractCode, 64) && isOneOf(value.status, CONTRACT_STATUSES);

/**
 * The permit of the route after a review or a revocation, with the contracts that command activated or resumed
 * (Active) or suspended (Suspended). The review of the route always answers that same permit.
 */
export function isAirlinePermitDecision(value: unknown, permitId: string): value is AirlinePermitDecisionData {
  return isRecord(value) && hasOnlyKeys(value, [...PERMIT_KEYS, "contracts"]) && isPermitFields(value) &&
    (value.id as string).toLowerCase() === permitId.toLowerCase() &&
    Array.isArray(value.contracts) && value.contracts.length <= 50 && value.contracts.every(isContractChange);
}

/** The review body: the note is trimmed and required (5 to 500 characters) to reject. */
export function normalizedPermitReview(command: ReviewAirlinePermitCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["verified", "note", "expectedVersion"]) ||
      typeof command.verified !== "boolean" || !isText(command.expectedVersion, 64))
    throw new TypeError("The permit review is invalid.");
  const note = typeof command.note === "string" ? command.note.trim() : "";
  if (note.length > 500 || !command.verified && note.length < 5)
    throw new TypeError("A rejection needs a note of 5 to 500 characters.");
  return { verified: command.verified, note: note || null, expectedVersion: command.expectedVersion };
}

/** The revocation body: a reason of 5 to 500 characters and the version on screen. */
export function normalizedPermitRevocation(command: RevokeAirlinePermitCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["reason", "expectedVersion"]) || !isText(command.expectedVersion, 64))
    throw new TypeError("The permit revocation is invalid.");
  const reason = typeof command.reason === "string" ? command.reason.trim() : "";
  if (reason.length < 5 || reason.length > 500) throw new TypeError("reason must have 5 to 500 characters.");
  return { reason, expectedVersion: command.expectedVersion };
}

const isStandingStation = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["id", "code", "name", "ianaTimeZone", "current"]) && isUuid(value.id) && isText(value.code, 16) &&
  isText(value.name, 200) && isText(value.ianaTimeZone, 64) && typeof value.current === "boolean";

const isStandingContract = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["id", "code", "status", "pendingReason", "versionsAwaitingSignatures"]) && isUuid(value.id) &&
  isText(value.code, 64) && isOneOf(value.status, CONTRACT_STATUSES) &&
  (value.pendingReason == null || isOneOf(value.pendingReason, AIRLINE_CONTRACT_PENDING_REASONS) && value.status === "Draft") &&
  Array.isArray(value.versionsAwaitingSignatures) && value.versionsAwaitingSignatures.length <= 50 &&
  value.versionsAwaitingSignatures.every(isUuid);

/**
 * Where the airline stands (2-N32): the overall status, read-only when no station is in force today, the stations a
 * contract in force covered or covers and its contracts with what they wait for. Read-only and «no station in force» go
 * together.
 */
export function isAirlinePortalStanding(value: unknown): value is AirlinePortalStandingResponse {
  return isRecord(value) && hasOnlyKeys(value, ["organizationId", "status", "readOnly", "stations", "contracts"]) &&
    isUuid(value.organizationId) && isOneOf(value.status, AIRLINE_STANDINGS) && typeof value.readOnly === "boolean" &&
    Array.isArray(value.stations) && value.stations.length <= 200 && value.stations.every(isStandingStation) &&
    value.readOnly === !value.stations.some(station => (station as { current: boolean }).current) &&
    Array.isArray(value.contracts) && value.contracts.length <= 200 && value.contracts.every(isStandingContract);
}
