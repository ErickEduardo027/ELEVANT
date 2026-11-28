import data from './data/world.airports.json';
import { REGION_CONTEXT } from './regionContext';

// The world's airports (M8, world.airports.json): the large airports with scheduled service and an IATA code and every
// Dominican airport, from OurAirports (public domain), written by scripts/maps/fetch-ourairports-world.mjs and never
// edited by hand. The globe of Monitoreo draws them from the Mundo and Región views with the Dominican ones emphasised
// (traffic/referenceFeatures.js: worldAirportFeatures), and every map takes from them, after the region's airports, the
// position of a flight's counterpart that the API row gives without one (counterpartPoint). Bundled with the map code,
// as regionContext.js is. Pure.

/** The country whose airports Monitoreo emphasises: the Dominican Republic. */
export const EMPHASIS_COUNTRY = 'DO';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const code = value => (typeof value === 'string' && value.trim() !== '' ? value.trim().toUpperCase() : null);

/**
 * The airports of world.airports.json, frozen: `{ icao, iata, name, country, p: [lng, lat] }` each (`iata` null when it
 * has none), sorted by ICAO.
 */
export const WORLD_AIRPORTS = Object.freeze((data?.airports ?? [])
  .filter(row => Array.isArray(row) && code(row[0]) !== null && finite(row[3]) && finite(row[4]))
  .map(([icao, iata, name, lon, lat, country]) => Object.freeze({
    icao, iata: code(iata), name: String(name ?? ''), country: code(country), p: Object.freeze([lon, lat]),
  })));

/** The source and date of the extract: `{ source, url, license, fetchedAt }`. */
export const WORLD_AIRPORTS_META = Object.freeze({
  source: data?.meta?.source ?? 'OurAirports', url: data?.meta?.url ?? null, license: data?.meta?.license ?? null,
  fetchedAt: data?.meta?.fetchedAt ?? null,
});

/** Whether Monitoreo emphasises an airport: a Dominican one (`country`, as OurAirports and both extracts write it). */
export const isEmphasisedAirport = airport => code(airport?.country) === EMPHASIS_COUNTRY;

// Every known airport by ICAO and by IATA: the region's first (6 decimals), then the world's.
let index = null;
function airportIndex() {
  if (index !== null) return index;
  index = new Map();
  const add = (keys, p) => {
    for (const key of keys.map(code).filter(Boolean)) if (!index.has(key)) index.set(key, p);
  };
  for (const airport of REGION_CONTEXT.airports ?? []) {
    if (Array.isArray(airport?.p) && finite(airport.p[0]) && finite(airport.p[1])) {
      add([airport.icao, airport.ident, airport.iata], Object.freeze([airport.p[0], airport.p[1]]));
    }
  }
  for (const airport of WORLD_AIRPORTS) add([airport.icao, airport.iata], airport.p);
  return index;
}

/** Where a known airport is, by its ICAO or IATA code (any case): `[lng, lat]`, or null. */
export function airportPosition(value) {
  const key = code(value);
  return key === null ? null : airportIndex().get(key) ?? null;
}

/**
 * Where a flight's counterpart airport is (contracts 1.3: `{ iataCode, icaoCode, latitude, longitude }`): its own
 * position when the API row has one, else the region's or the world's airport of its ICAO, then of its IATA code
 * (`[lng, lat]`), else null.
 */
export function counterpartPoint(counterpart) {
  if (finite(counterpart?.longitude) && finite(counterpart?.latitude)) return [counterpart.longitude, counterpart.latitude];
  const known = airportPosition(counterpart?.icaoCode) ?? airportPosition(counterpart?.iataCode);
  return known === null ? null : [known[0], known[1]];
}
