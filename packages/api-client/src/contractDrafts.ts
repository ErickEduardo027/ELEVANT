/**
 * Contract drafts (phase 1, block B): readiness for Finance, the scope of services and stations, the
 * commands that save, submit, discard and answer a draft, and the airline's observation. Every command
 * carries an Idempotency-Key and the draft version (rowversion) the user saw.
 */
import type { ContractDraftReadinessData, ContractDraftScopeData } from "../generated/elevant-api";

/** Why a draft cannot go to Finance yet, in the order the server reports them. */
export const CONTRACT_DRAFT_ISSUES = ["portal_account_missing", "terms_missing", "services_missing",
  "rates_unconfirmed", "stations_missing", "service_retired", "package_not_eligible", "valid_from_not_after_current",
  "finance_reviewer_missing"] as const;
export type ContractDraftIssueCode = (typeof CONTRACT_DRAFT_ISSUES)[number];

/** The airline's portal account: none yet, created and invited, or activated. */
export const CONTRACT_DRAFT_PORTAL_ACCOUNTS = ["Missing", "Invited", "Active"] as const;
export const CONTRACT_DRAFT_VERSION_STATUSES = ["Draft", "PendingFinanceApproval"] as const;

export interface UpdateManagedContractDraftRate {
  readonly id: string;
  readonly billingUnit: string;
  readonly unitPrice: number;
  readonly minimumQuantity: number;
  readonly isConfirmed: boolean;
}

export interface UpdateManagedContractDraftCharge {
  readonly chargeId: string;
  readonly isExcluded: boolean;
  readonly value?: number | null;
}

/** Terms, validity, currency, rates and negotiated charges of a draft, with the version on screen. */
export interface UpdateManagedContractDraftCommand {
  readonly expectedVersion: string;
  readonly validFrom: string;
  readonly validTo?: string | null;
  readonly currencyCode: string;
  readonly terms: string;
  readonly rates: readonly UpdateManagedContractDraftRate[];
  readonly chargeRates?: readonly UpdateManagedContractDraftCharge[] | null;
}

export interface SubmitManagedContractDraftCommand {
  readonly expectedVersion: string;
}

/** The whole set of services and stations the draft must have. */
export interface SetContractDraftScopeCommand {
  readonly expectedVersion: string;
  readonly serviceIds: readonly string[];
  readonly stationIds: readonly string[];
}

export interface DiscardContractDraftCommand {
  readonly expectedVersion: string;
  readonly reason: string;
}

/** Contratos' answer, or the airline's observation, on a draft. */
export interface ContractDraftMessageCommand {
  readonly expectedVersion: string;
  readonly body: string;
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
const isVersion = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const isOneOf = (value: unknown, options: readonly string[]) => typeof value === "string" && options.includes(value);
const isAmount = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const isDate = (value: unknown): value is string =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const isIssue = (value: unknown) => isRecord(value) && hasOnlyKeys(value, ["code", "subjects"]) &&
  isOneOf(value.code, CONTRACT_DRAFT_ISSUES) && Array.isArray(value.subjects) && value.subjects.length <= 100 &&
  value.subjects.every(subject => isText(subject, 400));

export function isContractDraftReadiness(value: unknown, versionId: string): value is ContractDraftReadinessData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["versionId", "version", "versionStatus", "ready", "portalAccount", "issues"]) ||
      !isUuid(value.versionId) || value.versionId.toLowerCase() !== versionId.toLowerCase() || !isVersion(value.version) ||
      !isOneOf(value.versionStatus, CONTRACT_DRAFT_VERSION_STATUSES) || typeof value.ready !== "boolean" ||
      !isOneOf(value.portalAccount, CONTRACT_DRAFT_PORTAL_ACCOUNTS) || !Array.isArray(value.issues) ||
      value.issues.length > CONTRACT_DRAFT_ISSUES.length || !value.issues.every(isIssue))
    return false;
  const codes = value.issues.map(issue => (issue as Record<string, unknown>).code);
  // A ready draft has no issue; issues never repeat.
  return new Set(codes).size === codes.length && (!value.ready || codes.length === 0) &&
    (value.ready || value.versionStatus !== "Draft" || codes.length > 0);
}

const isScopeService = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["serviceId", "code", "name", "isActive", "selected", "rateId", "coveredByPackage"]) &&
  isUuid(value.serviceId) && isText(value.code, 64) && isText(value.name, 200) && typeof value.isActive === "boolean" &&
  typeof value.selected === "boolean" && (value.rateId === undefined || value.rateId === null || isUuid(value.rateId)) &&
  // A selected service has its rate; an unselected one has none.
  (value.selected ? isUuid(value.rateId) : value.rateId == null) && typeof value.coveredByPackage === "boolean" &&
  // Only an active service can be offered; a retired one appears only while the draft has it.
  (value.isActive || value.selected);

const isScopeStation = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["stationId", "code", "name", "isActive", "selected"]) && isUuid(value.stationId) &&
  isText(value.code, 16) && isText(value.name, 200) && typeof value.isActive === "boolean" &&
  typeof value.selected === "boolean" && (value.isActive || value.selected);

export function isContractDraftScope(value: unknown, versionId: string): value is ContractDraftScopeData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["versionId", "version", "versionStatus", "services", "stations"]) ||
      !isUuid(value.versionId) || value.versionId.toLowerCase() !== versionId.toLowerCase() || !isVersion(value.version) ||
      !isOneOf(value.versionStatus, CONTRACT_DRAFT_VERSION_STATUSES) || !Array.isArray(value.services) ||
      value.services.length > 1000 || !value.services.every(isScopeService) || !Array.isArray(value.stations) ||
      value.stations.length > 500 || !value.stations.every(isScopeStation))
    return false;
  const services = value.services.map(item => String((item as Record<string, unknown>).serviceId).toLowerCase());
  const stations = value.stations.map(item => String((item as Record<string, unknown>).stationId).toLowerCase());
  return new Set(services).size === services.length && new Set(stations).size === stations.length;
}

function expectedVersion(value: unknown) {
  if (!isVersion(value)) throw new TypeError("expectedVersion must be the draft version.");
  return value;
}

function boundedText(value: unknown, min: number, max: number, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) throw new TypeError(`${label} must have ${min} to ${max} characters.`);
  return text;
}

function uuids(values: unknown, min: number, max: number, label: string) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be a list.`);
  const ids = values.map(id => (isUuid(id) ? id.toLowerCase() : ""));
  if (ids.length < min || ids.length > max || ids.includes("") || new Set(ids).size !== ids.length)
    throw new TypeError(`${label} must have ${min} to ${max} distinct UUIDs.`);
  return ids;
}

export function normalizedDraftUpdate(command: UpdateManagedContractDraftCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "validFrom", "validTo", "currencyCode", "terms",
      "rates", "chargeRates"]))
    throw new TypeError("The draft is invalid.");
  const validTo = command.validTo == null || command.validTo === "" ? null : command.validTo;
  if (!isDate(command.validFrom) || validTo !== null && (!isDate(validTo) || validTo < command.validFrom) ||
      !["USD", "DOP"].includes(command.currencyCode) || !Array.isArray(command.rates) || command.rates.length < 1 ||
      command.rates.length > 100)
    throw new TypeError("The draft dates, currency or rates are invalid.");
  const rates = command.rates.map(rate => {
    if (!isRecord(rate) || !hasOnlyKeys(rate, ["id", "billingUnit", "unitPrice", "minimumQuantity", "isConfirmed"]) ||
        !isUuid(rate.id) || !isText(rate.billingUnit, 32) || !isAmount(rate.unitPrice, 900_000_000_000) ||
        !isAmount(rate.minimumQuantity, 900_000_000) || typeof rate.isConfirmed !== "boolean")
      throw new TypeError("A draft rate is invalid.");
    return { id: rate.id.toLowerCase(), billingUnit: rate.billingUnit.trim(), unitPrice: rate.unitPrice,
      minimumQuantity: rate.minimumQuantity, isConfirmed: rate.isConfirmed };
  });
  if (new Set(rates.map(rate => rate.id)).size !== rates.length) throw new TypeError("Draft rates repeat.");
  let chargeRates: { chargeId: string; isExcluded: boolean; value: number | null }[] | null = null;
  if (command.chargeRates != null) {
    if (!Array.isArray(command.chargeRates) || command.chargeRates.length > 100)
      throw new TypeError("The draft charges are invalid.");
    chargeRates = command.chargeRates.map(charge => {
      if (!isRecord(charge) || !hasOnlyKeys(charge, ["chargeId", "isExcluded", "value"]) || !isUuid(charge.chargeId) ||
          typeof charge.isExcluded !== "boolean" ||
          (charge.isExcluded ? charge.value != null : !isAmount(charge.value, 900_000_000)))
        throw new TypeError("A draft charge is invalid.");
      return { chargeId: charge.chargeId.toLowerCase(), isExcluded: charge.isExcluded,
        value: charge.isExcluded ? null : charge.value as number };
    });
    if (new Set(chargeRates.map(charge => charge.chargeId)).size !== chargeRates.length)
      throw new TypeError("Draft charges repeat.");
  }
  return { expectedVersion: expectedVersion(command.expectedVersion), validFrom: command.validFrom, validTo,
    currencyCode: command.currencyCode, terms: boundedText(command.terms, 1, 10_000, "terms"), rates, chargeRates };
}

export function normalizedDraftSubmission(command: SubmitManagedContractDraftCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion"])) throw new TypeError("The submission is invalid.");
  return { expectedVersion: expectedVersion(command.expectedVersion) };
}

export function normalizedDraftScope(command: SetContractDraftScopeCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "serviceIds", "stationIds"]))
    throw new TypeError("The draft scope is invalid.");
  return { expectedVersion: expectedVersion(command.expectedVersion),
    serviceIds: uuids(command.serviceIds, 1, 100, "serviceIds"), stationIds: uuids(command.stationIds, 1, 30, "stationIds") };
}

export function normalizedDraftDiscard(command: DiscardContractDraftCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "reason"])) throw new TypeError("The discard is invalid.");
  return { expectedVersion: expectedVersion(command.expectedVersion), reason: boundedText(command.reason, 5, 500, "reason") };
}

export function normalizedDraftMessage(command: ContractDraftMessageCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "body"])) throw new TypeError("The message is invalid.");
  return { expectedVersion: expectedVersion(command.expectedVersion), body: boundedText(command.body, 1, 2000, "body") };
}
