import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  isFinancePendingOperationsResponse,
  isNoChargeClosureResponse,
  normalizedNoChargeClosure,
  normalizedPendingOperationsQuery,
} from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const airlineId = "50000000-0000-7000-8000-000000000006";
const operationId = "70000000-0000-7000-8000-000000000001";
const key = "10000000-0000-7000-8000-0000000000aa";

const operation = {
  operationId, version: "AAAAAAAAB9E=", operationCode: "DEV-TAT-0001", operationDate: "2026-11-02", airlineId,
  airlineName: "Demo Airlines", flightNumber: "DM101", contractCode: "DEV-CONTRACT-0001", currencyCode: "USD",
  serviceCount: 1, lineEstimate: 2, estimatedNet: 115, ready: true, blockingReasons: [] as string[],
  services: [{ serviceId: "71000000-0000-7000-8000-000000000001", serviceCode: "BAG", serviceName: "Equipaje", ready: true,
    blockingReason: null, amount: 100, chargeCount: 1 }],
};
const page = {
  stationId, limits: { maxOperations: 100, maxLines: 500, maxDays: 31 },
  airlines: [{ airlineId, airlineName: "Demo Airlines", pendingCount: 3 }], operations: [operation],
  nextCursor: "MjAyNi0xMS0wMnw3MDAw", totalPending: 3,
};

describe("«Por facturar» (phase 4, block A)", () => {
  it("normalizes the query and reads the page from the oldest with its limits", async () => {
    const urls: string[] = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async url => {
        urls.push(String(url));
        return new Response(JSON.stringify(page), { headers: { "content-type": "application/json" } });
      } });
    await expect(client.getFinancePendingOperations({ stationId, from: "2026-11-01", to: "", airlineId,
      cursor: "MjAyNi0xMS0wMnw3MDAw", limit: 25 })).resolves.toEqual(page);
    await client.getFinancePendingOperations({ stationId });
    expect(urls).toEqual([
      `https://api.example.test/api/v1/finance/invoicing/pending-operations?stationId=${stationId}&from=2026-11-01&airlineId=${airlineId}&cursor=MjAyNi0xMS0wMnw3MDAw&limit=25`,
      `https://api.example.test/api/v1/finance/invoicing/pending-operations?stationId=${stationId}`,
    ]);
    for (const query of [{ stationId: "PUJ" }, { stationId, from: "2026-11-31" }, { stationId, from: "2026-11-02", to: "2026-11-01" },
      { stationId, limit: 0 }, { stationId, limit: 101 }, { stationId, cursor: "a+b" }, { stationId, airlineId: "x" }])
      expect(normalizedPendingOperationsQuery(query)).toBeNull();
    await expect(client.getFinancePendingOperations({ stationId, limit: 500 })).rejects.toBeInstanceOf(TypeError);
    expect(urls).toHaveLength(2);
  });

  it("accepts only the exact page shape for the station", () => {
    expect(isFinancePendingOperationsResponse(page, stationId)).toBe(true);
    expect(isFinancePendingOperationsResponse({ ...page, nextCursor: null }, stationId)).toBe(true);
    expect(isFinancePendingOperationsResponse(page, "20000000-0000-7000-8000-000000000004")).toBe(false);
    expect(isFinancePendingOperationsResponse({ ...page, extra: 1 }, stationId)).toBe(false);
    expect(isFinancePendingOperationsResponse({ ...page, limits: { ...page.limits, maxPages: 1 } }, stationId)).toBe(false);
    expect(isFinancePendingOperationsResponse({ ...page, totalPending: 0 }, stationId)).toBe(false);
    const blocked = { ...operation, ready: false, blockingReasons: ["exchange_rate_missing"] };
    expect(isFinancePendingOperationsResponse({ ...page, operations: [blocked] }, stationId)).toBe(true);
    // Ready exactly when nothing blocks it; one entry per service; no extra keys anywhere.
    for (const wrong of [{ ...operation, ready: false }, { ...blocked, ready: true }, { ...operation, serviceCount: 2 },
      { ...operation, lineEstimate: 0 }, { ...operation, extra: true }, { ...operation, operationDate: "2026-02-30" },
      { ...operation, services: [{ ...operation.services[0], extra: 1 }] }, { ...operation, version: "" }])
      expect(isFinancePendingOperationsResponse({ ...page, operations: [wrong] }, stationId)).toBe(false);
    expect(isFinancePendingOperationsResponse({ ...page, operations: [operation, operation], totalPending: 3 }, stationId))
      .toBe(false);
  });

  it("closes operations without charge with the key of the intent and validates the answer", async () => {
    const calls: Array<{ url: string; key: string | null; body: unknown }> = [];
    let status = 201;
    let reply: unknown = { closureId: "60000000-0000-7000-8000-000000000001", operationIds: [operationId], replayed: false };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async (url, init) => {
        calls.push({ url: String(url), key: new Headers(init?.headers).get("idempotency-key"),
          body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
      } });
    const command = { stationId, operations: [{ operationId, version: "AAAAAAAAB9E=" }],
      reason: "  Servicios   incluidos sin tarifa " };
    await expect(client.closeOperationsWithoutCharge(command, key)).resolves.toEqual(reply);
    expect(calls).toEqual([{ url: "https://api.example.test/api/v1/finance/invoicing/no-charge-closures", key,
      body: { stationId, operations: [{ operationId, version: "AAAAAAAAB9E=" }], reason: "Servicios incluidos sin tarifa" } }]);
    status = 200;
    reply = { closureId: "60000000-0000-7000-8000-000000000001", operationIds: [operationId], replayed: true };
    await expect(client.closeOperationsWithoutCharge(command, key)).resolves.toMatchObject({ replayed: true });
    // A replay that says it is new, or another set of operations, is malformed.
    reply = { closureId: "60000000-0000-7000-8000-000000000001", operationIds: [operationId], replayed: false };
    await expect(client.closeOperationsWithoutCharge(command, key)).rejects.toMatchObject({ kind: "malformed-response" });
    expect(isNoChargeClosureResponse({ closureId: "60000000-0000-7000-8000-000000000001",
      operationIds: ["70000000-0000-7000-8000-000000000002"], replayed: false }, [operationId])).toBe(false);
    // Invalid commands never reach the network.
    for (const invalid of [{ ...command, reason: "Cero" }, { ...command, reason: "x".repeat(501) },
      { ...command, operations: [] }, { ...command, operations: [{ operationId, version: "" }] },
      { ...command, operations: [{ operationId, version: "A" }, { operationId, version: "B" }] }])
      expect(normalizedNoChargeClosure(invalid)).toBeNull();
    await expect(client.closeOperationsWithoutCharge(command, "not-a-key")).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(3);
  });

  it("keeps the code of a refused closure", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ title: "The operations cannot be invoiced as they stand.",
        status: 422, code: "operation_has_charge" }), { status: 422, headers: { "content-type": "application/problem+json" } }) });
    await expect(client.closeOperationsWithoutCharge({ stationId, operations: [{ operationId, version: "AAAAAAAAB9E=" }],
      reason: "Servicios incluidos" }, key)).rejects.toMatchObject({ status: 422, code: "operation_has_charge" });
  });
});
