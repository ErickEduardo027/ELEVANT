import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError, isFinanceHomeResponse, type FinanceHomeResponse } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";

const home: FinanceHomeResponse = {
  stationId,
  businessDate: "2026-10-31",
  toInvoice: { operations: 3, airlines: 2, oldestOperationDate: "2026-10-02" },
  invoicedThisMonth: [{ currencyCode: "USD", count: 2, amount: 236 }],
  receivables: [{ currencyCode: "USD", openInvoices: 2, open: 236, overdueInvoices: 1, overdue: 118 }],
  cardCollectionsThisMonth: [{ currencyCode: "DOP", count: 1, amount: 5900 }],
  pendingContractApprovals: 1,
  chartersAwaitingPrepayment: 0,
};

function client(reply: unknown, status = 200, calls: string[] = []) {
  return createElevantApiClient({
    baseUrl: "https://api.example.test",
    getAccessToken: () => "finance-token",
    fetch: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(reply), {
        status,
        headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
      });
    },
  });
}

describe("«Inicio» of Finance (4-A, 4-N02)", () => {
  it("reads the station's indicators at the business day", async () => {
    const calls: string[] = [];
    await expect(client(home, 200, calls).getFinanceHome(stationId)).resolves.toEqual(home);
    expect(calls).toEqual([`https://api.example.test/api/v1/finance/home?stationId=${stationId}`]);
  });

  it("accepts a section the template does not include as null, never as a missing key", async () => {
    const bare = { ...home, toInvoice: null, invoicedThisMonth: null, receivables: null, cardCollectionsThisMonth: null,
      pendingContractApprovals: null, chartersAwaitingPrepayment: null };
    await expect(client(bare).getFinanceHome(stationId)).resolves.toEqual(bare);
    expect(isFinanceHomeResponse({ ...home, toInvoice: { operations: 0, airlines: 0, oldestOperationDate: null } },
      stationId)).toBe(true);
    const { receivables: _receivables, ...missing } = home;
    expect(isFinanceHomeResponse(missing, stationId)).toBe(false);
  });

  it("rejects an unknown key, another station or impossible indicators", async () => {
    for (const reply of [
      { ...home, preinvoices: 0 },
      { ...home, stationId: "20000000-0000-7000-8000-000000000013" },
      { ...home, businessDate: "2026-02-30" },
      { ...home, toInvoice: { operations: 1, airlines: 0, oldestOperationDate: "2026-10-02" } },
      { ...home, toInvoice: { ...home.toInvoice, extra: true } },
      { ...home, invoicedThisMonth: [{ currencyCode: "EUR", count: 1, amount: 1 }] },
      { ...home, invoicedThisMonth: [{ currencyCode: "USD", count: 1, amount: 1 }, { currencyCode: "USD", count: 1, amount: 2 }] },
      { ...home, receivables: [{ currencyCode: "USD", openInvoices: 1, open: 10, overdueInvoices: 2, overdue: 10 }] },
      { ...home, receivables: [{ currencyCode: "USD", openInvoices: 1, open: 10, overdueInvoices: 1, overdue: 11 }] },
      { ...home, cardCollectionsThisMonth: [{ currencyCode: "USD", count: 1, amount: -1 }] },
      { ...home, pendingContractApprovals: 1.5 },
      { ...home, chartersAwaitingPrepayment: -1 },
    ])
      await expect(client(reply).getFinanceHome(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("validates the station before calling and keeps the server's code on a refusal", async () => {
    const calls: string[] = [];
    await expect(client(home, 200, calls).getFinanceHome("not-a-station")).rejects.toBeInstanceOf(TypeError);
    expect(calls).toEqual([]);
    const refusal = client({ status: 403, title: "The Finance home is forbidden in this station.", code: "forbidden" }, 403);
    const error = await refusal.getFinanceHome(stationId).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ElevantApiError);
    expect(error).toMatchObject({ kind: "http", status: 403, code: "forbidden" });
    const invalid = client({ status: 400, title: "The home query is invalid.", code: "invalid_finance_home_query" }, 400);
    await expect(invalid.getFinanceHome(stationId)).rejects.toMatchObject({ code: "invalid_finance_home_query" });
  });
});
