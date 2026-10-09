import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError, type AirlineInvoiceStatementResponse } from "../src";

const invoiceId = "81000000-0000-4000-8000-000000000001";
const statement: AirlineInvoiceStatementResponse = {
  invoiceId, number: "NF-0123456789abcdef0123456789abcdef", preinvoiceId: "82000000-0000-4000-8000-000000000001",
  currencyCode: "USD", total: 135.5, paid: 50, credited: 10, balance: 75.5,
  issuedAt: "2026-10-08T10:00:00.000+00:00", dueDate: "2026-11-07", status: "PartiallyPaid", daysOverdue: 0,
  lines: [
    { lineNumber: 1, kind: "Service", parentLineNumber: null, operationCode: "OP-1", operationDate: "2026-10-08",
      serviceCode: "BAGGAGE", serviceName: "Equipaje", quantity: 1, billingUnit: "operation", unitPrice: 130,
      amount: 130, reason: null },
    { lineNumber: 2, kind: "Charge", parentLineNumber: 1, operationCode: "OP-1", operationDate: "2026-10-08",
      serviceCode: "NIGHT", serviceName: "Recargo nocturno", quantity: 1, billingUnit: "operation", unitPrice: 10.5,
      amount: 10.5, reason: null },
    { lineNumber: 3, kind: "Adjustment", parentLineNumber: 1, operationCode: "OP-1", operationDate: "2026-10-08",
      serviceCode: "ADJ", serviceName: "Descuento", quantity: 1, billingUnit: "unit", unitPrice: -5, amount: -5,
      reason: "Acuerdo comercial" },
  ],
  payments: [{ reference: "CHK-000123", method: "Check", paidOn: "2026-10-09", amount: 50,
    recordedAt: "2026-10-09T12:00:00.000+00:00" }],
  creditNotes: [{ number: "NC-1", amount: 10, reason: "Bonificación", issuedAt: "2026-10-09T13:00:00.000+00:00" }],
};

function client(body: unknown) {
  return createElevantApiClient({
    baseUrl: "https://api.example.test",
    getAccessToken: () => "airline-token",
    fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  });
}

describe("airline invoice statement", () => {
  it("accepts a consistent statement with nested charge and adjustment lines", async () => {
    await expect(client(statement).getAirlineInvoiceStatement(invoiceId)).resolves.toEqual(statement);
  });

  it("rejects an inconsistent balance, staff names or a charge without a valid parent", async () => {
    await expect(client({ ...statement, balance: 1 }).getAirlineInvoiceStatement(invoiceId))
      .rejects.toBeInstanceOf(ElevantApiError);
    await expect(client({ ...statement, payments: [{ ...statement.payments[0], recordedBy: "Ana" }] })
      .getAirlineInvoiceStatement(invoiceId)).rejects.toBeInstanceOf(ElevantApiError);
    await expect(client({ ...statement, lines: [statement.lines[0], { ...statement.lines[1], parentLineNumber: 2 }] })
      .getAirlineInvoiceStatement(invoiceId)).rejects.toBeInstanceOf(ElevantApiError);
  });
});
