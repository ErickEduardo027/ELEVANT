// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { THREE_PARTS } from './aircraft3dChunk';
import { MODELS_BASE_URL, MODEL_RETRY_MS, createGltfModels, packGlb, sceneGeometry } from './gltfModels';

// A tiny model as the build writes one (KHR_mesh_quantization, a .gltf and its .bin, no textures): one triangle with
// int16 normalized positions and int8 normals, the quantization's offset and scale on its node, its material 'body'.
function fixture() {
  const bin = new ArrayBuffer(44);
  const view = new DataView(bin);
  [0, 1, 2].forEach((value, at) => view.setUint16(2 * at, value, true));
  [[0, 0, 0], [32767, 0, 0], [0, 32767, 0]].forEach((vertex, at) => {
    vertex.forEach((value, k) => view.setInt16(8 + 8 * at + 2 * k, value, true));
  });
  [0, 1, 2].forEach(at => view.setInt8(32 + 4 * at + 2, 127));
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
    buffers: [{ uri: 'l1.bin', byteLength: 44 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 6, target: 34963 },
      { buffer: 0, byteOffset: 8, byteLength: 24, byteStride: 8, target: 34962 },
      { buffer: 0, byteOffset: 32, byteLength: 12, byteStride: 4, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 1, componentType: 5122, normalized: true, count: 3, type: 'VEC3', min: [0, 0, 0], max: [32767, 32767, 0] },
      { bufferView: 2, componentType: 5120, normalized: true, count: 3, type: 'VEC3' },
    ],
    materials: [{ name: 'body', doubleSided: true }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, material: 0 }] }],
    nodes: [{ mesh: 0, translation: [1, 0, 0.5], scale: [2, 4, 1] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const gltf = new TextEncoder().encode(JSON.stringify(json));
  const sha = bytes => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
  const manifest = {
    types: {
      B738: {
        name: 'Boeing 737-800', hasGear: false,
        files: { l1: [{ file: 'l1.gltf', sha256: sha(gltf) }, { file: 'l1.bin', sha256: sha(bin) }] },
      },
    },
  };
  return { json, gltf, bin, manifest };
}

function server(files) {
  const asked = [];
  const fetchResource = vi.fn(async url => {
    asked.push(url);
    if (!Object.hasOwn(files, url)) return { ok: false, status: 404 };
    const body = files[url];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => (body instanceof ArrayBuffer ? body : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
    };
  });
  return { fetchResource, asked };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(check) {
  for (let tries = 0; tries < 50 && !check(); tries += 1) await settle();
}

describe('packGlb', () => {
  it('packs a document and its one buffer into a GLB without the buffer\'s uri, both chunks padded to four bytes', () => {
    const { json, bin } = fixture();
    const glb = packGlb(json, bin);
    const view = new DataView(glb);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.byteLength);
    const jsonLength = view.getUint32(12, true);
    expect(jsonLength % 4).toBe(0);
    const document = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)));
    expect(document.buffers).toEqual([{ byteLength: 44 }]);
    expect(view.getUint32(20 + jsonLength + 4, true)).toBe(0x004e4942);
    expect(() => packGlb({ ...json, buffers: [] }, bin)).toThrow(TypeError);
    expect(() => packGlb(json, new ArrayBuffer(40))).toThrow(RangeError);
  });
});

describe('createGltfModels', () => {
  it('reads a type\'s level from the manifest on first request, through GLTFLoader, into float geometry in metres', async () => {
    const { gltf, bin, manifest } = fixture();
    const { fetchResource, asked } = server({
      [`${MODELS_BASE_URL}manifest.json`]: manifest,
      [`${MODELS_BASE_URL}B738/l1.gltf`]: gltf,
      [`${MODELS_BASE_URL}B738/l1.bin`]: bin,
    });
    const onLoad = vi.fn();
    const models = createGltfModels({ three: THREE_PARTS, fetchResource, onLoad });
    expect(models.status('B738', 'l1')).toBe('unknown');
    expect(models.get('B738', 'l1')).toBeNull();
    await until(() => onLoad.mock.calls.length > 0);
    expect(onLoad).toHaveBeenCalledWith({ code: 'B738', level: 'l1' });
    expect(models.status('B738', 'l1')).toBe('ready');
    const model = models.get('B738', 'l1');
    expect(model).toMatchObject({ code: 'B738', level: 'l1', triangles: 1, entry: { name: 'Boeing 737-800' } });
    expect(model.parts.map(part => part.name)).toEqual(['body']);
    // The node's offset and scale are applied: the quantized corners stand where the model says, in metres.
    const position = model.geometry.getAttribute('position');
    expect(position.array).toBeInstanceOf(Float32Array);
    const corners = [0, 1, 2].map(at => [position.getX(at), position.getY(at), position.getZ(at)].map(value => +value.toFixed(3)));
    expect(corners).toEqual([[1, 0, 0.5], [3, 0, 0.5], [1, 4, 0.5]]);
    expect(model.geometry.getAttribute('normal').getZ(0)).toBeCloseTo(1, 5);
    // Once each: the manifest, the .gltf and the .bin, all under the application's own folder.
    expect(asked).toEqual([`${MODELS_BASE_URL}manifest.json`, `${MODELS_BASE_URL}B738/l1.gltf`, `${MODELS_BASE_URL}B738/l1.bin`]);
    expect(models.get('B738', 'l1')).toBe(model);
    expect(fetchResource).toHaveBeenCalledTimes(3);
  });

  it('answers null for good for a type or a level the manifest lacks, and fetches nothing for it', async () => {
    const { manifest } = fixture();
    const { fetchResource, asked } = server({ [`${MODELS_BASE_URL}manifest.json`]: manifest });
    const models = createGltfModels({ three: THREE_PARTS, fetchResource });
    await models.ready();
    expect(models.get('B763', 'l1')).toBeNull();
    expect(models.get('B738', 'l2')).toBeNull();
    expect(models.get('B738', 'l3')).toBeNull();
    expect(models.status('B763', 'l1')).toBe('none');
    expect(models.status('B738', 'l2')).toBe('none');
    await settle();
    expect(asked).toEqual([`${MODELS_BASE_URL}manifest.json`]);
  });

  it('refuses a file whose digest differs from the manifest and a buffer the manifest does not list, then retries later', async () => {
    const { gltf, bin, manifest, json } = fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let clock = 0;
    const tampered = new Uint8Array(bin.slice(0));
    tampered[9] ^= 0xff;
    const { fetchResource } = server({
      [`${MODELS_BASE_URL}manifest.json`]: manifest,
      [`${MODELS_BASE_URL}B738/l1.gltf`]: gltf,
      [`${MODELS_BASE_URL}B738/l1.bin`]: tampered,
    });
    const models = createGltfModels({ three: THREE_PARTS, fetchResource, now: () => clock });
    await models.ready();
    expect(models.get('B738', 'l1')).toBeNull();
    await until(() => models.status('B738', 'l1') === 'failed');
    expect(models.status('B738', 'l1')).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(models.get('B738', 'l1')).toBeNull();
    expect(models.status('B738', 'l1')).toBe('failed');
    clock = MODEL_RETRY_MS;
    expect(models.get('B738', 'l1')).toBeNull();
    expect(models.status('B738', 'l1')).toBe('loading');

    // A document that names a buffer elsewhere is never followed.
    const foreign = new TextEncoder().encode(JSON.stringify({ ...json, buffers: [{ uri: 'https://example.test/x.bin', byteLength: 44 }] }));
    const elsewhere = server({
      [`${MODELS_BASE_URL}manifest.json`]: { types: { B738: { files: { l1: [{ file: 'l1.gltf' }, { file: 'l1.bin' }] } } } },
      [`${MODELS_BASE_URL}B738/l1.gltf`]: foreign,
    });
    const strict = createGltfModels({ three: THREE_PARTS, fetchResource: elsewhere.fetchResource });
    await strict.ready();
    strict.get('B738', 'l1');
    await until(() => strict.status('B738', 'l1') === 'failed');
    expect(strict.status('B738', 'l1')).toBe('failed');
    expect(elsewhere.asked.some(url => url.startsWith('https:'))).toBe(false);
    warn.mockRestore();
  });

  it('keeps working without a manifest (it answers null and tries again after a while) and needs a folder of the app', async () => {
    let clock = 0;
    const { fetchResource } = server({});
    const models = createGltfModels({ three: THREE_PARTS, fetchResource, now: () => clock });
    expect(await models.ready()).toBeNull();
    expect(await models.ready()).toBeNull();
    expect(fetchResource).toHaveBeenCalledTimes(1);
    clock = MODEL_RETRY_MS;
    await models.ready();
    expect(fetchResource).toHaveBeenCalledTimes(2);
    expect(() => createGltfModels({ three: THREE_PARTS, baseUrl: 'https://cdn.test/models/' })).toThrow(TypeError);
    expect(() => createGltfModels({ three: THREE_PARTS, baseUrl: '//cdn.test/models/' })).toThrow(TypeError);
    expect(() => createGltfModels({ three: {} })).toThrow(TypeError);
  });

  it('groups a scene\'s meshes by material, body first, with their world matrices applied', () => {
    const three = THREE_PARTS;
    const scene = new three.Group();
    const triangle = () => {
      const geometry = new three.BufferGeometry();
      geometry.setAttribute('position', new three.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      geometry.setAttribute('normal', new three.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      return geometry;
    };
    const material = name => Object.assign(new three.MeshBasicMaterial(), { name });
    const glass = new three.Mesh(triangle(), material('glass'));
    glass.position.set(0, 10, 0);
    const body = new three.Mesh(triangle(), material('body'));
    const body2 = new three.Mesh(triangle(), material('body'));
    body2.position.set(5, 0, 0);
    scene.add(glass, body, body2);
    const { parts, geometry, triangles } = sceneGeometry(three, scene);
    expect(parts.map(part => part.name)).toEqual(['body', 'glass']);
    expect(triangles).toBe(3);
    expect(parts[1].geometry.getAttribute('position').getY(0)).toBe(10);
    expect(geometry.getAttribute('position').count).toBe(9);
  });
});
