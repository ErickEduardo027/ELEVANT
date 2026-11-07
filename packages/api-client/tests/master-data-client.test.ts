import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  isMasterStand,
  isOccMasterData,
  isStationCatalog,
  normalizedStationCreate,
  normalizedStandUpdate,
} from "../src";

// Phase 2, block C (2-A): stations by the superadministrator; terminals, stands and aircraft types by OCC.
const stationId = "20000000-0000-7000-8000-000000000003";
const terminalId = "20000000-0000-7000-8000-000000000004";
const standId = "20000000-0000-7000-8000-000000000005";
const typeId = "20000000-0000-7000-8000-000000000020";
const key = "a0000000-0000-7000-8000-000000000009";
const airport = { id: "20000000-0000-7000-8000-000000000001", iataCode: "PUJ", icaoCode: "MDPC",
  name: "Punta Cana International Airport", city: "Punta Cana", countryCode: "DO" };
const station = { id: stationId, code: "PUJ", name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo", isActive: true,
  hasHistory: true, airport, version: "AAAAAAAAB9E=" };
const terminal = { id: terminalId, code: "A", name: "Terminal A", isActive: true, hasHistory: true, version: "AAAAAAAAB9F=" };
const stand = { id: standId, terminalId, code: "A01", hasBoardingBridge: false, isRemote: false, maxAircraftSize: null,
  isActive: true, hasHistory: false, version: "AAAAAAAAB9G=" };
const aircraftType = { id: typeId, icaoCode: "B738", iataCode: "73H", manufacturer: "Boeing", model: "737-800",
  sizeCategory: "Narrowbody", isActive: true, version: "AAAAAAAAB9H=" };
const masterData = { stationId, stationCode: "PUJ", terminals: [terminal], stands: [stand], aircraftTypes: [aircraftType],
  canCreate: true, canUpdate: true };

type Call = { url: string; method: string; headers: Headers; body: string };

function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
        headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
}

const problem = (status: number, code: string) => Response.json({ title: "La posición cambió o no admite este cambio.", status,
  code }, { status, headers: { "content-type": "application/problem+json" } });

describe("station catalog (superadministrator)", () => {
  it("lists every station and the known airports without one, strictly", async () => {
    const catalog = { stations: [station], availableAirports: [{ ...airport, id: "20000000-0000-7000-8000-000000000002",
      iataCode: "MIA", icaoCode: "KMIA", name: "Miami International Airport", city: "Miami", countryCode: "US" }] };
    const calls: Call[] = [];
    const api = client([Response.json(catalog), Response.json({ ...catalog, extra: true })], calls);
    await expect(api.listGovernanceStations()).resolves.toEqual(catalog);
    expect(calls[0]!.url).toBe("/api/v1/governance/stations");
    await expect(api.listGovernanceStations()).rejects.toMatchObject({ kind: "malformed-response" });
    expect(isStationCatalog({ ...catalog, stations: [{ ...station, airport: { ...airport, countryCode: "Dom" } }] })).toBe(false);
  });

  it("creates with the key (201, 200 on a replay) and updates the version on screen", async () => {
    const calls: Call[] = [];
    const created = { ...station, id: "20000000-0000-7000-8000-000000000030", code: "XQS", name: "Estación sintética",
      hasHistory: false, airport: { ...airport, id: "20000000-0000-7000-8000-000000000031", iataCode: "XQS", icaoCode: "XQSS",
        name: "Synthetic Airport", city: "Synthetic City" } };
    const api = client([Response.json(created, { status: 201 }), Response.json(created), Response.json({ ...station, name: "PUJ" }),
      Response.json({ ...station, id: created.id })], calls);
    const input = { code: " xqs ", name: " Estación sintética ", ianaTimeZone: "America/Santo_Domingo", airportIcaoCode: "xqss",
      airportName: "Synthetic Airport", airportCity: "Synthetic City", airportCountryCode: "do" };
    await expect(api.createGovernanceStation(input, key)).resolves.toEqual(created);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/governance/stations" });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(calls[0]!.body)).toEqual({ code: "XQS", name: "Estación sintética", ianaTimeZone: "America/Santo_Domingo",
      airportIcaoCode: "XQSS", airportName: "Synthetic Airport", airportCity: "Synthetic City", airportCountryCode: "DO" });
    await expect(api.createGovernanceStation(input, key)).resolves.toEqual(created);
    const update = { name: "PUJ", ianaTimeZone: "America/Santo_Domingo", isActive: true, expectedVersion: station.version };
    await expect(api.updateGovernanceStation(stationId, update, key)).resolves.toMatchObject({ name: "PUJ" });
    expect(calls[2]).toMatchObject({ method: "PUT", url: `/api/v1/governance/stations/${stationId}` });
    expect(JSON.parse(calls[2]!.body)).toEqual(update);
    // The answer is always the station of the route.
    await expect(api.updateGovernanceStation(stationId, update, key)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("refuses invalid input locally and keeps the station codes of a refused command", async () => {
    const calls: Call[] = [];
    const api = client([problem(409, "station_code_taken"), problem(409, "time_zone_locked")], calls);
    expect(() => normalizedStationCreate({ code: "PUJA", name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" }))
      .toThrow(TypeError);
    expect(() => normalizedStationCreate({ code: "PUJ", name: "Punta Cana", ianaTimeZone: "Eastern Standard Time" }))
      .toThrow(TypeError);
    expect(normalizedStationCreate({ code: "mia", name: "AVIAM Miami", ianaTimeZone: "America/New_York", airportIcaoCode: " " }))
      .toEqual({ code: "MIA", name: "AVIAM Miami", ianaTimeZone: "America/New_York", airportIcaoCode: null, airportName: null,
        airportCity: null, airportCountryCode: null });
    await expect(api.createGovernanceStation({ code: "XQS", name: "Estación", ianaTimeZone: "UTC" }, "not-a-key"))
      .rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
    const taken = await api.createGovernanceStation({ code: "PUJ", name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" }, key)
      .catch((error: unknown) => error);
    expect(taken).toBeInstanceOf(ElevantApiError);
    expect(taken).toMatchObject({ status: 409, code: "station_code_taken" });
    await expect(api.updateGovernanceStation(stationId, { name: "PUJ", ianaTimeZone: "America/New_York", isActive: true,
      expectedVersion: station.version }, key)).rejects.toMatchObject({ code: "time_zone_locked" });
  });
});

describe("OCC master data", () => {
  it("reads the terminals, stands and aircraft types of the station of the request", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(masterData), Response.json({ ...masterData, stationId: terminalId })], calls);
    await expect(api.getOccMasterData(stationId)).resolves.toEqual(masterData);
    expect(calls[0]!.url).toBe(`/api/v1/occ/master-data?stationId=${stationId}`);
    await expect(api.getOccMasterData(stationId)).rejects.toMatchObject({ kind: "malformed-response" });
    // Every stand belongs to one of the listed terminals; sizes are Narrowbody, Widebody or none.
    expect(isOccMasterData({ ...masterData, stands: [{ ...stand, terminalId: typeId }] }, stationId)).toBe(false);
    expect(isOccMasterData({ ...masterData, stands: [{ ...stand, maxAircraftSize: "Huge" }] }, stationId)).toBe(false);
    expect(isOccMasterData({ ...masterData, terminals: [{ ...terminal, rules: 2 }] }, stationId)).toBe(false);
    expect(isMasterStand({ ...stand, terminalId: null })).toBe(true);
  });

  it("creates and edits terminals, stands and aircraft types with the intent's key", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(terminal, { status: 201 }), Response.json({ ...terminal, name: "Terminal Norte" }),
      Response.json(stand, { status: 201 }), Response.json({ ...stand, isActive: false }),
      Response.json(aircraftType, { status: 201 }), Response.json({ ...aircraftType, model: "737-800 Winglets" })], calls);
    await api.createOccTerminal({ stationId, code: " a ", name: "Terminal A" }, key);
    await api.updateOccTerminal(terminalId, { code: "A", name: "Terminal Norte", isActive: true,
      expectedVersion: terminal.version }, key);
    await api.createOccStand({ stationId, terminalId, code: "a01", hasBoardingBridge: false, isRemote: false,
      maxAircraftSize: "" }, key);
    await expect(api.updateOccStand(standId, { terminalId, code: "A01", hasBoardingBridge: false, isRemote: false,
      maxAircraftSize: null, isActive: false, expectedVersion: stand.version }, key)).resolves.toMatchObject({ isActive: false });
    await api.createOccAircraftType({ icaoCode: "b738", iataCode: "73h", manufacturer: "Boeing", model: "737-800",
      sizeCategory: "Narrowbody" }, key);
    await api.updateOccAircraftType(typeId, { iataCode: "", manufacturer: "Boeing", model: "737-800 Winglets",
      sizeCategory: null, isActive: true, expectedVersion: aircraftType.version }, key);
    expect(calls.map(item => [item.method, item.url])).toEqual([
      ["POST", "/api/v1/occ/terminals"], ["PUT", `/api/v1/occ/terminals/${terminalId}`],
      ["POST", "/api/v1/occ/stands"], ["PUT", `/api/v1/occ/stands/${standId}`],
      ["POST", "/api/v1/occ/aircraft-types"], ["PUT", `/api/v1/occ/aircraft-types/${typeId}`],
    ]);
    expect(calls.every(item => item.headers.get("idempotency-key") === key)).toBe(true);
    expect(JSON.parse(calls[0]!.body)).toEqual({ stationId, code: "A", name: "Terminal A" });
    expect(JSON.parse(calls[2]!.body)).toEqual({ stationId, terminalId, code: "A01", hasBoardingBridge: false,
      isRemote: false, maxAircraftSize: null });
    expect(JSON.parse(calls[4]!.body)).toEqual({ icaoCode: "B738", iataCode: "73H", manufacturer: "Boeing", model: "737-800",
      sizeCategory: "Narrowbody" });
    expect(JSON.parse(calls[5]!.body)).toEqual({ iataCode: null, manufacturer: "Boeing", model: "737-800 Winglets",
      sizeCategory: null, isActive: true, expectedVersion: aircraftType.version });
  });

  it("refuses invalid commands locally, another record in the answer and keeps the in-use codes", async () => {
    const calls: Call[] = [];
    const api = client([Response.json({ ...stand, id: typeId }), problem(409, "stand_in_use"), problem(409, "terminal_in_use"),
      Response.json({ ...terminal, code: "B" }, { status: 201 })], calls);
    expect(() => normalizedStandUpdate({ terminalId, code: "A01-", hasBoardingBridge: false, isRemote: false,
      isActive: true, expectedVersion: stand.version })).toThrow(TypeError);
    expect(() => normalizedStandUpdate({ terminalId, code: "A01", hasBoardingBridge: false, isRemote: false,
      isActive: true, expectedVersion: " " })).toThrow(TypeError);
    await expect(api.createOccAircraftType({ icaoCode: "737", manufacturer: "Boeing", model: "737" }, key)).rejects.toThrow(TypeError);
    await expect(api.createOccStand({ stationId, terminalId, code: "A02", hasBoardingBridge: false, isRemote: false,
      maxAircraftSize: "Huge" }, key)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
    const update = { terminalId, code: "A01", hasBoardingBridge: false, isRemote: false, isActive: false,
      expectedVersion: stand.version };
    await expect(api.updateOccStand(standId, update, key)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.updateOccStand(standId, update, key)).rejects.toMatchObject({ status: 409, code: "stand_in_use" });
    await expect(api.updateOccTerminal(terminalId, { code: "A", name: "Terminal A", isActive: false,
      expectedVersion: terminal.version }, key)).rejects.toMatchObject({ code: "terminal_in_use" });
    // A creation answers the record it created.
    await expect(api.createOccTerminal({ stationId, code: "C", name: "Terminal C" }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("gives a manual flight its aircraft type («type once») and reads the active types of the options", async () => {
    const calls: Call[] = [];
    const options = {
      station: { id: stationId, code: "PUJ", name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" }, date: "2026-11-06",
      stationAirport: { id: airport.id, iataCode: "PUJ", icaoCode: "MDPC", name: airport.name },
      airlines: [{ id: "50000000-0000-7000-8000-000000000002", iataCode: "ZZ", name: "Demo Airlines" }],
      airports: [{ id: "20000000-0000-7000-8000-000000000002", iataCode: "MIA", icaoCode: "KMIA", name: "Miami" }],
      stands: [{ id: standId, code: "A01", terminal: { id: terminalId, code: "A", name: "Terminal A" } }], charterAirlines: [],
      aircraftTypes: [{ id: typeId, icaoCode: "B738", iataCode: "73H", manufacturer: "Boeing", model: "737-800",
        sizeCategory: "Narrowbody" }],
    };
    const turnaroundId = "30000000-0000-7000-8000-000000000010";
    const api = client([Response.json(options), Response.json({ ...options, aircraftTypes: [{ ...options.aircraftTypes[0],
      isActive: true }] }), Response.json({ turnaroundId, operationCode: "MAN-1", replayed: false }, { status: 201 }),
    Response.json({ turnaroundId, operationCode: "MAN-1", replayed: false }, { status: 201 })], calls);
    await expect(api.getManualTurnaroundOptions({ stationId, date: "2026-11-06" })).resolves.toEqual(options);
    await expect(api.getManualTurnaroundOptions({ stationId, date: "2026-11-06" }))
      .rejects.toMatchObject({ kind: "malformed-response" });
    const request = { turnaroundId, stationId, airlineId: options.airlines[0]!.id, standId, operationDate: "2026-11-06",
      arrivalFlightNumber: "ZZ900", arrivalOriginIata: "MIA", arrivalScheduledAt: "2026-11-06T13:00:00Z",
      departureFlightNumber: "ZZ901", departureDestinationIata: "MIA", departureScheduledAt: "2026-11-06T15:00:00Z",
      charter: false };
    await api.createManualTurnaround({ ...request, aircraftTypeId: typeId });
    expect(JSON.parse(calls[2]!.body)).toMatchObject({ aircraftTypeId: typeId });
    // Without a type the body stays the one older servers accept.
    await api.createManualTurnaround({ ...request, aircraftTypeId: null });
    expect(JSON.parse(calls[3]!.body)).not.toHaveProperty("aircraftTypeId");
    await expect(api.createManualTurnaround({ ...request, aircraftTypeId: "B738" })).rejects.toThrow("manual turnaround");
  });
});
