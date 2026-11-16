import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ElevantApiError, type AirlinePortalUsersData } from "@elevant/api-client";
import { AirlinePermitsSection } from "@/components/portal/AirlinePermitsSection";
import { permitProblem } from "@/lib/permit-problems";

// Phase 2, block E (2-N20): only the airline's representatives and signers submit permits.
const me = (canSign: boolean): AirlinePortalUsersData => ({
  me: { accountId: "40000000-0000-7000-8000-0000000000c1", representative: false, signer: canSign, canSign,
    canManageUsers: false }, users: [] });
const session = {
  getPermits: vi.fn(), submitPermit: vi.fn(), uploadPermitDocument: vi.fn(),
  getPortalUsers: vi.fn<() => Promise<AirlinePortalUsersData>>(),
};
vi.mock("@/components/auth/AirlineSessionProvider", () => ({ useAirlineSession: () => session }));

beforeEach(() => { session.getPermits.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("hides the submission from a user who is not a signer and explains who submits", async () => {
  session.getPortalUsers.mockResolvedValue(me(false));
  render(<AirlinePermitsSection />);
  expect(await screen.findByText(/Solo los representantes y los firmantes de su aerolínea envían/)).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Enviar un permiso" })).not.toBeInTheDocument();
});

it("keeps the submission for a signer and while the capabilities cannot be read", async () => {
  session.getPortalUsers.mockResolvedValueOnce(me(true));
  const view = render(<AirlinePermitsSection />);
  expect(await screen.findByRole("form", { name: "Enviar un permiso" })).toBeInTheDocument();
  view.unmount();
  session.getPortalUsers.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  render(<AirlinePermitsSection />);
  expect(await screen.findByRole("form", { name: "Enviar un permiso" })).toBeInTheDocument();
  expect(screen.queryByText(/envían permisos/)).not.toBeInTheDocument();
});

it("explains a submission the server refused to a user who is not a signer", () => {
  expect(permitProblem(new ElevantApiError({ kind: "http", status: 403, title: "Raw title", code: "signer_required" })))
    .toEqual({ retry: false, text: expect.stringMatching(/Pida a su representante que lo marque como firmante/) });
});
