/**
 * Contract documents and lifecycle (phase 2, block A): the withdrawal of an approved version both
 * parties have not signed (2-N10), the surcharges and packages that apply to a version (2-N04) and the
 * termination facts of the contract history (2-N14). Every command carries an Idempotency-Key and the
 * content hash the user saw.
 */
import type {
  ContractPricingTermsResponse,
  ContractTimelineData,
  ContractWithdrawalResponse,
} from "../generated/elevant-api";

export const CONTRACT_STATUSES = ["Draft", "Active", "Suspended", "Terminated", "Expired"] as const;
export type ContractStatusCode = (typeof CONTRACT_STATUSES)[number];
/** Explicit causes that end an active or suspended contract at once, without the signed notice. */
export const CONTRACT_TERMINATION_CAUSES = ["Breach", "MutualAgreement"] as const;
export type ContractTerminationCause = (typeof CONTRACT_TERMINATION_CAUSES)[number];

/** Contratos withdraws an approved version both parties have not signed, with a reason. */
export interface WithdrawContractVersionCommand {
  readonly reason: string;
  readonly expectedDocumentSha256: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/i;
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
const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isCount = (value: unknown, min: number): value is number => Number.isInteger(value) && (value as number) >= min;
const isNullable = <T>(value: unknown, valid: (item: unknown) => item is T) => value === null || valid(value);
const isTimestamp = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** The withdrawal body: a reason of 5 to 500 characters and the content hash on screen. */
export function normalizedContractWithdrawal(command: WithdrawContractVersionCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["reason", "expectedDocumentSha256"]))
    throw new TypeError("The withdrawal is invalid.");
  const reason = typeof command.reason === "string" ? command.reason.trim() : "";
  if (reason.length < 5 || reason.length > 500) throw new TypeError("reason must have 5 to 500 characters.");
  if (typeof command.expectedDocumentSha256 !== "string" || !SHA256.test(command.expectedDocumentSha256))
    throw new TypeError("expectedDocumentSha256 must be the content hash of the document.");
  return { reason, expectedDocumentSha256: command.expectedDocumentSha256.toLowerCase() };
}

/**
 * The withdrawn version of the route, now Rejected, its contract and, when the contract never activated
 * and had nothing else alive, the new draft with the same content.
 */
export function isContractWithdrawal(value: unknown, versionId: string): value is ContractWithdrawalResponse {
  return isRecord(value) && hasOnlyKeys(value, ["versionId", "versionStatus", "contractStatus", "draftVersionId"]) &&
    isUuid(value.versionId) && value.versionId.toLowerCase() === versionId.toLowerCase() &&
    value.versionStatus === "Rejected" && isOneOf(value.contractStatus, CONTRACT_STATUSES) &&
    (value.draftVersionId === undefined || value.draftVersionId === null ||
      isUuid(value.draftVersionId) && value.draftVersionId.toLowerCase() !== versionId.toLowerCase());
}

const isCharge = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["chargeCode", "chargeName", "method", "billingUnit", "quantityRule", "graceMinutes",
    "roundingIncrement", "isExcluded", "value", "minimumAmount"]) &&
  isText(value.chargeCode, 64) && isText(value.chargeName, 200) && isText(value.method, 32) &&
  (value.billingUnit === undefined || isNullable(value.billingUnit, (unit): unit is string => isText(unit, 32))) &&
  isText(value.quantityRule, 32) && isCount(value.graceMinutes, 0) && isAmount(value.roundingIncrement) &&
  typeof value.isExcluded === "boolean" &&
  (value.value === undefined || isNullable(value.value, isAmount)) &&
  (value.minimumAmount === undefined || isNullable(value.minimumAmount, isAmount)) &&
  // An exempted surcharge has no amount of its own.
  (!value.isExcluded || value.value == null && value.minimumAmount == null);

const isComponent = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["serviceCode", "serviceName", "billingUnit", "includedQuantity", "excessBlockSize",
    "excessBlockPrice"]) &&
  isText(value.serviceCode, 64) && isText(value.serviceName, 200) && isText(value.billingUnit, 32) &&
  isAmount(value.includedQuantity) && isAmount(value.excessBlockSize) && isAmount(value.excessBlockPrice);

const isPackage = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["code", "name", "versionNumber", "scope", "flightDirection", "periodDays", "basePrice",
    "currencyCode", "components"]) &&
  isText(value.code, 64) && isText(value.name, 200) && isCount(value.versionNumber, 1) && isText(value.scope, 32) &&
  (value.flightDirection === undefined || isNullable(value.flightDirection, (item): item is string => isText(item, 32))) &&
  (value.periodDays === undefined || isNullable(value.periodDays, (days): days is number => isCount(days, 1))) &&
  isAmount(value.basePrice) && isText(value.currencyCode, 3) && Array.isArray(value.components) &&
  value.components.length <= 100 && value.components.every(isComponent);

/**
 * The surcharges and packages of the version of the route: `inDocument` when they are part of its signed
 * content, and `signed` only when both parties signed that content.
 */
export function isContractPricingTerms(value: unknown, versionId: string): value is ContractPricingTermsResponse {
  return isRecord(value) &&
    hasOnlyKeys(value, ["versionId", "currencyCode", "inDocument", "signed", "charges", "packages"]) &&
    isUuid(value.versionId) && value.versionId.toLowerCase() === versionId.toLowerCase() &&
    isText(value.currencyCode, 3) && typeof value.inDocument === "boolean" && typeof value.signed === "boolean" &&
    (value.inDocument || !value.signed) &&
    Array.isArray(value.charges) && value.charges.length <= 200 && value.charges.every(isCharge) &&
    Array.isArray(value.packages) && value.packages.length <= 100 && value.packages.every(isPackage);
}

const isTimelineEntry = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["at", "kind", "title", "detail", "actor"]) && isTimestamp(value.at) &&
  isText(value.kind, 32) && isText(value.title, 300) &&
  (value.detail === undefined || value.detail === null || typeof value.detail === "string") &&
  (value.actor === undefined || value.actor === null || typeof value.actor === "string");

/**
 * The history of a contract with its termination facts (2-N14): a termination scheduled for a later
 * date (`terminatesOn`, the first day without coverage) or, when none is, the earliest date a
 * termination with notice may take today (`earliestTerminationOn`).
 */
export function isContractTimeline(value: unknown): value is ContractTimelineData {
  return isRecord(value) &&
    hasOnlyKeys(value, ["contractId", "contractCode", "status", "entries", "terminatesOn", "earliestTerminationOn"]) &&
    isUuid(value.contractId) && isText(value.contractCode, 64) && isOneOf(value.status, CONTRACT_STATUSES) &&
    Array.isArray(value.entries) && value.entries.every(isTimelineEntry) &&
    (value.terminatesOn === undefined || isNullable(value.terminatesOn, isDate)) &&
    (value.earliestTerminationOn === undefined || isNullable(value.earliestTerminationOn, isDate)) &&
    // A scheduled termination and the earliest date of a new one never come together.
    (value.terminatesOn == null || value.earliestTerminationOn == null);
}
