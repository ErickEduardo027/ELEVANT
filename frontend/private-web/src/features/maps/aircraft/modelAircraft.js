import { buildGearGeometry } from './aircraftDetail';
import { createLiveryMaterial, liveryFrame, liveryRow } from './liveryMaterial';

// The 3D models of the types (aircraft/gltfModels.js) made ready to draw (PR M5): the L1 model as the geometry of an
// instanced mesh, with the app's landing gear merged in (the models have none) and marked so the livery material folds
// it away per instance; the L2 model as the airframe of the detailed aircraft (aircraft/aircraftDetail.js: airframe),
// its body in its airline's livery and its glass and dark parts in their own plain materials. `three` is a parameter.

const PLAIN = Object.freeze({
  glass: Object.freeze({ color: '#1b2530', roughness: 0.18, metalness: 0.35 }),
  dark: Object.freeze({ color: '#15181c', roughness: 0.7, metalness: 0.3 }),
});

// One livery frame per loaded model: its positions do not change.
const frames = new WeakMap();

/** The livery frame (aircraft/liveryMaterial.js: liveryFrame) of a loaded model, read once. */
export function modelFrame(model, spec) {
  let frame = frames.get(model);
  if (frame === undefined) {
    // Every part of the model: the L1 model is one primitive already, and in L2 the intakes are dark parts.
    const body = model.geometry;
    frame = liveryFrame(body.getAttribute('position').array, spec, body.getIndex()?.array ?? null);
    frames.set(model, frame);
  }
  return frame;
}

function partAttribute(three, count, value) {
  return new three.Float32BufferAttribute(new Float32Array(count).fill(value), 1);
}

/**
 * The geometry of a type's L1 model for its instanced mesh: positions, normals and `liveryPart` (0 the airframe, 1 the
 * gear's legs, 2 its tyres), the gear (aircraftDetail.js: buildGearGeometry) merged in when the manifest says the model
 * has none. A new geometry the caller owns.
 */
export function instancedModelGeometry(three, model, spec, code = null) {
  const airframe = model.geometry.getIndex() === null ? model.geometry.clone() : model.geometry.toNonIndexed();
  for (const name of Object.keys(airframe.attributes)) {
    if (name !== 'position' && name !== 'normal') airframe.deleteAttribute(name);
  }
  airframe.setAttribute('liveryPart', partAttribute(three, airframe.getAttribute('position').count, 0));
  const gear = model.entry?.hasGear === true ? null : buildGearGeometry(three, spec, code);
  if (gear === null) return airframe;
  gear.metal.setAttribute('liveryPart', partAttribute(three, gear.metal.getAttribute('position').count, 1));
  gear.tyres.setAttribute('liveryPart', partAttribute(three, gear.tyres.getAttribute('position').count, 2));
  const merged = three.mergeGeometries([airframe, gear.metal, gear.tyres], false);
  airframe.dispose();
  gear.metal.dispose();
  gear.tyres.dispose();
  return merged;
}

/**
 * Writes the per-instance attributes of a livery mesh's geometry for `capacity` instances: `liveryIndex` (the
 * palette's row, −1 for the plain instance colour) and `liveryGear` (1 down, 0 up), from `liveries` (livery ids, or
 * null) and `gear` (0 or 1 each); what is not given takes −1 and 1.
 */
export function writeLiveryInstances(three, geometry, { capacity, count, liveries = null, gear = null }) {
  let index = geometry.getAttribute('liveryIndex');
  let down = geometry.getAttribute('liveryGear');
  if (!index || !down || index.count < capacity) {
    index = new three.InstancedBufferAttribute(new Float32Array(capacity), 1);
    index.setUsage(three.DynamicDrawUsage);
    geometry.setAttribute('liveryIndex', index);
    down = new three.InstancedBufferAttribute(new Float32Array(capacity), 1);
    down.setUsage(three.DynamicDrawUsage);
    geometry.setAttribute('liveryGear', down);
  }
  for (let at = 0; at < count; at += 1) {
    const id = liveries?.[at] ?? null;
    index.array[at] = id === null ? -1 : liveryRow(id);
    down.array[at] = gear && !(gear[at] > 0.5) ? 0 : 1;
  }
  index.needsUpdate = true;
  down.needsUpdate = true;
}

/** The key of a loaded model's livery material in a cache of shared materials: one per type and level. */
export const modelMaterialKey = model => `model:livery:${model.code}:${model.level}`;

/**
 * The airframe of the detailed aircraft from a type's L2 model, in `livery`: `{ meshes, frame, dispose, refreshLogo }`.
 * The body is a one-instance mesh with the livery material (its row of the shared `textures`), the glass and dark
 * parts plain meshes; the model's own geometries are shared with its cache and never disposed here.
 */
export function buildModelAirframe(three, model, { spec, livery, textures, materials: shared = null }) {
  const frame = modelFrame(model, spec);
  const materials = [];
  // HOTFIX-3D: with a cache of shared materials (`materials(key, make)`), the body's livery material is the model's
  // and the plain parts' are the cache's: a detailed aircraft built again makes none, and dispose() leaves them.
  const materialOf = (key, make) => {
    if (typeof shared === 'function') return shared(key, make);
    const made = make();
    materials.push(made);
    return made;
  };
  const geometries = [];
  const meshes = [];
  for (const part of model.parts) {
    if (part.name === 'body') {
      const geometry = part.geometry.clone();
      geometry.setAttribute('liveryPart', partAttribute(three, geometry.getAttribute('position').count, 0));
      writeLiveryInstances(three, geometry, { capacity: 1, count: 1, liveries: [livery.id], gear: [1] });
      geometries.push(geometry);
      const material = materialOf(modelMaterialKey(model), () => createLiveryMaterial(three, { frame, textures }));
      const mesh = new three.InstancedMesh(geometry, material, 1);
      mesh.instanceMatrix.array.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      mesh.name = 'fuselage';
      meshes.push(mesh);
    } else {
      const plain = Object.hasOwn(PLAIN, part.name) ? part.name : 'dark';
      const material = materialOf(`model:plain:${plain}`,
        () => new three.MeshStandardMaterial({ ...PLAIN[plain], side: three.DoubleSide }));
      const mesh = new three.Mesh(part.geometry, material);
      mesh.name = part.name;
      meshes.push(mesh);
    }
  }
  for (const mesh of meshes) mesh.frustumCulled = false;
  return {
    meshes,
    frame,
    // The lettering lives in the shared atlas: the layer paints it again when a logo loads.
    refreshLogo: () => false,
    dispose() {
      for (const mesh of meshes) mesh.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
