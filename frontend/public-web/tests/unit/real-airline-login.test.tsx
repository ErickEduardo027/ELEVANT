import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** Whether each listed password requirement is met, by its id. */
function requirementStates() {
  const list = screen.getByRole("list", { name: "Requisitos de la contraseña" });
  return Object.fromEntries(within(list).getAllByRole("listitem")
    .map(item => [item.getAttribute("data-requirement"), item.getAttribute("data-met")]));
}

/** A Problem Details answer of the API with the given status. */
function problem(status: number, code?: string) {
  return new Response(JSON.stringify({ status, code, title: "Refused" }),
    { status, headers: { "content-type": "application/problem+json" } });
}

/**
 * Signs in with a temporary password the API asks to replace; returns the paths it was asked for. The password change
 * answers with `changeStatus`.
 */
async function startPasswordChange(changeStatus = 204) {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith("password-change"))
      return changeStatus === 204 ? new Response(null, { status: 204 }) : problem(changeStatus);
    return problem(409, "password_change_required");
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
  fireEvent.change(await screen.findByRole("textbox", { name: "Correo corporativo" }), { target: { value: actor.email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Synthetic-Temporary!2026" } });
  fireEvent.click(screen.getByRole("button", { name: /^Iniciar sesión$/ }));
  await screen.findByLabelText("Nueva contraseña");
  return paths;
}

it("presents the temporary password change as a step, not as an error (N17)", async () => {
  await startPasswordChange();
  const newPassword = screen.getByLabelText("Nueva contraseña");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/Debes? cambiar/)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cambio de la contraseña temporal" })).toBeInTheDocument();
  await waitFor(() => expect(newPassword).toHaveFocus());
  expect(newPassword).toHaveAccessibleDescription(
    /La contraseña de airline\.client@dev\.elevant\.test es temporal\. Elija una nueva para reemplazarla/);
  expect(newPassword).not.toHaveAttribute("aria-invalid", "true");
});

it("lists the password requirements before anything is typed and checks them while typing (N17)", async () => {
  await startPasswordChange();
  const newPassword = screen.getByLabelText("Nueva contraseña");
  expect(requirementStates()).toEqual({
    length: "false", uppercase: "false", lowercase: "false", digit: "false", symbol: "false", different: "false",
  });
  expect(newPassword).toHaveAccessibleDescription(/Al menos 14 caracteres/);
  expect(newPassword).toHaveAccessibleDescription(/Distinta de la contraseña temporal/);
  expect(screen.getByText(/La ñ y las letras con tilde, como la É, cuentan como símbolo/)).toBeInTheDocument();

  fireEvent.change(newPassword, { target: { value: "contraseña" } });
  expect(requirementStates()).toEqual({
    length: "false", uppercase: "false", lowercase: "true", digit: "false", symbol: "true", different: "true",
  });
  fireEvent.change(newPassword, { target: { value: "Synthetic-New-Password!2026" } });
  expect(Object.values(requirementStates())).toEqual(Array(6).fill("true"));
});

it("does not send a new password equal to the temporary one nor one the API would refuse (N17)", async () => {
  const paths = await startPasswordChange();
  const newPassword = screen.getByLabelText("Nueva contraseña");
  const confirmation = screen.getByLabelText("Confirmar nueva contraseña");
  fireEvent.change(newPassword, { target: { value: "Synthetic-Temporary!2026" } });
  fireEvent.change(confirmation, { target: { value: "Synthetic-Temporary!2026" } });
  expect(requirementStates()).toMatchObject({ length: "true", different: "false" });
  fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
  expect(await screen.findByText("La contraseña aún no cumple todos los requisitos.")).toBeInTheDocument();
  expect(newPassword).toHaveAttribute("aria-invalid", "true");
  expect(newPassword).toHaveAccessibleDescription(/La contraseña aún no cumple todos los requisitos\./);
  await waitFor(() => expect(newPassword).toHaveFocus());

  fireEvent.change(newPassword, { target: { value: "Synthetic-New-Password!2026" } });
  expect(newPassword).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.change(confirmation, { target: { value: "Synthetic-New-Password!2027" } });
  fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
  expect(await screen.findByText("La confirmación no coincide con la contraseña.")).toBeInTheDocument();
  await waitFor(() => expect(confirmation).toHaveFocus());
  // Only the login was asked for: neither password reached the API.
  expect(paths).toEqual(["/api/v1/auth/session"]);
});

it("sends registration from the airline login to the canonical commercial request", async () => {
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);

  expect(await screen.findByRole("link", { name: "Solicite acceso aquí" }))
    .toHaveAttribute("href", "/solicitar-acceso");
  expect(screen.getByText("¿No tiene credenciales?")).toBeInTheDocument();
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
  await screen.findByText("Contraseña actualizada. Inicie sesión con su nueva contraseña.");
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
    // ADR-0022, 1-N08: the code was only queued; the screen never claims it was sent. N17: one instruction, not
    // the same one twice, and the focus waits in the code field, which the instruction describes.
    expect(screen.getAllByText(/Pedimos un código/)).toHaveLength(1);
    expect(screen.queryByText(/Escrib[ae] el código/)).not.toBeInTheDocument();
    expect(code).toHaveAccessibleDescription("Pedimos un código de 6 dígitos para a••••t@dev.elevant.test. "
      + "Puede tardar unos minutos en llegar; revise también la carpeta de spam.");
    await waitFor(() => expect(code).toHaveFocus());
    expect(document.body).not.toHaveTextContent(/Enviamos|enviamos/);
    expect(screen.getByRole("button", { name: /Reenviar código en \d+ s/ })).toBeDisabled();
    // Jump past the 30 s resend cooldown; the 1 s countdown tick picks it up.
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 31_000);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar código" }, { timeout: 3000 }));
    expect(await screen.findByText(/El anterior ya no sirve/)).toBeInTheDocument();
    expect(screen.getAllByText(/Pedimos un código/)).toHaveLength(1);
    expect(code).toHaveAccessibleDescription(/^Pedimos un código nuevo para a••••t@dev\.elevant\.test\. El anterior ya no sirve\./);

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

it("names no environment nor technical jargon unless the deployment sets a label (1-N24)", async () => {
  const { unmount } = render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
  await screen.findByRole("textbox", { name: "Correo corporativo" });
  expect(screen.getByText("Portal de aerolíneas")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/Development|API|producción/);
  unmount();

  vi.stubEnv("NEXT_PUBLIC_ELEVANT_ENVIRONMENT_LABEL", "Pruebas");
  try {
    render(<AirlineSessionProvider baseUrl="https://api.example.test">
      <AuthExperience returnTo="/portal" />
    </AirlineSessionProvider>);
    expect(await screen.findByText("Portal de aerolíneas · Pruebas")).toBeInTheDocument();
    expect(screen.getByText("Entorno: Pruebas")).toBeInTheDocument();
  } finally {
    vi.unstubAllEnvs();
  }
});

it("names the real steps of the access: the account, then the code by email (D-N17)", async () => {
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
  await screen.findByRole("textbox", { name: "Correo corporativo" });
  expect(screen.getByText("Cuenta")).toBeInTheDocument();
  expect(screen.getByText("Código por correo")).toBeInTheDocument();
  expect(screen.queryByText("Aerolínea y estaciones")).not.toBeInTheDocument();
});

it("links to password recovery from the login form", async () => {
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
  expect(await screen.findByRole("link", { name: "¿Olvidó su contraseña?" })).toHaveAttribute("href", "/recuperar");
});

// N19: the login addresses the airline as usted, like the access request and the portal.
it("addresses the airline as usted before it signs in (N19)", async () => {
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
  expect(await screen.findByRole("region", { name: "Continúe al portal de su aerolínea." })).toBeInTheDocument();
  expect(screen.getByText("Utilice la cuenta emitida para su aerolínea. Al entrar comprobamos su acceso y las "
    + "estaciones autorizadas para su cuenta.")).toBeInTheDocument();
  expect(screen.getByText("Consulte las operaciones de su aerolínea en las estaciones autorizadas para su cuenta."))
    .toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^Iniciar sesión$/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Revise los campos indicados para continuar.");
  expect(screen.getByRole("textbox", { name: "Correo corporativo" }))
    .toHaveAccessibleDescription("Ingrese su correo corporativo.");
  expect(screen.getByLabelText("Contraseña")).toHaveAccessibleDescription("Ingrese su contraseña.");
});

it.each([
  [401, "No se pudo validar la cuenta. Revise el correo y la contraseña."],
  [404, "Los datos de su aerolínea no están disponibles ahora. Reintente en unos minutos."],
  [429, "Demasiados intentos. Espere un momento antes de reintentar."],
  [503, "No se pudo conectar con ELEVANT. Compruebe la conexión y reintente."],
])("explains a login refused with %i as usted (N19)", async (status, message) => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => problem(status)));
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
  fireEvent.change(await screen.findByRole("textbox", { name: "Correo corporativo" }), { target: { value: actor.email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Synthetic-Password!2026" } });
  fireEvent.click(screen.getByRole("button", { name: /^Iniciar sesión$/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
});

it.each([
  [429, "Demasiados intentos. Espere antes de reintentar."],
  [503, "No se pudo cambiar la contraseña. Reintente en unos minutos."],
])("explains a temporary password change refused with %i as usted (N19)", async (status, message) => {
  await startPasswordChange(status);
  fireEvent.change(screen.getByLabelText("Nueva contraseña"), { target: { value: "Synthetic-New-Password!2026" } });
  fireEvent.change(screen.getByLabelText("Confirmar nueva contraseña"), { target: { value: "Synthetic-New-Password!2026" } });
  fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
});

it("explains a wrong, a refused and a lost code as usted (N19)", async () => {
  const challengeId = "7a000000-0000-7000-8000-000000000002";
  const verifications = [problem(401), problem(409, "password_change_required")];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/auth/session") && init?.method === "POST")
      return new Response(JSON.stringify({ challengeId, emailHint: "a••••t@dev.elevant.test",
        expiresAt: "2099-01-01T00:10:00Z", code: "code_required" }), { status: 202, headers: { "content-type": "application/json" } });
    if (path.endsWith("/verify-code")) return verifications.shift() ?? problem(401);
    return problem(404);
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

    fireEvent.change(code, { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar y entrar" }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("El código no es válido o ya venció. Revise el último correo o pida uno nuevo.");
    fireEvent.change(code, { target: { value: "222222" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar y entrar" }));
    expect(await screen.findByText("Debe cambiar la contraseña temporal antes de entrar.")).toBeInTheDocument();

    // Past the 30 s resend cooldown, the API no longer knows the challenge.
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 31_000);
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar código" }, { timeout: 3000 }));
    expect(await screen.findByText("El código venció o se bloqueó. Inicie sesión de nuevo.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Código de verificación/ })).not.toBeInTheDocument();
  } finally {
    vi.restoreAllMocks();
  }
});

it("asks for a new code once the emailed one expired, as usted (N19)", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    challengeId: "7a000000-0000-7000-8000-000000000003", emailHint: "a••••t@dev.elevant.test",
    expiresAt: "2000-01-01T00:00:00Z", code: "code_required",
  }), { status: 202, headers: { "content-type": "application/json" } })));
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AuthExperience returnTo="/portal" />
  </AirlineSessionProvider>);
  fireEvent.change(await screen.findByRole("textbox", { name: "Correo corporativo" }), { target: { value: actor.email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Synthetic-Password!2026" } });
  fireEvent.click(screen.getByRole("button", { name: /^Iniciar sesión$/ }));
  expect(await screen.findByText("El código venció; pida uno nuevo.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verificar y entrar" })).toBeDisabled();
});
