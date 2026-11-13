// The OpenStreetMap extract of Punta Cana airport (PR M3): the Overpass query and the trimming of its answer. Pure;
// the network call lives only in scripts/maps/fetch-mdpc-osm.mjs, which is run by hand once and never by tests, CI or
// the build. The extract is © OpenStreetMap contributors under the ODbL 1.0.

export const MDPC_ARP = Object.freeze({ lat: 18.5674, lon: -68.3634 });

export const WAY_AEROWAYS = Object.freeze([
  'runway', 'taxiway', 'taxilane', 'apron', 'parking_position', 'terminal', 'holding_position',
]);
export const NODE_AEROWAYS = Object.freeze(['gate', 'parking_position', 'holding_position']);

/** The only tags kept in the committed extract: nothing personal, nothing the layout does not read. */
export const TAG_ALLOWLIST = Object.freeze([
  'aeroway', 'ref', 'name', 'width', 'surface', 'length', 'building', 'terminal',
]);

/** The Overpass QL query: aeroway ways and nodes within `radiusM` of the point, with node ids and geometry. */
export function overpassQuery({ lat = MDPC_ARP.lat, lon = MDPC_ARP.lon, radiusM = 4000 } = {}) {
  const around = `(around:${radiusM},${lat},${lon})`;
  return [
    '[out:json][timeout:90];',
    '(',
    `  way["aeroway"~"^(${WAY_AEROWAYS.join('|')})$"]${around};`,
    `  node["aeroway"~"^(${NODE_AEROWAYS.join('|')})$"]${around};`,
    ');',
    'out body geom;',
  ].join('\n');
}

function filterTags(tags = {}) {
  return Object.fromEntries(Object.keys(tags).sort()
    .filter(key => TAG_ALLOWLIST.includes(key))
    .map(key => [key, String(tags[key])]));
}

const byTypeAndId = (a, b) => (a.type === b.type ? a.id - b.id : a.type < b.type ? -1 : 1);

/**
 * Trims an Overpass answer to what the layout reads, in a stable order: `version`, `osm3s` (timestamp and copyright)
 * and the elements with their type, id, allowed tags, node ids and geometry (`[lat, lon]` pairs become
 * `{ lat, lon }` exactly as Overpass sends them).
 */
export function trimOverpassResponse(response) {
  const elements = (response?.elements ?? [])
    .filter(element => element.type === 'way' || element.type === 'node')
    .map(element => (element.type === 'node'
      ? { type: 'node', id: element.id, lat: element.lat, lon: element.lon, tags: filterTags(element.tags) }
      : {
        type: 'way',
        id: element.id,
        tags: filterTags(element.tags),
        nodes: [...(element.nodes ?? [])],
        geometry: (element.geometry ?? []).map(({ lat, lon }) => ({ lat, lon })),
      }))
    .sort(byTypeAndId);
  return {
    version: response?.version ?? null,
    generator: response?.generator ?? null,
    osm3s: {
      timestamp_osm_base: response?.osm3s?.timestamp_osm_base ?? null,
      copyright: response?.osm3s?.copyright ?? null,
    },
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    elements,
  };
}
