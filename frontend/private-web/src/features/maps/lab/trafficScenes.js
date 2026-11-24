import { parseInstant } from '../../../services/serverClock';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, METRES_PER_NM } from '../airport/geo';
import { createRenderClock } from '../core/frameLoop';
import {
  createAirPicture, createDemoBlock, createDemoFlights, createMapFlights, createTrack, TRAFFIC_FLIGHT_KEY as KEY,
  TRAFFIC_HEX as HEX, TRAFFIC_NOON, trafficInstant,
} from '../testing/trafficFixtures';
import { createMotionStore } from '../traffic/motionStore';
import { buildRoute } from '../traffic/routeFeatures';
import { buildSituation, selectionTarget, toFlightsModel, toPictureModel, toTrackModel } from '../traffic/situationModel';
import { createTrailStore, trailFeatures } from '../traffic/trailStore';

// The traffic of the map lab's scenes (PR M5 and M6): synthetic air pictures, map flights and tracks at the lab's noon,
// in the shape of the API (contracts 1.3), built on the fixtures of maps/testing/trafficFixtures.js. Invented hex
// codes, registrations and callsigns; nothing comes from a provider. The lab draws them without polling, the way the
// app does: every scenario goes through the motion store (traffic/motionStore.js), which estimates the ELEVANT flights
// without a fix and the demo flight from the server's instants, on a render clock frozen at the lab's instant
// (labTraffic). Pure data.
//
// - region-traffic-mixed: an AVIAM arrival on final and a departure climbing out, a dozen other aircraft across the
//   region (every icon category), one whose position is 45 s old, and the ELEVANT flights F-1 estimates;
// - approach-traffic-demo: the demo arrival on final for 08, where its fitted trajectory has it (its «Demo» plate and
//   its «est.» ring), the live arrival on base and other traffic around the approach;
// - ramp-traffic-ground: the arrival taxiing to A4 (GND), a departure on A6, ZZ300 parked on A1 with a transponder
//   hidden inside it, and other traffic taxiing out on taxiway B;
// - approach-traffic-estimated-stale: the air picture more than a minute late (every live aircraft dimmed, its tag
//   saying the time of its last position, those without a signal for longest fading out, and the chip that says the
//   traffic is late) and an ELEVANT flight drawn from its schedule on the approach;
// - region-traffic-selected and region-layers-menu: the region's mixed traffic, with ZZ161 chosen (its data block and
//   its route) or with the layers menu open;
// - approach-traffic-hex-selected: the approach with another airline's aircraft chosen by its address, with the track
//   the server keeps of it;
// - PR M6, the demo flight in motion: on final (approach-demo-final), taxiing to A6 once imported
//   (airfield-demo-taxiing), waiting at terminal B's apron hold before anyone imported it (ramp-demo-awaiting-stand),
//   fading out after the provider cancelled it (airfield-demo-cancelled) and fired with two minutes, compressed
//   (approach-demo-accelerated); and the three sources of a position side by side, live, without a signal for 20 s
//   and estimated (approach-traffic-live-estimated);
// - PR M6, the route of the chosen flight and follow mode: the demo arrival a minute after it appeared, imported onto A6
//   (approach-demo-route: estimated from New York, still to fly down to A6), its departure taxiing from A6 to 08 for New
//   York (airfield-departure-route), and the demo flight followed on final (approach-follow-final) and on the taxiway
//   (airfield-follow-taxi).

const ARP = Object.freeze([-68.3634, 18.5674]);
const THRESHOLD_08 = Object.freeze([-68.383055, 18.57031]);
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
  };
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

// The demo arrival of the fixtures appeared three minutes before noon for its stand in eight: at noon it is on final for
// 08, 84 s before its touchdown, where its fitted trajectory has it (the motion store estimates it).
function approachDemoScenario() {
  const base = createAirPicture();
  const arrival = aircraft(ARRIVAL_ON_BASE);
  return {
    at: TRAFFIC_NOON,
    picture: { ...base, aircraft: [...base.aircraft.filter(item => item.hex !== HEX.arrival), arrival,
      ...APPROACH_OTHERS.map(aircraft)] },
    flights: createMapFlights(),
    tracks: { [HEX.arrival]: trackOf(arrival) },
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
  return { at: TRAFFIC_NOON, picture, flights: rampFlights(), tracks: { [HEX.arrival]: taxiTrack } };
}

/** How late the picture of approach-traffic-estimated-stale is: more than a minute, less than the drop of a fix. */
export const LAB_STALE_LATE_S = 75;

// The Live picture as the server keeps it when the provider stopped answering `lateS` seconds ago: every instant that
// much earlier (less the 2 s the Live picture is old), Stale, and asked again in 30 s.
function latePicture(lateS) {
  const live = createAirPicture();
  const shift = value => new Date(Date.parse(value) - (lateS - 2) * 1_000).toISOString();
  return {
    ...live, status: 'Stale', reason: 'provider_error', observedAt: trafficInstant(-lateS), ageSeconds: lateS,
    refreshAfterSeconds: 30,
    aircraft: live.aircraft.map(item => ({ ...item, positionAt: shift(item.positionAt),
      trail: item.trail.map(point => ({ ...point, at: shift(point.at) })) })),
  };
}

/** The map flights with ZZ500 on the approach at noon: on its stand 14 minutes later (its schedule only). */
function flightsWithZz500OnApproach() {
  const flights = createMapFlights();
  return { ...flights, flights: flights.flights.map(row => (row.flightKey === KEY.noFix
    ? { ...row, scheduledAt: trafficInstant(15 * 60), estimatedAt: trafficInstant(14 * 60), phase: 'approaching',
      providerStatus: 'Approaching' }
    : row)) };
}

function estimatedStaleScenario() {
  return {
    at: TRAFFIC_NOON,
    picture: latePicture(LAB_STALE_LATE_S),
    // ZZ500, with no live position, drawn where its schedule puts it: on the approach to 08.
    flights: flightsWithZz500OnApproach(),
    tracks: {},
  };
}

// The demo flight in motion (PR M6). Each scene fires it with createDemoBlock (the server's timeline) so that at the
// lab's noon it is where the scene wants it: `appearS` seconds before noon, `minutes` to its stand.
const NOON_MS = parseInstant(TRAFFIC_NOON);
const demoBlockAt = ({ appearS, minutes = 8, ...options }) => createDemoBlock({ ...options, minutes,
  appearAt: NOON_MS - appearS * 1_000 });

// The approach's traffic with the demo pair on a clock of its own. An imported pair has A6, the stand the lab's board
// (scenes.js) shows it arriving at; one nobody imported has B21 suggested, as the fixtures do.
function demoScenario(block, { imported = false, standCode = imported ? 'A6' : 'B21', picture = createAirPicture() } = {}) {
  return {
    at: TRAFFIC_NOON,
    picture,
    flights: createDemoFlights(block, { imported, standCode }),
    tracks: { [HEX.arrival]: createTrack(HEX.arrival) },
  };
}

// On final: imported on A6, two minutes before its touchdown (8 minutes to the stand: the touchdown is 264 s after it
// appeared).
const approachDemoFinal = () => demoScenario(demoBlockAt({ appearS: 144, imported: true }), { imported: true });
// Taxiing to A6 a minute and a half after its touchdown.
const airfieldDemoTaxiing = () => demoScenario(demoBlockAt({ appearS: 264 + 90, imported: true }), { imported: true });
// Nobody imported it: on its terminal's apron hold since before its on-block, a minute ago.
const rampDemoAwaitingStand = () => demoScenario(demoBlockAt({ appearS: 9 * 60 }));
// Cancelled by the provider 2 s before noon on very short final (its touchdown would have been 4 s after noon): it
// fades out where it is.
const airfieldDemoCancelled = () => demoScenario(demoBlockAt({ appearS: 260, cancelAtMs: NOON_MS - 2_000 }));
// Fired with two minutes to its stand: the 30 s it has in the air are too few for real speeds from 5 NM out.
const approachDemoAccelerated = () => demoScenario(demoBlockAt({ appearS: 10, minutes: 2 }));
// The route of the chosen flight (PR M6). A minute after it appeared, imported onto A6: on the approach to 08.
const approachDemoRoute = () => demoScenario(demoBlockAt({ appearS: 60, imported: true }), { imported: true });
// Its departure, taxiing to 08 two minutes after it left A6 on time (on its stand since 8 minutes after it appeared, for
// the hour its schedule gives it): on the apron's taxiway, clear of the open legend, at both laptop sizes.
const DEPARTURE_TAXI_S = 120;
const airfieldDepartureRoute = () => demoScenario(demoBlockAt({ appearS: (8 + 60) * 60 + DEPARTURE_TAXI_S,
  imported: true, offBlockAfterMin: 60 }), { imported: true });

// The three sources of a position on the approach: ZZ161 live (its fix 4 s old), ZZ700 climbing out without a signal
// for 20 s, and ZZ500 estimated from its schedule.
function liveEstimatedScenario() {
  const base = createAirPicture();
  const departure = aircraft({ ...DEPARTURE, nm: 18, altitude: 9_000, speed: 280, vrate: 1_800, ageS: 20 });
  return {
    at: TRAFFIC_NOON,
    picture: { ...base, aircraft: [...base.aircraft, departure] },
    flights: flightsWithZz500OnApproach(),
    tracks: { [HEX.arrival]: createTrack(HEX.arrival), [departure.hex]: trackOf(departure) },
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

// The live feed of the lab's motion measurements (CN-18, map-lab.fluency.spec.mjs): the approach's traffic with the
// demo flight and FEED_TRAFFIC_COUNT other aircraft, a third of them turning, read again every `periodMs` as the app
// polls the air picture. Each read reaches the map `lateMs` after the server answered it (a busy main thread, a slow
// network) and moves the server clock's offset by the next of `offsetsMs` (the clock settling on another sample), the
// two things that made the aircraft jump. Invented addresses and callsigns; the positions are a function of the time
// alone (feedPictureAt), so every run reads the same.
export const LAB_FEED = Object.freeze({
  periodMs: 10_000,
  lateMs: 3_000,
  offsetsMs: Object.freeze([0, 180, -120, 240, -60, 150, -200, 90]),
});
const FEED_TRAFFIC_COUNT = 40;
const FEED_TYPES = Object.freeze([['A20N', 'A3'], ['B738', 'A3'], ['E190', 'A3'], ['AT76', 'A2'], ['B77W', 'A5']]);

// The other traffic of the feed, the same on every run: around PUJ within 6 to 40 NM, below 15 000 ft; every third
// aircraft turns at 1.5 to 3°/s (a holding, a vector onto final), the rest fly straight.
const FEED_SPECS = Object.freeze(Array.from({ length: FEED_TRAFFIC_COUNT }, (_, index) => {
  const [type, category] = FEED_TYPES[index % FEED_TYPES.length];
  const turning = index % 3 === 0;
  return Object.freeze({
    hex: `f0d${String(index).padStart(3, '0')}`, callsign: `ZZZ${String(300 + index)}`, type, category,
    start: destinationPoint(ARP, (index * 137.5) % 360, (6 + ((index * 7) % 35)) * METRES_PER_NM),
    track: (index * 53) % 360, speed: 180 + ((index * 11) % 120), altitude: 3_000 + ((index * 977) % 12_000),
    turnDegS: turning ? (index % 2 === 0 ? 1 : -1) * (1.5 + (index % 4) * 0.5) : 0,
  });
}));

/** Where a feed aircraft is `seconds` after noon: along its track at its speed, turning at its rate, and its heading. */
export function feedTruthAt(spec, seconds) {
  const speedMs = spec.speed * KNOT_MS;
  const h0 = (spec.track * Math.PI) / 180;
  const omega = (spec.turnDegS * Math.PI) / 180;
  const [east, north] = Math.abs(omega) < 1e-9
    ? [speedMs * seconds * Math.sin(h0), speedMs * seconds * Math.cos(h0)]
    : [(speedMs / omega) * (Math.cos(h0) - Math.cos(h0 + omega * seconds)),
      (speedMs / omega) * (Math.sin(h0 + omega * seconds) - Math.sin(h0))];
  const bearing = (Math.atan2(east, north) * 180) / Math.PI;
  const point = destinationPoint(spec.start, (bearing + 360) % 360, Math.hypot(east, north));
  return { point, track: (((spec.track + spec.turnDegS * seconds) % 360) + 360) % 360 };
}

/** The ids the map draws the feed's measured aircraft as: the demo flight, a straight one and a turning one. */
export const LAB_FEED_IDS = Object.freeze({
  demo: `f:${KEY.demoArrival}`,
  straight: `h:${FEED_SPECS[1].hex}`,
  turning: `h:${FEED_SPECS[3].hex}`,
});

// The air picture of the feed answered at `readAtMs`: each aircraft's fix 2 to 6 s older than the answer.
function feedPictureAt(base, readAtMs) {
  const iso = ms => new Date(ms).toISOString();
  const moved = base.aircraft.map(item => {
    const fixAt = parseInstant(item.positionAt);
    const ageS = (readAtMs - 2_000 - fixAt) / 1_000;
    if (!(ageS > 0) || item.onGround) return item;
    const speed = (item.groundSpeedKnots ?? 0) * KNOT_MS;
    const [longitude, latitude] = speed > 0 && item.trackDegrees != null
      ? destinationPoint([item.longitude, item.latitude], item.trackDegrees, speed * ageS) : [item.longitude, item.latitude];
    const climbFt = ((item.verticalRateFeetPerMinute ?? 0) * ageS) / 60;
    return { ...item, latitude: round6(latitude), longitude: round6(longitude), positionAt: iso(readAtMs - 2_000),
      altitudeFeet: item.altitudeFeet == null ? null : Math.max(0, Math.round(item.altitudeFeet + climbFt)), trail: [] };
  });
  const others = FEED_SPECS.map((spec, index) => {
    const fixAt = readAtMs - (2 + (index % 5)) * 1_000;
    const { point, track } = feedTruthAt(spec, (fixAt - NOON_MS) / 1_000);
    return {
      hex: spec.hex, callsign: spec.callsign, registration: null, typeIcaoCode: spec.type, category: spec.category,
      latitude: round6(point[1]), longitude: round6(point[0]), altitudeFeet: spec.altitude, onGround: false,
      groundSpeedKnots: spec.speed, trackDegrees: Math.round(track * 10) / 10, verticalRateFeetPerMinute: 0, squawk: null,
      positionAt: iso(fixAt), matchedFlightKey: null, matchedBy: null, trail: [],
    };
  });
  return { ...base, serverTime: iso(readAtMs), observedAt: iso(readAtMs - 2_000), ageSeconds: 2,
    aircraft: [...moved, ...others] };
}

/** A feed scenario as the read answered at `readAtMs` brings it: its picture and its map flights of that instant. */
export function feedScenarioAt(scenario, readAtMs) {
  const base = scenario.feedBase ?? scenario;
  return {
    ...scenario,
    at: new Date(readAtMs).toISOString(),
    picture: feedPictureAt(base.picture, readAtMs),
    flights: { ...base.flights, serverTime: new Date(readAtMs).toISOString() },
  };
}

function feedScenario(base) {
  const frozenBase = Object.freeze({ picture: base.picture, flights: base.flights });
  return { ...feedScenarioAt({ ...base, feedBase: frozenBase }, NOON_MS), feed: LAB_FEED };
}

/** The feed scenarios of the lab's motion measurements by scene id (scenes.js: perf-*). */
export const FEED_SCENARIOS = Object.freeze({
  // The demo flight three minutes out on the approach, landing and taxiing in during a minute's measurement.
  'perf-approach-feed': feedScenario(demoScenario(demoBlockAt({ appearS: 30, imported: true }), { imported: true })),
  // The demo flight taxiing to A6 among the same traffic, at the airfield's zoom.
  'perf-airfield-feed': feedScenario(airfieldDemoTaxiing()),
});

/** The traffic scenarios of the lab by scene id: `{ at, picture, flights, tracks, estimates, estimatedTrails }`. */
export const TRAFFIC_SCENARIOS = Object.freeze({
  'region-traffic-mixed': regionScenario(),
  'approach-traffic-demo': approachDemoScenario(),
  'ramp-traffic-ground': rampScenario(),
  'approach-traffic-estimated-stale': estimatedStaleScenario(),
  'region-traffic-selected': regionScenario(),
  'approach-traffic-hex-selected': approachHexScenario(),
  'region-layers-menu': regionScenario(),
  'approach-demo-final': approachDemoFinal(),
  'airfield-demo-taxiing': airfieldDemoTaxiing(),
  'ramp-demo-awaiting-stand': rampDemoAwaitingStand(),
  'approach-traffic-live-estimated': liveEstimatedScenario(),
  'airfield-demo-cancelled': airfieldDemoCancelled(),
  'approach-demo-accelerated': approachDemoAccelerated(),
  'approach-demo-route': approachDemoRoute(),
  'airfield-departure-route': airfieldDepartureRoute(),
  // Followed (the scenes say `follow`): on final as approach-demo-final, taxiing as airfield-demo-taxiing.
  'approach-follow-final': approachDemoFinal(),
  'airfield-follow-taxi': airfieldDemoTaxiing(),
});

/**
 * What the lab's map draws of a scenario at `nowMs` (the frozen clock; the scenario's own instant without one), for
 * the URL's `selection`, the way the app draws it: the scenario's reads go into the motion store (`motion`, the lab's
 * own; without one, a store on a render clock frozen at that instant), whose estimates the situation draws. Returns the
 * `map` prop of OccMap (`{ aircraft, trails, route, source, motion }`), the air picture model for MapSourceStatus, the
 * instant used, the situation, what the selection names (`target`, for the data block), the station's airport and the
 * motion store. The trails are those of the picture and the tracks; with `allTrails` also those of the other traffic,
 * which the map shows only while «Estelas de todo el tráfico» is on. The route is the chosen flight's
 * (traffic/routeFeatures.js), from its aircraft's trail (with its track) and the trajectory the motion store has for it,
 * as useMapSituation builds it, and `map.routeAt(tMs, [lng, lat])` the same with the aircraft where a frame draws it.
 */
export function labTraffic(scenario, { nowMs = null, selection = null, allTrails = false, motion = null,
  language = 'es' } = {}) {
  const time = Number.isFinite(nowMs) ? nowMs : parseInstant(scenario.at);
  const picture = toPictureModel(scenario.picture);
  const flights = toFlightsModel(scenario.flights);
  const moving = motion ?? createMotionStore({ clock: createRenderClock({ frozenAt: time }) });
  moving.ingest({ picture, flights });
  const situation = buildSituation({ picture, flights, nowMs: time, estimates: moving.estimatesAt(time),
    estimatesChangeAt: moving.nextChangeAt(time) });
  const target = selectionTarget(selection, situation);
  const chosenHex = target?.aircraft?.hex ?? null;
  const store = createTrailStore();
  store.ingestPicture(picture);
  const tracks = new Map(Object.values(scenario.tracks ?? {}).map(track => [track.hex, toTrackModel(track)]));
  for (const model of tracks.values()) store.ingestTrack(model.hex, model.points);
  const aviamHexes = new Set(situation.aircraft.filter(item => item.kind === 'aviam' && item.hex).map(item => item.hex));
  const observed = trailFeatures(store.getSnapshot(), { aviamHexes, includeOther: allTrails, selectedHex: chosenHex,
    nowMs: time });
  const trails = { type: 'FeatureCollection', features: observed.features };
  const snapshot = store.getSnapshot();
  const chosenTrail = chosenHex === null ? null : snapshot.entries.get(chosenHex)?.points ?? null;
  const routeInputs = target === null ? null : {
    target, segments: chosenTrail === null ? [] : [chosenTrail], track: chosenHex === null ? null : tracks.get(chosenHex) ?? null,
    trajectory: target.flight ? moving.trajectoryForRoute(target.flight) : null, breakMs: snapshot.breakMs, language,
  };
  const route = routeInputs === null ? null : buildRoute({ ...routeInputs, nowMs: time });
  const routeAt = routeInputs === null ? undefined : (tMs, aircraft) => buildRoute({ ...routeInputs, nowMs: tMs, aircraft });
  return {
    map: { aircraft: situation.aircraft, trails, route, routeAt, source: situation.source, motion: moving },
    picture,
    nowMs: time,
    situation,
    target,
    stationAirport: flights.stationAirport,
    motion: moving,
  };
}
