import { createTranslator } from '../../../i18n/languageStore';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, METRES_PER_NM, roundCoord, toEnu } from '../airport/geo';
import { REGION_CONTEXT } from '../airport/regionContext';
import { ALIGNED_DEG, runwayEnds, runwayInUse } from '../airport/runwayInUse';
import { metarWindForRunway } from '../airport/runwayWind';
import { WORLD_AIRPORTS, isEmphasisedAirport } from '../airport/worldAirports';
import { PUJ_ARP } from '../core/cameraPresets';
import { mapMessages } from '../mapMessages';
import { HOME_AIRPORT_IATA } from '../style/basemapLayers';

// The reference overlays of the OCC maps (design E6, PR M8), the one owner of their features: the aerodrome reference
// point of Punta Cana, the range rings around it, the extended runway centrelines with a tick per nautical mile and the
// runway in use, the airports of the region (airport/regionContext.js) with the counterparts of today's flights
// emphasised, and the navaids PNA and PCA. style/referenceLayers.js draws them from two sources, where `kind` says what
// each feature is, and re-exports their builders: the reference point and the rings (referenceFeatures), and what is
// drawn from OurAirports data, the centrelines (from the thresholds and headings of the layout's runway ends), the
// airports and the navaids (ourAirportsFeatures), on a source that carries the credit of OurAirports, so the map shows
// it only while one of them is drawn (design A7). The night shade is traffic/nightShade.js, on a source of its own.
// Pure: the runway in use, the counterparts, the language and the instant are parameters, and nothing here reads a clock.
//
// The runway in use follows contracts 2.3 (owner decision 19): the recent live arrivals, then the wind of a live METAR,
// then the usual 08 (airport/runwayInUse.js). An arrival counts only on final, on the extended centreline of a runway
// end and flying its course (finalApproachEnd), and its vote lasts ten minutes of the server's clock
// (rememberArrivals), so the runway holds between two arrivals. Its centreline is drawn wider and labelled with where
// it comes from: «Pista 08 (según las llegadas)», «Pista 08 (estimada por el viento)» or «Pista 08 (habitual)».

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

/**
 * A live arrival is on final for a runway end, and counts for the runway in use, between its threshold and this far
 * out along the end's extended centreline…
 */
export const FINAL_NM = 12;
/** …this far across that centreline at most… */
export const FINAL_LATERAL_NM = 1;
/** …and this high at most, flying the end's course (airport/runwayInUse.js: ALIGNED_DEG) and not climbing. */
export const FINAL_MAX_ALT_M = 1000;
/** How long the vote of a live arrival seen on final lasts, on the server's clock: the recent arrivals of contracts 2.3. */
export const ARRIVAL_VOTE_MINUTES = 10;

/**
 * The oldest METAR whose wind still decides the runway: the API's own limit for a live one
 * (OCC_AERODROME_WEATHER_LIMITS.liveMetarMinutes), so a reading kept after failed refreshes stops deciding once it ages.
 */
export const WIND_MAX_AGE_MINUTES = 90;

/** The kinds of the legend, in its order (ui/referenceLegend.js). */
export const REFERENCE_LEGEND_KINDS = Object.freeze([
  'rings', 'centrelines', 'runwayInUse', 'counterparts', 'vor', 'ndb', 'night',
]);

/** The navaid types the map draws, each with its legend kind. */
export const NAVAID_KINDS = Object.freeze({ 'VOR-DME': 'vor', NDB: 'ndb' });

const DIGITS = 5;
const MINUTE_MS = 60_000;
const VOTE_MS = ARRIVAL_VOTE_MINUTES * MINUTE_MS;
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

// Where `position` is from the threshold of a runway end, in metres: out along its extended centreline (positive on the
// approach side, away from the runway) and across it, in the threshold's local plane (geo.js: toEnu, exact for
// distances and bearings from it).
function fromThreshold(end, position) {
  const [east, north] = toEnu(end.threshold, position);
  const outward = (((end.headingTrue + 180) % 360) * Math.PI) / 180;
  return {
    alongM: east * Math.sin(outward) + north * Math.cos(outward),
    acrossM: Math.abs(east * Math.cos(outward) - north * Math.sin(outward)),
  };
}

/**
 * The runway end a live aircraft is on final for (contracts 2.3: the arrivals runwayInUse counts are on final), or
 * `null`. It is `quality: 'live'` (an estimated, stale or demo position never votes: a demo flight always uses 08), in
 * the air, not climbing, at FINAL_MAX_ALT_M or lower and flying within ALIGNED_DEG of the end's heading, on its extended
 * centreline: between the threshold and FINAL_NM out, FINAL_LATERAL_NM or less across it. Of two such ends, the one
 * whose centreline is nearer. So a downwind or a base leg, an aircraft heading for the airport from off the centreline
 * and a departure never say which runway is in use.
 */
export function finalApproachEnd(item, layout = MDPC_LAYOUT) {
  if (item?.quality !== 'live' || item.isDemo === true || item.onGround === true) return null;
  if (!finite(item.altM) || item.altM > FINAL_MAX_ALT_M || !finite(item.trackDeg)) return null;
  if (finite(item.vrateMs) && item.vrateMs > 0) return null;
  const position = [item.lon, item.lat];
  if (!isPoint(position)) return null;
  let best = null;
  for (const end of runwayEnds(layout)) {
    if (angleBetween(item.trackDeg, end.headingTrue) > ALIGNED_DEG) continue;
    const { alongM, acrossM } = fromThreshold(end, position);
    if (alongM < 0 || alongM > FINAL_NM * METRES_PER_NM || acrossM > FINAL_LATERAL_NM * METRES_PER_NM) continue;
    if (best === null || acrossM < best.acrossM) best = { end, acrossM };
  }
  return best === null ? null : best.end;
}

// An aircraft's vote is kept under its ADS-B address, else its id.
const voteKey = item => [item?.hex, item?.id].find(value => typeof value === 'string' && value.trim() !== '') ?? null;
const isVote = vote => typeof vote?.key === 'string' && typeof vote.ident === 'string' && finite(vote.trackDeg);
// A vote counts at `nowMs` up to ARRIVAL_VOTE_MINUTES after its position; without an instant to judge by, it counts.
const isRecent = (vote, nowMs) => !finite(nowMs) || (finite(vote.at) && nowMs - vote.at <= VOTE_MS);

/**
 * The live arrivals of `aircraft` on final now (finalApproachEnd), each as its vote for the runway in use, frozen:
 * `{ key, ident, trackDeg, at }`. `key` is the aircraft's ADS-B address, else its id (an aircraft with neither is not
 * counted); `ident` the runway end it flies to; `trackDeg` the course of that final, the end's heading, so runwayInUse
 * counts the vote for that end; and `at` the instant of the position (`positionAt`, else `nowMs`).
 */
export function arrivalsOnFinal(aircraft, { layout = MDPC_LAYOUT, nowMs = null } = {}) {
  const votes = [];
  for (const item of Array.isArray(aircraft) ? aircraft : []) {
    const key = voteKey(item);
    const end = key === null ? null : finalApproachEnd(item, layout);
    if (end === null) continue;
    const at = finite(item.positionAt) ? item.positionAt : (finite(nowMs) ? nowMs : null);
    votes.push(Object.freeze({ key, ident: end.ident, trackDeg: end.headingTrue, at }));
  }
  return Object.freeze(votes);
}

/**
 * The recent live arrivals at `nowMs`, the server's time (contracts 2.3): the votes of `previous` cast at most
 * ARRIVAL_VOTE_MINUTES before it, and those of the aircraft of `aircraft` on final now (arrivalsOnFinal), one per
 * aircraft, its newest. A vote outlives its aircraft's final, so the runway in use stays «según las llegadas» after the
 * landing and between two arrivals, until ten minutes pass without one. Frozen and sorted by key: the same votes give
 * the same list.
 */
export function rememberArrivals(previous, aircraft, { layout = MDPC_LAYOUT, nowMs = null } = {}) {
  const byKey = new Map();
  const keep = vote => {
    if (!isVote(vote) || !isRecent(vote, nowMs)) return;
    const held = byKey.get(vote.key);
    if (held && finite(held.at) && finite(vote.at) && held.at > vote.at) return;
    byKey.set(vote.key, vote);
  };
  (Array.isArray(previous) ? previous : []).forEach(keep);
  arrivalsOnFinal(aircraft, { layout, nowMs }).forEach(keep);
  return Object.freeze([...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : Number(a.key > b.key))));
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
 * The runway in use on the map at `nowMs` (the server's time): the recent live arrivals, `arrivals` (their votes, as
 * rememberArrivals keeps them or arrivalsOnFinal gives them; one cast more than ARRIVAL_VOTE_MINUTES before `nowMs` no
 * longer counts), then the wind of a live `weather`, then the layout's usual runway (08 at Punta Cana).
 */
export function mapRunwayInUse({ layout = MDPC_LAYOUT, arrivals = [], weather = null, nowMs = null } = {}) {
  const recent = (Array.isArray(arrivals) ? arrivals : [])
    .filter(vote => isVote(vote) && isRecent(vote, nowMs))
    .map(vote => ({ trackDeg: vote.trackDeg }));
  return runwayInUse({ layout, recentLiveArrivals: recent, wind: runwayWindOf(weather, nowMs) });
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

const HOME_ICAO = 'MDPC';

/** The kinds of the region's airports (style/referenceLayers.js colours them), in the legend's order. */
export const AIRPORT_KINDS = Object.freeze(['home', 'international', 'regional', 'other']);

/** The kind of an airport of region.context.json: the home airport, international, regional, or another aerodrome. */
export function airportKind(airport) {
  if (airport?.icao === HOME_ICAO || airport?.ident === HOME_ICAO) return 'home';
  if (airport?.type === 'large_airport' || /international/i.test(airport?.name ?? '')) return 'international';
  if (airport?.type === 'medium_airport' && typeof airport?.iata === 'string' && airport.iata !== '') return 'regional';
  return 'other';
}

/** The label of an airport: «ICAO/IATA», or the one it has; the home airport its ICAO (the ARP mark says PUJ). */
export function airportLabel(airport) {
  const codes = [airport?.icao ?? airport?.ident, airport?.iata].filter(code => typeof code === 'string' && code !== '');
  if (airportKind(airport) === 'home') return codes[0] ?? '';
  return [...new Set(codes)].join('/');
}

/**
 * The airports of the region (`region.airports`, MDPC among them as the `home` kind), each with its kind
 * (airportKind), its label «MDSD/SDQ» (airportLabel) and `counterpart: true` for the airport of a flight of today
 * (`counterparts`, codes as counterpartCodes gives them; never the home airport).
 */
export function regionAirportFeatures(region = REGION_CONTEXT, { counterparts = [], emphasis = false } = {}) {
  const wanted = new Set((counterparts ?? []).map(code => String(code).toUpperCase()));
  return (region?.airports ?? [])
    .filter(airport => typeof (airport?.icao ?? airport?.ident) === 'string' && isPoint(airport.p))
    .map(airport => {
      const icao = airport.icao ?? airport.ident;
      const iata = typeof airport.iata === 'string' && airport.iata !== '' ? airport.iata : null;
      const kind = airportKind(airport);
      return feature({
        kind: 'airport',
        airportKind: kind,
        icao,
        iata,
        label: airportLabel(airport),
        counterpart: kind !== 'home' && (wanted.has(icao) || (iata !== null && wanted.has(iata))),
        ...(emphasis ? { rd: isEmphasisedAirport(airport) } : {}),
      }, point([airport.p[0], airport.p[1]]));
    });
}

/**
 * The world's airports the globe of Monitoreo adds (M8, airport/worldAirports.js: WORLD_AIRPORTS) to those of the
 * region: every one whose ICAO is not in `region`, as regionAirportFeatures writes them, `world: true`, and `rd: true`
 * for a Dominican one, which the map draws larger and always labels. They are large airports but for the Dominican
 * extras, whose kind follows their name.
 */
export function worldAirportFeatures(world = WORLD_AIRPORTS, { region = REGION_CONTEXT, counterparts = [] } = {}) {
  const known = new Set((region?.airports ?? []).map(airport => airport?.icao ?? airport?.ident));
  const airports = (world ?? [])
    .filter(airport => typeof airport?.icao === 'string' && !known.has(airport.icao))
    .map(airport => ({ ...airport, ident: airport.icao, type: isEmphasisedAirport(airport) ? undefined : 'large_airport' }));
  return regionAirportFeatures({ airports }, { counterparts, emphasis: true })
    .map(item => ({ ...item, properties: { ...item.properties, world: true } }));
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
 * The data of the reference source (style/referenceLayers.js: REFERENCE_SOURCE): the reference point of PUJ (`arp`,
 * first) and the range rings with their labels (`ring` and `ringLabel`, with `scope` region or approach). The same at
 * every instant and in every language.
 */
export function referenceFeatures() {
  return {
    type: 'FeatureCollection',
    features: [feature({ kind: 'arp', label: HOME_AIRPORT_IATA }, point([...PUJ_ARP])), ...ringFeatures(PUJ_ARP)],
  };
}

/**
 * The data of the OurAirports source (style/referenceLayers.js: OURAIRPORTS_SOURCE, which carries its credit): what the
 * map draws from OurAirports data. The extended centrelines of the layout's runway ends, whose thresholds and headings
 * come from it (`centreline`, `tick`, `centrelineLabel`), and the airports of the region (`airport`) and the navaids
 * (`navaid`) of region.context.json. `runway` is the runway in use (airport/runwayInUse.js; the layout's usual one by
 * default) and `counterparts` the codes of today's counterparts. `world` (M8, the globe of Monitoreo: WORLD_AIRPORTS)
 * adds the world's airports after the region's (worldAirportFeatures) and marks the Dominican ones `rd`.
 */
export function ourAirportsFeatures({
  layout = MDPC_LAYOUT, region = REGION_CONTEXT, runway = null, counterparts = [], language = 'es', world = null,
} = {}) {
  const emphasis = Array.isArray(world);
  const inUse = runway ?? runwayInUse({ layout });
  return {
    type: 'FeatureCollection',
    features: [
      ...extendedCentrelines(layout, { runway: inUse, language }),
      ...regionAirportFeatures(region, { counterparts, emphasis }),
      ...(emphasis ? worldAirportFeatures(world, { region, counterparts }) : []),
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
    // The region's airports are listed by kind while their layer is on (ui/MapLegend.jsx); a counterpart, by what it is.
    case 'airport': return properties.counterpart === true ? ['counterparts'] : [];
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
