/**
 * The tabular reports of ADR-0048, «Reportes nuevos»: Contratos (`contracts/reports`), Gestión Humana
 * (`human-resources/table-reports`) and the airline portal (`airline/portal/reports`). They share one catalog and one
 * page shape; this module validates both strictly (an unknown key is a contract change, not data) and builds the
 * query of a page or an export from the filters the screen sends.
 */
import type {
  TabularReportCatalogResponse,
  TabularReportPageResponse,
} from "../generated/elevant-api";

export type TabularReportFormat = "pdf" | "xlsx" | "csv";

/**
 * The query of a tabular report: the period (`from`/`to`, ISO dates), the page (`page`, `limit` 1–100) and the filters
 * of the report by their parameter (`airlineId`, `stationId`, `status`…). Empty values are left out.
 */
export type TabularReportQuery = Record<string, string | number | null | undefined>;

/** The parameters each area accepts; the server still refuses a filter the report itself does not take. */
export const TABULAR_REPORT_PARAMETERS = {
  contracts: ["airlineId", "stationId", "serviceId", "status", "review", "validity", "expiresWithinDays"],
  humanResources: ["department", "status", "stationId", "account", "category", "action"],
  airlinePortal: ["stationId", "status"],
} as const;

export type TabularReportArea = keyof typeof TABULAR_REPORT_PARAMETERS;

const KEY = /^[a-z][a-z0-9-]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const CELL_TYPES = new Set(["text", "number", "money", "percent", "date", "datetime", "time", "duration"]);
const FILTER_KINDS = new Set(["station", "airline", "service", "select", "days"]);
const PERIODS = new Set(["none", "range", "asOf"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every(key => keys.includes(key));
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isOptionalText = (value: unknown) => value === undefined || value === null || typeof value === "string";
const isDate = (value: unknown): value is string =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function isTabularReportKey(value: unknown): value is string {
  return typeof value === "string" && KEY.test(value);
}

/**
 * The query string of a page (`forExport` false) or of an export: only the period, the page and the area's filters,
 * each well formed. Throws a TypeError before any request when a value is not.
 */
export function tabularReportParams(area: TabularReportArea, query: TabularReportQuery, forExport: boolean)
  : Record<string, string | number> {
  if (!isRecord(query)) throw new TypeError("The report query is invalid.");
  const allowed = new Set<string>(["from", "to", ...(forExport ? [] : ["page", "limit"]), ...TABULAR_REPORT_PARAMETERS[area]]);
  const params: Record<string, string | number> = {};
  for (const [name, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null || raw === "") continue;
    if (!allowed.has(name)) {
      // An export ignores the page the screen is on; anything else is a mistake of the caller.
      if (forExport && (name === "page" || name === "limit")) continue;
      throw new TypeError(`The report filter ${name} is not accepted.`);
    }
    if (name === "from" || name === "to") {
      if (!isDate(raw)) throw new TypeError(`${name} must be an ISO date.`);
      params[name] = raw;
    } else if (name === "page" || name === "limit" || name === "expiresWithinDays") {
      const number = typeof raw === "number" ? raw : Number(raw);
      const max = name === "limit" ? 100 : name === "page" ? 100_000 : 3650;
      if (!Number.isInteger(number) || number < 1 || number > max) throw new TypeError(`${name} is out of range.`);
      params[name] = number;
    } else if (name.endsWith("Id")) {
      if (typeof raw !== "string" || !UUID.test(raw)) throw new TypeError(`${name} must be a UUID.`);
      params[name] = raw;
    } else {
      if (typeof raw !== "string" || !CODE.test(raw)) throw new TypeError(`${name} is not a valid option.`);
      params[name] = raw;
    }
  }
  if (typeof params.from === "string" && typeof params.to === "string" && params.from > params.to)
    throw new TypeError("from must not be after to.");
  return params;
}

function isDefinition(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["key", "title", "description", "columns", "columnTypes", "filters", "period",
    "maxRangeDays", "asOfDate"]) || !isTabularReportKey(value.key) || !isText(value.title) ||
    typeof value.description !== "string" || !Array.isArray(value.columns) || !value.columns.every(isText) ||
    !Array.isArray(value.columnTypes) || value.columnTypes.length !== value.columns.length ||
    !value.columnTypes.every(type => typeof type === "string" && CELL_TYPES.has(type)) ||
    typeof value.period !== "string" || !PERIODS.has(value.period) || !Number.isInteger(value.maxRangeDays) ||
    (value.asOfDate !== undefined && typeof value.asOfDate !== "boolean") || !Array.isArray(value.filters))
    return false;
  return value.filters.every(filter => isRecord(filter) &&
    hasOnlyKeys(filter, ["key", "label", "parameter", "kind", "options"]) && isText(filter.key) && isText(filter.label) &&
    isText(filter.parameter) && typeof filter.kind === "string" && FILTER_KINDS.has(filter.kind) &&
    Array.isArray(filter.options) && filter.options.every(option => isRecord(option) &&
      hasOnlyKeys(option, ["code", "label"]) && isText(option.code) && isText(option.label)));
}

export function isTabularReportCatalog(value: unknown): value is TabularReportCatalogResponse {
  return isRecord(value) && hasOnlyKeys(value, ["area", "reports", "maxRangeDays"]) && isText(value.area) &&
    (value.maxRangeDays === undefined || Number.isInteger(value.maxRangeDays)) &&
    Array.isArray(value.reports) && value.reports.every(isDefinition);
}

const isCell = (cell: unknown) => isRecord(cell) && hasOnlyKeys(cell, ["value", "type"]) &&
  typeof cell.value === "string" && typeof cell.type === "string" && CELL_TYPES.has(cell.type);

const isPair = (value: unknown, keys: readonly string[]) => isRecord(value) && hasOnlyKeys(value, keys);

/** A page of the report <c>key</c>: rows as wide as the columns, at most <c>limit</c> of them, and typed cells. */
export function isTabularReportPage(value: unknown, key: string): value is TabularReportPageResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["key", "title", "area", "from", "to", "asOf", "columns", "columnTypes", "rows",
    "page", "limit", "hasMore", "totalRows", "description", "station", "stationCode", "stationName", "appliedFilters",
    "summary", "totals", "notes", "generatedBy"]) || value.key !== key || !isText(value.title) || !isText(value.area) ||
    !(value.from === undefined || value.from === null || isDate(value.from)) ||
    !(value.to === undefined || value.to === null || isDate(value.to)) || typeof value.asOf !== "string" ||
    !Number.isInteger(value.page) || !Number.isInteger(value.limit) || typeof value.hasMore !== "boolean" ||
    !Number.isInteger(value.totalRows) || !Array.isArray(value.columns) || !value.columns.every(isText) ||
    !Array.isArray(value.columnTypes) || value.columnTypes.length !== value.columns.length || !Array.isArray(value.rows) ||
    !isOptionalText(value.description) || !isOptionalText(value.station) || !isOptionalText(value.stationCode) ||
    !isOptionalText(value.stationName) || !isOptionalText(value.generatedBy))
    return false;
  const width = value.columns.length;
  return value.rows.length <= (value.limit as number) &&
    value.rows.every(row => Array.isArray(row) && row.length === width && row.every(isCell)) &&
    (value.appliedFilters === undefined || Array.isArray(value.appliedFilters) &&
      value.appliedFilters.every(filter => isPair(filter, ["label", "value"]))) &&
    (value.summary === undefined || Array.isArray(value.summary) &&
      value.summary.every(metric => isPair(metric, ["label", "value", "context"]))) &&
    (value.totals === undefined || Array.isArray(value.totals) && value.totals.every(total => isRecord(total) &&
      hasOnlyKeys(total, ["label", "cells"]) && isText(total.label) && Array.isArray(total.cells) &&
      total.cells.length === width && total.cells.every(isCell))) &&
    (value.notes === undefined || Array.isArray(value.notes) && value.notes.every(note => typeof note === "string"));
}

/** The filters of the statement of account export: the cut-off, the airline and optionally the station and currency. */
export type FinanceStatementExportFilters = {
  asOf: string; airlineId: string; stationId?: string | null; currency?: "USD" | "DOP" | null;
};

export function financeStatementParams(filters: FinanceStatementExportFilters, format: "pdf" | "xlsx") {
  if (!isRecord(filters) || !isDate(filters.asOf) || typeof filters.airlineId !== "string" || !UUID.test(filters.airlineId) ||
      (filters.stationId != null && filters.stationId !== "" && !UUID.test(filters.stationId)) ||
      (filters.currency != null && filters.currency !== "USD" && filters.currency !== "DOP") ||
      (format !== "pdf" && format !== "xlsx") ||
      Object.keys(filters).some(key => !["asOf", "airlineId", "stationId", "currency"].includes(key)))
    throw new TypeError("The statement export filters are invalid.");
  return {
    format, asOf: filters.asOf, airlineId: filters.airlineId,
    ...(filters.stationId ? { stationId: filters.stationId } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
  };
}
