import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, METRES_PER_NM } from '../airport/geo';

// Synthetic answers of the three OCC map reads (contracts 1.3) around Punta Cana at the map lab's noon: the shape of
// the API, with invented hex codes, registrations, callsigns, airline and identifiers. Nothing here comes from a
// provider. The tests and the map lab read them; the services never import this module.
//
// The picture holds an AVIAM arrival on final for runway 08 (ZZ161, matched by registration), other traffic in the air,
// two aircraft on the ground (one inside stand A2, which the ZZ300 visit owns, and one inside A3, whose visit ended), an
// aircraft matched to a flight outside the window and one whose last position is 45 seconds old. The flights add the
// departure of ZZ161, a demo pair not yet imported (ZZ9001/ZZ9002, stand B21 suggested), the parked ZZ300/ZZ301 visit,
// ZZ500 en route with no live position and ZZ700, which already left A3.

export const TRAFFIC_NOON = '2026-11-13T15:00:00.000Z';
const NOON_MS = Date.parse(TRAFFIC_NOON);

/** The instant `seconds` after the map lab's noon, as the API writes it. */
export const trafficInstant = seconds => new Date(NOON_MS + seconds * 1_000).toISOString();

const id = (prefix, number) => `${prefix}-0000-4000-8000-${String(number).padStart(12, '0')}`;

export const TRAFFIC_STATION_ID = id('5a000000', 1);
const AIRLINE_ID = id('5a100000', 1);
const DEMO_FLIGHT_ID = id('5a200000', 9001);
const proposal = number => id('5b000000', number);
const leg = number => id('5c000000', number);
const turnaround = number => id('5d000000', number);
const operation = number => id('5e000000', number);
const standId = code => id('5f000000', code.split('').reduce((sum, char) => sum * 36 + parseInt(char, 36), 0));

/** The invented addresses of the picture's aircraft. */
export const TRAFFIC_HEX = Object.freeze({
  arrival: 'f0a001',
  overflight: 'f0a002',
  groundInOwnedStand: 'f0a003',
  groundOnFreeStand: 'f0a004',
  outsideWindow: 'f0a005',
  stale: 'f0a006',
});

/** The keys of the map flights. */
export const TRAFFIC_FLIGHT_KEY = Object.freeze({
  arrival: `p:${proposal(161)}`,
  departure: `p:${proposal(162)}`,
  demoArrival: `p:${proposal(9001)}`,
  demoDeparture: `p:${proposal(9002)}`,
  parkedArrival: `l:${leg(300)}`,
  parkedDeparture: `l:${leg(301)}`,
  noFix: `l:${leg(500)}`,
  departed: `l:${leg(700)}`,
});

/** A key the picture names that no flight of the window has. */
export const TRAFFIC_KEY_OUTSIDE_WINDOW = `p:${proposal(999)}`;

/** The credit of an invented network: the picture's `source`. */
export const TRAFFIC_SOURCE = Object.freeze({
  name: 'Red ADS-B de prueba',
  homeUrl: 'https://example.org/adsb',
  licenseName: 'Datos sintéticos',
  licenseUrl: null,
});

const PUJ = Object.freeze({ latitude: 18.5674, longitude: -68.3634 });
const ARP = [PUJ.longitude, PUJ.latitude];
const THRESHOLD_08 = [-68.383055, 18.57031];
const KNOT_MS = METRES_PER_NM / 3_600;

const standCenter = code => MDPC_LAYOUT.stands.find(stand => stand.code === code).center;
const nm = miles => miles * METRES_PER_NM;
const round6 = value => Math.round(value * 1e6) / 1e6;
const point = ([lng, lat]) => ({ longitude: round6(lng), latitude: round6(lat) });

/** Where an aircraft was `seconds` before its fix, going back along its track at its ground speed. */
function backtrack(aircraft, seconds) {
  const speedMs = (aircraft.groundSpeedKnots ?? 0) * KNOT_MS;
  const from = [aircraft.longitude, aircraft.latitude];
  const at = speedMs > 0 && aircraft.trackDegrees != null
    ? destinationPoint(from, (aircraft.trackDegrees + 180) % 360, speedMs * seconds)
    : from;
  const climb = (aircraft.verticalRateFeetPerMinute ?? 0) * (seconds / 60);
  return {
    ...point(at),
    altitudeFeet: aircraft.altitudeFeet == null ? null : Math.round(aircraft.altitudeFeet - climb),
    onGround: aircraft.onGround,
  };
}

/** `count` trail points of an aircraft, `stepSeconds` apart, the newest `lastSeconds` before its fix; oldest first. */
function trailOf(aircraft, count, stepSeconds, lastSeconds) {
  const fixAt = Date.parse(aircraft.positionAt);
  return Array.from({ length: count }, (_, index) => {
    const before = lastSeconds + (count - 1 - index) * stepSeconds;
    return { at: new Date(fixAt - before * 1_000).toISOString(), ...backtrack(aircraft, before) };
  });
}

function baseAircraft() {
  const arrival = {
    hex: TRAFFIC_HEX.arrival, callsign: 'ZZZ161', registration: 'ZZ-TST1', typeIcaoCode: 'B38M', category: 'A3',
    ...point(destinationPoint(THRESHOLD_08, 254, nm(8))), altitudeFeet: 2_600, onGround: false, groundSpeedKnots: 150,
    trackDegrees: 74, verticalRateFeetPerMinute: -768, squawk: '4521', positionAt: trafficInstant(-4),
    matchedFlightKey: TRAFFIC_FLIGHT_KEY.arrival, matchedBy: 'Registration', trail: [],
  };
  const overflight = {
    hex: TRAFFIC_HEX.overflight, callsign: 'ZZZ804', registration: 'ZZ-TST2', typeIcaoCode: 'A20N', category: 'A3',
    ...point(destinationPoint(ARP, 45, nm(40))), altitudeFeet: 34_000, onGround: false, groundSpeedKnots: 460,
    trackDegrees: 320, verticalRateFeetPerMinute: 0, squawk: '2000', positionAt: trafficInstant(-6),
    matchedFlightKey: null, matchedBy: null, trail: [],
  };
  // A transponder that gives only its address, parked inside A2: the aircraft of the ZZ300 visit, unrecognised.
  const groundInOwnedStand = {
    hex: TRAFFIC_HEX.groundInOwnedStand, callsign: null, registration: null, typeIcaoCode: null, category: 'A3',
    ...point(standCenter('A2')), altitudeFeet: null, onGround: true, groundSpeedKnots: 0, trackDegrees: null,
    verticalRateFeetPerMinute: null, squawk: null, positionAt: trafficInstant(-8), matchedFlightKey: null,
    matchedBy: null, trail: [],
  };
  const groundOnFreeStand = {
    hex: TRAFFIC_HEX.groundOnFreeStand, callsign: 'ZZZ415', registration: 'ZZ-TST4', typeIcaoCode: 'B738',
    category: 'A3', ...point(standCenter('A3')), altitudeFeet: null, onGround: true, groundSpeedKnots: 3,
    trackDegrees: 174, verticalRateFeetPerMinute: null, squawk: '1200', positionAt: trafficInstant(-5),
    matchedFlightKey: null, matchedBy: null, trail: [],
  };
  const outsideWindow = {
    hex: TRAFFIC_HEX.outsideWindow, callsign: 'ZZZ990', registration: 'ZZ-TST5', typeIcaoCode: 'E190', category: 'A3',
    ...point(destinationPoint(ARP, 190, nm(25))), altitudeFeet: 11_000, onGround: false, groundSpeedKnots: 280,
    trackDegrees: 10, verticalRateFeetPerMinute: -1_200, squawk: '3401', positionAt: trafficInstant(-3),
    matchedFlightKey: TRAFFIC_KEY_OUTSIDE_WINDOW, matchedBy: 'Callsign', trail: [],
  };
  const stale = {
    hex: TRAFFIC_HEX.stale, callsign: 'ZZZ612', registration: 'ZZ-TST6', typeIcaoCode: 'AT76', category: 'A2',
    ...point(destinationPoint(ARP, 95, nm(15))), altitudeFeet: 5_000, onGround: false, groundSpeedKnots: 210,
    trackDegrees: 250, verticalRateFeetPerMinute: -500, squawk: '5210', positionAt: trafficInstant(-45),
    matchedFlightKey: null, matchedBy: null, trail: [],
  };
  // The short trail (trails=short): the last few points the server kept of the arrival and the overflight.
  arrival.trail = trailOf(arrival, 3, 10, 10);
  overflight.trail = trailOf(overflight, 2, 10, 10);
  return [arrival, overflight, groundInOwnedStand, groundOnFreeStand, outsideWindow, stale];
}

/** The aircraft of a picture as they were `seconds` earlier: every instant moved back, nothing else. */
function earlier(aircraft, seconds) {
  const move = value => new Date(Date.parse(value) - seconds * 1_000).toISOString();
  return aircraft.map(item => ({ ...item, positionAt: move(item.positionAt),
    trail: item.trail.map(trailPoint => ({ ...trailPoint, at: move(trailPoint.at) })) }));
}

// What each state of the picture brings besides its status (the api-client validator's rules): Live and Stale carry
// aircraft and the instant they describe; Warming asks again in 2 seconds; Unavailable says why; Disabled has no credit.
function pictureOfStatus(status) {
  const common = { stationId: TRAFFIC_STATION_ID, status, reason: null, serverTime: TRAFFIC_NOON, observedAt: null,
    ageSeconds: null, refreshAfterSeconds: 10, source: TRAFFIC_SOURCE,
    center: { latitude: PUJ.latitude, longitude: PUJ.longitude, radiusNm: 250 }, aircraft: [] };
  switch (status) {
    case 'Live':
      return { ...common, observedAt: trafficInstant(-2), ageSeconds: 2, aircraft: baseAircraft() };
    case 'Stale':
      return { ...common, reason: 'provider_error', observedAt: trafficInstant(-240), ageSeconds: 240,
        refreshAfterSeconds: 30, aircraft: earlier(baseAircraft(), 238) };
    case 'Warming':
      return { ...common, refreshAfterSeconds: 2 };
    case 'Unavailable':
      return { ...common, reason: 'provider_error', refreshAfterSeconds: 30 };
    case 'Disabled':
      return { ...common, reason: 'not_configured', refreshAfterSeconds: 60, source: null };
    default:
      throw new RangeError(`Unknown air picture status: ${status}`);
  }
}

/**
 * An air picture (`trails: short`) at the lab's noon. `overrides` replace top-level fields; with only `status`, the
 * picture of that state is a valid one (Warming, Unavailable and Disabled carry no aircraft).
 */
export function createAirPicture(overrides = {}) {
  return { ...pictureOfStatus(overrides.status ?? 'Live'), ...overrides };
}

const AIRLINE = Object.freeze({ id: AIRLINE_ID, name: 'Zeta Air de prueba', iataCode: 'ZZ', icaoCode: 'ZZZ' });
const MIA = Object.freeze({ iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami International', latitude: 25.7932,
  longitude: -80.2906 });
const JFK = Object.freeze({ iataCode: 'JFK', icaoCode: 'KJFK', name: 'John F. Kennedy International', latitude: 40.6413,
  longitude: -73.7781 });
const YYZ = Object.freeze({ iataCode: 'YYZ', icaoCode: 'CYYZ', name: 'Toronto Pearson', latitude: 43.6777,
  longitude: -79.6248 });
const stand = (code, terminalCode) => ({ id: standId(code), code, terminalCode });
const minutes = count => trafficInstant(count * 60);

// One leg in the shape of the map flights: every key the contract lists, with the values of an empty leg.
function mapLeg(fields) {
  return {
    flightKey: null, visitKey: null, proposalId: null, legId: null, turnaroundId: null, direction: 'Arrival',
    flightNumber: null, callsign: null, airline: AIRLINE, counterpart: null, scheduledAt: null, estimatedAt: null,
    actualAt: null, actualKind: null, phase: 'scheduled', providerStatus: null, aircraft: null, imported: false,
    turnaround: null, stand: null, suggestedStandCode: null, milestones: [], isDemo: false, demo: null,
    ...fields,
  };
}

const DEMO_CLOCK = Object.freeze({
  demoFlightId: DEMO_FLIGHT_ID, state: 'Active', phase: 'Approach', appearAt: minutes(-3),
  // 8 minutes to the stand: taxi-in 45 % of the time between appearing and on-block (3.6 min), within 90 s and 5 min.
  touchdownAt: trafficInstant(84), onBlockAt: minutes(5), scheduledOffBlockAt: minutes(65), offBlockAt: null,
  takeoffAt: null, vanishAt: null,
});

function baseFlights() {
  const visit161 = { id: turnaround(161), operationCode: 'ZZ161-1113', status: 'Confirmed', operationId: operation(161),
    operationStatus: 'Assigned' };
  const visit300 = { id: turnaround(300), operationCode: 'ZZ300-1113', status: 'InProgress', operationId: operation(300),
    operationStatus: 'InProgress' };
  const parked = [{ code: 'BLOCK_ON', actualAt: minutes(-22) }];
  const demoAircraft = { registration: 'ZZ-DMO1', typeIcaoCode: 'A320', model: 'A320-200', sizeCategory: 'Narrowbody' };
  return [
    mapLeg({
      flightKey: TRAFFIC_FLIGHT_KEY.arrival, visitKey: TRAFFIC_FLIGHT_KEY.arrival, proposalId: proposal(161),
      legId: leg(161), turnaroundId: turnaround(161), direction: 'Arrival', flightNumber: 'ZZ161', callsign: 'ZZZ161',
      counterpart: MIA, scheduledAt: minutes(12), estimatedAt: minutes(10), phase: 'approaching',
      providerStatus: 'Approaching',
      aircraft: { registration: 'ZZ-TST1', typeIcaoCode: 'B38M', model: '737 MAX 8', sizeCategory: 'Narrowbody' },
      imported: true, turnaround: visit161, stand: stand('A05', 'A'),
    }),
    mapLeg({
      flightKey: TRAFFIC_FLIGHT_KEY.departure, visitKey: TRAFFIC_FLIGHT_KEY.arrival, proposalId: proposal(162),
      legId: leg(162), turnaroundId: turnaround(161), direction: 'Departure', flightNumber: 'ZZ162', callsign: 'ZZZ162',
      counterpart: MIA, scheduledAt: minutes(75), phase: 'scheduled', providerStatus: 'Expected',
      aircraft: { registration: 'ZZ-TST1', typeIcaoCode: 'B38M', model: '737 MAX 8', sizeCategory: 'Narrowbody' },
      imported: true, turnaround: visit161, stand: stand('A05', 'A'),
    }),
    mapLeg({
      flightKey: TRAFFIC_FLIGHT_KEY.demoArrival, visitKey: TRAFFIC_FLIGHT_KEY.demoArrival, proposalId: proposal(9001),
      direction: 'Arrival', flightNumber: 'ZZ9001', callsign: 'ZZZ9001', counterpart: JFK, scheduledAt: minutes(5),
      estimatedAt: minutes(5), phase: 'approaching', providerStatus: 'Approaching', aircraft: demoAircraft,
      suggestedStandCode: 'B21', isDemo: true, demo: DEMO_CLOCK,
    }),
    mapLeg({
      flightKey: TRAFFIC_FLIGHT_KEY.demoDeparture, visitKey: TRAFFIC_FLIGHT_KEY.demoArrival, proposalId: proposal(9002),
      direction: 'Departure', flightNumber: 'ZZ9002', callsign: 'ZZZ9002', counterpart: JFK, scheduledAt: minutes(65),
      phase: 'scheduled', providerStatus: 'Expected', aircraft: demoAircraft, suggestedStandCode: 'B21', isDemo: true,
      demo: DEMO_CLOCK,
    }),
    mapLeg({
      flightKey: TRAFFIC_FLIGHT_KEY.parkedArrival, visitKey: `t:${turnaround(300)}`, legId: leg(300),
      turnaroundId: turnaround(300), direction: 'Arrival', flightNumber: 'ZZ300', callsign: 'ZZZ300', counterpart: YYZ,
      scheduledAt: minutes(-30), actualAt: minutes(-22), actualKind: 'OnBlock', phase: 'arrived',
      aircraft: { registration: 'ZZ-TST9', typeIcaoCode: 'A320', model: null, sizeCategory: 'Narrowbody' },
      imported: true, turnaround: visit300, stand: stand('A2', 'A'), milestones: parked,
    }),
    mapLeg({
      flightKey: TRAFFIC_FLIGHT_KEY.parkedDeparture, visitKey: `t:${turnaround(300)}`, legId: leg(301),
      turnaroundId: turnaround(300), direction: 'Departure', flightNumber: 'ZZ301', callsign: 'ZZZ301', counterpart: YYZ,
      scheduledAt: minutes(40), phase: 'scheduled',
      aircraft: { registration: 'ZZ-TST9', typeIcaoCode: 'A320', model: null, sizeCategory: 'Narrowbody' },
      imported: true, turnaround: visit300, stand: stand('A2', 'A'), milestones: parked,
    }),
    mapLeg({
      flightKey: TRAFFIC_FLIGHT_KEY.noFix, visitKey: `t:${turnaround(500)}`, legId: leg(500),
      turnaroundId: turnaround(500), direction: 'Arrival', flightNumber: 'ZZ500', callsign: 'ZZZ500', counterpart: MIA,
      scheduledAt: minutes(50), estimatedAt: minutes(48), phase: 'enroute', providerStatus: 'EnRoute',
      aircraft: { registration: 'ZZ-TST7', typeIcaoCode: 'A21N', model: null, sizeCategory: 'Narrowbody' },
      imported: true,
      turnaround: { id: turnaround(500), operationCode: 'ZZ500-1113', status: 'Confirmed', operationId: null,
        operationStatus: null },
      stand: stand('B30', 'B'),
    }),
    mapLeg({
      flightKey: TRAFFIC_FLIGHT_KEY.departed, visitKey: `t:${turnaround(700)}`, legId: leg(700),
      turnaroundId: turnaround(700), direction: 'Departure', flightNumber: 'ZZ700', callsign: 'ZZZ700', counterpart: YYZ,
      scheduledAt: minutes(-15), actualAt: minutes(-8), actualKind: 'Runway', phase: 'departed',
      providerStatus: 'Departed',
      aircraft: { registration: 'ZZ-TST8', typeIcaoCode: 'B738', model: null, sizeCategory: 'Narrowbody' },
      imported: true,
      turnaround: { id: turnaround(700), operationCode: 'ZZ700-1113', status: 'InProgress', operationId: operation(700),
        operationStatus: 'PendingReview' },
      stand: stand('A3', 'A'), milestones: [{ code: 'PUSHBACK', actualAt: minutes(-14) }],
    }),
  ];
}

/** The map flights of the lab's station at its noon (window 2 hours back, 12 ahead); `overrides` replace fields. */
export function createMapFlights(overrides = {}) {
  return {
    stationId: TRAFFIC_STATION_ID, stationCode: 'PUJ', serverTime: TRAFFIC_NOON, windowFrom: minutes(-120),
    windowTo: minutes(720),
    stationAirport: { iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana International', ...PUJ },
    flights: baseFlights(),
    ...overrides,
  };
}

/**
 * The track of one aircraft of the Live picture: `count` points `stepSeconds` apart, the last one at its fix, as the
 * server's memory would hold them while it flew its present track.
 */
export function createTrack(hex, { count = 30, stepSeconds = 10 } = {}) {
  const aircraft = baseAircraft().find(item => item.hex === hex);
  if (!aircraft) throw new RangeError(`No synthetic aircraft ${hex}`);
  return { hex, serverTime: TRAFFIC_NOON, source: TRAFFIC_SOURCE, points: trailOf(aircraft, count, stepSeconds, 0) };
}

/**
 * Positions a caller estimates for ELEVANT flights without a live fix (M6 computes them): the demo arrival 6 NM out on
 * final for runway 08. In the map model's units: metres, metres per second, degrees.
 */
export function createEstimates() {
  const [lon, lat] = destinationPoint(THRESHOLD_08, 254, nm(6));
  return [{ flightKey: TRAFFIC_FLIGHT_KEY.demoArrival, lon: round6(lon), lat: round6(lat), altM: 580, gsMs: 72,
    trackDeg: 74, vrateMs: -3.6, onGround: false }];
}

/**
 * The scenario of the simulated adapter (src/services/occMapService.js): the Live picture, the flights and one track
 * per aircraft, written at the lab's noon. `overrides` replace parts (`picture`, `flights`, `tracks`, `at`).
 */
export function createTrafficScenario(overrides = {}) {
  return {
    at: TRAFFIC_NOON,
    picture: createAirPicture(),
    flights: createMapFlights(),
    tracks: Object.fromEntries(Object.values(TRAFFIC_HEX).map(hex => [hex, createTrack(hex)])),
    ...overrides,
  };
}
