// The aircraft types the OCC maps know (design G2): their dimensions in metres, their family (how the airframe is
// built: where the engines and the tailplane sit) and the category of their 2D icon. One table for the silhouettes
// (aircraft/silhouette.js), the footprints at true size and the 3D models of later PRs, so 2D and 3D agree. Pure.
//
// Lengths, spans and heights are the manufacturers' published figures; the fuselage width, the quarter-chord sweep and
// the nacelle diameter are rounded from the same sources. Every value must be checked against the type's airport
// planning document (Airbus «Aircraft characteristics: airport and maintenance planning», Boeing «Airplane
// characteristics for airport planning», and the Embraer, Bombardier and ATR equivalents) before the footprints at
// true size and the 3D models rely on it.

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** The icons of the map, one silhouette each (design E2). */
export const ICON_CATEGORIES = Object.freeze([
  'heavy4', 'wide2', 'narrow', 'regional', 'turboprop', 'bizjet', 'light', 'heli', 'unknown',
]);

/**
 * How an airframe is built, for its silhouette: engines under the wing (two or four), at the rear of the fuselage with
 * a T-tail, turboprops on a high wing, a single piston engine in the nose, a helicopter, or the neutral dart of an
 * unknown aircraft.
 */
export const AIRCRAFT_FAMILIES = Object.freeze([
  'twinUnderwing', 'quadUnderwing', 'rearTwinT', 'turbopropHigh', 'bizjet', 'pistonSingle', 'helicopter', 'dart',
]);

const spec = (family, iconCategory, lengthM, spanM, heightM, fuselageDiaM, wingSweepDeg, engines, engineDiaM) => ({
  family, iconCategory, lengthM, spanM, heightM, fuselageDiaM, wingSweepDeg, engines, engineDiaM,
});

/**
 * The twenty types of the plan by ICAO designator: `{ family, iconCategory, lengthM, spanM, heightM, fuselageDiaM,
 * wingSweepDeg, engines, engineDiaM }`. The span is the largest one in plan view (winglets and sharklets included).
 */
export const AIRCRAFT_TYPES = deepFreeze({
  A320: spec('twinUnderwing', 'narrow', 37.57, 35.8, 11.76, 3.95, 25, 2, 2),
  A321: spec('twinUnderwing', 'narrow', 44.51, 35.8, 11.76, 3.95, 25, 2, 2),
  A20N: spec('twinUnderwing', 'narrow', 37.57, 35.8, 11.76, 3.95, 25, 2, 2.3),
  A21N: spec('twinUnderwing', 'narrow', 44.51, 35.8, 11.76, 3.95, 25, 2, 2.3),
  B737: spec('twinUnderwing', 'narrow', 33.63, 35.79, 12.55, 3.76, 25, 2, 1.9),
  B738: spec('twinUnderwing', 'narrow', 39.47, 35.79, 12.55, 3.76, 25, 2, 1.9),
  B38M: spec('twinUnderwing', 'narrow', 39.52, 35.92, 12.29, 3.76, 25, 2, 2.1),
  B39M: spec('twinUnderwing', 'narrow', 42.16, 35.92, 12.29, 3.76, 25, 2, 2.1),
  B752: spec('twinUnderwing', 'narrow', 47.32, 38.05, 13.56, 3.76, 25, 2, 2.4),
  B763: spec('twinUnderwing', 'wide2', 54.94, 47.57, 15.85, 5.03, 31.5, 2, 2.9),
  B77W: spec('twinUnderwing', 'wide2', 73.86, 64.8, 18.5, 6.2, 31.6, 2, 3.9),
  A333: spec('twinUnderwing', 'wide2', 63.66, 60.3, 16.79, 5.64, 30, 2, 3),
  A359: spec('twinUnderwing', 'wide2', 66.8, 64.75, 17.05, 5.96, 31.9, 2, 3.4),
  B788: spec('twinUnderwing', 'wide2', 56.72, 60.12, 16.92, 5.77, 32.2, 2, 3.3),
  B789: spec('twinUnderwing', 'wide2', 62.81, 60.12, 17.02, 5.77, 32.2, 2, 3.3),
  E190: spec('twinUnderwing', 'narrow', 36.24, 28.72, 10.57, 3.01, 23.5, 2, 1.6),
  E195: spec('twinUnderwing', 'narrow', 38.65, 28.72, 10.55, 3.01, 23.5, 2, 1.6),
  BCS3: spec('twinUnderwing', 'narrow', 38.71, 35.08, 11.5, 3.71, 25, 2, 2.1),
  CRJ9: spec('rearTwinT', 'regional', 36.2, 24.85, 7.51, 2.69, 26, 2, 1.4),
  AT76: spec('turbopropHigh', 'turboprop', 27.17, 27.05, 7.65, 2.77, 3, 2, 1),
});

/**
 * One generic airframe per icon category, for an aircraft whose type the table does not hold: a four-engine and a twin
 * wide body, a narrow body, a regional jet with rear engines, a high-wing turboprop, a business jet, a light single, a
 * helicopter (span = rotor diameter) and the neutral dart.
 */
export const CATEGORY_FALLBACKS = deepFreeze({
  heavy4: spec('quadUnderwing', 'heavy4', 70.66, 64.44, 19.41, 6.5, 37.5, 4, 2.7),
  wide2: spec('twinUnderwing', 'wide2', 63, 60.3, 17, 5.7, 31, 2, 3.3),
  narrow: spec('twinUnderwing', 'narrow', 37.57, 35.8, 11.76, 3.95, 25, 2, 2),
  regional: spec('rearTwinT', 'regional', 36.2, 24.85, 7.51, 2.69, 26, 2, 1.4),
  turboprop: spec('turbopropHigh', 'turboprop', 27.17, 27.05, 7.65, 2.77, 3, 2, 1),
  bizjet: spec('bizjet', 'bizjet', 20.3, 19.2, 6.3, 2.3, 30, 2, 1.2),
  light: spec('pistonSingle', 'light', 8.28, 11, 2.72, 1.2, 0, 1, 0),
  heli: spec('helicopter', 'heli', 16.66, 13.8, 4.98, 2.2, 0, 2, 0),
  unknown: spec('dart', 'unknown', 30, 26, 10, 3, 30, 2, 1.5),
});

// The words of a model text that name a type of the table, most specific first (a neo before its ceo, a MAX before
// the 737 it extends). Matched on the upper-cased text; a number never matches inside a longer number.
const MODEL_ALIASES = Object.freeze([
  [/(?<!\d)737[\s-]*MAX[\s-]*8(?!\d)|(?<!\d)737-8(?!\d)/, 'B38M'],
  [/(?<!\d)737[\s-]*MAX[\s-]*9(?!\d)|(?<!\d)737-9(?!\d)/, 'B39M'],
  [/(?<!\d)737[\s-]*800(?!\d)/, 'B738'],
  [/(?<!\d)737[\s-]*700(?!\d)/, 'B737'],
  [/(?<!\d)321[\s-]*NEO\b/, 'A21N'],
  [/(?<!\d)320[\s-]*NEO\b/, 'A20N'],
  [/\bA321(?!\d)/, 'A321'],
  [/\bA320(?!\d)/, 'A320'],
  [/(?<!\d)757[\s-]*200(?!\d)/, 'B752'],
  [/(?<!\d)767[\s-]*300(?!\d)/, 'B763'],
  [/(?<!\d)777[\s-]*300[\s-]*ER\b/, 'B77W'],
  [/\bA330[\s-]*300(?!\d)/, 'A333'],
  [/\bA350[\s-]*900(?!\d)/, 'A359'],
  [/(?<!\d)787[\s-]*8(?!\d)/, 'B788'],
  [/(?<!\d)787[\s-]*9(?!\d)/, 'B789'],
  [/\b(?:E|ERJ|EMB|EMBRAER)[\s-]*190(?!\d)/, 'E190'],
  [/\b(?:E|ERJ|EMB|EMBRAER)[\s-]*195(?!\d)/, 'E195'],
  [/\bA220[\s-]*300(?!\d)|\bCS[\s-]*300(?!\d)/, 'BCS3'],
  [/\bCRJ[\s-]*900(?!\d)/, 'CRJ9'],
  [/\bATR[\s-]*72(?!\d)/, 'AT76'],
]);

// ICAO designators outside the table whose shape the emitter category would get wrong: four engines, turboprops and
// rear-engined regional jets. Their icon is the category's; their dimensions are the category's generic ones.
const DESIGNATOR_CATEGORIES = Object.freeze(Object.fromEntries([
  ...['A342', 'A343', 'A345', 'A346', 'A388', 'B741', 'B742', 'B743', 'B744', 'B748', 'B74S', 'IL96', 'A124']
    .map(code => [code, 'heavy4']),
  ...['AT43', 'AT45', 'AT72', 'AT73', 'AT75', 'AT46', 'DH8A', 'DH8B', 'DH8C', 'DH8D', 'SF34', 'JS41', 'E120', 'D328',
    'B190', 'C208', 'PC12'].map(code => [code, 'turboprop']),
  ...['CRJ1', 'CRJ2', 'CRJ7', 'CRJX', 'E135', 'E145', 'E35L', 'F70', 'F100'].map(code => [code, 'regional']),
]));

const SIZE_CATEGORIES = Object.freeze({ Narrowbody: 'narrow', Widebody: 'wide2' });

// ADS-B emitter categories (DO-260B): A1 light, A2 small, A3 large, A4 high-vortex large (the 757), A5 heavy, A7
// rotorcraft. A6 (high performance), gliders, balloons, drones and surface vehicles keep the neutral dart.
const EMITTER_CATEGORIES = Object.freeze({ A1: 'light', A2: 'bizjet', A3: 'narrow', A4: 'narrow', A5: 'wide2', A7: 'heli' });

const text = value => (typeof value === 'string' ? value.trim().toUpperCase() : '');
const own = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined);

/** The type of the table that a model text names («737 MAX 8» → B38M, «A321neo» → A21N), or `null`. */
export function typeFromModel(model) {
  const words = text(model);
  if (words === '') return null;
  return MODEL_ALIASES.find(([pattern]) => pattern.test(words))?.[1] ?? null;
}

/**
 * What the map knows of an aircraft's type: `{ code, spec, iconCategory, approximate }`. In order: the ICAO designator
 * when the table holds it; a type the model text names; the category of a known designator outside the table; the
 * size category of the ELEVANT flight (Narrowbody, Widebody); the ADS-B emitter category; the neutral dart. Only the
 * first two give the type's own dimensions (`code` is its designator and `approximate` false); every other answer
 * takes the category's generic airframe, with `code` null and `approximate` true.
 */
export function resolveAircraftType({ typeIcao = null, model = null, sizeCategory = null, emitterCategory = null } = {}) {
  const designator = text(typeIcao);
  const code = own(AIRCRAFT_TYPES, designator) ? designator : typeFromModel(model);
  if (code !== null) {
    const known = AIRCRAFT_TYPES[code];
    return Object.freeze({ code, spec: known, iconCategory: known.iconCategory, approximate: false });
  }
  const category = own(DESIGNATOR_CATEGORIES, designator)
    ?? own(SIZE_CATEGORIES, sizeCategory)
    ?? own(EMITTER_CATEGORIES, text(emitterCategory))
    ?? 'unknown';
  return Object.freeze({ code: null, spec: CATEGORY_FALLBACKS[category], iconCategory: category, approximate: true });
}
