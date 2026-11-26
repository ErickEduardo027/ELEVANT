import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Camera, CanvasTexture, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, DynamicDrawUsage, ExtrudeGeometry, Float32BufferAttribute, Group, HemisphereLight, InstancedBufferAttribute,
  InstancedMesh, LatheGeometry, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshStandardMaterial, Raycaster, SRGBColorSpace, Scene, Shape, SphereGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The entry of the 3D chunk (design J): three and the aircraft modules that need it travel together, and only
// loadAircraft3d.js reaches this module, through import(), so no first-load chunk of an OCC route carries three
// (scripts/verify-map-chunks.mjs fails the build otherwise). Named imports only, so the bundler keeps what the 3D
// aircraft use; no Draco, KTX2 or workers.

export { buildAircraftGeometry } from './aircraftGeometry';
export { buildDetailedAircraft } from './aircraftDetail';
export { AIRCRAFT_3D_LAYER_ID, createAircraft3dLayer, sceneLighting } from './aircraft3dLayer';

/** The parts of three that the aircraft modules take as their `three` parameter: the models' and the layer's. */
export const THREE_PARTS = Object.freeze({
  AdditiveBlending, BoxGeometry, BufferGeometry, Camera, CanvasTexture, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, DynamicDrawUsage, ExtrudeGeometry, Float32BufferAttribute, Group, HemisphereLight, InstancedBufferAttribute,
  InstancedMesh, LatheGeometry, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshStandardMaterial, Raycaster, SRGBColorSpace, Scene, Shape, SphereGeometry, Vector2, Vector3, WebGLRenderer,
  mergeGeometries,
});
