import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AirlineSessionProvider } from "@/components/auth/AirlineSessionProvider";
import { PasswordLinkExperience } from "@/components/auth/PasswordLinkExperience";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/airline-change-observer", () => ({
  createPublicAirlineChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }),
}));

const token = "aB3-dE5_fG7hI9jK1lM3nO5pQ7rS9tU1";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

function stub(handler: (path: string, body: unknown) => Response) {
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body });
    return handler(path, body);
  }));
  return calls;
}

function fill(password: string, confirmation = password) {
  fireEvent.change(screen.getByLabelText("Contraseña nueva"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirmar contraseña"), { target: { value: confirmation } });
}

/** Whether each listed password requirement is met, by its id. */
function requirementStates() {
  const list = screen.getByRole("list", { name: "Requisitos de la contraseña" });
  return Object.fromEntries(within(list).getAllByRole("listitem")
    .map(item => [item.getAttribute("data-requirement"), item.getAttribute("data-met")]));
}

it("lists the requirements before typing and never sends a password the API would refuse (N17)", async () => {
  const calls = stub(() => new Response(null, { status: 204 }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode="activate" token={token} /></AirlineSessionProvider>);
  const password = screen.getByLabelText("Contraseña nueva");
  expect(requirementStates()).toEqual({ length: "false", uppercase: "false", lowercase: "false", digit: "false", symbol: "false" });
  expect(password).toHaveAccessibleDescription(/Al menos 14 caracteres/);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  fill("short");
  expect(requirementStates()).toEqual({ length: "false", uppercase: "false", lowercase: "true", digit: "false", symbol: "false" });
  fireEvent.click(screen.getByRole("button", { name: "Activar cuenta" }));
  expect(await screen.findByText("La contraseña aún no cumple todos los requisitos.")).toBeInTheDocument();
  expect(password).toHaveAttribute("aria-invalid", "true");
  await waitFor(() => expect(password).toHaveFocus());

  fill("Synthetic-Activated!2026", "Synthetic-Activated!2027");
  expect(Object.values(requirementStates())).toEqual(Array(5).fill("true"));
  expect(password).not.toHaveAttribute("aria-invalid", "true");
  fireEvent.click(screen.getByRole("button", { name: "Activar cuenta" }));
  expect(await screen.findByText("La confirmación no coincide con la contraseña.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("Confirmar contraseña")).toHaveFocus());
  expect(calls).toEqual([]);
});

it("shows the same requirements on a reset link and points to them if the API still refuses the password", async () => {
  stub(() => new Response(JSON.stringify({ status: 400, title: "The password does not meet the policy.", code: "password_policy" }),
    { status: 400, headers: { "content-type": "application/problem+json" } }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode="reset" token={token} /></AirlineSessionProvider>);
  expect(Object.keys(requirementStates())).toEqual(["length", "uppercase", "lowercase", "digit", "symbol"]);
  fill("Synthetic-Reset!2026x");
  fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
  expect(await screen.findByRole("alert"))
    .toHaveTextContent("La contraseña no cumple la política de seguridad. Revise los requisitos de la lista y vuelva a intentarlo.");
});

it("activates the invited account with the link token and a new password", async () => {
  const calls = stub(() => new Response(null, { status: 204 }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode="activate" token={token} /></AirlineSessionProvider>);
  fill("Synthetic-Activated!2026");
  fireEvent.click(screen.getByRole("button", { name: "Activar cuenta" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Cuenta activada. Ya puede iniciar sesión: al entrar le pediremos el código que llega a su correo.");
  expect(screen.getByRole("link", { name: "Ir a iniciar sesión" })).toHaveAttribute("href", "/login");
  expect(calls.filter(call => call.path.endsWith("/auth/account/activate")).map(call => call.body))
    .toEqual([{ token, newPassword: "Synthetic-Activated!2026" }]);
});

it("explains a used or expired link without exposing the server text", async () => {
  stub(() => new Response(JSON.stringify({ status: 400, title: "The link is invalid, used or expired.", code: "invalid_link" }),
    { status: 400, headers: { "content-type": "application/problem+json" } }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode="reset" token={token} /></AirlineSessionProvider>);
  fill("Synthetic-Reset!2026x");
  fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("El enlace no es válido, ya se usó o venció. Solicite uno nuevo.");
});

it("requests a reset link with the same answer whether or not the account exists", async () => {
  const calls = stub(() => new Response(null, { status: 202 }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode="reset" /></AirlineSessionProvider>);
  fireEvent.change(screen.getByLabelText("Correo corporativo"), { target: { value: "nobody@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
  expect(await screen.findByRole("status"))
    .toHaveTextContent("Si el correo pertenece a una cuenta del portal, recibirá un enlace válido por 30 minutos.");
  expect(calls.find(call => call.path.endsWith("/auth/password-reset"))?.body).toEqual({ email: "nobody@example.test" });
});

// N19: activation and recovery address the airline as usted, like the access request and the portal.
it("addresses the airline as usted when it activates or recovers its account (N19)", async () => {
  stub(() => new Response(null, { status: 204 }));
  const { unmount } = render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <PasswordLinkExperience mode="activate" token={token} /></AirlineSessionProvider>);
  expect(screen.getByRole("heading", { name: "Cree la contraseña de su cuenta." })).toBeInTheDocument();
  expect(screen.getByText("Al guardarla confirmamos su correo y la cuenta queda lista para entrar al portal."))
    .toBeInTheDocument();
  unmount();

  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <PasswordLinkExperience mode="reset" token={token} /></AirlineSessionProvider>);
  expect(screen.getByRole("heading", { name: "Elija una contraseña nueva." })).toBeInTheDocument();
  expect(screen.getByText("Al guardarla se cierran todas las sesiones abiertas de su cuenta.")).toBeInTheDocument();
  fill("Synthetic-Reset!2026x");
  fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Contraseña actualizada. Inicie sesión con la contraseña nueva.");
});

it("asks to open an incomplete activation link again, as usted (N19)", () => {
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode="activate" /></AirlineSessionProvider>);
  expect(screen.getByRole("alert"))
    .toHaveTextContent("El enlace de activación está incompleto. Ábralo de nuevo desde el correo.");
});

it("explains the reset request form and its errors as usted (N19)", async () => {
  stub(() => new Response(JSON.stringify({ status: 503, title: "Unavailable" }),
    { status: 503, headers: { "content-type": "application/problem+json" } }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode="reset" /></AirlineSessionProvider>);
  expect(screen.getByRole("heading", { name: "¿Olvidó su contraseña?" })).toBeInTheDocument();
  expect(screen.getByText("Escriba el correo de su cuenta y le enviaremos un enlace para crear una nueva."))
    .toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Correo corporativo"), { target: { value: "nobody" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Escriba un correo válido.");
  fireEvent.change(screen.getByLabelText("Correo corporativo"), { target: { value: "nobody@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo enviar la solicitud. Reintente en unos minutos.");
});

it.each([
  ["activate", 400, "invalid_link", "El enlace no es válido, ya se usó o venció. Pida a AVIAM que reenvíe la invitación."],
  ["reset", 429, undefined, "Demasiados intentos. Espere un momento antes de reintentar."],
  ["reset", 503, undefined, "No se pudo conectar con ELEVANT. Reintente en unos minutos."],
] as const)("explains the %s link refused with %i as usted (N19)", async (mode, status, code, message) => {
  stub(() => new Response(JSON.stringify({ status, code, title: "Refused" }),
    { status, headers: { "content-type": "application/problem+json" } }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode={mode} token={token} /></AirlineSessionProvider>);
  fill("Synthetic-Activated!2026");
  fireEvent.click(screen.getByRole("button", { name: mode === "activate" ? "Activar cuenta" : "Guardar contraseña" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
});
