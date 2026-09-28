import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ElevantApiError, type AirlineOperationPageResponse,
  type AirlineOperationalRequestPageResponse, type AirlinePortalBootstrapResponse,
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
const getPreinvoices = vi.fn(async () => ({ page: 1, limit: 20, hasMore: false,
  preinvoices: [{ id: "74000000-0000-7000-8000-000000000001",
    stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
    from: "2026-08-18", to: "2026-08-19", currencyCode: "USD", total: 125.5,
    status: "Submitted", createdAt: "2026-08-20T12:00:00Z" }] }));
const getPreinvoice = vi.fn(async (id: string) => ({
  id, stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
  from: "2026-08-18", to: "2026-08-19", currencyCode: "USD", total: 125.5,
  status: "Submitted", createdAt: "2026-08-20T12:00:00Z",
  lines: [{ id: "74000000-0000-7000-8000-000000000002",
    operationCode: "DEV-TAT-0021", operationDate: "2026-08-18",
    serviceCode: "GPU", serviceName: "Ground power",
    executedQuantity: 1, billingUnit: "hour", unitPrice: 125.5, amount: 125.5 }],
}));

vi.mock("@/components/auth/AirlineSessionProvider", () => ({
  useAirlineSession: () => ({ status: "ready", session: { actor, bootstrap: { ...bootstrap, currentOperations }, expiresAt: "2099-01-01T00:00:00Z" }, getOperations, getOperation, getRequests, getPreinvoices, getPreinvoice, operationRevision: 0, financeRevision }),
}));

afterEach(() => { cleanup(); currentOperations = bootstrap.currentOperations; historyPage = {
  page: 1, limit: 20, hasMore: false, operations: bootstrap.currentOperations,
}; detailOperation = bootstrap.currentOperations[0]; getOperations.mockClear(); getOperation.mockClear();
  requestPage = initialRequestPage; getRequests.mockClear(); getPreinvoice.mockClear();
  getPreinvoices.mockClear(); financeRevision = 0; });

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

it("keeps modules without real API data read-only and honest", () => {
  render(<AirlinePortalPage view="documents" />);
  expect(screen.getByRole("heading", { level: 1, name: "Documentos" })).toBeInTheDocument();
  expect(screen.getByText(/todavía no están disponibles/i)).toBeInTheDocument();
  expect(screen.getByText(/datos de demostración/i)).toBeInTheDocument();
  for (const button of screen.getAllByRole("button", { name: /descargar documento/i }))
    expect(button).toBeDisabled();
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
