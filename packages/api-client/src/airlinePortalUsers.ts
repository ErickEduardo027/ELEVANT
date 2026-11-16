/**
 * The airline's own portal users (phase 2, block E, 2-N20). Every portal user reads the list and what it may do
 * (`me`); a representative invites users by email, deactivates and reactivates them and marks signers, never itself
 * nor another representative (`portal_user_protected`). Only representatives and signers sign contracts and submit
 * the JAC permit (`signer_required`). Commands carry an Idempotency-Key and, for an existing user, its `version`.
 */
import type { AirlinePortalUserData, AirlinePortalUsersData } from "../generated/elevant-api";

export const AIRLINE_PORTAL_USER_STATUSES = ["Active", "Disabled"] as const;
export type AirlinePortalUserStatus = (typeof AIRLINE_PORTAL_USER_STATUSES)[number];

/** A representative invites a user by email (it activates its own account); `signer` lets it sign from the start. */
export interface InviteAirlinePortalUserCommand {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly signer?: boolean;
}

/** Deactivates or reactivates a portal user with the version on screen. */
export interface SetAirlinePortalUserStatusCommand {
  readonly isActive: boolean;
  readonly expectedVersion: string;
}

/** Lets a portal user sign contracts and submit the JAC permit, or takes it back, with the version on screen. */
export interface SetAirlinePortalUserSignerCommand {
  readonly signer: boolean;
  readonly expectedVersion: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value) && value.toLowerCase() !== EMPTY_UUID;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isTimestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isOptional = <T>(value: unknown, valid: (item: unknown) => item is T) =>
  value === undefined || value === null || valid(value);
const isName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 100;

/** The invitation body: trimmed names (2 to 100 characters), the email and whether the user signs. */
export function normalizedInviteAirlinePortalUser(command: InviteAirlinePortalUserCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["firstName", "lastName", "email", "signer"]) ||
      !isName(command.firstName) || !isName(command.lastName) || typeof command.email !== "string" ||
      command.email.trim().length > 256 || !EMAIL.test(command.email.trim()) ||
      (command.signer !== undefined && typeof command.signer !== "boolean"))
    throw new TypeError("The portal user invitation is invalid.");
  return { firstName: command.firstName.trim(), lastName: command.lastName.trim(), email: command.email.trim(),
    signer: command.signer === true };
}

export function normalizedAirlinePortalUserStatus(command: SetAirlinePortalUserStatusCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["isActive", "expectedVersion"]) ||
      typeof command.isActive !== "boolean" || !isText(command.expectedVersion, 64))
    throw new TypeError("The portal user status change is invalid.");
  return { isActive: command.isActive, expectedVersion: command.expectedVersion };
}

export function normalizedAirlinePortalUserSigner(command: SetAirlinePortalUserSignerCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["signer", "expectedVersion"]) ||
      typeof command.signer !== "boolean" || !isText(command.expectedVersion, 64))
    throw new TypeError("The portal signer change is invalid.");
  return { signer: command.signer, expectedVersion: command.expectedVersion };
}

const USER_KEYS = ["id", "firstName", "lastName", "email", "status", "invitationPending", "representative", "signer",
  "lastLoginAt", "version"] as const;

/** A portal user of the airline; `userId` checks the answer of a command is the user it changed. */
export function isAirlinePortalUser(value: unknown, userId?: string): value is AirlinePortalUserData {
  return isRecord(value) && hasOnlyKeys(value, USER_KEYS) && isUuid(value.id) &&
    (userId === undefined || value.id.toLowerCase() === userId.toLowerCase()) && isText(value.firstName, 100) &&
    isText(value.lastName, 100) && typeof value.email === "string" && value.email.length <= 256 &&
    typeof value.status === "string" && (AIRLINE_PORTAL_USER_STATUSES as readonly string[]).includes(value.status) &&
    typeof value.invitationPending === "boolean" && typeof value.representative === "boolean" &&
    typeof value.signer === "boolean" && isOptional(value.lastLoginAt, isTimestamp) && isText(value.version, 64);
}

/** The caller's capabilities and every user of its airline, each once; a representative always signs. */
export function isAirlinePortalUsers(value: unknown): value is AirlinePortalUsersData {
  if (!isRecord(value) || !hasOnlyKeys(value, ["me", "users"]) || !isRecord(value.me) ||
      !hasOnlyKeys(value.me, ["accountId", "representative", "signer", "canSign", "canManageUsers"]) ||
      !isUuid(value.me.accountId) || typeof value.me.representative !== "boolean" || typeof value.me.signer !== "boolean" ||
      value.me.canSign !== (value.me.representative || value.me.signer) ||
      value.me.canManageUsers !== value.me.representative || !Array.isArray(value.users) || value.users.length > 500)
    return false;
  const seen = new Set<string>();
  return value.users.every(user => {
    if (!isAirlinePortalUser(user) || seen.has(user.id.toLowerCase())) return false;
    seen.add(user.id.toLowerCase());
    return true;
  });
}
