import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

it("activates the invited account with the link token and a new password", async () => {
  const calls = stub(() => new Response(null, { status: 204 }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><PasswordLinkExperience mode="activate" token={token} /></AirlineSessionProvider>);
  fill("short");
  fireEvent.click(screen.getByRole("button", { name: "Activar cuenta" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("al menos 14 caracteres");
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
