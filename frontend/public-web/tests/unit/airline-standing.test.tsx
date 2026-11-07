import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ElevantApiError, type AirlineContractPageResponse, type AirlinePortalBootstrapResponse,
  type AirlinePortalStandingResponse, type SessionResponse } from "@elevant/api-client";
import { AIRLINE_SESSION_STORAGE_KEY, AirlineSessionProvider } from "@/components/auth/AirlineSessionProvider";
import { AirlinePortalPage } from "@/components/portal/AirlinePortalPage";
import { AirlineTreasuryPanel } from "@/components/portal/AirlineTreasuryPanel";
import { contractStatusLabel, standingNotice, terminationNote } from "@/lib/contract-status";
import { permitProblem } from "@/lib/permit-problems";

// Phase 2, block B: the portal standing (2-N32, 2-N35) and the permit submission (2-N09, 2-N30, 2-N37).
vi.mock("@/lib/airline-change-observer", () => ({
  createPublicAirlineChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }),
}));

const organizationId = "10000000-0000-7000-8000-000000000002";
const contractId = "60000000-0000-7000-8000-000000000002";
const versionId = "60000000-0000-7000-8000-000000000003";
const amendmentId = "60000000-0000-7000-8000-000000000009";
const actor: SessionResponse["actor"] = {
  accountId: "40000000-0000-7000-8000-000000000003", email: "airline.client@dev.elevant.test", displayName: "Casey Airline",
  roles: [{ roleId: "41000000-0000-7000-8000-000000000003", code: "AIRLINE_CLIENT", name: "Airline Client",
    portal: "airline_portal", userType: "airline_client" }],
  memberships: [{ membershipId: "42000000-0000-7000-8000-000000000003", organizationId, organizationCode: "DEMO-AIR",
    organizationName: "Demo Airlines", organizationType: "airline_customer", kind: "airline_client" }],
  stationScopes: [],
};
// Suspended: nothing in force today, so the bootstrap lists no station.
const bootstrap: AirlinePortalBootstrapResponse = { airlineId: "20000000-0000-7000-8000-000000000001", organizationId,
  iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines", stations: [], currentOperations: [] };
const station = { id: "20000000-0000-7000-8000-000000000003", code: "PUJ", name: "Punta Cana",
  ianaTimeZone: "America/Santo_Domingo", current: false };
const version = (id: string, versionNumber: number) => ({ id, versionNumber, validFrom: "2026-01-01", validTo: "2026-12-31",
  currencyCode: "USD", stations: [{ id: station.id, code: "PUJ", name: "Punta Cana" }], rates: [] });

type Answer = (path: string, init?: RequestInit) => unknown;

function mount(ui: React.ReactNode, standing: AirlinePortalStandingResponse | (() => Response), extra: Answer = () => undefined) {
  sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify({ accessToken: "synthetic-token", expiresAt: "2099-01-01T00:00:00Z" }));
  const calls: Array<{ path: string; method: string; key: string | null; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    calls.push({ path, method: init?.method ?? "GET", key: new Headers(init?.headers).get("idempotency-key"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ? "form" : null });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path.endsWith("/standing")) return typeof standing === "function" ? standing() : json(standing);
    const answer = extra(path, init);
    if (answer instanceof Response) return answer;
    if (answer !== undefined) return json(answer);
    if (path.endsWith("/bootstrap")) return json(bootstrap);
    if (path.endsWith("/auth/session")) return json({ actor });
    if (path.endsWith("/airline/permits")) return json([]);
    if (path.endsWith("/contract-drafts")) return json([]);
    return json({ page: 1, limit: 20, hasMore: false, contracts: [] });
  }));
  render(<AirlineSessionProvider baseUrl="https://api.example.test">{ui}</AirlineSessionProvider>);
  return calls;
}

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe("contract labels and standing notices (2-N32, 2-N35)", () => {
  it("never names an approved contract «Borrador»", () => {
    expect(contractStatusLabel("Draft", "signatures")).toBe("Pendiente de firmas");
    expect(contractStatusLabel("Draft", "operating_permit")).toBe("Pendiente de permiso de operación");
    expect(contractStatusLabel("Draft", null)).toBe("Pendiente de activación");
    expect(contractStatusLabel("Expired")).toBe("Vencido");
    expect(standingNotice({ organizationId, status: "Expired", readOnly: true, stations: [station], contracts: [] }))
      .toMatch(/venció/);
    expect(standingNotice({ organizationId, status: "Active", readOnly: false, stations: [], contracts: [] })).toBeNull();
  });

  it("tells a terminated contract from a scheduled termination, whose date is the first day without coverage (2-N14)", () => {
    expect(terminationNote("Active", null)).toBe("");
    expect(terminationNote("Terminated", "2026-11-01")).toBe(" · Terminado: 2026-11-01");
    expect(terminationNote("Active", "2027-01-15")).toBe(" · Terminación programada: cubre operaciones hasta el 2027-01-14");
    // A suspended or expired contract covers nothing now: only the day it ends is stated.
    expect(terminationNote("Suspended", "2027-01-15")).toBe(" · Terminación programada: termina el 2027-01-15");
    expect(terminationNote("Expired", "2027-01-15")).toBe(" · Terminación programada: termina el 2027-01-15");
  });

  it("explains each submission problem by its code, and only an uncertain result is retried as it is", () => {
    const failure = (status: number, code?: string) => new ElevantApiError({ kind: "http", status, code: code as never });
    expect(permitProblem(failure(400, "document_expired"))).toMatchObject({ retry: false, text: expect.stringMatching(/vuelva a adjuntarlo/) });
    expect(permitProblem(failure(400, "permit_dates_invalid")).text).toMatch(/fecha de emisión no puede ser futura/);
    expect(permitProblem(failure(400, "invalid_permit")).text).toMatch(/número/);
    expect(permitProblem(failure(400)).text).toBe("Revise los datos del permiso e intente de nuevo.");
    expect(permitProblem(failure(503))).toMatchObject({ retry: true });
    expect(permitProblem(new TypeError("network"))).toMatchObject({ retry: false });
  });

  it("labels a contract waiting for its signatures and a renewal waiting for them, from the standing", async () => {
    const contracts: AirlineContractPageResponse = { page: 1, limit: 20, hasMore: false, contracts: [
      { id: contractId, code: "CTR-2026-0001", status: "Draft", signedOn: null, terminatedOn: null,
        approvedVersions: [version(versionId, 1)] },
      { id: "60000000-0000-7000-8000-000000000012", code: "CTR-2026-0002", status: "Active", signedOn: "2026-01-01",
        terminatedOn: null, approvedVersions: [version(amendmentId, 2)] }] };
    mount(<AirlinePortalPage view="contracts" />, { organizationId, status: "Active", readOnly: false, stations: [{ ...station, current: true }],
      contracts: [{ id: contractId, code: "CTR-2026-0001", status: "Draft", pendingReason: "signatures", versionsAwaitingSignatures: [versionId] },
        { id: "60000000-0000-7000-8000-000000000012", code: "CTR-2026-0002", status: "Active", pendingReason: null,
          versionsAwaitingSignatures: [amendmentId] }] },
      path => path.endsWith("/airline/portal/contracts") ? contracts : undefined);
    const first = (await screen.findByRole("heading", { name: "CTR-2026-0001" })).closest("article")!;
    await waitFor(() => expect(first).toHaveTextContent("Pendiente de firmas"));
    expect(screen.queryByText("Borrador")).not.toBeInTheDocument();
    const second = screen.getByRole("heading", { name: "CTR-2026-0002" }).closest("article")!;
    expect(second).toHaveTextContent("Activo");
    expect(within(second).getByText("Pendiente de firmas")).toBeInTheDocument();
  });

  it("tells a suspended airline where it stands and keeps its stations as history", async () => {
    mount(<AirlinePortalPage view="overview" />, { organizationId, status: "Suspended", readOnly: true, stations: [station],
      contracts: [{ id: contractId, code: "CTR-2026-0001", status: "Suspended", pendingReason: null, versionsAwaitingSignatures: [] }] });
    const notice = await screen.findByRole("status", { name: "Estado del contrato" });
    expect(notice).toHaveTextContent(/está suspendido/);
    expect(notice).toHaveTextContent(/facturas y pagos siguen disponibles/);
    expect(screen.getByText(/0 estación\(es\) en vigor · 1 con historial/)).toBeInTheDocument();
    expect(screen.getByText(/ningún contrato está en vigor hoy/)).toBeInTheDocument();
  });

  it("offers a retry when the standing cannot be read", async () => {
    let fail = true;
    mount(<AirlinePortalPage view="overview" />, () => fail
      ? new Response(JSON.stringify({ status: 503 }), { status: 503 })
      : new Response(JSON.stringify({ organizationId, status: "Active", readOnly: false, stations: [{ ...station, current: true }],
        contracts: [] }), { headers: { "content-type": "application/json" } }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo consultar el estado de su contrato.");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByText("No se pudo consultar el estado de su contrato.")).not.toBeInTheDocument());
  });

  it("filters the treasury by the stations of the airline's history", async () => {
    mount(<AirlineTreasuryPanel />, { organizationId, status: "Expired", readOnly: true, stations: [station], contracts: [] },
      path => path.includes("/treasury/statements") ? { airlineId: bootstrap.airlineId, asOf: "2026-11-06", invoices: [],
        receipts: [], movements: [], aging: [] } : undefined);
    const select = await screen.findByLabelText("Estación");
    await waitFor(() => expect(within(select).getByRole("option", { name: "PUJ" })).toBeInTheDocument());
  });
});

describe("permit submission (2-N09, 2-N30, 2-N37)", () => {
  const permit = { id: "63000000-0000-7000-8000-000000000001", airlineId: "20000000-0000-7000-8000-000000000001",
    airline: "Demo Airlines", kind: "OperatingPermit", number: "JAC-2026-002", issuer: "JAC", issuedOn: "2026-10-01",
    expiresOn: "2099-01-01", validity: "Current", review: "Submitted", reviewNote: null,
    documentUrl: "/api/v1/media/64000000-0000-7000-8000-000000000001", submittedAt: "2026-11-02T12:00:00.000Z",
    reviewedAt: null, version: "AAAAAAAAB9E=", revokedAt: null, revocationReason: null };
  const standing: AirlinePortalStandingResponse = { organizationId, status: "None", readOnly: true, stations: [], contracts: [] };

  function fill() {
    fireEvent.change(screen.getByLabelText("Número"), { target: { value: "JAC-2026-002" } });
    fireEvent.change(screen.getByLabelText("Emisor"), { target: { value: "JAC" } });
    fireEvent.change(screen.getByLabelText("Fecha de emisión"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Fecha de vencimiento"), { target: { value: "2099-01-01" } });
  }

  it("retries an uncertain submission with the same key and the same uploaded scan", async () => {
    const outcomes = [() => new Response(JSON.stringify({ status: 503 }), { status: 503 }),
      () => new Response(JSON.stringify(permit), { status: 201, headers: { "content-type": "application/json" } })];
    const calls = mount(<AirlinePortalPage view="contracts" />, standing, (path, init) => {
      if (path.endsWith("/media")) return { id: "64000000-0000-7000-8000-000000000001", url: permit.documentUrl };
      if (path.endsWith("/airline/permits") && init?.method === "POST") return outcomes.shift()!();
      return undefined;
    });
    await screen.findByRole("form", { name: "Enviar un permiso" });
    fill();
    fireEvent.change(screen.getByLabelText(/Documento escaneado/), { target: { files: [new File(["%PDF-1.7"], "jac.pdf",
      { type: "application/pdf", lastModified: 1 })] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar permiso" }));
    expect(await screen.findByText(/no se enviará dos veces/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviar permiso" }));
    expect(await screen.findByText(/Permiso enviado/)).toBeInTheDocument();
    const posts = calls.filter(call => call.method === "POST");
    expect(posts.map(call => call.path)).toEqual(["/api/v1/media", "/api/v1/airline/permits", "/api/v1/airline/permits"]);
    expect(posts[1]!.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[2]!.key).toBe(posts[1]!.key);
    expect(posts[2]!.body).toEqual(posts[1]!.body);
  });

  it("explains an expired scan by its code and shows a revoked verification with its reason", async () => {
    mount(<AirlinePortalPage view="contracts" />, standing, (path, init) => {
      if (path.endsWith("/airline/permits") && init?.method === "POST")
        return new Response(JSON.stringify({ status: 400, title: "Invalid permit.", code: "document_expired" }),
          { status: 400, headers: { "content-type": "application/problem+json" } });
      if (path.endsWith("/airline/permits"))
        return [{ ...permit, review: "Revoked", reviewedAt: "2026-11-03T12:00:00.000Z", revokedAt: "2026-11-06T12:00:00.000Z",
          revocationReason: "Se verificó otra matrícula." }];
      return undefined;
    });
    expect(await screen.findByText(/Verificación revocada por AVIAM/)).toBeInTheDocument();
    expect(screen.getByText(/Motivo: Se verificó otra matrícula\./)).toBeInTheDocument();
    expect(screen.getByText("Falta un permiso de operación verificado")).toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Enviar permiso" }));
    expect(await screen.findByText(/se subió hace demasiado tiempo/)).toBeInTheDocument();
    expect(screen.queryByText(/no puede estar vencido ni emitido en el futuro/)).not.toBeInTheDocument();
  });
});
