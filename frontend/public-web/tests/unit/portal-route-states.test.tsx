import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import PortalError from "@/app/portal/error";
import PortalLoading from "@/app/portal/loading";
import { PortalGuard } from "@/components/portal/PortalGuard";

const access = vi.hoisted(() => ({ status: "unavailable", retry: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/portal" }));
vi.mock("@/components/auth/AirlineSessionProvider", () => ({
  useAirlineSession: () => ({ status: access.status, session: null, retry: access.retry }),
}));

afterEach(() => { cleanup(); access.status = "unavailable"; access.retry.mockClear(); });

// N19: the states around the portal's pages address the airline as usted and name no technical part.
it("asks the airline, as usted, to try again when its session cannot be checked (N19)", () => {
  render(<PortalGuard><p>Contenido</p></PortalGuard>);
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("No se pudo verificar su sesión.");
  expect(alert).toHaveTextContent("Vuelva a intentarlo en unos minutos.");
  expect(alert).not.toHaveTextContent(/API|Comprueb/);
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(access.retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Contenido")).not.toBeInTheDocument();
});

it("prepares the context of the airline's own account while its session is checked (N19)", () => {
  access.status = "loading";
  render(<PortalGuard><p>Contenido</p></PortalGuard>);
  expect(screen.getByRole("status")).toHaveTextContent("Validando acceso autorizado");
  expect(screen.getByRole("status")).toHaveTextContent("Preparando el contexto operativo de su aerolínea.");
});

it("keeps the session of the airline when a page fails, as usted (N19)", () => {
  const reset = vi.fn();
  render(<PortalError reset={reset} />);
  expect(screen.getByRole("alert"))
    .toHaveTextContent("Su sesión continúa activa. Intente reconstruir la vista con los datos locales autorizados.");
  fireEvent.click(screen.getByRole("button", { name: "Reintentar consulta" }));
  expect(reset).toHaveBeenCalledTimes(1);
});

it("names the scope of the airline's own account while a page loads (N19)", () => {
  render(<PortalLoading />);
  expect(screen.getByRole("status")).toHaveTextContent("Aplicando el alcance de su aerolínea y estación.");
});
