import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  isDemoFlight,
  isDemoFlightList,
  isDemoFlightOptions,
  isDemoStationLayout,
  normalizedDemoFlightCancel,
  normalizedDemoFlightCreate,
  normalizedDemoFlightOptionsQuery,
  type CreateDemoFlightCommand,
  type DemoFlightIntent,
  type DemoFlightOptionsQuery,
} from "../src";

// ADR-0041: the superadministrator's demo flights. Synthetic fixtures only; no provider is involved.
const stationId = "20000000-0000-7000-8000-000000000003";
const otherStationId = "20000000-0000-7000-8000-000000000004";
const airlineId = "21000000-0000-7000-8000-000000000001";
const typeId = "22000000-0000-7000-8000-000000000001";
const standId = "23000000-0000-7000-8000-000000000001";
const otherStandId = "23000000-0000-7000-8000-000000000002";
const demoFlightId = "0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6a";
const turnaroundId = "70000000-0000-7000-8000-000000000012";
const key = "a0000000-0000-7000-8000-000000000009";
const emptyId = "00000000-0000-0000-0000-000000000000";

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

/** The 41 stands of the Punta Cana catalogue, in its order (no B33). */
const range = (prefix: string, first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, index) => `${prefix}${first + index}`);
const catalogue = [...range("A", 1, 11), ...range("AN", 1, 5), ...range("B", 20, 32), ...range("B", 34, 37),
  ...range("BN", 6, 13)];
/** Punta Cana as the seed leaves it: A01 and A02 are the catalogue's A1 and A2, B01 and B02 are outside it. */
const seeded = { stationId, stationCode: "PUJ", supported: true, catalogTerminals: 3, terminals: 2, catalogStands: 41,
  stands: 2, activeStands: 4, locatedStands: 2, missingStands: catalogue.slice(2), unmatchedStands: ["B01", "B02"],
  complete: false };
/** The same station once «Cargar posiciones» created what it lacked. */
const loaded = { ...seeded, terminals: 3, stands: 41, activeStands: 43, locatedStands: 41, missingStands: [],
  complete: true };
/** A station without a catalogue counts and lists nothing. */
const unsupported = { stationId: otherStationId, stationCode: "SDQ", supported: false, catalogTerminals: 0, terminals: 0,
  catalogStands: 0, stands: 0, activeStands: 0, locatedStands: 0, missingStands: [], unmatchedStands: [],
  complete: false };

/** An eligible stand and a located, free one nobody covers at the on-block instant. */
const eligible = { standId, code: "A01", terminalCode: "A", located: true, free: true, coveredBy: ["Riley Ramp"],
  eligibleAgents: 1, eligible: true, reasons: [] };
const uncovered = { standId: otherStandId, code: "A02", terminalCode: "A", located: true, free: true, coveredBy: [],
  eligibleAgents: 0, eligible: false, reasons: ["stand_not_covered"] };
const options = {
  enabled: true, serverTime: "2026-11-12T14:00:00+00:00", stations: [{ id: stationId, code: "PUJ", name: "Punta Cana" }],
  stationId, operationDate: "2026-11-12", airlines: [{ id: airlineId, name: "Demo Airlines", iataCode: "ZZ", icaoCode: "DZZ" }],
  airports: [{ iataCode: "MIA", icaoCode: "KMIA", name: "Miami International Airport", city: "Miami", countryCode: "US" }],
  aircraftTypes: [{ id: typeId, icaoCode: "A320", manufacturer: "Airbus", model: "A320", sizeCategory: "Narrowbody" }],
  stands: [eligible, uncovered], limits, warnings: [{ code: "crosses_local_midnight", reasons: [] }], layout: seeded,
};
const disabled = { enabled: false, serverTime: "2026-11-12T14:00:00+00:00", stations: [], stationId: null,
  operationDate: null, airlines: [], airports: [], aircraftTypes: [], stands: [], limits: { ...limits, active: 0 },
  warnings: [], layout: null };
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
    for (const bad of [{ ...options, budget: 1 }, { ...options, stands: [{ ...eligible, suggested: true }] },
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

  it("reads the stand eligibility and the layout strictly", async () => {
    // The stands come evaluated for the visit, with who covers each one; the layout is the station's of the answer.
    expect(isDemoFlightOptions(options)).toBe(true);
    expect(isDemoFlightOptions({ ...options, layout: loaded })).toBe(true);
    expect(isDemoFlightOptions({ ...options, layout: null })).toBe(true);
    // A located and free stand whose covering agents fail the rule names their reasons; one the map cannot draw or
    // that is taken needs none, and may still count the agents who cover it.
    expect(isDemoFlightOptions({ ...options, stands: [{ ...uncovered, coveredBy: ["Riley Ramp", "Sam Ramp"],
      reasons: ["shift_not_compatible", "mentor_required"] }, { ...eligible, located: false, eligible: false },
    { ...eligible, free: false, eligible: false }] })).toBe(true);
    for (const stand of [
      // The A1 shape, without the eligibility of the stand, and an unknown key.
      { standId, code: "A01", terminalCode: "A", free: true }, { ...eligible, suggested: true },
      // Eligible means located, free, an eligible agent and nothing to explain.
      { ...eligible, located: false }, { ...eligible, free: false }, { ...eligible, eligibleAgents: 0 },
      { ...eligible, reasons: ["shift_not_compatible"] },
      // Never more eligible agents than covering ones, never a negative or fractional count.
      { ...uncovered, eligibleAgents: 1 }, { ...eligible, eligibleAgents: -1 }, { ...eligible, eligibleAgents: 0.5 },
      // Reasons are snake_case codes, at most 16; the covering agents are named.
      { ...uncovered, reasons: ["Sin cobertura"] }, { ...uncovered, reasons: Array(17).fill("stand_not_covered") },
      { ...eligible, coveredBy: [""] }, { ...eligible, coveredBy: ["x".repeat(202)] }, { ...eligible, coveredBy: "Riley Ramp" },
      { ...eligible, located: "yes" }, { ...uncovered, reasons: null },
    ])
      expect(isDemoFlightOptions({ ...options, stands: [stand] }), JSON.stringify(stand)).toBe(false);

    expect(isDemoStationLayout(seeded)).toBe(true);
    expect(isDemoStationLayout(loaded, stationId.toUpperCase())).toBe(true);
    expect(isDemoStationLayout(unsupported, otherStationId)).toBe(true);
    expect(isDemoStationLayout(loaded, otherStationId)).toBe(false);
    for (const layout of [
      { ...seeded, replayed: true }, { ...seeded, stationId: emptyId }, { ...seeded, stationCode: "" },
      // The counts never exceed what they count, and the missing stands are the catalogue's the station lacks.
      { ...seeded, stands: 42 }, { ...seeded, terminals: 4 }, { ...seeded, missingStands: [] },
      { ...seeded, missingStands: [...catalogue.slice(3), "A4"] }, { ...seeded, locatedStands: 5 },
      { ...loaded, activeStands: 40 }, { ...seeded, unmatchedStands: ["B01", "B02", "B03", "B04", "B05"] },
      // Complete lacks nothing; a station without a catalogue counts nothing and is never complete.
      { ...seeded, complete: true }, { ...loaded, terminals: 2 }, { ...unsupported, activeStands: 4 },
      { ...unsupported, unmatchedStands: ["B01"] }, { ...unsupported, complete: true }, { ...seeded, supported: "yes" },
      { ...seeded, catalogStands: -41 }, { ...seeded, unmatchedStands: [""] },
    ])
      expect(isDemoStationLayout(layout), JSON.stringify(layout)).toBe(false);
    // The layout of another station, or one without a station (feature off), is refused with the whole answer.
    expect(isDemoFlightOptions({ ...options, layout: { ...seeded, stationId: otherStationId } })).toBe(false);
    expect(isDemoFlightOptions({ ...options, layout: { ...seeded, complete: true } })).toBe(false);
    expect(isDemoFlightOptions({ ...disabled, layout: seeded })).toBe(false);
    const malformed = client([Response.json({ ...options, stands: [{ ...eligible, located: false }] }),
      Response.json({ ...options, layout: unsupported })]);
    await expect(malformed.getDemoFlightOptions(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(malformed.getDemoFlightOptions(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("sends the form window with the options read", async () => {
    const calls: Call[] = [];
    const api = client(Array.from({ length: 4 }, () => Response.json(options)), calls);
    await expect(api.getDemoFlightOptions({ stationId: stationId.toUpperCase(), aircraftTypeId: typeId,
      minutesToOnBlock: 15, groundMinutes: 90 })).resolves.toEqual(options);
    // What the form has not sent yet is left to the server's defaults (8 and 60 minutes, any size).
    await api.getDemoFlightOptions({ minutesToOnBlock: 2 });
    await api.getDemoFlightOptions({ stationId, aircraftTypeId: null, minutesToOnBlock: undefined, groundMinutes: 240 });
    await api.getDemoFlightOptions({});
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ["GET", `/api/v1/governance/demo-flights/options?stationId=${stationId}&aircraftTypeId=${typeId}` +
        "&minutesToOnBlock=15&groundMinutes=90"],
      ["GET", "/api/v1/governance/demo-flights/options?minutesToOnBlock=2"],
      ["GET", `/api/v1/governance/demo-flights/options?stationId=${stationId}&groundMinutes=240`],
      ["GET", "/api/v1/governance/demo-flights/options"],
    ]);

    // A window outside the form's ranges, an identifier that is not one or an unknown key never leaves.
    for (const bad of [{ minutesToOnBlock: 1 }, { minutesToOnBlock: 31 }, { minutesToOnBlock: 7.5 }, { groundMinutes: 19 },
      { groundMinutes: 241 }, { groundMinutes: "60" }, { stationId: "PUJ" }, { aircraftTypeId: emptyId },
      { stationId, window: 8 }, "PUJ", ""])
      await expect(api.getDemoFlightOptions(bad as unknown as DemoFlightOptionsQuery)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(4);
    expect(normalizedDemoFlightOptionsQuery(null)).toBeUndefined();
    expect(normalizedDemoFlightOptionsQuery({ stationId: null, groundMinutes: null })).toBeUndefined();
    expect(normalizedDemoFlightOptionsQuery(stationId.toUpperCase())).toEqual({ stationId });
    expect(normalizedDemoFlightOptionsQuery({ aircraftTypeId: typeId.toUpperCase(), minutesToOnBlock: 30, groundMinutes: 20 }))
      .toEqual({ aircraftTypeId: typeId, minutesToOnBlock: 30, groundMinutes: 20 });
  });

  it("prepares the demo station with its key and validates the state", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(loaded), Response.json(loaded), Response.json({ ...loaded, stationId: otherStationId }),
      Response.json(loaded, { status: 201 }), Response.json({ ...loaded, replayed: true }),
      Response.json({ ...loaded, missingStands: ["A3"] })], calls);
    await expect(api.prepareDemoStation(stationId.toUpperCase(), key)).resolves.toEqual(loaded);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/governance/demo-station" });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");
    // The body names the station and nothing else: what is created is the catalogue's.
    expect(JSON.parse(calls[0]!.body)).toEqual({ stationId });
    // The replay answers the same state with 200: the answer is a state, not a new resource.
    await expect(api.prepareDemoStation(stationId, key)).resolves.toEqual(loaded);
    expect(calls[1]!.body).toBe(calls[0]!.body);
    // The state of another station, a 201, an unknown key or an incoherent state is a malformed answer.
    await expect(api.prepareDemoStation(stationId, key)).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
    await expect(api.prepareDemoStation(stationId, key)).rejects.toMatchObject({ kind: "malformed-response", status: 201 });
    await expect(api.prepareDemoStation(stationId, key)).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
    await expect(api.prepareDemoStation(stationId, key)).rejects.toMatchObject({ kind: "malformed-response", status: 200 });
    // A station or a key that is not a UUID never leaves.
    await expect(api.prepareDemoStation("PUJ", key)).rejects.toThrow(TypeError);
    await expect(api.prepareDemoStation(emptyId, key)).rejects.toThrow(TypeError);
    await expect(api.prepareDemoStation(stationId, "not-a-key")).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(6);
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

    const specific = client([Response.json({ ...flight, destinationIata: "JFK" }, { status: 201 }),
      Response.json(flight, { status: 201 })], calls);
    await specific.createDemoFlight({ ...command, originIata: "mia", destinationIata: " jfk ", standChoice: "Specific",
      standId, minutesToOnBlock: 2, groundMinutes: 240 }, key);
    expect(JSON.parse(calls[4]!.body)).toEqual({ stationId, airlineId, originIata: "MIA", destinationIata: "JFK",
      aircraftTypeId: typeId, standChoice: "Specific", standId, minutesToOnBlock: 2, groundMinutes: 240 });
    // «Al azar» sends no stand: the server draws an eligible one with the key as the seed.
    await specific.createDemoFlight({ ...command, standChoice: "Random", standId: "" }, key);
    expect(JSON.parse(calls[5]!.body)).toMatchObject({ standChoice: "Random", standId: null });
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

  it("refuses minutes out of range, a stand with Random and unknown keys before sending", async () => {
    const calls: Call[] = [];
    const api = client([], calls);
    for (const bad of [
      { ...command, minutesToOnBlock: 1 }, { ...command, minutesToOnBlock: 31 }, { ...command, minutesToOnBlock: 7.5 },
      { ...command, groundMinutes: 19 }, { ...command, groundMinutes: 241 }, { ...command, groundMinutes: "60" },
      { ...command, standChoice: "Random", standId }, { ...command, standChoice: "random" },
      { ...command, standChoice: "none" }, { ...command, standChoice: "Specific" },
      { ...command, standChoice: "None", standId },
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
    // An empty destination or stand from a form is «none»; «Al azar» goes without a stand.
    expect(normalizedDemoFlightCreate({ ...command, destinationIata: " ", standId: "" })).toMatchObject({
      destinationIata: null, standId: null });
    expect(normalizedDemoFlightCreate({ ...command, standChoice: "Random" })).toMatchObject({ standChoice: "Random",
      standId: null });
  });

  it("keeps each new Problem Details code", async () => {
    const codes = ["demo_flights_unavailable", "invalid_demo_flight", "demo_origin_unknown", "demo_flight_limit_reached",
      "demo_flight_closed", "station_unavailable", "contract_not_in_force", "contract_ambiguous", "airline_inactive",
      "aircraft_type_unavailable", "stand_unavailable", "forbidden", "version_conflict", "not_found",
      "demo_station_unsupported", "no_eligible_stand", "stand_not_eligible"];
    const status = (code: string) => code === "forbidden" ? 403 : code === "invalid_demo_flight" ? 400
      : code === "station_unavailable" || code === "not_found" ? 404 : 409;
    const sent: Record<string, string[]> = {
      stand_unavailable: ["stand_taken", "made_up_rule"],
      no_eligible_stand: ["stand_not_covered", "shift_not_compatible", "made_up_rule"],
      stand_not_eligible: ["stand_not_located", "mentor_required"],
    };
    const kept: Record<string, string[]> = {
      stand_unavailable: ["stand_taken"],
      no_eligible_stand: ["stand_not_covered", "shift_not_compatible"],
      stand_not_eligible: ["stand_not_located", "mentor_required"],
    };
    const api = client(codes.map(code => problem(status(code), code, code in sent ? { reasons: sent[code] } : {})));
    for (const code of codes) {
      const refused = await (code === "demo_flight_closed" || code === "not_found" || code === "version_conflict"
        ? api.cancelDemoFlight(demoFlightId, "Finish", key)
        : code === "demo_station_unsupported"
          ? api.prepareDemoStation(otherStationId, key)
          : api.createDemoFlight({ ...command, standChoice: "Random" }, key)).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(ElevantApiError);
      expect(refused).toMatchObject({ kind: "http", status: status(code), code });
      // A refused stand names its known rules; anything else the server sent is dropped.
      expect((refused as ElevantApiError).reasons).toEqual(kept[code] ?? []);
    }
  });
});
