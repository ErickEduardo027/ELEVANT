import type { AirlineTreasuryInvoice, AirlineTreasuryMovement, AirlineTreasuryNote, AirlineTreasuryStatement }
  from "./airline-treasury-service";
import { formatMoney } from "./portal-format";

/**
 * How the airline portal reads its invoices: their status, number, issue date, the filters of «Facturas», the
 * figures of its KPI and the running balance of «Estado de cuenta». Everything is computed from what the API
 * already returned for the authenticated airline; nothing here decides what the airline may see.
 */
export type InvoiceStatus = "Pagada" | "Anulada" | "Vencida" | "Pendiente";

/**
 * Pagada when nothing is owed, Vencida past its due date, Pendiente otherwise (ADR-0035). 4-N24: an invoice that
 * nobody paid and that credit notes brought to zero is «Anulada», never «Pagada».
 */
export function invoiceStatus(invoice: Pick<AirlineTreasuryInvoice, "balance" | "daysOverdue" | "applied" | "legacyPaid" |
  "credited" | "legacyCredited" | "debited">): InvoiceStatus {
  if (invoice.balance <= 0) {
    const paid = invoice.applied + invoice.legacyPaid;
    const credited = invoice.credited + invoice.legacyCredited - invoice.debited;
    return paid <= 0 && credited > 0 ? "Anulada" : "Pagada";
  }
  return invoice.daysOverdue > 0 ? "Vencida" : "Pendiente";
}

export const STATUS_TONE: Record<InvoiceStatus, "success" | "neutral" | "danger" | "info"> = {
  Pagada: "success", Anulada: "neutral", Vencida: "danger", Pendiente: "info",
};

/** The e-NCF of an e-CF invoice, or its internal number before ADR-0035. */
export function invoiceNumber(invoice: Pick<AirlineTreasuryInvoice, "fiscalNumber" | "number">) {
  return invoice.fiscalNumber ?? invoice.number;
}

export function invoiceTitle(invoice: Pick<AirlineTreasuryInvoice, "fiscalNumber" | "number">) {
  return `Factura ${invoiceNumber(invoice)}`;
}

/** 4-N17: a note on an E31 invoice carries its own simulated e-NCF: E34 credits the invoice, E33 debits it. */
export function noteTitle(note: Pick<AirlineTreasuryNote, "kind" | "number">) {
  const kind = note.kind === "Credit" ? "crédito" : "débito";
  return /^E3[34]\d{10}$/.test(note.number) ? `Nota de ${kind} electrónica ${note.number}` : `Nota de ${kind} ${note.number}`;
}

/** The issue date of each invoice: the business day of its «Invoice» movement in the statement. */
export function invoiceIssueDates(movements: readonly AirlineTreasuryMovement[]): Map<string, string> {
  const dates = new Map<string, string>();
  for (const item of movements) if (item.kind === "Invoice" && item.invoiceId) dates.set(item.invoiceId, item.effectiveOn);
  return dates;
}

/** «open» is every invoice with a balance (pending or overdue). */
export type InvoiceStatusFilter = "" | "open" | InvoiceStatus;
export interface InvoiceFilters { status?: InvoiceStatusFilter; from?: string; to?: string; search?: string }

/** The filters of «Facturas», applied to the invoices already loaded (the API filters only by station). */
export function filterInvoices<T extends AirlineTreasuryInvoice>(invoices: readonly T[], filters: InvoiceFilters,
  issued: ReadonlyMap<string, string>): T[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  return invoices.filter(item => {
    const status = invoiceStatus(item);
    if (filters.status === "open" ? item.balance <= 0 : filters.status && status !== filters.status) return false;
    const day = issued.get(item.id);
    if (filters.from && (!day || day < filters.from)) return false;
    if (filters.to && (!day || day > filters.to)) return false;
    if (search && !`${item.fiscalNumber ?? ""} ${item.number}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

export interface CurrencyAmount { currency: string; value: number }

const round = (value: number) => Math.round(value * 100) / 100;

/** The amounts added by currency, in the order of the currency codes. */
export function sumByCurrency(items: readonly CurrencyAmount[]): CurrencyAmount[] {
  const sums = new Map<string, number>();
  for (const item of items) sums.set(item.currency, round((sums.get(item.currency) ?? 0) + item.value));
  return [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({ currency, value }));
}

/** «USD 10.30 · DOP 5.00», or «—» without amounts. */
export function formatByCurrency(items: readonly CurrencyAmount[]): string {
  return items.map(item => formatMoney(item.currency, item.value)).join(" · ") || "—";
}

const by = (invoices: readonly AirlineTreasuryInvoice[], value: (item: AirlineTreasuryInvoice) => number) =>
  sumByCurrency(invoices.map(item => ({ currency: item.currencyCode, value: value(item) })));

/** The figures of the KPI of «Facturas», each with what it is out of («3 de 8 facturas pendientes»). */
export function invoiceSummary(invoices: readonly AirlineTreasuryInvoice[]) {
  const open = invoices.filter(item => item.balance > 0);
  const overdue = open.filter(item => item.daysOverdue > 0);
  return {
    count: invoices.length,
    open: open.length,
    overdue: overdue.length,
    billed: by(invoices, item => item.total),
    collected: by(invoices, item => item.applied + item.legacyPaid),
    outstanding: by(open, item => item.balance),
    overdueBalance: by(overdue, item => item.balance),
  };
}

/** What a statement movement adds to the airline's balance (debit) or takes from it (credit). */
const DEBITS = new Set(["Invoice", "Debit", "Refund", "ReceiptReversal"]);
const CREDITS = new Set(["Receipt", "Credit", "LegacyPayment", "LegacyCredit"]);

export interface LedgerRow { movement: AirlineTreasuryMovement; currency: string; debit: number; credit: number; balance: number }
export interface LedgerGroup { currency: string; rows: LedgerRow[]; debits: number; credits: number; balance: number }

/**
 * The movements of the statement with a running balance by currency, as an account statement reads: invoices, debit
 * notes, refunds and reversed receipts add; receipts, credit notes and historical payments subtract. Applying a receipt
 * moves money already received to an invoice and changes nothing, unless the invoice is in another currency: then it
 * leaves the receipt's currency and pays the invoice's, at the rate the receipt recorded.
 */
export function statementLedger(statement: AirlineTreasuryStatement): LedgerGroup[] {
  const applications = new Map(statement.receipts.flatMap(receipt => receipt.movements).map(item => [item.id, item]));
  const groups = new Map<string, LedgerGroup>();
  const add = (movement: AirlineTreasuryMovement, currency: string, debit: number, credit: number) => {
    const group = groups.get(currency) ?? { currency, rows: [], debits: 0, credits: 0, balance: 0 };
    groups.set(currency, group);
    group.debits = round(group.debits + debit);
    group.credits = round(group.credits + credit);
    group.balance = round(group.balance + debit - credit);
    group.rows.push({ movement, currency, debit, credit, balance: group.balance });
  };
  for (const movement of statement.movements) {
    if (DEBITS.has(movement.kind)) add(movement, movement.currencyCode, movement.amount, 0);
    else if (CREDITS.has(movement.kind)) add(movement, movement.currencyCode, 0, movement.amount);
    else if (movement.kind === "Application" || movement.kind === "ApplicationReversal") {
      const detail = applications.get(movement.id);
      const reversal = movement.kind === "ApplicationReversal";
      if (detail?.invoiceCurrency && detail.invoiceCurrency !== detail.receiptCurrency) {
        // The receipt's credit leaves its currency and pays the invoice in its own.
        add(movement, detail.receiptCurrency, reversal ? 0 : detail.receiptAmount, reversal ? detail.receiptAmount : 0);
        add(movement, detail.invoiceCurrency, reversal ? detail.invoiceAmount : 0, reversal ? 0 : detail.invoiceAmount);
      } else add(movement, movement.currencyCode, 0, 0);
    } else add(movement, movement.currencyCode, 0, 0);
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
