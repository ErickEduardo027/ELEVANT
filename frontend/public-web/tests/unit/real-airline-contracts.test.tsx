import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AirlineContractPageResponse, AirlinePortalBootstrapResponse,
  SessionResponse } from "@elevant/api-client";
import { AIRLINE_SESSION_STORAGE_KEY,
  AirlineSessionProvider } from "@/components/auth/AirlineSessionProvider";
import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";

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
  iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines",
  stations: [], currentOperations: [],
};
const contracts: AirlineContractPageResponse = {
  page: 1, limit: 20, hasMore: false,
  contracts: [{
    id: "60000000-0000-7000-8000-000000000002", code: "DEV-CONTRACT-0001",
    status: "Expired", signedOn: "2026-01-01", terminatedOn: null,
    approvedVersions: [{
      id: "60000000-0000-7000-8000-000000000003", versionNumber: 1,
      validFrom: "2026-01-01", validTo: "2026-08-31", currencyCode: "USD",
      stations: [{ id: "20000000-0000-7000-8000-000000000003",
        code: "PUJ", name: "Punta Cana" }],
      rates: [{ id: "60000000-0000-7000-8000-000000000004",
        serviceCode: "BAG", serviceName: "Manejo de equipaje", billingUnit: "operation",
        unitPrice: 125.5, minimumQuantity: 1 }],
    }],
  }],
};

function mount(page: AirlineContractPageResponse, drafts: unknown = []) {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({
    accessToken: "synthetic-token", expiresAt: "2099-01-01T00:00:00Z",
  }));
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");
    if (path.endsWith("/draft/pdf"))
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } });
    const body = path.endsWith("/bootstrap") ? bootstrap
      : path.endsWith("/contracts") ? page
        : path.endsWith("/contract-drafts") ? drafts : { actor };
    return new Response(JSON.stringify(body), { status: 200,
      headers: { "content-type": "application/json" } });
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test">
    <AirlinePortalPage view="contracts" />
  </AirlineSessionProvider>);
  return paths;
}

afterEach(() => {
  cleanup(); sessionStorage.clear(); vi.unstubAllGlobals();
});

it("labels unconfirmed draft pricing as pending, including a zero placeholder", async () => {
  mount({ page: 1, limit: 20, hasMore: false, contracts: [] }, [{
    id: "draft-1", contractId: "contract-1", contractCode: "DEV-CONTRACT-0002",
    airline: "Demo Airlines", status: "Draft", validFrom: "2026-10-01", validTo: null,
    currencyCode: "USD", terms: null, stations: [], comments: [],
    rates: [{ id: "rate-1", serviceName: "Rampa", billingUnit: "operación",
      unitPrice: 0, minimumQuantity: 1, isConfirmed: false }],
  }]);
  expect(await screen.findByText("Rampa")).toBeInTheDocument();
  expect(screen.getByText(/Precio por operación: por definir/i)).toBeInTheDocument();
  expect(screen.queryByText(/US\$0/)).not.toBeInTheDocument();
});

it("shows the airline's real approved contract history and rates", async () => {
  const paths = mount(contracts);
  expect(await screen.findByText("DEV-CONTRACT-0001")).toBeInTheDocument();
  expect(screen.getByText("Manejo de equipaje")).toBeInTheDocument();
  expect(screen.getByText(/125/)).toBeInTheDocument();
  // 1-E: the unit code is shown in Spanish.
  expect(screen.getByText(/^Precio por operación:/)).toBeInTheDocument();
  expect(screen.queryByText(/operation/)).not.toBeInTheDocument();
  expect(screen.queryByText("DEMO-CON-001")).not.toBeInTheDocument();
  expect(paths).toContain("/api/v1/airline/portal/contracts");
});

it("shows an honest empty state with no fabricated contract", async () => {
  mount({ page: 1, limit: 20, hasMore: false, contracts: [] });
  expect(await screen.findByText(/No hay contratos aprobados/i)).toBeInTheDocument();
  expect(screen.queryByText("DEMO-CON-001")).not.toBeInTheDocument();
});

it("downloads the draft as a watermarked review PDF from the draft card", async () => {
  const draftId = "62000000-0000-7000-8000-000000000001";
  URL.createObjectURL = vi.fn(() => "blob:draft");
  URL.revokeObjectURL = vi.fn();
  const paths = mount({ page: 1, limit: 20, hasMore: false, contracts: [] }, [{
    id: draftId, contractId: "contract-1", contractCode: "DEV-CONTRACT-0002",
    airline: "Demo Airlines", status: "Draft", validFrom: "2026-10-01", validTo: null,
    currencyCode: "USD", terms: null, stations: [], comments: [], rates: [],
  }]);
  const group = await screen.findByRole("group", { name: "Documento: borrador del contrato" });
  fireEvent.click(within(group).getByRole("button", { name: "Descargar PDF" }));
  await waitFor(() => expect(paths).toContain(`/api/v1/contract-versions/${draftId}/draft/pdf`));
  expect(within(group).getByRole("button", { name: "Imprimir" })).toBeInTheDocument();
});

it("submits a permit with its scanned document and shows the contract timeline", async () => {
  const permit = { id: "63000000-0000-7000-8000-000000000001", airlineId: "20000000-0000-7000-8000-000000000001",
    airline: "Demo Airlines", kind: "OperatingPermit", number: "JAC-2026-002", issuer: "JAC", issuedOn: "2026-10-01",
    expiresOn: "2099-01-01", validity: "Current", review: "Submitted", reviewNote: null,
    documentUrl: "/api/v1/media/64000000-0000-7000-8000-000000000001", submittedAt: "2026-11-02T12:00:00.000Z",
    reviewedAt: null, version: "AAAAAAAAB9E=" };
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({ accessToken: "synthetic-token", expiresAt: "2099-01-01T00:00:00Z" }));
  const posted: Array<{ path: string; body: unknown }> = [];
  let submitted = false;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (init?.method === "POST") posted.push({ path, body: init.body instanceof FormData ? "form" : JSON.parse(String(init.body)) });
    if (path.endsWith("/media")) return json({ id: "64000000-0000-7000-8000-000000000001", url: permit.documentUrl });
    if (path.endsWith("/airline/permits")) {
      if (init?.method === "POST") { submitted = true; return json(permit, 201); }
      return json(submitted ? [permit] : []);
    }
    if (path.endsWith("/timeline")) return json({ contractId: "60000000-0000-7000-8000-000000000002",
      contractCode: "DEV-CONTRACT-0001", status: "Active", terminatesOn: null, earliestTerminationOn: "2026-12-02",
      entries: [{ at: "2026-10-21T12:00:00Z", kind: "status", title: "Contrato activo", detail: "Aprobado por Finanzas…", actor: null }] });
    const body = path.endsWith("/bootstrap") ? bootstrap : path.endsWith("/contracts") ? contracts
      : path.endsWith("/contract-drafts") ? [] : { actor };
    return json(body);
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><AirlinePortalPage view="contracts" /></AirlineSessionProvider>);

  expect(await screen.findByText("Falta un permiso de operación verificado")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Número"), { target: { value: "JAC-2026-002" } });
  fireEvent.change(screen.getByLabelText("Emisor"), { target: { value: "JAC" } });
  fireEvent.change(screen.getByLabelText("Fecha de emisión"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Fecha de vencimiento"), { target: { value: "2099-01-01" } });
  fireEvent.change(screen.getByLabelText(/Documento escaneado/), { target: { files: [new File(["%PDF-1.7"], "jac.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar permiso" }));
  expect(await screen.findByText(/Permiso enviado/)).toBeInTheDocument();
  expect(posted.map(item => item.path)).toEqual(["/api/v1/media", "/api/v1/airline/permits"]);
  expect(posted[1]?.body).toMatchObject({ kind: "OperatingPermit", number: "JAC-2026-002", documentUrl: permit.documentUrl });
  expect(await screen.findByText(/En revisión por AVIAM/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Ver línea de tiempo del contrato" }));
  expect(await screen.findByText("Contrato activo")).toBeInTheDocument();
});

it("lets the airline comment while Finance reviews, shows Contratos' answers and explains a refusal by its code", async () => {
  const draftId = "62000000-0000-7000-8000-000000000002";
  const commentId = "62000000-0000-7000-8000-000000000003";
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({ accessToken: "synthetic-token", expiresAt: "2099-01-01T00:00:00Z" }));
  const posts: Array<{ key: string | null; body: unknown }> = [];
  let draftReads = 0;
  const answers = [
    () => new Response(JSON.stringify({ status: 409, title: "The draft changed.", code: "version_conflict" }),
      { status: 409, headers: { "content-type": "application/problem+json" } }),
    () => new Response(JSON.stringify({ id: commentId }), { status: 201, headers: { "content-type": "application/json" } }),
  ];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (path.endsWith("/comments")) {
      posts.push({ key: new Headers(init?.headers).get("idempotency-key"), body: JSON.parse(String(init?.body)) });
      return answers.shift()!();
    }
    if (path.endsWith("/contract-drafts")) {
      draftReads += 1;
      return json([{ id: draftId, contractId: "contract-1", contractCode: "DRAFT-1", airline: "Demo Airlines", status: "Draft",
        validFrom: "2026-12-01", validTo: null, currencyCode: "USD", terms: "Condiciones.", stations: ["PUJ · Punta Cana"],
        rates: [], versionStatus: "PendingFinanceApproval", financeDecision: null, version: "AAAAAAAAB9E=",
        comments: [{ id: "c-1", author: "Contratos AVIAM", body: "El recargo nocturno se cobra aparte.",
          at: "2026-11-05T12:00:00Z", isAirline: false }] }]);
    }
    const body = path.endsWith("/bootstrap") ? bootstrap : path.endsWith("/contracts")
      ? { page: 1, limit: 20, hasMore: false, contracts: [] } : path.endsWith("/airline/permits") ? [] : { actor };
    return json(body);
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test"><AirlinePortalPage view="contracts" /></AirlineSessionProvider>);

  expect(await screen.findByText(/En revisión por Finanzas · DRAFT-1/)).toBeInTheDocument();
  expect(screen.getByText("Respuesta de Contratos")).toBeInTheDocument();
  expect(screen.getByText("El recargo nocturno se cobra aparte.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Enviar una observación a Contratos"), { target: { value: "¿Incluye la noche?" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar observación" }));
  expect(await screen.findByText(/El borrador cambió mientras escribía/)).toBeInTheDocument();
  expect(screen.queryByText("The draft changed.")).not.toBeInTheDocument();
  await waitFor(() => expect(draftReads).toBeGreaterThan(1));
  fireEvent.click(screen.getByRole("button", { name: "Enviar observación" }));
  expect(await screen.findByText("Observación enviada a Contratos.")).toBeInTheDocument();
  expect(posts).toHaveLength(2);
  expect(posts[0]!.body).toEqual({ expectedVersion: "AAAAAAAAB9E=", body: "¿Incluye la noche?" });
  expect(posts[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
  // The refused attempt was answered: the next one is a new intent with a new key.
  expect(posts[1]!.key).not.toBe(posts[0]!.key);
});
