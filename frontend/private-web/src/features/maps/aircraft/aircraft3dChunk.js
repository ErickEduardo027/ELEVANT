import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Camera, CanvasTexture, Color, CylinderGeometry, DataTexture,
  DirectionalLight, DoubleSide, DynamicDrawUsage, ExtrudeGeometry, Float32BufferAttribute, FloatType, Group,
  HemisphereLight, InstancedBufferAttribute, InstancedMesh, LatheGeometry, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, NearestFilter, NoColorSpace, RGBAFormat, Raycaster,
  SRGBColorSpace, Scene, ShaderMaterial, Shape, SphereGeometry, SubtractiveBlending, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The entry of the 3D chunk (design J): three and the aircraft modules that need it travel together, and only
// loadAircraft3d.js reaches this module, through import(), so no first-load chunk of an OCC route carries three
// (scripts/verify-map-chunks.mjs fails the build otherwise). Named imports only, so the bundler keeps what the 3D
// aircraft use; no Draco, KTX2 or workers. PR M5: three's GLTFLoader reads the types' 3D models (aircraft/gltfModels.js),
// without its Draco, KTX2 or meshopt decoders: the models need none, and the page's CSP allows none.

export { buildAircraftGeometry } from './aircraftGeometry';
export { buildDetailedAircraft } from './aircraftDetail';
export { AIRCRAFT_3D_LAYER_ID, createAircraft3dLayer, sceneLighting } from './aircraft3dLayer';

/** The parts of three that the aircraft modules take as their `three` parameter: the models' and the layer's. */
export const THREE_PARTS = Object.freeze({
  AdditiveBlending, BoxGeometry, BufferGeometry, Camera, CanvasTexture, Color, CylinderGeometry, DataTexture,
  DirectionalLight, DoubleSide, DynamicDrawUsage, ExtrudeGeometry, Float32BufferAttribute, FloatType, GLTFLoader, Group,
  HemisphereLight, InstancedBufferAttribute, InstancedMesh, LatheGeometry, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, NearestFilter, NoColorSpace, RGBAFormat, Raycaster,
  SRGBColorSpace, Scene, ShaderMaterial, Shape, SphereGeometry, SubtractiveBlending, Vector2, Vector3, WebGLRenderer,
  mergeGeometries,
});
