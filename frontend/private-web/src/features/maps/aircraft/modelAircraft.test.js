// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THREE_PARTS } from './aircraft3dChunk';
import { MODELS_BASE_URL, createGltfModels } from './gltfModels';
import { LIVERIES } from './liveries';
import { createLiveryTextures, liveryRow } from './liveryMaterial';
import { buildModelAirframe, instancedModelGeometry, modelFrame, writeLiveryInstances } from './modelAircraft';
import { AIRCRAFT_TYPES } from './types';

// The 3D models made ready to draw (PR M5): L1 with the app's gear for the instanced meshes, L2 as the detailed
// aircraft's airframe, both from the vendored files in public/models/aircraft.
const PUBLIC = path.resolve(process.cwd(), 'public');

async function loadModel(code, level) {
  const fetchResource = async url => {
    const file = path.join(PUBLIC, url.replace(/^\//, ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    const bytes = fs.readFileSync(file);
    return {
      ok: true,
      json: async () => JSON.parse(bytes.toString('utf8')),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
  let resolve;
  const loaded = new Promise(done => {
    resolve = done;
  });
  const models = createGltfModels({ three: THREE_PARTS, baseUrl: MODELS_BASE_URL, fetchResource, onLoad: resolve });
  await models.ready();
  models.get(code, level);
  await loaded;
  return models.get(code, level);
}

const partCounts = geometry => {
  const counts = [0, 0, 0];
  for (const value of geometry.getAttribute('liveryPart').array) counts[value] += 1;
  return counts;
};

describe('modelAircraft', () => {
  it('gives the L1 model of a type without gear the app\'s gear, its parts marked for the livery', async () => {
    const model = await loadModel('B738', 'l1');
    expect(model.entry.hasGear).toBe(false);
    const spec = AIRCRAFT_TYPES.B738;
    const geometry = instancedModelGeometry(THREE_PARTS, model, spec, 'B738');
    expect(Object.keys(geometry.attributes).sort()).toEqual(['liveryPart', 'normal', 'position']);
    const [airframe, legs, tyres] = partCounts(geometry);
    expect(airframe).toBe(3 * model.triangles);
    expect(legs).toBeGreaterThan(0);
    expect(tyres).toBeGreaterThan(0);
    // The wheels stand on the ground, the model above it at its clearance.
    geometry.computeBoundingBox();
    expect(geometry.boundingBox.min.z).toBeCloseTo(0, 1);
    model.geometry.computeBoundingBox();
    expect(model.geometry.boundingBox.min.z).toBeCloseTo(model.entry.groundClearanceM, 1);
    // A model that has its own gear keeps it alone.
    const withGear = instancedModelGeometry(THREE_PARTS, { ...model, entry: { ...model.entry, hasGear: true } }, spec, 'B738');
    expect(partCounts(withGear)).toEqual([3 * model.triangles, 0, 0]);
    // The model's own geometry is not touched.
    expect(model.geometry.getAttribute('liveryPart')).toBeUndefined();
    geometry.dispose();
    withGear.dispose();
  }, 30_000);

  it('writes each instance\'s livery row and gear, −1 and down for what is not given, growing with the capacity', () => {
    const geometry = new THREE_PARTS.BufferGeometry();
    writeLiveryInstances(THREE_PARTS, geometry, { capacity: 4, count: 3, liveries: ['CMP', null, 'NOPE'], gear: [1, 0, 1] });
    expect([...geometry.getAttribute('liveryIndex').array]).toEqual([liveryRow('CMP'), -1, -1, 0]);
    expect([...geometry.getAttribute('liveryGear').array]).toEqual([1, 0, 1, 0]);
    const attribute = geometry.getAttribute('liveryIndex');
    writeLiveryInstances(THREE_PARTS, geometry, { capacity: 2, count: 2 });
    expect(geometry.getAttribute('liveryIndex')).toBe(attribute);
    expect([...attribute.array].slice(0, 2)).toEqual([-1, -1]);
    expect([...geometry.getAttribute('liveryGear').array].slice(0, 2)).toEqual([1, 1]);
    writeLiveryInstances(THREE_PARTS, geometry, { capacity: 8, count: 1, liveries: ['DAL'] });
    expect(geometry.getAttribute('liveryIndex').count).toBe(8);
    expect(geometry.getAttribute('liveryIndex').array[0]).toBe(liveryRow('DAL'));
  });

  it('makes the detailed airframe from L2: the body in its livery, the glass and dark parts plain; disposes its own only', async () => {
    const model = await loadModel('A320', 'l2');
    const spec = AIRCRAFT_TYPES.A320;
    const textures = createLiveryTextures(THREE_PARTS);
    const airframe = buildModelAirframe(THREE_PARTS, model, { spec, livery: LIVERIES.CMP, textures });
    expect(airframe.meshes.map(mesh => mesh.name)).toEqual(['fuselage', ...model.parts.slice(1).map(part => part.name)]);
    const [body, ...plain] = airframe.meshes;
    expect(body.isInstancedMesh).toBe(true);
    expect(body.material.name).toBe('livery');
    expect(body.geometry.getAttribute('liveryIndex').array[0]).toBe(liveryRow('CMP'));
    for (const mesh of plain) expect(mesh.material.isMeshStandardMaterial).toBe(true);
    expect(airframe.frame).toBe(modelFrame(model, spec));
    expect(airframe.refreshLogo()).toBe(false);
    let disposed = 0;
    model.parts[0].geometry.addEventListener('dispose', () => {
      disposed += 1;
    });
    airframe.dispose();
    expect(disposed).toBe(0);
    textures.dispose();
  }, 30_000);
});
