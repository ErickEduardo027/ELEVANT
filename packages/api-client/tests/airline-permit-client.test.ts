import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError, isAirlinePermit, isAirlinePortalStanding } from "../src";

// Phase 2, block B: the permit commands (2-N09, 2-N30) and the portal standing (2-N32, 2-N35).
const permitId = "63000000-0000-7000-8000-000000000001";
const key = "a0000000-0000-7000-8000-000000000009";
const contractId = "61000000-0000-7000-8000-000000000001";
const permit = { id: permitId, airlineId: "20000000-0000-7000-8000-000000000001", airline: "Demo Airlines",
  kind: "OperatingPermit", number: "JAC-2026-002", issuer: "JAC", issuedOn: "2026-10-01", expiresOn: "2027-10-01",
  validity: "Current", review: "Verified", reviewNote: null, documentUrl: null, submittedAt: "2026-11-02T12:00:00.000Z",
  reviewedAt: "2026-11-03T12:00:00.000Z", version: "AAAAAAAAB9E=", revokedAt: null, revocationReason: null };
const revoked = { ...permit, review: "Revoked", revokedAt: "2026-11-06T12:00:00.000Z",
  revocationReason: "Se verificó por error.", version: "AAAAAAAAB+E=" };

type Call = { url: string; method: string; headers: Headers; body: string };

function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers),
        body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
}

describe("airline permit commands", () => {
  it("lists one review state for Contratos and refuses unknown keys or another state", async () => {
    const calls: Call[] = [];
    const api = client([Response.json([revoked]), Response.json([{ ...revoked, extra: 1 }]), Response.json([permit])], calls);
    await expect(api.getContractsAirlinePermits("Revoked")).resolves.toEqual([revoked]);
    expect(calls[0]!.url).toBe("https://api.example.test/api/v1/contracts/permits?review=Revoked");
    await expect(api.getContractsAirlinePermits("Revoked")).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.getContractsAirlinePermits("Revoked")).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.getContractsAirlinePermits("Unknown" as never)).rejects.toThrow(TypeError);
  });

  it("keeps the revocation only on a revoked permit that kept its verification", () => {
    expect(isAirlinePermit(revoked)).toBe(true);
    expect(isAirlinePermit({ ...permit, revokedAt: "2026-11-06T12:00:00.000Z" })).toBe(false);
    expect(isAirlinePermit({ ...revoked, reviewedAt: null })).toBe(false);
    expect(isAirlinePermit({ ...permit, review: "Pending" })).toBe(false);
    // The deployed portal never sent the revocation keys: an older answer without them is still a permit.
    const { revokedAt: _revokedAt, revocationReason: _reason, ...older } = permit;
    expect(isAirlinePermit(older)).toBe(true);
  });

  it("submits with the optional key and reviews with the version, reading the contracts it changed", async () => {
    const calls: Call[] = [];
    const decision = { ...permit, contracts: [{ contractId, contractCode: "CTR-2026-0001", status: "Active" }] };
    const api = client([Response.json({ ...permit, review: "Submitted", reviewedAt: null }, { status: 201 }),
      Response.json(decision), Response.json({ ...decision, id: "63000000-0000-7000-8000-000000000002" })], calls);
    await api.submitAirlinePermit({ kind: "OperatingPermit", number: " JAC-2026-002 ", issuer: "JAC", issuedOn: "2026-10-01",
      expiresOn: "2027-10-01", documentUrl: null }, key);
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    await expect(api.reviewAirlinePermit(permitId, { verified: true, note: "  ", expectedVersion: permit.version }, key))
      .resolves.toMatchObject({ review: "Verified", contracts: [{ status: "Active" }] });
    expect(calls[1]!.url).toBe(`https://api.example.test/api/v1/contracts/permits/${permitId}/review`);
    expect(JSON.parse(calls[1]!.body)).toEqual({ verified: true, note: null, expectedVersion: permit.version });
    expect(calls[1]!.headers.get("idempotency-key")).toBe(key);
    // The answer is always the permit of the route.
    await expect(api.reviewAirlinePermit(permitId, { verified: true, expectedVersion: permit.version }))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.reviewAirlinePermit(permitId, { verified: false, note: "no", expectedVersion: permit.version }))
      .rejects.toThrow(TypeError);
  });

  it("revokes with a required key and a reason, and reads the suspended contracts", async () => {
    const calls: Call[] = [];
    const decision = { ...revoked, contracts: [{ contractId, contractCode: "CTR-2026-0001", status: "Suspended" }] };
    const api = client([Response.json(decision), Response.json({ ...decision, review: "Verified", revokedAt: null,
      revocationReason: null })], calls);
    await expect(api.revokeAirlinePermit(permitId, { reason: " Se verificó por error. ", expectedVersion: permit.version }, key))
      .resolves.toMatchObject({ review: "Revoked", contracts: [{ contractCode: "CTR-2026-0001", status: "Suspended" }] });
    expect(calls[0]!.url).toBe(`https://api.example.test/api/v1/contracts/permits/${permitId}/revocation`);
    expect(JSON.parse(calls[0]!.body)).toEqual({ reason: "Se verificó por error.", expectedVersion: permit.version });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    await expect(api.revokeAirlinePermit(permitId, { reason: "Se verificó por error.", expectedVersion: permit.version }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.revokeAirlinePermit(permitId, { reason: "no", expectedVersion: permit.version }, key)).rejects.toThrow(TypeError);
    await expect(api.revokeAirlinePermit(permitId, { reason: "Se verificó por error.", expectedVersion: permit.version },
      "not-a-key")).rejects.toThrow(TypeError);
  });

  it("keeps the permit codes of a refused command", async () => {
    const api = client([Response.json({ title: "El permiso cambió; vuelva a cargarlo.", status: 409, code: "review_closed" },
      { status: 409, headers: { "content-type": "application/problem+json" } }),
      Response.json({ title: "Los datos del permiso no son válidos.", status: 400, code: "document_expired" },
        { status: 400, headers: { "content-type": "application/problem+json" } })]);
    await expect(api.reviewAirlinePermit(permitId, { verified: true, expectedVersion: permit.version }))
      .rejects.toMatchObject({ status: 409, code: "review_closed" });
    const failure = await api.submitAirlinePermit({ kind: "OperatingPermit", number: "JAC-1", issuer: "JAC",
      issuedOn: "2026-10-01", expiresOn: "2027-10-01", documentUrl: "/api/v1/media/64000000-0000-7000-8000-000000000001" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ElevantApiError);
    expect(failure).toMatchObject({ status: 400, code: "document_expired" });
  });
});

describe("airline portal standing", () => {
  const standing = { organizationId: "10000000-0000-7000-8000-000000000002", status: "Suspended", readOnly: true,
    stations: [{ id: "20000000-0000-7000-8000-000000000003", code: "PUJ", name: "Punta Cana",
      ianaTimeZone: "America/Santo_Domingo", current: false }],
    contracts: [{ id: contractId, code: "CTR-2026-0001", status: "Suspended", pendingReason: null,
      versionsAwaitingSignatures: [] }] };

  it("reads the historical stations and what each contract waits for", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(standing)], calls);
    await expect(api.getAirlinePortalStanding()).resolves.toEqual(standing);
    expect(calls[0]!.url).toBe("https://api.example.test/api/v1/airline/portal/standing");
  });

  it("refuses unknown keys, a read-only flag that contradicts the stations and a pending active contract", () => {
    expect(isAirlinePortalStanding(standing)).toBe(true);
    expect(isAirlinePortalStanding({ ...standing, extra: true })).toBe(false);
    expect(isAirlinePortalStanding({ ...standing, readOnly: false })).toBe(false);
    expect(isAirlinePortalStanding({ ...standing, status: "Unknown" })).toBe(false);
    expect(isAirlinePortalStanding({ ...standing, contracts: [{ ...standing.contracts[0], status: "Active",
      pendingReason: "signatures" }] })).toBe(false);
    expect(isAirlinePortalStanding({ ...standing, status: "Pending", contracts: [{ ...standing.contracts[0], status: "Draft",
      pendingReason: "operating_permit" }] })).toBe(true);
    expect(isAirlinePortalStanding({ ...standing, stations: [{ ...standing.stations[0], timezone: "UTC" }] })).toBe(false);
  });
});
