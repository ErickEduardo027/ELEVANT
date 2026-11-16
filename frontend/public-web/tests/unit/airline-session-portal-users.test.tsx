import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { AirlinePortalBootstrapResponse, SessionResponse } from "@elevant/api-client";
import { AirlineSessionProvider, useAirlineSession } from "@/components/auth/AirlineSessionProvider";

// Phase 2, block E (2-N20): the session reads and changes the airline's portal users with its own bearer.
vi.mock("@/lib/airline-change-observer", () => ({ createPublicAirlineChangeObserver: () => ({
  start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }) }));

const actor: SessionResponse["actor"] = {
  accountId: "40000000-0000-7000-8000-000000000003", email: "airline.client@dev.elevant.test",
  displayName: "Casey Airline",
  roles: [{ roleId: "41000000-0000-7000-8000-000000000003", code: "AIRLINE_CLIENT", name: "Airline Client",
    portal: "airline_portal", userType: "airline_client" }],
  memberships: [{ membershipId: "42000000-0000-7000-8000-000000000003",
    organizationId: "10000000-0000-7000-8000-000000000002", organizationCode: "DEMO-AIR",
    organizationName: "Demo Airlines", organizationType: "airline_customer", kind: "airline_client" }],
  stationScopes: [],
};
const session: SessionResponse = { accessToken: "synthetic-short-lived-token", tokenType: "Bearer",
  expiresAt: "2099-09-25T12:00:00Z", actor };
const bootstrap: AirlinePortalBootstrapResponse = { airlineId: "20000000-0000-7000-8000-000000000001",
  organizationId: actor.memberships[0].organizationId, iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines",
  stations: [], currentOperations: [] };
const colleague = { id: "40000000-0000-7000-8000-0000000000c1", firstName: "Luis", lastName: "Linares",
  email: "luis@demo-air.test", status: "Active", invitationPending: true, representative: false, signer: false,
  lastLoginAt: null, version: "AAAAAAAAB+E=" };
const listing = { me: { accountId: actor.accountId, representative: true, signer: false, canSign: true,
  canManageUsers: true }, users: [colleague] };
const key = "a0000000-0000-7000-8000-0000000000e9";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" } });

function Harness() {
  const { session: current, signIn, getPortalUsers, invitePortalUser, setPortalUserSigner } = useAirlineSession();
  const [result, setResult] = useState("");
  return <>
    {current && <span>{current.bootstrap.name}</span>}
    <button onClick={() => void signIn({ email: actor.email, password: "Synthetic-Password!2026" })}>Entrar</button>
    <button onClick={() => void getPortalUsers().then(data => setResult(`usuarios:${data.users.length}`))}>Leer</button>
    <button onClick={() => void invitePortalUser({ firstName: "Luis", lastName: "Linares", email: colleague.email,
      signer: false }, key).then(user => setResult(`invitado:${user.email}`))}>Invitar</button>
    <button onClick={() => void setPortalUserSigner(colleague.id, { signer: true, expectedVersion: colleague.version },
      key).then(user => setResult(`firmante:${String(user.signer)}`))}>Firmante</button>
    <span data-testid="result">{result}</span>
  </>;
}

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

it("reads and changes the portal users with the session bearer and the intent key", async () => {
  const requests: Array<{ path: string; method: string; authorization: string | null; key: string | null;
    body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    requests.push({ path, method: init?.method ?? "GET", authorization: headers.get("authorization"),
      key: headers.get("idempotency-key"), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path === "/api/v1/auth/session" && init?.method === "POST") return json(session);
    if (path === "/api/v1/auth/session") return json({ actor });
    if (path === "/api/v1/airline/portal/bootstrap") return json(bootstrap);
    if (path === "/api/v1/airline/portal/users" && init?.method === "POST") return json(colleague, 201);
    if (path === "/api/v1/airline/portal/users") return json(listing);
    if (path.endsWith("/signer")) return json({ ...colleague, signer: true });
    return json({ status: 404 }, 404);
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Entrar" }));
  await screen.findByText("Demo Airlines");

  fireEvent.click(screen.getByRole("button", { name: "Leer" }));
  expect(await screen.findByText("usuarios:1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Invitar" }));
  expect(await screen.findByText(`invitado:${colleague.email}`)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Firmante" }));
  expect(await screen.findByText("firmante:true")).toBeInTheDocument();

  const portal = requests.filter(request => request.path.startsWith("/api/v1/airline/portal/users"));
  expect(portal.map(request => [request.method, request.path])).toEqual([
    ["GET", "/api/v1/airline/portal/users"], ["POST", "/api/v1/airline/portal/users"],
    ["POST", `/api/v1/airline/portal/users/${colleague.id}/signer`]]);
  expect(portal.every(request => request.authorization === "Bearer synthetic-short-lived-token")).toBe(true);
  expect(portal.slice(1).map(request => request.key)).toEqual([key, key]);
  expect(portal[1]!.body).toEqual({ firstName: "Luis", lastName: "Linares", email: colleague.email, signer: false });
  expect(portal[2]!.body).toEqual({ signer: true, expectedVersion: colleague.version });
});
