import { expect, it } from "vitest";
import { createElevantApiClient, type FinanceTariffPageData } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const page: FinanceTariffPageData = { stationId, page: 1, limit: 20,
  hasMore: false, tariffs: [{
    id: "30000000-0000-7000-8000-000000000003",
    contractId: "30000000-0000-7000-8000-000000000004",
    contractCode: "DEV-CONTRACT-0001",
    airlineId: "10000000-0000-7000-8000-000000000002",
    airlineName: "Synthetic Air", versionNumber: 1, versionStatus: "Approved",
    validFrom: "2026-01-01", validTo: null, currencyCode: "USD",
    serviceCode: "GPU", serviceName: "Ground power",
    billingUnit: "operation", unitPrice: 125.50, minimumQuantity: 1,
  }] };

it("reads only the requested Finance station and bounded published tariff page", async () => {
  const urls: string[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    getAccessToken: () => "finance-token",
    fetch: async (url, init) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer finance-token");
      return new Response(JSON.stringify(page),
        { headers: { "content-type": "application/json" } });
    },
  });
  await expect(client.getFinanceTariffs({ stationId, page: 1, limit: 20 }))
    .resolves.toEqual(page);
  expect(urls).toEqual([`https://api.example.test/api/v1/finance/tariffs?stationId=${stationId}&page=1&limit=20`]);
  await expect(client.getFinanceTariffs({ stationId, limit: 51 }))
    .rejects.toBeInstanceOf(TypeError);
});

it("fails closed on another station or malformed tariff", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...page,
      stationId: "20000000-0000-7000-8000-000000000004" }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(client.getFinanceTariffs({ stationId }))
    .rejects.toMatchObject({ kind: "malformed-response" });
  const malformed = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...page,
      tariffs: [{ ...page.tariffs[0], unitPrice: -1 }] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(malformed.getFinanceTariffs({ stationId }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
