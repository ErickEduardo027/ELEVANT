import { ElevantApiError } from "@elevant/api-client";

/** Read DTOs of api/v1/airline/portal/treasury; no finance mutation or actor audit fields. */
export interface AirlineTreasuryInvoice {
  id: string; preinvoiceId: string; number: string; stationId: string; stationCode: string; currencyCode: string;
  total: number; legacyPaid: number; legacyCredited: number; applied: number; credited: number; debited: number;
  balance: number; dueDate: string | null; daysOverdue: number; agingBucket: string;
}
export interface AirlineTreasuryMovement {
  id: string; receiptId: string | null; invoiceId: string | null; kind: string; currencyCode: string; amount: number;
  effectiveOn: string; recordedAt: string; reversesId: string | null; reference: string;
}
export interface AirlineTreasuryReceiptMovement {
  id: string; kind: string; invoiceId: string | null; reversesId: string | null; effectiveOn: string;
  receiptAmount: number; invoiceAmount: number; receiptCurrency: string; invoiceCurrency: string | null;
  exchangeRate: number; exchangeRateOn: string; reference: string; reason: string; recordedAt: string;
}
export interface AirlineTreasuryReceipt {
  id: string; stationId: string; stationCode: string; reference: string; currencyCode: string; amount: number;
  applied: number; refunded: number; available: number; reversed: boolean; method: string; receivedOn: string;
  movements: AirlineTreasuryReceiptMovement[];
}
export interface AirlineTreasuryNote {
  id: string; number: string; invoiceId: string; relatedNoteId: string | null; kind: string; currencyCode: string;
  amount: number; effectiveOn: string; reason: string; recordedAt: string;
  lines: { invoiceLineId: string; quantity: number; amount: number }[];
}
export interface AirlineTreasuryNotes {
  invoiceId: string; number: string; currencyCode: string; legacyCredited: number; notes: AirlineTreasuryNote[];
}
export interface AirlineTreasuryInvoiceDetail {
  invoice: AirlineTreasuryInvoice;
  lines: { id: string; lineNumber: number; kind: string; parentLineNumber: number | null; operationCode: string; operationDate: string;
    serviceCode: string; serviceName: string; quantity: number; billingUnit: string; unitPrice: number; amount: number; reason: string | null }[];
  movements: AirlineTreasuryMovement[]; notes: AirlineTreasuryNote[];
}
export interface AirlineTreasuryStatement {
  airlineId: string; asOf: string; invoices: AirlineTreasuryInvoice[]; receipts: AirlineTreasuryReceipt[];
  movements: AirlineTreasuryMovement[];
  aging: { currencyCode: string; balance: number; current: number; days1To30: number; days31To60: number;
    days61To90: number; days91Plus: number; unallocated: number; creditBalance: number }[];
}
export function createAirlineTreasuryService(options: { baseUrl?: string; getAccessToken: () => string | null }) {
  const origin = String(options.baseUrl ?? process.env.NEXT_PUBLIC_ELEVANT_API_URL ?? "").replace(/\/$/, "");
  async function get<T>(route: string, signal?: AbortSignal): Promise<T> {
    const token = options.getAccessToken();
    if (!token) throw new ElevantApiError({ kind: "http", status: 401 });
    if (!origin) throw new Error("No está configurada la consulta financiera.");
    const response = await fetch(origin + "/api/v1/airline/portal/treasury" + route, {
      method: "GET", cache: "no-store", signal, headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    });
    if (!response.ok) throw new ElevantApiError({ kind: "http", status: response.status });
    return response.json() as Promise<T>;
  }
  return {
    getStatement(asOf: string, stationId?: string, signal?: AbortSignal) {
      const query = new URLSearchParams({ asOf }); if (stationId) query.set("stationId", stationId);
      return get<AirlineTreasuryStatement>("/statements?" + query, signal);
    },
    getInvoice: (invoiceId: string, signal?: AbortSignal) => get<AirlineTreasuryInvoiceDetail>("/invoices/" + encodeURIComponent(invoiceId), signal),
    getReceipt: (receiptId: string, signal?: AbortSignal) => get<AirlineTreasuryReceipt>("/receipts/" + encodeURIComponent(receiptId), signal),
    getNotes: (invoiceId: string, signal?: AbortSignal) => get<AirlineTreasuryNotes>("/invoices/" + encodeURIComponent(invoiceId) + "/adjustment-notes", signal),
  };
}
export type AirlineTreasuryService = ReturnType<typeof createAirlineTreasuryService>;
