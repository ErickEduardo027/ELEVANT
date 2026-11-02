import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const versionId = "60000000-0000-7000-8000-000000000001";
const key = "a0000000-0000-7000-8000-000000000009";
const sha = "a".repeat(64);
const document = { contractId: "61000000-0000-7000-8000-000000000001", versionId, contractCode: "CT-001",
  contractStatus: "Active", airlineName: "Demo Air", airlineCode: "DM", airlineLegalName: null, versionNumber: 1,
  versionStatus: "Approved", validFrom: "2026-01-01", validTo: null, currencyCode: "USD", stations: ["PUJ · Punta Cana"],
  rates: [{ serviceCode: "RAMP", serviceName: "Rampa", billingUnit: "operación", unitPrice: 150, minimumQuantity: 1 }],
  terms: "Pago a 30 días.", signedOn: null, signatures: [], contentSha256: sha, signableBy: "Airline" };

describe("contract document client", () => {
  it("reads, signs with an idempotency key and downloads the PDF", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
    const answers = [Response.json(document), Response.json({ ...document, signableBy: null, signatures: [
      { party: "Airline", signerName: "Luis Marte", signerTitle: "Director", signedAt: "2026-10-26T12:00:00.000Z", documentSha256: sha }] }),
      new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]), { headers: { "content-type": "application/pdf" } })];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
    await expect(client.getContractDocument(versionId)).resolves.toMatchObject({ signableBy: "Airline" });
    await expect(client.signContractVersion(versionId, { signerName: " Luis Marte ", signerTitle: "Director",
      documentSha256: sha.toUpperCase(), accepted: true }, key)).resolves.toMatchObject({ signableBy: null });
    expect((await client.downloadContractDocument(versionId)).type).toBe("application/pdf");
    expect(requests.map(item => [item.method, item.url])).toEqual([
      ["GET", `https://api.example.test/api/v1/contract-versions/${versionId}/document`],
      ["POST", `https://api.example.test/api/v1/contract-versions/${versionId}/signatures`],
      ["GET", `https://api.example.test/api/v1/contract-versions/${versionId}/document/pdf`],
    ]);
    expect(requests[1]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(requests[1]!.body)).toEqual({ signerName: "Luis Marte", signerTitle: "Director", documentSha256: sha, accepted: true });
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
      documentSha256: sha, accepted: false }, key)).rejects.toThrow(TypeError);
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
        if (url.endsWith("/timeline")) return Response.json({ contractId: "c", contractCode: "CT-001", status: "Active",
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
    await expect(client.getContractTimeline(versionId)).resolves.toMatchObject({ status: "Active" });
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
