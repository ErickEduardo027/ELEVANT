import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  type OccAssignmentResponse,
  type OccPlanningOptionsResponse,
  type OccPlanningSnapshotResponse,
  type ManualTurnaroundOptionsResponse,
  type CreateManualTurnaroundRequest,
  type ProgramOccShiftRequest,
} from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const turnaroundId = "70000000-0000-7000-8000-000000000012";
const agentId = "50000000-0000-7000-8000-000000000001";
const operationEtag = '"occ-operation-v7"';
const assignmentEtag = '"occ-operation-v8"';

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
  isCharter: false,
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

const assignment: OccAssignmentResponse = {
  turnaroundId,
  operation: {
    id: "70000000-0000-7000-8000-000000000023",
    status: "Assigned",
    plannedStartAt: "2026-08-19T12:30:00-04:00",
    plannedEndAt: "2026-08-19T13:45:00-04:00",
    actualStartAt: null,
    actualEndAt: null,
  },
  assignment: {
    assignmentId: "70000000-0000-7000-8000-000000000061",
    agentId,
    displayName: "Riley Ramp",
    employeeNumber: "DEV-RA-001",
    positionId: "50000000-0000-7000-8000-000000000011",
    positionCode: "RAMP",
    positionName: "Ramp Agent",
    assignmentRole: "primary",
    assignedAt: "2026-08-19T12:20:00-04:00",
  },
  services: snapshot.turnarounds[0]!.services,
};

const manualOptions: ManualTurnaroundOptionsResponse = {
  station,
  date: "2026-08-19",
  stationAirport: { id: "20000000-0000-7000-8000-000000000001", iataCode: "PUJ", icaoCode: "MDPC", name: "Punta Cana" },
  airlines: [{ id: "20000000-0000-7000-8000-000000000010", iataCode: "EV", name: "Elevant Demo" }],
  airports: [{ id: "20000000-0000-7000-8000-000000000002", iataCode: "MIA", icaoCode: "KMIA", name: "Miami" }],
  stands: [{ id: "20000000-0000-7000-8000-000000000005", code: "A01", terminal: { id: "20000000-0000-7000-8000-000000000004", code: "A", name: "Terminal A" } }],
};

const manualRequest: CreateManualTurnaroundRequest = {
  turnaroundId,
  stationId,
  airlineId: manualOptions.airlines[0]!.id,
  standId: manualOptions.stands[0]!.id,
  operationDate: "2026-08-19",
  arrivalFlightNumber: "EV 311",
  arrivalOriginIata: "mia",
  arrivalScheduledAt: "2026-08-19T13:00:00Z",
  departureFlightNumber: "EV 312",
  departureDestinationIata: "mia",
  departureScheduledAt: "2026-08-19T15:00:00Z",
  charter: false,
};

const shiftRequest: ProgramOccShiftRequest = {
  agentId, startsAtLocal: "08:00:00", endsAtLocal: "12:00:00",
};

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("OCC planning API client", () => {
  it("programs a shift with only an agent and local interval", async () => {
    const shiftId = "50000000-0000-7000-8000-000000000099";
    let url = "";
    let body = "";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async (input, init) => {
        url = String(input);
        body = String(init?.body);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer occ-token");
        return jsonResponse({ turnaroundId, shiftId, replayed: false }, 201);
      },
    });

    await expect(client.programOccShift(turnaroundId, shiftRequest))
      .resolves.toEqual({ turnaroundId, shiftId, replayed: false });
    expect(url).toBe(`https://api.example.test/api/v1/occ/planning/turnarounds/${turnaroundId}/shift`);
    expect(JSON.parse(body)).toEqual(shiftRequest);
  });

  it("rejects extra shift authority and a malformed response", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => {
        calls += 1;
        return jsonResponse({ turnaroundId,
          shiftId: "50000000-0000-7000-8000-000000000099", replayed: false, stationId }, 201);
      },
    });
    await expect(client.programOccShift(turnaroundId,
      { ...shiftRequest, stationId } as never)).rejects.toThrow("OCC shift");
    await expect(client.programOccShift(turnaroundId,
      { ...shiftRequest, endsAtLocal: "08:00:00" })).rejects.toThrow("OCC shift");
    expect(calls).toBe(0);
    await expect(client.programOccShift(turnaroundId, shiftRequest))
      .rejects.toBeInstanceOf(ElevantApiError);
    expect(calls).toBe(1);
  });
  it("loads scoped manual choices and posts one normalized flight", async () => {
    const urls: string[] = [];
    const requests: RequestInit[] = [];
    const authorizations: Array<string | null> = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async (input, init) => {
        urls.push(String(input));
        requests.push(init ?? {});
        authorizations.push(new Headers(init?.headers).get("authorization"));
        return urls.length === 1 ? jsonResponse(manualOptions) :
          jsonResponse({ turnaroundId, operationCode: "MAN-TEST", replayed: false }, 201);
      },
    });

    await expect(client.getManualTurnaroundOptions({ stationId, date: "2026-08-19" }))
      .resolves.toEqual(manualOptions);
    await expect(client.createManualTurnaround(manualRequest))
      .resolves.toEqual({ turnaroundId, operationCode: "MAN-TEST", replayed: false });
    expect(urls).toEqual([
      `https://api.example.test/api/v1/occ/planning/manual-options?stationId=${stationId}&date=2026-08-19`,
      "https://api.example.test/api/v1/occ/planning/turnarounds",
    ]);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[1]?.method).toBe("POST");
    expect(JSON.parse(String(requests[1]?.body))).toEqual({
      ...manualRequest,
      arrivalFlightNumber: "EV311",
      departureFlightNumber: "EV312",
      arrivalOriginIata: "MIA",
      departureDestinationIata: "MIA",
    });
    expect(authorizations).toEqual(["Bearer occ-token", "Bearer occ-token"]);
  });

  it("rejects malformed manual requests and responses before exposing them", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => {
        calls += 1;
        return jsonResponse({ turnaroundId, operationCode: "MAN-TEST", replayed: false, tenantId: "leak" }, 201);
      },
    });
    await expect(client.getManualTurnaroundOptions({ stationId: "bad", date: "2026-08-19" }))
      .rejects.toThrow("stationId");
    await expect(client.createManualTurnaround({ ...manualRequest, departureScheduledAt: manualRequest.arrivalScheduledAt }))
      .rejects.toThrow("departureScheduledAt");
    await expect(client.createManualTurnaround({ ...manualRequest, extra: true } as never))
      .rejects.toThrow("manual turnaround");
    expect(calls).toBe(0);
    await expect(client.createManualTurnaround(manualRequest))
      .rejects.toBeInstanceOf(ElevantApiError);
    expect(calls).toBe(1);
  });
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

  it("returns OCC options with the exact opaque non-base64 strong ETag without changing the legacy method", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async () => {
        calls += 1;
        return jsonResponse(planningOptions, 200, { etag: operationEtag });
      },
    });

    await expect(client.getOccPlanningOptions(turnaroundId)).resolves.toEqual(
      planningOptions,
    );
    await expect(
      client.getOccPlanningOptionsWithMetadata(turnaroundId),
    ).resolves.toEqual({ options: planningOptions, etag: operationEtag });
    expect(calls).toBe(2);
  });

  it("assigns only one agent with a fresh token and the exact If-Match precondition", async () => {
    let requestUrl = "";
    let requestMethod = "";
    let requestBody = "";
    let requestHeaders = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "fresh-occ-token",
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestMethod = init?.method ?? "";
        requestBody = String(init?.body ?? "");
        requestHeaders = new Headers(init?.headers);
        return jsonResponse(assignment, 200, { etag: assignmentEtag });
      },
    });

    await expect(
      client.assignOccPlanningOperation(
        turnaroundId,
        { agentId },
        operationEtag,
        {
          headers: {
            "If-Match": '"AAAAAAAAAAA="',
            "Content-Type": "text/plain",
          },
        },
      ),
    ).resolves.toEqual(assignment);

    expect(requestUrl).toBe(
      `https://api.example.test/api/v1/occ/planning/turnarounds/${turnaroundId}/assignment`,
    );
    expect(requestMethod).toBe("POST");
    expect(JSON.parse(requestBody)).toEqual({ agentId });
    expect(requestHeaders.get("authorization")).toBe("Bearer fresh-occ-token");
    expect(requestHeaders.get("content-type")).toBe("application/json");
    expect(requestHeaders.get("if-match")).toBe(operationEtag);
  });

  it("returns an assignment with the exact opaque non-base64 response ETag", async () => {
    let observedIfMatch: string | null = null;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "fresh-occ-token",
      fetch: async (_input, init) => {
        observedIfMatch = new Headers(init?.headers).get("if-match");
        return jsonResponse(assignment, 200, { etag: assignmentEtag });
      },
    });

    await expect(
      client.assignOccPlanningOperationWithMetadata(
        turnaroundId,
        { agentId },
        operationEtag,
      ),
    ).resolves.toEqual({ assignment, etag: assignmentEtag });
    expect(observedIfMatch).toBe(operationEtag);
  });

  it.each([
    ["bad turnaround", "bad", { agentId }, operationEtag, "turnaroundId"],
    ["empty agent", turnaroundId, { agentId: "" }, operationEtag, "agentId"],
    [
      "unknown request field",
      turnaroundId,
      { agentId, serviceIds: [] },
      operationEtag,
      "agentId",
    ],
    ["weak ETag", turnaroundId, { agentId }, `W/${operationEtag}`, "etag"],
    ["unquoted ETag", turnaroundId, { agentId }, "AAAAAAAAAAc=", "etag"],
  ])(
    "rejects unsafe assignment input: %s",
    async (_label, candidateTurnaround, request, etag, message) => {
      let requestCount = 0;
      const client = createElevantApiClient({
        baseUrl: "https://api.example.test",
        fetch: async () => {
          requestCount += 1;
          return jsonResponse(assignment);
        },
      });

      await expect(
        client.assignOccPlanningOperation(
          candidateTurnaround,
          request as never,
          etag,
        ),
      ).rejects.toThrow(message);
      expect(requestCount).toBe(0);
    },
  );

  it.each([null, "W/\"AAAAAAAAAAc=\"", '"bad tag"'])(
    "rejects missing or malformed options ETag %j",
    async (etag) => {
      const client = createElevantApiClient({
        baseUrl: "https://api.example.test",
        getAccessToken: () => "occ-token",
        fetch: async () => jsonResponse(planningOptions, 200, etag ? { etag } : {}),
      });

      await expect(
        client.getOccPlanningOptionsWithMetadata(turnaroundId),
      ).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
    },
  );

  it.each([null, 'W/"occ-operation-v8"', '"bad tag"'])(
    "rejects missing or malformed assignment response ETag %j",
    async (etag) => {
      const client = createElevantApiClient({
        baseUrl: "https://api.example.test",
        getAccessToken: () => "occ-token",
        fetch: async () => jsonResponse(assignment, 200, etag ? { etag } : {}),
      });

      await expect(
        client.assignOccPlanningOperationWithMetadata(
          turnaroundId,
          { agentId },
          operationEtag,
        ),
      ).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
    },
  );

  it("rejects a malformed assignment success projection", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async () =>
        jsonResponse({ ...deepClone(assignment), clientControlledPrice: 1 }),
    });

    await expect(
      client.assignOccPlanningOperation(
        turnaroundId,
        { agentId },
        operationEtag,
      ),
    ).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });

  it("returns a safe 412 assignment error without retaining details or tokens", async () => {
    const token = "private-occ-token";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => token,
      fetch: async () =>
        jsonResponse(
          {
            title: "The OCC planning context has changed.",
            status: 412,
            detail: `stale internals containing ${token}`,
            traceId: "trace-occ-412",
          },
          412,
        ),
    });

    const error = await client
      .assignOccPlanningOperation(turnaroundId, { agentId }, operationEtag)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ElevantApiError);
    expect(error).toMatchObject({
      kind: "http",
      status: 412,
      traceId: "trace-occ-412",
    });
    expect(error).not.toHaveProperty("detail");
    expect(error).not.toHaveProperty("body");
    if (!(error instanceof ElevantApiError)) throw new Error("Expected API error");
    expect(error.message).not.toContain(token);
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

  it("preserves the caller signal and AbortError for the OCC assignment POST", async () => {
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
      client.assignOccPlanningOperationWithMetadata(
        turnaroundId,
        { agentId },
        operationEtag,
        { signal: controller.signal },
      ),
    ).rejects.toBe(abortError);
    expect(observedSignal).toBe(controller.signal);
  });

  it("accepts isDemo absent or true and rejects false, null and a non-boolean (ADR-0041)", async () => {
    const marked = (mark: Record<string, unknown>) => ({
      ...deepClone(snapshot),
      turnarounds: [snapshot.turnarounds[0]!,
        { ...deepClone(snapshot.turnarounds[0]!), id: "70000000-0000-7000-8000-000000000013", ...mark }],
    });
    const read = (body: unknown) => createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async () => jsonResponse(body),
    }).getOccPlanningSnapshot();

    await expect(read(marked({}))).resolves.toEqual(marked({}));
    const demo = await read(marked({ isDemo: true }));
    expect(demo.turnarounds.map(item => item.isDemo)).toEqual([undefined, true]);
    for (const isDemo of [false, null, "true", 0])
      await expect(read(marked({ isDemo }))).rejects.toMatchObject({ kind: "malformed-response" });

    // The turnaround detail carries the same turnaround, mark included.
    const version = "AAAAAAAAB+E=";
    const detail = (mark: Record<string, unknown>) => ({ station, turnaround: { ...deepClone(snapshot.turnarounds[0]!), ...mark },
      version, isCharter: false, allowedActions: [] });
    const readDetail = (body: unknown) => createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "occ-token",
      fetch: async () => jsonResponse(body, 200, { etag: `"${version}"` }),
    }).getOccTurnaround(turnaroundId);
    await expect(readDetail(detail({ isDemo: true }))).resolves.toMatchObject({ turnaround: { turnaround: { isDemo: true } } });
    await expect(readDetail(detail({}))).resolves.toMatchObject({ etag: `"${version}"` });
    await expect(readDetail(detail({ isDemo: false }))).rejects.toMatchObject({ kind: "malformed-response" });
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
      isCharter: false,
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
