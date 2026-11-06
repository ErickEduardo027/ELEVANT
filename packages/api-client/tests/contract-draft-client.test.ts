import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError } from "../src";
import { ELEVANT_API_ERROR_CODES } from "../src/errors";

const versionId = "70000000-0000-7000-8000-0000000000c1";
const contractId = "71000000-0000-7000-8000-0000000000c1";
const commentId = "72000000-0000-7000-8000-0000000000c1";
const rateId = "73000000-0000-7000-8000-0000000000c1";
const serviceId = "74000000-0000-7000-8000-0000000000c1";
const otherServiceId = "74000000-0000-7000-8000-0000000000c2";
const stationId = "75000000-0000-7000-8000-0000000000c1";
const chargeId = "76000000-0000-7000-8000-0000000000c1";
const key = "a0000000-0000-7000-8000-0000000000c1";
const version = "AAAAAAAAB9E=";
const readiness = {
  versionId, version, versionStatus: "Draft", ready: false, portalAccount: "Invited",
  issues: [{ code: "rates_unconfirmed", subjects: [] }, { code: "service_retired", subjects: ["RAMP-CARGO · Carga"] }],
};
const scope = {
  versionId, version, versionStatus: "Draft",
  services: [
    { serviceId, code: "RAMP-CARGO", name: "Carga y descarga", isActive: false, selected: true, rateId, coveredByPackage: false },
    { serviceId: otherServiceId, code: "RAMP-TOW", name: "Remolque", isActive: true, selected: false, rateId: null,
      coveredByPackage: false },
  ],
  stations: [{ stationId, code: "PUJ", name: "Punta Cana", isActive: true, selected: true }],
};

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
const created = (id: string) => new Response(JSON.stringify({ id }), { status: 201, headers: { "content-type": "application/json" } });

describe("contract draft client", () => {
  it("reads the readiness and the scope of a draft and validates every key", async () => {
    const { api, calls } = client([Response.json(readiness), Response.json(scope)]);
    await expect(api.getContractDraftReadiness(versionId)).resolves.toEqual(readiness);
    await expect(api.getContractDraftScope(versionId)).resolves.toEqual(scope);
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ["GET", `https://api.example.test/api/v1/contracts/drafts/${versionId}/readiness`],
      ["GET", `https://api.example.test/api/v1/contracts/drafts/${versionId}/scope`],
    ]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");
  });

  it("refuses readiness or scope shapes the server never sends", async () => {
    for (const malformed of [
      { ...readiness, internalNote: "x" },
      { ...readiness, versionId: contractId },
      { ...readiness, portalAccount: "Unknown" },
      { ...readiness, issues: [{ code: "made_up", subjects: [] }] },
      { ...readiness, issues: [readiness.issues[0], readiness.issues[0]] },
      { ...readiness, ready: true },
      { ...readiness, issues: [] },
    ]) {
      const { api } = client([Response.json(malformed)]);
      await expect(api.getContractDraftReadiness(versionId)).rejects.toMatchObject({ kind: "malformed-response" });
    }
    for (const malformed of [
      { ...scope, services: [{ ...scope.services[0], basePrice: 10 }] },
      { ...scope, services: [{ ...scope.services[0], rateId: null }] },
      { ...scope, services: [{ ...scope.services[1], selected: false, isActive: false }] },
      { ...scope, services: [scope.services[0], scope.services[0]] },
      { ...scope, stations: [{ ...scope.stations[0], isActive: false, selected: false }] },
      { ...scope, versionStatus: "Approved" },
    ]) {
      const { api } = client([Response.json(malformed)]);
      await expect(api.getContractDraftScope(versionId)).rejects.toMatchObject({ kind: "malformed-response" });
    }
    // Finance is reviewing it: not ready, and no blocking cause is required.
    const { api } = client([Response.json({ ...readiness, versionStatus: "PendingFinanceApproval", issues: [] })]);
    await expect(api.getContractDraftReadiness(versionId)).resolves.toMatchObject({ ready: false, issues: [] });
  });

  it("sends each draft command with its Idempotency-Key, method and normalized body", async () => {
    const { api, calls } = client([
      Response.json({ id: versionId }), Response.json({ id: versionId }), Response.json({ id: contractId }),
      Response.json({ id: versionId }), created(commentId), created(commentId),
    ]);
    await api.updateManagedContractDraft(versionId, {
      expectedVersion: version, validFrom: "2027-01-01", validTo: "", currencyCode: "USD", terms: " Condiciones. ",
      rates: [{ id: rateId.toUpperCase(), billingUnit: " operation ", unitPrice: 0, minimumQuantity: 1, isConfirmed: true }],
      chargeRates: [{ chargeId, isExcluded: true, value: null }],
    }, key);
    await api.setContractDraftScope(versionId, { expectedVersion: version, serviceIds: [serviceId.toUpperCase()],
      stationIds: [stationId] }, key);
    await expect(api.submitManagedContractDraft(versionId, { expectedVersion: version }, key))
      .resolves.toEqual({ id: contractId });
    await api.discardContractDraft(versionId, { expectedVersion: version, reason: " La aerolínea desistió. " }, key);
    await expect(api.replyContractDraft(versionId, { expectedVersion: version, body: " No: se cobra aparte. " }, key))
      .resolves.toEqual({ id: commentId });
    await api.commentAirlineContractDraft(versionId, { expectedVersion: version, body: "¿Incluye la noche?" }, key);
    expect(calls.map(call => [call.method, call.url.replace("https://api.example.test/api/v1/", "")])).toEqual([
      ["PUT", `contracts/drafts/${versionId}`], ["PUT", `contracts/drafts/${versionId}/scope`],
      ["POST", `contracts/drafts/${versionId}/activate`], ["POST", `contracts/drafts/${versionId}/discard`],
      ["POST", `contracts/drafts/${versionId}/comments`], ["POST", `airline/contract-drafts/${versionId}/comments`],
    ]);
    expect(calls.every(call => call.headers.get("idempotency-key") === key)).toBe(true);
    expect(calls.map(call => JSON.parse(call.body))).toEqual([
      { expectedVersion: version, validFrom: "2027-01-01", validTo: null, currencyCode: "USD", terms: "Condiciones.",
        rates: [{ id: rateId, billingUnit: "operation", unitPrice: 0, minimumQuantity: 1, isConfirmed: true }],
        chargeRates: [{ chargeId, isExcluded: true, value: null }] },
      { expectedVersion: version, serviceIds: [serviceId], stationIds: [stationId] },
      { expectedVersion: version },
      { expectedVersion: version, reason: "La aerolínea desistió." },
      { expectedVersion: version, body: "No: se cobra aparte." },
      { expectedVersion: version, body: "¿Incluye la noche?" },
    ]);
  });

  it("validates commands before sending them", async () => {
    const { api, calls } = client([]);
    const update = { expectedVersion: version, validFrom: "2027-01-01", currencyCode: "USD", terms: "Condiciones.",
      rates: [{ id: rateId, billingUnit: "operation", unitPrice: 1, minimumQuantity: 1, isConfirmed: true }] };
    for (const invalid of [
      { ...update, expectedVersion: "" }, { ...update, currencyCode: "EUR" }, { ...update, validTo: "2026-12-31" },
      { ...update, rates: [] }, { ...update, terms: " " }, { ...update, rates: [{ ...update.rates[0], unitPrice: -1 }] },
      { ...update, rates: [update.rates[0], update.rates[0]] },
      { ...update, chargeRates: [{ chargeId, isExcluded: true, value: 5 }] },
      { ...update, internalNote: "x" },
    ])
      await expect(api.updateManagedContractDraft(versionId, invalid as never, key)).rejects.toThrow(TypeError);
    await expect(api.setContractDraftScope(versionId, { expectedVersion: version, serviceIds: [], stationIds: [stationId] },
      key)).rejects.toThrow(TypeError);
    await expect(api.setContractDraftScope(versionId, { expectedVersion: version, serviceIds: [serviceId, serviceId],
      stationIds: [stationId] }, key)).rejects.toThrow(TypeError);
    await expect(api.discardContractDraft(versionId, { expectedVersion: version, reason: "no" }, key)).rejects.toThrow(TypeError);
    await expect(api.discardContractDraft(versionId, { expectedVersion: version, reason: "x".repeat(501) }, key))
      .rejects.toThrow(TypeError);
    await expect(api.replyContractDraft(versionId, { expectedVersion: version, body: "x".repeat(2001) }, key))
      .rejects.toThrow(TypeError);
    await expect(api.commentAirlineContractDraft(versionId, { expectedVersion: version, body: "Hola" }, "not-a-key"))
      .rejects.toThrow(TypeError);
    await expect(api.submitManagedContractDraft(versionId, { expectedVersion: "?" }, key)).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });

  it("keeps the stable code of each readiness cause and expects the documented status", async () => {
    const problem = (code: string, status = 409) => new Response(JSON.stringify({ title: "Ignored title", status, code }),
      { status, headers: { "content-type": "application/problem+json" } });
    const { api } = client([problem("portal_account_missing"), problem("finance_reviewer_missing"),
      problem("service_in_package"), Response.json({ id: commentId }), Response.json({ id: contractId })]);
    for (const code of ["portal_account_missing", "finance_reviewer_missing"]) {
      const refused = await api.submitManagedContractDraft(versionId, { expectedVersion: version }, key).catch(error => error);
      expect(refused).toBeInstanceOf(ElevantApiError);
      expect(refused).toMatchObject({ status: 409, code });
    }
    await expect(api.setContractDraftScope(versionId, { expectedVersion: version, serviceIds: [serviceId],
      stationIds: [stationId] }, key)).rejects.toMatchObject({ status: 409, code: "service_in_package" });
    // A reply is created (201); a 200 or another resource is a malformed response.
    await expect(api.replyContractDraft(versionId, { expectedVersion: version, body: "Hola" }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.discardContractDraft(versionId, { expectedVersion: version, reason: "La aerolínea desistió." }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("registers every draft code once", () => {
    for (const code of ["invalid_draft", "draft_closed", "draft_in_finance_review", "portal_account_missing", "terms_missing",
      "services_missing", "rates_unconfirmed", "stations_missing", "service_retired", "package_not_eligible",
      "valid_from_not_after_current", "finance_reviewer_missing", "service_not_found", "service_in_package", "scope_invalid",
      "comment_required", "ambiguous_package_coverage", "package_service_not_in_contract", "invalid_contract_decision",
      "contract_terminated"])
      expect(ELEVANT_API_ERROR_CODES.filter(item => item === code)).toHaveLength(1);
  });
});
