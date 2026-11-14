import { parseInstant } from '../../../services/serverClock';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, METRES_PER_NM } from '../airport/geo';
import {
  createAirPicture, createMapFlights, createTrack, TRAFFIC_FLIGHT_KEY as KEY, TRAFFIC_HEX as HEX, TRAFFIC_NOON,
  trafficInstant,
} from '../testing/trafficFixtures';
import { buildRoute, trailSegmentsOf } from '../traffic/routeFeatures';
import { buildSituation, selectionTarget, toFlightsModel, toPictureModel, toTrackModel } from '../traffic/situationModel';
import { createTrailStore, trailFeatures } from '../traffic/trailStore';

// The traffic of the map lab's scenes (PR M5): synthetic air pictures, map flights and tracks at the lab's noon, in the
// shape of the API (contracts 1.3), built on the fixtures of maps/testing/trafficFixtures.js. Invented hex codes,
// registrations and callsigns; nothing comes from a provider. The lab draws them without polling: the situation is built
// once, at the frozen clock (labTraffic). Pure data.
//
// - region-traffic-mixed: an AVIAM arrival on final and a departure climbing out, a dozen other aircraft across the
//   region (every icon category) and one whose position is 45 s old;
// - approach-traffic-demo: the demo arrival estimated 4.5 NM out on final for 08 (its «Demo» plate, its «est.» ring
//   and its dashed estimated path), the live arrival on base and other traffic around the approach;
// - ramp-traffic-ground: the arrival taxiing to A4 (GND), a departure on A6, a transponder hidden inside A1 (the
//   ZZ300 visit holds it) and other traffic taxiing out on taxiway B;
// - approach-traffic-estimated-stale: the air picture four minutes late (every aircraft dimmed with its age, and the
//   chip that says so) and an ELEVANT flight drawn from an estimate;
// - region-traffic-selected and region-layers-menu: the region's mixed traffic, with ZZ161 chosen (its data block and
//   its route) or with the layers menu open;
// - approach-traffic-hex-selected: the approach with another airline's aircraft chosen by its address, with the track
//   the server keeps of it.

const ARP = Object.freeze([-68.3634, 18.5674]);
const THRESHOLD_08 = Object.freeze([-68.383055, 18.57031]);
const FINAL_08 = 254;
const KNOT_MS = METRES_PER_NM / 3_600;
const round6 = value => Math.round(value * 1e6) / 1e6;
const uuid = (prefix, number) => `${prefix}-0000-4000-8000-${String(number).padStart(12, '0')}`;
const standCentre = code => MDPC_LAYOUT.stands.find(stand => stand.code === code).center;

/** Where an aircraft was `seconds` before its fix, going back along its track at its speed (and its climb). */
function behind(aircraft, seconds) {
  const from = [aircraft.longitude, aircraft.latitude];
  const speed = (aircraft.groundSpeedKnots ?? 0) * KNOT_MS;
  const [longitude, latitude] = speed > 0 && aircraft.trackDegrees != null
    ? destinationPoint(from, (aircraft.trackDegrees + 180) % 360, speed * seconds) : from;
  const climb = ((aircraft.verticalRateFeetPerMinute ?? 0) * seconds) / 60;
  return { latitude: round6(latitude), longitude: round6(longitude),
    altitudeFeet: aircraft.altitudeFeet == null ? null : Math.max(0, Math.round(aircraft.altitudeFeet - climb)),
    onGround: aircraft.onGround };
}

/** `count` points `stepSeconds` apart, the newest `lastSeconds` before the fix, oldest first. */
function pointsBehind(aircraft, count, stepSeconds, lastSeconds = 0) {
  const fixAt = parseInstant(aircraft.positionAt);
  return Array.from({ length: count }, (_, index) => {
    const before = lastSeconds + (count - 1 - index) * stepSeconds;
    return { at: new Date(fixAt - before * 1_000).toISOString(), ...behind(aircraft, before) };
  });
}

/**
 * One aircraft of an air picture: `at` ([lng, lat]) or `bearing` and `nm` from `from` (the ARP by default); speeds in
 * knots, altitudes in feet, its fix `ageS` seconds before noon and a short trail of up to eight points.
 */
function aircraft({
  hex, callsign = null, registration = null, type = null, category = null, at = null, from = ARP, bearing = 0, nm = 0,
  altitude = null, speed = null, track = null, vrate = null, onGround = false, squawk = null, ageS = 5, key = null,
  matchedBy = null, trail = 4,
}) {
  const [longitude, latitude] = at ?? destinationPoint(from, bearing, nm * METRES_PER_NM);
  const item = {
    hex, callsign, registration, typeIcaoCode: type, category, latitude: round6(latitude), longitude: round6(longitude),
    altitudeFeet: altitude, onGround, groundSpeedKnots: speed, trackDegrees: track, verticalRateFeetPerMinute: vrate, squawk,
    positionAt: trafficInstant(-ageS), matchedFlightKey: key, matchedBy, trail: [],
  };
  item.trail = trail > 0 ? pointsBehind(item, trail, 10, 10) : [];
  return item;
}

/** The track the server's memory would hold of an aircraft: `count` points 10 s apart up to its fix. */
const trackOf = (item, count = 30) => ({ hex: item.hex, serverTime: TRAFFIC_NOON, source: null,
  points: pointsBehind(item, count, 10) });

// Other traffic across the region: every icon category, at the heights and speeds of their phase of flight.
const REGION_OTHERS = Object.freeze([
  { hex: 'f0b001', callsign: 'ZZZ330', registration: 'ZZ-TRB1', type: 'B77W', category: 'A5', bearing: 330, nm: 150,
    altitude: 37_000, speed: 480, track: 140, vrate: 0 },
  { hex: 'f0b002', callsign: 'ZZZ744', registration: 'ZZ-TRB2', type: 'B744', category: 'A5', bearing: 205, nm: 175,
    altitude: 35_000, speed: 470, track: 20, vrate: 0 },
  { hex: 'f0b003', callsign: 'ZZZ211', registration: 'ZZ-TRB3', type: 'A21N', category: 'A3', bearing: 280, nm: 90,
    altitude: 24_000, speed: 410, track: 95, vrate: -1_500 },
  { hex: 'f0b004', callsign: 'ZZZ381', registration: 'ZZ-TRB4', type: 'B38M', category: 'A3', bearing: 60, nm: 120,
    altitude: 31_000, speed: 450, track: 250, vrate: -500 },
  { hex: 'f0b005', callsign: 'ZZZ190', registration: 'ZZ-TRB5', type: 'E190', category: 'A3', bearing: 250, nm: 60,
    altitude: 17_000, speed: 330, track: 70, vrate: -1_800 },
  { hex: 'f0b006', callsign: 'ZZZ720', registration: 'ZZ-TRB6', type: 'AT76', category: 'A2', bearing: 300, nm: 32,
    altitude: 9_000, speed: 240, track: 120, vrate: -900 },
  { hex: 'f0b007', callsign: 'ZZZ900', registration: 'ZZ-TRB7', type: 'CRJ9', category: 'A3', bearing: 165, nm: 140,
    altitude: 29_000, speed: 430, track: 340, vrate: 0 },
  { hex: 'f0b008', callsign: 'ZZZ505', registration: 'ZZ-TRB8', type: 'GLF5', category: 'A2', bearing: 20, nm: 75,
    altitude: 41_000, speed: 470, track: 200, vrate: 0 },
  { hex: 'f0b009', callsign: null, registration: 'ZZ-TRB9', type: 'C172', category: 'A1', bearing: 268, nm: 24,
    altitude: 3_500, speed: 105, track: 300, vrate: 0 },
  { hex: 'f0b00a', callsign: 'ZZZ7', registration: 'ZZ-TRBA', type: 'EC45', category: 'A7', bearing: 225, nm: 12,
    altitude: 1_500, speed: 120, track: 60, vrate: 0 },
  { hex: 'f0b00b', callsign: null, registration: null, type: null, category: null, bearing: 120, nm: 200,
    altitude: 33_000, speed: 460, track: 300, vrate: 0 },
].map(Object.freeze));

// ZZ700 left A3 eight minutes ago for Toronto: climbing north on its way out.
const DEPARTURE = Object.freeze({ hex: 'f0a007', callsign: 'ZZZ700', registration: 'ZZ-TST8', type: 'B738', category: 'A3',
  bearing: 18, nm: 30, altitude: 14_000, speed: 310, track: 345, vrate: 1_600, squawk: '3312', key: KEY.departed,
  matchedBy: 'Registration' });

function regionScenario() {
  const base = createAirPicture();
  const departure = aircraft(DEPARTURE);
  const others = REGION_OTHERS.map(aircraft);
  return {
    at: TRAFFIC_NOON,
    picture: { ...base, aircraft: [...base.aircraft, departure, ...others] },
    flights: createMapFlights(),
    tracks: { [HEX.arrival]: createTrack(HEX.arrival), [departure.hex]: trackOf(departure) },
    estimates: [],
    estimatedTrails: [],
  };
}

// The demo arrival 4.5 NM out on final for 08, as an estimate from its schedule (PR M6 computes these), and the path
// it flew on the way: estimated too, so dashed.
const DEMO_OUT_NM = 4.5;
function demoEstimate() {
  const [lon, lat] = destinationPoint(THRESHOLD_08, FINAL_08, DEMO_OUT_NM * METRES_PER_NM);
  return { flightKey: KEY.demoArrival, lon: round6(lon), lat: round6(lat), altM: 440, gsMs: 70, trackDeg: 74, vrateMs: -3.5,
    onGround: false, positionAt: parseInstant(TRAFFIC_NOON) };
}

function estimatedPath(flightKey, from, to, steps = 8) {
  const coordinates = Array.from({ length: steps + 1 }, (_, index) => {
    const share = index / steps;
    return [round6(from[0] + (to[0] - from[0]) * share), round6(from[1] + (to[1] - from[1]) * share)];
  });
  return { type: 'Feature', properties: { id: `${flightKey}:estimated`, hex: '', kind: 'aviam', quality: 'estimated',
    selected: false }, geometry: { type: 'LineString', coordinates } };
}

const APPROACH_OTHERS = Object.freeze([
  // Out of runway 08 and turning east, and another airline's arrival on downwind for 08.
  { hex: 'f0c001', callsign: 'ZZZ124', registration: 'ZZ-TRC1', type: 'A20N', category: 'A3', bearing: 78, nm: 9,
    altitude: 7_000, speed: 260, track: 82, vrate: 1_800 },
  { hex: 'f0c002', callsign: 'ZZZ880', registration: 'ZZ-TRC2', type: 'B738', category: 'A3', bearing: 330, nm: 12,
    altitude: 5_000, speed: 210, track: 254, vrate: -700 },
  { hex: 'f0c003', callsign: 'ZZZ7', registration: 'ZZ-TRBA', type: 'EC45', category: 'A7', bearing: 200, nm: 14,
    altitude: 1_200, speed: 115, track: 30, vrate: 0 },
].map(Object.freeze));

// ZZ161, the live AVIAM arrival, on base for 08 from the south-west: its trail and the demo's path stay apart.
const ARRIVAL_ON_BASE = Object.freeze({ hex: HEX.arrival, callsign: 'ZZZ161', registration: 'ZZ-TST1', type: 'B38M',
  category: 'A3', from: THRESHOLD_08, bearing: 222, nm: 10, altitude: 4_000, speed: 190, track: 340, vrate: -700,
  squawk: '4521', ageS: 4, key: KEY.arrival, matchedBy: 'Registration' });

function approachDemoScenario() {
  const base = createAirPicture();
  const estimate = demoEstimate();
  const arrival = aircraft(ARRIVAL_ON_BASE);
  const start = destinationPoint(THRESHOLD_08, FINAL_08, 20 * METRES_PER_NM);
  return {
    at: TRAFFIC_NOON,
    picture: { ...base, aircraft: [...base.aircraft.filter(item => item.hex !== HEX.arrival), arrival,
      ...APPROACH_OTHERS.map(aircraft)] },
    flights: createMapFlights(),
    tracks: { [HEX.arrival]: trackOf(arrival) },
    estimates: [estimate],
    estimatedTrails: [estimatedPath(KEY.demoArrival, start, [estimate.lon, estimate.lat])],
  };
}

// The ramp: the visits of the scene sit where the lab's stand pattern (scenes.js: labStands) shows them, A1 occupied,
// A4 arriving and A6 releasing.
const RAMP = Object.freeze({
  arrivalStand: 'A4',
  parkedStand: 'A1',
  departureStand: 'A6',
});
const zz701 = Object.freeze({ legArrival: uuid('5c000000', 701), legDeparture: uuid('5c000000', 702),
  turnaround: uuid('5d000000', 701), operation: uuid('5e000000', 701) });

function rampFlights() {
  const flights = createMapFlights();
  const standOf = code => ({ id: uuid('5f000000', 9_000 + Number(code.replace(/\D/g, ''))), code, terminalCode: 'A' });
  const rows = flights.flights.map(row => {
    if (row.flightKey === KEY.arrival || row.flightKey === KEY.departure) {
      return { ...row, stand: standOf(RAMP.arrivalStand),
        ...(row.flightKey === KEY.arrival ? { phase: 'landed', actualAt: trafficInstant(-150), actualKind: 'Runway' } : {}) };
    }
    if (row.flightKey === KEY.parkedArrival || row.flightKey === KEY.parkedDeparture) return { ...row, stand: standOf(RAMP.parkedStand) };
    return row;
  });
  // ZZ701/ZZ702: a visit on A6 whose departure is due in ten minutes.
  const parked = rows.find(row => row.flightKey === KEY.parkedArrival);
  const visit = { id: zz701.turnaround, operationCode: 'ZZ701-1113', status: 'InProgress', operationId: zz701.operation,
    operationStatus: 'InProgress' };
  const aircraftOfVisit = { registration: 'ZZ-TST3', typeIcaoCode: 'A320', model: 'A320-200', sizeCategory: 'Narrowbody' };
  const common = { visitKey: `t:${zz701.turnaround}`, turnaroundId: zz701.turnaround, counterpart: parked.counterpart,
    aircraft: aircraftOfVisit, imported: true, turnaround: visit, stand: standOf(RAMP.departureStand),
    milestones: [{ code: 'BLOCK_ON', actualAt: trafficInstant(-55 * 60) }], proposalId: null, isDemo: false, demo: null,
    suggestedStandCode: null, providerStatus: null };
  rows.push(
    { ...parked, ...common, flightKey: `l:${zz701.legArrival}`, legId: zz701.legArrival, direction: 'Arrival',
      flightNumber: 'ZZ701', callsign: 'ZZZ701', scheduledAt: trafficInstant(-60 * 60), estimatedAt: null,
      actualAt: trafficInstant(-55 * 60), actualKind: 'OnBlock', phase: 'arrived' },
    { ...parked, ...common, flightKey: `l:${zz701.legDeparture}`, legId: zz701.legDeparture, direction: 'Departure',
      flightNumber: 'ZZ702', callsign: 'ZZZ702', scheduledAt: trafficInstant(10 * 60), estimatedAt: null, actualAt: null,
      actualKind: null, phase: 'scheduled' },
  );
  return { ...flights, flights: rows };
}

function rampScenario() {
  const base = createAirPicture();
  const [a1, a6] = [standCentre(RAMP.parkedStand), standCentre(RAMP.departureStand)];
  const picture = {
    ...base,
    aircraft: [
      // Off runway 08 by taxiway B and along the apron lane, eastbound to A4.
      aircraft({ hex: HEX.arrival, callsign: 'ZZZ161', registration: 'ZZ-TST1', type: 'B38M', category: 'A3',
        at: [-68.3632, 18.56481], altitude: null, onGround: true, speed: 15, track: 92, squawk: '4521', ageS: 3,
        key: KEY.arrival, matchedBy: 'Registration', trail: 0 }),
      // ZZ702's aircraft on A6, nose in, its engines not yet running.
      aircraft({ hex: 'f0a00a', callsign: 'ZZZ702', registration: 'ZZ-TST3', type: 'A320', category: 'A3', at: a6,
        onGround: true, speed: 0, track: 174.9, ageS: 6, key: `l:${zz701.legDeparture}`, matchedBy: 'Registration', trail: 0 }),
      // A transponder with no identity inside A1, which the ZZ300 visit holds: not drawn.
      aircraft({ hex: HEX.groundInOwnedStand, category: 'A3', at: a1, onGround: true, speed: 0, ageS: 8, trail: 0 }),
      // Another airline's aircraft taxiing out north on taxiway B.
      aircraft({ hex: HEX.groundOnFreeStand, callsign: 'ZZZ415', registration: 'ZZ-TST4', type: 'B738', category: 'A3',
        at: [-68.36412, 18.56688], onGround: true, speed: 14, track: 355, squawk: '1200', ageS: 4, trail: 0 }),
      // Beyond the ramp view, so neither is listed in its legend: an overflight and an aircraft 15 NM east.
      ...base.aircraft.filter(item => item.hex === HEX.overflight || item.hex === HEX.stale),
    ],
  };
  // ZZ161's way in, as the trail the server kept: down taxiway B, then east along the apron lane.
  const taxiIn = [[-68.36412, 18.5684], [-68.36408, 18.5676], [-68.36402, 18.5668], [-68.36396, 18.5660],
    [-68.3639, 18.5653], [-68.36375, 18.56495], [-68.36350, 18.56485], [-68.3632, 18.56481]];
  const fixAt = parseInstant(trafficInstant(-3));
  const taxiTrack = { hex: HEX.arrival, serverTime: TRAFFIC_NOON, source: null,
    points: taxiIn.map(([longitude, latitude], index) => ({ at: new Date(fixAt - (taxiIn.length - 1 - index) * 15_000).toISOString(),
      latitude, longitude, altitudeFeet: null, onGround: true })) };
  return { at: TRAFFIC_NOON, picture, flights: rampFlights(), tracks: { [HEX.arrival]: taxiTrack }, estimates: [],
    estimatedTrails: [] };
}

function estimatedStaleScenario() {
  // ZZ500, en route with no live position, drawn where its schedule puts it: on base for 08, from the north-west.
  const [lon, lat] = destinationPoint(ARP, 300, 13 * METRES_PER_NM);
  return {
    at: TRAFFIC_NOON,
    picture: createAirPicture({ status: 'Stale' }),
    flights: createMapFlights(),
    tracks: {},
    estimates: [{ flightKey: KEY.noFix, lon: round6(lon), lat: round6(lat), altM: 1_220, gsMs: 95, trackDeg: 160,
      vrateMs: -4, onGround: false, positionAt: parseInstant(TRAFFIC_NOON) }],
    estimatedTrails: [],
  };
}

/** The address of the other traffic chosen in approach-traffic-hex-selected: ZZZ880 on downwind for 08. */
export const LAB_CHOSEN_HEX = APPROACH_OTHERS[1].hex;

// The approach with ZZZ880 chosen: the server's track of it too, so its route shows what it flew.
function approachHexScenario() {
  const base = approachDemoScenario();
  const chosen = base.picture.aircraft.find(item => item.hex === LAB_CHOSEN_HEX);
  return { ...base, tracks: { ...base.tracks, [chosen.hex]: trackOf(chosen) } };
}

/** The traffic scenarios of the lab by scene id: `{ at, picture, flights, tracks, estimates, estimatedTrails }`. */
export const TRAFFIC_SCENARIOS = Object.freeze({
  'region-traffic-mixed': regionScenario(),
  'approach-traffic-demo': approachDemoScenario(),
  'ramp-traffic-ground': rampScenario(),
  'approach-traffic-estimated-stale': estimatedStaleScenario(),
  'region-traffic-selected': regionScenario(),
  'approach-traffic-hex-selected': approachHexScenario(),
  'region-layers-menu': regionScenario(),
});

/**
 * What the lab's map draws of a scenario at `nowMs` (the frozen clock; the scenario's own instant without one), for
 * the URL's `selection`: the `map` prop of OccMap (`{ aircraft, trails, route, source }`), the air picture model for
 * MapSourceStatus, the instant used, the situation, what the selection names (`target`, for the data block) and the
 * station's airport. The trails are those of the picture and the tracks, plus the scenario's estimated paths; with
 * `allTrails` also those of the other traffic, which the map shows only while «Estelas de todo el tráfico» is on. The
 * route is the chosen flight's (traffic/routeFeatures.js), from its trail and track.
 */
export function labTraffic(scenario, { nowMs = null, selection = null, allTrails = false } = {}) {
  const time = Number.isFinite(nowMs) ? nowMs : parseInstant(scenario.at);
  const picture = toPictureModel(scenario.picture);
  const flights = toFlightsModel(scenario.flights);
  const situation = buildSituation({ picture, flights, nowMs: time, estimates: scenario.estimates ?? [] });
  const target = selectionTarget(selection, situation);
  const chosenHex = target?.aircraft?.hex ?? null;
  const store = createTrailStore();
  store.ingestPicture(picture);
  const tracks = new Map(Object.values(scenario.tracks ?? {}).map(track => [track.hex, toTrackModel(track)]));
  for (const model of tracks.values()) store.ingestTrack(model.hex, model.points);
  const aviamHexes = new Set(situation.aircraft.filter(item => item.kind === 'aviam' && item.hex).map(item => item.hex));
  const observed = trailFeatures(store.getSnapshot(), { aviamHexes, includeOther: allTrails, selectedHex: chosenHex,
    nowMs: time });
  const trails = { type: 'FeatureCollection', features: [...observed.features, ...(scenario.estimatedTrails ?? [])] };
  const route = target === null ? null : buildRoute({ target, segments: trailSegmentsOf(observed, chosenHex),
    track: chosenHex === null ? null : tracks.get(chosenHex) ?? null, stationAirport: flights.stationAirport, nowMs: time });
  return {
    map: { aircraft: situation.aircraft, trails, route, source: situation.source },
    picture,
    nowMs: time,
    situation,
    target,
    stationAirport: flights.stationAirport,
  };
}
