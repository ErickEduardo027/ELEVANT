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
