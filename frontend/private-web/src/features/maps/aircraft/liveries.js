// The liveries of the detailed 3D aircraft (CN-30): per airline, the colours of its paint and the words it carries,
// rendered by the detailed model (aircraft/aircraftDetail.js) as generated textures in our own typography. No logo
// artwork and no image of an airline's livery is copied or downloaded: each entry holds brand colours and plain text
// (the airline's name on the fuselage, its IATA code on the fin). `logoTexture` is an empty slot by default: a path
// under the application's own origin (for example `/liveries/cmp-tail.png`, a file in `public/liveries/`) to a logo
// the owner has the licence to use, drawn on the fin instead of the code, with no change of code. Pure.

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * A livery: `{ id, icao, iata, name, fuselage, belly, cheatline, cheatline2, tail, tailAccent, engine, wing, text,
 * tailText, nameStyle, logoTexture }`. Colours are sRGB `#rrggbb`: `fuselage` the upper body, `belly` the lower body
 * under the window line, `cheatline` (and an optional second, `cheatline2`) a band along the body or `null`, `tail` the
 * fin, `tailAccent` a second colour of the fin or `null`, `engine` the nacelles, `wing` the wings and tailplane, `text`
 * the name on the body and `tailText` the code on the fin. `nameStyle` is 'upper' or 'lower' (how the name is set).
 */
const livery = (id, icao, iata, name, colours) => ({
  id, icao, iata, name,
  fuselage: '#f4f5f6', belly: '#f4f5f6', cheatline: null, cheatline2: null, tail: '#f4f5f6', tailAccent: null,
  engine: '#e9ebee', wing: '#c3c8ce', text: '#1d2833', tailText: '#f4f5f6', nameStyle: 'upper', logoTexture: '',
  ...colours,
});

/** The liveries of the airlines seen at Punta Cana, by ICAO designator. */
export const LIVERIES = deepFreeze({
  CMP: livery('CMP', 'CMP', 'CM', 'COPA', {
    fuselage: '#ffffff', belly: '#ffffff', cheatline: '#0b2d6b', tail: '#0b2d6b', tailAccent: '#c8a24a',
    engine: '#0b2d6b', text: '#0b2d6b', tailText: '#c8a24a',
  }),
  AAL: livery('AAL', 'AAL', 'AA', 'American', {
    fuselage: '#cfd3d8', belly: '#aab0b8', tail: '#0b4f9c', tailAccent: '#c8102e', engine: '#cfd3d8',
    text: '#1b3561', tailText: '#ffffff',
  }),
  DAL: livery('DAL', 'DAL', 'DL', 'DELTA', {
    fuselage: '#ffffff', belly: '#0a2c5c', tail: '#0a2c5c', tailAccent: '#c8102e', engine: '#0a2c5c',
    text: '#0a2c5c', tailText: '#ffffff',
  }),
  UAL: livery('UAL', 'UAL', 'UA', 'UNITED', {
    fuselage: '#ffffff', belly: '#1f3f9a', tail: '#0b2265', tailAccent: '#3f6fd0', engine: '#0b2265',
    text: '#0b2265', tailText: '#ffffff',
  }),
  JBU: livery('JBU', 'JBU', 'B6', 'jetBlue', {
    fuselage: '#ffffff', belly: '#0b2f6e', tail: '#0b2f6e', tailAccent: '#2a62c9', engine: '#0b2f6e',
    text: '#0b2f6e', tailText: '#ffffff', nameStyle: 'lower',
  }),
  SWA: livery('SWA', 'SWA', 'WN', 'SOUTHWEST', {
    fuselage: '#304cb2', belly: '#304cb2', cheatline: '#c4161c', cheatline2: '#ffbf27', tail: '#304cb2',
    tailAccent: '#c4161c', engine: '#304cb2', text: '#ffffff', tailText: '#ffbf27',
  }),
  ACA: livery('ACA', 'ACA', 'AC', 'AIR CANADA', {
    fuselage: '#ffffff', belly: '#1b1d20', tail: '#1b1d20', tailAccent: '#d22630', engine: '#1b1d20',
    text: '#1b1d20', tailText: '#d22630',
  }),
  WJA: livery('WJA', 'WJA', 'WS', 'WESTJET', {
    fuselage: '#ffffff', belly: '#ffffff', cheatline: '#00a19a', tail: '#002d62', tailAccent: '#00a19a',
    engine: '#002d62', text: '#002d62', tailText: '#ffffff',
  }),
  SWG: livery('SWG', 'SWG', 'WG', 'SUNWING', {
    fuselage: '#ffffff', belly: '#ffffff', cheatline: '#f58025', tail: '#f58025', tailAccent: '#003a70',
    engine: '#003a70', text: '#003a70', tailText: '#ffffff',
  }),
  TSC: livery('TSC', 'TSC', 'TS', 'AIR TRANSAT', {
    fuselage: '#ffffff', belly: '#ffffff', cheatline: '#00a4b4', tail: '#1a2b49', tailAccent: '#00a4b4',
    engine: '#1a2b49', text: '#1a2b49', tailText: '#ffffff',
  }),
  AFR: livery('AFR', 'AFR', 'AF', 'AIR FRANCE', {
    fuselage: '#ffffff', belly: '#ffffff', tail: '#ffffff', tailAccent: '#002157', engine: '#ffffff',
    text: '#002157', tailText: '#e41e2b',
  }),
  AEA: livery('AEA', 'AEA', 'UX', 'AIR EUROPA', {
    fuselage: '#ffffff', belly: '#ffffff', cheatline: '#1d2f6f', tail: '#1d2f6f', tailAccent: '#00a3e0',
    engine: '#1d2f6f', text: '#1d2f6f', tailText: '#ffffff',
  }),
  AVA: livery('AVA', 'AVA', 'AV', 'avianca', {
    fuselage: '#da291c', belly: '#da291c', tail: '#da291c', tailAccent: '#ffffff', engine: '#da291c',
    wing: '#c9cdd2', text: '#ffffff', tailText: '#ffffff', nameStyle: 'lower',
  }),
  RPB: livery('RPB', 'RPB', 'P5', 'wingo', {
    fuselage: '#ffffff', belly: '#4b1f7a', tail: '#4b1f7a', tailAccent: '#b5d334', engine: '#4b1f7a',
    text: '#4b1f7a', tailText: '#b5d334', nameStyle: 'lower',
  }),
  DWI: livery('DWI', 'DWI', 'DM', 'ARAJET', {
    fuselage: '#ffffff', belly: '#ffffff', cheatline: '#cc1474', tail: '#cc1474', tailAccent: '#5b2a86',
    engine: '#5b2a86', text: '#5b2a86', tailText: '#ffffff',
  }),
  NKS: livery('NKS', 'NKS', 'NK', 'SPIRIT', {
    fuselage: '#ffe600', belly: '#ffe600', tail: '#ffe600', engine: '#ffe600', wing: '#c9cdd2', text: '#111111',
    tailText: '#111111',
  }),
  FFT: livery('FFT', 'FFT', 'F9', 'FRONTIER', {
    fuselage: '#ffffff', belly: '#00843d', tail: '#00843d', tailAccent: '#9bc23c', engine: '#00843d',
    text: '#00843d', tailText: '#ffffff',
  }),
});

/** The livery of an aircraft whose airline is not in the table: a white body with a slate fin and no words. */
export const DEFAULT_LIVERY = deepFreeze(livery('DEFAULT', null, null, '', {
  fuselage: '#f2f3f4', belly: '#d9dde2', tail: '#3b4b5c', tailAccent: null, engine: '#dfe2e6', text: '#3b4b5c',
  tailText: '#f2f3f4',
}));

const BY_IATA = Object.freeze(Object.fromEntries(Object.values(LIVERIES).map(item => [item.iata, item])));

const upper = value => (typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') : '');
// An ICAO callsign: three letters, then a digit (CMP893, AAL1234, RPB7301A).
const ICAO_CALLSIGN = /^([A-Z]{3})\d/;
// An IATA flight number: two letters or digits (one at least a letter), then a digit (CM893, B6 123, P57301).
const IATA_FLIGHT = /^([A-Z][A-Z0-9]|[0-9][A-Z])\d/;

/**
 * The livery of an aircraft of the map (traffic/situationModel.js: RenderAircraft, or any `{ airlineIcao, airlineIata,
 * callsign, flightNumber }`): by its airline's ICAO designator, else its IATA code, else the ICAO prefix of its
 * callsign, else the IATA prefix of its flight number; DEFAULT_LIVERY for anything else. Frozen.
 */
export function resolveLivery(item = {}) {
  const icao = upper(item?.airlineIcao);
  if (Object.hasOwn(LIVERIES, icao)) return LIVERIES[icao];
  const iata = upper(item?.airlineIata);
  if (Object.hasOwn(BY_IATA, iata)) return BY_IATA[iata];
  const callsign = ICAO_CALLSIGN.exec(upper(item?.callsign))?.[1];
  if (callsign && Object.hasOwn(LIVERIES, callsign)) return LIVERIES[callsign];
  const flight = IATA_FLIGHT.exec(upper(item?.flightNumber))?.[1];
  if (flight && Object.hasOwn(BY_IATA, flight)) return BY_IATA[flight];
  return DEFAULT_LIVERY;
}

/** The words a livery writes on the fuselage, as it sets them ('' for none). */
export function liveryName(item) {
  const name = typeof item?.name === 'string' ? item.name : '';
  return item?.nameStyle === 'lower' ? name : name.toUpperCase();
}

/**
 * The zones of a livery that an instanced model paints (M9, aircraft on their stands and near the airfield), in the
 * order of the models' `liveryZone` vertex attribute (aircraft/aircraftGeometry.js: withLiveryZones) and of the
 * layer's instance attributes (aircraft/aircraft3dLayer.js): 0 the upper body, 1 the belly, 2 the fin, 3 the engines,
 * 4 the wings, the tailplane and the gear. A model from a file (the L1 glTF of lane M5) paints the same zones.
 */
export const LIVERY_ZONES = Object.freeze(['fuselage', 'belly', 'tail', 'engine', 'wing']);

/**
 * The zone of each part of the procedural models (aircraft/aircraftGeometry.js: userData.parts); a fuselage's
 * underside is its belly (withLiveryZones). A part not listed is painted as the wings.
 */
export const PART_ZONES = Object.freeze({
  fuselage: 'fuselage', cabin: 'fuselage', boom: 'fuselage', fin: 'tail', tailRotor: 'tail', nacelle: 'engine',
  propeller: 'wing', wing: 'wing', tailplane: 'wing', pylon: 'wing', gear: 'wing', skid: 'wing', mast: 'wing',
  rotor: 'wing',
});

/**
 * The sRGB `#rrggbb` colour of each zone of LIVERY_ZONES for `item` (a livery of LIVERIES, DEFAULT_LIVERY, or anything
 * resolveLivery reads), frozen: `{ fuselage, belly, tail, engine, wing }`. The one place the instanced models and a
 * model from a file take their paint from.
 */
export function liveryZones(item = {}) {
  const paint = Object.hasOwn(item ?? {}, 'fuselage') && Object.hasOwn(item, 'tail') ? item : resolveLivery(item);
  return Object.freeze({
    fuselage: paint.fuselage, belly: paint.belly ?? paint.fuselage, tail: paint.tail, engine: paint.engine,
    wing: paint.wing,
  });
}
