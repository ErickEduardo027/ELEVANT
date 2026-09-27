import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AirlinePortalBootstrapResponse, SessionResponse } from "@elevant/api-client";
import { AirlineSessionProvider } from "@/components/auth/AirlineSessionProvider";
import { MockSessionProvider } from "@/components/auth/MockSessionProvider";
import { AuthExperience } from "@/components/auth/AuthExperience";

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }));
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
  iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines", stations: [], currentOperations: [],
};

afterEach(() => {
  cleanup(); replace.mockReset(); push.mockReset(); sessionStorage.clear(); localStorage.clear(); vi.unstubAllGlobals();
});

it("sends registration from the airline login to the canonical commercial request", async () => {
  render(<MockSessionProvider><AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider></MockSessionProvider>);

  expect(await screen.findByRole("link", { name: "Solicitar acceso" }))
    .toHaveAttribute("href", "/solicitar-acceso");
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Razón social" })).not.toBeInTheDocument();
});

it("uses Public Web login for the real API and never offers demo credentials", async () => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    const body = path.endsWith("/bootstrap") ? bootstrap
      : init?.method === "POST"
        ? { accessToken: "synthetic-token", tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z", actor }
        : { actor };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));

  render(<MockSessionProvider><AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider></MockSessionProvider>);

  await screen.findByRole("textbox", { name: "Correo corporativo" });
  expect(screen.queryByRole("button", { name: /Usar credenciales de demostraci\u00f3n/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /Recordarme/i })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Correo corporativo" }), {
    target: { value: actor.email },
  });
  fireEvent.change(screen.getByLabelText("Contrase\u00f1a"), { target: { value: "Synthetic-Password!2026" } });
  fireEvent.click(screen.getByRole("button", { name: /^Iniciar sesi\u00f3n$/ }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/portal"));
  expect(paths).toEqual([
    "/api/v1/auth/session", "/api/v1/auth/session", "/api/v1/airline/portal/bootstrap",
  ]);
});

it("lets an airline replace a temporary password before a fresh login", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    requests.push(path);
    if (path.endsWith("password-change")) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ status: 409, code: "password_change_required", title: "Password change required" }),
      { status: 409, headers: { "content-type": "application/problem+json" } });
  }));

  render(<MockSessionProvider><AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider></MockSessionProvider>);
  await screen.findByRole("textbox", { name: "Correo corporativo" });
  fireEvent.change(screen.getByRole("textbox", { name: "Correo corporativo" }), { target: { value: actor.email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Synthetic-Temporary!2026" } });
  fireEvent.click(screen.getByRole("button", { name: /^Iniciar sesión$/ }));
  await screen.findByLabelText("Nueva contraseña");
  fireEvent.change(screen.getByLabelText("Nueva contraseña"), { target: { value: "Synthetic-New-Password!2026" } });
  fireEvent.change(screen.getByLabelText("Confirmar nueva contraseña"), { target: { value: "Synthetic-New-Password!2026" } });
  fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
  await screen.findByText(/contraseña actualizada/i);
  expect(requests).toEqual(["/api/v1/auth/session", "/api/v1/auth/password-change"]);
  expect(replace).not.toHaveBeenCalledWith("/portal");
  expect(sessionStorage.length).toBe(0);
});
