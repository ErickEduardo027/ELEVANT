import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  isOccIncident,
  isOccIncidentList,
  normalizedOccIncidentReport,
  normalizedOccIncidentStatus,
} from "../src";

// Phase 3, block D (3-G): OCC's incidents of an operation.
const operationId = "70000000-0000-7000-8000-000000000005";
const incidentId = "73000000-0000-7000-8000-000000000001";
const key = "22222222-2222-4222-8222-222222222222";
const at = "2026-11-08T14:00:00.000Z";
const incident = {
  id: incidentId, type: "Deviation", severity: "Medium", status: "Open", description: "Demora por la torre",
  occurredAt: at, reportedAt: at, delayCode: "87", reportedBy: "Alex Operations", reportedByKind: "Occ",
  resolutionNote: null, resolvedAt: null, resolvedBy: null, version: "AAAAAAAAB9E=",
  allowedStatuses: ["InReview", "Resolved"],
  history: [{ fromStatus: null, toStatus: "Open", note: "Reportada por OCC.", occurredAt: at, actor: "Alex Operations" }],
};
const list = { operationId, operationCode: "PUJ-20261108-001", operationStatus: "InProgress",
  ianaTimeZone: "America/Santo_Domingo", canReport: true, incidents: [incident] };

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function recorder(answer: () => Response) {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = createElevantApiClient({
    baseUrl: "https://api.example.test",
    getAccessToken: () => "occ-token",
    fetch: async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return answer();
    },
  });
  return { client, requests, header: (index: number, name: string) => new Headers(requests[index]!.init.headers).get(name) };
}

describe("OCC incidents client (3-G)", () => {
  it("validates every level strictly", () => {
    expect(isOccIncidentList(list, operationId)).toBe(true);
    expect(isOccIncidentList(list, "70000000-0000-7000-8000-000000000099")).toBe(false);
    expect(isOccIncidentList({ ...list, extra: true }, operationId)).toBe(false);
    expect(isOccIncident({ ...incident, extra: true })).toBe(false);
    expect(isOccIncident({ ...incident, history: [{ ...incident.history[0], by: "x" }] })).toBe(false);
    expect(isOccIncident({ ...incident, allowedStatuses: ["Open"] })).toBe(false);
    expect(isOccIncident({ ...incident, reportedByKind: "Airline" })).toBe(false);
    expect(isOccIncident({ ...incident, status: "Archived" })).toBe(false);
  });

  it("normalizes the report and the change before sending them", () => {
    expect(normalizedOccIncidentReport({ incidentType: "Safety", severity: "High", description: "  Derrame en la posición ",
      occurredAt: "2026-11-08T10:00:00-04:00" }))
      .toEqual({ incidentType: "Safety", severity: "High", description: "Derrame en la posición",
        occurredAt: "2026-11-08T14:00:00.000Z", delayCode: null });
    expect(normalizedOccIncidentReport({ incidentType: "Deviation", severity: "Low", description: "Demora por la torre",
      occurredAt: at })).toBeNull();
    expect(normalizedOccIncidentReport({ incidentType: "Safety", severity: "High", description: "Derrame en la posición",
      occurredAt: at, delayCode: "87" })).toBeNull();
    expect(normalizedOccIncidentReport({ incidentType: "Safety", severity: "High", description: "corta", occurredAt: at }))
      .toBeNull();
    expect(normalizedOccIncidentStatus({ status: "Resolved", note: "  Resuelta con la aerolínea " }))
      .toEqual({ status: "Resolved", note: "Resuelta con la aerolínea" });
    expect(normalizedOccIncidentStatus({ status: "Open" as never, note: "Volver a abrir" })).toBeNull();
    expect(normalizedOccIncidentStatus({ status: "Closed", note: "corta" })).toBeNull();
  });

  it("lists, reports with its key and changes with the version in If-Match", async () => {
    let answer: () => Response = () => json(list);
    const { client, requests, header } = recorder(() => answer());
    await expect(client.getOccOperationIncidents(operationId)).resolves.toEqual(list);
    expect(requests[0]!.url).toBe(`https://api.example.test/api/v1/occ/operations/${operationId}/incidents`);

    answer = () => json(incident, 201);
    await expect(client.reportOccIncident(operationId, { incidentType: "Deviation", severity: "Medium",
      description: "Demora por la torre", occurredAt: at, delayCode: "87" }, key)).resolves.toEqual(incident);
    expect(requests[1]!.init.method).toBe("POST");
    expect(header(1, "idempotency-key")).toBe(key);
    answer = () => json(incident, 200);
    await expect(client.reportOccIncident(operationId, { incidentType: "Deviation", severity: "Medium",
      description: "Demora por la torre", occurredAt: at, delayCode: "87" }, key)).resolves.toEqual(incident);

    answer = () => json({ ...incident, status: "Resolved" });
    await expect(client.changeOccIncidentStatus(incidentId, { status: "Resolved", note: "Resuelta con la aerolínea" },
      "AAAAAAAAB9E=", key)).resolves.toMatchObject({ status: "Resolved" });
    expect(requests[3]!.url).toBe(`https://api.example.test/api/v1/occ/incidents/${incidentId}/status`);
    expect([header(3, "if-match"), header(3, "idempotency-key")]).toEqual(['"AAAAAAAAB9E="', key]);
    await expect(client.changeOccIncidentStatus(incidentId, { status: "Resolved", note: "Resuelta con la aerolínea" },
      'bad"version', key)).rejects.toBeInstanceOf(TypeError);
    answer = () => json({ ...incident, id: "73000000-0000-7000-8000-000000000099" });
    await expect(client.changeOccIncidentStatus(incidentId, { status: "Resolved", note: "Resuelta con la aerolínea" },
      "AAAAAAAAB9E=", key)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("keeps the codes of the incident refusals", async () => {
    const { client } = recorder(() => json({ status: 412, title: "x", code: "version_conflict" }, 412,
      { "content-type": "application/problem+json" }));
    await expect(client.changeOccIncidentStatus(incidentId, { status: "Resolved", note: "Resuelta con la aerolínea" },
      "AAAAAAAAB9E=", key)).rejects.toMatchObject({ status: 412, code: "version_conflict" });
  });
});
