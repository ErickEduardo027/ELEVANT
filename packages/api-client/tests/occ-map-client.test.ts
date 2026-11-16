import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  FLIGHT_REPORT_MILESTONES,
  isOccAircraftTrack,
  isOccAirPicture,
  isOccMapFlights,
  normalizedOccAircraftTrackQuery,
  normalizedOccAirPictureQuery,
  normalizedOccMapFlightsQuery,
  OCC_AIR_PICTURE_REASONS,
  OCC_AIR_PICTURE_STATUSES,
  OCC_MAP_FLIGHT_PHASES,
  type OccAircraftTrackQuery,
  type OccAirPictureQuery,
  type OccMapFlightsQuery,
} from "../src";

// ADR-0042 (contracts 1.3): the three reads of the OCC map. Synthetic answers only (invented addresses, flights and
// positions); no network and no provider is involved.
const stationId = "20000000-0000-7000-8000-000000000003";
const otherStationId = "20000000-0000-7000-8000-000000000004";
const airlineId = "21000000-0000-7000-8000-000000000001";
const proposalId = "0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b60";
const openProposalId = "0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b61";
const demoProposalId = "0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b62";
const legId = "70000000-0000-7000-8000-000000000021";
const manualLegId = "70000000-0000-7000-8000-000000000022";
const turnaroundId = "70000000-0000-7000-8000-000000000012";
const manualTurnaroundId = "70000000-0000-7000-8000-000000000013";
const operationId = "70000000-0000-7000-8000-000000000031";
const standId = "23000000-0000-7000-8000-000000000001";
const demoFlightId = "0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6a";
const at = (minute: number, second = 0) =>
  `2026-11-13T15:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+00:00`;

const source = { name: "adsb.fi", homeUrl: "https://adsb.fi", licenseName: "Uso personal y no comercial", licenseUrl: null };
const center = { latitude: 18.5674, longitude: -68.3634, radiusNm: 250 };
const point = (second: number, latitude: number) =>
  ({ at: at(0, second), latitude, longitude: -68.36, altitudeFeet: 2500, onGround: false });
/** An arrival the server recognised by its callsign, with the last two points of its trail. */
const arriving = {
  hex: "0c0001", callsign: "DZZ171", registration: "HI1002", typeIcaoCode: "A320", category: "A3", latitude: 18.5,
  longitude: -68.36, altitudeFeet: 2500, onGround: false, groundSpeedKnots: 150.5, trackDegrees: 80.25,
  verticalRateFeetPerMinute: -600, squawk: "1200", positionAt: at(0, 10), matchedFlightKey: `p:${openProposalId}`,
  matchedBy: "Callsign", trail: [point(0, 18.4), point(10, 18.5)],
};
/** Other traffic on the ground, far from the station: no flight, nothing but its position. */
const grounded = {
  hex: "0c0002", callsign: null, registration: null, typeIcaoCode: null, category: null, latitude: 22.6,
  longitude: -64.1, altitudeFeet: null, onGround: true, groundSpeedKnots: null, trackDegrees: null,
  verticalRateFeetPerMinute: null, squawk: null, positionAt: at(0, 9), matchedFlightKey: null, matchedBy: null, trail: [],
};
const live = {
  stationId, status: "Live", reason: null, serverTime: "2026-11-13T15:00:12.1234567+00:00", observedAt: at(0, 10),
  ageSeconds: 2, refreshAfterSeconds: 10, source, center, aircraft: [arriving, grounded],
};
const disabled = { stationId, status: "Disabled", reason: "not_configured", serverTime: at(0, 12), observedAt: null,
  ageSeconds: null, refreshAfterSeconds: 60, source: null, center, aircraft: [] };
const warming = { ...disabled, status: "Warming", reason: null, refreshAfterSeconds: 2, source };
const stale = { ...live, status: "Stale", reason: "rate_limited", ageSeconds: 300, refreshAfterSeconds: 60 };
const unavailable = { ...disabled, status: "Unavailable", reason: "provider_error", refreshAfterSeconds: 15, source };
const track = { hex: "0c0001", serverTime: at(0, 12), source, points: [point(0, 18.4), point(10, 18.5)] };

const airline = { id: airlineId, name: "Demo Airlines", iataCode: "ZZ", icaoCode: "DZZ" };
const miami = { iataCode: "MIA", icaoCode: "KMIA", name: "Miami International Airport", latitude: 25.7959,
  longitude: -80.287 };
const demoClock = { demoFlightId, state: "Active", phase: "Parked", appearAt: at(0), touchdownAt: at(4, 24),
  onBlockAt: at(8), scheduledOffBlockAt: "2026-11-13T16:08:00+00:00", offBlockAt: null, takeoffAt: null, vanishAt: null };
/** An imported demo arrival on its stand: BLOCK_ON recorded, landed on the runway, the demo clock. */
const imported = {
  flightKey: `p:${proposalId}`, visitKey: `p:${proposalId}`, proposalId, legId, turnaroundId, direction: "Arrival",
  flightNumber: "ZZ9001", callsign: "DZZ9001", airline, counterpart: miami, scheduledAt: at(8), estimatedAt: at(8),
  actualAt: at(4, 24), actualKind: "Runway", phase: "landed", providerStatus: "Arrived",
  aircraft: { registration: "HIDM01", typeIcaoCode: "A320", model: "Airbus A320", sizeCategory: "Narrowbody" },
  imported: true, turnaround: { id: turnaroundId, operationCode: "PUJ-20261113-001", status: "Confirmed", operationId,
    operationStatus: "InProgress" },
  stand: { id: standId, code: "A1", terminalCode: "A" }, suggestedStandCode: null,
  milestones: [{ code: "BLOCK_ON", actualAt: at(8) }], isDemo: true, demo: demoClock,
};
/** An open proposal of the feed: nothing of OCC yet. */
const open = {
  flightKey: `p:${openProposalId}`, visitKey: `p:${openProposalId}`, proposalId: openProposalId, legId: null,
  turnaroundId: null, direction: "Arrival", flightNumber: "ZZ0171", callsign: "DZZ171", airline, counterpart: null,
  scheduledAt: at(30), estimatedAt: null, actualAt: null, actualKind: null, phase: "scheduled", providerStatus: "Expected",
  aircraft: null, imported: false, turnaround: null, stand: null, suggestedStandCode: null, milestones: [], isDemo: false,
  demo: null,
};
/** A departure OCC typed by hand: keyed by its leg and its turnaround, recorded on the stand. */
const manual = {
  ...imported, flightKey: `l:${manualLegId}`, visitKey: `t:${manualTurnaroundId}`, proposalId: null, legId: manualLegId,
  turnaroundId: manualTurnaroundId, direction: "Departure", flightNumber: "ZZ0912", callsign: "DZZ912", counterpart: null,
  scheduledAt: at(50), estimatedAt: null, actualAt: null, actualKind: null, phase: "scheduled", providerStatus: null,
  aircraft: null, turnaround: { id: manualTurnaroundId, operationCode: "PUJ-20261113-002", status: "Scheduled",
    operationId: null, operationStatus: null },
  stand: null, milestones: [], isDemo: false, demo: null,
};
/** A demo flight nobody imported yet: the stand it was triggered for and its clock. */
const demoProposal = { ...open, flightKey: `p:${demoProposalId}`, visitKey: `p:${demoProposalId}`,
  proposalId: demoProposalId, flightNumber: "ZZ9003", callsign: "DZZ9003", phase: "approaching",
  providerStatus: "Approaching", suggestedStandCode: "A01", isDemo: true,
  demo: { ...demoClock, demoFlightId: "0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6b", phase: "Approach" } };
const flights = {
  stationId, stationCode: "PUJ", serverTime: at(0), windowFrom: "2026-11-13T13:00:00+00:00",
  windowTo: "2026-11-14T03:00:00+00:00",
  stationAirport: { iataCode: "PUJ", icaoCode: "MDPC", name: "Punta Cana International Airport", latitude: 18.5674,
    longitude: -68.3634 },
  flights: [imported, open, manual, demoProposal],
};

type Call = { url: string; method: string; headers: Headers };

function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
        headers: new Headers(init?.headers) });
      return answers.shift()!;
    } });
}

/** Drops one key from a copy, as a server leaving a null value out would. */
const without = <T extends Record<string, unknown>>(value: T, key: keyof T) => {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key as string];
  return copy;
};

describe("OCC map client (ADR-0042)", () => {
  it("reads the air picture strictly, its state included", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(live), Response.json(warming), Response.json({ ...live,
      aircraft: [{ ...arriving, trail: [] }, grounded] })], calls);
    await expect(api.getOccAirPicture({ stationId: stationId.toUpperCase() })).resolves.toEqual(live);
    await expect(api.getOccAirPicture({ stationId, trails: "short" })).resolves.toEqual(warming);
    await expect(api.getOccAirPicture({ stationId, trails: "none" })).resolves.toMatchObject({ status: "Live" });
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ["GET", `/api/v1/occ/map/air-picture?stationId=${stationId}`],
      ["GET", `/api/v1/occ/map/air-picture?stationId=${stationId}&trails=short`],
      ["GET", `/api/v1/occ/map/air-picture?stationId=${stationId}&trails=none`],
    ]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");

    // Every state the server answers, with or without the keys it may leave out (null where the contract says null).
    for (const picture of [live, disabled, warming, stale, unavailable, { ...stale, reason: null },
      { ...unavailable, observedAt: at(0), ageSeconds: 700 }, without(live, "reason"), without(disabled, "source"),
      without(warming, "observedAt"), { ...live, aircraft: [] },
      { ...live, aircraft: [without(grounded, "squawk")] }, { ...live, source: { ...source, licenseUrl: "https://example.test/licence" } }])
      expect(isOccAirPicture(picture, stationId)).toBe(true);
    expect(OCC_AIR_PICTURE_STATUSES).toEqual(["Live", "Stale", "Warming", "Unavailable", "Disabled"]);
    expect(OCC_AIR_PICTURE_REASONS).toHaveLength(5);

    // Unknown keys at every level, states and reasons outside their lists, a pace out of 2 or 10..60, a ninth trail point,
    // a missing required key, an address that is not six lower-case hexadecimal digits, a position off the Earth.
    for (const bad of [
      { ...live, budget: 1 }, { ...live, source: { ...source, logo: "x" } }, { ...live, center: { ...center, zoom: 9 } },
      { ...live, aircraft: [{ ...arriving, heading: 80 }] }, { ...live, aircraft: [{ ...arriving, trail: [{ ...point(0, 18.4),
        speed: 150 }] }] },
      { ...live, status: "Cached" }, { ...live, status: "live" }, { ...stale, reason: "network_down" },
      { ...live, refreshAfterSeconds: 9 }, { ...live, refreshAfterSeconds: 61 }, { ...live, refreshAfterSeconds: 2 },
      { ...warming, refreshAfterSeconds: 10 }, { ...live, refreshAfterSeconds: 10.5 },
      { ...live, aircraft: [{ ...arriving, trail: Array.from({ length: 9 }, (_, index) => point(index, 18.4)) }] },
      without(live, "center"), without(live, "serverTime"), without(live, "aircraft"),
      { ...live, aircraft: [{ ...arriving, hex: "0C0001" }] }, { ...live, aircraft: [{ ...arriving, hex: "~0c001" }] },
      { ...live, aircraft: [{ ...arriving, latitude: 91 }] }, { ...live, aircraft: [{ ...arriving, longitude: -181 }] },
      { ...live, aircraft: [{ ...arriving, latitude: "18.5" }] }, { ...live, center: { ...center, radiusNm: 251 } },
      { ...live, aircraft: [{ ...arriving, altitudeFeet: 2500.5 }] }, { ...live, aircraft: [{ ...arriving, squawk: "7800" }] },
      { ...live, aircraft: [{ ...arriving, matchedBy: "Position" }] }, { ...live, aircraft: [{ ...arriving, matchedBy: null }] },
      { ...live, aircraft: [{ ...arriving, matchedFlightKey: `x:${openProposalId}` }] },
      { ...live, aircraft: [{ ...arriving, trail: [point(10, 18.5), point(0, 18.4)] }] },
      { ...live, aircraft: [arriving, arriving] }, { ...live, source: { ...source, homeUrl: "http://adsb.fi" } },
      // The state and its parts disagree: a live picture with a reason, a disabled one with a credit or aircraft, a
      // warming one with an age, an unavailable one without a reason or with aircraft.
      { ...live, reason: "provider_error" }, { ...disabled, source }, { ...disabled, reason: "provider_error" },
      { ...disabled, aircraft: [grounded] }, { ...warming, observedAt: at(0), ageSeconds: 12 },
      { ...unavailable, reason: null }, { ...unavailable, aircraft: [grounded] }, { ...live, ageSeconds: null },
      without(live, "observedAt"), { ...stale, reason: "not_configured" },
    ])
      expect(isOccAirPicture(bad, stationId)).toBe(false);
    // Another station's picture, and trails where none were asked for.
    expect(isOccAirPicture(live, otherStationId)).toBe(false);
    expect(isOccAirPicture(live, stationId, "none")).toBe(false);
    expect(isOccAirPicture({ ...live, aircraft: [{ ...arriving, trail: [] }, grounded] }, stationId, "none")).toBe(true);

    const malformed = client([Response.json({ ...live, extra: true }), Response.json({ ...live, stationId: otherStationId }),
      Response.json(live)]);
    await expect(malformed.getOccAirPicture({ stationId })).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(malformed.getOccAirPicture({ stationId })).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(malformed.getOccAirPicture({ stationId, trails: "none" })).rejects.toMatchObject({
      kind: "malformed-response" });
  });

  it("reads an aircraft's track of the address asked for", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(track), Response.json({ ...track, hex: "0c0002" })], calls);
    await expect(api.getOccAircraftTrack({ stationId, hex: "0C0001" })).resolves.toEqual(track);
    await expect(api.getOccAircraftTrack({ stationId, hex: "0c0001" })).rejects.toMatchObject({
      kind: "malformed-response" });
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ["GET", `/api/v1/occ/map/aircraft/0c0001/track?stationId=${stationId}`],
      ["GET", `/api/v1/occ/map/aircraft/0c0001/track?stationId=${stationId}`],
    ]);

    expect(isOccAircraftTrack(track, "0c0001")).toBe(true);
    expect(isOccAircraftTrack(without(track, "source"), "0C0001")).toBe(true);
    expect(isOccAircraftTrack({ ...track, points: Array.from({ length: 600 }, () => point(0, 18.4)) })).toBe(true);
    for (const bad of [{ ...track, extra: 1 }, { ...track, hex: "0c001" },
      { ...track, points: Array.from({ length: 601 }, () => point(0, 18.4)) },
      { ...track, points: [point(10, 18.5), point(0, 18.4)] }, { ...track, points: [{ ...point(0, 18.4), leg: 1 }] },
      { ...track, source: { ...source, licenseName: "" } }, without(track, "points")])
      expect(isOccAircraftTrack(bad)).toBe(false);
    expect(isOccAircraftTrack(track, "0c0002")).toBe(false);
  });

  it("reads the map flights strictly, keys, milestones and demo clock included", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(flights), Response.json(flights), Response.json(flights)], calls);
    await expect(api.getOccMapFlights({ stationId })).resolves.toEqual(flights);
    await expect(api.getOccMapFlights({ stationId, hoursBack: 0, hoursAhead: 36 })).resolves.toEqual(flights);
    await expect(api.getOccMapFlights({ stationId: stationId.toUpperCase(), hoursBack: 24, hoursAhead: 1 }))
      .resolves.toEqual(flights);
    expect(calls.map(call => call.url)).toEqual([
      `/api/v1/occ/map/flights?stationId=${stationId}`,
      `/api/v1/occ/map/flights?stationId=${stationId}&hoursBack=0&hoursAhead=36`,
      `/api/v1/occ/map/flights?stationId=${stationId}&hoursBack=24&hoursAhead=1`,
    ]);

    // The keys the server may leave out where they are null, every phase and a flight with all 25 milestones.
    const everyMilestone = FLIGHT_REPORT_MILESTONES.map((milestone, index) =>
      ({ code: milestone.code, actualAt: at(10, index) }));
    for (const valid of [{ ...flights, flights: [] }, { ...flights, flights: [without(open, "counterpart")] },
      { ...flights, flights: [{ ...imported, milestones: everyMilestone }] },
      { ...flights, stationAirport: { ...flights.stationAirport, latitude: null, longitude: null } },
      ...OCC_MAP_FLIGHT_PHASES.map(phase => ({ ...flights, flights: [{ ...open, phase }] }))])
      expect(isOccMapFlights(valid, stationId)).toBe(true);

    const flight = (changes: Record<string, unknown>) => ({ ...flights, flights: [{ ...imported, ...changes }] });
    for (const bad of [
      // Unknown keys at every level.
      { ...flights, extra: 1 }, { ...flights, stationAirport: { ...flights.stationAirport, elevation: 47 } },
      flight({ runway: "08" }), flight({ airline: { ...airline, logo: "x" } }), flight({ counterpart: { ...miami, city: "x" } }),
      flight({ aircraft: { ...imported.aircraft, seats: 180 } }), flight({ turnaround: { ...imported.turnaround, version: "x" } }),
      flight({ stand: { ...imported.stand, latitude: 18.56 } }), flight({ milestones: [{ code: "BLOCK_ON", actualAt: at(8),
        by: "x" }] }), flight({ demo: { ...demoClock, runway: "08" } }),
      // Values outside their closed lists.
      flight({ phase: "landing" }), flight({ phase: "Landed" }), flight({ direction: "Transit" }),
      flight({ actualKind: "Gate" }), flight({ demo: { ...demoClock, state: "Paused" } }),
      flight({ demo: { ...demoClock, phase: "Cruise" } }), flight({ aircraft: { ...imported.aircraft, sizeCategory: "Huge" } }),
      flight({ turnaround: { ...imported.turnaround, status: "Open" } }),
      flight({ turnaround: { ...imported.turnaround, operationStatus: "Paused" } }),
      // Milestones: an unknown code, the same one twice, more than the report has.
      flight({ milestones: [{ code: "LANDED", actualAt: at(8) }] }),
      flight({ milestones: [{ code: "BLOCK_ON", actualAt: at(8) }, { code: "BLOCK_ON", actualAt: at(9) }] }),
      flight({ milestones: [...everyMilestone, { code: "BLOCK_ON", actualAt: at(9) }] }),
      // Keys and parts that disagree.
      flight({ flightKey: `x:${proposalId}` }), flight({ flightKey: `p:${proposalId.toUpperCase()}` }),
      flight({ visitKey: `l:${legId}` }), flight({ flightKey: `l:${manualLegId}` }), flight({ actualKind: null }),
      flight({ actualAt: null }), flight({ turnaround: null }), flight({ legId: null }), flight({ suggestedStandCode: "A1" }),
      flight({ turnaround: { ...imported.turnaround, id: manualTurnaroundId } }), flight({ isDemo: false }),
      flight({ turnaround: { ...imported.turnaround, operationStatus: null } }), flight({ callsign: "ZZ9001" }),
      { ...flights, flights: [{ ...open, flightKey: `p:${proposalId}` }] }, { ...flights, flights: [{ ...open, legId }] },
      { ...flights, flights: [{ ...open, milestones: [{ code: "BLOCK_ON", actualAt: at(8) }] }] },
      { ...flights, flights: [{ ...open, suggestedStandCode: "A01" }] }, { ...flights, flights: [{ ...open, visitKey:
        `t:${turnaroundId}` }] },
      { ...flights, flights: [open, open] }, { ...flights, windowFrom: flights.windowTo, windowTo: flights.windowFrom },
      { ...flights, stationAirport: { ...flights.stationAirport, longitude: null } }, without(flights, "stationAirport"),
      { ...flights, flights: [without(open, "phase")] }, { ...flights, flights: [{ ...open, imported: "no" }] },
    ])
      expect(isOccMapFlights(bad, stationId)).toBe(false);
    expect(isOccMapFlights(flights, otherStationId)).toBe(false);

    const malformed = client([Response.json({ ...flights, stationId: otherStationId }), Response.json({ ...flights,
      flights: [{ ...open, phase: "boarding" }] })]);
    await expect(malformed.getOccMapFlights({ stationId })).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(malformed.getOccMapFlights({ stationId })).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("checks every query before it is sent", async () => {
    const calls: Call[] = [];
    const api = client([], calls);
    for (const query of [{ stationId: "PUJ" }, { stationId, trails: "long" }, { stationId, trails: "SHORT" },
      { stationId, trails: "" }, { stationId, zoom: 9 }, { stationId: "00000000-0000-0000-0000-000000000000" }])
      await expect(api.getOccAirPicture(query as OccAirPictureQuery)).rejects.toThrow(TypeError);
    for (const query of [{ stationId, hex: "0c001" }, { stationId, hex: "0c00011" }, { stationId, hex: "zzzzzz" },
      { stationId, hex: "~0c001" }, { stationId, hex: " 0c0001" }, { stationId, hex: "../ping" }, { stationId },
      { hex: "0c0001" }, { stationId, hex: "0c0001", trails: "none" }])
      await expect(api.getOccAircraftTrack(query as OccAircraftTrackQuery)).rejects.toThrow(TypeError);
    for (const query of [{ stationId, hoursBack: -1 }, { stationId, hoursBack: 25 }, { stationId, hoursBack: 1.5 },
      { stationId, hoursAhead: 0 }, { stationId, hoursAhead: 37 }, { stationId, hoursAhead: "12" },
      { stationId, hoursBack: Number.NaN }, { stationId, date: "2026-11-13" }, {}])
      await expect(api.getOccMapFlights(query as OccMapFlightsQuery)).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);

    // What is valid is normalized: lower-case ids and addresses, absent choices left to the server's defaults.
    expect(normalizedOccAirPictureQuery({ stationId: stationId.toUpperCase(), trails: null })).toEqual({ stationId });
    expect(normalizedOccAirPictureQuery({ stationId, trails: "none" })).toEqual({ stationId, trails: "none" });
    expect(normalizedOccAircraftTrackQuery({ stationId, hex: "ABCDEF" })).toEqual({ stationId, hex: "abcdef" });
    expect(normalizedOccMapFlightsQuery({ stationId, hoursBack: null, hoursAhead: 1 })).toEqual({ stationId, hoursAhead: 1 });
    expect(normalizedOccMapFlightsQuery({ stationId, hoursBack: 0 })).toEqual({ stationId, hoursBack: 0 });
  });

  it("keeps the map's problem codes", async () => {
    const problem = (status: number, code: string) => Response.json(
      { title: "La consulta del mapa no es válida.", status, code },
      { status, headers: { "content-type": "application/problem+json" } });
    const api = client([problem(400, "invalid_map_query"), problem(404, "not_found"), problem(403, "forbidden")]);

    const invalid = await api.getOccMapFlights({ stationId }).catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(ElevantApiError);
    expect(invalid).toMatchObject({ kind: "http", status: 400, code: "invalid_map_query" });
    await expect(api.getOccAircraftTrack({ stationId, hex: "0c0009" })).rejects.toMatchObject({ status: 404,
      code: "not_found" });
    await expect(api.getOccAirPicture({ stationId })).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});
