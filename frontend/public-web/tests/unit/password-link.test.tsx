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
  expect(await screen.findByText(/Cuenta activada/)).toBeInTheDocument();
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
  expect(await screen.findByRole("alert")).toHaveTextContent("Solicita uno nuevo");
});

it("requests a reset link with the same answer whether or not the account exists", async () => {
  const calls = stub(() => new Response(null, { status: 202 }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode="reset" /></AirlineSessionProvider>);
  fireEvent.change(screen.getByLabelText("Correo corporativo"), { target: { value: "nobody@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Si el correo pertenece a una cuenta del portal");
  expect(calls.find(call => call.path.endsWith("/auth/password-reset"))?.body).toEqual({ email: "nobody@example.test" });
});
