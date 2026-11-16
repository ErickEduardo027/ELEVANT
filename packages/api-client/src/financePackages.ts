/**
 * Finance packages and contract amendments (phase 1, block C): Finance discards a package draft or retires
 * a published package with a reason (1-N27), and Contratos amends a contract from «Vigente desde» (1-C).
 * Every command carries an Idempotency-Key and the version, or the contract status, the user saw.
 */
import type { FinancePackageIdResponse } from "../generated/elevant-api";

/** Statuses of a Finance package version; Discarded and Retired close it (1-N27). */
export const FINANCE_PACKAGE_STATUSES = ["Draft", "Published", "Superseded", "Discarded", "Retired"] as const;
export type FinancePackageStatus = (typeof FINANCE_PACKAGE_STATUSES)[number];

/** Contract statuses the user may have seen; only Active and Suspended contracts accept an amendment. */
export const CONTRACT_LIFECYCLE_STATUSES = ["Draft", "Active", "Suspended", "Terminated", "Expired"] as const;
export type ContractLifecycleStatus = (typeof CONTRACT_LIFECYCLE_STATUSES)[number];

/** Discards a package draft or retires a published package, with the version on screen and a reason. */
export interface FinancePackageLifecycleCommand {
  readonly expectedVersion: string;
  readonly reason: string;
}

/** Amends the latest approved version: the contract status on screen and the start of the new prices. */
export interface CreateContractAmendmentCommand {
  readonly expectedStatus: ContractLifecycleStatus;
  readonly validFrom: string;
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
const isVersion = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const isDate = (value: unknown): value is string =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** The id of the package, or of the new amendment draft, the command answered. */
export function isFinancePackageIdResponse(value: unknown, id?: string): value is FinancePackageIdResponse {
  return isRecord(value) && hasOnlyKeys(value, ["id"]) && isUuid(value.id) &&
    (id === undefined || value.id.toLowerCase() === id.toLowerCase());
}

export function normalizedPackageLifecycle(command: FinancePackageLifecycleCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedVersion", "reason"]) || !isVersion(command.expectedVersion))
    throw new TypeError("The package command is invalid.");
  const reason = typeof command.reason === "string" ? command.reason.trim() : "";
  if (reason.length < 5 || reason.length > 500) throw new TypeError("reason must have 5 to 500 characters.");
  return { expectedVersion: command.expectedVersion, reason };
}

export function normalizedContractAmendment(command: CreateContractAmendmentCommand) {
  if (!isRecord(command) || !hasOnlyKeys(command, ["expectedStatus", "validFrom"]) ||
      !CONTRACT_LIFECYCLE_STATUSES.includes(command.expectedStatus as ContractLifecycleStatus) || !isDate(command.validFrom))
    throw new TypeError("The amendment is invalid.");
  return { expectedStatus: command.expectedStatus, validFrom: command.validFrom };
}
