import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  isOccReviewClose,
  isOccReviewReopenResponse,
  normalizedBillingExclusion,
  normalizedReopenReview,
  type OccReviewDetailResponse,
} from "../src";

// Phase 3, block D: the Service Order state (3-N02), the reopening (3-H), the billing exclusion (3-N11) and the
// optional Idempotency-Key of the decision and the adjustments.
const operationId = "70000000-0000-7000-8000-000000000005";
const submissionId = "85000000-0000-7000-8000-000000000022";
const reopenedId = "85000000-0000-7000-8000-000000000023";
const serviceId = "70000000-0000-7000-8000-000000000017";
const key = "11111111-1111-4111-8111-111111111111";
const etag = `"${"a".repeat(64)}"`;
const next = `"${"b".repeat(64)}"`;
const submittedAt = "2026-09-23T12:00:00.000Z";
const close = {
  milestones: [], charges: [], chargeOptions: [], canAdjustCharges: true, damageCount: 0,
  timing: { groundMinutes: 60, allowedGroundMinutes: 75, arrivalDelayMinutes: 0, aircraftCategory: "Narrowbody" },
};
const detail: OccReviewDetailResponse = {
  operationId, submissionId: reopenedId, revisionNumber: 2, status: "PendingReview",
  operationCode: "DEV-TAT-0002", operationDate: "2026-09-23", airlineName: "Demo Air", agentName: "Riley Ramp",
  submittedAt, stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
  ianaTimeZone: "America/Santo_Domingo", plannedStartAt: null, plannedEndAt: null, actualStartAt: submittedAt,
  actualEndAt: submittedAt, agentNote: null, checklistStatus: "Submitted", checklistAnswers: [],
  services: [{ id: serviceId, code: "GPU", name: "GPU", status: "Exception", contractedQuantity: 1,
    executedQuantity: 2, unit: "hour" }],
  incidents: [], decision: null, reviewVersion: etag,
  close: { ...close, billingExclusions: [{ serviceId, reason: "La GPU falló a la mitad", excludedAt: submittedAt }] },
  serviceOrderState: "Corrected",
  reopening: { fromRevisionNumber: 1, reason: "La aerolínea pidió revisar", reopenedAt: submittedAt,
    reopenedBy: "Alex Operations" },
};

function json(body: unknown, headers: HeadersInit = {}, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function recorder(answer: (input: string) => Response) {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = createElevantApiClient({
    baseUrl: "https://api.example.test",
    getAccessToken: () => "occ-token",
    fetch: async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return answer(String(input));
    },
  });
  const header = (index: number, name: string) => new Headers(requests[index]!.init.headers).get(name);
  return { client, requests, header };
}

describe("OCC review corrections (phase 3, block D)", () => {
  it("reads the Service Order state, the reopening and the billing exclusions, and refuses forged keys", async () => {
    let body: unknown = detail;
    const { client } = recorder(() => json(body, { etag }));
    await expect(client.getOccReviewDetail(operationId)).resolves.toEqual(detail);
    // An older server sends none of them.
    const { serviceOrderState: _state, reopening: _reopening, ...older } = detail;
    body = { ...older, close };
    await expect(client.getOccReviewDetail(operationId)).resolves.toMatchObject({ revisionNumber: 2 });
    body = { ...detail, serviceOrderState: "Approved" };
    await expect(client.getOccReviewDetail(operationId)).rejects.toMatchObject({ kind: "malformed-response" });
    body = { ...detail, reopening: { ...detail.reopening, extra: true } };
    await expect(client.getOccReviewDetail(operationId)).rejects.toMatchObject({ kind: "malformed-response" });
    expect(isOccReviewClose({ ...close, billingExclusions: [{ serviceId, reason: "x", excludedAt: submittedAt,
      by: "OCC" }] })).toBe(false);
    expect(isOccReviewClose({ ...close, billingExclusions: [{ serviceId: "nope", reason: "x", excludedAt: submittedAt }] }))
      .toBe(false);
  });

  it("sends the optional Idempotency-Key with the decision and the adjustments, and none when absent", async () => {
    const { client, header } = recorder(input => input.endsWith("/decision")
      ? json({ operationId, submissionId, status: "Approved", outcome: "Approved", decidedAt: submittedAt, reason: null })
      : json({ reviewVersion: next }, { etag: next }));
    await client.decideOccReview(operationId, { submissionId, outcome: "Approved" }, etag, { idempotencyKey: key });
    expect([header(0, "idempotency-key"), header(0, "if-match")]).toEqual([key, etag]);
    await client.decideOccReview(operationId, { submissionId, outcome: "Approved" }, etag);
    expect(header(1, "idempotency-key")).toBeNull();
    await client.addOccReviewCharge(operationId, { submissionId, serviceId, chargeId: serviceId,
      reason: "Cargo administrativo acordado" }, etag, { idempotencyKey: key });
    expect(header(2, "idempotency-key")).toBe(key);
    await expect(client.decideOccReview(operationId, { submissionId, outcome: "Approved" }, etag,
      { idempotencyKey: "not-a-key" })).rejects.toBeInstanceOf(TypeError);
  });

  it("excludes a service from billing with its key, version and reason", async () => {
    const { client, requests, header } = recorder(() => json({ reviewVersion: next }, { etag: next }));
    await expect(client.setOccReviewServiceBillingExclusion(operationId, serviceId,
      { submissionId, excluded: true, reason: "  La GPU falló a la mitad  " }, etag, key))
      .resolves.toEqual({ reviewVersion: next });
    expect(requests[0]!.url).toBe(
      `https://api.example.test/api/v1/occ/review/operations/${operationId}/services/${serviceId}/billing-exclusion`);
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({ submissionId, excluded: true,
      reason: "La GPU falló a la mitad" });
    expect([header(0, "idempotency-key"), header(0, "if-match")]).toEqual([key, etag]);
    await expect(client.setOccReviewServiceBillingExclusion(operationId, serviceId,
      { submissionId, excluded: true, reason: "corta" }, etag, key)).rejects.toBeInstanceOf(TypeError);
    expect(normalizedBillingExclusion({ submissionId, excluded: "yes" as unknown as boolean, reason: "Motivo válido" }))
      .toBeNull();
  });

  it("reopens an approval and checks the new revision's ETag", async () => {
    const reopened = { operationId, submissionId: reopenedId, revisionNumber: 2, status: "PendingReview",
      reviewVersion: next };
    let headers: HeadersInit = { etag: next };
    const { client, requests, header } = recorder(() => json(reopened, headers));
    await expect(client.reopenOccReview(operationId, { submissionId, reason: "  La aerolínea pidió revisar " }, etag,
      key)).resolves.toEqual(reopened);
    expect(requests[0]!.url).toBe(`https://api.example.test/api/v1/occ/review/operations/${operationId}/reopening`);
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({ submissionId, reason: "La aerolínea pidió revisar" });
    expect([header(0, "idempotency-key"), header(0, "if-match")]).toEqual([key, etag]);
    headers = { etag };
    await expect(client.reopenOccReview(operationId, { submissionId, reason: "La aerolínea pidió revisar" }, etag, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
    expect(isOccReviewReopenResponse({ ...reopened, status: "Approved" }, operationId)).toBe(false);
    expect(isOccReviewReopenResponse({ ...reopened, extra: 1 }, operationId)).toBe(false);
    expect(normalizedReopenReview({ submissionId, reason: "corta" })).toBeNull();
    expect(normalizedReopenReview({ submissionId, reason: "Texto con \u0007 control" })).toBeNull();
  });

  it("maps the coded refusals of the review to their code", async () => {
    const { client } = recorder(() => json({ status: 409, title: "x", code: "already_invoiced" }, {
      "content-type": "application/problem+json" }, 409));
    await expect(client.reopenOccReview(operationId, { submissionId, reason: "La aerolínea pidió revisar" }, etag, key))
      .rejects.toMatchObject({ status: 409, code: "already_invoiced" });
  });
});
