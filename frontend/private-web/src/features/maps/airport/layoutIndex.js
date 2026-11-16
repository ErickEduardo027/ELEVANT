import { normalizeStandCode } from '../../../services/standCodes.js';
import { buildTaxiGraph } from './taxiGraph.js';

// What the maps read of an airport layout without the dataset itself (PR M4): the index that finds a stand by its
// code and the short stand list the positions mapper takes. The stand model (stands/standModel.js), the screens and
// the services receive the layout as a parameter and import only this module, so the MDPC dataset (157 KB) stays in
// the map chunk. Pure and Node-safe like geo.js: explicit '.js' imports only, never JSON.
// Stand codes compare through normalizeStandCode (ADR-0041): «A01» and «a-1» are «A1»; nothing else is inferred,
// so «1», «9A» or «23A» match only a stand or an alias the layout lists, and the alias table ships empty.

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

/**
 * Indexes a layout: `{ standsByCode: Map(normalized code or alias → stand), aliasCodes: Set, nodesById, graph }`. A
 * stand's own code wins over another stand's alias.
 */
export function indexLayout(layout) {
  const standsByCode = new Map();
  const aliasCodes = new Set();
  for (const stand of layout.stands) standsByCode.set(normalizeStandCode(stand.code), stand);
  for (const stand of layout.stands) {
    for (const alias of stand.aliases ?? []) {
      const code = normalizeStandCode(alias);
      if (code === '' || standsByCode.has(code)) continue;
      standsByCode.set(code, stand);
      aliasCodes.add(code);
    }
  }
  const nodesById = new Map(layout.taxiGraph.nodes.map(node => [node.id, node]));
  return { standsByCode, aliasCodes, nodesById, graph: buildTaxiGraph(layout.taxiGraph) };
}

/** The stand a code names: `{ stand, via: 'code' | 'alias' }`, or `null`. Formatting is normalized; nothing is inferred. */
export function matchStand(code, index) {
  const normalized = normalizeStandCode(code);
  if (normalized === '') return null;
  const stand = index.standsByCode.get(normalized);
  if (!stand) return null;
  return { stand, via: index.aliasCodes.has(normalized) ? 'alias' : 'code' };
}

/**
 * The short stand list of a layout, in the shape of RAMP_POSITIONS (dashboard/positionsData.js) that
 * positions-map/positionsMapMappers.js takes: `[{ id, code, terminal, lat, lon, retired }]`, frozen, in the layout's
 * order. `id` and `code` are the stand's normalized code; the centre is the stand's `center`, the point of the owner's
 * coordinate document (owner decision 20). A retired stand stays in the list with `retired: true`, as B33 stays in
 * positionsData.js, and the mapper leaves it out; a stand without a centre is not a reference and is skipped.
 */
export function layoutStandReferences(layout) {
  const references = [];
  for (const stand of layout?.stands ?? []) {
    const [lon, lat] = Array.isArray(stand?.center) ? stand.center : [];
    const code = normalizeStandCode(stand?.code);
    if (code === '' || !isFiniteNumber(lon) || !isFiniteNumber(lat)) continue;
    references.push({ id: code, code, terminal: stand.terminal ?? null, lat, lon, retired: stand.retired === true });
  }
  return deepFreeze(references);
}
