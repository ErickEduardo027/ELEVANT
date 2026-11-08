import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  type GetRampOperationChecklistResponse,
  type RampChecklistSubmissionResponse,
  type RampOperationServiceTransitionResponse,
  type SubmitRampOperationChecklistRequest,
  type TransitionRampOperationServiceRequest,
} from "../src";

const operationId = "70000000-0000-4000-8000-000000000016";
const otherOperationId = "70000000-0000-4000-8000-000000000017";
const checklistId = "72000000-0000-4000-8000-000000000001";
const itemId = "72000000-0000-4000-8000-000000000002";
const serviceId = "73000000-0000-4000-8000-000000000001";
const installationId = "90000000-0000-4000-8000-000000000001";
const idempotencyKey = "90000000-0000-4000-8000-000000000002";
const receiptId = "90000000-0000-4000-8000-000000000003";

const checklist: GetRampOperationChecklistResponse = {
  operationId,
  checklist: {
    id: checklistId,
    status: "NotStarted",
    startedAt: null,
    submittedAt: null,
    template: {
      code: "TURNAROUND-BASE",
      name: "Checklist base de turnaround",
      version: 2,
    },
    sections: [
      {
        name: "Chequeo preuso",
        items: [
          {
            id: itemId,
            code: "PRE-01",
            label: "Inspección visual",
            sortOrder: 1,
            isRequired: true,
            requiresNoteWhenNotOk: true,
            answer: null,
          },
        ],
      },
    ],
  },
};

const submissionRequest: SubmitRampOperationChecklistRequest = {
  checklistId,
  answers: [{ itemId, value: "Ok" }],
};

const submitted: RampChecklistSubmissionResponse = {
  receiptId,
  checklist: {
    id: checklistId,
    status: "Submitted",
    startedAt: "2026-09-18T12:00:00Z",
    submittedAt: "2026-09-18T12:01:00Z",
    answerCount: 1,
  },
};

const transitionRequest: TransitionRampOperationServiceRequest = {
  targetStatus: "Completed",
  executedQuantity: 3.5,
  note: "Servicio terminado",
};

const transitioned: RampOperationServiceTransitionResponse = {
  receiptId,
  service: {
    id: serviceId,
    status: "Completed",
    contractedQuantity: 3,
    executedQuantity: 3.5,
    billingUnit: "EA",
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ramp checklist and service execution API client", () => {
  it("reads the authenticated operation checklist without client-controlled scope", async () => {
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
        return jsonResponse(checklist);
      },
    });

    await expect(client.getRampOperationChecklist(operationId)).resolves.toEqual(
      checklist,
    );
    expect(requestedUrl).toBe(
      `https://api.example.test/api/v1/ramp/operations/${operationId}/checklist`,
    );
    expect(requestedMethod).toBe("GET");
    expect(requestedBody).toBeUndefined();
    expect(requestedHeaders.get("authorization")).toBe("Bearer ramp-token");
    expect(requestedHeaders.has("content-type")).toBe(false);
  });

  it("submits only the contracted answers and overwrites protected headers", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody = "";
    let requestedHeaders = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "";
        requestedBody = String(init?.body ?? "");
        requestedHeaders = new Headers(init?.headers);
        return jsonResponse(submitted);
      },
    });

    await expect(
      client.submitRampOperationChecklist(
        operationId,
        submissionRequest,
        installationId,
        idempotencyKey,
        {
          headers: {
            "X-Elevant-Installation-Id":
              "90000000-0000-4000-8000-999999999999",
            "Idempotency-Key": "90000000-0000-4000-8000-999999999998",
          },
        },
      ),
    ).resolves.toEqual(submitted);

    expect(requestedUrl).toBe(
      `https://api.example.test/api/v1/ramp/operations/${operationId}/checklist/submit`,
    );
    expect(requestedMethod).toBe("POST");
    expect(requestedHeaders.get("authorization")).toBe("Bearer ramp-token");
    expect(requestedHeaders.get("content-type")).toBe("application/json");
    expect(requestedHeaders.get("x-elevant-installation-id")).toBe(
      installationId,
    );
    expect(requestedHeaders.get("idempotency-key")).toBe(idempotencyKey);
    expect(JSON.parse(requestedBody)).toEqual(submissionRequest);
  });

  it("preserves the exact idempotency key and body for a replay", async () => {
    const observed: Array<{ body: string; key: string | null }> = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        observed.push({
          body: String(init?.body ?? ""),
          key: headers.get("idempotency-key"),
        });
        return jsonResponse(submitted);
      },
    });

    await client.submitRampOperationChecklist(
      operationId,
      submissionRequest,
      installationId,
      idempotencyKey,
    );
    await client.submitRampOperationChecklist(
      operationId,
      submissionRequest,
      installationId,
      idempotencyKey,
    );

    expect(observed).toEqual([
      { body: JSON.stringify(submissionRequest), key: idempotencyKey },
      { body: JSON.stringify(submissionRequest), key: idempotencyKey },
    ]);
  });

  it("transitions one route-owned service with exact command headers and body", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody = "";
    let requestedHeaders = new Headers();
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "";
        requestedBody = String(init?.body ?? "");
        requestedHeaders = new Headers(init?.headers);
        return jsonResponse(transitioned);
      },
    });

    await expect(
      client.transitionRampOperationService(
        operationId,
        serviceId,
        transitionRequest,
        installationId,
        idempotencyKey,
      ),
    ).resolves.toEqual(transitioned);

    expect(requestedUrl).toBe(
      `https://api.example.test/api/v1/ramp/operations/${operationId}/services/${serviceId}/transition`,
    );
    expect(requestedMethod).toBe("POST");
    expect(requestedHeaders.get("authorization")).toBe("Bearer ramp-token");
    expect(requestedHeaders.get("content-type")).toBe("application/json");
    expect(requestedHeaders.get("x-elevant-installation-id")).toBe(
      installationId,
    );
    expect(requestedHeaders.get("idempotency-key")).toBe(idempotencyKey);
    expect(JSON.parse(requestedBody)).toEqual(transitionRequest);
  });

  // 3-I: the queued transition carries the tapped time; without it the body is the first version's.
  it("sends the tapped transition time only when there is one", async () => {
    const bodies: unknown[] = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse(transitioned);
      },
    });

    await client.transitionRampOperationService(operationId, serviceId,
      { ...transitionRequest, occurredAt: "2026-09-17T16:01:02.123-04:00" }, installationId, idempotencyKey);
    await client.transitionRampOperationService(operationId, serviceId, { ...transitionRequest, occurredAt: null },
      installationId, idempotencyKey);

    expect(bodies).toEqual([
      { ...transitionRequest, occurredAt: "2026-09-17T16:01:02.123-04:00" },
      transitionRequest,
    ]);
    await expect(client.transitionRampOperationService(operationId, serviceId,
      { ...transitionRequest, occurredAt: "17/09/2026 16:01" }, installationId, idempotencyKey))
      .rejects.toThrow(TypeError);
    expect(bodies).toHaveLength(2);
  });

  it("rejects client-controlled authority and malformed command bodies before fetch", async () => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => {
        calls += 1;
        return jsonResponse(submitted);
      },
    });

    await expect(
      client.submitRampOperationChecklist(
        operationId,
        {
          ...submissionRequest,
          actorAccountId: "40000000-0000-4000-8000-000000000001",
        } as unknown as SubmitRampOperationChecklistRequest,
        installationId,
        idempotencyKey,
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      client.submitRampOperationChecklist(
        operationId,
        {
          ...submissionRequest,
          answers: [submissionRequest.answers[0]!, submissionRequest.answers[0]!],
        },
        installationId,
        idempotencyKey,
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      client.transitionRampOperationService(
        operationId,
        serviceId,
        {
          targetStatus: "NotPerformed",
          executedQuantity: 1,
          note: "No ejecutado",
        },
        installationId,
        idempotencyKey,
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      client.transitionRampOperationService(
        operationId,
        serviceId,
        {
          ...transitionRequest,
          stationId: "44000000-0000-4000-8000-000000000001",
        } as unknown as TransitionRampOperationServiceRequest,
        installationId,
        idempotencyKey,
      ),
    ).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it.each([
    ["invalid operation UUID", "invalid", serviceId, transitionRequest],
    ["invalid service UUID", operationId, "invalid", transitionRequest],
    [
      "too many decimal places",
      operationId,
      serviceId,
      { targetStatus: "Completed", executedQuantity: 1.00001 },
    ],
    [
      "quantity while in progress",
      operationId,
      serviceId,
      { targetStatus: "InProgress", executedQuantity: 1 },
    ],
    [
      "exception without note",
      operationId,
      serviceId,
      { targetStatus: "Exception", executedQuantity: 0 },
    ],
  ])("rejects %s before dispatch", async (_name, operation, service, request) => {
    let calls = 0;
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => {
        calls += 1;
        return jsonResponse(transitioned);
      },
    });

    await expect(
      client.transitionRampOperationService(
        operation as string,
        service as string,
        request as TransitionRampOperationServiceRequest,
        installationId,
        idempotencyKey,
      ),
    ).rejects.toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it.each([
    { ...checklist, operationId: otherOperationId },
    { ...checklist, unexpected: true },
    {
      ...checklist,
      checklist: {
        ...checklist.checklist,
        sections: [
          {
            ...checklist.checklist.sections[0]!,
            items: [
              {
                ...checklist.checklist.sections[0]!.items[0]!,
                sortOrder: -1,
              },
            ],
          },
        ],
      },
    },
  ])("rejects a malformed checklist response", async (response) => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => jsonResponse(response),
    });

    await expect(
      client.getRampOperationChecklist(operationId),
    ).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });

  it.each([
    { ...submitted, unexpected: true },
    { ...submitted, checklist: { ...submitted.checklist, id: itemId } },
    { ...submitted, checklist: { ...submitted.checklist, answerCount: 2 } },
    { ...submitted, checklist: { ...submitted.checklist, status: "InProgress" } },
  ])("rejects a malformed checklist submission response", async (response) => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => jsonResponse(response),
    });

    await expect(
      client.submitRampOperationChecklist(
        operationId,
        submissionRequest,
        installationId,
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });

  it.each([
    { ...transitioned, replayed: false },
    { ...transitioned, service: { ...transitioned.service, id: checklistId } },
    {
      ...transitioned,
      service: { ...transitioned.service, status: "InProgress" },
    },
    {
      ...transitioned,
      service: { ...transitioned.service, executedQuantity: Number.NaN },
    },
  ])("rejects a malformed service transition response", async (response) => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "ramp-token",
      fetch: async () => jsonResponse(response),
    });

    await expect(
      client.transitionRampOperationService(
        operationId,
        serviceId,
        transitionRequest,
        installationId,
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
  });

  it("redacts token, answer note, and server detail from command errors", async () => {
    const token = "private-ramp-token";
    const note = "private operational note";
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => token,
      fetch: async () =>
        jsonResponse(
          {
            title: "Operation conflict",
            detail: `Failure contained ${token} and ${note}`,
            traceId: "trace-ramp-command",
          },
          409,
        ),
    });

    const error = await client
      .submitRampOperationChecklist(
        operationId,
        {
          ...submissionRequest,
          answers: [{ ...submissionRequest.answers[0]!, note }],
        },
        installationId,
        idempotencyKey,
      )
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ElevantApiError);
    expect(error).toMatchObject({
      kind: "http",
      status: 409,
      title: "Operation conflict",
      traceId: "trace-ramp-command",
    });
    if (!(error instanceof ElevantApiError)) throw new Error("Expected API error");
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain(note);
    expect(error).not.toHaveProperty("detail");
    expect(error).not.toHaveProperty("body");
  });
});
