/**
 * Contratos' review of the public commercial requests (phase 1, block A): the paged inbox and the
 * commands that verify the airline, confirm the representative, cancel and decide. Every command
 * carries an Idempotency-Key and the request version the reviewer saw.
 */
import type {
  CommercialIdResponse,
  CommercialInboxData,
  ListCommercialRequestInboxParams,
} from "../generated/elevant-api";

export const COMMERCIAL_REQUEST_STATUSES = ["Pending", "InReview", "Approved", "Rejected", "Cancelled"] as const;
export type CommercialRequestStatus = (typeof COMMERCIAL_REQUEST_STATUSES)[number];
/** «Open» lists pending and in-review requests, oldest first; «All» every status. */
export const COMMERCIAL_INBOX_FILTERS = ["Open", "All", ...COMMERCIAL_REQUEST_STATUSES] as const;
export type CommercialInboxFilter = (typeof COMMERCIAL_INBOX_FILTERS)[number];

export interface CommercialInboxQuery {
  readonly status?: CommercialInboxFilter;
  readonly search?: string | null;
  readonly page?: number;
  readonly limit?: number;
}

/** Verified identity of the request's airline; for a proposal, the profile to link instead. */
export interface VerifyCommercialRequestAirlineCommand {
  readonly expectedVersion: string;
  readonly linkProfileId?: string | null;
  readonly legalName?: string | null;
  readonly countryCode?: string | null;
  readonly iataCode?: string | null;
  readonly icaoCode?: string | null;
  readonly verificationSourceUrl?: string | null;
}

export interface ConfirmCommercialRepresentativeCommand {
  readonly expectedVersion: string;
  readonly note: string;
}

export interface CancelCommercialRequestCommand {
  readonly expectedVersion: string;
  readonly reason: string;
}

export interface DecideCommercialRequestCommand {
  readonly approve: boolean;
  readonly reason?: string | null;
  readonly stationIds: readonly string[];
  readonly expectedVersion: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isOptionalString = (value: unknown, max: number) =>
  value === undefined || value === null || typeof value === "string" && value.length <= max;
const isOptional = (value: unknown, predicate: (candidate: unknown) => boolean) =>
  value === undefined || value === null || predicate(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
const isInstant = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  !Number.isNaN(Date.parse(value));
const isVersion = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);

const REQUEST_KEYS = ["id", "reference", "airline", "airlineProfileId", "legalName", "countryCode", "iataCode",
  "icaoCode", "logoUrl", "airlineVerified", "verificationSourceUrl", "airlineWebsiteUrl", "representativeName",
  "representativeTitle", "representativeEmail", "representativePhone", "representativeNationalityCode",
  "representativeAddress", "representativeCountry", "representativeProvince", "representativeMunicipality",
  "representativeDistrict", "representativeDocumentType", "representativeDocumentNumber", "authorityDeclared",
  "status", "submittedAt", "reviewedAt", "cancelledAt", "decisionReason", "contractId", "representativeConfirmation",
  "proposedAirline", "existingCustomer", "services", "version"] as const;

const isConfirmation = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["confirmedAt", "confirmedBy", "note"]) && isInstant(value.confirmedAt) &&
  isOptionalString(value.confirmedBy, 400) && typeof value.confirmedBy === "string" && isText(value.note, 1000);

const isProposal = (value: unknown) => isRecord(value) &&
  hasOnlyKeys(value, ["name", "countryCode", "iataCode", "icaoCode", "websiteUrl"]) && isText(value.name, 160) &&
  isOptionalString(value.countryCode, 2) && isOptionalString(value.iataCode, 2) && isText(value.icaoCode, 3) &&
  isOptionalString(value.websiteUrl, 512);

// A service the catalog no longer resolves is sent with the empty UUID; it is still a request line.
const isService = (value: unknown) => isRecord(value) && hasOnlyKeys(value, ["serviceId", "name", "unit"]) &&
  typeof value.serviceId === "string" && UUID.test(value.serviceId) && typeof value.name === "string" &&
  typeof value.unit === "string";

const isInboxRequest = (value: unknown) => isRecord(value) && hasOnlyKeys(value, REQUEST_KEYS) &&
  isUuid(value.id) && isText(value.reference, 128) && isText(value.airline, 200) &&
  isOptional(value.airlineProfileId, isUuid) && isOptionalString(value.legalName, 200) &&
  isOptionalString(value.countryCode, 2) && isOptionalString(value.iataCode, 2) &&
  isOptionalString(value.icaoCode, 3) && isOptionalString(value.logoUrl, 512) &&
  typeof value.airlineVerified === "boolean" && isOptionalString(value.verificationSourceUrl, 512) &&
  isOptionalString(value.airlineWebsiteUrl, 512) && isText(value.representativeName, 160) &&
  typeof value.representativeTitle === "string" && isText(value.representativeEmail, 256) &&
  typeof value.representativePhone === "string" && isOptionalString(value.representativeNationalityCode, 2) &&
  isOptionalString(value.representativeAddress, 250) && isOptionalString(value.representativeCountry, 80) &&
  isOptionalString(value.representativeProvince, 80) && isOptionalString(value.representativeMunicipality, 80) &&
  isOptionalString(value.representativeDistrict, 80) && isOptionalString(value.representativeDocumentType, 24) &&
  isOptionalString(value.representativeDocumentNumber, 40) && typeof value.authorityDeclared === "boolean" &&
  (COMMERCIAL_REQUEST_STATUSES as readonly unknown[]).includes(value.status) && isInstant(value.submittedAt) &&
  isOptional(value.reviewedAt, isInstant) && isOptional(value.cancelledAt, isInstant) &&
  isOptionalString(value.decisionReason, 1000) && isOptional(value.contractId, isUuid) &&
  isOptional(value.representativeConfirmation, isConfirmation) && isOptional(value.proposedAirline, isProposal) &&
  typeof value.existingCustomer === "boolean" && Array.isArray(value.services) && value.services.every(isService) &&
  isVersion(value.version);

export function isCommercialInboxData(value: unknown, query: ListCommercialRequestInboxParams):
  value is CommercialInboxData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["page", "limit", "total", "hasMore", "counts", "requests"]) ||
      value.page !== (query.page ?? 1) || value.limit !== (query.limit ?? 25) || !isCount(value.total) ||
      typeof value.hasMore !== "boolean" || !isRecord(value.counts) ||
      !hasOnlyKeys(value.counts, ["pending", "inReview", "approved", "rejected", "cancelled"]) ||
      !["pending", "inReview", "approved", "rejected", "cancelled"].every(key => isCount((value.counts as Record<string, unknown>)[key])) ||
      !Array.isArray(value.requests) || value.requests.length > (query.limit ?? 25) ||
      !value.requests.every(isInboxRequest))
    return false;
  const ids = value.requests.map(item => String((item as Record<string, unknown>).id).toLowerCase());
  return new Set(ids).size === ids.length;
}

export function isCommercialIdResponse(value: unknown, id?: string): value is CommercialIdResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id"]) && isUuid(value.id) &&
    (id === undefined || value.id.toLowerCase() === id.toLowerCase());
}

export function normalizedCommercialInboxQuery(query: CommercialInboxQuery = {}): ListCommercialRequestInboxParams {
  const raw: unknown = query;
  if (!isRecord(raw) || !hasOnlyKeys(raw, ["status", "search", "page", "limit"]))
    throw new TypeError("The commercial inbox query is invalid.");
  const status = query.status ?? "Open";
  const page = query.page ?? 1;
  const limit = query.limit ?? 25;
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (!(COMMERCIAL_INBOX_FILTERS as readonly unknown[]).includes(status) || !Number.isInteger(page) || page < 1 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50 || (page - 1) * limit > 2_147_483_647 ||
      query.search != null && typeof query.search !== "string" || search.length > 100)
    throw new TypeError("The commercial inbox query is invalid.");
  return { status, page, limit, ...(search ? { search } : {}) };
}

function expectedVersion(value: unknown) {
  if (!isVersion(value) || value.length === 0) throw new TypeError("expectedVersion must be the request version.");
  return value;
}

function boundedText(value: unknown, min: number, max: number, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) throw new TypeError(`${label} must have ${min} to ${max} characters.`);
  return text;
}

const blank = (value: unknown) => value === undefined || value === null || typeof value === "string" && value.trim() === "";

export function normalizedAirlineVerification(command: VerifyCommercialRequestAirlineCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "linkProfileId", "legalName", "countryCode",
      "iataCode", "icaoCode", "verificationSourceUrl"]))
    throw new TypeError("The airline verification is invalid.");
  const version = expectedVersion(command.expectedVersion);
  const link = blank(command.linkProfileId) ? null : command.linkProfileId;
  if (link !== null && !isUuid(link)) throw new TypeError("linkProfileId must be a canonical UUID.");
  const identityGiven = [command.legalName, command.countryCode, command.iataCode, command.icaoCode,
    command.verificationSourceUrl].some(value => !blank(value));
  if (!identityGiven) {
    if (link === null) throw new TypeError("The airline verification needs an identity or a profile to link.");
    return { expectedVersion: version, linkProfileId: link.toLowerCase() };
  }
  const legalName = boundedText(command.legalName, 1, 200, "legalName");
  const countryCode = String(command.countryCode ?? "").trim().toUpperCase();
  const iataCode = blank(command.iataCode) ? null : String(command.iataCode).trim().toUpperCase();
  const icaoCode = String(command.icaoCode ?? "").trim().toUpperCase();
  const source = String(command.verificationSourceUrl ?? "").trim();
  let url: URL | null = null;
  try { url = new URL(source); } catch { url = null; }
  if (!/^[A-Z]{2}$/.test(countryCode) || iataCode !== null && (!/^[A-Z0-9]{2}$/.test(iataCode) || /^\d{2}$/.test(iataCode)) ||
      !/^[A-Z]{3}$/.test(icaoCode) || source.length > 512 || url?.protocol !== "https:" || url.username || url.password)
    throw new TypeError("The airline identity is invalid.");
  return { expectedVersion: version, linkProfileId: link?.toLowerCase() ?? null, legalName, countryCode, iataCode,
    icaoCode, verificationSourceUrl: source };
}

export function normalizedRepresentativeConfirmation(command: ConfirmCommercialRepresentativeCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "note"]))
    throw new TypeError("The representative confirmation is invalid.");
  return { expectedVersion: expectedVersion(command.expectedVersion), note: boundedText(command.note, 5, 1000, "note") };
}

export function normalizedRequestCancellation(command: CancelCommercialRequestCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "reason"]))
    throw new TypeError("The cancellation is invalid.");
  return { expectedVersion: expectedVersion(command.expectedVersion),
    reason: boundedText(command.reason, 5, 1000, "reason") };
}

export function normalizedCommercialDecision(command: DecideCommercialRequestCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["approve", "reason", "stationIds", "expectedVersion"]) ||
      typeof command.approve !== "boolean" || !Array.isArray(command.stationIds))
    throw new TypeError("The commercial decision is invalid.");
  const version = expectedVersion(command.expectedVersion);
  if (!command.approve)
    return { approve: false, reason: boundedText(command.reason, 1, 1000, "reason"), stationIds: [],
      expectedVersion: version };
  const stations = command.stationIds.map(id => (isUuid(id) ? id.toLowerCase() : ""));
  if (stations.length < 1 || stations.length > 30 || stations.includes("") || new Set(stations).size !== stations.length)
    throw new TypeError("An approval needs between 1 and 30 distinct stations.");
  return { approve: true, reason: null, stationIds: stations, expectedVersion: version };
}
