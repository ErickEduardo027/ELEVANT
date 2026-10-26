import { expect, it } from "vitest";
import { createElevantApiClient, type ContractSigningResponse } from "../src";

const contractId = "60000000-0000-7000-8000-000000000001";
const versionId = "60000000-0000-7000-8000-000000000002";
const pdf = new TextEncoder().encode("%PDF-1.7\nsynthetic test document\n%%EOF");
const signing: ContractSigningResponse = {
  contractId, versionId, contractCode: "DEV-1", airlineName: "Synthetic Air",
  versionStatus: "Approved", signingStatus: "AwaitingAirline",
  requiresElectronicSigning: true,
};

it("uses bearer authorization for tenant status and an explicit signing link", async () => {
  const calls: string[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "airline-token",
    fetch: async (url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer airline-token");
      calls.push(String(url));
      return new Response(JSON.stringify(String(url).endsWith("signing-link")
        ? { url: "https://secure.adobesign.com/sign/opaque" } : signing),
      { headers: { "content-type": "application/json" } });
    } });
  expect((await client.getAirlineContractSigning(contractId)).signingStatus).toBe("AwaitingAirline");
  expect((await client.getAirlineContractSigningLink(contractId)).url).toContain("adobesign.com");
  expect(calls).toEqual([
    `https://api.example.test/api/v1/airline/portal/contracts/${contractId}/signing`,
    `https://api.example.test/api/v1/airline/portal/contracts/${contractId}/signing-link`,
  ]);
});

it("validates signed and preview PDFs before showing them", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "internal-token",
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return new Response(pdf, { headers: { "content-type": "application/pdf" } });
    } });
  expect((await client.previewContractSigningPdf(versionId)).type).toBe("application/pdf");
  expect((await client.getManagedSignedContractPdf(versionId)).size).toBe(pdf.length);
  expect(calls).toEqual([
    { url: `https://api.example.test/api/v1/contracts/signing/${versionId}/preview`, method: "POST" },
    { url: `https://api.example.test/api/v1/contracts/signing/${versionId}/document`, method: "GET" },
  ]);
  const invalid = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response("<html>login</html>",
      { headers: { "content-type": "application/pdf" } }) });
  await expect(invalid.getAirlineSignedContractPdf(contractId))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
