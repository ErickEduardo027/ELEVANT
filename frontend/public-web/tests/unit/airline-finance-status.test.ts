import { describe, expect, it } from "vitest";

import { invoiceStatus } from "@/components/portal/AirlineFinancePage";

const base = { balance: 118, daysOverdue: 0, applied: 0, legacyPaid: 0, credited: 0, legacyCredited: 0, debited: 0 };

describe("invoiceStatus (4-N24)", () => {
  it("names an invoice credited to zero without any payment «Anulada», never «Pagada»", () => {
    expect(invoiceStatus({ ...base, balance: 0, credited: 118 })).toBe("Anulada");
    expect(invoiceStatus({ ...base, balance: 0, legacyCredited: 118 })).toBe("Anulada");
  });

  it("keeps «Pagada» once any payment settled part of it", () => {
    expect(invoiceStatus({ ...base, balance: 0, applied: 118 })).toBe("Pagada");
    expect(invoiceStatus({ ...base, balance: 0, applied: 18, credited: 100 })).toBe("Pagada");
    expect(invoiceStatus({ ...base, balance: 0, legacyPaid: 118 })).toBe("Pagada");
    // A debit note that cancels the credit leaves nothing credited.
    expect(invoiceStatus({ ...base, balance: 0, credited: 50, debited: 50, applied: 118 })).toBe("Pagada");
  });

  it("is Vencida or Pendiente while something is owed", () => {
    expect(invoiceStatus({ ...base, daysOverdue: 3 })).toBe("Vencida");
    expect(invoiceStatus({ ...base, credited: 18, balance: 100 })).toBe("Pendiente");
  });
});
