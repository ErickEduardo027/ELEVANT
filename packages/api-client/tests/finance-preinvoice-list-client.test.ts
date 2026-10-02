import { expect, it } from "vitest";
import { createElevantApiClient, type FinancePreinvoicePageData } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const page: FinancePreinvoicePageData = { page: 1, limit: 20, hasMore: false,
  preinvoices: [{ id: "30000000-0000-7000-8000-000000000003",
    airlineId: "10000000-0000-7000-8000-000000000002", airlineName: "Synthetic Air",
    stationId, from: "2026-08-18", to: "2026-08-18", currencyCode: "USD",
    total: 42.0001, status: "Draft", lineCount: 1,
    createdAt: "2026-08-19T12:00:00Z" }] };

it("reads bounded Finance preinvoices for the selected station", async () => {
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
  await expect(client.getFinancePreinvoices({ stationId, page: 1, limit: 20 }))
    .resolves.toEqual(page);
  expect(urls).toEqual([`https://api.example.test/api/v1/finance/preinvoices?stationId=${stationId}&page=1&limit=20`]);
  await expect(client.getFinancePreinvoices({ stationId, limit: 51 }))
    .rejects.toBeInstanceOf(TypeError);
});

it("rejects cross-station and malformed Finance preinvoice pages", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...page, preinvoices: [{
      ...page.preinvoices[0], stationId: "20000000-0000-7000-8000-000000000004",
    }] }), { headers: { "content-type": "application/json" } }),
  });
  await expect(client.getFinancePreinvoices({ stationId }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
