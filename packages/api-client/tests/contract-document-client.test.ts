import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const versionId = "60000000-0000-7000-8000-000000000001";
const key = "a0000000-0000-7000-8000-000000000009";
const sha = "a".repeat(64);
// 1×1 PNG standing in for a drawn signature (ADR-0025).
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const validity = { renewalMode: "Automatic", renewalTermMonths: 12, renewalNoticeDays: 30, terminationNoticeDays: 60,
  terminationTerms: "Incumplimiento grave.", confirmedAt: "2026-11-03T12:00:00.000Z" };
const document = { contractId: "61000000-0000-7000-8000-000000000001", versionId, contractCode: "CT-001",
  contractStatus: "Active", airlineName: "Demo Air", airlineCode: "DM", airlineLegalName: null, versionNumber: 1,
  versionStatus: "Approved", validFrom: "2026-01-01", validTo: null, currencyCode: "USD", stations: ["PUJ · Punta Cana"],
  rates: [{ serviceCode: "RAMP", serviceName: "Rampa", billingUnit: "operación", unitPrice: 150, minimumQuantity: 1 }],
  terms: "Pago a 30 días.", signedOn: null, signatures: [], contentSha256: sha, signableBy: "Airline", validity };

describe("contract document client", () => {
  it("reads, signs with an idempotency key and downloads the PDF", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
    const answers = [Response.json(document), Response.json({ ...document, signableBy: null, signatures: [
      { party: "Airline", signerName: "Luis Marte", signerTitle: "Director", signedAt: "2026-10-26T12:00:00.000Z", documentSha256: sha,
        hasDrawnSignature: true }] }),
      new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]), { headers: { "content-type": "application/pdf" } })];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
    await expect(client.getContractDocument(versionId)).resolves.toMatchObject({ signableBy: "Airline" });
    await expect(client.signContractVersion(versionId, { signerName: " Luis Marte ", signerTitle: "Director",
      documentSha256: sha.toUpperCase(), accepted: true, signatureImagePng: "data:image/png;base64," + png }, key))
      .resolves.toMatchObject({ signableBy: null });
    expect((await client.downloadContractDocument(versionId)).type).toBe("application/pdf");
    expect(requests.map(item => [item.method, item.url])).toEqual([
      ["GET", `https://api.example.test/api/v1/contract-versions/${versionId}/document`],
      ["POST", `https://api.example.test/api/v1/contract-versions/${versionId}/signatures`],
      ["GET", `https://api.example.test/api/v1/contract-versions/${versionId}/document/pdf`],
    ]);
    expect(requests[1]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(requests[1]!.body)).toEqual({ signerName: "Luis Marte", signerTitle: "Director", documentSha256: sha,
      accepted: true, signatureImagePng: png });
  });

  it("confirms validity and renewal with the hash the form was built from", async () => {
    const requests: Array<{ method: string; url: string; body: string; headers: Headers }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ method: init?.method ?? "GET", url: String(input), body: String(init?.body ?? ""),
        headers: new Headers(init?.headers) });
      return Response.json({ ...document, validity: { ...validity, renewalMode: "Manual", renewalTermMonths: null } });
    } });
    await expect(client.setContractValidity(versionId, { validFrom: "2026-11-03", validTo: "2027-11-02",
      renewalMode: "Manual", renewalTermMonths: null, renewalNoticeDays: 30, terminationNoticeDays: 60,
      terminationTerms: "  ", expectedDocumentSha256: sha.toUpperCase() }, key))
      .resolves.toMatchObject({ validity: { renewalMode: "Manual" } });
    expect(requests[0]).toMatchObject({ method: "PUT",
      url: `https://api.example.test/api/v1/contract-versions/${versionId}/validity` });
    // The intent's key goes with the command, so a retry of the same body replays the first result.
    expect(requests[0]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(requests[0]!.body)).toEqual({ validFrom: "2026-11-03", validTo: "2027-11-02", renewalMode: "Manual",
      renewalTermMonths: null, renewalNoticeDays: 30, terminationNoticeDays: 60, terminationTerms: null,
      expectedDocumentSha256: sha });
    await expect(client.setContractValidity(versionId, { validFrom: "2026-11-03", validTo: "2027-11-02",
      renewalMode: "Automatic", renewalTermMonths: null, renewalNoticeDays: 30, terminationNoticeDays: 60,
      terminationTerms: null, expectedDocumentSha256: sha })).rejects.toThrow(TypeError);
    await expect(client.setContractValidity(versionId, { validFrom: "2026-11-03", validTo: "2027-11-02",
      renewalMode: "Manual", renewalTermMonths: null, renewalNoticeDays: 30, terminationNoticeDays: 60,
      terminationTerms: null, expectedDocumentSha256: sha }, "not-a-key")).rejects.toThrow(TypeError);
    expect(requests).toHaveLength(1);
    // An older caller without a key still works (expand).
    await client.setContractValidity(versionId, { validFrom: "2026-11-03", validTo: "2027-11-02",
      renewalMode: "Manual", renewalTermMonths: null, renewalNoticeDays: 30, terminationNoticeDays: 60,
      terminationTerms: null, expectedDocumentSha256: sha });
    expect(requests[1]!.headers.get("idempotency-key")).toBeNull();
  });

  it("withdraws an unsigned version with a reason, its hash and the intent's key (2-N10)", async () => {
    const draftVersionId = "60000000-0000-7000-8000-000000000002";
    const requests: Array<{ method: string; url: string; body: string; headers: Headers }> = [];
    const answers = [
      Response.json({ versionId, versionStatus: "Rejected", contractStatus: "Draft", draftVersionId }),
      Response.json({ versionId, versionStatus: "Rejected", contractStatus: "Active", draftVersionId: null, extra: 1 }),
      Response.json({ versionId, versionStatus: "Approved", contractStatus: "Active", draftVersionId: null }),
      Response.json({ versionId, versionStatus: "Rejected", contractStatus: "Active", draftVersionId: versionId }),
    ];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ method: init?.method ?? "GET", url: String(input), body: String(init?.body ?? ""),
        headers: new Headers(init?.headers) });
      return answers.shift()!;
    } });
    await expect(client.withdrawContractVersion(versionId, { reason: "  La vigencia quedó mal fijada.  ",
      expectedDocumentSha256: sha.toUpperCase() }, key)).resolves.toEqual({ versionId, versionStatus: "Rejected",
      contractStatus: "Draft", draftVersionId });
    expect(requests[0]).toMatchObject({ method: "POST",
      url: `https://api.example.test/api/v1/contract-versions/${versionId}/withdrawal` });
    expect(requests[0]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(requests[0]!.body)).toEqual({ reason: "La vigencia quedó mal fijada.", expectedDocumentSha256: sha });
    // Unknown keys, a version that is not withdrawn and a draft that is the same version are malformed.
    for (let index = 0; index < 3; index += 1)
      await expect(client.withdrawContractVersion(versionId, { reason: "Motivo válido", expectedDocumentSha256: sha },
        key)).rejects.toMatchObject({ kind: "malformed-response" });
    // A short reason or a missing hash never reaches the API.
    await expect(client.withdrawContractVersion(versionId, { reason: "no", expectedDocumentSha256: sha }, key))
      .rejects.toThrow(TypeError);
    await expect(client.withdrawContractVersion(versionId, { reason: "Motivo válido", expectedDocumentSha256: "x" }, key))
      .rejects.toThrow(TypeError);
    expect(requests).toHaveLength(4);
  });

  it("reads the surcharges and packages of a version and whether they are signed (2-N04)", async () => {
    const terms = { versionId, currencyCode: "USD", inDocument: true, signed: false,
      charges: [
        { chargeCode: "NIGHT", chargeName: "Recargo nocturno", method: "PercentOfService", billingUnit: null,
          quantityRule: "One", graceMinutes: 0, roundingIncrement: 0, isExcluded: false, value: 25, minimumAmount: 0 },
        { chargeCode: "WEEKEND", chargeName: "Fin de semana", method: "FixedAmount", billingUnit: "operation",
          quantityRule: "One", graceMinutes: 0, roundingIncrement: 0, isExcluded: true, value: null, minimumAmount: null },
      ],
      packages: [{ code: "TAT", name: "Escala completa", versionNumber: 2, scope: "Turnaround", flightDirection: null,
        periodDays: null, basePrice: 500, currencyCode: "USD", components: [{ serviceCode: "RAMP", serviceName: "Rampa",
          billingUnit: "operation", includedQuantity: 1, excessBlockSize: 1, excessBlockPrice: 120 }] }] };
    const urls: string[] = [];
    const answers = [Response.json(terms), Response.json({ ...terms, inDocument: false, signed: true }),
      Response.json({ ...terms, charges: [{ ...terms.charges[1], value: 10 }] }), Response.json({ ...terms, extra: true })];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async input => {
      urls.push(String(input));
      return answers.shift()!;
    } });
    await expect(client.getContractPricingTerms(versionId)).resolves.toEqual(terms);
    expect(urls[0]).toBe(`https://api.example.test/api/v1/contract-versions/${versionId}/pricing-terms`);
    // Signed content that is not in the document, an exempted surcharge with a value, unknown keys.
    for (let index = 0; index < 3; index += 1)
      await expect(client.getContractPricingTerms(versionId)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("downloads the watermarked draft PDF from its own route", async () => {
    const urls: string[] = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async input => {
      urls.push(String(input));
      return new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]), { headers: { "content-type": "application/pdf" } });
    } });
    expect((await client.downloadContractDraftPdf(versionId)).type).toBe("application/pdf");
    expect(urls).toEqual([`https://api.example.test/api/v1/contract-versions/${versionId}/draft/pdf`]);
    expect(() => client.downloadContractDraftPdf("not-a-uuid")).toThrow(TypeError);
  });

  it("refuses unaccepted signatures and unknown parties", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => Response.json({ ...document, signableBy: "Notary" }) });
    await expect(client.signContractVersion(versionId, { signerName: "Luis Marte", signerTitle: "Director",
      documentSha256: sha, accepted: false, signatureImagePng: png }, key)).rejects.toThrow(TypeError);
    await expect(client.signContractVersion(versionId, { signerName: "Luis Marte", signerTitle: "Director",
      documentSha256: sha, accepted: true, signatureImagePng: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" }, key))
      .rejects.toThrow(TypeError);
    await expect(client.getContractDocument(versionId)).rejects.toMatchObject({ kind: "malformed-response" });
  });
});

describe("airline permits and contract timeline", () => {
  const permit = { id: "63000000-0000-7000-8000-000000000001", airlineId: "20000000-0000-7000-8000-000000000001",
    airline: "Demo Airlines", kind: "OperatingPermit", number: "JAC-2026-002", issuer: "JAC", issuedOn: "2026-10-01",
    expiresOn: "2026-11-20", validity: "Expiring", review: "Submitted", reviewNote: null,
    documentUrl: "/api/v1/media/64000000-0000-7000-8000-000000000001", submittedAt: "2026-11-02T12:00:00.000Z",
    reviewedAt: null, version: "AAAAAAAAB9E=" };

  it("lists, uploads and submits permits with the bearer, and reads the timeline", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? "GET", body: init?.body });
        if (url.endsWith("/media")) return Response.json({ id: "64000000-0000-7000-8000-000000000001", url: permit.documentUrl });
        if (url.endsWith("/timeline")) return Response.json({ contractId: "61000000-0000-7000-8000-000000000001",
          contractCode: "CT-001", status: "Active", terminatesOn: null, earliestTerminationOn: "2026-12-02",
          entries: [{ at: "2026-11-02T12:00:00.000Z", kind: "status", title: "Contrato activo", detail: null, actor: null }] });
        return init?.method === "POST" ? Response.json(permit, { status: 201 }) : Response.json([permit]);
      } });

    await expect(client.getAirlinePermits()).resolves.toEqual([permit]);
    const url = await client.uploadAirlinePermitDocument(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    expect(calls[1]!.body).toBeInstanceOf(FormData);
    expect((calls[1]!.body as FormData).get("purpose")).toBe("airline-permit");
    await expect(client.submitAirlinePermit({ kind: "OperatingPermit", number: " JAC-2026-002 ", issuer: "JAC",
      issuedOn: "2026-10-01", expiresOn: "2026-11-20", documentUrl: url })).resolves.toEqual(permit);
    expect(JSON.parse(String(calls[2]!.body))).toMatchObject({ number: "JAC-2026-002", documentUrl: permit.documentUrl });
    await expect(client.getContractTimeline(versionId)).resolves.toMatchObject({ status: "Active",
      earliestTerminationOn: "2026-12-02" });
    expect(calls.map(call => call.url.replace("https://api.example.test/api/v1/", ""))).toEqual([
      "airline/permits", "media", "airline/permits", `contract-versions/${versionId}/timeline`]);
  });

  it("refuses inconsistent permits and unsupported files before calling the API", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
      fetch: async () => { throw new Error("must not be called"); } });
    await expect(client.submitAirlinePermit({ kind: "OperatingPermit", number: "X", issuer: "JAC",
      issuedOn: "2026-12-01", expiresOn: "2026-11-01", documentUrl: null })).rejects.toThrow(TypeError);
    await expect(client.uploadAirlinePermitDocument(new Blob(["x"], { type: "text/plain" }))).rejects.toThrow(TypeError);
  });
});

describe("contract timeline termination facts (2-N14)", () => {
  const timeline = { contractId: "61000000-0000-7000-8000-000000000001", contractCode: "CTR-2026-0001", status: "Active",
    terminatesOn: "2026-12-31", earliestTerminationOn: null,
    entries: [{ at: "2026-12-31T04:00:00.000Z", kind: "upcoming", title: "Terminación programada del contrato",
      detail: "Último día con cobertura: 30/12/2026", actor: null }] };

  it("accepts a scheduled termination and refuses unknown keys or both facts at once", async () => {
    const answers = [Response.json(timeline), Response.json({ ...timeline, earliestTerminationOn: "2027-01-30" }),
      Response.json({ ...timeline, entries: [{ ...timeline.entries[0], extra: 1 }] }),
      Response.json({ ...timeline, status: "Unknown" })];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async () => answers.shift()! });
    await expect(client.getContractTimeline(versionId)).resolves.toMatchObject({ terminatesOn: "2026-12-31" });
    for (let index = 0; index < 3; index += 1)
      await expect(client.getContractTimeline(versionId)).rejects.toMatchObject({ kind: "malformed-response" });
  });
});
