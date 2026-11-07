import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError } from "../src";

const stationId = "20000000-0000-7000-8000-000000000003";
const terminalId = "20000000-0000-7000-8000-000000000004";
const standId = "20000000-0000-7000-8000-000000000005";
const turnaroundId = "70000000-0000-7000-8000-000000000012";
const operationId = "70000000-0000-7000-8000-000000000015";
const assignmentId = "71000000-0000-7000-8000-000000000001";
const newAssignmentId = "71000000-0000-7000-8000-000000000002";
const riley = "33000000-0000-7000-8000-000000000001";
const ximena = "33000000-0000-7000-8000-000000000002";
const shiftId = "34000000-0000-7000-8000-000000000001";
const coverageId = "60000000-0000-7000-8000-000000000001";
const key = "90000000-0000-4000-8000-000000000001";
const version = "AAAAAAAAB9E=";
const board = {
  stationId, stationCode: "PUJ", date: "2026-11-09", canAssign: true, canConfigure: false, terminals: [], stands: [],
  constraints: [], agents: [], coverages: [],
};
const options = {
  turnaroundId, operationId, operationStatus: "InProgress", currentAssignmentId: assignmentId, currentAgentId: riley,
  currentAgentName: "Riley Ramp", remainingFrom: "2026-11-09T14:10:00+00:00", remainingUntil: "2026-11-09T15:00:00+00:00",
  agents: [{ id: ximena, displayName: "Ximena Ramp", employeeNumber: "QA-RA-302", eligible: true, eligibilityReasons: [] }],
};
const handover = { turnaroundId, assignmentId: newAssignmentId, agentId: ximena, previousAgentId: riley, replayed: false };
const shift = { shiftId, agentId: riley, workDate: "2026-11-09", startsAtLocal: "08:00:00", endsAtLocal: "12:00:00",
  terminalCode: "A", version };
const adjusted = { id: shiftId, startsAtLocal: "08:00:00", endsAtLocal: "13:00:00", version: "AAAAAAAAB9I=" };
const problem = (status: number, code: string, reasons?: string[]) => Response.json(
  { status, title: "Conflict", code, ...(reasons && { reasons }) },
  { status, headers: { "content-type": "application/problem+json" } });

type Sent = { url: string; method: string; body: string; headers: Headers };

function client(answers: Response[], sent: Sent[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
    sent.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
      body: String(init?.body ?? ""), headers: new Headers(init?.headers) });
    return answers.shift() ?? Response.json({});
  } });
}

const coverage = { stationId, date: "2026-11-09", agentId: riley, terminalId, standIds: [standId], isReinforcement: false };

describe("coverage and agent release with the intent's key (3-J)", () => {
  it("sends the Idempotency-Key of a coverage command only when the screen gives one", async () => {
    const sent: Sent[] = [];
    const api = client([Response.json(board), Response.json(board), Response.json(board)], sent);
    await api.createOccCoverage(coverage, { idempotencyKey: key });
    await api.releaseOccCoverage(coverageId, "2026-11-09", { idempotencyKey: key.toUpperCase() });
    await api.createOccCoverage(coverage);
    expect(sent.map(item => item.headers.get("idempotency-key"))).toEqual([key, key, null]);
    expect([sent[1]!.method, sent[1]!.url]).toEqual(["POST", `/api/v1/occ/coverage/${coverageId}/release?date=2026-11-09`]);
    await expect(api.createOccCoverage(coverage, { idempotencyKey: "not-a-key" })).rejects.toThrow(TypeError);
  });

  it("releases the agent OCC saw with its key and refuses a key without the assignment", async () => {
    const sent: Sent[] = [];
    const api = client([new Response(null, { status: 204 }), new Response(null, { status: 204 })], sent);
    await api.releaseOccOperationAgent(turnaroundId, { expectedAssignmentId: assignmentId, idempotencyKey: key });
    await api.releaseOccOperationAgent(turnaroundId);
    expect(sent.map(item => [item.method, item.url, item.headers.get("idempotency-key")])).toEqual([
      ["POST", `/api/v1/occ/planning/turnarounds/${turnaroundId}/assignment/release?expectedAssignmentId=${assignmentId}`, key],
      ["POST", `/api/v1/occ/planning/turnarounds/${turnaroundId}/assignment/release`, null],
    ]);
    await expect(api.releaseOccOperationAgent(turnaroundId, { idempotencyKey: key })).rejects.toThrow(TypeError);
    await expect(client([Response.json({})]).releaseOccOperationAgent(turnaroundId))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("keeps the code of a refused release and of a coverage that breaks the terminal's scope", async () => {
    const changed = await client([problem(409, "assignment_changed")])
      .releaseOccOperationAgent(turnaroundId, { expectedAssignmentId: assignmentId, idempotencyKey: key })
      .catch(error => error);
    expect(changed).toBeInstanceOf(ElevantApiError);
    expect([changed.status, changed.code]).toEqual([409, "assignment_changed"]);
    const started = await client([problem(409, "operation_started")]).releaseOccOperationAgent(turnaroundId)
      .catch(error => error);
    expect(started.code).toBe("operation_started");
    const rejected = await client([problem(422, "coverage_rejected", ["terminal_scope_missing", "unknown"])])
      .createOccCoverage(coverage, { idempotencyKey: key }).catch(error => error);
    expect([rejected.code, rejected.reasons]).toEqual(["coverage_rejected", ["terminal_scope_missing"]]);
  });
});

describe("handover of a started operation (3-F)", () => {
  it("reads the options strictly: the route's operation, a window that ends after it starts, never the current agent",
    async () => {
      const sent: Sent[] = [];
      await expect(client([Response.json(options)], sent).getOccHandoverOptions(turnaroundId)).resolves.toEqual(options);
      expect([sent[0]!.method, sent[0]!.url])
        .toEqual(["GET", `/api/v1/occ/planning/turnarounds/${turnaroundId}/assignment/handover-options`]);
      for (const wrong of [{ ...options, extra: true }, { ...options, turnaroundId: operationId },
        { ...options, operationStatus: "Assigned" }, { ...options, remainingUntil: options.remainingFrom },
        { ...options, agents: [{ ...options.agents[0]!, id: riley }] },
        { ...options, agents: [{ ...options.agents[0]!, extra: 1 }] }])
        await expect(client([Response.json(wrong)]).getOccHandoverOptions(turnaroundId))
          .rejects.toMatchObject({ kind: "malformed-response" });
      const refused = await client([problem(409, "handover_not_allowed")]).getOccHandoverOptions(turnaroundId)
        .catch(error => error);
      expect(refused.code).toBe("handover_not_allowed");
    });

  it("hands the operation over with the key, the assignment OCC saw and a trimmed reason", async () => {
    const sent: Sent[] = [];
    const answer = await client([Response.json(handover)], sent).handOverOccOperation(turnaroundId,
      { agentId: ximena, expectedAssignmentId: assignmentId, reason: "  Riley terminó su turno.  " }, key);
    expect(answer).toEqual(handover);
    expect([sent[0]!.method, sent[0]!.url, sent[0]!.headers.get("idempotency-key")])
      .toEqual(["POST", `/api/v1/occ/planning/turnarounds/${turnaroundId}/assignment/handover`, key]);
    expect(JSON.parse(sent[0]!.body)).toEqual({ agentId: ximena, expectedAssignmentId: assignmentId,
      reason: "Riley terminó su turno." });
    const command = { agentId: ximena, expectedAssignmentId: assignmentId, reason: "Riley terminó su turno." };
    await expect(client([]).handOverOccOperation(turnaroundId, { ...command, reason: "Ok" }, key)).rejects.toThrow(TypeError);
    await expect(client([]).handOverOccOperation(turnaroundId, command, "")).rejects.toThrow(TypeError);
    await expect(client([]).handOverOccOperation(turnaroundId, { ...command, extra: 1 } as never, key))
      .rejects.toThrow(TypeError);
    for (const wrong of [{ ...handover, agentId: riley }, { ...handover, previousAgentId: ximena }, { ...handover, x: 1 }])
      await expect(client([Response.json(wrong)]).handOverOccOperation(turnaroundId, command, key))
        .rejects.toMatchObject({ kind: "malformed-response" });
    for (const code of ["assignment_changed", "same_agent", "agent_not_eligible", "idempotency_conflict"]) {
      const failure = await client([problem(409, code)]).handOverOccOperation(turnaroundId, command, key)
        .catch(error => error);
      expect([failure.status, failure.code]).toEqual([409, code]);
    }
  });
});

describe("the shift of the day OCC and Gestión Humana adjust (3-E)", () => {
  it("reads the agent's shift of the flight's day with its version and names a missing one", async () => {
    const sent: Sent[] = [];
    await expect(client([Response.json(shift)], sent).getOccAgentShift(turnaroundId, riley)).resolves.toEqual(shift);
    expect(sent[0]!.url).toBe(`/api/v1/occ/planning/turnarounds/${turnaroundId}/agents/${riley}/shift`);
    for (const wrong of [{ ...shift, agentId: ximena }, { ...shift, version: "" }, { ...shift, startsAtLocal: "8:00" },
      { ...shift, extra: 1 }])
      await expect(client([Response.json(wrong)]).getOccAgentShift(turnaroundId, riley))
        .rejects.toMatchObject({ kind: "malformed-response" });
    const missing = await client([problem(404, "shift_not_found")]).getOccAgentShift(turnaroundId, riley)
      .catch(error => error);
    expect([missing.status, missing.code]).toEqual([404, "shift_not_found"]);
  });

  it("adjusts the hours with the key and the version, and checks the adjusted shift", async () => {
    const sent: Sent[] = [];
    const command = { startsAtLocal: "08:00:00", endsAtLocal: "13:00:00", reason: "  El vuelo se extendió.  ",
      expectedVersion: version };
    await expect(client([Response.json(adjusted)], sent).adjustHumanResourcesShift(shiftId, command, key))
      .resolves.toEqual(adjusted);
    expect([sent[0]!.method, sent[0]!.url, sent[0]!.headers.get("idempotency-key")])
      .toEqual(["PATCH", `/api/v1/human-resources/shifts/${shiftId}`, key]);
    expect(JSON.parse(sent[0]!.body)).toEqual({ ...command, reason: "El vuelo se extendió." });
    // A night shift crosses midnight; seconds, sixteen hours or a missing version are refused before calling.
    await expect(client([Response.json({ ...adjusted, startsAtLocal: "20:00:00", endsAtLocal: "04:00:00" })])
      .adjustHumanResourcesShift(shiftId, { ...command, startsAtLocal: "20:00:00", endsAtLocal: "04:00:00" }, key))
      .resolves.toMatchObject({ endsAtLocal: "04:00:00" });
    for (const wrong of [{ ...command, endsAtLocal: "13:00:30" }, { ...command, startsAtLocal: "04:00:00", endsAtLocal: "21:00:00" },
      { ...command, endsAtLocal: "08:00:00" }, { ...command, expectedVersion: "" }, { ...command, reason: "No" }])
      await expect(client([]).adjustHumanResourcesShift(shiftId, wrong, key)).rejects.toThrow(TypeError);
    for (const wrong of [{ ...adjusted, id: coverageId }, { ...adjusted, version: null }, { ...adjusted, extra: 1 }])
      await expect(client([Response.json(wrong)]).adjustHumanResourcesShift(shiftId, command, key))
        .rejects.toMatchObject({ kind: "malformed-response" });
    for (const code of ["shift_uncovers_work", "attendance_validated", "version_conflict", "shift_in_past"]) {
      const failure = await client([problem(409, code)]).adjustHumanResourcesShift(shiftId, command, key)
        .catch(error => error);
      expect(failure.code).toBe(code);
    }
  });
});
