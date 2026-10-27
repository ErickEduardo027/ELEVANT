import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const stationId = "20000000-0000-7000-8000-000000000001";
const query = { stationId, from: "2026-08-01", to: "2026-08-31" };
const page = { key: "operations", title: "Operaciones del período", stationId, stationCode: "PUJ",
  from: query.from, to: query.to, asOf: "2026-10-26T12:00:00.000Z", columns: ["Fecha", "Operación"],
  rows: [[{ value: "18/08/2026", type: "text" }, { value: "OP-1", type: "text" }]], page: 1, limit: 25, hasMore: false };

describe("OCC reports client", () => {
  it("reads the catalog and a page and downloads a CSV with BOM", async () => {
    const urls: string[] = [];
    const answers: Response[] = [
      Response.json({ reports: [{ key: "operations", title: "Operaciones", description: "Detalle", columns: ["Fecha"] }], maxRangeDays: 366 }),
      Response.json(page),
      new Response(new Uint8Array([0xef, 0xbb, 0xbf, 70, 101, 99, 104, 97, 10]), { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } }),
    ];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async input => { urls.push(String(input)); return answers.shift()!; } });
    await expect(client.listOccReports()).resolves.toMatchObject({ maxRangeDays: 366 });
    await expect(client.getOccReport("operations", { ...query, page: 1, limit: 25 })).resolves.toMatchObject({ stationCode: "PUJ" });
    const blob = await client.exportOccReport("operations", query, "csv");
    expect(blob.type).toBe("text/csv");
    expect(urls[2]).toBe(`https://api.example.test/api/v1/occ/reports/operations/export?stationId=${stationId}&from=2026-08-01&to=2026-08-31&format=csv`);
  });

  it("rejects unknown reports, inverted periods and ragged rows", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => Response.json({ ...page, rows: [[{ value: "solo", type: "text" }]] }) });
    await expect(client.getOccReport("unknown" as "operations", query)).rejects.toThrow(TypeError);
    await expect(client.getOccReport("operations", { ...query, from: "2026-09-01" })).rejects.toThrow(TypeError);
    await expect(client.getOccReport("operations", query)).rejects.toMatchObject({ kind: "malformed-response" });
  });
});
