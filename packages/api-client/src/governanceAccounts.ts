/**
 * Superadministración, portal accounts and emails (phase 1, block E). Provisioning creates the airline's
 * portal account or links an existing one (1-N13); a temporary password closes a pending invitation (1-N12);
 * the outbox shows why an email was not sent and what it was about (1-N22); an issued invoice reads its own
 * email status (1-N08). Every command carries an Idempotency-Key and the version on screen.
 */
import type {
  CommercialAccountResponse,
  EmailOutboxPageResponse,
  InvoiceEmailStatusResponse,
  ListEmailOutboxParams,
  ProvisioningTaskData,
} from "../generated/elevant-api";

/** Delivery states of an outbox email; `Discarded` was never sent (expired or replaced). */
export const EMAIL_DELIVERY_STATUSES = ["Pending", "Sent", "Failed", "Discarded"] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];
export const EMAIL_OUTBOX_FILTERS = ["All", ...EMAIL_DELIVERY_STATUSES] as const;
export type EmailOutboxFilter = (typeof EMAIL_OUTBOX_FILTERS)[number];
/** Normalized reasons of an email that was not sent; the provider's text is never returned. */
export const EMAIL_DELIVERY_REASONS = ["expired", "superseded", "invitation_closed", "smtp_rejected",
  "smtp_authentication", "smtp_unavailable", "attachment_unavailable", "send_failed"] as const;
export type EmailDeliveryReason = (typeof EMAIL_DELIVERY_REASONS)[number];
/** What an outbox email is about. */
export const EMAIL_REFERENCE_KINDS = ["contract", "invoice", "payment", "account", "request"] as const;
export type EmailReferenceKind = (typeof EMAIL_REFERENCE_KINDS)[number];

export interface EmailOutboxQuery {
  readonly status?: EmailOutboxFilter;
  readonly page?: number;
  readonly limit?: number;
}

/**
 * Creates the airline's portal account. Without `temporaryPassword` the representative is invited by email;
 * `expectedVersion` is the request version of the provisioning task.
 */
export interface ProvisionAirlineAccountCommand {
  readonly email: string;
  readonly temporaryPassword?: string | null;
  readonly expectedVersion: string;
}

/** Links the existing portal account of `email` to the request; its credentials do not change. */
export interface LinkProvisioningAccountCommand {
  readonly email: string;
  readonly expectedVersion: string;
}

/** Queues a new activation link for the account whose version is on screen. */
export interface ResendAirlineInvitationCommand {
  readonly expectedVersion: string;
}

/** A temporary password the user must change at the next sign-in; `expectedVersion` is the account version. */
export interface ResetClientUserPasswordCommand {
  readonly temporaryPassword: string;
  readonly expectedVersion: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TASK_KEYS = ["requestId", "reference", "airline", "representativeName", "suggestedEmail", "contractId",
  "approvedAt", "version"] as const;
const OUTBOX_KEYS = ["smtpConfigured", "page", "limit", "hasMore", "entries"] as const;
const ENTRY_KEYS = ["id", "recipient", "purpose", "status", "attempts", "createdAt", "sentAt", "updatedAt", "reason",
  "reference"] as const;
const REFERENCE_KEYS = ["kind", "id", "label", "context"] as const;
const INVOICE_STATUS_KEYS = ["invoiceId", "smtpConfigured", "deliveries"] as const;
const DELIVERY_KEYS = ["recipient", "status", "reason", "createdAt", "sentAt"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const sameId = (value: string, expected: string | undefined) =>
  expected === undefined || value.toLowerCase() === expected.toLowerCase();
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isOptionalText = (value: unknown, max: number) =>
  value === undefined || value === null || (typeof value === "string" && value.length <= max);
const isInstant = (value: unknown): value is string =>
  typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
const isOptionalInstant = (value: unknown) => value === undefined || value === null || isInstant(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
const isVersion = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const isReason = (value: unknown) =>
  value === undefined || value === null || (EMAIL_DELIVERY_REASONS as readonly unknown[]).includes(value);
const isStatus = (value: unknown) => (EMAIL_DELIVERY_STATUSES as readonly unknown[]).includes(value);

export function isProvisioningTask(value: unknown): value is ProvisioningTaskData {
  return isRecord(value) && hasOnlyKeys(value, TASK_KEYS) && isUuid(value.requestId) && isText(value.reference, 128) &&
    isText(value.airline, 200) && isText(value.representativeName, 160) && isText(value.suggestedEmail, 256) &&
    isUuid(value.contractId) && isInstant(value.approvedAt) && isVersion(value.version);
}

export function isProvisioningTaskList(value: unknown): value is ProvisioningTaskData[] {
  if (!Array.isArray(value) || !value.every(isProvisioningTask)) return false;
  const ids = value.map(item => item.requestId.toLowerCase());
  return new Set(ids).size === ids.length;
}

export function isCommercialAccountResponse(value: unknown, accountId?: string): value is CommercialAccountResponse {
  return isRecord(value) && hasOnlyKeys(value, ["accountId"]) && isUuid(value.accountId) &&
    sameId(value.accountId, accountId);
}

const isReference = (value: unknown) => isRecord(value) && hasOnlyKeys(value, REFERENCE_KEYS) &&
  (EMAIL_REFERENCE_KINDS as readonly unknown[]).includes(value.kind) && (value.id === null || isUuid(value.id)) &&
  typeof value.label === "string" && value.label.length <= 400 && isOptionalText(value.context, 400);

const isOutboxEntry = (value: unknown) => isRecord(value) && hasOnlyKeys(value, ENTRY_KEYS) && isUuid(value.id) &&
  isText(value.recipient, 256) && isText(value.purpose, 24) && isStatus(value.status) && isCount(value.attempts) &&
  isInstant(value.createdAt) && isOptionalInstant(value.sentAt) && isInstant(value.updatedAt) && isReason(value.reason) &&
  (value.reference === null || value.reference === undefined || isReference(value.reference));

export function isEmailOutboxPage(value: unknown, query: ListEmailOutboxParams): value is EmailOutboxPageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, OUTBOX_KEYS) || typeof value.smtpConfigured !== "boolean" ||
      value.page !== (query.page ?? 1) || value.limit !== (query.limit ?? 25) || typeof value.hasMore !== "boolean" ||
      !Array.isArray(value.entries) || value.entries.length > (query.limit ?? 25) || !value.entries.every(isOutboxEntry))
    return false;
  // A filtered page lists that status only.
  const status = query.status ?? "All";
  return status === "All" || value.entries.every(entry => (entry as Record<string, unknown>).status === status);
}

const isDelivery = (value: unknown) => isRecord(value) && hasOnlyKeys(value, DELIVERY_KEYS) &&
  isText(value.recipient, 256) && isStatus(value.status) && isReason(value.reason) && isInstant(value.createdAt) &&
  isOptionalInstant(value.sentAt);

export function isInvoiceEmailStatus(value: unknown, invoiceId: string): value is InvoiceEmailStatusResponse {
  return isRecord(value) && hasOnlyKeys(value, INVOICE_STATUS_KEYS) && isUuid(value.invoiceId) &&
    sameId(value.invoiceId, invoiceId) && typeof value.smtpConfigured === "boolean" && Array.isArray(value.deliveries) &&
    value.deliveries.length <= 100 && value.deliveries.every(isDelivery);
}

export function normalizedEmailOutboxQuery(query: EmailOutboxQuery = {}): ListEmailOutboxParams {
  const raw: unknown = query;
  if (!isRecord(raw) || !hasOnlyKeys(raw, ["status", "page", "limit"]))
    throw new TypeError("The email outbox query is invalid.");
  const status = query.status ?? "All";
  const page = query.page ?? 1;
  const limit = query.limit ?? 25;
  if (!(EMAIL_OUTBOX_FILTERS as readonly unknown[]).includes(status) || !Number.isInteger(page) || page < 1 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50 || (page - 1) * limit > 2_147_483_647)
    throw new TypeError("The email outbox query is invalid.");
  return { status, page, limit };
}

function expectedVersion(value: unknown) {
  if (!isVersion(value)) throw new TypeError("expectedVersion must be the version on screen.");
  return value;
}

function emailAddress(value: unknown) {
  const email = typeof value === "string" ? value.trim() : "";
  if (email.length > 256 || !EMAIL.test(email)) throw new TypeError("The email address is invalid.");
  return email;
}

function temporaryPassword(value: unknown) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128)
    throw new TypeError("The temporary password is invalid.");
  return value;
}

export function normalizedProvisioning(command: ProvisionAirlineAccountCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["email", "temporaryPassword", "expectedVersion"]))
    throw new TypeError("The provisioning is invalid.");
  const email = emailAddress(command.email);
  const version = expectedVersion(command.expectedVersion);
  // An invitation sends no password at all; a temporary password travels only when chosen.
  return command.temporaryPassword === undefined || command.temporaryPassword === null || command.temporaryPassword === ""
    ? { email, expectedVersion: version }
    : { email, temporaryPassword: temporaryPassword(command.temporaryPassword), expectedVersion: version };
}

export function normalizedAccountLink(command: LinkProvisioningAccountCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["email", "expectedVersion"]))
    throw new TypeError("The account link is invalid.");
  return { email: emailAddress(command.email), expectedVersion: expectedVersion(command.expectedVersion) };
}

export function normalizedInvitationResend(command: ResendAirlineInvitationCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion"]))
    throw new TypeError("The invitation resend is invalid.");
  return { expectedVersion: expectedVersion(command.expectedVersion) };
}

export function normalizedClientPasswordReset(command: ResetClientUserPasswordCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["temporaryPassword", "expectedVersion"]))
    throw new TypeError("The password reset is invalid.");
  return { temporaryPassword: temporaryPassword(command.temporaryPassword),
    expectedVersion: expectedVersion(command.expectedVersion) };
}
