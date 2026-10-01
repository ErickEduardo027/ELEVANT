import { expect, it } from "vitest";
import { createElevantApiClient, type ManagedContractPageData } from "../src";

const page: ManagedContractPageData = { page: 1, limit: 20, hasMore: false,
  contracts: [{ id: "60000000-0000-7000-8000-000000000001", code: "CTR-1",
    airline: "Synthetic Air", airlineCode: "SY", status: "Active",
    signedOn: null, terminatedOn: null,
    approvedVersions: [{ id: "61000000-0000-7000-8000-000000000001",
      versionNumber: 1, status: "Approved", validFrom: "2026-09-01", validTo: null,
      currencyCode: "USD", terms: null,
      stations: [{ id: "62000000-0000-7000-8000-000000000001", code: "PUJ",
        name: "Punta Cana" }],
      rates: [{ id: "63000000-0000-7000-8000-000000000001", serviceCode: "GPU",
        serviceName: "Unidad de potencia", billingUnit: "operation", unitPrice: 100.0001,
        minimumQuantity: 1 }] }] }] };

it("reads approved internal agreements with a bounded authenticated request", async () => {
  const urls: string[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "internal-token",
    fetch: async (url, init) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer internal-token");
      return new Response(JSON.stringify(page),
        { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.getManagedContracts({ page: 1, limit: 20 })).resolves.toEqual(page);
  expect(urls).toEqual(["https://api.example.test/api/v1/contracts/agreements?page=1&limit=20"]);
  await expect(client.getManagedContracts({ limit: 51 })).rejects.toBeInstanceOf(TypeError);
});

it("rejects draft versions and malformed agreement payloads", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...page,
      contracts: [{ ...page.contracts[0], approvedVersions: [{
        ...page.contracts[0]?.approvedVersions[0], status: "Draft",
      }] }] }), { headers: { "content-type": "application/json" } }),
  });
  await expect(client.getManagedContracts()).rejects.toMatchObject({ kind: "malformed-response" });
});

it("rejects a version without publication status", async () => {
  const { status: _status, ...withoutStatus } = page.contracts[0]!.approvedVersions[0]!;
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...page, contracts: [{
      ...page.contracts[0], approvedVersions: [withoutStatus],
    }] }), { headers: { "content-type": "application/json" } }),
  });
  await expect(client.getManagedContracts()).rejects.toMatchObject({ kind: "malformed-response" });
});
