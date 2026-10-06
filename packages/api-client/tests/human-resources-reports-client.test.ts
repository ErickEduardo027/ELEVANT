import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const rowId = "50000000-0000-7000-8000-000000000001";
const query = { stationId, from: "2026-10-01", to: "2026-10-30", page: 1, limit: 20 };
const page = { ...query, hasMore: false, asOf: "2026-10-05T12:00:00Z",
  rows: [{ id: rowId, rampProfileId: rowId, agentName: "Agente de prueba",
    employeeNumber: "DEV-001", kind: "Qualification", code: "GPU",
    expiresOn: "2026-10-30" }] };

describe("G.H. verified reports API client", () => {
  it("rejects an unbounded query before network and reads a scoped typed page", async () => {
    let requests = 0;
    let path = "";
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "fresh-token",
      fetch: async (input, init) => {
        requests++;
        path = String(input);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fresh-token");
        return new Response(JSON.stringify(page), { status: 200,
          headers: { "content-type": "application/json" } });
      } });
    await expect(client.getHumanResourcesReport("expirations",
      { ...query, to: "2026-10-31" })).rejects.toThrow(TypeError);
    expect(requests).toBe(0);
    await expect(client.getHumanResourcesReport("expirations", query)).resolves.toEqual(page);
    expect(new URL(path).pathname).toBe("/api/v1/human-resources/reports/expirations");
  });

  it("rejects a cross-station or malformed page", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ ...page,
        stationId: "20000000-0000-7000-8000-000000000004" }),
      { status: 200, headers: { "content-type": "application/json" } }) });
    await expect(client.getHumanResourcesReport("expirations", query))
      .rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });

  it("accepts a coverage page for the requested interval", async () => {
    const coverage = { ...page, rows: [{ equipmentTypeId: rowId,
      equipmentCode: "GPU", equipmentName: "GPU de prueba",
      eligibleAgents: 2, qualifiedAgents: 1 }] };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify(coverage), { status: 200,
        headers: { "content-type": "application/json" } }) });
    await expect(client.getHumanResourcesReport("qualification-coverage", query))
      .resolves.toEqual(coverage);
  });

  it("passes expiration filters to reads and exports and rejects invalid filters", async () => {
    const paths: string[] = [];
    const filtered = { ...page, documentKind: "Qualification", validity: "Current" };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async input => {
        paths.push(String(input));
        return paths.length === 1
          ? new Response(JSON.stringify(filtered), { status: 200,
            headers: { "content-type": "application/json" } })
          : new Response(new TextEncoder().encode("%PDF-1.7\nreport"), { status: 200,
            headers: { "content-type": "application/pdf" } });
      } });
    const filters = { stationId, from: query.from, to: query.to,
      documentKind: "Qualification" as const, validity: "Current" as const };
    await expect(client.getHumanResourcesReport("expirations", filters))
      .resolves.toEqual(filtered);
    await expect(client.exportHumanResourcesReport("expirations", filters, "pdf"))
      .resolves.toBeInstanceOf(Blob);
    for (const path of paths) {
      expect(new URL(path).searchParams.get("documentKind")).toBe("Qualification");
      expect(new URL(path).searchParams.get("validity")).toBe("Current");
    }
    await expect(client.getHumanResourcesReport("expirations",
      { ...filters, validity: "Invented" as "Current" }))
      .rejects.toThrow(TypeError);
    await expect(client.getHumanResourcesReport("staff-distribution", filters))
      .rejects.toThrow(TypeError);
    expect(paths).toHaveLength(2);
  });

  it("downloads a real PDF but rejects a JSON body on a success response", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nreport");
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(bytes, { status: 200,
        headers: { "content-type": "application/pdf" } }) });
    const exportQuery = { stationId, from: query.from, to: query.to };
    const document = await client.exportHumanResourcesReport("expirations", exportQuery, "pdf");
    expect(document.type).toBe("application/pdf");
    expect((await document.text()).startsWith("%PDF-")).toBe(true);
    const malformed = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response("{}", { status: 200,
        headers: { "content-type": "application/json" } }) });
    await expect(malformed.exportHumanResourcesReport("expirations", exportQuery, "pdf"))
      .rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });
});
