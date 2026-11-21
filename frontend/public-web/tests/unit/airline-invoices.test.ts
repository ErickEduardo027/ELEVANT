import { expect, it } from "vitest";

import { filterInvoices, formatByCurrency, invoiceIssueDates, invoiceSummary, statementLedger, sumByCurrency }
  from "@/lib/airline-invoices";
import type { AirlineTreasuryInvoice, AirlineTreasuryMovement, AirlineTreasuryStatement } from "@/lib/airline-treasury-service";

const invoice = (id: string, overrides: Partial<AirlineTreasuryInvoice> = {}): AirlineTreasuryInvoice => ({
  id, preinvoiceId: "p-" + id, number: "NF-" + id, fiscalNumber: "E31000000000" + id, stationId: "s1", stationCode: "PUJ",
  currencyCode: "USD", total: 100, legacyPaid: 0, legacyCredited: 0, applied: 0, credited: 0, debited: 0, balance: 100,
  dueDate: "2026-12-01", daysOverdue: 0, agingBucket: "Current", ...overrides,
});
const movement = (id: string, kind: string, amount: number, effectiveOn: string,
  overrides: Partial<AirlineTreasuryMovement> = {}): AirlineTreasuryMovement => ({
  id, receiptId: null, invoiceId: null, kind, currencyCode: "USD", amount, effectiveOn,
  recordedAt: `${effectiveOn}T12:00:00Z`, reversesId: null, reference: id, ...overrides,
});

it("takes the issue date of each invoice from its «Invoice» movement", () => {
  const dates = invoiceIssueDates([movement("m1", "Invoice", 100, "2026-11-02", { invoiceId: "1" }),
    movement("m2", "Application", 50, "2026-11-03", { invoiceId: "1", receiptId: "r" })]);
  expect(dates.get("1")).toBe("2026-11-02");
  expect(dates.size).toBe(1);
});

it("filters the loaded invoices by status, issue period and number, in the client", () => {
  const invoices = [invoice("1"), invoice("2", { balance: 0, applied: 100 }), invoice("3", { daysOverdue: 4 }),
    invoice("4", { fiscalNumber: null, number: "NF-OLD" })];
  const issued = new Map([["1", "2026-10-01"], ["2", "2026-10-15"], ["3", "2026-11-01"], ["4", "2026-11-20"]]);
  const ids = (filters: Parameters<typeof filterInvoices>[1]) => filterInvoices(invoices, filters, issued).map(item => item.id);
  expect(ids({})).toEqual(["1", "2", "3", "4"]);
  expect(ids({ status: "Pagada" })).toEqual(["2"]);
  expect(ids({ status: "Vencida" })).toEqual(["3"]);
  expect(ids({ status: "open" })).toEqual(["1", "3", "4"]);
  expect(ids({ from: "2026-10-10", to: "2026-11-01" })).toEqual(["2", "3"]);
  expect(ids({ search: "nf-old" })).toEqual(["4"]);
  expect(ids({ search: " E310000000003 " })).toEqual(["3"]);
});

it("adds amounts by currency and writes them together", () => {
  const sums = sumByCurrency([{ currency: "USD", value: 10.1 }, { currency: "DOP", value: 5 }, { currency: "USD", value: 0.2 }]);
  expect(sums).toEqual([{ currency: "DOP", value: 5 }, { currency: "USD", value: 10.3 }]);
  expect(formatByCurrency(sums)).toBe("DOP 5.00 · USD 10.30");
  expect(formatByCurrency([])).toBe("—");
});

it("gives the invoice KPIs their context instead of bare numbers", () => {
  const summary = invoiceSummary([invoice("1"), invoice("2", { balance: 0, applied: 100 }),
    invoice("3", { daysOverdue: 4, balance: 40, applied: 60 })]);
  expect(summary).toMatchObject({ count: 3, open: 2, overdue: 1 });
  expect(formatByCurrency(summary.billed)).toBe("USD 300.00");
  expect(formatByCurrency(summary.collected)).toBe("USD 160.00");
  expect(formatByCurrency(summary.outstanding)).toBe("USD 140.00");
  expect(formatByCurrency(summary.overdueBalance)).toBe("USD 40.00");
});

it("runs the statement's balance by currency: charges add, payments and credits subtract, applications move nothing", () => {
  const statement: AirlineTreasuryStatement = { airlineId: "a", asOf: "2026-11-21", invoices: [], aging: [], receipts: [
    { id: "r1", stationId: "s1", stationCode: "PUJ", reference: "BANK-1", currencyCode: "USD", amount: 150, applied: 100,
      refunded: 0, available: 50, reversed: false, method: "Transfer", receivedOn: "2026-11-05", movements: [] }],
  movements: [
    movement("i1", "Invoice", 100, "2026-11-01", { invoiceId: "1", reference: "E310000000001" }),
    movement("i2", "Invoice", 80, "2026-11-02", { invoiceId: "2" }),
    movement("r1", "Receipt", 150, "2026-11-05", { receiptId: "r1" }),
    movement("a1", "Application", 100, "2026-11-05", { receiptId: "r1", invoiceId: "1" }),
    movement("c1", "Credit", 10, "2026-11-06", { invoiceId: "2" }),
    movement("d1", "Debit", 5, "2026-11-07", { invoiceId: "2" }),
    movement("f1", "Refund", 20, "2026-11-08", { receiptId: "r1" }),
    movement("x1", "Invoice", 1000, "2026-11-08", { invoiceId: "3", currencyCode: "DOP" }),
  ] };
  const ledger = statementLedger(statement);
  expect(ledger.map(group => group.currency)).toEqual(["DOP", "USD"]);
  const usd = ledger[1];
  expect(usd.rows.map(row => [row.movement.id, row.debit, row.credit, row.balance])).toEqual([
    ["i1", 100, 0, 100], ["i2", 80, 0, 180], ["r1", 0, 150, 30], ["a1", 0, 0, 30], ["c1", 0, 10, 20], ["d1", 5, 0, 25],
    ["f1", 20, 0, 45]]);
  expect(usd).toMatchObject({ debits: 205, credits: 160, balance: 45 });
  expect(ledger[0]).toMatchObject({ balance: 1000 });
});

it("moves a payment between currencies when a receipt pays an invoice in another one", () => {
  const statement: AirlineTreasuryStatement = { airlineId: "a", asOf: "2026-11-21", invoices: [], aging: [], receipts: [
    { id: "r1", stationId: "s1", stationCode: "PUJ", reference: "BANK-1", currencyCode: "USD", amount: 100, applied: 100,
      refunded: 0, available: 0, reversed: false, method: "Transfer", receivedOn: "2026-11-05", movements: [
        { id: "a1", kind: "Application", invoiceId: "3", reversesId: null, effectiveOn: "2026-11-05", receiptAmount: 100,
          invoiceAmount: 6000, receiptCurrency: "USD", invoiceCurrency: "DOP", exchangeRate: 60, exchangeRateOn: "2026-11-05",
          reference: "", reason: "", recordedAt: "2026-11-05T12:00:00Z" }] }],
  movements: [
    movement("x1", "Invoice", 6000, "2026-11-01", { invoiceId: "3", currencyCode: "DOP" }),
    movement("r1", "Receipt", 100, "2026-11-05", { receiptId: "r1" }),
    movement("a1", "Application", 100, "2026-11-05", { receiptId: "r1", invoiceId: "3" }),
  ] };
  const [dop, usd] = statementLedger(statement);
  expect(dop.balance).toBe(0);
  expect(usd.balance).toBe(0);
});
