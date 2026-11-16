import { afterEach, expect, it, vi } from "vitest";
import { createAirlineTreasuryService } from "@/lib/airline-treasury-service";
afterEach(() => vi.unstubAllGlobals());
it("uses JWT GET requests with no caller-controlled tenant and preserves cutoff", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ invoices: [], receipts: [], movements: [], aging: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const api = createAirlineTreasuryService({ baseUrl: "https://api.example.test", getAccessToken: () => "synthetic-token" });
  const signal = new AbortController().signal;
  await api.getStatement("2026-10-18", "station-one", signal);
  expect(fetcher).toHaveBeenCalledWith("https://api.example.test/api/v1/airline/portal/treasury/statements?asOf=2026-10-18&stationId=station-one",
    expect.objectContaining({ method: "GET", signal, cache: "no-store", headers: expect.objectContaining({ Authorization: "Bearer synthetic-token" }) }));
  expect(Object.keys(api).sort()).toEqual(["getInvoice", "getNotes", "getReceipt", "getStatement"]);
});
it("requires the live token before any request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(createAirlineTreasuryService({ baseUrl: "https://api.example.test", getAccessToken: () => null }).getReceipt("foreign-receipt")).rejects.toMatchObject({ status: 401 });
  expect(fetcher).not.toHaveBeenCalled();
});
