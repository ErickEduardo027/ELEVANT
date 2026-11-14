import { createTranslator } from '../../../i18n/languageStore';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, haversineM, initialBearing, METRES_PER_NM, roundCoord } from '../airport/geo';
import { REGION_CONTEXT } from '../airport/regionContext';
import { runwayEnds, runwayInUse } from '../airport/runwayInUse';
import { metarWindForRunway } from '../airport/runwayWind';
import { PUJ_ARP } from '../core/cameraPresets';
import { mapMessages } from '../mapMessages';
import { HOME_AIRPORT_IATA } from '../style/basemapLayers';

// The reference overlays of the OCC maps (design E6, PR M8), the one owner of their features: the aerodrome reference
// point of Punta Cana, the range rings around it, the extended runway centrelines with a tick per nautical mile and the
// runway in use, the airports of the region (airport/regionContext.js) with the counterparts of today's flights
// emphasised, and the navaids PNA and PCA. style/referenceLayers.js draws them from one source, where `kind` says what
// each feature is, and re-exports referenceFeatures. The night shade is traffic/nightShade.js, on a source of its own.
// Pure: the runway in use, the counterparts and the language are parameters, and nothing here reads a clock.
//
// The runway in use follows contracts 2.3 (owner decision 19): the recent live arrivals, then the wind of a live METAR,
// then the usual 08 (airport/runwayInUse.js). Its centreline is drawn wider and labelled with where it comes from:
// «Pista 08 (según las llegadas)», «Pista 08 (estimada por el viento)» or «Pista 08 (habitual)».

/** The range rings, in nautical miles, of the Región and Aproximación views. */
export const RANGE_RINGS_NM = Object.freeze({
  region: Object.freeze([50, 100, 150, 200, 250]),
  approach: Object.freeze([5, 10, 20, 40]),
});
/** The vertices of a ring. */
export const RING_STEPS = 128;
/**
 * Where a ring's label sits: north-east of the centre, over the open Atlantic, clear of the region's airports, of the
 * runway centrelines and of the dock and the legend at the bottom of the map.
 */
export const RING_LABEL_BEARING = 45;
/** How far an extended centreline runs from its threshold, with a tick at every nautical mile. */
export const CENTRELINE_NM = 10;
// Half the length of a tick across the centreline, in nautical miles: longer at 5 and 10.
const TICK_HALF_NM = 0.15;
const MAJOR_TICK_HALF_NM = 0.35;
const MAJOR_TICKS = new Set([5, 10]);
// The in-use label sits a little past the end of its centreline, clear of the last tick.
const LABEL_PAST_NM = 0.4;

/** A live arrival counts for the runway in use only this close to PUJ and this low, flying towards it. */
export const RECENT_ARRIVAL_NM = 12;
export const RECENT_ARRIVAL_MAX_ALT_M = 1000;
const TOWARDS_DEG = 45;

/**
 * The oldest METAR whose wind still decides the runway: the API's own limit for a live one
 * (OCC_AERODROME_WEATHER_LIMITS.liveMetarMinutes), so a reading kept after failed refreshes stops deciding once it ages.
 */
export const WIND_MAX_AGE_MINUTES = 90;

/** The kinds of the legend, in its order (ui/referenceLegend.js). */
export const REFERENCE_LEGEND_KINDS = Object.freeze([
  'rings', 'centrelines', 'runwayInUse', 'airports', 'counterparts', 'vor', 'ndb', 'night',
]);

/** The navaid types the map draws, each with its legend kind. */
export const NAVAID_KINDS = Object.freeze({ 'VOR-DME': 'vor', NDB: 'ndb' });

const DIGITS = 5;
const MINUTE_MS = 60_000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const isPoint = point => Array.isArray(point) && finite(point[0]) && finite(point[1]);
const angleBetween = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const at = (from, bearing, nm) => roundCoord(destinationPoint(from, bearing, nm * METRES_PER_NM), DIGITS);
const feature = (properties, geometry) => ({ type: 'Feature', properties, geometry });
const point = coordinates => ({ type: 'Point', coordinates });
const line = coordinates => ({ type: 'LineString', coordinates });

/** «20 NM». */
export const nmLabel = nm => `${nm} NM`;

/**
 * A closed ring of `radiusNm` nautical miles around `center` (`[lng, lat]`): `steps` vertices from the north, clockwise,
 * and the first again at the end.
 */
export function rangeRing(center, radiusNm, steps = RING_STEPS) {
  const vertices = Array.from({ length: steps }, (_, index) => at(center, (360 * index) / steps, radiusNm));
  return [...vertices, vertices[0]];
}

function ringFeatures(center) {
  return Object.entries(RANGE_RINGS_NM).flatMap(([scope, radii]) => radii.flatMap(radiusNm => {
    const label = nmLabel(radiusNm);
    return [
      feature({ kind: 'ring', scope, radiusNm, label }, line(rangeRing(center, radiusNm))),
      feature({ kind: 'ringLabel', scope, radiusNm, label }, point(at(center, RING_LABEL_BEARING, radiusNm))),
    ];
  }));
}

const RUNWAY_MESSAGES = Object.freeze({
  live: 'reference.runway.live',
  wind: 'reference.runway.wind',
  default: 'reference.runway.default',
  flight: 'reference.runway.flight',
});

/**
 * The words of the runway in use (`{ arrival, source }`, as airport/runwayInUse.js answers): «Pista 08 (según las
 * llegadas)», «Pista 08 (estimada por el viento)», «Pista 08 (habitual)», or «Pista 08» for a runway a flight carries;
 * `null` without a runway.
 */
export function runwayInUseLabel(result, language = 'es') {
  const ident = result?.arrival;
  if (typeof ident !== 'string' || ident.trim() === '') return null;
  return createTranslator(mapMessages, language)(RUNWAY_MESSAGES[result.source] ?? RUNWAY_MESSAGES.default, { ident });
}

/**
 * The extended centrelines of every runway end of `layout`: from each threshold, 10 NM out along the approach (the
 * end's true heading + 180°), with a tick across the line at every nautical mile, longer at 5 and 10. The end the runway
 * in use lands on (`runway.arrival`) carries `inUse` and the source of that choice, and a label past its last tick in
 * `language`. Features: `centreline` (`ident`, `inUse`, `source`), `tick` (also `nm` and `major`) and
 * `centrelineLabel` (`ident`, `label`, `anchor`: the side of the point the text starts on, away from the airport).
 */
export function extendedCentrelines(layout, { runway = null, language = 'es' } = {}) {
  const label = runwayInUseLabel(runway, language);
  return runwayEnds(layout).flatMap(end => {
    const outward = (end.headingTrue + 180) % 360;
    const inUse = label !== null && end.ident === runway.arrival;
    const common = { ident: end.ident, inUse, source: inUse ? runway.source : null };
    const threshold = roundCoord(end.threshold, DIGITS);
    const ticks = Array.from({ length: CENTRELINE_NM }, (_, index) => {
      const nm = index + 1;
      const major = MAJOR_TICKS.has(nm);
      const centre = destinationPoint(end.threshold, outward, nm * METRES_PER_NM);
      const half = major ? MAJOR_TICK_HALF_NM : TICK_HALF_NM;
      return feature({ kind: 'tick', ...common, nm, major }, line([at(centre, outward - 90, half), at(centre, outward + 90, half)]));
    });
    const features = [feature({ kind: 'centreline', ...common }, line([threshold, at(end.threshold, outward, CENTRELINE_NM)])), ...ticks];
    if (inUse) {
      // The text runs on away from the airport: to the east of its point for an approach from the east, else to the west.
      const anchor = outward > 0 && outward < 180 ? 'left' : 'right';
      features.push(feature({ kind: 'centrelineLabel', ident: end.ident, label, anchor },
        point(at(end.threshold, outward, CENTRELINE_NM + LABEL_PAST_NM))));
    }
    return features;
  });
}

/**
 * The live aircraft that tell the runway in use (contracts 2.3, airport/runwayInUse.js): `quality: 'live'`, in the air,
 * not climbing, at `maxAltM` or lower, within `maxNm` of `center` and flying towards it (within 45°), with a known
 * track; as `[{ trackDeg }]`. Estimated, stale and demo positions never vote: a demo flight always uses 08.
 */
export function recentLiveArrivals(aircraft, { center = PUJ_ARP, maxNm = RECENT_ARRIVAL_NM, maxAltM = RECENT_ARRIVAL_MAX_ALT_M } = {}) {
  const reach = maxNm * METRES_PER_NM;
  return Object.freeze((Array.isArray(aircraft) ? aircraft : [])
    .filter(item => item?.quality === 'live' && item.onGround !== true && finite(item.altM) && item.altM <= maxAltM
      && finite(item.trackDeg) && !(finite(item.vrateMs) && item.vrateMs > 0) && isPoint([item.lon, item.lat]))
    .filter(item => {
      const position = [item.lon, item.lat];
      if (haversineM(position, center) > reach) return false;
      return angleBetween(item.trackDeg, initialBearing(position, center)) <= TOWARDS_DEG;
    })
    .map(item => Object.freeze({ trackDeg: item.trackDeg })));
}

/**
 * The wind of the weather (useMdpcWeather's answer) for the runway in use: that of a `Live` METAR observed at most
 * WIND_MAX_AGE_MINUTES before `nowMs` (the server's time), as runwayInUse takes it; `null` for any other state, an older
 * reading, or a calm or variable wind.
 */
export function runwayWindOf(weather, nowMs) {
  if (weather?.apiStatus !== 'Live') return null;
  const observedAt = Date.parse(weather.data?.observedAt ?? '');
  if (!finite(observedAt) || (finite(nowMs) && nowMs - observedAt > WIND_MAX_AGE_MINUTES * MINUTE_MS)) return null;
  return metarWindForRunway(weather.data?.metar?.wind ?? null);
}

/**
 * The runway in use on the map at `nowMs`: the recent live arrivals of `aircraft`, then the wind of a live `weather`,
 * then the layout's usual runway (08 at Punta Cana).
 */
export function mapRunwayInUse({ layout = MDPC_LAYOUT, aircraft = [], weather = null, nowMs = null } = {}) {
  return runwayInUse({ layout, recentLiveArrivals: recentLiveArrivals(aircraft), wind: runwayWindOf(weather, nowMs) });
}

/**
 * The airports of today's flights (`counterpart` of the map flights, contracts 1.3): their IATA and ICAO codes in upper
 * case, sorted and without repeats. A cancelled flight names none.
 */
export function counterpartCodes(flights) {
  const codes = new Set();
  for (const flight of Array.isArray(flights) ? flights : []) {
    if (!flight || flight.phase === 'cancelled') continue;
    for (const code of [flight.counterpart?.iataCode, flight.counterpart?.icaoCode]) {
      if (typeof code === 'string' && code.trim() !== '') codes.add(code.trim().toUpperCase());
    }
  }
  return Object.freeze([...codes].sort());
}

/**
 * The airports of the region (`region.airports`), all but the station's own (its reference point draws it), labelled
 * «MDSD SDQ» (ICAO and IATA) or with the ICAO code alone, and `counterpart: true` for the airport of a flight of today
 * (`counterparts`, codes as counterpartCodes gives them).
 */
export function regionAirportFeatures(region = REGION_CONTEXT, { counterparts = [] } = {}) {
  const wanted = new Set((counterparts ?? []).map(code => String(code).toUpperCase()));
  return (region?.airports ?? [])
    .filter(airport => airport?.iata !== HOME_AIRPORT_IATA && typeof airport?.icao === 'string' && isPoint(airport.p))
    .map(airport => {
      const iata = typeof airport.iata === 'string' && airport.iata !== '' ? airport.iata : null;
      return feature({
        kind: 'airport',
        icao: airport.icao,
        iata,
        label: iata === null ? airport.icao : `${airport.icao} ${iata}`,
        counterpart: wanted.has(airport.icao) || (iata !== null && wanted.has(iata)),
      }, point([airport.p[0], airport.p[1]]));
    });
}

// The frequency of a navaid as a chart writes it: an NDB in kHz, a VOR-DME in MHz; Spanish takes a decimal comma.
function frequencyText(navaid, language) {
  if (!finite(navaid.frequencyKhz)) return navaid.frequencyLabel ?? '';
  if (navaid.type === 'NDB') return String(navaid.frequencyKhz);
  const megahertz = String(Number((navaid.frequencyKhz / 1000).toFixed(2)));
  return language === 'es' ? megahertz.replace('.', ',') : megahertz;
}

/**
 * The navaids of the region the map draws (VOR-DME and NDB), labelled with ident, type and frequency in `language`:
 * «PNA VOR-DME 112,7» and «PCA NDB 425» (Spanish takes a decimal comma).
 */
export function navaidFeatures(region = REGION_CONTEXT, language = 'es') {
  return (region?.navaids ?? [])
    .filter(navaid => Object.hasOwn(NAVAID_KINDS, navaid?.type) && typeof navaid.ident === 'string' && isPoint(navaid.p))
    .map(navaid => feature({
      kind: 'navaid',
      ident: navaid.ident,
      type: navaid.type,
      label: `${navaid.ident} ${navaid.type} ${frequencyText(navaid, language)}`,
    }, point([navaid.p[0], navaid.p[1]])));
}

/**
 * The data of the reference source: the reference point of PUJ (`arp`, first), the range rings and their labels
 * (`ring` and `ringLabel`, with `scope` region or approach), the extended centrelines (`centreline`, `tick`,
 * `centrelineLabel`), the airports of the region (`airport`) and the navaids (`navaid`). `runway` is the runway in use
 * (airport/runwayInUse.js; the layout's usual one by default) and `counterparts` the codes of today's counterparts.
 */
export function referenceFeatures({
  layout = MDPC_LAYOUT, region = REGION_CONTEXT, runway = null, counterparts = [], language = 'es',
} = {}) {
  const inUse = runway ?? runwayInUse({ layout });
  return {
    type: 'FeatureCollection',
    features: [
      feature({ kind: 'arp', label: HOME_AIRPORT_IATA }, point([...PUJ_ARP])),
      ...ringFeatures(PUJ_ARP),
      ...extendedCentrelines(layout, { runway: inUse, language }),
      ...regionAirportFeatures(region, { counterparts }),
      ...navaidFeatures(region, language),
    ],
  };
}

// The legend kinds a drawn feature stands for.
function kindsOf(properties) {
  switch (properties?.kind) {
    case 'ring': return ['rings'];
    case 'centreline':
    case 'tick': return properties.inUse === true ? ['centrelines', 'runwayInUse'] : ['centrelines'];
    case 'airport': return [properties.counterpart === true ? 'counterparts' : 'airports'];
    case 'navaid': return Object.hasOwn(NAVAID_KINDS, properties.type) ? [NAVAID_KINDS[properties.type]] : [];
    case 'night': return ['night'];
    default: return [];
  }
}

/**
 * What the map draws of the references, from the features queryRenderedFeatures answers for the reference layers
 * (style/referenceLayers.js: REFERENCE_LAYER_IDS): the legend kinds on screen, in REFERENCE_LEGEND_KINDS order. A
 * feature of any other kind is ignored.
 */
export function referenceKindsOnScreen(features) {
  const present = new Set((features ?? []).flatMap(item => kindsOf(item?.properties)));
  return Object.freeze(REFERENCE_LEGEND_KINDS.filter(kind => present.has(kind)));
}

/**
 * The references on screen for the legend: `{ kinds, runway }`, where `runway` is the runway in use its emphasised
 * centreline says (`{ arrival, source }`) while that centreline is drawn, else `null`.
 */
export function referencesOnScreen(features) {
  const kinds = referenceKindsOnScreen(features);
  const drawn = kinds.includes('runwayInUse')
    ? (features ?? []).find(item => kindsOf(item?.properties).includes('runwayInUse'))?.properties ?? null
    : null;
  return Object.freeze({ kinds, runway: drawn === null ? null : Object.freeze({ arrival: drawn.ident, source: drawn.source }) });
}
