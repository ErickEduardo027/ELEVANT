import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ElevantApiError, type AirlineApprovedOperationEvidenceResponse,
  type AirlineOperationPageResponse,
  type AirlineOperationalRequestPageResponse, type AirlinePortalBootstrapResponse,
  type NonFiscalPaymentLookupResponse, type PreinvoiceDisputeListResponse,
  type SessionActorResponse } from "@elevant/api-client";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";
import type { AirlineTreasuryInvoice, AirlineTreasuryInvoiceDetail, AirlineTreasuryStatement } from "@/lib/airline-treasury-service";

const actor: SessionActorResponse = {
  accountId: "40000000-0000-7000-8000-000000000003",
  email: "airline.client@dev.elevant.test",
  displayName: "Casey Airline",
  roles: [], memberships: [], stationScopes: [],
};
const bootstrap: AirlinePortalBootstrapResponse = {
  airlineId: "20000000-0000-7000-8000-000000000001",
  organizationId: "10000000-0000-7000-8000-000000000002",
  iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines",
  stations: [{ id: "20000000-0000-7000-8000-000000000003", code: "PUJ",
    name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" }],
  currentOperations: [{ id: "30000000-0000-7000-8000-000000000003", code: "DEV-TAT-0002",
    stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
    operationDate: "2026-09-25", status: "in_progress", arrivalFlightNumber: "ZZ101" }],
};
let currentOperations = bootstrap.currentOperations;
let historyPage: AirlineOperationPageResponse = {
  page: 1, limit: 20, hasMore: false, operations: bootstrap.currentOperations,
};
const getOperations = vi.fn(async () => historyPage);
let detailOperation = bootstrap.currentOperations[0];
const getOperation = vi.fn(async (id: string) => {
  if (detailOperation?.id === id) return detailOperation;
  throw new ElevantApiError({ kind: "http", status: 404 });
});
const emptyEvidence: AirlineApprovedOperationEvidenceResponse = {
  operationId: bootstrap.currentOperations[0].id!, available: false,
  approvedAt: null, actualStartAt: null, actualEndAt: null,
  incidentCount: 0, services: [],
};
let approvedEvidence = emptyEvidence;
const getApprovedEvidence = vi.fn(async () => approvedEvidence);
const getServiceOrder = vi.fn(async (): Promise<never> => { throw new ElevantApiError({ kind: "http", status: 404 }); });
const downloadServiceOrder = vi.fn(async () => new Blob(["%PDF-1.7"], { type: "application/pdf" }));
const initialRequestPage: AirlineOperationalRequestPageResponse = {
  page: 1, limit: 20, hasMore: false,
  requests: [{ id: "73000000-0000-7000-8000-000000000001",
    stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
    serviceName: "Escalera adicional", description: "Solicitud para desembarque posterior.",
    status: "Submitted", requestedAt: "2026-08-19T12:03:00Z",
    neededAt: "2026-08-19T12:15:00Z", operationId: bootstrap.currentOperations[0].id,
    operationCode: "DEV-TAT-0002", resolvedAt: null }],
};
let requestPage = initialRequestPage;
let financeRevision = 0;
const getRequests = vi.fn(async () => requestPage);
const initialPreinvoicePage = { page: 1, limit: 20, hasMore: false,
  preinvoices: [{ id: "74000000-0000-7000-8000-000000000001",
    stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
    from: "2026-08-18", to: "2026-08-19", currencyCode: "USD", total: 125.5,
    status: "Submitted", createdAt: "2026-08-20T12:00:00Z" }] };
let preinvoicePage = initialPreinvoicePage;
const getPreinvoices = vi.fn(async () => preinvoicePage);
const getPreinvoice = vi.fn(async (id: string) => ({
  id, stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
  from: "2026-08-18", to: "2026-08-19", currencyCode: "USD", total: 125.5,
  status: "Submitted", createdAt: "2026-08-20T12:00:00Z",
  lines: [{ id: "74000000-0000-7000-8000-000000000002",
    operationCode: "DEV-TAT-0021", operationDate: "2026-08-18",
    serviceCode: "GPU", serviceName: "Ground power",
    executedQuantity: 1, billingUnit: "hour", unitPrice: 125.5, amount: 125.5 }],
}));
const acceptPreinvoice = vi.fn<(_id: string) => Promise<void>>(async () => {});
const getPreinvoiceDisputes = vi.fn<(_id: string) => Promise<PreinvoiceDisputeListResponse>>(
  async (id: string) => ({ preinvoiceId: id, disputes: [] }));
const getPreinvoiceInvoice = vi.fn(async (id: string) => ({ preinvoiceId: id,
  id: '74000000-0000-7000-8000-000000000009',
  number: 'NF-74000000000070008000000000000009', kind: 'NonFiscal',
  currencyCode: 'USD', total: 125.5, issuedAt: '2026-09-28T16:00:00Z',
  lines: [{ id: '74000000-0000-7000-8000-000000000010', lineNumber: 1,
    operationCode: 'DEV-TAT-0021', operationDate: '2026-08-18',
    serviceCode: 'GPU', serviceName: 'Ground power', executedQuantity: 1,
    billingUnit: 'hour', unitPrice: 125.5, amount: 125.5 }] }));
const getInvoicePayment = vi.fn<(invoiceId: string) => Promise<NonFiscalPaymentLookupResponse>>(
  async (invoiceId: string) => ({ invoiceId,
  payment: { id: '74000000-0000-7000-8000-000000000011', invoiceId,
    reference: 'BANK-TEST-123', currencyCode: 'USD', amount: 125.5,
    recordedAt: '2026-09-28T17:00:00Z' } }));
const statementOf = (invoiceId: string, paid: number) => ({ invoiceId,
  number: "NF-74000000000070008000000000000009", preinvoiceId: "74000000-0000-7000-8000-000000000001",
  currencyCode: "USD", total: 125.5, paid, credited: 0, balance: 125.5 - paid,
  issuedAt: "2026-09-28T16:00:00Z", dueDate: "2026-10-28", status: paid > 0 ? "PartiallyPaid" : "Pending", daysOverdue: 0,
  lines: [{ lineNumber: 1, kind: "Service", parentLineNumber: null, operationCode: "DEV-TAT-0021",
    operationDate: "2026-08-18", serviceCode: "GPU", serviceName: "Ground power", quantity: 1, billingUnit: "hour",
    unitPrice: 115.5, amount: 115.5, reason: null },
  { lineNumber: 2, kind: "Charge", parentLineNumber: 1, operationCode: "DEV-TAT-0021", operationDate: "2026-08-18",
    serviceCode: "NIGHT", serviceName: "Recargo nocturno", quantity: 1, billingUnit: "operation", unitPrice: 10,
    amount: 10, reason: "Servicio entre 22:00 y 06:00" }],
  payments: paid > 0 ? [{ reference: "BANK-TEST-123", method: "Transfer", paidOn: "2026-09-29", amount: paid,
    recordedAt: "2026-09-29T17:00:00Z" }] : [],
  creditNotes: [] });
const getInvoiceStatement = vi.fn(async (invoiceId: string) => statementOf(invoiceId, 50));
const getInvoiceDocument = vi.fn(async () => new Blob(["%PDF-1.7\n%%EOF"], { type: "application/pdf" }));
const getPaymentReceipt = vi.fn(async () => new Blob(["%PDF-1.7\n%%EOF"], { type: "application/pdf" }));
const disputePreinvoice = vi.fn<(_id: string, _request: { requestId: string;
  subject: string; description: string; lineIds: string[] }) => Promise<void>>(async () => {});

const getTreasuryStatement = vi.fn<(asOf: string, stationId?: string, signal?: AbortSignal) => Promise<AirlineTreasuryStatement>>(async asOf => ({ airlineId: bootstrap.airlineId, asOf, invoices: [], receipts: [], movements: [], aging: [] }));
const getTreasuryInvoice = vi.fn(async (id: string): Promise<AirlineTreasuryInvoiceDetail> => ({ invoice: { id, preinvoiceId: initialPreinvoicePage.preinvoices[0].id,
  number: "NF-74000000000070008000000000000009", stationId: bootstrap.stations[0].id, stationCode: "PUJ", currencyCode: "USD",
  total: 125.5, legacyPaid: 50, legacyCredited: 0, applied: 0, credited: 0, debited: 0, balance: 75.5, dueDate: null, daysOverdue: 0, agingBucket: "Current" }, lines: [], movements: [], notes: [] }));
type PayCall = (invoiceId: string, body: Record<string, unknown>, key: string) => Promise<unknown>;
const payInvoiceByCard = vi.fn<PayCall>(async () => { throw new Error("not mocked"); });
const getInvoiceCardPayments = vi.fn(async (invoiceId: string) => ({ invoiceId, attempts: [] as unknown[] }));
const getCardPaymentReceipt = vi.fn(async () => new Blob(["%PDF-1.7"], { type: "application/pdf" }));
const getTreasuryReceipt = vi.fn(async () => { throw new ElevantApiError({ kind: "http", status: 404 }); });

vi.mock("@/components/auth/AirlineSessionProvider", () => ({
  useAirlineSession: () => ({ status: "ready", session: { actor, bootstrap: { ...bootstrap, currentOperations }, expiresAt: "2099-01-01T00:00:00Z" }, getOperations, getOperation, getApprovedEvidence, getServiceOrder, downloadServiceOrder, getRequests, getPreinvoices, getPreinvoice, getPreinvoiceDisputes, getPreinvoiceInvoice, getInvoicePayment, getInvoiceStatement, getTreasuryStatement, getTreasuryInvoice, getTreasuryReceipt, getInvoiceDocument, payInvoiceByCard, getInvoiceCardPayments, getCardPaymentReceipt, getPaymentReceipt, acceptPreinvoice, disputePreinvoice, operationRevision: 0, financeRevision }),
}));

afterEach(() => { cleanup(); currentOperations = bootstrap.currentOperations; historyPage = {
  page: 1, limit: 20, hasMore: false, operations: bootstrap.currentOperations,
}; detailOperation = bootstrap.currentOperations[0]; approvedEvidence = emptyEvidence;
  getOperations.mockClear(); getOperation.mockClear(); getApprovedEvidence.mockClear();
  requestPage = initialRequestPage; getRequests.mockClear(); getPreinvoice.mockClear(); getPreinvoiceDisputes.mockClear(); getPreinvoiceInvoice.mockClear(); getInvoicePayment.mockClear(); getInvoiceStatement.mockClear();
  preinvoicePage = initialPreinvoicePage;
  getPreinvoices.mockClear(); getInvoiceDocument.mockClear(); getPaymentReceipt.mockClear(); acceptPreinvoice.mockClear(); disputePreinvoice.mockClear(); financeRevision = 0; });

it("shows historical flights from the tenant-scoped API page, not only the bootstrap window", async () => {
  historyPage = { page: 1, limit: 20, hasMore: false, operations: [
    { ...bootstrap.currentOperations[0], id: "30000000-0000-7000-8000-000000000006",
      code: "DEV-TAT-0001", operationDate: "2026-08-18" },
  ] };
  render(<AirlinePortalPage view="flights" />);
  expect(await screen.findByRole("link", { name: /DEV-TAT-0001/ })).toHaveAttribute(
    "href", "/portal/vuelos/30000000-0000-7000-8000-000000000006");
  expect(getOperations).toHaveBeenCalledWith(1);
  expect(screen.queryByText("DEV-TAT-0002")).not.toBeInTheDocument();
});

it("shows only tenant-scoped bootstrap operations in overview and flights", async () => {
  const page = render(<AirlinePortalPage view="overview" />);
  expect(screen.getByRole("heading", { level: 1, name: /Demo Airlines/ })).toBeInTheDocument();
  expect(screen.getByText("DEV-TAT-0002")).toBeInTheDocument();
  page.rerender(<AirlinePortalPage view="flights" />);
  expect(await screen.findByRole("link", { name: /DEV-TAT-0002/ })).toHaveAttribute(
    "href", "/portal/vuelos/30000000-0000-7000-8000-000000000003");
});

it("derives overview counts from the authorized API operations instead of prototype KPIs", () => {
  currentOperations = [
    bootstrap.currentOperations[0],
    { ...bootstrap.currentOperations[0], id: "30000000-0000-7000-8000-000000000004", code: "DEV-TAT-0003", status: "PendingReview" },
    { ...bootstrap.currentOperations[0], id: "30000000-0000-7000-8000-000000000005", code: "DEV-TAT-0004", status: "Approved" },
  ];
  render(<AirlinePortalPage view="overview" />);
  const metrics = within(screen.getByLabelText("Estado de las operaciones visibles"));
  expect(within(metrics.getByText("Operaciones visibles").parentElement!).getByText("3")).toBeInTheDocument();
  expect(within(metrics.getByText("En curso").parentElement!).getByText("1")).toBeInTheDocument();
  expect(within(metrics.getByText("En revisión").parentElement!).getByText("1")).toBeInTheDocument();
  expect(within(metrics.getByText("Aprobadas").parentElement!).getByText("1")).toBeInTheDocument();
  expect(screen.queryByText("EV 311")).not.toBeInTheDocument();
  // 2-N26: each operation shows its status in Spanish, never the code.
  expect(screen.getByText("Pendiente de revisión")).toBeInTheDocument();
  expect(screen.queryByText(/in_progress|PendingReview/)).not.toBeInTheDocument();
});

it("filters only authorized flights by operation code or flight number", async () => {
  currentOperations = [
    bootstrap.currentOperations[0],
    { ...bootstrap.currentOperations[0], id: "30000000-0000-7000-8000-000000000004",
      code: "DEV-TAT-0003", arrivalFlightNumber: "ZZ202" },
  ];
  historyPage = { page: 1, limit: 20, hasMore: false, operations: currentOperations };
  render(<AirlinePortalPage view="flights" />);
  expect(await screen.findByText("DEV-TAT-0003")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar vuelo u operación" }),
    { target: { value: "ZZ202" } });
  expect(screen.getByText("DEV-TAT-0003")).toBeInTheDocument();
  expect(screen.queryByText("DEV-TAT-0002")).not.toBeInTheDocument();
});

it("loads an authorized historical operation detail outside the bootstrap", async () => {
  detailOperation = { ...bootstrap.currentOperations[0],
    id: "30000000-0000-7000-8000-000000000006", code: "DEV-TAT-0001",
    operationDate: "2026-08-18" };
  render(<AirlinePortalPage view="flightDetail" operationId={detailOperation.id} />);
  expect(await screen.findByText("DEV-TAT-0001")).toBeInTheDocument();
  expect(getOperation).toHaveBeenCalledWith(detailOperation.id);
});

it("shows only the approved service snapshot in the airline operation detail", async () => {
  detailOperation = { ...bootstrap.currentOperations[0], status: "Approved" };
  approvedEvidence = {
    operationId: bootstrap.currentOperations[0].id!, available: true,
    approvedAt: "2026-09-25T16:00:00Z",
    actualStartAt: "2026-09-25T13:00:00Z",
    actualEndAt: "2026-09-25T15:45:00Z", incidentCount: 1,
    services: [{ id: "30000000-0000-7000-8000-000000000007", code: "BAGGAGE",
      name: "Baggage handling", status: "Completed",
      contractedQuantity: 1, executedQuantity: 1, billingUnit: "operation" }],
  };
  render(<AirlinePortalPage view="flightDetail" operationId={approvedEvidence.operationId} />);
  expect(await screen.findByText("Baggage handling")).toBeInTheDocument();
  expect(screen.getByText(/Aprobada por OCC/)).toBeInTheDocument();
  expect(screen.getByText(/1 incidencia registrada/)).toBeInTheDocument();
  expect(getApprovedEvidence).toHaveBeenCalledWith(approvedEvidence.operationId);
  expect(screen.queryByText(/nota interna/i)).not.toBeInTheDocument();
});

it("keeps an authorized unapproved operation visible without inventing evidence", async () => {
  render(<AirlinePortalPage view="flightDetail" operationId={emptyEvidence.operationId} />);
  expect(await screen.findByText("DEV-TAT-0002")).toBeInTheDocument();
  expect(screen.getByText(/evidencia aprobada aún no está disponible/i)).toBeInTheDocument();
  expect(screen.queryByText("Baggage handling")).not.toBeInTheDocument();
});

it("does not show an old approved snapshot beside a newer unapproved status", async () => {
  approvedEvidence = { ...emptyEvidence, available: true,
    approvedAt: "2026-09-25T16:00:00Z",
    services: [{ id: "30000000-0000-7000-8000-000000000007", code: "BAGGAGE",
      name: "Baggage handling", status: "Completed",
      contractedQuantity: 1, executedQuantity: 1, billingUnit: "operation" }] };
  render(<AirlinePortalPage view="flightDetail" operationId={approvedEvidence.operationId} />);
  expect(await screen.findByText("DEV-TAT-0002")).toBeInTheDocument();
  expect(await screen.findByText(/evidencia aprobada aún no está disponible/i)).toBeInTheDocument();
  expect(screen.queryByText("Baggage handling")).not.toBeInTheDocument();
});

it("shows the Service Order the representative signed and downloads its PDF (ADR-0032)", async () => {
  getServiceOrder.mockResolvedValueOnce({ operationId: emptyEvidence.operationId, number: "PUJ000000002",
    contentSha256: "a".repeat(64), currencyCode: "USD", totalAmount: 180,
    signatures: [{ role: "AirlineRepresentative", signerName: "Ana Pérez", signedAt: "2026-09-25T15:50:00Z" },
      { role: "AviamAgent", signerName: "Riley Ramp", signedAt: "2026-09-25T15:51:00Z" }] } as never);
  const createObjectURL = vi.fn(() => "blob:order");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  render(<AirlinePortalPage view="flightDetail" operationId={emptyEvidence.operationId} />);
  expect(await screen.findByText("PUJ000000002")).toBeInTheDocument();
  expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Descargar PDF firmado" }));
  await waitFor(() => expect(downloadServiceOrder).toHaveBeenCalledWith(emptyEvidence.operationId));
  expect(createObjectURL).toHaveBeenCalled();
});

it("says plainly when the flight has no signed Service Order yet", async () => {
  render(<AirlinePortalPage view="flightDetail" operationId={emptyEvidence.operationId} />);
  expect(await screen.findByText(/Aún no hay una Orden de Servicio firmada/)).toBeInTheDocument();
});

it("keeps the flight detail readable when only approved evidence fails", async () => {
  getApprovedEvidence.mockRejectedValueOnce(new ElevantApiError({ kind: "http", status: 503 }));
  render(<AirlinePortalPage view="flightDetail" operationId={emptyEvidence.operationId} />);
  expect(await screen.findByText("DEV-TAT-0002")).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent(/evidencia aprobada/i);
  fireEvent.click(screen.getByRole("button", { name: "Reintentar evidencia" }));
  expect(await screen.findByText(/evidencia aprobada aún no está disponible/i)).toBeInTheDocument();
  expect(getApprovedEvidence).toHaveBeenCalledTimes(2);
});

it("does not invent details for an operation outside the authorized tenant", async () => {
  render(<AirlinePortalPage view="flightDetail" operationId="not-authorized" />);
  expect(await screen.findByText(/no está disponible en la consulta autorizada/i)).toBeInTheDocument();
  expect(screen.queryByText("DEV-TAT-0002")).not.toBeInTheDocument();
});

it("shows verified account and station scope in profile", () => {
  render(<AirlinePortalPage view="profile" />);
  expect(screen.getByText(actor.email)).toBeInTheDocument();
  expect(screen.getByText("PUJ · Punta Cana")).toBeInTheDocument();
});

it("shows only API operations on overview and flights, including an honest empty state", async () => {
  currentOperations = [];
  historyPage = { page: 1, limit: 20, hasMore: false, operations: [] };
  const page = render(<AirlinePortalPage view="overview" />);
  expect(screen.getByText(/0 operaciones reales/)).toBeInTheDocument();
  expect(screen.getByText(/No hay operaciones en la ventana actual/)).toBeInTheDocument();
  expect(screen.queryByText("EV 311")).not.toBeInTheDocument();
  expect(screen.queryByText(/datos sintéticos/i)).not.toBeInTheDocument();
  page.rerender(<AirlinePortalPage view="flights" />);
  expect(await screen.findByText(/No hay vuelos registrados para esta aerolínea/)).toBeInTheDocument();
  expect(screen.queryByText("EV 311")).not.toBeInTheDocument();
  expect(screen.queryByText(/datos sintéticos/i)).not.toBeInTheDocument();
});

it("shows tenant-scoped operational requests without demo fixtures", async () => {
  render(<AirlinePortalPage view="requests" />);
  expect(screen.getByRole("heading", { name: /Solicitudes con estado visible/ })).toBeInTheDocument();
  expect(await screen.findByText("Escalera adicional")).toBeInTheDocument();
  expect(screen.getByText("DEV-TAT-0002")).toBeInTheDocument();
  expect(getRequests).toHaveBeenCalledWith(1);
  expect(screen.queryByText(/datos sintéticos/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Nueva solicitud" })).toBeDisabled();
});

it("shows an honest empty state when the airline has no operational requests", async () => {
  requestPage = { page: 1, limit: 20, hasMore: false, requests: [] };
  render(<AirlinePortalPage view="requests" />);
  expect(await screen.findByText(/No hay solicitudes operativas registradas/)).toBeInTheDocument();
  expect(screen.queryByText("Escalera adicional")).not.toBeInTheDocument();
  expect(screen.queryByText(/datos sintéticos/i)).not.toBeInTheDocument();
});

const ecfInvoice = (overrides: Partial<AirlineTreasuryInvoice> = {}): AirlineTreasuryInvoice => ({
  id: "74000000-0000-7000-8000-000000000009", preinvoiceId: initialPreinvoicePage.preinvoices[0].id,
  number: "NF-74000000000070008000000000000009", fiscalNumber: "E310000000001",
  stationId: bootstrap.stations[0].id, stationCode: "PUJ", currencyCode: "USD", total: 148.09,
  legacyPaid: 0, legacyCredited: 0, applied: 0, credited: 0, debited: 0, balance: 148.09,
  dueDate: "2026-12-05", daysOverdue: 0, agingBucket: "Current", ...overrides,
});
const statementWith = (invoices: AirlineTreasuryInvoice[]) => async (asOf: string): Promise<AirlineTreasuryStatement> =>
  ({ airlineId: bootstrap.airlineId, asOf, invoices, receipts: [], movements: [], aging: [] });

afterEach(() => {
  getTreasuryStatement.mockReset();
  getTreasuryStatement.mockImplementation(statementWith([]));
  getTreasuryInvoice.mockClear();
});

it("lists invoices with their e-NCF, status and balance, without preinvoice decisions", async () => {
  getTreasuryStatement.mockImplementation(statementWith([
    ecfInvoice(),
    ecfInvoice({ id: "74000000-0000-7000-8000-000000000019", fiscalNumber: "E310000000002", balance: 0, applied: 148.09 }),
    ecfInvoice({ id: "74000000-0000-7000-8000-000000000029", fiscalNumber: null, number: "NF-OLD", daysOverdue: 12 }),
  ]));
  render(<AirlinePortalPage view="finance" />);
  expect(await screen.findByRole("heading", { level: 2, name: "Factura E310000000001" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Factura E310000000001" })).toHaveTextContent("PUJ · Pendiente");
  expect(screen.getByRole("region", { name: "Factura E310000000002" })).toHaveTextContent("Pagada");
  expect(screen.getByRole("region", { name: "Factura NF-OLD" })).toHaveTextContent("Vencida");
  expect(screen.getByLabelText("Resumen de facturas")).toHaveTextContent("USD 296.18");
  expect(screen.queryByRole("button", { name: /Aceptar prefactura|Disputar prefactura/ })).not.toBeInTheDocument();
  expect(getPreinvoices).not.toHaveBeenCalled();
});

it("opens an invoice detail and downloads its PDF by invoice id", async () => {
  getTreasuryStatement.mockImplementation(statementWith([ecfInvoice()]));
  getTreasuryInvoice.mockImplementationOnce(async () => ({ invoice: ecfInvoice(), movements: [], notes: [],
    lines: [{ id: "l1", lineNumber: 1, kind: "Service", parentLineNumber: null, operationCode: "DEV-TAT-0021",
      operationDate: "2026-08-18", serviceCode: "GPU", serviceName: "Ground power", quantity: 1, billingUnit: "hour",
      unitPrice: 125.5, amount: 148.09, reason: null }] }));
  const createObjectURL = vi.fn(() => "blob:invoice");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole("button", { name: "Ver detalle" }));
  const detail = await screen.findByRole("region", { name: "Detalle de factura" });
  expect(await within(detail).findByText(/Servicio · DEV-TAT-0021 · Ground power/)).toBeInTheDocument();
  expect(within(detail).getByText(/sin validez fiscal/)).toBeInTheDocument();
  expect(getTreasuryInvoice).toHaveBeenCalledWith("74000000-0000-7000-8000-000000000009", expect.any(AbortSignal));
  fireEvent.click(within(detail).getByRole("button", { name: "Descargar PDF de Factura E310000000001" }));
  await waitFor(() => expect(getInvoiceDocument).toHaveBeenCalledWith("74000000-0000-7000-8000-000000000009"));
  await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
});

it("shows honest empty and recoverable states for invoices", async () => {
  getTreasuryStatement.mockRejectedValueOnce(new Error("private transport detail"));
  render(<AirlinePortalPage view="finance" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron consultar las facturas.");
  expect(screen.queryByText(/private transport detail/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("No hay facturas emitidas para esta aerolínea.")).toBeInTheDocument();
});

it("lists invoice PDFs in documents by invoice id", async () => {
  getTreasuryStatement.mockImplementation(statementWith([ecfInvoice()]));
  render(<AirlinePortalPage view="documents" />);
  expect(await screen.findByRole("heading", { level: 2, name: "Factura E310000000001" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Descargar PDF de Factura E310000000001" }));
  await waitFor(() => expect(getInvoiceDocument).toHaveBeenCalledWith("74000000-0000-7000-8000-000000000009"));
});

it("reports operations and invoices returned by the API, hiding stale data while revalidating", async () => {
  getTreasuryStatement.mockImplementation(statementWith([ecfInvoice()]));
  const page = render(<AirlinePortalPage view="reports" />);
  expect(await screen.findByText(/Factura E310000000001 · USD 148\.09/)).toBeInTheDocument();
  expect(screen.getByText("DEV-TAT-0002")).toBeInTheDocument();
  let finish!: (value: AirlineTreasuryStatement) => void;
  getTreasuryStatement.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  financeRevision += 1;
  page.rerender(<AirlinePortalPage view="reports" />);
  expect(screen.queryByText(/Factura E310000000001/)).not.toBeInTheDocument();
  await act(async () => finish({ airlineId: bootstrap.airlineId, asOf: "2026-11-05", invoices: [], receipts: [], movements: [], aging: [] }));
  expect(await screen.findByText(/No hay facturas emitidas/)).toBeInTheDocument();
});

const attemptOf = (status: string, overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), invoiceId: "74000000-0000-7000-8000-000000000009", status, brand: "Visa", last4: "1111",
  amount: 148.09, currencyCode: "USD", authorizationCode: status === "Approved" ? "ABC234" : null,
  declineCode: status === "Approved" ? null : status === "Error" ? "processing_error" : "insufficient_funds",
  receiptId: status === "Approved" ? crypto.randomUUID() : null, attemptedAt: "2026-11-05T12:00:00Z", ...overrides });

async function openCardForm() {
  getTreasuryStatement.mockImplementation(statementWith([ecfInvoice()]));
  getTreasuryInvoice.mockImplementation(async () => ({ invoice: ecfInvoice(), movements: [], notes: [], lines: [] }));
  render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole("button", { name: "Ver detalle" }));
  fireEvent.click(await screen.findByRole("button", { name: "Pagar con tarjeta USD 148.09" }));
  const form = screen.getByRole("form", { name: "Datos de la tarjeta" });
  fireEvent.change(within(form).getByLabelText("Titular de la tarjeta"), { target: { value: "Casey Airline" } });
  fireEvent.change(within(form).getByLabelText("Número de tarjeta"), { target: { value: "4000 0000 0000 0002" } });
  fireEvent.change(within(form).getByLabelText("Vencimiento (MM/AA)"), { target: { value: "12/30" } });
  fireEvent.change(within(form).getByLabelText("Código de seguridad"), { target: { value: "123" } });
  return form;
}

afterEach(() => { payInvoiceByCard.mockReset(); getInvoiceCardPayments.mockClear(); getCardPaymentReceipt.mockClear(); });

it("pays the whole balance by card: a declined card, then another card with a new key", async () => {
  payInvoiceByCard.mockResolvedValueOnce({ attempt: attemptOf("Declined"), invoiceBalance: 148.09, replayed: false })
    .mockResolvedValueOnce({ attempt: attemptOf("Approved"), invoiceBalance: 0, replayed: false });
  const form = await openCardForm();
  fireEvent.click(within(form).getByRole("button", { name: "Pagar USD 148.09" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("fondos insuficientes");
  const [invoiceId, body, firstKey] = payInvoiceByCard.mock.calls[0];
  expect(invoiceId).toBe("74000000-0000-7000-8000-000000000009");
  expect(body).toEqual({ cardholderName: "Casey Airline", cardNumber: "4000 0000 0000 0002", expiryMonth: 12, expiryYear: 2030,
    securityCode: "123", amount: 148.09 });
  fireEvent.change(within(form).getByLabelText("Número de tarjeta"), { target: { value: "4111 1111 1111 1111" } });
  fireEvent.change(within(form).getByLabelText("Código de seguridad"), { target: { value: "123" } });
  fireEvent.click(within(form).getByRole("button", { name: "Pagar USD 148.09" }));
  expect(await screen.findByText(/Pago aprobado · Visa terminada en 1111 · autorización ABC234/)).toBeInTheDocument();
  expect(payInvoiceByCard.mock.calls[1][2]).not.toBe(firstKey);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:receipt"), revokeObjectURL: vi.fn() });
  fireEvent.click(screen.getAllByRole("button", { name: "Descargar recibo" })[0]);
  await waitFor(() => expect(getCardPaymentReceipt).toHaveBeenCalled());
});

it("retries an uncertain card payment with the same key and never twice with another", async () => {
  payInvoiceByCard.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce({ attempt: attemptOf("Approved"), invoiceBalance: 0, replayed: true });
  const form = await openCardForm();
  fireEvent.click(within(form).getByRole("button", { name: "Pagar USD 148.09" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("no se cobrará dos veces");
  fireEvent.click(within(form).getByRole("button", { name: "Pagar USD 148.09" }));
  expect(await screen.findByText(/Pago aprobado/)).toBeInTheDocument();
  expect(payInvoiceByCard.mock.calls[1][2]).toBe(payInvoiceByCard.mock.calls[0][2]);
});

it("explains a card rejected before the gateway and lists every attempt", async () => {
  getInvoiceCardPayments.mockResolvedValue({ invoiceId: "74000000-0000-7000-8000-000000000009",
    attempts: [attemptOf("Error"), attemptOf("Declined")] });
  payInvoiceByCard.mockRejectedValueOnce(new ElevantApiError({ kind: "http", status: 400, reasons: ["card_number_invalid"] }));
  const form = await openCardForm();
  expect(await screen.findByText(/Error del procesador · Visa •••• 1111/)).toBeInTheDocument();
  expect(screen.getByText(/Rechazado · Visa •••• 1111/)).toBeInTheDocument();
  fireEvent.click(within(form).getByRole("button", { name: "Pagar USD 148.09" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("El número de tarjeta no es válido.");
});
