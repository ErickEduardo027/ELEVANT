import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionResponse, AirlinePortalBootstrapResponse } from "@elevant/api-client";
import { AirlineSessionProvider, AIRLINE_SESSION_STORAGE_KEY } from "@/components/auth/AirlineSessionProvider";
import { AirlineTreasuryPanel } from "@/components/portal/AirlineTreasuryPanel";
vi.mock("@/lib/airline-change-observer", () => ({ createPublicAirlineChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }) }));
const actor: SessionResponse["actor"] = { accountId: "40000000-0000-7000-8000-000000000003", email: "synthetic@airline.invalid", displayName: "Airline",
  roles: [{ roleId: "41000000-0000-7000-8000-000000000001", code: "AIRLINE_CLIENT", name: "Airline", portal: "airline_portal", userType: "airline_client" }],
  memberships: [{ membershipId: "42000000-0000-7000-8000-000000000001", organizationId: "43000000-0000-7000-8000-000000000001", organizationCode: "QA", organizationName: "QA Airline", organizationType: "airline_customer", kind: "airline_client" }], stationScopes: [] };
const bootstrap: AirlinePortalBootstrapResponse = { airlineId: "44000000-0000-7000-8000-000000000001", organizationId: "43000000-0000-7000-8000-000000000001", name: "QA Airline", iataCode: "QA", icaoCode: "QAT", stations: [], currentOperations: [] };
const invoice = { id: "invoice-own", preinvoiceId: "pre-own", number: "NF-OWN", stationId: "s1", stationCode: "PUJ", currencyCode: "USD",
  total: 1000, legacyPaid: 50, legacyCredited: 0, applied: 300, credited: 100, debited: 0, balance: 550, dueDate: null, daysOverdue: 0, agingBucket: "Current" };
const receipt = { id: "receipt-own", stationId: "s1", stationCode: "PUJ", reference: "BANK-OWN", currencyCode: "USD", amount: 1000,
  applied: 300, refunded: 0, available: 700, reversed: false, method: "Transfer", receivedOn: "2026-10-18", movements: [
    { id: "fx-application", kind: "Application", invoiceId: invoice.id, reversesId: null, effectiveOn: "2026-10-18", receiptAmount: 300,
      invoiceAmount: 300, receiptCurrency: "USD", invoiceCurrency: "USD", exchangeRate: 1, exchangeRateOn: "2026-10-18", reference: "", reason: "Partial allocation", recordedAt: "2026-10-18T12:00:00Z" }] };
const statement = { airlineId: "44000000-0000-7000-8000-000000000001", asOf: "2026-10-18", invoices: [invoice], receipts: [], movements: [], aging: [
  { currencyCode: "USD", balance: 550, current: 550, days1To30: 0, days31To60: 0, days61To90: 0, days91Plus: 0, unallocated: 700, creditBalance: 0 },
  { currencyCode: "DOP", balance: 6050, current: 6050, days1To30: 0, days31To60: 0, days61To90: 0, days91Plus: 0, unallocated: 0, creditBalance: 0 }] };
function mount(invoiceId?: string, missing = false) {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({ accessToken: "synthetic-token", expiresAt: "2099-01-01T00:00:00Z" }));
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)); requests.push(url.pathname + url.search);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");
    if (url.pathname.includes("/treasury/") && missing) return new Response(JSON.stringify({ title: "private transport detail" }), { status: 404 });
    const body = url.pathname.endsWith("/bootstrap") ? bootstrap : url.pathname.endsWith("/auth/session") ? { actor } : url.pathname.includes("/statements") ? statement : url.pathname.includes("/receipts/") ? receipt :
      { invoice, lines: [{ id: "line-own", lineNumber: 1, kind: "Service", parentLineNumber: null, operationCode: "OP-QA", operationDate: "2026-10-18", serviceCode: "RAMP", serviceName: "Rampa", quantity: 1, billingUnit: "operation", unitPrice: 1000, amount: 1000, reason: null }], movements: [{ id: "legacy-payment", kind: "LegacyPayment", currencyCode: "USD", amount: 50, reference: "LEGACY-50", effectiveOn: "2026-10-18" },
        { id: "application", receiptId: "receipt-own", invoiceId: invoice.id, kind: "Application", currencyCode: "USD", amount: 300, reference: "", effectiveOn: "2026-10-18" }],
        notes: [{ id: "note-own", invoiceId: invoice.id, number: "TC-OWN", kind: "Credit", currencyCode: "USD", amount: 100, reason: "Service correction", effectiveOn: "2026-10-18", lines: [{ invoiceLineId: "line-own", quantity: 0.1, amount: 100 }] }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><AirlineTreasuryPanel invoiceId={invoiceId} /></AirlineSessionProvider>);
  return requests;
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
it("shows tenant-only cutoff statements and separates currencies without mutation controls", async () => {
  const requests = mount();
  expect(await screen.findByRole("heading", { name: "USD" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "DOP" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Fecha de corte"), { target: { value: "2026-10-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Consultar estado" }));
  await waitFor(() => expect(requests).toContain("/api/v1/airline/portal/treasury/statements?asOf=2026-10-01"));
  expect(requests.some(path => path.includes("organizationId") || path.includes("airlineId="))).toBe(false);
  expect(screen.queryByRole("button", { name: /Aplicar|Devolver|Emitir nota|Registrar cobro/ })).not.toBeInTheDocument();
});
it("cuts the statement on the business day of Santo Domingo, not the UTC day (4-N10)", async () => {
  // 23:30 in Santo Domingo on 5/11 is already 6/11 in UTC.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-06T03:30:00Z") });
  try {
    const requests = mount();
    await waitFor(() => expect(requests).toContain("/api/v1/airline/portal/treasury/statements?asOf=2026-11-05"));
    expect(await screen.findByText(/hora de República Dominicana/)).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha de corte")).toHaveAttribute("max", "2026-11-05");
    expect(screen.queryByText(/día UTC/)).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
it("shows combined balance, partial applications, historical payment and new adjustment note", async () => {
  mount("invoice-own");
  expect(await screen.findByText(/TC-OWN/)).toBeInTheDocument();
  expect(screen.getByText(/LEGACY-50/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Ver cobro/ })).toBeInTheDocument();
  expect(screen.queryByText("Sin pago registrado.")).not.toBeInTheDocument();
  expect(screen.getAllByText(/550.00/).length).toBeGreaterThan(0);
});
it("hides inaccessible IDs with a sanitized missing-document state", async () => {
  mount("foreign-invoice", true);
  expect(await screen.findByRole("alert")).toHaveTextContent(/no está disponible/i);
  expect(screen.queryByText(/private transport detail/)).not.toBeInTheDocument();
  expect(screen.queryByText(/TC-OWN/)).not.toBeInTheDocument();
});

it("links an adjustment to its invoice line with the credited quantity and amount", async () => {
  mount("invoice-own");
  const link = await screen.findByRole("link", { name: /Línea 1 · Rampa/ });
  expect(link).toHaveAttribute("href", expect.stringContaining("-line-line-own"));
  expect(link.parentElement).toHaveTextContent(/0.1.*USD 100.00/);
});
it("navigates a partial application to the real receipt and its recorded exchange rate", async () => {
  const requests = mount("invoice-own");
  fireEvent.click(await screen.findByRole("button", { name: "Ver cobro vinculado" }));
  expect(await screen.findByRole("heading", { name: /BANK-OWN/ })).toBeInTheDocument();
  expect(screen.getByText(/Tasa registrada 1/)).toBeInTheDocument();
  expect(requests).toContain("/api/v1/airline/portal/treasury/receipts/receipt-own");
  fireEvent.click(screen.getByRole("button", { name: "Ver factura vinculada" }));
  expect(await screen.findByText(/TC-OWN/)).toBeInTheDocument();
});
