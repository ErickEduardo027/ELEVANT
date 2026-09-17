import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  type OccPlanningOptionsResponse,
  type OccPlanningSnapshotResponse,
} from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const turnaroundId = "70000000-0000-7000-8000-000000000012";

const station = {
  id: stationId,
  code: "PUJ",
  name: "AVIAM PUJ Development",
  ianaTimeZone: "America/Santo_Domingo",
};

const snapshot: OccPlanningSnapshotResponse = {
  station,
  date: "2026-08-19",
  turnarounds: [
    {
      id: turnaroundId,
      operationCode: "DEV-TAT-0002",
      operationDate: "2026-08-19",
      status: "Confirmed",
      airline: {
        id: "20000000-0000-7000-8000-000000000010",
        iataCode: "ZZ",
        icaoCode: "DZZ",
        name: "Demo Airlines",
      },
      aircraft: {
        id: "20000000-0000-7000-8000-000000000020",
        icaoCode: "A320",
        iataCode: "320",
        manufacturer: "Airbus",
        model: "A320-200",
        registration: "HI-DEV",
      },
      stand: {
        id: "20000000-0000-7000-8000-000000000030",
        code: "A02",
        terminal: {
          id: "20000000-0000-7000-8000-000000000031",
          code: "A",
          name: "Terminal A",
        },
      },
      arrival: {
        id: "70000000-0000-7000-8000-000000000021",
        flightNumber: "ZZ102",
        origin: {
          id: "20000000-0000-7000-8000-000000000041",
          iataCode: "SDQ",
          icaoCode: "MDSD",
          name: "Las Americas",
        },
        destination: {
          id: "20000000-0000-7000-8000-000000000042",
          iataCode: "PUJ",
          icaoCode: "MDPC",
          name: "Punta Cana",
        },
        scheduledAt: "2026-08-19T12:15:00-04:00",
        estimatedAt: "2026-08-19T12:20:00-04:00",
        actualAt: "2026-08-19T12:22:00-04:00",
      },
      departure: {
        id: "70000000-0000-7000-8000-000000000022",
        flightNumber: "ZZ103",
        origin: {
          id: "20000000-0000-7000-8000-000000000042",
          iataCode: "PUJ",
          icaoCode: "MDPC",
          name: "Punta Cana",
        },
        destination: {
          id: "20000000-0000-7000-8000-000000000043",
          iataCode: "JFK",
          icaoCode: "KJFK",
          name: "John F. Kennedy",
        },
        scheduledAt: "2026-08-19T14:00:00Z",
      },
      operation: {
        id: "70000000-0000-7000-8000-000000000023",
        status: "Planned",
        plannedStartAt: "2026-08-19T12:30:00-04:00",
        plannedEndAt: "2026-08-19T13:45:00-04:00",
        actualStartAt: "2026-08-19T12:32:00-04:00",
        actualEndAt: "2026-08-19T13:40:00-04:00",
      },
      agents: [
        {
          assignmentId: "70000000-0000-7000-8000-000000000031",
          agentId: "50000000-0000-7000-8000-000000000001",
          displayName: "Riley Ramp",
          employeeNumber: "DEV-RA-001",
          positionId: "50000000-0000-7000-8000-000000000011",
          positionCode: "RAMP",
          positionName: "Ramp Agent",
          assignmentRole: "Primary",
          assignedAt: "2026-08-19T11:45:00.1234567-04:00",
        },
      ],
      equipment: [
        {
          assignmentId: "70000000-0000-7000-8000-000000000041",
          equipmentId: "60000000-0000-7000-8000-000000000001",
          assetCode: "GPU-DEV-01",
          equipmentTypeId: "60000000-0000-7000-8000-000000000011",
          equipmentTypeCode: "GPU",
          equipmentTypeName: "Ground power unit",
          status: "Available",
          assignedAt: "2026-08-19T11:46:00-04:00",
        },
      ],
      services: [
        {
          id: "70000000-0000-7000-8000-000000000051",
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

const planningOptions: OccPlanningOptionsResponse = {
  turnaround: {
    id: turnaroundId,
    operationCode: "DEV-TAT-0002",
    operationDate: "2026-08-19",
    station,
    stand: snapshot.turnarounds[0]!.stand!,
    referenceTime: "2026-08-19T12:15:00-04:00",
  },
  contract: {
    id: "30000000-0000-7000-8000-000000000010",
    code: "DEV-CONTRACT-01",
    version: 1,
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    currencyCode: "USD",
  },
  services: [
    {
      id: "30000000-0000-7000-8000-000000000020",
      serviceDefinitionId: "30000000-0000-7000-8000-000000000001",
      code: "BAGGAGE",
      name: "Baggage handling",
      billingUnit: "operation",
      minimumQuantity: 1,
      unitPrice: 125.5,
      currencyCode: "USD",
    },
  ],
  agents: [
    {
      id: "50000000-0000-7000-8000-000000000001",
      displayName: "Riley Ramp",
      employeeNumber: "DEV-RA-001",
      eligible: false,
      eligibilityReasons: ["shift_not_compatible"],
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

describe("OCC planning API client", () => {
  it("requests the snapshot without query parameters as an authenticated bodyless GET", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody: BodyInit | null | undefined;
    let requestedHeaders = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      defaultHeaders: { "content-type": "application/json" },
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "";
        requestedBody = init?.body;
        requestedHeaders = new Headers(init?.headers);
        return jsonResponse(snapshot);
      },
    });

    await expect(client.getOccPlanningSnapshot()).resolves.toEqual(snapshot);
    expect(requestedUrl).toBe("https://api.example.test/api/v1/occ/planning");
    expect(requestedMethod).toBe("GET");
    expect(requestedBody).toBeUndefined();
    expect(requestedHeaders.get("authorization")).toBe("Bearer occ-token");
    expect(requestedHeaders.has("content-type")).toBe(false);
  });

  it("whitelists and serializes snapshot query parameters deterministically", async () => {
    const urls: string[] = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async (input) => {
        urls.push(String(input));
        return jsonResponse(snapshot);
      },
    });

    await client.getOccPlanningSnapshot({ date: "2026-08-19" });
    await client.getOccPlanningSnapshot({
      stationId,
      date: "2026-08-19",
      ignoredAtRuntime: "must-not-be-forwarded",
    } as never);

    expect(urls).toEqual([
      "https://api.example.test/api/v1/occ/planning?date=2026-08-19",
      `https://api.example.test/api/v1/occ/planning?stationId=${stationId}&date=2026-08-19`,
    ]);
  });

  it("requests options by turnaround with a fresh token on each OCC call", async () => {
    const authorization: Array<string | null> = [];
    const urls: string[] = [];
    let tokenNumber = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: async () => `occ-token-${++tokenNumber}`,
      fetch: async (input, init) => {
        urls.push(String(input));
        authorization.push(new Headers(init?.headers).get("authorization"));
        return urls.length === 1
          ? jsonResponse(snapshot)
          : jsonResponse(planningOptions);
      },
    });

    await client.getOccPlanningSnapshot({ stationId, date: "2026-08-19" });
    await expect(client.getOccPlanningOptions(turnaroundId)).resolves.toEqual(
      planningOptions,
    );

    expect(urls[1]).toBe(
      `https://api.example.test/api/v1/occ/planning/options?turnaroundId=${turnaroundId}`,
    );
    expect(authorization).toEqual(["Bearer occ-token-1", "Bearer occ-token-2"]);
  });

  it.each([
    [null, "object"],
    [{ stationId: "not-a-uuid" }, "stationId"],
    [{ stationId: "00000000-0000-0000-0000-000000000000" }, "stationId"],
    [{ date: "2026-02-30" }, "date"],
    [{ date: "2026-08-19&admin=true" }, "date"],
  ])("rejects unsafe snapshot parameters %#", async (parameters, message) => {
    let requestCount = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => {
        requestCount += 1;
        return jsonResponse(snapshot);
      },
    });

    await expect(
      client.getOccPlanningSnapshot(parameters as never),
    ).rejects.toThrow(message);
    expect(requestCount).toBe(0);
  });

  it.each(["", "not-a-uuid", "00000000-0000-0000-0000-000000000000"])(
    "rejects unsafe turnaround id %j before fetching",
    async (value) => {
      let requestCount = 0;
      const client = createElevantApiClient({
        baseUrl: "https://api.example.test",
        fetch: async () => {
          requestCount += 1;
          return jsonResponse(planningOptions);
        },
      });

      await expect(client.getOccPlanningOptions(value)).rejects.toThrow(
        "turnaroundId",
      );
      expect(requestCount).toBe(0);
    },
  );

  it("preserves the caller signal and AbortError for an OCC request", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    let observedSignal: AbortSignal | null | undefined;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async (_input, init) => {
        observedSignal = init?.signal;
        throw abortError;
      },
    });

    await expect(
      client.getOccPlanningOptions(turnaroundId, { signal: controller.signal }),
    ).rejects.toBe(abortError);
    expect(observedSignal).toBe(controller.signal);
  });

  it("accepts the API's nullable OCC branches and empty projections", async () => {
    const minimalSnapshot: OccPlanningSnapshotResponse = {
      station,
      date: "2026-08-19",
      turnarounds: [
        {
          id: turnaroundId,
          operationCode: "DEV-TAT-0002",
          operationDate: "2026-08-19",
          status: "Confirmed",
          airline: snapshot.turnarounds[0]!.airline,
          aircraft: null,
          stand: null,
          arrival: null,
          departure: null,
          operation: null,
          agents: [],
          equipment: [],
          services: [],
        },
      ],
    };
    const minimalOptions: OccPlanningOptionsResponse = {
      turnaround: {
        id: turnaroundId,
        operationCode: "DEV-TAT-0002",
        operationDate: "2026-08-19",
        station,
        stand: null,
        referenceTime: "2026-08-19T12:15:00-04:00",
      },
      contract: null,
      services: [],
      agents: [],
    };
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async () =>
        ++calls === 1 ? jsonResponse(minimalSnapshot) : jsonResponse(minimalOptions),
    });

    await expect(client.getOccPlanningSnapshot()).resolves.toEqual(minimalSnapshot);
    await expect(client.getOccPlanningOptions(turnaroundId)).resolves.toEqual(
      minimalOptions,
    );
  });

  it("accepts empty strings where OpenAPI does not declare a minimum length", async () => {
    const contractCompatibleSnapshot = deepClone(snapshot);
    contractCompatibleSnapshot.station.code = "";
    contractCompatibleSnapshot.turnarounds[0]!.aircraft!.registration = "";
    const contractCompatibleOptions = deepClone(planningOptions);
    contractCompatibleOptions.agents[0]!.eligibilityReasons = [""];
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async () =>
        ++calls === 1
          ? jsonResponse(contractCompatibleSnapshot)
          : jsonResponse(contractCompatibleOptions),
    });

    await expect(client.getOccPlanningSnapshot()).resolves.toEqual(
      contractCompatibleSnapshot,
    );
    await expect(client.getOccPlanningOptions(turnaroundId)).resolves.toEqual(
      contractCompatibleOptions,
    );
  });

  it.each([
    ["station UUID", () => ({ ...deepClone(snapshot), station: { ...station, id: "bad" } })],
    ["calendar date", () => ({ ...deepClone(snapshot), date: "2026-02-30" })],
    [
      "timestamp without offset",
      () => {
        const value = deepClone(snapshot);
        if (value.turnarounds[0]?.arrival) {
          value.turnarounds[0].arrival.scheduledAt = "2026-08-19T12:15:00";
        }
        return value;
      },
    ],
    [
      "impossible timestamp date",
      () => {
        const value = deepClone(snapshot);
        value.turnarounds[0]!.arrival!.scheduledAt = "2026-02-30T12:15:00Z";
        return value;
      },
    ],
    [
      "timestamp with a space separator",
      () => {
        const value = deepClone(snapshot);
        value.turnarounds[0]!.arrival!.scheduledAt = "2026-08-19 12:15:00Z";
        return value;
      },
    ],
    [
      "timestamp without seconds",
      () => {
        const value = deepClone(snapshot);
        value.turnarounds[0]!.arrival!.scheduledAt = "2026-08-19T12:15Z";
        return value;
      },
    ],
    [
      "integer",
      () => {
        const value = deepClone(snapshot);
        if (value.turnarounds[0]?.services[0]) {
          value.turnarounds[0].services[0].lineNumber = 1.5;
        }
        return value;
      },
    ],
    [
      "int32 overflow",
      () => {
        const value = deepClone(snapshot);
        value.turnarounds[0]!.services[0]!.lineNumber = 2_147_483_648;
        return value;
      },
    ],
    [
      "missing required nested property",
      () => {
        const value = deepClone(snapshot);
        delete (value.station as Partial<typeof value.station>).name;
        return value;
      },
    ],
    [
      "unknown root property",
      () => ({ ...deepClone(snapshot), unexpectedSensitiveValue: "reject-me" }),
    ],
    ["array", () => ({ ...deepClone(snapshot), turnarounds: {} })],
  ])("rejects a malformed OCC snapshot %s", async (_label, factory) => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async () => jsonResponse(factory()),
    });

    await expect(client.getOccPlanningSnapshot()).rejects.toMatchObject({
      kind: "malformed-response",
      status: 200,
    });
  });

  it.each([
    [
      "contract date",
      () => ({
        ...deepClone(planningOptions),
        contract: { ...planningOptions.contract, validTo: "2026-02-30" },
      }),
    ],
    [
      "service number",
      () => {
        const value = deepClone(planningOptions);
        if (value.services[0]) value.services[0].unitPrice = Number.NaN;
        return value;
      },
    ],
    [
      "agent eligibility",
      () => {
        const value = deepClone(planningOptions);
        if (value.agents[0]) value.agents[0].eligible = "yes" as never;
        return value;
      },
    ],
    [
      "eligibility reasons",
      () => {
        const value = deepClone(planningOptions);
        if (value.agents[0]) value.agents[0].eligibilityReasons = [1 as never];
        return value;
      },
    ],
  ])("rejects malformed OCC options %s", async (_label, factory) => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async () => jsonResponse(factory()),
    });

    await expect(client.getOccPlanningOptions(turnaroundId)).rejects.toMatchObject({
      kind: "malformed-response",
      status: 200,
    });
  });

  it("returns a safe 409 error without retaining OCC detail, body, or token", async () => {
    const token = "private-occ-token";
    const detail = `overlapping contract internals containing ${token}`;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => token,
      fetch: async () =>
        jsonResponse(
          {
            title: "The OCC planning request conflicts with current operational data.",
            status: 409,
            detail,
            traceId: "trace-occ-409",
          },
          409,
        ),
    });

    const error = await client
      .getOccPlanningOptions(turnaroundId)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ElevantApiError);
    expect(error).toMatchObject({
      kind: "http",
      status: 409,
      traceId: "trace-occ-409",
    });
    expect(error).not.toHaveProperty("detail");
    expect(error).not.toHaveProperty("body");
    if (!(error instanceof ElevantApiError)) throw new Error("Expected API error");
    expect(error.message).not.toContain(detail);
    expect(error.message).not.toContain(token);
  });

  it.each([204, 205])(
    "rejects an empty OCC success with HTTP %i as malformed",
    async (status) => {
      const client = createElevantApiClient({
        baseUrl: "https://api.example.test",
        getAccessToken: () => "occ-token",
        fetch: async () => new Response(null, { status }),
      });

      await expect(client.getOccPlanningSnapshot()).rejects.toMatchObject({
        kind: "malformed-response",
        status,
      });
    },
  );
});
