import { destinationPoint, METRES_PER_NM } from '../airport/geo';
import { runwayEnd } from '../airport/runwayInUse';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { createAirPicture, createMapFlights, trafficInstant, TRAFFIC_NOON } from '../testing/trafficFixtures';

// The detailed 3D aircraft and their liveries in the map lab (CN-30): live aircraft of six airlines along runway 08/26
// at Punta Cana, stopped, and one on short final for 08, gear down and turning, in the shape of the API's air picture
// (contracts 1.3). Invented addresses (the f0d0 block) and ZZ- registrations; the callsigns name real airlines only so their liveries
// (aircraft/liveries.js: brand colours and the airline's name in our own type) resolve. Choosing one up close draws it
// with its detailed model (core/aircraft3d.js: DETAIL_MIN_ZOOM). Pure data.

const ARP = Object.freeze(MDPC_LAYOUT.meta.arp);
const END_08 = runwayEnd(MDPC_LAYOUT, '08');
const round6 = value => Math.round(value * 1e6) / 1e6;
const along08 = metres => destinationPoint(END_08.threshold, END_08.headingTrue, metres);

/** The aircraft of the showcase, by its address: where it stands, its type, its callsign and its registration. */
export const SHOWCASE_AIRCRAFT = Object.freeze([
  { hex: 'f0d001', callsign: 'CMP893', registration: 'ZZ-CMP1', type: 'B738', at: along08(450), track: 73.8 },
  { hex: 'f0d002', callsign: 'AAL1421', registration: 'ZZ-AAL2', type: 'A321', at: along08(1050), track: 73.8 },
  { hex: 'f0d003', callsign: 'UAL1624', registration: 'ZZ-UAL3', type: 'B789', at: along08(1700), track: 73.8 },
  { hex: 'f0d004', callsign: 'JBU1833', registration: 'ZZ-JBU4', type: 'A320', at: along08(2300), track: 73.8 },
  { hex: 'f0d005', callsign: 'DWI304', registration: 'ZZ-DWI5', type: 'B38M', at: along08(2850), track: 253.8 },
  { hex: 'f0d006', callsign: null, registration: 'ZZ-ATR6', type: 'AT76',
    at: destinationPoint(ARP, 200, 380), track: 290 },
].map(Object.freeze));

/** The aircraft on short final for 08: 1.5 NM out, 480 ft over the field, descending on the glide path, turning. */
export const SHOWCASE_FINAL = Object.freeze({
  hex: 'f0d007', callsign: 'AVA247', registration: 'ZZ-AVA7', type: 'A320',
  at: destinationPoint(END_08.threshold, END_08.headingTrue + 180, 1.5 * METRES_PER_NM), track: 70,
});

const fix = ({ hex, callsign, registration, type, at, track }, { altitude = null, speed = 0, vrate = null,
  onGround = true } = {}) => ({
  hex, callsign, registration, typeIcaoCode: type, category: type === 'B789' ? 'A5' : 'A3',
  latitude: round6(at[1]), longitude: round6(at[0]), altitudeFeet: altitude, onGround, groundSpeedKnots: speed,
  trackDegrees: track, verticalRateFeetPerMinute: vrate, squawk: null, positionAt: trafficInstant(-2),
  matchedFlightKey: null, matchedBy: null, trail: [],
});

/** The scenario of the showcase scene, as lab/trafficScenes.js reads one: `{ at, picture, flights, tracks }`. */
export const SHOWCASE_SCENARIO = Object.freeze({
  at: TRAFFIC_NOON,
  picture: createAirPicture({
    aircraft: [
      ...SHOWCASE_AIRCRAFT.map(item => fix(item)),
      fix(SHOWCASE_FINAL, { altitude: 527, speed: 138, vrate: -730, onGround: false }),
    ],
  }),
  flights: createMapFlights({ flights: [] }),
  tracks: {},
  // Not a traffic scenario of lab/trafficScenes.js: the showcase of the detailed models.
  showcase: true,
});
