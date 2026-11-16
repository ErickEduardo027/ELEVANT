/**
 * Catalog of services and service closures (phase 1, block D). «Ocultar del catálogo público» is an update that
 * clears `isPublic` and keeps the service operable; «Dar de baja» is its own command with a reason, refused while a
 * contract in force or in approval uses the service (1-N03). A closure is decided, and its service republished, with
 * an Idempotency-Key and the version on screen; a retired service is reactivated first (1-N11).
 */
import type { ManagedServiceData, ServiceClosureData } from "../generated/elevant-api";

/** Statuses of an OCC closure request. */
export const SERVICE_CLOSURE_STATUSES = ["Pending", "Approved", "Denied"] as const;
export type ServiceClosureStatus = (typeof SERVICE_CLOSURE_STATUSES)[number];

/** Bounds of a retirement, closure or reopening reason, the same as the API applies. */
export const SERVICE_REASON_MIN_LENGTH = 10;
export const SERVICE_REASON_MAX_LENGTH = 1000;

/**
 * The edit form of a service: hides it, shows it or reactivates it, never retires it. `version` is the service
 * rowversion on screen.
 */
export interface UpdateManagedServiceCommand {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly billingUnit: string;
  readonly imageUrl?: string | null;
  readonly videoUrl?: string | null;
  readonly displayOrder: number;
  readonly isPublic: boolean;
  readonly isActive: boolean;
  readonly version: string;
}

/** «Dar de baja»: the version on screen and the reason. */
export interface RetireManagedServiceCommand {
  readonly expectedVersion: string;
  readonly reason: string;
}

/** Approves or denies (with a reason) the closure request whose `version` is on screen. */
export interface DecideServiceClosureCommand {
  readonly approve: boolean;
  readonly reason?: string | null;
  readonly version: string;
}

/** Republishes the service its approved closure hid: the reason and the service version on screen. */
export interface ReopenServiceCommand {
  readonly reason: string;
  readonly serviceVersion: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const SERVICE_CODE = /^[A-Z0-9-]{1,40}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/;
const MANAGED_SERVICE_KEYS = ["id", "code", "name", "description", "billingUnit", "imageUrl", "videoUrl", "displayOrder",
  "isPublic", "isActive", "version"] as const;
const UPDATE_KEYS = ["code", "name", "description", "billingUnit", "imageUrl", "videoUrl", "displayOrder", "isPublic",
  "isActive", "version"] as const;
const CLOSURE_KEYS = ["id", "serviceId", "serviceName", "reason", "status", "requestedBy", "requestedAt", "decisionReason",
  "decidedBy", "decidedAt", "reopenedAt", "reopenReason", "isCurrentlyPublic", "isServiceActive", "serviceVersion",
  "version"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value) && value !== EMPTY_UUID;
const sameId = (value: string, expected: string | undefined) =>
  expected === undefined || value.toLowerCase() === expected.toLowerCase();
const isVersion = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isOptionalText = (value: unknown, max: number) =>
  value === undefined || value === null || (typeof value === "string" && value.length <= max);
const isInstant = (value: unknown): value is string =>
  typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
const isOptionalInstant = (value: unknown) => value === undefined || value === null || isInstant(value);
const isOptionalUuid = (value: unknown) => value === undefined || value === null || isUuid(value);

/** A service of the managed catalog; with `id`, the one the command was about. */
export function isManagedService(value: unknown, id?: string): value is ManagedServiceData {
  return isRecord(value) && hasOnlyKeys(value, MANAGED_SERVICE_KEYS) && isUuid(value.id) && sameId(value.id, id) &&
    isText(value.code, 40) && isText(value.name, 160) && typeof value.description === "string" &&
    value.description.length <= 500 && isText(value.billingUnit, 64) && isOptionalText(value.imageUrl, 512) &&
    isOptionalText(value.videoUrl, 512) && Number.isInteger(value.displayOrder) &&
    (value.displayOrder as number) >= 0 && (value.displayOrder as number) <= 10_000 &&
    typeof value.isPublic === "boolean" && typeof value.isActive === "boolean" && isVersion(value.version);
}

/**
 * A closure request with the state of its service (`isCurrentlyPublic`, `isServiceActive`); with `expected`, the
 * request (`id`) or the service (`serviceId`) the command was about.
 */
export function isServiceClosure(value: unknown, expected: { readonly id?: string; readonly serviceId?: string } = {}):
  value is ServiceClosureData {
  return isRecord(value) && hasOnlyKeys(value, CLOSURE_KEYS) && isUuid(value.id) && sameId(value.id, expected.id) &&
    isUuid(value.serviceId) && sameId(value.serviceId, expected.serviceId) && isText(value.serviceName, 160) &&
    isText(value.reason, SERVICE_REASON_MAX_LENGTH) &&
    SERVICE_CLOSURE_STATUSES.includes(value.status as ServiceClosureStatus) && isUuid(value.requestedBy) &&
    isInstant(value.requestedAt) && isOptionalText(value.decisionReason, SERVICE_REASON_MAX_LENGTH) &&
    isOptionalUuid(value.decidedBy) && isOptionalInstant(value.decidedAt) && isOptionalInstant(value.reopenedAt) &&
    isOptionalText(value.reopenReason, SERVICE_REASON_MAX_LENGTH) && typeof value.isCurrentlyPublic === "boolean" &&
    typeof value.isServiceActive === "boolean" && isVersion(value.serviceVersion) && isVersion(value.version);
}

function reasonOf(value: unknown, field: string) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < SERVICE_REASON_MIN_LENGTH || reason.length > SERVICE_REASON_MAX_LENGTH)
    throw new TypeError(`${field} must have ${SERVICE_REASON_MIN_LENGTH} to ${SERVICE_REASON_MAX_LENGTH} characters.`);
  return reason;
}

function mediaOf(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length > 512) throw new TypeError(`${field} is invalid.`);
  return value.trim() || null;
}

export function normalizedManagedServiceUpdate(command: UpdateManagedServiceCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, UPDATE_KEYS)) throw new TypeError("The service update is invalid.");
  const code = typeof command.code === "string" ? command.code.trim().toUpperCase() : "";
  const name = typeof command.name === "string" ? command.name.trim() : "";
  const description = typeof command.description === "string" ? command.description.trim() : "";
  const billingUnit = typeof command.billingUnit === "string" ? command.billingUnit.trim() : "";
  if (!SERVICE_CODE.test(code) || !isText(name, 160) || !isText(description, 500) || !isText(billingUnit, 32) ||
      !Number.isInteger(command.displayOrder) || command.displayOrder < 0 || command.displayOrder > 10_000 ||
      typeof command.isPublic !== "boolean" || typeof command.isActive !== "boolean" || !isVersion(command.version))
    throw new TypeError("The service update is invalid.");
  return {
    code, name, description, billingUnit, imageUrl: mediaOf(command.imageUrl, "imageUrl"),
    videoUrl: mediaOf(command.videoUrl, "videoUrl"), displayOrder: command.displayOrder, isPublic: command.isPublic,
    isActive: command.isActive, version: command.version,
  };
}

export function normalizedServiceRetirement(command: RetireManagedServiceCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "reason"]) || !isVersion(command.expectedVersion))
    throw new TypeError("The retirement is invalid.");
  return { expectedVersion: command.expectedVersion, reason: reasonOf(command.reason, "reason") };
}

export function normalizedClosureDecision(command: DecideServiceClosureCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["approve", "reason", "version"]) ||
      typeof command.approve !== "boolean" || !isVersion(command.version))
    throw new TypeError("The closure decision is invalid.");
  if (command.reason !== undefined && command.reason !== null && typeof command.reason !== "string")
    throw new TypeError("The closure decision is invalid.");
  // A denial explains itself; an approval may add a note.
  const note = command.reason?.trim() ?? "";
  if (note.length > SERVICE_REASON_MAX_LENGTH) throw new TypeError("reason is too long.");
  const reason = command.approve ? note || null : reasonOf(note, "reason");
  return { approve: command.approve, reason, version: command.version };
}

export function normalizedServiceReopen(command: ReopenServiceCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["reason", "serviceVersion"]) || !isVersion(command.serviceVersion))
    throw new TypeError("The reopening is invalid.");
  return { reason: reasonOf(command.reason, "reason"), serviceVersion: command.serviceVersion };
}
