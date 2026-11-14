import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, LatheGeometry, Matrix4,
  Shape, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The entry of the 3D chunk (design J): three and the aircraft modules that need it travel together, and only
// loadAircraft3d.js reaches this module, through import(), so no first-load chunk of an OCC route carries three
// (scripts/verify-map-chunks.mjs fails the build otherwise). Named imports only, so the bundler keeps what the 3D
// aircraft use; no Draco, KTX2 or workers.

export { buildAircraftGeometry } from './aircraftGeometry';

/** The parts of three that the aircraft modules take as their `three` parameter. */
export const THREE_PARTS = Object.freeze({
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, LatheGeometry, Matrix4,
  Shape, Vector2, Vector3, mergeGeometries,
});
