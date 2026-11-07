import { describe, expect, it } from "vitest";
import { createElevantApiClient, ELEVANT_RULE_REASONS, ElevantApiError } from "../src";
import { ELEVANT_API_ERROR_CODES } from "../src/errors";

// Phase 2, block D: the keyed decision and removal (2-N08, 2-N11), the amendment of an approved absence (2-N22), the
// readiness warnings of the schedule (2-N24) and the planning board's marks (2-N25).
const requestId = "50000000-0000-7000-8000-000000000071";
const shiftId = "50000000-0000-7000-8000-000000000005";
const stationId = "20000000-0000-7000-8000-000000000003";
const key = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const base = "https://api.example.test/api/v1";

type Call = { url: string; method: string; key: string | null; body: unknown };

function recording(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "hr-token",
    fetch: async (url, init) => {
      const call = { url: String(url), method: init?.method ?? "GET",
        key: new Headers(init?.headers).get("idempotency-key"),
        body: init?.body ? JSON.parse(String(init.body)) : null };
      calls.push(call);
      return answer(call);
    } });
  return { client, calls };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const problem = (status: number, code: string, reasons?: string[]) => new Response(JSON.stringify({ status,
  title: "El registro cambió o no admite este cambio.", code, ...(reasons ? { reasons } : {}) }),
{ status, headers: { "content-type": "application/problem+json" } });

describe("Gestión Humana commands of phase 2 (block D)", () => {
  it("registers the human resources codes and the mentor reasons", () => {
    for (const code of ["agent_has_operation_in_progress", "availability_request_closed", "absence_not_approved",
      "absence_started", "absence_ended", "absence_end_invalid", "invalid_absence_amendment", "shift_in_use",
      "shift_in_past", "shift_on_approved_absence", "shift_day_taken", "shift_scope_missing", "agent_unavailable",
      "availability_overlap", "invalid_availability_request", "invalid_shift", "invalid_readiness_query"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
    expect(ELEVANT_RULE_REASONS).toEqual(expect.arrayContaining(["mentor_absent", "mentor_permit_required"]));
  });

  it("decides a request with its version and key, and keeps the older keyless call", async () => {
    const { client, calls } = recording(() => json({ id: requestId, status: "Approved" }));
    await expect(client.resolveHumanResourcesAvailabilityRequest(requestId,
      { decision: "Approve", note: null, expectedVersion: "AAAAAAAAB9E=" }, key)).resolves.toEqual({ id: requestId,
      status: "Approved" });
    await expect(client.resolveHumanResourcesAvailabilityRequest(requestId, { decision: "Approve" })).resolves
      .toEqual({ id: requestId, status: "Approved" });
    expect(calls.map(call => [call.key, call.body])).toEqual([
      // A blank note is not sent, as before.
      [key, { decision: "Approve", expectedVersion: "AAAAAAAAB9E=" }],
      [null, { decision: "Approve" }],
    ]);
    // A key needs the version on screen; neither leaves the client otherwise.
    await expect(client.resolveHumanResourcesAvailabilityRequest(requestId, { decision: "Approve" }, key))
      .rejects.toBeInstanceOf(TypeError);
    await expect(client.resolveHumanResourcesAvailabilityRequest(requestId,
      { decision: "Approve", expectedVersion: "AAAAAAAAB9E=" }, "not-a-key")).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(2);
  });

  it("keeps the release refusal of an approval as its code", async () => {
    const { client } = recording(() => problem(409, "agent_has_operation_in_progress"));
    await expect(client.resolveHumanResourcesAvailabilityRequest(requestId,
      { decision: "Approve", expectedVersion: "AAAAAAAAB9E=" }, key)).rejects.toMatchObject({ status: 409,
      code: "agent_has_operation_in_progress" });
  });

  it("cancels or shortens an approved absence with a reason, the version and a key", async () => {
    const { client, calls } = recording(call => json((call.body as { action: string }).action === "Cancel"
      ? { id: requestId, status: "Cancelled", endsOn: "2026-11-12", version: "AAAAAAAAB9I=" }
      : { id: requestId, status: "Approved", endsOn: "2026-11-07", version: "AAAAAAAAB9M=" }));
    await expect(client.amendHumanResourcesAvailabilityRequest(requestId, { action: "Cancel",
      reason: "  La vacación se pospone  ", expectedVersion: "AAAAAAAAB9E=" }, key)).resolves.toEqual({ id: requestId,
      status: "Cancelled", endsOn: "2026-11-12", version: "AAAAAAAAB9I=" });
    await expect(client.amendHumanResourcesAvailabilityRequest(requestId, { action: "Shorten", endsOn: "2026-11-07",
      reason: "Alta médica anticipada", expectedVersion: "AAAAAAAAB9I=" }, key)).resolves.toMatchObject({
      endsOn: "2026-11-07" });
    expect(calls.map(call => [call.method, call.url.replace(base, ""), call.key, call.body])).toEqual([
      ["POST", `/human-resources/availability-requests/${requestId}/amendment`, key,
        { action: "Cancel", endsOn: null, reason: "La vacación se pospone", expectedVersion: "AAAAAAAAB9E=" }],
      ["POST", `/human-resources/availability-requests/${requestId}/amendment`, key,
        { action: "Shorten", endsOn: "2026-11-07", reason: "Alta médica anticipada", expectedVersion: "AAAAAAAAB9I=" }],
    ]);
    // Invalid intents never leave the client: a shortening without its day, a cancellation with one, a short reason.
    for (const command of [
      { action: "Shorten", reason: "Alta médica anticipada", expectedVersion: "AAAAAAAAB9E=" },
      { action: "Cancel", endsOn: "2026-11-07", reason: "Alta médica anticipada", expectedVersion: "AAAAAAAAB9E=" },
      { action: "Shorten", endsOn: "2026-11-31", reason: "Alta médica anticipada", expectedVersion: "AAAAAAAAB9E=" },
      { action: "Cancel", reason: "Alta", expectedVersion: "AAAAAAAAB9E=" },
      { action: "Withdraw", reason: "Alta médica anticipada", expectedVersion: "AAAAAAAAB9E=" },
    ])
      await expect(client.amendHumanResourcesAvailabilityRequest(requestId, command as never, key))
        .rejects.toBeInstanceOf(TypeError);
    await expect(client.amendHumanResourcesAvailabilityRequest(requestId, { action: "Cancel",
      reason: "La vacación se pospone", expectedVersion: "AAAAAAAAB9E=" }, "")).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(2);
  });

  it("refuses an amendment answer for another request, a longer absence or an extra key", async () => {
    const answers = [
      { id: shiftId, status: "Cancelled", endsOn: "2026-11-12", version: "AAAAAAAAB9I=" },
      { id: requestId, status: "Approved", endsOn: "2026-11-12", version: "AAAAAAAAB9I=" },
      { id: requestId, status: "Approved", endsOn: "2026-11-09", version: "AAAAAAAAB9I=" },
      { id: requestId, status: "Approved", endsOn: "2026-11-07", version: "AAAAAAAAB9I=", reason: "x" },
    ];
    const commands = [
      { action: "Cancel", reason: "La vacación se pospone", expectedVersion: "AAAAAAAAB9E=" },
      { action: "Cancel", reason: "La vacación se pospone", expectedVersion: "AAAAAAAAB9E=" },
      { action: "Shorten", endsOn: "2026-11-07", reason: "Alta médica anticipada", expectedVersion: "AAAAAAAAB9E=" },
      { action: "Shorten", endsOn: "2026-11-07", reason: "Alta médica anticipada", expectedVersion: "AAAAAAAAB9E=" },
    ] as const;
    for (const [index, answer] of answers.entries()) {
      const { client } = recording(() => json(answer));
      await expect(client.amendHumanResourcesAvailabilityRequest(requestId, commands[index]!, key))
        .rejects.toMatchObject({ kind: "malformed-response" });
    }
    // A replay after a later shortening answers an earlier day: still the same intent.
    const { client } = recording(() => json({ id: requestId, status: "Approved", endsOn: "2026-11-06",
      version: "AAAAAAAAB9U=" }));
    await expect(client.amendHumanResourcesAvailabilityRequest(requestId, commands[2], key)).resolves
      .toMatchObject({ endsOn: "2026-11-06" });
  });

  it("removes a shift with its version as query and its key, or as an older client", async () => {
    const { client, calls } = recording(() => new Response(null, { status: 204 }));
    await expect(client.removeHumanResourcesShift(shiftId, "AAAAAAAAB9E=", key)).resolves.toBeUndefined();
    await expect(client.removeHumanResourcesShift(shiftId)).resolves.toBeUndefined();
    expect(calls.map(call => [call.method, call.url.replace(base, ""), call.key])).toEqual([
      ["DELETE", `/human-resources/shifts/${shiftId}?version=AAAAAAAAB9E%3D`, key],
      ["DELETE", `/human-resources/shifts/${shiftId}`, null],
    ]);
    await expect(client.removeHumanResourcesShift(shiftId, null, key)).rejects.toBeInstanceOf(TypeError);
    await expect(client.removeHumanResourcesShift(shiftId, "", key)).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(2);
    const refused = recording(() => problem(409, "shift_in_use"));
    const failure = await refused.client.removeHumanResourcesShift(shiftId, "AAAAAAAAB9E=", key).catch(error => error);
    expect(failure).toBeInstanceOf(ElevantApiError);
    expect(failure).toMatchObject({ status: 409, code: "shift_in_use" });
  });

  it("asks for the readiness warnings only when the screen wants them", async () => {
    const query = { stationId, from: "2026-11-02", to: "2026-11-08", page: 1, limit: 20 };
    const evidence = [{ shiftId, stationId, stationCode: "PUJ", startsAt: "2026-11-05T10:00:00Z",
      endsAt: "2026-11-05T18:00:00Z" }];
    const warning = (kind: string, reason: string | null) => ({ anchorShiftId: shiftId, rampProfileId: requestId,
      agentName: "Riley Ramp", employeeNumber: "DEV-RA-001", workDate: "2026-11-05", kind, evidence,
      hasRestrictedEvidence: false, measuredMinutes: null, thresholdMinutes: null, ruleVersion: "dev-2026-10-05",
      ruleEffectiveOn: "2026-10-05", reason });
    const page = { ...query, hasMore: false, asOf: "2026-11-01T12:00:00Z", ruleVersion: "dev-2026-10-05",
      ruleEffectiveOn: "2026-10-05",
      warnings: [warning("ApprovedAbsence", null), warning("DocumentExpired", "AirportId,RampDriverLicense")] };
    const { client, calls } = recording(() => json(page));
    await expect(client.getHumanResourcesScheduleWarnings({ ...query, includeReadiness: true })).resolves.toEqual(page);
    expect(new URL(calls[0]!.url).searchParams.get("includeReadiness")).toBe("true");
    // Without asking, the same kinds are a malformed answer, and the parameter stays out of the URL.
    await expect(client.getHumanResourcesScheduleWarnings({ ...query, includeReadiness: false }))
      .rejects.toMatchObject({ kind: "malformed-response" });
    expect(new URL(calls[1]!.url).searchParams.has("includeReadiness")).toBe(false);
    const unnamed = recording(() => json({ ...page, warnings: [warning("DocumentExpired", null)] }));
    await expect(unnamed.client.getHumanResourcesScheduleWarnings({ ...query, includeReadiness: true }))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client.getHumanResourcesScheduleWarnings({ ...query, includeReadiness: "yes" } as never))
      .rejects.toBeInstanceOf(TypeError);
  });

  it("reads the planning board's marks of a station and day, and refuses foreign or unknown ones", async () => {
    const assignment = { assignmentId: shiftId, turnaroundId: requestId, agentId: requestId,
      reasons: ["airport_id_not_current", "approved_absence"] };
    const marks = { stationId, date: "2026-11-07", assignments: [assignment] };
    const { client, calls } = recording(() => json(marks));
    await expect(client.getOccAssignmentReadiness({ stationId, date: "2026-11-07" })).resolves.toEqual(marks);
    expect(calls[0]!.url).toBe(`${base}/occ/planning/assignment-readiness?stationId=${stationId}&date=2026-11-07`);
    for (const answer of [
      { ...marks, date: "2026-11-08" },
      { ...marks, assignments: [{ ...assignment, reasons: [] }] },
      { ...marks, assignments: [{ ...assignment, reasons: ["agent_on_strike"] }] },
      { ...marks, assignments: [assignment, assignment] },
      { ...marks, assignments: [{ ...assignment, name: "Riley" }] },
    ]) {
      const { client: other } = recording(() => json(answer));
      await expect(other.getOccAssignmentReadiness({ stationId, date: "2026-11-07" }))
        .rejects.toMatchObject({ kind: "malformed-response" });
    }
    await expect(client.getOccAssignmentReadiness({ stationId, date: "07/11/2026" })).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(1);
  });
});
