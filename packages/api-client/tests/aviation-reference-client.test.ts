import { describe, expect, it } from "vitest";
import {
  AVIATION_REFERENCE_STATUSES,
  createElevantApiClient,
  ElevantApiError,
  isAirlineFleet,
  isOccAircraftReference,
  isOccAirportDelays,
  isOccAirportRoutes,
  normalizedAirlineFleetQuery,
  normalizedOccAircraftReferenceQuery,
  normalizedOccAirportDelaysQuery,
  normalizedRegistration,
} from "../src";
import { ELEVANT_API_ERROR_CODES } from "../src/errors";

// ADR-0028 (note of 15 November 2026): the AeroDataBox reference reads through the API. Synthetic answers in the shape the
// API publishes, with invented data; no network and no provider is involved.
const stationId = "20000000-0000-7000-8000-000000000003";
const serverTime = "2026-11-15T14:00:00.1234567+00:00";
const envelope = { status: "Available", serverTime, retrievedAt: "2026-11-15T13:55:00+00:00", source: "AeroDataBox" };

const aircraft = {
  registration: "HI1055", active: true, model: "Boeing 737 MAX 8", typeName: "Boeing 737", icaoType: "B38M",
  iataType: "7M8", operator: "Demo Airlines", serial: "99999", modeS: "0C2ABC", seats: 189, engines: 2, engineType: "Jet",
  ageYears: 4.2, firstFlight: "2022-03-01", delivered: "2022-04-02", registered: "2022-04-02", isFreighter: false,
};
const aircraftAnswer = { stationId, registration: "HI1055", ...envelope, aircraft };
const routes = { stationId, airportIcao: "MDPC", ...envelope, routes: [
  { destinationIata: "YYZ", destinationIcao: "CYYZ", name: "Toronto Pearson", city: "Toronto", countryCode: "CA",
    latitude: 43.6772, longitude: -79.6306, averageDailyFlights: 6, operators: ["Maple Demo"] },
  { destinationIata: "JFK", destinationIcao: "KJFK", name: "New York JFK", city: null, countryCode: "US",
    latitude: null, longitude: null, averageDailyFlights: 3.5, operators: [] },
] };
const batch = { total: 16, qualified: 15, cancelled: 0, medianDelayMinutes: 12, delayIndex: 1.24 };
const delays = { stationId, airport: "MDPC", ...envelope, delays: { airportIcao: "MDPC",
  from: "2026-11-15T12:00:00+00:00", to: "2026-11-15T14:00:00+00:00", arrivals: batch,
  departures: { ...batch, medianDelayMinutes: -3, delayIndex: null } } };
const fleet = { airlineCode: "ZZA", ...envelope, totalAircraft: 87, sampledAircraft: 3,
  types: [{ icaoType: "A320", model: "Airbus A320", count: 2 }, { icaoType: null, model: "Boeing 737-800", count: 1 }] };

type Call = { url: string };
function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async input => {
      calls.push({ url: String(input).replace("https://api.example.test", "") });
      return answers.shift()!;
    } });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "content-type": status === 200 ? "application/json" : "application/problem+json" } });

describe("AeroDataBox reference reads (ADR-0028)", () => {
  it("knows every state and the problem code", () => {
    expect(AVIATION_REFERENCE_STATUSES).toEqual(["Available", "NotFound", "Disabled", "DailyLimitReached",
      "MonthlyLimitReached", "Unavailable", "NotApplicable"]);
    expect(ELEVANT_API_ERROR_CODES).toContain("invalid_aviation_reference_query");
  });

  it("accepts the answers and the caps with the last value kept", () => {
    expect(isOccAircraftReference(aircraftAnswer, stationId, "HI1055")).toBe(true);
    expect(isOccAircraftReference({ ...aircraftAnswer, status: "DailyLimitReached" }, stationId)).toBe(true);
    expect(isOccAircraftReference({ ...aircraftAnswer, status: "NotApplicable", registration: "HIDM07", aircraft: null,
      retrievedAt: null })).toBe(true);
    expect(isOccAirportRoutes(routes, stationId)).toBe(true);
    expect(isOccAirportRoutes({ ...routes, status: "Disabled", routes: [], retrievedAt: null })).toBe(true);
    expect(isOccAirportDelays(delays, stationId, "MDPC")).toBe(true);
    expect(isOccAirportDelays({ ...delays, status: "MonthlyLimitReached", delays: null })).toBe(true);
    expect(isAirlineFleet(fleet, "ZZA")).toBe(true);
    expect(isAirlineFleet({ ...fleet, status: "NotFound", totalAircraft: null, sampledAircraft: 0, types: [] })).toBe(true);
  });

  it("refuses answers that disagree with their state or their query", () => {
    expect(isOccAircraftReference({ ...aircraftAnswer, status: "NotFound" })).toBe(false);
    expect(isOccAircraftReference(aircraftAnswer, stationId, "N12345")).toBe(false);
    expect(isOccAircraftReference({ ...aircraftAnswer, status: "Later" })).toBe(false);
    expect(isOccAircraftReference({ ...aircraftAnswer, extra: 1 })).toBe(false);
    expect(isOccAirportRoutes({ ...routes, routes: [{ ...routes.routes[0], latitude: 91 }] })).toBe(false);
    expect(isOccAirportRoutes({ ...routes, routes: [{ ...routes.routes[0], longitude: null }] })).toBe(false);
    expect(isOccAirportRoutes({ ...routes, status: "NotFound" })).toBe(false);
    expect(isOccAirportDelays({ ...delays, delays: { ...delays.delays, arrivals: { ...batch, delayIndex: 6 } } })).toBe(false);
    expect(isOccAirportDelays(delays, stationId, "SDQ")).toBe(false);
    expect(isAirlineFleet({ ...fleet, sampledAircraft: 4 })).toBe(false);
    expect(isAirlineFleet({ ...fleet, totalAircraft: 2 })).toBe(false);
  });

  it("normalizes the queries before sending them", () => {
    expect(normalizedRegistration(" hi-1055 ")).toBe("HI1055");
    expect(normalizedRegistration("HI 1055!")).toBeNull();
    expect(normalizedOccAircraftReferenceQuery({ stationId: stationId.toUpperCase(), registration: "n-123ab" }))
      .toEqual({ stationId, registration: "N123AB" });
    expect(() => normalizedOccAircraftReferenceQuery({ stationId, registration: "?" })).toThrow(TypeError);
    expect(normalizedOccAirportDelaysQuery({ stationId, airport: "sdq" })).toEqual({ stationId, airport: "SDQ" });
    expect(normalizedOccAirportDelaysQuery({ stationId })).toEqual({ stationId });
    expect(() => normalizedOccAirportDelaysQuery({ stationId, airport: "S1" })).toThrow(TypeError);
    expect(normalizedAirlineFleetQuery({ airlineCode: "zza" })).toEqual({ airlineCode: "ZZA" });
    expect(normalizedAirlineFleetQuery({ airlineCode: "z9" })).toEqual({ airlineCode: "Z9" });
    expect(() => normalizedAirlineFleetQuery({ airlineCode: "99" })).toThrow(TypeError);
  });

  it("reads each endpoint with its query and checks the answer", async () => {
    const calls: Call[] = [];
    const api = client([json(aircraftAnswer), json(routes), json(delays), json(fleet)], calls);

    await expect(api.getOccAircraftReference({ stationId, registration: "hi-1055" })).resolves.toEqual(aircraftAnswer);
    await expect(api.getOccAirportRoutes({ stationId })).resolves.toEqual(routes);
    await expect(api.getOccAirportDelays({ stationId, airport: "mdpc" })).resolves.toEqual(delays);
    await expect(api.getAirlineFleet({ airlineCode: "zza" })).resolves.toEqual(fleet);
    expect(calls.map(call => call.url)).toEqual([
      `/api/v1/occ/aviation/aircraft?stationId=${stationId}&registration=HI1055`,
      `/api/v1/occ/aviation/routes?stationId=${stationId}`,
      `/api/v1/occ/aviation/delays?stationId=${stationId}&airport=MDPC`,
      "/api/v1/contracts/airline-fleet?airlineCode=ZZA",
    ]);
  });

  it("throws a malformed answer and the coded refusal", async () => {
    const api = client([json({ ...fleet, airlineCode: "OTH" }),
      json({ status: 400, title: "x", code: "invalid_aviation_reference_query" }, 400)]);
    await expect(api.getAirlineFleet({ airlineCode: "ZZA" })).rejects.toBeInstanceOf(ElevantApiError);
    await expect(api.getOccAirportRoutes({ stationId })).rejects.toMatchObject({ status: 400,
      code: "invalid_aviation_reference_query" });
  });
});
