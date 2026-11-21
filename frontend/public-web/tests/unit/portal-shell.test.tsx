import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { AirlinePortalBootstrapResponse, AirlinePortalStandingResponse,
  SessionActorResponse } from "@elevant/api-client";

import type { AirlineStandingState } from "@/components/auth/AirlineSessionProvider";
import { PortalShell } from "@/components/portal/PortalShell";

// N14: the shell names the airline's standing and its stations in force, never «autorizado» without a contract.
let pathname = "/portal";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const organizationId = "10000000-0000-7000-8000-000000000002";
const contractId = "60000000-0000-7000-8000-000000000002";
const actor: SessionActorResponse = { accountId: "40000000-0000-7000-8000-000000000003",
  email: "airline.client@dev.elevant.test", displayName: "Casey Airline", roles: [], memberships: [], stationScopes: [] };
const puj = { id: "20000000-0000-7000-8000-000000000003", code: "PUJ", name: "Punta Cana",
  ianaTimeZone: "America/Santo_Domingo" };
const sdq = { id: "20000000-0000-7000-8000-000000000004", code: "SDQ", name: "Santo Domingo",
  ianaTimeZone: "America/Santo_Domingo" };

let bootstrapStations: AirlinePortalBootstrapResponse["stations"] = [puj];
let standing: AirlineStandingState = { status: "loading", data: null };
const requestStanding = vi.fn();

vi.mock("@/components/auth/AirlineSessionProvider", () => ({
  useAirlineSession: () => ({
    status: "ready", signOut: vi.fn(), standing, requestStanding, retryStanding: vi.fn(),
    session: { actor, expiresAt: "2099-01-01T00:00:00Z", bootstrap: { airlineId: "20000000-0000-7000-8000-000000000001",
      organizationId, iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines", stations: bootstrapStations,
      currentOperations: [] } },
  }),
}));

const ready = (data: Omit<AirlinePortalStandingResponse, "organizationId">): AirlineStandingState =>
  ({ status: "ready", data: { organizationId, ...data } });

function mountShell() {
  render(<PortalShell><h1>Inicio</h1></PortalShell>);
  return {
    sidebar: screen.getByRole("complementary", { name: "Navegación principal" }),
    topbar: screen.getByRole("banner"),
  };
}

afterEach(() => {
  cleanup();
  pathname = "/portal";
  bootstrapStations = [puj];
  standing = { status: "loading", data: null };
  requestStanding.mockClear();
});

describe("portal shell standing (N14)", () => {
  it("tells an airline without a contract so, and never calls the portal or a station «autorizado»", () => {
    bootstrapStations = [];
    standing = ready({ status: "None", readOnly: true, stations: [], contracts: [] });
    const { sidebar, topbar } = mountShell();
    expect(within(sidebar).getByText("Sin contrato con AVIAM")).toHaveAttribute("data-tone", "none");
    expect(within(topbar).getByText("Sin estación en vigor")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/autorizad/i);
  });

  it("names a contract in force and the stations it covers today", () => {
    standing = ready({ status: "Active", readOnly: false, stations: [{ ...puj, current: true }], contracts: [] });
    const first = mountShell();
    expect(within(first.sidebar).getByText("Contrato en vigor")).toHaveAttribute("data-tone", "ok");
    expect(within(first.topbar).getByText("Estación en vigor")).toBeInTheDocument();
    expect(within(first.topbar).getByText("PUJ")).toBeInTheDocument();
    cleanup();

    standing = ready({ status: "Active", readOnly: false,
      stations: [{ ...puj, current: true }, { ...sdq, current: true }], contracts: [] });
    const both = mountShell();
    expect(within(both.topbar).getByText("Estaciones en vigor")).toBeInTheDocument();
    expect(within(both.topbar).getByText("PUJ, SDQ")).toBeInTheDocument();
  });

  it.each([
    ["loading", { status: "loading", data: null }],
    ["error", { status: "error", data: null }],
    ["forbidden", { status: "forbidden", data: null }],
  ] as const)("claims nothing about the contract while the standing is %s, and shows the bootstrap's stations",
    (_, state: AirlineStandingState) => {
      standing = state;
      const { sidebar, topbar } = mountShell();
      // The badge is the only element of the shell with a tone.
      expect(sidebar.querySelector("[data-tone]")).toBeNull();
      expect(document.body).not.toHaveTextContent(/autorizad/i);
      expect(within(topbar).getByText("Estación en vigor")).toBeInTheDocument();
      expect(within(topbar).getByText("PUJ")).toBeInTheDocument();
      expect(requestStanding).toHaveBeenCalled();
    });

  it("takes the stations from the standing when the bootstrap, read at another moment, disagrees", () => {
    // The bootstrap still lists PUJ; the standing says the contract expired.
    standing = ready({ status: "Expired", readOnly: true, stations: [{ ...puj, current: false }],
      contracts: [{ id: contractId, code: "CTR-2026-0001", status: "Expired", pendingReason: null,
        versionsAwaitingSignatures: [] }] });
    const expired = mountShell();
    expect(within(expired.sidebar).getByText("Contrato vencido")).toHaveAttribute("data-tone", "none");
    expect(within(expired.topbar).getByText("Sin estación en vigor")).toBeInTheDocument();
    expect(expired.topbar).not.toHaveTextContent("PUJ");
    cleanup();

    // The bootstrap lists nothing yet; the standing already has PUJ in force.
    bootstrapStations = [];
    standing = ready({ status: "Active", readOnly: false, stations: [{ ...puj, current: true }], contracts: [] });
    const active = mountShell();
    expect(within(active.topbar).getByText("PUJ")).toBeInTheDocument();
    expect(active.topbar).not.toHaveTextContent("Sin estación en vigor");
  });

  it("calls a pending contract without a reason «Pendiente de activación», not in force", () => {
    bootstrapStations = [];
    standing = ready({ status: "Pending", readOnly: true, stations: [], contracts: [{ id: contractId,
      code: "CTR-2026-0001", status: "Draft", pendingReason: null, versionsAwaitingSignatures: [] }] });
    const { sidebar, topbar } = mountShell();
    expect(within(sidebar).getByText("Pendiente de activación")).toHaveAttribute("data-tone", "pending");
    expect(within(topbar).getByText("Sin estación en vigor")).toBeInTheDocument();
  });
});

describe("portal shell billing (PR F)", () => {
  it("keeps «Facturas» in the phone's bar and names the invoice and statement pages in the top bar", () => {
    pathname = "/portal/finanzas/facturas/74000000-0000-7000-8000-000000000009";
    const { topbar } = mountShell();
    const phone = screen.getByRole("navigation", { name: "Navegación móvil" });
    expect(within(phone).getAllByRole("link").map(link => link.textContent))
      .toEqual(["Inicio", "Vuelos", "Solicitudes", "Facturas"]);
    expect(within(phone).getByRole("link", { name: "Facturas" })).toHaveAttribute("aria-current", "page");
    expect(within(topbar).getByText("Detalle de factura")).toBeInTheDocument();
    cleanup();

    pathname = "/portal/finanzas/estado-de-cuenta";
    expect(within(mountShell().topbar).getByText("Estado de cuenta")).toBeInTheDocument();
  });

  it("prints the page with its title and the moment it was printed, never on screen", () => {
    pathname = "/portal/finanzas";
    mountShell();
    const header = screen.getByText(/^Portal de aerolíneas · Demo Airlines · Facturas/, { selector: "p" });
    expect(header).toHaveAttribute("aria-hidden", "true");
    expect(header).not.toHaveTextContent("Impreso");
    act(() => { window.dispatchEvent(new Event("beforeprint")); });
    expect(header).toHaveTextContent(/Impreso el \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });
});