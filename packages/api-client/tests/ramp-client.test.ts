import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  type RampAssignedOperationsResponse,
} from "../src";

const assignedOperations: RampAssignedOperationsResponse = {
  operations: [
    {
      assignment: {
        id: "70000000-0000-7000-8000-000000000018",
        agentId: "50000000-0000-7000-8000-000000000001",
        position: {
          id: "50000000-0000-7000-8000-000000000004",
          code: "RAMP-AGENT",
          name: "Ramp agent",
        },
        assignmentRole: "primary",
        assignedAt: "2026-08-19T12:00:00Z",
      },
      milestones: [{ code: "BLOCK_ON", actualAt: "2026-08-19T16:20:00Z" }],
      operation: {
        id: "70000000-0000-7000-8000-000000000016",
        status: "Assigned",
        plannedStartAt: "2026-08-19T12:15:00-04:00",
        plannedEndAt: "2026-08-19T14:30:00-04:00",
        actualStartAt: null,
        actualEndAt: null,
      },
      turnaround: {
        id: "70000000-0000-7000-8000-000000000012",
        operationCode: "DEV-TAT-0002",
        operationDate: "2026-08-19",
        status: "Confirmed",
        station: {
          id: "20000000-0000-7000-8000-000000000003",
          code: "PUJ",
          name: "AVIAM PUJ Development",
          ianaTimeZone: "America/Santo_Domingo",
        },
        airline: {
          id: "20000000-0000-7000-8000-000000000010",
          iataCode: "ZZ",
          icaoCode: "DZZ",
          name: "Demo Airlines",
        },
        aircraft: null,
        stand: null,
        arrival: null,
        departure: null,
      },
      services: [
        {
          id: "70000000-0000-7000-8000-000000000017",
          lineNumber: 1,
          serviceDefinitionId: "30000000-0000-7000-8000-000000000001",
          code: "BAGGAGE",
          name: "Baggage handling",
          contractedQuantity: 1,
          executedQuantity: 0,
          billingUnit: "operation",
          status: "Planned",
        },
      ],
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("ramp assigned operations API client", () => {
  it("uses one authenticated bodyless GET without client authority parameters", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody: BodyInit | null | undefined;
    let requestedHeaders = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      defaultHeaders: { "content-type": "application/json" },
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "";
        requestedBody = init?.body;
        requestedHeaders = new Headers(init?.headers);
        return jsonResponse(assignedOperations);
      },
    });

    await expect(client.getRampAssignedOperations()).resolves.toEqual(
      assignedOperations,
    );
    expect(requestedUrl).toBe("https://api.example.test/api/v1/ramp/operations");
    expect(requestedMethod).toBe("GET");
    expect(requestedBody).toBeUndefined();
    expect(requestedHeaders.get("authorization")).toBe("Bearer ramp-token");
    expect(requestedHeaders.has("content-type")).toBe(false);
  });

  it("accepts an explicit empty work queue and requests a fresh token per call", async () => {
    const authorization: Array<string | null> = [];
    let tokenNumber = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => `ramp-token-${++tokenNumber}`,
      fetch: async (_input, init) => {
        authorization.push(new Headers(init?.headers).get("authorization"));
        return jsonResponse({ operations: [] });
      },
    });

    await expect(client.getRampAssignedOperations()).resolves.toEqual({
      operations: [],
    });
    await client.getRampAssignedOperations();

    expect(authorization).toEqual(["Bearer ramp-token-1", "Bearer ramp-token-2"]);
  });

  it("rejects uncontracted fields instead of trusting client-side authority data", async () => {
    const malformed = deepClone(assignedOperations) as unknown as Record<string, unknown>;
    malformed.stationId = "20000000-0000-7000-8000-000000000099";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => jsonResponse(malformed),
    });

    await expect(client.getRampAssignedOperations()).rejects.toMatchObject({
      kind: "malformed-response",
      status: 200,
    });
  });

  it("rejects malformed nested identifiers and timestamps", async () => {
    const malformed = deepClone(assignedOperations);
    malformed.operations[0]!.assignment.agentId = "not-an-account-or-agent-id";
    malformed.operations[0]!.assignment.assignedAt = "not-a-timestamp";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => jsonResponse(malformed),
    });

    await expect(client.getRampAssignedOperations()).rejects.toMatchObject({
      kind: "malformed-response",
      status: 200,
    });
  });
});
