import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AirlinePortalBootstrapResponse, SessionResponse } from "@elevant/api-client";
import { DevelopmentAirlinePortal } from "@/components/live/DevelopmentAirlinePortal";

const session: SessionResponse = {
  accessToken: "synthetic-development-token",
  tokenType: "Bearer",
  expiresAt: "2026-09-25T12:00:00Z",
  actor: {
    accountId: "40000000-0000-7000-8000-000000000003",
    email: "airline.client@dev.elevant.test",
    displayName: "Casey Airline",
    roles: [{ roleId: "41000000-0000-7000-8000-000000000003",
      code: "AIRLINE_CLIENT", name: "Airline Client", portal: "airline_portal",
      userType: "airline_client" }],
    memberships: [{ membershipId: "42000000-0000-7000-8000-000000000003",
      organizationId: "10000000-0000-7000-8000-000000000002",
      organizationCode: "DEMO-AIR", organizationName: "Demo Airlines",
      organizationType: "airline_customer", kind: "airline_client" }],
    stationScopes: [],
  },
};

const bootstrap: AirlinePortalBootstrapResponse = {
  airlineId: "20000000-0000-7000-8000-000000000001",
  organizationId: "10000000-0000-7000-8000-000000000002",
  iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines",
  stations: [{ id: "20000000-0000-7000-8000-000000000003", code: "PUJ",
    name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" }],
  currentOperations: [{
    id: "70000000-0000-7000-8000-000000000005",
    code: "DEV-TAT-0001",
    stationId: "20000000-0000-7000-8000-000000000003",
    stationCode: "PUJ",
    operationDate: "2026-09-25",
    status: "Assigned",
    arrivalFlightNumber: "ZZ100",
    departureFlightNumber: "ZZ101",
    plannedStartAt: null,
    plannedEndAt: null,
  }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Development airline portal", () => {
  it("uses the real session and tenant bootstrap without persisting the token", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return json(url.endsWith("/auth/session") ? session : bootstrap);
    }));
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    render(<DevelopmentAirlinePortal baseUrl="https://api.example.test" />);

    fireEvent.change(screen.getByLabelText("Correo corporativo"), {
      target: { value: session.actor.email },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar al portal" }));

    await screen.findByRole("heading", { name: "Demo Airlines" });
    expect(screen.getByText("PUJ")).toBeInTheDocument();
    expect(screen.getByText("DEV-TAT-0001")).toBeInTheDocument();
    expect(screen.getByText("Asignada")).toBeInTheDocument();
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.example.test/api/v1/auth/session",
      "https://api.example.test/api/v1/airline/portal/bootstrap",
    ]);
    expect(calls.map((call) => call.authorization)).toEqual([
      null, "Bearer synthetic-development-token",
    ]);
    expect(localWrite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Entrar al portal" }))
      .toBeInTheDocument());
    expect(screen.queryByText("PUJ")).not.toBeInTheDocument();
    expect(screen.queryByText("DEV-TAT-0001")).not.toBeInTheDocument();
  });

  it("does not show an airline context after a forbidden bootstrap", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/auth/session")
        ? json(session)
        : json({ title: "Forbidden", status: 403 }, 403)));
    render(<DevelopmentAirlinePortal baseUrl="https://api.example.test" />);

    fireEvent.change(screen.getByLabelText("Correo corporativo"), {
      target: { value: session.actor.email },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar al portal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esta cuenta no tiene acceso al portal de aerolíneas.",
    );
    expect(screen.queryByText("PUJ")).not.toBeInTheDocument();
  });

  it("fails closed while the connected API has not published the airline bootstrap", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/auth/session")
        ? json(session)
        : json({ title: "Not Found", status: 404 }, 404)));
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    render(<DevelopmentAirlinePortal baseUrl="https://api.example.test" />);

    fireEvent.change(screen.getByLabelText("Correo corporativo"), {
      target: { value: session.actor.email },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar al portal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La API conectada todavía no publica el contexto de esta aerolínea.",
    );
    expect(screen.queryByText("PUJ")).not.toBeInTheDocument();
    expect(screen.queryByText("DEV-TAT-0001")).not.toBeInTheDocument();
    expect(localWrite).not.toHaveBeenCalled();
  });
});
