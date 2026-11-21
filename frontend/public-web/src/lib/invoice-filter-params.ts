/**
 * The filters of «Facturas» in the address (`/portal/finanzas?estado=vencidas&desde=…`), so a filtered list can be
 * reloaded, bookmarked or shared. The address is only a convenience: the API still scopes every invoice to the airline
 * of the session and its stations, and a value this module does not understand is ignored, never sent.
 */
import type { InvoiceFilters, InvoiceStatusFilter } from "./airline-invoices";

const STATUS_SLUGS: Record<Exclude<InvoiceStatusFilter, "">, string> = {
  open: "con-saldo", Pendiente: "pendientes", Vencida: "vencidas", Pagada: "pagadas", Anulada: "anuladas",
};
const SLUG_STATUS = new Map(Object.entries(STATUS_SLUGS).map(([status, slug]) => [slug, status as InvoiceStatusFilter]));
const KEYS = ["estado", "desde", "hasta", "estacion", "buscar"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATION = /^[A-Za-z0-9-]{1,64}$/;
const SEARCH_MAX = 64;

type Params = Pick<URLSearchParams, "get"> | null | undefined;

function date(value: string | null | undefined) {
  if (!value || !DATE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

/** The filters and the station of the address; anything malformed is left out. */
export function parseInvoiceFilterParams(params: Params): { filters: InvoiceFilters; stationId: string } {
  const filters: InvoiceFilters = {};
  const status = SLUG_STATUS.get(params?.get("estado") ?? "");
  if (status) filters.status = status;
  const from = date(params?.get("desde"));
  const to = date(params?.get("hasta"));
  if (from) filters.from = from;
  if (to && !(from && to < from)) filters.to = to;
  const search = (params?.get("buscar") ?? "").trim().slice(0, SEARCH_MAX);
  if (search) filters.search = search;
  const station = params?.get("estacion") ?? "";
  return { filters, stationId: STATION.test(station) ? station : "" };
}

/** The query string for `filters` and `stationId`, keeping the parameters of `current` that are not filters. */
export function invoiceFilterQuery(current: URLSearchParams, filters: InvoiceFilters, stationId: string): string {
  const next = new URLSearchParams(current);
  for (const key of KEYS) next.delete(key);
  if (filters.status) next.set("estado", STATUS_SLUGS[filters.status]);
  if (filters.from) next.set("desde", filters.from);
  if (filters.to) next.set("hasta", filters.to);
  if (stationId) next.set("estacion", stationId);
  const search = filters.search?.trim().slice(0, SEARCH_MAX);
  if (search) next.set("buscar", search);
  return next.toString();
}
