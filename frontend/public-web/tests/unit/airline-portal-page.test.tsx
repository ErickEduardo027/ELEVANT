import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AirlinePortalBootstrapResponse, SessionActorResponse } from "@elevant/api-client";

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

vi.mock("@/components/auth/AirlineSessionProvider", () => ({
  useAirlineSession: () => ({ status: "ready", session: { actor, bootstrap: { ...bootstrap, currentOperations }, expiresAt: "2099-01-01T00:00:00Z" } }),
}));

afterEach(() => { cleanup(); currentOperations = bootstrap.currentOperations; });

it("shows only tenant-scoped bootstrap operations in overview and flights", () => {
  const page = render(<AirlinePortalPage view="overview" />);
  expect(screen.getByRole("heading", { level: 1, name: /Demo Airlines/ })).toBeInTheDocument();
  expect(screen.getByText("DEV-TAT-0002")).toBeInTheDocument();
  page.rerender(<AirlinePortalPage view="flights" />);
  expect(screen.getByRole("link", { name: /DEV-TAT-0002/ })).toHaveAttribute(
    "href", "/portal/vuelos/30000000-0000-7000-8000-000000000003");
});

it("does not invent details for an operation outside the authorized bootstrap", () => {
  render(<AirlinePortalPage view="flightDetail" operationId="not-authorized" />);
  expect(screen.getByText(/no está disponible en la consulta autorizada/i)).toBeInTheDocument();
  expect(screen.queryByText("DEV-TAT-0002")).not.toBeInTheDocument();
});

it("keeps modules without real API data read-only and honest", () => {
  render(<AirlinePortalPage view="finance" />);
  expect(screen.getByRole("heading", { level: 1, name: "Finanzas" })).toBeInTheDocument();
  expect(screen.getByText(/todavía no está disponible/i)).toBeInTheDocument();
  expect(screen.getByText(/datos de demostración/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /aceptar prefactura/i })).toBeDisabled();
});

it("shows verified account and station scope in profile", () => {
  render(<AirlinePortalPage view="profile" />);
  expect(screen.getByText(actor.email)).toBeInTheDocument();
  expect(screen.getByText("PUJ · Punta Cana")).toBeInTheDocument();
});

it("keeps API emptiness honest while showing a clearly labelled, inert flight demonstration", () => {
  currentOperations = [];
  const page = render(<AirlinePortalPage view="overview" />);
  expect(screen.getByText(/0 operaciones reales/)).toBeInTheDocument();
  expect(screen.getByText(/datos sintéticos/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Vuelos activos" })).toBeInTheDocument();
  expect(screen.getByText("EV 311")).toBeInTheDocument();
  expect(screen.queryByText("ZZ 900")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /EV 311/ })).not.toBeInTheDocument();
  page.rerender(<AirlinePortalPage view="flights" />);
  expect(screen.getByRole("heading", { name: "4 rotaciones" })).toBeInTheDocument();
  expect(screen.getByText(/0 operaciones reales/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /EV 311/ })).not.toBeInTheDocument();
});

it("shows the request preview as a non-actionable example", () => {
  render(<AirlinePortalPage view="requests" />);
  expect(screen.getByRole("heading", { name: /Solicitudes con estado visible/ })).toBeInTheDocument();
  expect(screen.getByText("Escalera adicional")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Nueva solicitud" })).toBeDisabled();
});
