import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AirlinePortalBootstrapResponse, SessionResponse } from "@elevant/api-client";
import { AirlineSessionProvider } from "@/components/auth/AirlineSessionProvider";
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
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);

  expect(await screen.findByRole("link", { name: "Solicita acceso aquí" }))
    .toHaveAttribute("href", "/solicitar-acceso");
  expect(screen.getByText("¿No tienes credenciales?")).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Acceso de aerolíneas" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Razón social" })).not.toBeInTheDocument();
});

it("reveals only the chosen password during mandatory credential replacement", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    status: 409, code: "password_change_required", title: "Password change required",
  }), { status: 409, headers: { "content-type": "application/problem+json" } })));
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
  fireEvent.change(await screen.findByRole("textbox", { name: "Correo corporativo" }),
    { target: { value: actor.email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Synthetic-Temporary!2026" } });
  fireEvent.click(screen.getByRole("button", { name: /^Iniciar sesión$/ }));
  const newPassword = await screen.findByLabelText("Nueva contraseña");
  const confirmation = screen.getByLabelText("Confirmar nueva contraseña");
  fireEvent.click(screen.getByRole("button", { name: "Mostrar nueva contraseña" }));
  expect(newPassword).toHaveAttribute("type", "text");
  expect(confirmation).toHaveAttribute("type", "password");
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

  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);

  await screen.findByRole("textbox", { name: "Correo corporativo" });
  expect(screen.getByText("Se verifica al iniciar sesión")).toBeInTheDocument();
  expect(screen.queryByText(/origen demo|acceso autenticado|ev \/ airline/i)).not.toBeInTheDocument();
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

  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
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

it("asks for the emailed code, resends it and enters the portal with it (ADR-0022)", async () => {
  const challengeId = "7a000000-0000-7000-8000-000000000001";
  const challenge = { challengeId, emailHint: "a••••t@dev.elevant.test", expiresAt: "2099-01-01T00:10:00Z", code: "code_required" };
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),
      { status, headers: { "content-type": "application/json" } });
    if ((path.endsWith("/auth/session") && init?.method === "POST") || path.endsWith("/resend-code")) return json(challenge, 202);
    if (path.endsWith("/verify-code")) return json({ accessToken: "synthetic-token", tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z", actor });
    return json(path.endsWith("/bootstrap") ? bootstrap : { actor });
  }));
  const realNow = Date.now.bind(Date);
  try {
    render(<AirlineSessionProvider baseUrl="https://api.example.test">
      <AuthExperience returnTo="/portal" />
    </AirlineSessionProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "Correo corporativo" }), { target: { value: actor.email } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Synthetic-Password!2026" } });
    fireEvent.click(screen.getByRole("button", { name: /^Iniciar sesión$/ }));

    const code = await screen.findByRole("textbox", { name: /Código de verificación/ });
    expect(screen.getByText(/a••••t@dev\.elevant\.test/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reenviar código en \d+ s/ })).toBeDisabled();
    // Jump past the 30 s resend cooldown; the 1 s countdown tick picks it up.
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 31_000);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar código" }, { timeout: 3000 }));
    expect(await screen.findByText(/El anterior ya no sirve/)).toBeInTheDocument();

    fireEvent.change(code, { target: { value: "12a3456" } });
    expect(code).toHaveValue("123456");
    fireEvent.click(screen.getByRole("button", { name: "Verificar y entrar" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/portal"));
    expect(calls.find(call => call.path.endsWith("/verify-code"))?.body).toEqual({ challengeId, code: "123456" });
    expect(sessionStorage.length + localStorage.length).toBeGreaterThan(0);
  } finally {
    vi.restoreAllMocks();
  }
});

it("links to password recovery from the login form", async () => {
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
  expect(await screen.findByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveAttribute("href", "/recuperar");
});
