/**
 * Charter flights without a contract (ADR-0033): the agent adds services at Finance's base tariff
 * and records the carrier data; Finance confirms the prepayment.
 */
import type {
  CharterCatalogItemResponse,
  FinanceCharterListResponse,
  FinanceCharterResponse,
  RampCharterResponse,
} from "../generated/elevant-api";

export const CHARTER_PREPAYMENT_STATUSES = ["Pending", "Confirmed"] as const;
export type CharterPrepaymentStatus = (typeof CHARTER_PREPAYMENT_STATUSES)[number];

export interface AddCharterServiceCommand {
  readonly serviceDefinitionId: string;
  readonly quantity: number;
}

export interface CharterDetailsCommand {
  readonly carrierAddress: string | null;
  readonly chargesPayableBy: string | null;
}

export interface ConfirmCharterPrepaymentCommand {
  readonly amount: number;
  readonly reference: string;
}

// Any well-formed UUID: the Development seed derives deterministic ids that carry no RFC version.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isOptionalText = (value: unknown, max: number) => value === null || value === undefined || isText(value, max);
const isMoney = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isOptionalMoney = (value: unknown) => value === null || value === undefined || isMoney(value);
const isStatus = (value: unknown): value is CharterPrepaymentStatus =>
  typeof value === "string" && (CHARTER_PREPAYMENT_STATUSES as readonly string[]).includes(value);
const isCurrency = (value: unknown) => typeof value === "string" && /^[A-Z]{3}$/.test(value);

const isCatalogItem = (value: unknown): value is CharterCatalogItemResponse =>
  isRecord(value) && typeof value.serviceDefinitionId === "string" && UUID.test(value.serviceDefinitionId) &&
  isText(value.code, 64) && isText(value.name, 200) && isText(value.billingUnit, 40) && isMoney(value.unitPrice) &&
  isMoney(value.minimumQuantity);

export const isRampCharterResponse = (value: unknown, operationId?: string): value is RampCharterResponse =>
  isRecord(value) && typeof value.operationId === "string" &&
  (operationId === undefined || value.operationId.toLowerCase() === operationId.toLowerCase()) &&
  typeof value.charterId === "string" && UUID.test(value.charterId) && isCurrency(value.currencyCode) &&
  isOptionalText(value.carrierAddress, 300) && isOptionalText(value.chargesPayableBy, 160) &&
  isStatus(value.prepaymentStatus) && isOptionalMoney(value.prepaymentAmount) &&
  Array.isArray(value.catalog) && value.catalog.every(isCatalogItem);

export const isFinanceCharterResponse = (value: unknown): value is FinanceCharterResponse =>
  isRecord(value) && typeof value.id === "string" && UUID.test(value.id) && typeof value.operationId === "string" &&
  UUID.test(value.operationId) && isText(value.operationCode, 64) && typeof value.operationDate === "string" &&
  isText(value.stationCode, 8) && isText(value.airlineName, 200) && isCurrency(value.currencyCode) &&
  isOptionalMoney(value.servicesTotal) && typeof value.requestSigned === "boolean" && isStatus(value.prepaymentStatus) &&
  isOptionalMoney(value.prepaymentAmount) && isOptionalText(value.prepaymentReference, 80) &&
  (value.prepaymentConfirmedAt === null || value.prepaymentConfirmedAt === undefined ||
    (typeof value.prepaymentConfirmedAt === "string" && !Number.isNaN(Date.parse(value.prepaymentConfirmedAt))));

export const isFinanceCharterListResponse = (value: unknown): value is FinanceCharterListResponse =>
  isRecord(value) && Array.isArray(value.charters) && value.charters.every(isFinanceCharterResponse);

export const normalizedCharterService = (command: AddCharterServiceCommand): AddCharterServiceCommand | null =>
  isRecord(command) && typeof command.serviceDefinitionId === "string" && UUID.test(command.serviceDefinitionId) &&
  typeof command.quantity === "number" && command.quantity > 0 && command.quantity <= 999 &&
  Math.round(command.quantity * 100) === command.quantity * 100
    ? { serviceDefinitionId: command.serviceDefinitionId, quantity: command.quantity } : null;

const trimmed = (value: unknown, max: number) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  return text.length === 0 ? null : text.length <= max ? text : undefined;
};

export const normalizedCharterDetails = (command: CharterDetailsCommand): CharterDetailsCommand | null => {
  if (!isRecord(command)) return null;
  const carrierAddress = trimmed(command.carrierAddress, 300);
  const chargesPayableBy = trimmed(command.chargesPayableBy, 160);
  return carrierAddress === undefined || chargesPayableBy === undefined ? null : { carrierAddress, chargesPayableBy };
};

export const normalizedPrepayment = (command: ConfirmCharterPrepaymentCommand): ConfirmCharterPrepaymentCommand | null => {
  if (!isRecord(command) || typeof command.amount !== "number" || !(command.amount > 0) || command.amount > 10_000_000 ||
      Math.round(command.amount * 100) !== command.amount * 100 || typeof command.reference !== "string")
    return null;
  const reference = command.reference.trim();
  return /^[A-Za-z0-9 /#.-]{2,80}$/.test(reference) ? { amount: command.amount, reference } : null;
};
