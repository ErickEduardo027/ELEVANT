import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const airlineId = "30000000-0000-7000-8000-000000000001";
const stationId = "20000000-0000-7000-8000-000000000003";
const catalog = { area: "Contratos", maxRangeDays: 366, reports: [{ key: "agreements", title: "Contratos y vigencias",
  description: "Contratos", columns: ["Aerolínea", "Tarifas"], columnTypes: ["text", "number"], period: "asOf",
  maxRangeDays: 366, asOfDate: true, filters: [{ key: "status", label: "Estado", parameter: "status", kind: "select",
    options: [{ code: "Active", label: "Activo" }] }] }] };
const page = { key: "agreements", title: "Contratos y vigencias", area: "Contratos", from: null, to: "2026-11-21",
  asOf: "2026-11-21T14:35:00+00:00", columns: ["Aerolínea", "Tarifas"], columnTypes: ["text", "number"],
  rows: [[{ value: "Arajet", type: "text" }, { value: "3", type: "number" }]], page: 1, limit: 50, hasMore: false,
  totalRows: 1, station: "Todas las aerolíneas", stationCode: null, stationName: null,
  appliedFilters: [{ label: "Estado", value: "Activo" }], summary: [{ label: "Contratos", value: "1", context: "de 1 aerolíneas" }],
  totals: [{ label: "Total", cells: [{ value: "Total", type: "text" }, { value: "3", type: "number" }] }], notes: [],
  generatedBy: "Ana Pérez" };
const pdf = () => new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]),
  { status: 200, headers: { "content-type": "application/pdf" } });

describe("tabular reports client (ADR-0048, «Reportes nuevos»)", () => {
  it("reads the Contratos catalog and a page and exports with the same filters", async () => {
    const urls: string[] = [];
    const answers = [Response.json(catalog), Response.json(page), pdf()];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async input => { urls.push(String(input)); return answers.shift()!; } });
    await expect(client.listContractReports()).resolves.toMatchObject({ area: "Contratos", maxRangeDays: 366 });
    await expect(client.getContractReport("agreements", { from: "2026-11-21", to: "2026-11-21", airlineId, status: "Active",
      stationId: "", page: 1, limit: 50 })).resolves.toMatchObject({ totalRows: 1, generatedBy: "Ana Pérez" });
    expect(urls[1]).toBe(`https://api.example.test/api/v1/contracts/reports/agreements?from=2026-11-21&to=2026-11-21&airlineId=${airlineId}&status=Active&page=1&limit=50`);
    const blob = await client.exportContractReport("agreements", { from: "2026-11-21", to: "2026-11-21", status: "Active",
      page: 2 }, "pdf");
    expect(blob.type).toBe("application/pdf");
    expect(urls[2]).toBe("https://api.example.test/api/v1/contracts/reports/agreements/export?from=2026-11-21&to=2026-11-21&status=Active&format=pdf");
  });

  it("refuses a filter of another area, a malformed id and an unknown key before any request", async () => {
    let calls = 0;
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => { calls += 1; return Response.json(page); } });
    await expect(client.getContractReport("agreements", { department: "finance" })).rejects.toThrow(TypeError);
    await expect(client.getAirlinePortalReport("invoices", { airlineId })).rejects.toThrow(TypeError);
    await expect(client.getContractReport("agreements", { airlineId: "arajet" })).rejects.toThrow(TypeError);
    await expect(client.getContractReport("../x", {})).rejects.toThrow(TypeError);
    await expect(client.getContractReport("agreements", { from: "2026-11-30", to: "2026-11-01" })).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("rejects an unknown field, a ragged row and another report's page", async () => {
    const answers = [Response.json({ ...page, secret: "x" }), Response.json({ ...page, rows: [[{ value: "solo", type: "text" }]] }),
      Response.json(page)];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async () => answers.shift()! });
    await expect(client.getContractReport("agreements", {})).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client.getContractReport("agreements", {})).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client.getContractReport("permits", {})).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("reads the portal and Gestión Humana reports on their own routes and keeps the problem codes", async () => {
    const urls: string[] = [];
    const problem = new Response(JSON.stringify({ status: 404, title: "x", code: "station_unavailable" }),
      { status: 404, headers: { "content-type": "application/problem+json" } });
    const answers = [Response.json({ ...page, key: "operations", area: "Portal de aerolíneas" }), problem,
      Response.json({ ...page, key: "staff-roster", area: "Gestión Humana" })];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async input => { urls.push(String(input)); return answers.shift()!; } });
    await client.getAirlinePortalReport("operations", { from: "2026-11-01", to: "2026-11-21", stationId });
    await expect(client.exportAirlinePortalReport("statement", { to: "2026-11-21", stationId }, "xlsx"))
      .rejects.toMatchObject({ status: 404, code: "station_unavailable" });
    await client.getHumanResourcesTableReport("staff-roster", { department: "finance", status: "Active" });
    expect(urls).toEqual([
      `https://api.example.test/api/v1/airline/portal/reports/operations?from=2026-11-01&to=2026-11-21&stationId=${stationId}`,
      `https://api.example.test/api/v1/airline/portal/reports/statement/export?to=2026-11-21&stationId=${stationId}&format=xlsx`,
      "https://api.example.test/api/v1/human-resources/table-reports/staff-roster?department=finance&status=Active",
    ]);
  });

  it("exports the statement of account with the filters of the screen", async () => {
    const urls: string[] = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async input => { urls.push(String(input)); return pdf(); } });
    await client.exportFinanceStatement({ asOf: "2026-11-21", airlineId, stationId }, "pdf");
    expect(urls[0]).toBe(`https://api.example.test/api/v1/finance/statements/export?format=pdf&asOf=2026-11-21&airlineId=${airlineId}&stationId=${stationId}`);
    expect(() => client.exportFinanceStatement({ asOf: "2026-11-21", airlineId: "x" }, "pdf")).toThrow(TypeError);
    // Without an airline: «Todas las aerolíneas», the consolidated statement.
    await client.exportFinanceStatement({ asOf: "2026-11-21", airlineId: null }, "pdf");
    await client.exportFinanceStatement({ asOf: "2026-11-21" }, "pdf");
    expect(urls.slice(1)).toEqual([
      "https://api.example.test/api/v1/finance/statements/export?format=pdf&asOf=2026-11-21",
      "https://api.example.test/api/v1/finance/statements/export?format=pdf&asOf=2026-11-21",
    ]);
  });
});
