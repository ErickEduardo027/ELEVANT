/**
 * «Inicio» of Finance (phase 4, block B, 4-A and 4-N02): the indicators the server computes for one station at the
 * business day of Santo Domingo. A section is null when the account's template does not include its module, never a
 * missing key. Web only: the mobile app never reads this endpoint, so the validator is strict.
 */
import type {
  FinanceHomeAmountResponse,
  FinanceHomeReceivableResponse,
  FinanceHomeResponse,
  FinanceHomeToInvoiceResponse,
} from "../generated/elevant-api";

// Any well-formed UUID: the Development seed derives deterministic ids that carry no RFC version.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCIES = new Set(["USD", "DOP"]);

const HOME_KEYS = ["stationId", "businessDate", "toInvoice", "invoicedThisMonth", "receivables",
  "cardCollectionsThisMonth", "pendingContractApprovals", "chartersAwaitingPrepayment"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** Exactly these keys: an unknown key or a missing section is a contract change, not data. */
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isDate = (value: unknown): value is string =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000_000;
const isMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isCurrency = (value: unknown): value is string => typeof value === "string" && CURRENCIES.has(value);
/** One entry per currency at most. */
const isPerCurrency = <T extends { currencyCode: string }>(items: unknown, predicate: (item: unknown) => item is T) =>
  Array.isArray(items) && items.length <= CURRENCIES.size && items.every(predicate) &&
  new Set((items as T[]).map((item) => item.currencyCode)).size === items.length;

function isToInvoice(value: unknown): value is FinanceHomeToInvoiceResponse {
  return isRecord(value) && hasExactKeys(value, ["operations", "airlines", "oldestOperationDate"]) &&
    isCount(value.operations) && isCount(value.airlines) && value.airlines <= value.operations &&
    (value.operations === 0 ? value.airlines === 0 && value.oldestOperationDate === null
      : value.airlines >= 1 && isDate(value.oldestOperationDate));
}

function isAmount(value: unknown): value is FinanceHomeAmountResponse {
  return isRecord(value) && hasExactKeys(value, ["currencyCode", "count", "amount"]) && isCurrency(value.currencyCode) &&
    isCount(value.count) && value.count >= 1 && isMoney(value.amount);
}

function isReceivable(value: unknown): value is FinanceHomeReceivableResponse {
  return isRecord(value) &&
    hasExactKeys(value, ["currencyCode", "openInvoices", "open", "overdueInvoices", "overdue"]) &&
    isCurrency(value.currencyCode) && isCount(value.openInvoices) && value.openInvoices >= 1 && isMoney(value.open) &&
    value.open > 0 && isCount(value.overdueInvoices) && value.overdueInvoices <= value.openInvoices &&
    isMoney(value.overdue) && value.overdue <= value.open;
}

/** «Inicio» for `stationId`: every section present, null or valid. */
export function isFinanceHomeResponse(value: unknown, stationId: string): value is FinanceHomeResponse {
  return isRecord(value) && hasExactKeys(value, HOME_KEYS) && isUuid(value.stationId) &&
    value.stationId.toLowerCase() === stationId.toLowerCase() && isDate(value.businessDate) &&
    (value.toInvoice === null || isToInvoice(value.toInvoice)) &&
    (value.invoicedThisMonth === null || isPerCurrency(value.invoicedThisMonth, isAmount)) &&
    (value.receivables === null || isPerCurrency(value.receivables, isReceivable)) &&
    (value.cardCollectionsThisMonth === null || isPerCurrency(value.cardCollectionsThisMonth, isAmount)) &&
    (value.pendingContractApprovals === null || isCount(value.pendingContractApprovals)) &&
    (value.chartersAwaitingPrepayment === null || isCount(value.chartersAwaitingPrepayment));
}
