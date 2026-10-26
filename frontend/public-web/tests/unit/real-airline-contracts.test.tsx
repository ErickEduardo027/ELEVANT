import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AirlineContractPageResponse, AirlinePortalBootstrapResponse,
  ContractSigningResponse,
  SessionResponse } from "@elevant/api-client";
import { AIRLINE_SESSION_STORAGE_KEY,
  AirlineSessionProvider } from "@/components/auth/AirlineSessionProvider";
import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

vi.mock("@/lib/airline-change-observer", () => ({
  createPublicAirlineChangeObserver: () => ({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

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
  airlineId: "20000000-0000-7000-8000-000000000001",
  organizationId: actor.memberships[0].organizationId,
  iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines",
  stations: [], currentOperations: [],
};
const contracts: AirlineContractPageResponse = {
  page: 1, limit: 20, hasMore: false,
  contracts: [{
    id: "60000000-0000-7000-8000-000000000002", code: "DEV-CONTRACT-0001",
    status: "Expired", signedOn: "2026-01-01", terminatedOn: null,
    requiresElectronicSigning: false, signingStatus: "Legacy",
    approvedVersions: [{
      id: "60000000-0000-7000-8000-000000000003", versionNumber: 1,
      validFrom: "2026-01-01", validTo: "2026-08-31", currencyCode: "USD",
      stations: [{ id: "20000000-0000-7000-8000-000000000003",
        code: "PUJ", name: "Punta Cana" }],
      rates: [{ id: "60000000-0000-7000-8000-000000000004",
        serviceCode: "BAG", serviceName: "Manejo de equipaje", billingUnit: "operation",
        unitPrice: 125.5, minimumQuantity: 1 }],
    }],
  }],
};

function mount(page: AirlineContractPageResponse, drafts: unknown = [],
  signing?: ContractSigningResponse, signingUrl?: string) {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: "synthetic-token", expiresAt: "2099-01-01T00:00:00Z",
  }));
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");
    const body = path.endsWith("/signing-link") ? { url: signingUrl }
      : path.endsWith("/signing") ? signing
      : path.endsWith("/bootstrap") ? bootstrap
      : path.endsWith("/contracts") ? page
        : path.endsWith("/contract-drafts") ? drafts : { actor };
    return new Response(JSON.stringify(body), { status: 200,
      headers: { "content-type": "application/json" } });
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AirlinePortalPage view="contracts" />
  </AirlineSessionProvider>);
  return paths;
}

afterEach(() => {
  cleanup(); sessionStorage.clear(); vi.unstubAllGlobals();
});

it("labels unconfirmed draft pricing as pending, including a zero placeholder", async () => {
  mount({ page: 1, limit: 20, hasMore: false, contracts: [] }, [{
    id: "draft-1", contractId: "contract-1", contractCode: "DEV-CONTRACT-0002",
    airline: "Demo Airlines", status: "Draft", validFrom: "2026-10-01", validTo: null,
    currencyCode: "USD", terms: null, stations: [], comments: [],
    rates: [{ id: "rate-1", serviceName: "Rampa", billingUnit: "operación",
      unitPrice: 0, minimumQuantity: 1, isConfirmed: false }],
  }]);
  expect(await screen.findByText("Rampa")).toBeInTheDocument();
  expect(screen.getByText(/Precio por operación: por definir/i)).toBeInTheDocument();
  expect(screen.queryByText(/US\$0/)).not.toBeInTheDocument();
});

it("shows the airline's real approved contract history and rates", async () => {
  const paths = mount(contracts);
  expect(await screen.findByText("DEV-CONTRACT-0001")).toBeInTheDocument();
  expect(screen.getByText("Manejo de equipaje")).toBeInTheDocument();
  expect(screen.getByText(/125/)).toBeInTheDocument();
  expect(screen.queryByText("DEMO-CON-001")).not.toBeInTheDocument();
  expect(paths).toContain("/api/v1/airline/portal/contracts");
});

it("offers Adobe only to the designated representative after AVIAM's turn", async () => {
  const page: AirlineContractPageResponse = { ...contracts, contracts: [{
    ...contracts.contracts[0]!, status: "Draft", signedOn: null,
    requiresElectronicSigning: true, signingStatus: "AwaitingAirline",
  }] };
  const signing: ContractSigningResponse = {
    contractId: page.contracts[0]!.id, versionId: page.contracts[0]!.approvedVersions[0]!.id,
    contractCode: page.contracts[0]!.code, airlineName: "Demo Airlines",
    versionStatus: "Approved", signingStatus: "AwaitingAirline",
    requiresElectronicSigning: true, airlineSignerAccountId: actor.accountId,
    signingMethod: "Adobe",
  };
  const url = "https://secure.na1.echosign.com/public/apiesign?pid=synthetic";
  const tab = { opener: null, location: { href: "" }, close: vi.fn() };
  vi.stubGlobal("open", vi.fn(() => tab));
  mount(page, [], signing, url);
  await userEvent.click(await screen.findByRole("button", { name: "Abrir firma en Adobe" },
    { timeout: 5000 }));
  expect(tab.location.href).toBe(url);
  expect(screen.queryByRole("button", { name: /Ver, descargar o imprimir contrato/ })).not.toBeInTheDocument();
});

it("shows an honest empty state with no fabricated contract", async () => {
  mount({ page: 1, limit: 20, hasMore: false, contracts: [] });
  expect(await screen.findByText(/No hay contratos aprobados/i)).toBeInTheDocument();
  expect(screen.queryByText("DEMO-CON-001")).not.toBeInTheDocument();
});
