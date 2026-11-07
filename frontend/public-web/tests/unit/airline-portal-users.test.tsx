import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ElevantApiError, type AirlinePortalUserData, type AirlinePortalUsersData } from "@elevant/api-client";
import { AirlinePortalUsersSection } from "@/components/portal/AirlinePortalUsersSection";
import { createCommandKeyHolder } from "@/lib/command-key";
import { PORTAL_USER_PROBLEMS, portalUserProblem } from "@/lib/portal-user-problems";

// Phase 2, block E (2-N20): the airline manages its own portal users from «Perfil».
const representativeId = "40000000-0000-7000-8000-000000000003";
const representative: AirlinePortalUserData = { id: representativeId, firstName: "Casey", lastName: "Airline",
  email: "casey@demo-air.test", status: "Active", invitationPending: false, representative: true, signer: false,
  lastLoginAt: "2026-11-06T12:00:00.000Z", version: "AAAAAAAAB9E=" };
const colleague: AirlinePortalUserData = { id: "40000000-0000-7000-8000-0000000000c1", firstName: "Luis",
  lastName: "Linares", email: "luis@demo-air.test", status: "Active", invitationPending: false, representative: false,
  signer: false, lastLoginAt: null, version: "AAAAAAAAB+E=" };
const otherRepresentative: AirlinePortalUserData = { ...colleague, id: "40000000-0000-7000-8000-0000000000c2",
  firstName: "Marta", lastName: "Gómez", email: "marta@demo-air.test", representative: true, version: "AAAAAAAACAE=" };
const listing = (users: AirlinePortalUserData[] = [representative, colleague, otherRepresentative],
  me: Partial<AirlinePortalUsersData["me"]> = {}): AirlinePortalUsersData => ({
  me: { accountId: representativeId, representative: true, signer: false, canSign: true, canManageUsers: true, ...me },
  users });
const problem = (status: number, code?: string) =>
  new ElevantApiError({ kind: "http", status, title: "Raw server title", ...(code ? { code } : {}) } as never);

const session = {
  getPortalUsers: vi.fn<() => Promise<AirlinePortalUsersData>>(),
  invitePortalUser: vi.fn(), setPortalUserStatus: vi.fn(), setPortalUserSigner: vi.fn(),
};
vi.mock("@/components/auth/AirlineSessionProvider", () => ({ useAirlineSession: () => session }));

beforeEach(() => {
  session.getPortalUsers.mockResolvedValue(listing());
  session.invitePortalUser.mockResolvedValue({ ...colleague, id: "40000000-0000-7000-8000-0000000000c3" });
  session.setPortalUserStatus.mockResolvedValue({ ...colleague, status: "Disabled" });
  session.setPortalUserSigner.mockResolvedValue({ ...colleague, signer: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("portal users of the profile", () => {
  it("lets a representative invite with a stable key and says the invitation is only queued", async () => {
    render(<AirlinePortalUsersSection airlineName="Demo Airlines" />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando los usuarios del portal");
    const users = await screen.findByRole("list", { name: "Usuarios del portal" });
    expect(within(users).getByText("Casey Airline (usted)")).toBeInTheDocument();
    expect(screen.getByText(/Usted es representante de Demo Airlines/)).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Invitar a un usuario" });
    fireEvent.change(within(form).getByLabelText("Nombre"), { target: { value: " Ana " } });
    fireEvent.change(within(form).getByLabelText("Apellido"), { target: { value: "Rivera" } });
    fireEvent.change(within(form).getByLabelText("Correo"), { target: { value: "ana@demo-air.test" } });
    fireEvent.click(within(form).getByRole("checkbox"));
    session.invitePortalUser.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(within(form).getByRole("button", { name: "Invitar usuario" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no se aplicará dos veces");
    const key = session.invitePortalUser.mock.calls[0]![1];
    fireEvent.click(within(form).getByRole("button", { name: "Invitar usuario" }));
    const done = await screen.findByText(/quedó en cola/);
    expect(done).toHaveTextContent("La invitación a ana@demo-air.test quedó en cola");
    expect(done).not.toHaveTextContent(/enviamos|se envió/i);
    expect(session.invitePortalUser).toHaveBeenLastCalledWith(
      { firstName: "Ana", lastName: "Rivera", email: "ana@demo-air.test", signer: true }, key);
    await waitFor(() => expect(session.getPortalUsers).toHaveBeenCalledTimes(2));
    expect(within(form).getByLabelText("Nombre")).toHaveValue("");
  });

  it("never offers to change the representative itself nor another representative", async () => {
    render(<AirlinePortalUsersSection airlineName="Demo Airlines" />);
    const users = await screen.findByRole("list", { name: "Usuarios del portal" });
    const rows = within(users).getAllByRole("listitem");
    expect(within(rows[0]!).queryByRole("button")).not.toBeInTheDocument();
    expect(within(rows[2]!).queryByRole("button")).not.toBeInTheDocument();
    expect(within(rows[1]!).getByRole("button", { name: "Marcar como firmante" })).toBeInTheDocument();
  });

  it("marks a signer with the version on screen and re-reads a user that changed", async () => {
    session.setPortalUserSigner.mockRejectedValueOnce(problem(409, "version_conflict"));
    render(<AirlinePortalUsersSection airlineName="Demo Airlines" />);
    fireEvent.click(await screen.findByRole("button", { name: "Marcar como firmante" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(PORTAL_USER_PROBLEMS.version_conflict!);
    expect(alert).not.toHaveTextContent("Raw server title");
    expect(session.setPortalUserSigner).toHaveBeenCalledWith(colleague.id,
      { signer: true, expectedVersion: colleague.version }, expect.stringMatching(/^[0-9a-f-]{36}$/));
    await waitFor(() => expect(session.getPortalUsers).toHaveBeenCalledTimes(2));
    const first = session.setPortalUserSigner.mock.calls[0]![2];
    fireEvent.click(await screen.findByRole("button", { name: "Marcar como firmante" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Luis Linares ahora puede firmar contratos");
    // A 409 settled the first intent: the next attempt is a new one.
    expect(session.setPortalUserSigner.mock.calls[1]![2]).not.toBe(first);
  });

  it("asks before deactivating and explains a protected user by its code", async () => {
    session.setPortalUserStatus.mockRejectedValueOnce(problem(409, "portal_user_protected"));
    render(<AirlinePortalUsersSection airlineName="Demo Airlines" />);
    fireEvent.click(await screen.findByRole("button", { name: "Desactivar" }));
    const confirm = screen.getByRole("group", { name: "Desactivar a Luis Linares" });
    expect(confirm).toHaveTextContent("perderá el acceso al portal de inmediato");
    expect(session.setPortalUserStatus).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar desactivación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pídaselo a AVIAM");
    expect(session.setPortalUserStatus).toHaveBeenCalledWith(colleague.id,
      { isActive: false, expectedVersion: colleague.version }, expect.any(String));
  });

  it("shows a reader what it may do without the management controls", async () => {
    session.getPortalUsers.mockResolvedValue(listing([representative, colleague],
      { accountId: colleague.id, representative: false, canSign: false, canManageUsers: false }));
    render(<AirlinePortalUsersSection airlineName="Demo Airlines" />);
    expect(await screen.findByText(/Su usuario consulta la información de Demo Airlines/)).toBeInTheDocument();
    expect(screen.getByText("Solo consulta")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Invitar a un usuario" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has an empty, an unauthorized and a recoverable error state", async () => {
    session.getPortalUsers.mockResolvedValueOnce(listing([representative]));
    const view = render(<AirlinePortalUsersSection airlineName="Demo Airlines" />);
    expect(await screen.findByText(/Todavía no hay otros usuarios del portal/)).toBeInTheDocument();
    view.unmount();

    session.getPortalUsers.mockRejectedValueOnce(problem(403, "forbidden"));
    const forbidden = render(<AirlinePortalUsersSection airlineName="Demo Airlines" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Su cuenta no puede consultar los usuarios del portal.");
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    forbidden.unmount();

    session.getPortalUsers.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<AirlinePortalUsersSection airlineName="Demo Airlines" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los usuarios del portal.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("list", { name: "Usuarios del portal" })).toBeInTheDocument();
  });
});

describe("intent keys and problem messages", () => {
  it("keeps the key after an uncertain result and settles it on any answer", async () => {
    let next = 0;
    const holder = createCommandKeyHolder(() => `key-${++next}`);
    await expect(holder.run("a", { x: 1 }, async () => { throw new TypeError("Failed to fetch"); })).rejects.toThrow();
    await expect(holder.run("a", { x: 1 }, async () => { throw problem(503); })).rejects.toThrow();
    expect(holder.keyFor("a", { x: 1 })).toBe("key-1");
    await expect(holder.run("a", { x: 1 }, async () => { throw problem(409, "version_conflict"); })).rejects.toThrow();
    expect(holder.keyFor("a", { x: 1 })).toBe("key-2");
    expect(holder.keyFor("a", { x: 2 })).toBe("key-3");
    await holder.run("a", { x: 2 }, async key => key);
    expect(holder.keyFor("a", { x: 2 })).toBe("key-4");
  });

  it("explain every code in Spanish and never the server title", () => {
    for (const code of Object.keys(PORTAL_USER_PROBLEMS)) {
      const message = portalUserProblem(problem(409, code)).text;
      expect(message).toBe(PORTAL_USER_PROBLEMS[code]);
      expect(message).not.toMatch(/Raw server title/);
    }
    expect(portalUserProblem(problem(404))).toEqual({ text: PORTAL_USER_PROBLEMS.not_found, reload: true });
    expect(portalUserProblem(problem(400, "email_in_use")).reload).toBe(false);
    expect(portalUserProblem(new TypeError("The portal user invitation is invalid.")).text)
      .toBe(PORTAL_USER_PROBLEMS.invalid_portal_user);
    expect(portalUserProblem(problem(500)).text).toMatch(/no se aplicará dos veces/);
  });
});
