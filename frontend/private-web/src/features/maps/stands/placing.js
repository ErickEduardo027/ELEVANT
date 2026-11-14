import { normalizeStandCode } from '../../../services/standCodes';
import { haversineM } from '../airport/geo';
import { matchStand } from '../airport/layoutIndex';
import { locationPoint, resolveStandGeometry, translateRigid } from '../airport/standGeometry';
import { standLayoutIndex } from './standModel';

// «Ubicar en el mapa» with a confirmation (PR M4, design D5, Decision D-2; the endpoint of ADR-0027 does not change): a
// ghost box of the stand at true size follows the pointer, a click sets a pending location that «Guardar ubicación»
// saves, and «Cancelar» or Esc drop it. The box is the stand's own outline in the airport layout, moved rigidly to the
// pointer; within PLACING_SNAP_M of the stand's centre in the layout (the point of the owner's coordinate document) it
// is exactly that outline, so a click there puts the stand back where the layout has it. A stand the layout does not
// know gets the box of its own that resolveStandGeometry derives for a saved location. Nothing here moves a stand
// towards OpenStreetMap (owner decision of 2026-11-13). Pure: the layout arrives as a parameter, never imported.

/** Within this distance of a stand's centre in the layout the ghost snaps to the stand's outline there. */
export const PLACING_SNAP_M = 15;

const ring = points => points.map(point => [point[0], point[1]]);

// A stand of the layout that can be drawn as the layout has it: a centre and a closed ring.
const surveyed = stand => locationPoint(stand?.center) !== null && Array.isArray(stand.polygon) && stand.polygon.length >= 4;

/**
 * The ghost of stand `code` with the pointer at `pointer` (`[lng, lat]` or `{ latitude, longitude }`), over the airport
 * `layout` (with its `index`, layoutIndex.js: indexLayout, when the caller has it):
 * - a stand of the layout (an active one: a retired stand is never matched): its polygon at true size, moved rigidly
 *   so its centre is the pointer (`snapped: false`), or, with the pointer within PLACING_SNAP_M of its centre in the
 *   layout, exactly its outline there with that centre (`snapped: true`);
 * - any other stand: the box of its own resolveStandGeometry derives for a location at the pointer (heading of the
 *   nearest active stand within 150 m, else perpendicular to the nearest taxi edge; code letter from `sizeHint`, the
 *   largest aircraft the stand takes), never snapped.
 * Returns `{ code, center, polygon (closed ring), headingTrue, sizeLetter, snapped, source: 'layout' | 'derived' }`,
 * or `null` without a pointer or a code.
 */
export function placingGhost({ code, pointer, layout = null, index = null, sizeHint = null } = {}) {
  const point = locationPoint(pointer);
  const id = normalizeStandCode(code);
  if (point === null || id === '') return null;
  const layoutIndex = index ?? standLayoutIndex(layout);
  const match = layoutIndex === null ? null : matchStand(id, layoutIndex);
  const stand = match !== null && match.stand.retired !== true && surveyed(match.stand) ? match.stand : null;
  if (stand !== null) {
    const center = locationPoint(stand.center);
    const snapped = haversineM(center, point) <= PLACING_SNAP_M;
    return {
      code: id,
      center: snapped ? center : point,
      polygon: snapped ? ring(stand.polygon) : translateRigid(stand.polygon, center, point),
      headingTrue: Number.isFinite(stand.headingTrue) ? stand.headingTrue : 0,
      sizeLetter: stand.sizeLetter ?? null,
      snapped,
      source: 'layout',
    };
  }
  const derived = resolveStandGeometry({ layoutStand: null, dbLocation: point, sizeHint, layout, index: layoutIndex });
  return {
    code: id,
    center: derived.center,
    polygon: derived.polygon,
    headingTrue: derived.headingTrue,
    sizeLetter: derived.sizeLetter,
    snapped: false,
    source: 'derived',
  };
}

/**
 * The location a click while placing gives, from the ghost at the click: `{ latitude, longitude, snapped }`, the
 * centre of the ghost (the layout's centre when it snapped, else the click itself), or `null` without a ghost.
 */
export function placedLocation(ghost) {
  if (!ghost?.center) return null;
  return { latitude: ghost.center[1], longitude: ghost.center[0], snapped: ghost.snapped === true };
}

const feature = (id, properties, geometry) => ({ type: 'Feature', id, properties: { id, ...properties }, geometry });

/**
 * The GeoJSON of the placing layers (stands/standLayers.js, source `occ-stand-ghost`): the pending location
 * (`pending`, a ghost: its box, kind `pending`, and its centre, kind `centre`) and the box that follows the pointer
 * (`ghost`, kind `ghost`, with `snapped`). Either may be `null`.
 */
export function ghostFeatures({ ghost = null, pending = null } = {}) {
  const features = [];
  if (pending?.polygon) {
    features.push(feature('pending', { kind: 'pending', code: pending.code, snapped: pending.snapped === true }, {
      type: 'Polygon', coordinates: [ring(pending.polygon)],
    }));
    features.push(feature('pending-centre', { kind: 'centre', code: pending.code }, {
      type: 'Point', coordinates: [pending.center[0], pending.center[1]],
    }));
  }
  if (ghost?.polygon) {
    features.push(feature('ghost', { kind: 'ghost', code: ghost.code, snapped: ghost.snapped === true }, {
      type: 'Polygon', coordinates: [ring(ghost.polygon)],
    }));
  }
  return { type: 'FeatureCollection', features };
}
