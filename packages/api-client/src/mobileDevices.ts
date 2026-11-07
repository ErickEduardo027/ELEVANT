/**
 * Shared ramp tablets (phase 2, block E, 2-N02). The tablet frees its binding when the agent signs out; the next agent
 * who signs in takes it unless the previous one is in the middle of an operation (`device_in_use_by_active_agent`).
 * OCC sees who holds each tablet of its station, frees one or revokes a lost one (`operations.devices.*`); its
 * commands carry an Idempotency-Key and the binding token on screen (`version`), which only moves when the tablet
 * changes hands or is revoked.
 */
import type { OccMobileDeviceData, OccMobileDevicesData } from "../generated/elevant-api";

/** Who holds the tablet: `Bound` to an agent, `Unbound` (free) or `Revoked` (lost, never registers again). */
export const OCC_MOBILE_DEVICE_STATUSES = ["Bound", "Unbound", "Revoked"] as const;
export type OccMobileDeviceStatus = (typeof OCC_MOBILE_DEVICE_STATUSES)[number];
export const MOBILE_PLATFORMS = ["Android", "Ios"] as const;

/**
 * The installation of this app; only the account that holds the tablet releases it (`device_not_bound`). The expected
 * version is the `lastSeenAt` of the newest registration the session confirmed. Each sign-in opens its own binding, so
 * a release that arrives after the agent signed in on the tablet again answers `version_conflict` and frees nothing;
 * the session's own writes never refuse it. Without a version only the holder is checked.
 */
export interface ReleaseMobileDeviceCommand {
  readonly installationId: string;
  readonly expectedVersion?: string | null;
}

/** OCC frees a tablet with the binding token on screen; the reason (5 to 500 characters) is optional. */
export interface UnbindOccMobileDeviceCommand {
  readonly expectedVersion: string;
  readonly reason?: string | null;
}

/**
 * OCC revokes a lost tablet with a reason (5 to 500 characters); the sessions of the account that held it last end,
 * also when OCC had freed it, unless that agent signed out of it.
 */
export interface RevokeOccMobileDeviceCommand {
  readonly expectedVersion: string;
  readonly reason: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value) && value.toLowerCase() !== EMPTY_UUID;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isOneOf = (value: unknown, options: readonly string[]) => typeof value === "string" && options.includes(value);
const isTimestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isOptional = <T>(value: unknown, valid: (item: unknown) => item is T) =>
  value === undefined || value === null || valid(value);

/** The opaque binding token OCC sends back; a screen never reads anything into it. */
export function isMobileDeviceVersion(value: unknown): value is string {
  return isText(value, 64);
}

function reasonOf(value: unknown, required: boolean) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim() && !required)) {
    if (required) throw new TypeError("reason must have 5 to 500 characters.");
    return null;
  }
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < 5 || reason.length > 500) throw new TypeError("reason must have 5 to 500 characters.");
  return reason;
}

/**
 * The body of a release: the installation of this app and, when the session confirmed a registration, its
 * `lastSeenAt` as the expected version. Without one the body is the installation alone.
 */
export function normalizedReleaseMobileDevice(command: ReleaseMobileDeviceCommand): ReleaseMobileDeviceCommand {
  if (!isRecord(command) || !hasOnlyKeys(command, ["installationId", "expectedVersion"]) ||
      !isUuid(command.installationId) ||
      !isOptional(command.expectedVersion, (version): version is string => isTimestamp(version) && isText(version, 64)))
    throw new TypeError("The tablet release is invalid.");
  const installationId = command.installationId.toLowerCase();
  return command.expectedVersion == null ? { installationId } : { installationId, expectedVersion: command.expectedVersion };
}

/** The body OCC sends to free a tablet: the token and the trimmed reason, if any. */
export function normalizedUnbindOccMobileDevice(command: UnbindOccMobileDeviceCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "reason"]) ||
      !isMobileDeviceVersion(command.expectedVersion))
    throw new TypeError("The tablet unbinding is invalid.");
  return { expectedVersion: command.expectedVersion, reason: reasonOf(command.reason, false) };
}

/** The body OCC sends to revoke a lost tablet: the token and the trimmed reason. */
export function normalizedRevokeOccMobileDevice(command: RevokeOccMobileDeviceCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "reason"]) ||
      !isMobileDeviceVersion(command.expectedVersion))
    throw new TypeError("The tablet revocation is invalid.");
  return { expectedVersion: command.expectedVersion, reason: reasonOf(command.reason, true) as string };
}

const DEVICE_KEYS = ["id", "platform", "deviceName", "appVersion", "operatingSystemVersion", "lastSeenAt", "status", "agent",
  "boundAt", "unboundAt", "revokedAt", "agentHasOperationInProgress", "version"] as const;

const isAgent = (value: unknown): value is Record<string, unknown> => isRecord(value) &&
  hasOnlyKeys(value, ["accountId", "rampAgentId", "name", "employeeNumber"]) && isUuid(value.accountId) &&
  isOptional(value.rampAgentId, isUuid) && isText(value.name, 260) &&
  isOptional(value.employeeNumber, (number): number is string => isText(number, 64));

/**
 * A tablet as OCC sees it. A bound tablet has its holder and when it was bound; only a revoked one has a revocation,
 * and only a bound one can be busy with an operation in progress.
 */
export function isOccMobileDevice(value: unknown, deviceId?: string): value is OccMobileDeviceData {
  if (!isRecord(value) || !hasOnlyKeys(value, DEVICE_KEYS) || !isUuid(value.id) ||
      (deviceId !== undefined && value.id.toLowerCase() !== deviceId.toLowerCase()) ||
      !isOneOf(value.platform, MOBILE_PLATFORMS) ||
      !isOptional(value.deviceName, (name): name is string => isText(name, 120)) || !isText(value.appVersion, 32) ||
      !isOptional(value.operatingSystemVersion, (version): version is string => isText(version, 64)) ||
      !isTimestamp(value.lastSeenAt) || !isOneOf(value.status, OCC_MOBILE_DEVICE_STATUSES) ||
      !isOptional(value.agent, isAgent) || !isOptional(value.boundAt, isTimestamp) ||
      !isOptional(value.unboundAt, isTimestamp) || !isOptional(value.revokedAt, isTimestamp) ||
      typeof value.agentHasOperationInProgress !== "boolean" || !isMobileDeviceVersion(value.version)) return false;
  if (value.status === "Bound") return isAgent(value.agent) && isTimestamp(value.boundAt) && value.unboundAt == null &&
    value.revokedAt == null;
  if (value.agentHasOperationInProgress) return false;
  return value.status === "Revoked" ? isTimestamp(value.revokedAt) : value.revokedAt == null;
}

/** The tablets of the station asked for, each once, and what the actor may do with them. */
export function isOccMobileDevices(value: unknown, stationId: string): value is OccMobileDevicesData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["stationId", "stationCode", "canUnbind", "canRevoke", "devices"]) ||
      !isUuid(value.stationId) || value.stationId.toLowerCase() !== stationId.toLowerCase() ||
      !isText(value.stationCode, 8) || typeof value.canUnbind !== "boolean" || typeof value.canRevoke !== "boolean" ||
      !Array.isArray(value.devices) || value.devices.length > 2000) return false;
  const seen = new Set<string>();
  return value.devices.every(device => {
    if (!isOccMobileDevice(device) || seen.has(device.id.toLowerCase())) return false;
    seen.add(device.id.toLowerCase());
    return true;
  });
}
