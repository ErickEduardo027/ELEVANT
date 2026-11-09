import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { AirlinePortalBootstrapResponse, SessionResponse } from "@elevant/api-client";
import {
  AIRLINE_SESSION_STORAGE_KEY,
  AirlineSessionProvider,
  useAirlineSession,
} from "@/components/auth/AirlineSessionProvider";

const observe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/airline-change-observer", () => ({ createPublicAirlineChangeObserver: observe }));
beforeEach(() => {
  observe.mockReset();
  observe.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
});

const actor: SessionResponse["actor"] = {
  accountId: "40000000-0000-7000-8000-000000000003",
  email: "airline.client@dev.elevant.test",
  displayName: "Casey Airline",
  roles: [{ roleId: "41000000-0000-7000-8000-000000000003", code: "AIRLINE_CLIENT",
    name: "Airline Client", portal: "airline_portal", userType: "airline_client" }],
  memberships: [{ membershipId: "42000000-0000-7000-8000-000000000003",
    organizationId: "10000000-0000-7000-8000-000000000002", organizationCode: "DEMO-AIR",
    organizationName: "Demo Airlines", organizationType: "airline_customer", kind: "airline_client" }],
  stationScopes: [],
};
const session: SessionResponse = {
  accessToken: "synthetic-short-lived-token",
  tokenType: "Bearer",
  expiresAt: "2099-09-25T12:00:00Z",
  actor,
};
const bootstrap: AirlinePortalBootstrapResponse = {
  airlineId: "20000000-0000-7000-8000-000000000001",
  organizationId: actor.memberships[0].organizationId,
  iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines",
  stations: [{ id: "20000000-0000-7000-8000-000000000003", code: "PUJ",
    name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" }],
  currentOperations: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

function Harness() {
  const { status, session: current, signIn, signOut, retry, getApprovedEvidence, getInvoiceDocument,
    financeRevision } = useAirlineSession();
  const [detailStatus, setDetailStatus] = useState("");
  return <>
    <span data-testid="session-status">{status}</span>
    {current && <span>{current.bootstrap.name}</span>}
    <button onClick={() => void signIn({ email: actor.email, password: "Synthetic-Password!2026" })}>Entrar</button>
    <button onClick={signOut}>Salir</button>
    <button onClick={() => void retry()}>Reintentar</button>
    <button onClick={() => void getApprovedEvidence("30000000-0000-7000-8000-000000000003")
      .then(result => setDetailStatus(result.available ? "aprobada" : "pendiente"))
      .catch(() => setDetailStatus("missing"))}>Consultar evidencia</button>
    <button onClick={() => void getInvoiceDocument("74000000-0000-7000-8000-000000000001")
      .then(() => setDetailStatus("documento")).catch(() => setDetailStatus("missing"))}>Descargar factura</button>
    <span data-testid="detail-status">{detailStatus}</span>
    <span data-testid="finance-revision">{financeRevision}</span>
  </>;
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("loads a real airline session, persists only the token per tab, and revalidates on remount", async () => {
  const requests: Array<{ path: string; authorization: string | null }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, authorization: new Headers(init?.headers).get("authorization") });
    if (path === "/api/v1/auth/session" && init?.method === "POST") return json(session);
    if (path === "/api/v1/auth/session") return json({ actor });
    return json(bootstrap);
  }));
  const page = render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("anonymous");
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await screen.findByText("Demo Airlines");
  expect(requests.map(({ path }) => path)).toEqual([
    "/api/v1/auth/session", "/api/v1/auth/session", "/api/v1/airline/portal/bootstrap",
  ]);
  expect(requests.map(({ authorization }) => authorization)).toEqual([
    null, "Bearer synthetic-short-lived-token", "Bearer synthetic-short-lived-token",
  ]);
  expect(JSON.parse(sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY) ?? "null")).toEqual({
    accessToken: session.accessToken, expiresAt: session.expiresAt, refreshToken: null,
  });
  expect(localStorage.length).toBe(0);

  page.unmount();
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("Demo Airlines");
  expect(requests).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Salir" }));
  await waitFor(() => expect(screen.getByTestId("session-status")).toHaveTextContent("anonymous"));
  expect(sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY)).toBeNull();
});

it("requests approved evidence with the current airline token", async () => {
  const requests: Array<{ path: string; authorization: string | null }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, authorization: new Headers(init?.headers).get("authorization") });
    if (path === "/api/v1/auth/session" && init?.method === "POST") return json(session);
    if (path === "/api/v1/auth/session") return json({ actor });
    if (path === "/api/v1/airline/portal/bootstrap") return json(bootstrap);
    if (path.endsWith("/approved-evidence")) return json({
      operationId: "30000000-0000-7000-8000-000000000003", available: false,
      approvedAt: null, actualStartAt: null, actualEndAt: null,
      incidentCount: 0, services: [],
    });
    return json({ status: 404 }, 404);
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("anonymous");
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await screen.findByText("Demo Airlines");
  fireEvent.click(screen.getByRole("button", { name: "Consultar evidencia" }));
  await screen.findByText("pendiente");
  expect(requests.at(-1)).toEqual({
    path: "/api/v1/airline/portal/operations/30000000-0000-7000-8000-000000000003/approved-evidence",
    authorization: "Bearer synthetic-short-lived-token",
  });
});

it("rejects a back-office actor before fetching airline data or storing a token", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ ...session, actor: {
    ...actor, roles: [{ ...actor.roles[0], code: "ADMIN_OCC", portal: "back_office" }],
  } }));
  vi.stubGlobal("fetch", fetcher);
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("anonymous");
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await waitFor(() => expect(screen.getByTestId("session-status")).toHaveTextContent("anonymous"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY)).toBeNull();
});

it("drops an expired stored token without calling the API", async () => {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: "expired-token", expiresAt: "2000-01-01T00:00:00Z",
  }));
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("anonymous");
  expect(fetcher).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY)).toBeNull();
});

it("clears a stored token when the API revokes the session", async () => {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken, expiresAt: session.expiresAt,
  }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => json({ status: 401 }, 401)));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("anonymous");
  expect(sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY)).toBeNull();
});

it("keeps the airline session when an invoice document is not visible", async () => {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken, expiresAt: session.expiresAt,
  }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/airline/portal/invoices/74000000-0000-7000-8000-000000000001/document"))
      return json({ status: 404 }, 404);
    return path === "/api/v1/auth/session" ? json({ actor }) : json(bootstrap);
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("Demo Airlines");
  fireEvent.click(screen.getByRole("button", { name: "Descargar factura" }));
  await waitFor(() => expect(screen.getByTestId("detail-status")).toHaveTextContent("missing"));
  expect(screen.getByTestId("session-status")).toHaveTextContent("ready");
  expect(sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY)).not.toBeNull();
});

it("clears the airline session when financial document access is revoked", async () => {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken, expiresAt: session.expiresAt,
  }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/airline/portal/invoices/74000000-0000-7000-8000-000000000001/document"))
      return json({ status: 403 }, 403);
    return path === "/api/v1/auth/session" ? json({ actor }) : json(bootstrap);
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("Demo Airlines");
  fireEvent.click(screen.getByRole("button", { name: "Descargar factura" }));
  await waitFor(() => expect(screen.getByTestId("session-status")).toHaveTextContent("anonymous"));
  expect(sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY)).toBeNull();
});

it("refreshes the authorized airline snapshot when the connection returns", async () => {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken, expiresAt: session.expiresAt,
  }));
  let currentName = "Demo Airlines";
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    return path === "/api/v1/auth/session" ? json({ actor }) : json({ ...bootstrap, name: currentName });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("Demo Airlines");
  await waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
  currentName = "Airline Updated";
  window.dispatchEvent(new Event("online"));
  await screen.findByText("Airline Updated");
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("revokes the visible airline context on a periodic authorization failure", async () => {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken, expiresAt: session.expiresAt,
  }));
  let revoked = false;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (revoked) return json({ status: 401 }, 401);
    return path === "/api/v1/auth/session" ? json({ actor }) : json(bootstrap);
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("Demo Airlines");
  await waitFor(() => expect(observe).toHaveBeenCalledOnce());
  revoked = true;
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(screen.getByTestId("session-status")).toHaveTextContent("anonymous"));
  expect(sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY)).toBeNull();
});

it("refreshes the server-scoped bootstrap after an authorized airline change hint", async () => {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken, expiresAt: session.expiresAt,
  }));
  let currentName = "Demo Airlines";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    return path === "/api/v1/auth/session" ? json({ actor }) : json({ ...bootstrap, name: currentName });
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("Demo Airlines");
  expect(observe).toHaveBeenCalledOnce();
  currentName = "Airline Updated";
  observe.mock.calls[0][0].onChanges(["airline_operations"]);
  await screen.findByText("Airline Updated");
});

it("invalidates the airline Finance read model on an issuance or treasury hint", async () => {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken, expiresAt: session.expiresAt,
  }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input =>
    new URL(String(input)).pathname === "/api/v1/auth/session"
      ? json({ actor }) : json(bootstrap)));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("Demo Airlines");
  expect(screen.getByTestId("finance-revision")).toHaveTextContent("0");
  await waitFor(() => expect(observe).toHaveBeenCalledOnce());
  act(() => observe.mock.calls[0][0].onChanges(["airline_preinvoices"]));
  expect(screen.getByTestId("finance-revision")).toHaveTextContent("1");
  act(() => observe.mock.calls[0][0].onChanges(["airline_treasury"]));
  expect(screen.getByTestId("finance-revision")).toHaveTextContent("2");
});

it("renews an expired tab session with its refresh token and ends the chain on sign out", async () => {
  const refreshToken = "aB3-dE5_fG7hI9jK1lM3nO5pQ7rS9tU1";
  const renewed = "zZ9-yY8_xX7wW6vV5uU4tT3sS2rR1qQ0";
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: "expired-token", expiresAt: "2020-01-01T00:00:00Z", refreshToken }));
  const requests: Array<{ path: string; body: string }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, body: String(init?.body ?? "") });
    if (path === "/api/v1/auth/session/refresh") return json({ ...session, refreshToken: renewed,
      refreshExpiresAt: "2099-01-01T00:00:00Z" });
    if (path === "/api/v1/auth/session/logout") return new Response(null, { status: 204 });
    if (path === "/api/v1/auth/session") return json({ actor });
    return json(bootstrap);
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /></AirlineSessionProvider>);
  await screen.findByText("Demo Airlines");
  expect(requests[0]).toEqual({ path: "/api/v1/auth/session/refresh", body: JSON.stringify({ refreshToken }) });
  expect(JSON.parse(sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY) ?? "null")).toEqual({
    accessToken: session.accessToken, expiresAt: session.expiresAt, refreshToken: renewed });

  fireEvent.click(screen.getByRole("button", { name: "Salir" }));
  await screen.findByText("anonymous");
  await waitFor(() => expect(requests.at(-1)).toEqual({ path: "/api/v1/auth/session/logout",
    body: JSON.stringify({ refreshToken: renewed }) }));
});

it("no longer offers preinvoice reads, acceptance or disputes (4-A)", async () => {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: session.accessToken, expiresAt: session.expiresAt,
  }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input =>
    new URL(String(input)).pathname === "/api/v1/auth/session" ? json({ actor }) : json(bootstrap)));
  function Methods() {
    return <span data-testid="offered">{Object.keys(useAirlineSession()).join(",")}</span>;
  }
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><Harness /><Methods /></AirlineSessionProvider>);
  await screen.findByText("Demo Airlines");
  const offered = (screen.getByTestId("offered").textContent ?? "").split(",");
  expect(offered).toContain("getInvoiceDocument");
  for (const retired of ["getPreinvoices", "getPreinvoice", "getPreinvoiceDisputes", "getPreinvoiceInvoice",
    "acceptPreinvoice", "disputePreinvoice"])
    expect(offered).not.toContain(retired);
});
