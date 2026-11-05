import { describe, expect, it } from "vitest";
import { createElevantApiClient, isOccReviewClose } from "../src";

const operationId = "70000000-0000-7000-8000-000000000012";
const submissionId = "71000000-0000-7000-8000-000000000001";
const serviceId = "72000000-0000-7000-8000-000000000001";
const chargeId = "73000000-0000-7000-8000-000000000001";
const markId = "74000000-0000-7000-8000-000000000001";
const etag = `"${"a".repeat(64)}"`;
const next = `"${"b".repeat(64)}"`;

const close = {
  milestones: [{ code: "BLOCK_ON", actualAt: "2026-11-05T14:00:00Z" }],
  charges: [{ markId, serviceId, serviceCode: "BAGGAGE", chargeId, code: "NIGHT", name: "Recargo nocturno",
    source: "Automatic", appliedAt: "2026-11-05T15:00:00Z", reason: null }],
  chargeOptions: [{ chargeId, code: "NIGHT", name: "Recargo nocturno", appliesToAllServices: true, serviceIds: [serviceId] }],
  timing: { groundMinutes: 91, allowedGroundMinutes: 75, arrivalDelayMinutes: 12, aircraftCategory: "Narrowbody" },
  canAdjustCharges: true,
  damageCount: 0,
};

describe("Operational close client (ADR-0034)", () => {
  it("validates the close block OCC reviews with", () => {
    expect(isOccReviewClose(close)).toBe(true);
    expect(isOccReviewClose({ ...close, charges: [{ ...close.charges[0], source: "Robot" }] })).toBe(false);
    expect(isOccReviewClose({ ...close, timing: { ...close.timing, aircraftCategory: "Jumbo" } })).toBe(false);
  });

  it("adjusts a charge with the review version and a reason", async () => {
    const requests: Array<{ url: string; headers: Headers; body: string }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input).replace("https://api.example.test", ""), headers: new Headers(init?.headers),
        body: String(init?.body ?? "") });
      return Response.json({ reviewVersion: next });
    } });
    await expect(client.addOccReviewCharge(operationId,
      { submissionId, serviceId, chargeId, reason: "  Llegó de noche según torre  " }, etag))
      .resolves.toEqual({ reviewVersion: next });
    await client.removeOccReviewCharge(operationId, markId, { submissionId, reason: "No aplica: fue de día" }, next);
    expect(requests.map(item => item.url)).toEqual([
      `/api/v1/occ/review/operations/${operationId}/charges`,
      `/api/v1/occ/review/operations/${operationId}/charges/${markId}/removal`,
    ]);
    expect(requests[0]!.headers.get("if-match")).toBe(etag);
    expect(JSON.parse(requests[0]!.body).reason).toBe("Llegó de noche según torre");
    await expect(client.addOccReviewCharge(operationId, { submissionId, serviceId, chargeId, reason: "corto" }, etag))
      .rejects.toThrow(TypeError);
  });

  it("reads and changes Finance's close rules", async () => {
    const allowance = { category: "Narrowbody", allowedMinutes: 80, updatedAt: "2026-11-05T15:00:00Z", version: "00000000000007d1" };
    const holiday = { id: "75000000-0000-7000-8000-000000000001", date: "2026-11-06", name: "Día de la Constitución" };
    const calls: string[] = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      calls.push(`${init?.method} ${String(input).replace("https://api.example.test", "")}`);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "PUT") return Response.json(allowance);
      if (init?.method === "POST") return Response.json(holiday);
      return Response.json({ allowances: [allowance], holidays: [holiday] });
    } });
    await expect(client.getFinanceCloseRules()).resolves.toMatchObject({ holidays: [{ date: "2026-11-06" }] });
    await client.setGroundTimeAllowance("Narrowbody", { allowedMinutes: 80, version: "00000000000007d0" });
    await client.addFinanceHoliday({ date: "2026-11-06", name: "  Día de la   Constitución " });
    await client.removeFinanceHoliday(holiday.id);
    expect(calls).toEqual([
      "GET /api/v1/finance/close-rules",
      "PUT /api/v1/finance/close-rules/ground-time/Narrowbody",
      "POST /api/v1/finance/close-rules/holidays",
      `DELETE /api/v1/finance/close-rules/holidays/${holiday.id}`,
    ]);
    await expect(client.setGroundTimeAllowance("Narrowbody", { allowedMinutes: 10, version: null })).rejects.toThrow(TypeError);
    await expect(client.addFinanceHoliday({ date: "2026-02-30", name: "Inventado" })).rejects.toThrow(TypeError);
  });
});
