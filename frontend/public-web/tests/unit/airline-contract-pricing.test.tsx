import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AirlineContractPageResponse, AirlinePortalBootstrapResponse, ContractPricingTermsResponse,
  SessionResponse } from "@elevant/api-client";
import { AIRLINE_SESSION_STORAGE_KEY, AirlineSessionProvider } from "@/components/auth/AirlineSessionProvider";
import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

vi.mock("@/lib/airline-change-observer", () => ({
  createPublicAirlineChangeObserver: () => ({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

const versionId = "60000000-0000-7000-8000-000000000003";
const actor: SessionResponse["actor"] = {
  accountId: "40000000-0000-7000-8000-000000000003",
  email: "airline.client@dev.elevant.test", displayName: "Casey Airline",
  roles: [{ roleId: "41000000-0000-7000-8000-000000000003", code: "AIRLINE_CLIENT",
    name: "Airline Client", portal: "airline_portal", userType: "airline_client" }],
  memberships: [{ membershipId: "42000000-0000-7000-8000-000000000003",
    organizationId: "10000000-0000-7000-8000-000000000002", organizationCode: "DEMO-AIR",
    organizationName: "Demo Airlines", organizationType: "airline_customer", kind: "airline_client" }],
  stationScopes: [],
};
const bootstrap: AirlinePortalBootstrapResponse = {
  airlineId: "20000000-0000-7000-8000-000000000001", organizationId: actor.memberships[0].organizationId,
  iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines", stations: [], currentOperations: [],
};
const contracts: AirlineContractPageResponse = {
  page: 1, limit: 20, hasMore: false,
  contracts: [{
    id: "60000000-0000-7000-8000-000000000002", code: "CTR-2026-0001", status: "Active", signedOn: "2026-01-01",
    terminatedOn: null,
    approvedVersions: [{ id: versionId, versionNumber: 2, validFrom: "2027-01-01", validTo: "2027-12-31",
      currencyCode: "USD", stations: [{ id: "20000000-0000-7000-8000-000000000003", code: "PUJ", name: "Punta Cana" }],
      rates: [] }],
  }],
};
const terms: ContractPricingTermsResponse = {
  versionId, currencyCode: "USD", inDocument: true, signed: false,
  charges: [
    { chargeCode: "NIGHT", chargeName: "Recargo nocturno", method: "PercentOfService", billingUnit: null,
      quantityRule: "One", graceMinutes: 0, roundingIncrement: 0, isExcluded: false, value: 25, minimumAmount: 0 },
    { chargeCode: "GPU-OT", chargeName: "Exceso de GPU", method: "PerMinute", billingUnit: "minute",
      quantityRule: "OperationOverrun", graceMinutes: 15, roundingIncrement: 1, isExcluded: false, value: 2, minimumAmount: 10 },
    { chargeCode: "WEEKEND", chargeName: "Fin de semana", method: "FixedAmount", billingUnit: "operation",
      quantityRule: "One", graceMinutes: 0, roundingIncrement: 0, isExcluded: true, value: null, minimumAmount: null },
  ],
  packages: [{ code: "TAT", name: "Escala completa", versionNumber: 3, scope: "Turnaround", flightDirection: null,
    periodDays: null, basePrice: 500, currencyCode: "USD", components: [{ serviceCode: "RAMP", serviceName: "Rampa",
      billingUnit: "operation", includedQuantity: 1, excessBlockSize: 1, excessBlockPrice: 120 }] }],
};

function mount(pricing: () => Response) {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: "synthetic-token", expiresAt: "2099-01-01T00:00:00Z",
  }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/pricing-terms")) return pricing();
    const body = path.endsWith("/bootstrap") ? bootstrap : path.endsWith("/contracts") ? contracts
      : path.endsWith("/contract-drafts") || path.endsWith("/airline/permits") ? [] : { actor };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><AirlinePortalPage view="contracts" /></AirlineSessionProvider>);
}

afterEach(() => {
  cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("shows the surcharges and packages of a version, in Spanish, as part of the content to sign (2-N04)", async () => {
  mount(() => Response.json(terms));
  const section = await screen.findByRole("region", { name: "Recargos y paquetes" });
  expect(await within(section).findByText("Recargo nocturno")).toBeInTheDocument();
  expect(within(section).getByText(/Forman parte del contenido a firmar/)).toBeInTheDocument();
  expect(within(section).getByText(/Porcentaje del servicio · 25 %/)).toBeInTheDocument();
  expect(within(section).getByText(/Por minuto, según el exceso de la operación, 15 min de gracia/)).toBeInTheDocument();
  expect(within(section).getByText(/Monto fijo · Exento/)).toBeInTheDocument();
  expect(within(section).getByText(/Por escala · precio base/)).toBeInTheDocument();
  expect(within(section).getByText(/Incluye: Rampa \(1 operación\), exceso/)).toBeInTheDocument();
  expect(within(section).queryByText(/PercentOfService|operation\b/)).not.toBeInTheDocument();
});

it("offers a retry when the terms cannot be read and says when the account cannot see them", async () => {
  let attempts = 0;
  mount(() => (attempts++ === 0 ? new Response("{}", { status: 503 }) : Response.json({ ...terms, signed: true })));
  const section = await screen.findByRole("region", { name: "Recargos y paquetes" });
  fireEvent.click(await within(section).findByRole("button", { name: "Reintentar" }));
  expect(await within(section).findByText(/Forman parte del contenido que firmaron ambas partes/)).toBeInTheDocument();
  cleanup();
  mount(() => Response.json({ type: "about:blank", title: "Forbidden", status: 403, code: "forbidden" },
    { status: 403, headers: { "content-type": "application/problem+json" } }));
  expect(await screen.findByText(/Su cuenta no puede consultar los recargos y paquetes/)).toBeInTheDocument();
});

it("says when the surcharges of an older version are not part of its signed content", async () => {
  mount(() => Response.json({ ...terms, inDocument: false, packages: [] }));
  expect(await screen.findByText(/No forman parte del contenido firmado de esta versión/)).toBeInTheDocument();
});

it("shows an honest empty state for a version without surcharges or packages", async () => {
  mount(() => Response.json({ ...terms, inDocument: false, charges: [], packages: [] }));
  expect(await screen.findByText("Esta versión no tiene recargos ni paquetes.")).toBeInTheDocument();
});

it("limits the permit dates by the business day of Santo Domingo, not the UTC day (2-F)", async () => {
  // 21:00 on 5 November in Santo Domingo is already 6 November in UTC.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T01:00:00Z"));
  mount(() => Response.json(terms));
  const form = await screen.findByRole("form", { name: "Enviar un permiso" });
  expect(within(form).getByLabelText("Fecha de vencimiento")).toHaveAttribute("min", "2026-11-05");
  expect(within(form).getByLabelText("Fecha de emisión")).toHaveAttribute("max", "2026-11-05");
});
