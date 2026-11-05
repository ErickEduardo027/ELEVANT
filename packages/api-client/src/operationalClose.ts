/**
 * Operational close OCC → Finance (ADR-0034): what OCC closes an operation with, its charge
 * adjustments, and Finance's ground time allowances and holiday calendar.
 */
import type {
  FinanceCloseRulesResponse,
  FinanceHolidayResponse,
  GroundTimeAllowanceResponse,
  OccReviewChargeAdjustResponse,
  OccReviewCloseResponse,
} from "../generated/elevant-api";

export const CHARGE_MARK_SOURCES = ["Agent", "Automatic", "Occ"] as const;
export type ChargeMarkSource = (typeof CHARGE_MARK_SOURCES)[number];
export const AIRCRAFT_SIZE_CATEGORIES = ["Narrowbody", "Widebody"] as const;
export type AircraftSizeCategory = (typeof AIRCRAFT_SIZE_CATEGORIES)[number];

export interface AddOccReviewChargeCommand {
  readonly submissionId: string;
  readonly serviceId: string;
  readonly chargeId: string;
  readonly reason: string;
}

export interface RemoveOccReviewChargeCommand {
  readonly submissionId: string;
  readonly reason: string;
}

export interface SetGroundTimeAllowanceCommand {
  readonly allowedMinutes: number;
  /** The version read; null only to create the category. */
  readonly version: string | null;
}

export interface AddFinanceHolidayCommand {
  readonly date: string;
  readonly name: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every(key => keys.includes(key));
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isOptionalText = (value: unknown, max: number) =>
  value === null || value === undefined || (typeof value === "string" && value.length <= max);
const isInstant = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isMinutes = (value: unknown) => value === null || value === undefined ||
  (typeof value === "number" && Number.isFinite(value) && value >= 0);
const isSource = (value: unknown): value is ChargeMarkSource =>
  typeof value === "string" && (CHARGE_MARK_SOURCES as readonly string[]).includes(value);
const isCategory = (value: unknown): value is AircraftSizeCategory =>
  typeof value === "string" && (AIRCRAFT_SIZE_CATEGORIES as readonly string[]).includes(value);
const isValidDate = (value: string) => DATE_ONLY.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** The close block of the OCC review detail; absent on servers before ADR-0034. */
export const isOccReviewClose = (value: unknown): value is OccReviewCloseResponse =>
  isRecord(value) &&
  hasOnlyKeys(value, ["milestones", "charges", "chargeOptions", "timing", "canAdjustCharges", "damageCount"]) &&
  Array.isArray(value.milestones) && value.milestones.length <= 100 &&
  value.milestones.every(item => isRecord(item) && hasOnlyKeys(item, ["code", "actualAt"]) &&
    isText(item.code, 40) && isInstant(item.actualAt)) &&
  Array.isArray(value.charges) && value.charges.length <= 500 &&
  value.charges.every(item => isRecord(item) &&
    hasOnlyKeys(item, ["markId", "serviceId", "serviceCode", "chargeId", "code", "name", "source", "appliedAt", "reason"]) &&
    isUuid(item.markId) && isUuid(item.serviceId) && typeof item.serviceCode === "string" && item.serviceCode.length <= 64 &&
    isUuid(item.chargeId) && isText(item.code, 64) && isText(item.name, 200) && isSource(item.source) &&
    isInstant(item.appliedAt) && isOptionalText(item.reason, 500)) &&
  Array.isArray(value.chargeOptions) && value.chargeOptions.length <= 200 &&
  value.chargeOptions.every(item => isRecord(item) &&
    hasOnlyKeys(item, ["chargeId", "code", "name", "appliesToAllServices", "serviceIds"]) &&
    isUuid(item.chargeId) && isText(item.code, 64) && isText(item.name, 200) &&
    typeof item.appliesToAllServices === "boolean" && Array.isArray(item.serviceIds) &&
    item.serviceIds.every(isUuid)) &&
  isRecord(value.timing) &&
  hasOnlyKeys(value.timing, ["groundMinutes", "allowedGroundMinutes", "arrivalDelayMinutes", "aircraftCategory"]) &&
  isMinutes(value.timing.groundMinutes) && isMinutes(value.timing.allowedGroundMinutes) &&
  isMinutes(value.timing.arrivalDelayMinutes) &&
  (value.timing.aircraftCategory === null || value.timing.aircraftCategory === undefined ||
    isCategory(value.timing.aircraftCategory)) &&
  typeof value.canAdjustCharges === "boolean" &&
  typeof value.damageCount === "number" && Number.isInteger(value.damageCount) && value.damageCount >= 0;

export const isOccReviewChargeAdjustResponse = (value: unknown): value is OccReviewChargeAdjustResponse =>
  isRecord(value) && hasOnlyKeys(value, ["reviewVersion"]) && typeof value.reviewVersion === "string" &&
  /^"[0-9a-f]{64}"$/.test(value.reviewVersion);

const isAllowance = (value: unknown): value is GroundTimeAllowanceResponse =>
  isRecord(value) && hasOnlyKeys(value, ["category", "allowedMinutes", "updatedAt", "version"]) &&
  isCategory(value.category) && typeof value.allowedMinutes === "number" && Number.isInteger(value.allowedMinutes) &&
  value.allowedMinutes >= 15 && value.allowedMinutes <= 720 && isInstant(value.updatedAt) &&
  isText(value.version, 64);

const isHoliday = (value: unknown): value is FinanceHolidayResponse =>
  isRecord(value) && hasOnlyKeys(value, ["id", "date", "name"]) && isUuid(value.id) &&
  typeof value.date === "string" && isValidDate(value.date) && isText(value.name, 120);

export const isGroundTimeAllowanceResponse = isAllowance;
export const isFinanceHolidayResponse = isHoliday;

export const isFinanceCloseRulesResponse = (value: unknown): value is FinanceCloseRulesResponse =>
  isRecord(value) && hasOnlyKeys(value, ["allowances", "holidays"]) &&
  Array.isArray(value.allowances) && value.allowances.length <= AIRCRAFT_SIZE_CATEGORIES.length &&
  value.allowances.every(isAllowance) &&
  Array.isArray(value.holidays) && value.holidays.length <= 400 && value.holidays.every(isHoliday);

const reasonOf = (value: unknown) => {
  const reason = typeof value === "string" ? value.trim() : "";
  return reason.length >= 8 && reason.length <= 500 ? reason : null;
};

export function normalizedAddCharge(command: AddOccReviewChargeCommand): AddOccReviewChargeCommand | null {
  const reason = reasonOf(command?.reason);
  return isRecord(command) && isUuid(command.submissionId) && isUuid(command.serviceId) && isUuid(command.chargeId) &&
    reason ? { submissionId: command.submissionId, serviceId: command.serviceId, chargeId: command.chargeId, reason } : null;
}

export function normalizedRemoveCharge(command: RemoveOccReviewChargeCommand): RemoveOccReviewChargeCommand | null {
  const reason = reasonOf(command?.reason);
  return isRecord(command) && isUuid(command.submissionId) && reason ? { submissionId: command.submissionId, reason } : null;
}

export function normalizedAllowance(command: SetGroundTimeAllowanceCommand): SetGroundTimeAllowanceCommand | null {
  if (!isRecord(command) || typeof command.allowedMinutes !== "number" || !Number.isInteger(command.allowedMinutes) ||
      command.allowedMinutes < 15 || command.allowedMinutes > 720) return null;
  if (command.version !== null && !isText(command.version, 64)) return null;
  return { allowedMinutes: command.allowedMinutes, version: command.version };
}

export function normalizedHoliday(command: AddFinanceHolidayCommand): AddFinanceHolidayCommand | null {
  if (!isRecord(command) || typeof command.date !== "string" || !isValidDate(command.date)) return null;
  const name = typeof command.name === "string" ? command.name.split(/\s+/).filter(Boolean).join(" ") : "";
  return name.length >= 2 && name.length <= 120 ? { date: command.date, name } : null;
}
