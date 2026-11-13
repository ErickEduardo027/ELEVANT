import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  isDemoFlight,
  isDemoFlightList,
  isDemoFlightOptions,
  normalizedDemoFlightCancel,
  normalizedDemoFlightCreate,
  type CreateDemoFlightCommand,
  type DemoFlightIntent,
} from "../src";

// ADR-0041: the superadministrator's demo flights. Synthetic fixtures only; no provider is involved.
const stationId = "20000000-0000-7000-8000-000000000003";
const airlineId = "21000000-0000-7000-8000-000000000001";
const typeId = "22000000-0000-7000-8000-000000000001";
const standId = "23000000-0000-7000-8000-000000000001";
const demoFlightId = "0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6a";
const turnaroundId = "70000000-0000-7000-8000-000000000012";
const key = "a0000000-0000-7000-8000-000000000009";

const flight = {
  id: demoFlightId, stationId, stationCode: "PUJ", airlineId, airlineName: "Demo Airlines", arrivalFlightNumber: "ZZ9001",
  departureFlightNumber: "ZZ9002", aircraftRegistration: "HIDM01", aircraftModel: "Airbus A320", originIata: "MIA",
  destinationIata: "MIA", suggestedStandCode: "A01", state: "Active", phase: "Approach",
  appearAt: "2026-11-12T14:00:00+00:00", touchdownAt: "2026-11-12T14:04:24+00:00", onBlockAt: "2026-11-12T14:08:00+00:00",
  scheduledOffBlockAt: "2026-11-12T15:08:00+00:00", offBlockAt: null, takeoffAt: null, vanishAt: null, imported: false,
  turnaroundId: null, operationCode: null, standCode: null, operationStatus: null,
};
const imported = { ...flight, phase: "Parked", imported: true, turnaroundId, operationCode: "PUJ-20261112-003",
  standCode: "B22", operationStatus: "Assigned" };
const list = { enabled: true, serverTime: "2026-11-12T14:01:00.123+00:00", stationId, flights: [imported, { ...flight,
  id: "0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6b", state: "Cancelled", phase: "Gone", vanishAt: "2026-11-12T14:02:00+00:00" }] };
const limits = { minMinutesToOnBlock: 2, maxMinutesToOnBlock: 30, defaultMinutesToOnBlock: 8, minGroundMinutes: 20,
  maxGroundMinutes: 240, defaultGroundMinutes: 60, maxActive: 3, active: 1 };
const options = {
  enabled: true, serverTime: "2026-11-12T14:00:00+00:00", stations: [{ id: stationId, code: "PUJ", name: "Punta Cana" }],
  stationId, operationDate: "2026-11-12", airlines: [{ id: airlineId, name: "Demo Airlines", iataCode: "ZZ", icaoCode: "DZZ" }],
  airports: [{ iataCode: "MIA", icaoCode: "KMIA", name: "Miami International Airport", city: "Miami", countryCode: "US" }],
  aircraftTypes: [{ id: typeId, icaoCode: "A320", manufacturer: "Airbus", model: "A320", sizeCategory: "Narrowbody" }],
  stands: [{ standId, code: "A01", terminalCode: "A", free: true }], limits,
  warnings: [{ code: "crosses_local_midnight", reasons: [] }],
};
const disabled = { enabled: false, serverTime: "2026-11-12T14:00:00+00:00", stations: [], stationId: null,
  operationDate: null, airlines: [], airports: [], aircraftTypes: [], stands: [], limits: { ...limits, active: 0 },
  warnings: [] };
const command: CreateDemoFlightCommand = { stationId, airlineId, originIata: " mia ", destinationIata: null,
  aircraftTypeId: typeId, standChoice: "None", minutesToOnBlock: 8, groundMinutes: 60 };

type Call = { url: string; method: string; headers: Headers; body: string };

function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
        headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
}

const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  Response.json({ title: "El vuelo demo no se puede crear o cambió. Vuelva a cargar los datos.", status, code, ...extra },
    { status, headers: { "content-type": "application/problem+json" } });

describe("demo flights client (ADR-0041)", () => {
  it("reads the options and the list strictly", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(options), Response.json(disabled), Response.json(list), Response.json(list)], calls);
    await expect(api.getDemoFlightOptions(stationId.toUpperCase())).resolves.toEqual(options);
    await expect(api.getDemoFlightOptions()).resolves.toEqual(disabled);
    await expect(api.listDemoFlights(stationId)).resolves.toEqual(list);
    await expect(api.listDemoFlights(null)).resolves.toEqual(list);
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ["GET", `/api/v1/governance/demo-flights/options?stationId=${stationId}`],
      ["GET", "/api/v1/governance/demo-flights/options"],
      ["GET", `/api/v1/governance/demo-flights?stationId=${stationId}`],
      ["GET", "/api/v1/governance/demo-flights"],
    ]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");
    await expect(api.listDemoFlights("PUJ")).rejects.toThrow(TypeError);

    // Every level is closed: unknown keys, states and phases outside their lists, malformed instants and codes.
    for (const bad of [{ ...options, budget: 1 }, { ...options, stands: [{ ...options.stands[0], located: true }] },
      { ...options, limits: { ...limits, defaultMinutesToOnBlock: 31 } },
      { ...options, warnings: [{ code: "Crosses local midnight", reasons: [] }] },
      { ...options, warnings: [{ code: "no_eligible_stand", reasons: ["Sin turno"] }] },
      { ...options, airlines: [{ ...options.airlines[0], icaoCode: "dzz" }] },
      { ...options, aircraftTypes: [{ ...options.aircraftTypes[0], sizeCategory: "Huge" }] },
      { ...options, operationDate: null }, { ...options, stationId: typeId },
      { ...disabled, airlines: options.airlines }, { ...disabled, stationId, operationDate: "2026-11-12" }])
      expect(isDemoFlightOptions(bad)).toBe(false);
    for (const bad of [{ ...list, flights: [{ ...flight, state: "Paused" }] }, { ...list, flights: [{ ...flight, phase: "Cruise" }] },
      { ...list, flights: [{ ...flight, touchdownAt: "14:04" }] }, { ...list, flights: [{ ...flight, version: "AAAA" }] },
      { ...list, flights: [{ ...flight, stationId: typeId }] }, { ...list, flights: [flight, flight] },
      { ...list, enabled: false }, { ...list, stationId: null }, { ...list, flights: Array(51).fill(flight) }])
      expect(isDemoFlightList(bad)).toBe(false);
    expect(isDemoFlightList({ ...list, enabled: false, stationId: null, flights: [] })).toBe(true);
    // Imported or not: a flight OCC has not imported carries nothing of OCC; an imported one carries its turnaround.
    expect(isDemoFlight({ ...flight, operationCode: "PUJ-20261112-003" })).toBe(false);
    expect(isDemoFlight({ ...imported, turnaroundId: null })).toBe(false);
    expect(isDemoFlight({ ...imported, standCode: null, operationStatus: null })).toBe(true);
    expect(isDemoFlight(flight, demoFlightId.toUpperCase())).toBe(true);
    expect(isDemoFlight(flight, turnaroundId)).toBe(false);

    const malformed = client([Response.json({ ...options, extra: true }), Response.json({ ...list, flights: [{ ...flight,
      imported: "no" }] })]);
    await expect(malformed.getDemoFlightOptions(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(malformed.listDemoFlights(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("creates with the key (201, 200 on a replay)", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(flight, { status: 201 }), Response.json(flight),
      Response.json({ ...flight, stationId: typeId }, { status: 201 }), Response.json(flight, { status: 202 })], calls);
    await expect(api.createDemoFlight(command, key)).resolves.toEqual(flight);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/governance/demo-flights" });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
    // Normalized before it leaves: IATA in capitals, no destination (the origin), no stand.
    expect(JSON.parse(calls[0]!.body)).toEqual({ stationId, airlineId, originIata: "MIA", destinationIata: null,
      aircraftTypeId: typeId, standChoice: "None", standId: null, minutesToOnBlock: 8, groundMinutes: 60 });
    // The replay answers the first flight again with 200.
    await expect(api.createDemoFlight(command, key)).resolves.toEqual(flight);
    expect(calls[1]!.body).toBe(calls[0]!.body);
    // The new flight is the station's of the request, and only 201 or 200 is a creation.
    await expect(api.createDemoFlight(command, key)).rejects.toMatchObject({ kind: "malformed-response", status: 201 });
    await expect(api.createDemoFlight(command, key)).rejects.toMatchObject({ kind: "malformed-response", status: 202 });

    const specific = client([Response.json({ ...flight, destinationIata: "JFK" }, { status: 201 })], calls);
    await specific.createDemoFlight({ ...command, originIata: "mia", destinationIata: " jfk ", standChoice: "Specific",
      standId, minutesToOnBlock: 2, groundMinutes: 240 }, key);
    expect(JSON.parse(calls[4]!.body)).toEqual({ stationId, airlineId, originIata: "MIA", destinationIata: "JFK",
      aircraftTypeId: typeId, standChoice: "Specific", standId, minutesToOnBlock: 2, groundMinutes: 240 });
  });

  it("cancels with an intent", async () => {
    const calls: Call[] = [];
    const cancelled = { ...flight, state: "Cancelled", phase: "Gone", vanishAt: "2026-11-12T14:02:00+00:00" };
    const api = client([Response.json(cancelled), Response.json({ ...imported, offBlockAt: "2026-11-12T14:30:00+00:00" }),
      Response.json({ ...flight, id: turnaroundId })], calls);
    await expect(api.cancelDemoFlight(demoFlightId, "Cancel", key)).resolves.toEqual(cancelled);
    await expect(api.cancelDemoFlight(demoFlightId.toUpperCase(), "Finish", key)).resolves.toMatchObject({
      offBlockAt: "2026-11-12T14:30:00+00:00" });
    expect(calls.map(call => [call.method, call.url, JSON.parse(call.body)])).toEqual([
      ["POST", `/api/v1/governance/demo-flights/${demoFlightId}/cancel`, { intent: "Cancel" }],
      ["POST", `/api/v1/governance/demo-flights/${demoFlightId}/cancel`, { intent: "Finish" }],
    ]);
    // No version travels: the intent is checked against the phase.
    expect(calls[0]!.headers.get("if-match")).toBeNull();
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    // The answer is the flight of the route.
    await expect(api.cancelDemoFlight(demoFlightId, "Cancel", key)).rejects.toMatchObject({ kind: "malformed-response" });
    expect(normalizedDemoFlightCancel("Finish")).toEqual({ intent: "Finish" });
  });

  it("refuses minutes out of range, Random and unknown keys before sending", async () => {
    const calls: Call[] = [];
    const api = client([], calls);
    for (const bad of [
      { ...command, minutesToOnBlock: 1 }, { ...command, minutesToOnBlock: 31 }, { ...command, minutesToOnBlock: 7.5 },
      { ...command, groundMinutes: 19 }, { ...command, groundMinutes: 241 }, { ...command, groundMinutes: "60" },
      { ...command, standChoice: "Random" }, { ...command, standChoice: "none" },
      { ...command, standChoice: "Specific" }, { ...command, standChoice: "None", standId },
      { ...command, originIata: "MI" }, { ...command, originIata: "M1A" }, { ...command, destinationIata: "MIAMI" },
      { ...command, stationId: "PUJ" }, { ...command, airlineId: "00000000-0000-0000-0000-000000000000" },
      { ...command, arrivalFlightNumber: "ZZ9001" }, { ...command, aircraftRegistration: "HIDM01" },
    ]) {
      expect(() => normalizedDemoFlightCreate(bad as unknown as CreateDemoFlightCommand)).toThrow(TypeError);
      await expect(api.createDemoFlight(bad as unknown as CreateDemoFlightCommand, key)).rejects.toThrow(TypeError);
    }
    await expect(api.createDemoFlight(command, "not-a-key")).rejects.toThrow(TypeError);
    for (const intent of ["cancel", "Dismiss", "", undefined])
      await expect(api.cancelDemoFlight(demoFlightId, intent as unknown as DemoFlightIntent, key)).rejects.toThrow(TypeError);
    await expect(api.cancelDemoFlight("PUJ", "Cancel", key)).rejects.toThrow(TypeError);
    await expect(api.cancelDemoFlight(demoFlightId, "Cancel", "not-a-key")).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
    // An empty destination or stand from a form is «none».
    expect(normalizedDemoFlightCreate({ ...command, destinationIata: " ", standId: "" })).toMatchObject({
      destinationIata: null, standId: null });
  });

  it("keeps each new Problem Details code", async () => {
    const codes = ["demo_flights_unavailable", "invalid_demo_flight", "demo_origin_unknown", "demo_flight_limit_reached",
      "demo_flight_closed", "station_unavailable", "contract_not_in_force", "contract_ambiguous", "airline_inactive",
      "aircraft_type_unavailable", "stand_unavailable", "forbidden", "version_conflict", "not_found"];
    const status = (code: string) => code === "forbidden" ? 403 : code === "invalid_demo_flight" ? 400
      : code === "station_unavailable" || code === "not_found" ? 404 : 409;
    const api = client(codes.map(code => problem(status(code), code,
      code === "stand_unavailable" ? { reasons: ["stand_taken", "made_up_rule"] } : {})));
    for (const code of codes) {
      const refused = await (code === "demo_flight_closed" || code === "not_found" || code === "version_conflict"
        ? api.cancelDemoFlight(demoFlightId, "Finish", key)
        : api.createDemoFlight(command, key)).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(ElevantApiError);
      expect(refused).toMatchObject({ kind: "http", status: status(code), code });
      // A refused stand names its known rule; anything else the server sent is dropped.
      if (code === "stand_unavailable") expect((refused as ElevantApiError).reasons).toEqual(["stand_taken"]);
    }
  });
});
