// Which model draws an aircraft (PR M5): the levels of detail of the 3D layer. Pure.
//
// - Far: the procedural model of its type (aircraft/aircraftGeometry.js), instanced, a few thousand triangles.
// - Near and on the stands: the type's L1 model (public/models/aircraft/<ICAO>/l1.gltf), instanced as well, in its
//   airline's livery (aircraft/liveryMaterial.js), once the type's aircraft are drawn at least L1_MIN_PX long on
//   screen: up close, which is where the stands and the aircraft taxiing near them are seen.
// - The followed or chosen aircraft drawn in detail (CN-30): the type's L2 model with the app's gear and lights.
// A type without a model (B763 among them, and every generic airframe) keeps its procedural model at every level, and
// so does a type whose model has not loaded yet.

/** From this length on screen (CSS pixels) a type's aircraft are drawn with its L1 model. */
export const L1_MIN_PX = 56;

/** Back to the procedural model below this share of L1_MIN_PX, so a zoom about the threshold does not flicker. */
export const L1_HYSTERESIS = 0.85;

// The equator in metres over the 512 px of a MapLibre world at zoom 0.
const METRES_PER_PIXEL_Z0 = 40_075_016.686 / 512;

const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Metres per CSS pixel of a MapLibre map at `zoom` and `latitudeDeg` (Web Mercator), or NaN. */
export function metresPerPixel(zoom, latitudeDeg) {
  if (!finite(zoom) || !finite(latitudeDeg)) return Number.NaN;
  return (METRES_PER_PIXEL_Z0 * Math.cos((latitudeDeg * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * The level of a type's instanced aircraft: 'l1' or 'procedural'. `lengthM` the type's length, `metresPerPixel` the
 * map's scale, `hasModel` whether its L1 model is loaded and `current` the level it has now (for the hysteresis).
 */
export function instancedLevel({ lengthM, metresPerPixel: scale, hasModel, current = 'procedural' } = {}) {
  if (hasModel !== true || !(lengthM > 0) || !(scale > 0)) return 'procedural';
  const pixels = lengthM / scale;
  const threshold = current === 'l1' ? L1_HYSTERESIS * L1_MIN_PX : L1_MIN_PX;
  return pixels >= threshold ? 'l1' : 'procedural';
}

/** Whether a type's aircraft are drawn large enough that its L1 model is worth reading (it may not be loaded yet). */
export function wantsL1({ lengthM, metresPerPixel: scale, current = 'procedural' } = {}) {
  return instancedLevel({ lengthM, metresPerPixel: scale, hasModel: true, current }) === 'l1';
}

/** The level of the detailed aircraft: 'l2' once its type's L2 model is loaded, else 'procedural'. */
export function detailLevel({ hasModel } = {}) {
  return hasModel === true ? 'l2' : 'procedural';
}
