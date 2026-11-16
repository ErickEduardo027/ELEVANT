import data from './data/region.context.json';

// The region around Punta Cana (PR M3, region.context.json): the 32 large and medium airports within 300 NM, MDPC
// included, and the navaids PNA (VOR-DME 112,7) and PCA (NDB 425), from OurAirports (public domain). Generated with the
// airport layout by scripts/maps/build-mdpc-layout.mjs and never edited by hand. The reference overlays draw them
// (traffic/referenceFeatures.js, PR M8), and the base map leaves out the tile labels of the same airports
// (style/basemapLayers.js), so each one is written once. Bundled with the map code, as airportLayout.js is.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** The region context of MDPC, frozen in depth: `{ meta, airports, navaids }`. */
export const REGION_CONTEXT = deepFreeze(data);

/** The IATA codes of the region's airports (MDPC's PUJ among them), without repeats. */
export const REGION_AIRPORT_IATAS = Object.freeze([...new Set(REGION_CONTEXT.airports
  .map(airport => airport.iata)
  .filter(code => typeof code === 'string' && code !== ''))]);
