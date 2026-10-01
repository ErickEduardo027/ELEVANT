import { expect, it } from "vitest";
import { createElevantApiClient, type FinanceReconciliationPageData } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const page: FinanceReconciliationPageData = { stationId, page: 1, limit: 20,
  hasMore: false, rows: [{
    preinvoiceId: "30000000-0000-7000-8000-000000000001",
    airlineId: "10000000-0000-7000-8000-000000000002",
    airlineName: "Synthetic Air", from: "2026-08-18", to: "2026-08-18",
    currencyCode: "USD", preinvoiceTotal: 125.50, preinvoiceStatus: "Invoiced",
    invoiceId: "30000000-0000-7000-8000-000000000002",
    invoiceNumber: "NF-TEST", invoiceTotal: 125.50,
    issuedAt: "2026-08-19T12:00:00Z",
    paymentId: "30000000-0000-7000-8000-000000000003",
    paymentReference: "DEV-PAY-TEST", paymentAmount: 125.50,
    paymentRecordedAt: "2026-08-19T13:00:00Z",
  }] };

it("reads a bounded Finance lifecycle page for an explicit station", async () => {
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
  await expect(client.getFinanceReconciliation({ stationId, page: 1, limit: 20 }))
    .resolves.toEqual(page);
  expect(urls).toEqual([`https://api.example.test/api/v1/finance/reconciliation?stationId=${stationId}&page=1&limit=20`]);
  await expect(client.getFinanceReconciliation({ stationId, limit: 51 }))
    .rejects.toBeInstanceOf(TypeError);
});

it("rejects wrong-station and inconsistent invoice/payment responses", async () => {
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...page,
      stationId: "20000000-0000-7000-8000-000000000004" }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(client.getFinanceReconciliation({ stationId }))
    .rejects.toMatchObject({ kind: "malformed-response" });
  const malformed = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async () => new Response(JSON.stringify({ ...page,
      rows: [{ ...page.rows[0], invoiceId: null }] }),
    { headers: { "content-type": "application/json" } }),
  });
  await expect(malformed.getFinanceReconciliation({ stationId }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
