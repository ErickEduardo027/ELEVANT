import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError } from "../src";

const requestId = "70000000-0000-7000-8000-0000000000a1";
const contractId = "71000000-0000-7000-8000-0000000000a1";
const stationId = "50000000-0000-7000-8000-000000000001";
const profileId = "20000000-0000-7000-8000-000000000003";
const key = "a0000000-0000-7000-8000-000000000010";
const version = "AAAAAAAAB9E=";
const request = {
  id: requestId, reference: "0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e", airline: "Caribe Cargo Express", airlineProfileId: null,
  legalName: null, countryCode: "DO", iataCode: null, icaoCode: "CCX", logoUrl: null, airlineVerified: false,
  verificationSourceUrl: null, airlineWebsiteUrl: "https://caribecargo.example.com", representativeName: "Ana Rivera",
  representativeTitle: "Gerente comercial", representativeEmail: "ana@caribecargo.example.com",
  representativePhone: "+18095550142", representativeNationalityCode: "DO", representativeAddress: null,
  representativeCountry: "República Dominicana", representativeProvince: "Santo Domingo",
  representativeMunicipality: "Boca Chica", representativeDistrict: "La Caleta", representativeDocumentType: "NationalId",
  representativeDocumentNumber: "001-1234567-3", authorityDeclared: true, status: "InReview",
  submittedAt: "2026-11-05T12:00:00.123+00:00", reviewedAt: null, cancelledAt: null, decisionReason: null,
  contractId: null,
  representativeConfirmation: { confirmedAt: "2026-11-05T13:00:00+00:00", confirmedBy: "Carla Contratos",
    note: "Llamada a la central de la aerolínea." },
  proposedAirline: { name: "Caribe Cargo Express", countryCode: "DO", iataCode: null, icaoCode: "CCX",
    websiteUrl: "https://caribecargo.example.com" },
  existingCustomer: false,
  services: [{ serviceId: "00000000-0000-0000-0000-000000000000", name: "Rampa", unit: "operation" }],
  version,
};
const inbox = { page: 1, limit: 25, total: 1, hasMore: false,
  counts: { pending: 0, inReview: 1, approved: 2, rejected: 0, cancelled: 1 }, requests: [request] };

type Call = { url: string; method: string; headers: Headers; body: string };
function client(answers: Response[]) {
  const calls: Call[] = [];
  const api = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers),
        body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
  return { api, calls };
}

describe("commercial request review client", () => {
  it("reads the open inbox by default and validates every key of the page", async () => {
    const { api, calls } = client([Response.json(inbox), Response.json({ ...inbox, page: 2, limit: 10 })]);
    await expect(api.getCommercialRequestInbox()).resolves.toEqual(inbox);
    await api.getCommercialRequestInbox({ status: "Cancelled", search: "  ana@ ", page: 2, limit: 10 })
      .catch(() => undefined);
    expect(calls.map(call => call.url)).toEqual([
      "https://api.example.test/api/v1/contracts/commercial-requests/inbox?status=Open&page=1&limit=25",
      "https://api.example.test/api/v1/contracts/commercial-requests/inbox?status=Cancelled&page=2&limit=10&search=ana%40",
    ]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");
  });

  it("refuses an unknown key, status or a page that is not the one asked for", async () => {
    for (const malformed of [
      { ...inbox, requests: [{ ...request, internalNote: "x" }] },
      { ...inbox, requests: [{ ...request, status: "Archived" }] },
      { ...inbox, requests: [{ ...request, proposedAirline: { ...request.proposedAirline, secret: true } }] },
      { ...inbox, counts: { ...inbox.counts, deleted: 0 } },
      { ...inbox, page: 3 },
      { ...inbox, requests: [request, request] },
    ]) {
      const { api } = client([Response.json(malformed)]);
      await expect(api.getCommercialRequestInbox()).rejects.toMatchObject({ kind: "malformed-response" });
    }
    const { api } = client([]);
    for (const query of [{ status: "Archived" }, { limit: 0 }, { limit: 51 }, { page: 0 }, { search: "x".repeat(101) }])
      await expect(api.getCommercialRequestInbox(query as never)).rejects.toThrow(TypeError);
  });

  it("sends each command with its Idempotency-Key and the normalized body", async () => {
    const { api, calls } = client([
      Response.json({ id: requestId }), Response.json({ id: requestId }), Response.json({ id: requestId }),
      Response.json({ id: contractId }), Response.json({ id: requestId }),
    ]);
    await api.verifyCommercialRequestAirline(requestId, { expectedVersion: version, legalName: " Caribe Cargo S.R.L. ",
      countryCode: "do", iataCode: " ", icaoCode: "ccx", verificationSourceUrl: "https://aoc.example.test/ccx" }, key);
    await api.confirmCommercialRepresentative(requestId, { expectedVersion: version, note: " Llamada a la central. " }, key);
    await api.cancelCommercialRequest(requestId, { expectedVersion: version, reason: "Solicitud duplicada." }, key);
    await expect(api.decideCommercialRequest(requestId, { approve: true, reason: "ignored", stationIds: [stationId],
      expectedVersion: version }, key)).resolves.toEqual({ id: contractId });
    await api.decideCommercialRequest(requestId, { approve: false, reason: " No procede. ", stationIds: [stationId],
      expectedVersion: version }, key);
    expect(calls.map(call => [call.method, call.url.replace("https://api.example.test/api/v1/contracts/commercial-requests/", "")]))
      .toEqual([
        ["POST", `${requestId}/airline-verification`], ["POST", `${requestId}/representative-confirmation`],
        ["POST", `${requestId}/cancellation`], ["POST", `${requestId}/decision`], ["POST", `${requestId}/decision`],
      ]);
    expect(calls.every(call => call.headers.get("idempotency-key") === key)).toBe(true);
    expect(calls.map(call => JSON.parse(call.body))).toEqual([
      { expectedVersion: version, linkProfileId: null, legalName: "Caribe Cargo S.R.L.", countryCode: "DO", iataCode: null,
        icaoCode: "CCX", verificationSourceUrl: "https://aoc.example.test/ccx" },
      { expectedVersion: version, note: "Llamada a la central." },
      { expectedVersion: version, reason: "Solicitud duplicada." },
      { approve: true, reason: null, stationIds: [stationId], expectedVersion: version },
      { approve: false, reason: "No procede.", stationIds: [], expectedVersion: version },
    ]);
  });

  it("accepts the version of a request linked to its airline profile and sends it back unchanged", async () => {
    // The request's rowversion followed by its airline profile's: approving freezes the profile's identity (1-D).
    const linked = "AAAAAAAAB9EAAAAAAAAH0g==";
    const { api, calls } = client([Response.json({ ...inbox, requests: [{ ...request, version: linked }] }),
      Response.json({ id: contractId })]);
    await expect(api.getCommercialRequestInbox()).resolves.toMatchObject({ requests: [{ version: linked }] });
    await api.decideCommercialRequest(requestId, { approve: true, stationIds: [stationId], expectedVersion: linked }, key);
    expect(JSON.parse(calls[1]!.body)).toMatchObject({ expectedVersion: linked });
  });

  it("links a proposed airline to a verified profile without an identity", async () => {
    const { api, calls } = client([Response.json({ id: requestId })]);
    await api.verifyCommercialRequestAirline(requestId, { expectedVersion: version, linkProfileId: profileId.toUpperCase() }, key);
    expect(JSON.parse(calls[0]!.body)).toEqual({ expectedVersion: version, linkProfileId: profileId });
  });

  it("validates commands before sending them", async () => {
    const { api, calls } = client([]);
    await expect(api.verifyCommercialRequestAirline(requestId, { expectedVersion: version }, key)).rejects.toThrow(TypeError);
    await expect(api.verifyCommercialRequestAirline(requestId, { expectedVersion: version, legalName: "X", countryCode: "DO",
      icaoCode: "CCX", verificationSourceUrl: "http://aoc.example.test" }, key)).rejects.toThrow(TypeError);
    await expect(api.verifyCommercialRequestAirline(requestId, { expectedVersion: version, legalName: "X", countryCode: "DO",
      iataCode: "12", icaoCode: "CCX", verificationSourceUrl: "https://aoc.example.test" }, key)).rejects.toThrow(TypeError);
    await expect(api.confirmCommercialRepresentative(requestId, { expectedVersion: version, note: "ok" }, key))
      .rejects.toThrow(TypeError);
    await expect(api.cancelCommercialRequest(requestId, { expectedVersion: "", reason: "Solicitud duplicada." }, key))
      .rejects.toThrow(TypeError);
    await expect(api.decideCommercialRequest(requestId, { approve: true, stationIds: [], expectedVersion: version }, key))
      .rejects.toThrow(TypeError);
    await expect(api.decideCommercialRequest(requestId, { approve: false, reason: " ", stationIds: [],
      expectedVersion: version }, key)).rejects.toThrow(TypeError);
    await expect(api.cancelCommercialRequest(requestId, { expectedVersion: version, reason: "Solicitud duplicada." },
      "not-a-key")).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });

  it("keeps the stable code of a refused command and drops unknown codes", async () => {
    const problem = (code: string, status = 409) => new Response(JSON.stringify({ title: "Ignored title", status, code }),
      { status, headers: { "content-type": "application/problem+json" } });
    const { api } = client([problem("airline_already_contracted"), problem("made_up_code"), Response.json({ id: contractId })]);
    const refused = await api.decideCommercialRequest(requestId, { approve: true, stationIds: [stationId],
      expectedVersion: version }, key).catch(error => error);
    expect(refused).toBeInstanceOf(ElevantApiError);
    expect(refused).toMatchObject({ status: 409, code: "airline_already_contracted" });
    const unknown = await api.cancelCommercialRequest(requestId, { expectedVersion: version, reason: "Solicitud duplicada." },
      key).catch(error => error);
    expect(unknown).toMatchObject({ status: 409, code: undefined });
    // A cancellation answers with the request itself; another id is a malformed response.
    await expect(api.cancelCommercialRequest(requestId, { expectedVersion: version, reason: "Solicitud duplicada." }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });
});
