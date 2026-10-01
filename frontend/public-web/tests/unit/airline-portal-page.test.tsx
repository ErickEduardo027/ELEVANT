import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ElevantApiError, type AirlineOperationPageResponse,
  type AirlineOperationalRequestPageResponse, type AirlinePortalBootstrapResponse,
  type NonFiscalPaymentLookupResponse, type PreinvoiceDisputeListResponse,
  type SessionActorResponse } from "@elevant/api-client";

import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

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
const getInvoiceDocument = vi.fn(async () => new Blob(["%PDF-1.7\n%%EOF"], { type: "application/pdf" }));
const getPaymentReceipt = vi.fn(async () => new Blob(["%PDF-1.7\n%%EOF"], { type: "application/pdf" }));
const disputePreinvoice = vi.fn<(_id: string, _request: { requestId: string;
  subject: string; description: string; lineIds: string[] }) => Promise<void>>(async () => {});

vi.mock("@/components/auth/AirlineSessionProvider", () => ({
  useAirlineSession: () => ({ status: "ready", session: { actor, bootstrap: { ...bootstrap, currentOperations }, expiresAt: "2099-01-01T00:00:00Z" }, getOperations, getOperation, getRequests, getPreinvoices, getPreinvoice, getPreinvoiceDisputes, getPreinvoiceInvoice, getInvoicePayment, getInvoiceDocument, getPaymentReceipt, acceptPreinvoice, disputePreinvoice, operationRevision: 0, financeRevision }),
}));

afterEach(() => { cleanup(); currentOperations = bootstrap.currentOperations; historyPage = {
  page: 1, limit: 20, hasMore: false, operations: bootstrap.currentOperations,
}; detailOperation = bootstrap.currentOperations[0]; getOperations.mockClear(); getOperation.mockClear();
  requestPage = initialRequestPage; getRequests.mockClear(); getPreinvoice.mockClear(); getPreinvoiceDisputes.mockClear(); getPreinvoiceInvoice.mockClear(); getInvoicePayment.mockClear();
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
  expect(within(screen.getByText("Operaciones visibles").parentElement!).getByText("3")).toBeInTheDocument();
  expect(within(screen.getByText("En curso").parentElement!).getByText("1")).toBeInTheDocument();
  expect(within(screen.getByText("En revisión").parentElement!).getByText("1")).toBeInTheDocument();
  expect(within(screen.getByText("Aprobadas").parentElement!).getByText("1")).toBeInTheDocument();
  expect(screen.queryByText("EV 311")).not.toBeInTheDocument();
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

it("does not invent details for an operation outside the authorized tenant", async () => {
  render(<AirlinePortalPage view="flightDetail" operationId="not-authorized" />);
  expect(await screen.findByText(/no está disponible en la consulta autorizada/i)).toBeInTheDocument();
  expect(screen.queryByText("DEV-TAT-0002")).not.toBeInTheDocument();
});

it("shows an honest empty documents state from the live finance page", async () => {
  render(<AirlinePortalPage view="documents" />);
  expect(screen.getByRole("heading", { level: 1, name: "Documentos" })).toBeInTheDocument();
  expect(await screen.findByText(/no hay facturas emitidas/i)).toBeInTheDocument();
  expect(screen.queryByText(/datos de demostración/i)).not.toBeInTheDocument();
  expect(screen.queryByText("DEMO-DOC-001")).not.toBeInTheDocument();
});

it("opens tenant-scoped invoice and receipt PDFs without a mock document", async () => {
  preinvoicePage = { ...preinvoicePage, preinvoices: preinvoicePage.preinvoices.map(item =>
    ({ ...item, status: "Invoiced" })) };
  const createObjectURL = vi.fn(() => "blob:financial-test");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    render(<AirlinePortalPage view="documents" />);
    await screen.findByText("Prefactura facturada");
    fireEvent.click(screen.getByRole("button", { name: "Ver documentos" }));
    await screen.findByText(/Factura no fiscal NF-/);
    fireEvent.click(screen.getByRole("button", { name: "Descargar factura PDF" }));
    await screen.findByRole("button", { name: "Descargar recibo PDF" });
    expect(getInvoiceDocument).toHaveBeenCalledWith(preinvoicePage.preinvoices[0].id);
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Descargar recibo PDF" }));
    await act(async () => { expect(getPaymentReceipt).toHaveBeenCalledWith(
      "74000000-0000-7000-8000-000000000009"); });
  } finally {
    click.mockRestore();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});

it("shows only published preinvoices returned by the authorized finance API", async () => {
  render(<AirlinePortalPage view="finance" />);
  expect(await screen.findByText("USD 125.50")).toBeInTheDocument();
  expect(screen.getByText("PUJ · 2026-08-18 — 2026-08-19")).toBeInTheDocument();
  expect(screen.queryByText(/datos de demostración/i)).not.toBeInTheDocument();
  expect(screen.queryByText("DEMO-PRE-001")).not.toBeInTheDocument();
});

it("refetches published preinvoices when Finance receives a durable change revision", async () => {
  const page = render(<AirlinePortalPage view="finance" />);
  await screen.findByText("USD 125.50");
  expect(getPreinvoices).toHaveBeenCalledTimes(1);
  financeRevision += 1;
  page.rerender(<AirlinePortalPage view="finance" />);
  await screen.findByText("USD 125.50");
  expect(getPreinvoices).toHaveBeenCalledTimes(2);
});

it("opens immutable service lines from the authorized preinvoice detail", async () => {
  render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver líneas de prefactura/i }));
  expect(await screen.findByText("Ground power")).toBeInTheDocument();
  expect(screen.getByText(/DEV-TAT-0021/)).toBeInTheDocument();
  expect(getPreinvoice).toHaveBeenCalledWith("74000000-0000-7000-8000-000000000001");
});

it("shows the real non-fiscal invoice only for an invoiced airline preinvoice", async () => {
  const invoicedPage = { page: 1, limit: 20, hasMore: false,
    preinvoices: [{ id: '74000000-0000-7000-8000-000000000001',
      stationId: '20000000-0000-7000-8000-000000000003', stationCode: 'PUJ',
      from: '2026-08-18', to: '2026-08-19', currencyCode: 'USD', total: 125.5,
      status: 'Invoiced', createdAt: '2026-08-20T12:00:00Z' }] };
  getPreinvoices.mockResolvedValueOnce(invoicedPage).mockResolvedValueOnce(invoicedPage);
  const invoicedDetail = { id: '74000000-0000-7000-8000-000000000001',
    stationId: '20000000-0000-7000-8000-000000000003', stationCode: 'PUJ',
    from: '2026-08-18', to: '2026-08-19', currencyCode: 'USD', total: 125.5,
    status: 'Invoiced', createdAt: '2026-08-20T12:00:00Z', lines: [{
      id: '74000000-0000-7000-8000-000000000002', operationCode: 'DEV-TAT-0021',
      operationDate: '2026-08-18', serviceCode: 'GPU', serviceName: 'Ground power',
      executedQuantity: 1, billingUnit: 'hour', unitPrice: 125.5, amount: 125.5 }] };
  getPreinvoice.mockResolvedValueOnce(invoicedDetail).mockResolvedValueOnce(invoicedDetail);
  getInvoicePayment.mockResolvedValueOnce({
    invoiceId: '74000000-0000-7000-8000-000000000009', payment: null,
  });
  const page = render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole('button', { name: /Ver l.*neas de prefactura/i }));
  expect(await screen.findByText(/NF-74000000000070008000000000000009/)).toBeInTheDocument();
  expect(getPreinvoiceInvoice).toHaveBeenCalledExactlyOnceWith(
    '74000000-0000-7000-8000-000000000001');
  expect(getInvoicePayment).toHaveBeenCalledWith('74000000-0000-7000-8000-000000000009');
  expect(screen.getByText('Sin pago registrado.')).toBeInTheDocument();
  financeRevision = 1;
  page.rerender(<AirlinePortalPage view="finance" />);
  expect(await screen.findByText(/BANK-TEST-123/)).toBeInTheDocument();
  expect(getInvoicePayment).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Aceptar prefactura' })).not.toBeInTheDocument();
});

it("requires explicit confirmation before accepting a published preinvoice", async () => {
  render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver líneas de prefactura/i }));
  await screen.findByText("Ground power");
  fireEvent.click(screen.getByRole("button", { name: "Aceptar prefactura" }));
  expect(acceptPreinvoice).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirmar aceptación" }));
  await screen.findByText(/Aceptación registrada/);
  expect(acceptPreinvoice).toHaveBeenCalledExactlyOnceWith(
    "74000000-0000-7000-8000-000000000001");
});

it("selects disputed lines and requires confirmation before submitting a real objection", async () => {
  render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver l.*neas de prefactura/i }));
  await screen.findByText("Ground power");
  fireEvent.click(screen.getByRole("button", { name: "Disputar prefactura" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Ground power/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Asunto de la disputa" }),
    { target: { value: "Cantidad incorrecta" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Descripci.*n de la disputa/ }),
    { target: { value: "La cantidad de GPU no coincide." } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar disputa" }));
  expect(disputePreinvoice).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirmar disputa" }));
  expect(await screen.findByText(/Disputa registrada/)).toBeInTheDocument();
  expect(disputePreinvoice).toHaveBeenCalledExactlyOnceWith(
    "74000000-0000-7000-8000-000000000001",
    expect.objectContaining({ subject: "Cantidad incorrecta",
      description: "La cantidad de GPU no coincide.",
      lineIds: ["74000000-0000-7000-8000-000000000002"],
      requestId: expect.any(String) }));
});

it("shows the Finance resolution and reason on a previously published preinvoice", async () => {
  getPreinvoiceDisputes.mockResolvedValueOnce({
    preinvoiceId: "74000000-0000-7000-8000-000000000001",
    disputes: [{ id: "74000000-0000-7000-8000-000000000020",
      subject: "Cantidad incorrecta", description: "La cantidad de GPU no coincide.",
      createdAt: "2026-09-28T16:00:00Z",
      lineIds: ["74000000-0000-7000-8000-000000000002"],
      resolution: { id: "74000000-0000-7000-8000-000000000021",
        decision: "Maintain", reason: "Servicio ejecutado según evidencia.",
        resolvedAt: "2026-09-28T17:00:00Z" } }],
  });
  render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver l.*neas de prefactura/i }));
  const record = await screen.findByLabelText(
    "Disputa 74000000-0000-7000-8000-000000000020");
  expect(within(record).getByText(/Finanzas mantuvo la prefactura/)).toBeInTheDocument();
  expect(within(record).getByText(/Servicio ejecutado seg.*n evidencia/)).toBeInTheDocument();
});

it("keeps a voided preinvoice visible as read-only history", async () => {
  getPreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [{ id: "74000000-0000-7000-8000-000000000001",
      stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
      from: "2026-08-18", to: "2026-08-19", currencyCode: "USD", total: 125.5,
      status: "Voided", createdAt: "2026-08-20T12:00:00Z" }] });
  getPreinvoice.mockResolvedValueOnce({
    id: "74000000-0000-7000-8000-000000000001",
    stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
    from: "2026-08-18", to: "2026-08-19", currencyCode: "USD", total: 125.5,
    status: "Voided", createdAt: "2026-08-20T12:00:00Z",
    lines: [{ id: "74000000-0000-7000-8000-000000000002",
      operationCode: "DEV-TAT-0021", operationDate: "2026-08-18",
      serviceCode: "GPU", serviceName: "Ground power",
      executedQuantity: 1, billingUnit: "hour", unitPrice: 125.5, amount: 125.5 }],
  });
  getPreinvoiceDisputes.mockResolvedValueOnce({
    preinvoiceId: "74000000-0000-7000-8000-000000000001",
    disputes: [{ id: "74000000-0000-7000-8000-000000000020",
      subject: "Servicio ausente", description: "No se prestó el servicio.",
      createdAt: "2026-09-28T16:00:00Z",
      lineIds: ["74000000-0000-7000-8000-000000000002"],
      resolution: { id: "74000000-0000-7000-8000-000000000021",
        decision: "Void", reason: "Cargo anulado tras revisión.",
        resolvedAt: "2026-09-28T17:00:00Z" } }],
  });
  render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver l.*neas de prefactura/i }));
  const record = await screen.findByLabelText(
    "Disputa 74000000-0000-7000-8000-000000000020");
  expect(screen.getByText("Anulada")).toBeInTheDocument();
  expect(within(record).getByText(/Finanzas anuló la prefactura/)).toBeInTheDocument();
  expect(within(record).getByText(/Cargo anulado tras revisión/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Aceptar prefactura" })).not.toBeInTheDocument();
});

it("does not claim acceptance when the server reports a competing decision", async () => {
  acceptPreinvoice.mockRejectedValueOnce(new ElevantApiError({ kind: "http", status: 409 }));
  render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole("button", { name: /Ver líneas de prefactura/i }));
  await screen.findByText("Ground power");
  fireEvent.click(screen.getByRole("button", { name: "Aceptar prefactura" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar aceptación" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/cambió antes de aceptarla/i);
  expect(screen.queryByText(/Aceptación registrada/)).not.toBeInTheDocument();
});

it("does not show a stale acceptance banner after opening another preinvoice", async () => {
  getPreinvoices.mockResolvedValueOnce({ page: 1, limit: 20, hasMore: false,
    preinvoices: [
      { id: "74000000-0000-7000-8000-000000000001",
        stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
        from: "2026-08-18", to: "2026-08-19", currencyCode: "USD", total: 125.5,
        status: "Submitted", createdAt: "2026-08-20T12:00:00Z" },
      { id: "74000000-0000-7000-8000-000000000003",
        stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
        from: "2026-08-18", to: "2026-08-19", currencyCode: "USD", total: 95,
        status: "Submitted", createdAt: "2026-08-21T12:00:00Z" },
    ] });
  let finish!: () => void;
  acceptPreinvoice.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<AirlinePortalPage view="finance" />);
  fireEvent.click(await screen.findByRole("button", {
    name: "Ver líneas de prefactura 74000000-0000-7000-8000-000000000001" }));
  await screen.findByLabelText("Líneas de prefactura 74000000-0000-7000-8000-000000000001");
  fireEvent.click(screen.getByRole("button", { name: "Aceptar prefactura" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar aceptación" }));
  fireEvent.click(screen.getByRole("button", {
    name: "Ver líneas de prefactura 74000000-0000-7000-8000-000000000003" }));
  await screen.findByLabelText("Líneas de prefactura 74000000-0000-7000-8000-000000000003");
  await act(async () => { finish(); });
  expect(screen.queryByText(/Aceptación registrada/)).not.toBeInTheDocument();
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

it("reports only tenant-scoped operations and published preinvoices returned by the API", async () => {
  render(<AirlinePortalPage view="reports" />);
  expect(await screen.findByText("DEV-TAT-0002")).toBeInTheDocument();
  expect(await screen.findByText(/USD 125\.50/)).toBeInTheDocument();
  expect(getOperations).toHaveBeenCalledWith(1);
  expect(getPreinvoices).toHaveBeenCalledWith(1);
  expect(screen.getByText(/Operaciones cargadas/)).toBeInTheDocument();
  expect(screen.getByText(/Prefacturas cargadas/)).toBeInTheDocument();
  expect(screen.queryByText(/Vuelos de ejemplo|Indicador ilustrativo|Datos de demostración/)).not.toBeInTheDocument();
  expect(screen.queryByText(/50%|67%|US\$413/)).not.toBeInTheDocument();
});

it("reports honest empty and recoverable error states without retaining stale data", async () => {
  historyPage = { page: 1, limit: 20, hasMore: false, operations: [] };
  preinvoicePage = { page: 1, limit: 20, hasMore: false, preinvoices: [] };
  getPreinvoices.mockRejectedValueOnce(new Error("private transport detail"));
  render(<AirlinePortalPage view="reports" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudieron actualizar los reportes/);
  expect(screen.queryByText(/private transport detail/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Reintentar reportes/ }));
  expect(await screen.findByText(/No hay operaciones registradas/)).toBeInTheDocument();
  expect(screen.getByText(/No hay prefacturas publicadas/)).toBeInTheDocument();
});

it("does not round away the published financial snapshot precision", async () => {
  preinvoicePage = { ...initialPreinvoicePage, preinvoices: [
    { ...initialPreinvoicePage.preinvoices[0], total: 125.1234 },
  ] };
  render(<AirlinePortalPage view="reports" />);
  expect(await screen.findByText("USD 125.1234")).toBeInTheDocument();
});

it("hides an old report while a finance change is being revalidated", async () => {
  const page = render(<AirlinePortalPage view="reports" />);
  expect(await screen.findByText(/USD 125\.50/)).toBeInTheDocument();
  let finish!: (value: typeof preinvoicePage) => void;
  getPreinvoices.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  financeRevision += 1;
  page.rerender(<AirlinePortalPage view="reports" />);
  expect(screen.queryByText(/USD 125\.50/)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/Cargando reportes autorizados/);
  await act(async () => finish({ page: 1, limit: 20, hasMore: false, preinvoices: [] }));
  expect(await screen.findByText(/No hay prefacturas publicadas/)).toBeInTheDocument();
});

it("shows an honest empty state when the airline has no operational requests", async () => {
  requestPage = { page: 1, limit: 20, hasMore: false, requests: [] };
  render(<AirlinePortalPage view="requests" />);
  expect(await screen.findByText(/No hay solicitudes operativas registradas/)).toBeInTheDocument();
  expect(screen.queryByText("Escalera adicional")).not.toBeInTheDocument();
  expect(screen.queryByText(/datos sintéticos/i)).not.toBeInTheDocument();
});
