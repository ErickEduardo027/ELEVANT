import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError } from "../src";

const turnaroundId = "70000000-0000-7000-8000-000000000012";
const stationId = "20000000-0000-7000-8000-000000000003";
const key = "90000000-0000-4000-8000-000000000001";
const version = "AAAAAAAAB+E=";
const station = { id: stationId, code: "PUJ", name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" };
const turnaround = {
  id: turnaroundId, operationCode: "PUJ-20261105-001", operationDate: "2026-11-05", status: "Confirmed",
  airline: { id: "50000000-0000-7000-8000-000000000001", iataCode: "ZZ", icaoCode: "DZZ", name: "Demo Airlines" },
  aircraft: null, stand: null, arrival: null, departure: null,
  operation: { id: "70000000-0000-7000-8000-000000000015", status: "Assigned", plannedStartAt: "2026-11-05T18:00:00.000Z",
    plannedEndAt: "2026-11-05T20:00:00.000Z", actualStartAt: null, actualEndAt: null },
  agents: [], equipment: [], services: [],
};
const detail = { station, turnaround, version, isCharter: false, allowedActions: ["reschedule", "cancel", "divert"] };
const reschedule = {
  arrivalFlightNumber: " ev 311 ", arrivalOriginIata: "mia", arrivalScheduledAt: "2026-11-05T19:00:00.000Z",
  departureFlightNumber: "EV312", departureDestinationIata: "MIA", departureScheduledAt: "2026-11-05T21:00:00.000Z",
  reason: "  Cambio de horario de la aerolínea  ",
};

type Sent = { url: string; method: string; body: string; headers: Headers };

function client(answers: Response[], sent: Sent[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
    sent.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
      body: String(init?.body ?? ""), headers: new Headers(init?.headers) });
    return answers.shift() ?? Response.json({});
  } });
}

const withETag = (body: unknown, etag = `"${version}"`, status = 200) =>
  Response.json(body, { status, headers: { etag } });

describe("OCC turnaround client (3-A)", () => {
  it("reads the detail with its strong ETag and refuses a mismatched or weak one", async () => {
    const sent: Sent[] = [];
    const read = await client([withETag(detail)], sent).getOccTurnaround(turnaroundId);
    expect(read).toEqual({ turnaround: detail, etag: `"${version}"` });
    expect([sent[0]!.method, sent[0]!.url]).toEqual(["GET", `/api/v1/occ/planning/turnarounds/${turnaroundId}`]);
    await expect(client([withETag(detail, `W/"${version}"`)]).getOccTurnaround(turnaroundId))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client([withETag(detail, '"AAAAAAAAB+F="')]).getOccTurnaround(turnaroundId))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client([withETag({ ...detail, extra: true })]).getOccTurnaround(turnaroundId))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client([withETag({ ...detail, allowedActions: ["delete"] })]).getOccTurnaround(turnaroundId))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client([withETag({ ...detail, turnaround: { ...turnaround, id: stationId } })]).getOccTurnaround(turnaroundId))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("reschedules with the key and the ETag and a normalized body", async () => {
    const sent: Sent[] = [];
    const next = { ...detail, version: "AAAAAAAAB+I=" };
    const answer = await client([withETag(next, '"AAAAAAAAB+I="')], sent)
      .rescheduleOccTurnaround(turnaroundId, reschedule, { ifMatch: `"${version}"`, idempotencyKey: key });
    expect(answer.etag).toBe('"AAAAAAAAB+I="');
    expect([sent[0]!.method, sent[0]!.url]).toEqual(["PUT", `/api/v1/occ/planning/turnarounds/${turnaroundId}/schedule`]);
    expect(sent[0]!.headers.get("if-match")).toBe(`"${version}"`);
    expect(sent[0]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(sent[0]!.body)).toEqual({ arrivalFlightNumber: "EV311", arrivalOriginIata: "MIA",
      arrivalScheduledAt: "2026-11-05T19:00:00.000Z", departureFlightNumber: "EV312", departureDestinationIata: "MIA",
      departureScheduledAt: "2026-11-05T21:00:00.000Z", standId: null, aircraftTypeId: null,
      reason: "Cambio de horario de la aerolínea" });
  });

  it("refuses an invalid change before sending it", async () => {
    const sent: Sent[] = [];
    const api = client([], sent);
    const headers = { ifMatch: `"${version}"`, idempotencyKey: key };
    for (const command of [
      { ...reschedule, reason: "no" },
      { ...reschedule, departureScheduledAt: "2026-11-05T18:00:00.000Z" },
      { ...reschedule, departureScheduledAt: "2026-11-06T20:00:00.000Z" },
      { ...reschedule, arrivalScheduledAt: "2026-11-05T15:00:00-04:00" },
      { ...reschedule, arrivalOriginIata: "MI" },
      { ...reschedule, standId: "stand-1" },
    ])
      await expect(api.rescheduleOccTurnaround(turnaroundId, command, headers)).rejects.toThrow(TypeError);
    await expect(api.rescheduleOccTurnaround(turnaroundId, reschedule, { ifMatch: version, idempotencyKey: key }))
      .rejects.toThrow(TypeError);
    await expect(api.rescheduleOccTurnaround(turnaroundId, reschedule, { ifMatch: `"${version}"`, idempotencyKey: "key" }))
      .rejects.toThrow(TypeError);
    await expect(api.changeOccTurnaroundStatus(turnaroundId, { outcome: "Completed" as "Cancelled", reason: "Vuelo creado" },
      headers)).rejects.toThrow(TypeError);
    expect(sent).toEqual([]);
  });

  it("cancels or diverts and exposes the problem code and rules of a refusal", async () => {
    const sent: Sent[] = [];
    const cancelled = { ...detail, turnaround: { ...turnaround, status: "Cancelled" }, allowedActions: [] };
    await client([withETag(cancelled)], sent).changeOccTurnaroundStatus(turnaroundId,
      { outcome: "Cancelled", reason: " Vuelo creado por error " }, { ifMatch: `"${version}"`, idempotencyKey: key });
    expect([sent[0]!.method, sent[0]!.url]).toEqual(["POST", `/api/v1/occ/planning/turnarounds/${turnaroundId}/status-changes`]);
    expect(JSON.parse(sent[0]!.body)).toEqual({ outcome: "Cancelled", reason: "Vuelo creado por error" });

    const refused = client([Response.json({ status: 409, title: "x", code: "assigned_agent_unavailable",
      reasons: ["shift_not_covering", "simultaneous_limit"] }, { status: 409 })]);
    const error = await refused.rescheduleOccTurnaround(turnaroundId, reschedule, { ifMatch: `"${version}"`, idempotencyKey: key })
      .catch(caught => caught);
    expect(error).toBeInstanceOf(ElevantApiError);
    expect([error.status, error.code, error.reasons]).toEqual([409, "assigned_agent_unavailable",
      ["shift_not_covering", "simultaneous_limit"]]);
    const stale = await client([Response.json({ status: 412, title: "x", code: "version_conflict" }, { status: 412 })])
      .changeOccTurnaroundStatus(turnaroundId, { outcome: "Diverted", reason: "Desviado a SDQ" },
        { ifMatch: `"${version}"`, idempotencyKey: key }).catch(caught => caught);
    expect([stale.status, stale.code]).toEqual([412, "version_conflict"]);
  });

  it("creates the minimal charter carrier once and names the airline of a taken code (3-N21)", async () => {
    const sent: Sent[] = [];
    const airline = { id: "50000000-0000-7000-8000-000000000009", icaoCode: "SHC", iataCode: "9Z", name: "Sky High Charter" };
    const api = client([Response.json(airline, { status: 201 }), Response.json(airline), Response.json({ ...airline, extra: 1 })],
      sent);
    await expect(api.createOccCharterAirline({ name: " Sky  High Charter ", icaoCode: "shc", iataCode: "9z" }, key))
      .resolves.toEqual(airline);
    expect([sent[0]!.method, sent[0]!.url, sent[0]!.headers.get("idempotency-key")])
      .toEqual(["POST", "/api/v1/occ/planning/charter-airlines", key]);
    expect(JSON.parse(sent[0]!.body)).toEqual({ name: "Sky High Charter", icaoCode: "SHC", iataCode: "9Z" });
    await expect(api.createOccCharterAirline({ name: "Sky High Charter", icaoCode: "SHC", iataCode: "9Z" }, key))
      .resolves.toEqual(airline);
    await expect(api.createOccCharterAirline({ name: "Sky High Charter", icaoCode: "SHC" }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
    for (const command of [{ name: "S", icaoCode: "SHC" }, { name: "Sky", icaoCode: "S1C" }, { name: "Sky", icaoCode: "SHC", iataCode: "9ZZ" }])
      await expect(api.createOccCharterAirline(command, key)).rejects.toThrow(TypeError);
    const taken = await client([Response.json({ status: 409, title: "x", code: "airline_code_in_use",
      airlineId: airline.id }, { status: 409 })]).createOccCharterAirline({ name: "Sky", icaoCode: "SHC" }, key)
      .catch(caught => caught);
    expect([taken.status, taken.code]).toEqual([409, "airline_code_in_use"]);
  });
});

describe("OCC positions headers and the ramp aircraft types (3-N10, 3-B)", () => {
  const board = { stationId, stationCode: "PUJ", operationDate: "2026-11-05", asOf: "2026-11-05T12:06:00.000Z",
    canAssign: true, positions: [], unassigned: [] };

  it("sends the key and the ETag only when the screen gives them, and the arrival's type and reason", async () => {
    const sent: Sent[] = [];
    const api = client([Response.json(board), Response.json(board), Response.json(board), Response.json(board)], sent);
    await api.recordOccArrival(turnaroundId, { aircraftRegistration: "hi1055", arrivedAt: "2026-11-05T16:05:00.000Z",
      aircraftTypeId: "60000000-0000-7000-8000-000000000001" }, { ifMatch: `"${version}"`, idempotencyKey: key });
    await api.recordOccArrival(turnaroundId, { aircraftRegistration: "HI1055", arrivedAt: "2026-11-05T16:00:00.000Z",
      reason: " La hora real fue antes " });
    await api.assignOccStand(turnaroundId, { standId: "20000000-0000-7000-8000-000000000005" },
      { ifMatch: `"${version}"`, idempotencyKey: key });
    await api.releaseOccStand(turnaroundId);
    expect([sent[0]!.headers.get("idempotency-key"), sent[0]!.headers.get("if-match")]).toEqual([key, `"${version}"`]);
    expect(JSON.parse(sent[0]!.body)).toEqual({ aircraftRegistration: "HI1055", arrivedAt: "2026-11-05T16:05:00.000Z",
      aircraftTypeId: "60000000-0000-7000-8000-000000000001" });
    expect(JSON.parse(sent[1]!.body)).toEqual({ aircraftRegistration: "HI1055", arrivedAt: "2026-11-05T16:00:00.000Z",
      reason: "La hora real fue antes" });
    expect([sent[1]!.headers.get("idempotency-key"), sent[1]!.headers.get("if-match")]).toEqual([null, null]);
    expect(sent[2]!.headers.get("if-match")).toBe(`"${version}"`);
    expect(sent[3]!.headers.get("idempotency-key")).toBeNull();
    // A key without the ETag, a weak ETag or a malformed key never leave the client.
    await expect(api.releaseOccStand(turnaroundId, { idempotencyKey: key })).rejects.toThrow(TypeError);
    await expect(api.releaseOccStand(turnaroundId, { ifMatch: `W/"${version}"` })).rejects.toThrow(TypeError);
    await expect(api.recordOccArrival(turnaroundId, { aircraftRegistration: "HI1055", reason: "no" })).rejects.toThrow(TypeError);
    expect(sent).toHaveLength(4);
  });

  it("reads the active aircraft types the tablet offers", async () => {
    const types = { aircraftTypes: [{ id: "60000000-0000-7000-8000-000000000001", icaoCode: "A320", iataCode: "320",
      manufacturer: "Airbus", model: "A320-200" }] };
    const sent: Sent[] = [];
    await expect(client([Response.json(types)], sent).getRampAircraftTypes()).resolves.toEqual(types);
    expect(sent[0]!.url).toBe("/api/v1/ramp/aircraft-types");
    await expect(client([Response.json({ aircraftTypes: [{ ...types.aircraftTypes[0], sizeCategory: "Narrowbody" }] })])
      .getRampAircraftTypes()).rejects.toMatchObject({ kind: "malformed-response" });
  });
});
