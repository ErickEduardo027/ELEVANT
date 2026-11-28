// The 3D models of the aircraft types (PR M5): the glTF 2.0 files of public/models/aircraft/ (built and licensed by
// scripts/models/build-aircraft-models.mjs; each type's folder carries its LICENSE, NOTICE.md and SOURCE.md), read
// from the application's own origin when a map first needs a type and kept per type and level.
//
// - Levels: `l1` (one primitive, up to 15 000 triangles) for the instanced aircraft near the camera and on their
//   stands, `l2` (up to three primitives: body, glass, dark) for the detailed aircraft the map follows or shows up
//   close. Far aircraft keep their procedural model (aircraft/aircraftGeometry.js), and so does a type without a model.
// - Manifest-driven: public/models/aircraft/manifest.json names each type's files with their SHA-256; a file that is
//   not in it is never fetched, and a file whose digest differs is refused.
// - Only three's GLTFLoader parses them (it travels in the 3D chunk with three: aircraft/aircraft3dChunk.js): no Draco,
//   meshopt or KTX2, no workers. The .gltf and its .bin are fetched here and handed to the loader as one GLB in
//   memory, so the loader fetches nothing, makes no blob: URL and the page's CSP stays as it is.
// - The models carry no textures and no UVs: their positions are in the frame of the procedural models (x to the
//   right, y toward the nose, z up, metres, centred on the span and the length) and the livery is a shader of the app
//   (aircraft/liveryMaterial.js). They carry no landing gear either (manifest `hasGear: false`): the app adds its own.
//
// `three` is a parameter (THREE_PARTS of the chunk, with its GLTFLoader and mergeGeometries), as for the other models.

/** Where the models are served, under the application's own origin. */
export const MODELS_BASE_URL = '/models/aircraft/';

/** The levels of detail a type's folder holds. */
export const MODEL_LEVELS = Object.freeze(['l1', 'l2']);

/** After a failed read of the manifest or of a model, the next request waits this long before it tries again. */
export const MODEL_RETRY_MS = 60_000;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

const textEncoder = new TextEncoder();
const isLevel = level => MODEL_LEVELS.includes(level);

/**
 * One GLB (glTF 2.0 binary) in memory from a glTF document `json` and the bytes of its only buffer `bin`: the
 * document is copied with that buffer's `uri` removed, so the loader reads the binary chunk and fetches nothing.
 * Throws when the document has other than one buffer or the bytes do not match its length.
 */
export function packGlb(json, bin) {
  const bytes = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  if (!Array.isArray(json?.buffers) || json.buffers.length !== 1) {
    throw new TypeError('A model must have exactly one buffer.');
  }
  if (json.buffers[0].byteLength !== bytes.byteLength) {
    throw new RangeError(`A model's buffer holds ${bytes.byteLength} bytes, not ${json.buffers[0].byteLength}.`);
  }
  const { uri: _uri, ...buffer } = json.buffers[0];
  const document = textEncoder.encode(JSON.stringify({ ...json, buffers: [buffer] }));
  const jsonLength = Math.ceil(document.byteLength / 4) * 4;
  const binLength = Math.ceil(bytes.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(document, 20);
  // The JSON chunk is padded with spaces, the binary one with zeros (glTF 2.0 §4.4.3).
  out.fill(0x20, 20 + document.byteLength, 20 + jsonLength);
  const binStart = 20 + jsonLength;
  view.setUint32(binStart, binLength, true);
  view.setUint32(binStart + 4, CHUNK_BIN, true);
  out.set(bytes, binStart + 8);
  return out.buffer;
}

// A float copy of an attribute (a quantized one included: getX reads it normalized), so a matrix can be applied.
function floatAttribute(three, attribute) {
  const size = attribute.itemSize;
  const array = new Float32Array(attribute.count * size);
  const read = [attribute.getX, attribute.getY, attribute.getZ, attribute.getW];
  for (let index = 0; index < attribute.count; index += 1) {
    for (let k = 0; k < size; k += 1) array[size * index + k] = read[k].call(attribute, index);
  }
  return new three.Float32BufferAttribute(array, size);
}

/**
 * The geometry of a loaded glTF scene in the frame of the models: `{ parts: [{ name, geometry }], geometry,
 * triangles }`. Each mesh's positions and normals are copied as floats with its node's world matrix applied (the
 * quantization's offset and scale live on the node), and merged per material name ('body', 'glass', 'dark'); the
 * parts come in that order, then any other name. `geometry` is every part merged into one (what an instanced level
 * draws), with only positions and normals.
 */
export function sceneGeometry(three, scene) {
  scene.updateMatrixWorld(true);
  const byName = new Map();
  scene.traverse(node => {
    if (!node.isMesh || !node.geometry?.getAttribute('position')) return;
    const source = node.geometry;
    const geometry = new three.BufferGeometry();
    geometry.setAttribute('position', floatAttribute(three, source.getAttribute('position')));
    if (source.getAttribute('normal')) geometry.setAttribute('normal', floatAttribute(three, source.getAttribute('normal')));
    const index = source.getIndex();
    if (index !== null) geometry.setIndex(Array.from(index.array));
    // applyMatrix4 turns the normals with the normal matrix (and normalizes them); the build writes no mirrored node.
    geometry.applyMatrix4(node.matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const name = typeof node.material?.name === 'string' && node.material.name !== '' ? node.material.name : 'body';
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(geometry);
  });
  if (byName.size === 0) throw new TypeError('The model has no mesh.');
  const order = ['body', 'glass', 'dark'];
  const names = [...byName.keys()].sort((a, b) => {
    const rank = name => (order.includes(name) ? order.indexOf(name) : order.length);
    return rank(a) - rank(b) || (a < b ? -1 : Number(a > b));
  });
  const merge = list => (list.length === 1 ? list[0] : three.mergeGeometries(list, false));
  const parts = names.map(name => ({ name, geometry: merge(byName.get(name)) }));
  const geometry = parts.length === 1 ? parts[0].geometry.clone() : three.mergeGeometries(parts.map(part => part.geometry), false);
  let triangles = 0;
  for (const part of parts) {
    const index = part.geometry.getIndex();
    triangles += (index === null ? part.geometry.getAttribute('position').count : index.count) / 3;
  }
  return { parts, geometry, triangles };
}

const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');

// The SHA-256 of some bytes as hex, or null where the browser offers no digest (an insecure origin).
async function sha256(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest !== 'function') return null;
  return hex(await subtle.digest('SHA-256', bytes));
}

const defaultFetch = url => fetch(url, { credentials: 'same-origin' });

/**
 * The models of the aircraft types, read on demand: `{ ready, manifest, entry, get, status, dispose }`.
 * - `three`: the parts of three, with `GLTFLoader` and `mergeGeometries`; `baseUrl` the folder of the manifest (an
 *   absolute path of the application, MODELS_BASE_URL); `fetchResource(url)` answers a Response (fetch, same origin);
 *   `onLoad({ code, level })` hears each model that becomes ready (the layer then draws again); `now()` for tests.
 * - `get(code, level)` answers the model of a type `{ code, level, parts, geometry, triangles, entry }` once it is
 *   loaded, else null, and starts reading it the first time (the manifest first): a type the manifest lacks answers
 *   null for good. `status(code, level)` → 'none' (no model), 'unknown' (manifest not read yet), 'idle' (not asked yet),
 *   'loading', 'ready' or 'failed'. `entry(code)` is the type's manifest entry (name, licence, dimensionsM, groundClearanceM, hasGear…).
 * - `ready()` → Promise of the manifest (or null when it cannot be read).
 */
export function createGltfModels({
  three, baseUrl = MODELS_BASE_URL, fetchResource = defaultFetch, onLoad, now = () => Date.now(), verify = true,
} = {}) {
  if (typeof three?.GLTFLoader !== 'function') throw new TypeError('The models need three\'s GLTFLoader');
  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('/') || baseUrl.startsWith('//') || !baseUrl.endsWith('/')) {
    throw new TypeError('The models are read from a folder of the application.');
  }
  let manifest = null;
  let manifestPending = null;
  let manifestFailedAt = null;
  let disposed = false;
  // `${code}:${level}` → { state: 'loading' | 'ready' | 'failed', model, failedAt }
  const models = new Map();

  async function readJson(url) {
    const response = await fetchResource(url);
    if (!response?.ok) throw new Error(`${url} answered ${response?.status ?? 'nothing'}.`);
    return response.json();
  }

  async function readBytes(url) {
    const response = await fetchResource(url);
    if (!response?.ok) throw new Error(`${url} answered ${response?.status ?? 'nothing'}.`);
    return response.arrayBuffer();
  }

  function ready() {
    if (manifest !== null) return Promise.resolve(manifest);
    if (manifestPending === null) {
      if (manifestFailedAt !== null && now() - manifestFailedAt < MODEL_RETRY_MS) return Promise.resolve(null);
      manifestPending = readJson(`${baseUrl}manifest.json`).then(json => {
        if (json === null || typeof json !== 'object' || typeof json.types !== 'object' || json.types === null) {
          throw new TypeError('The models\' manifest has no types.');
        }
        manifest = json;
        manifestFailedAt = null;
        return manifest;
      }).catch(() => {
        manifestFailedAt = now();
        return null;
      }).finally(() => {
        manifestPending = null;
      });
    }
    return manifestPending;
  }

  function entry(code) {
    if (manifest === null || typeof code !== 'string' || !Object.hasOwn(manifest.types, code)) return null;
    return manifest.types[code];
  }

  // The files of a level as the manifest lists them: its .gltf and its .bin, each `{ file, sha256 }`.
  function filesOf(code, level) {
    const list = entry(code)?.files?.[level];
    if (!Array.isArray(list)) return null;
    const gltf = list.find(item => typeof item?.file === 'string' && item.file.endsWith('.gltf'));
    if (!gltf || !SAFE_FILE.test(gltf.file)) return null;
    return { gltf, others: list.filter(item => item !== gltf) };
  }

  async function checked(bytes, expected, file) {
    if (!verify || typeof expected !== 'string') return;
    const actual = await sha256(bytes);
    if (actual !== null && actual !== expected.toLowerCase()) throw new Error(`${file} does not match the manifest.`);
  }

  async function readModel(code, level) {
    const files = filesOf(code, level);
    if (files === null) throw new Error(`The manifest names no ${level} for ${code}.`);
    const folder = `${baseUrl}${encodeURIComponent(code)}/`;
    const gltfBytes = await readBytes(`${folder}${files.gltf.file}`);
    await checked(gltfBytes, files.gltf.sha256, files.gltf.file);
    const json = JSON.parse(new TextDecoder().decode(gltfBytes));
    const uri = json?.buffers?.[0]?.uri;
    const bin = files.others.find(item => item?.file === uri);
    // Only a buffer the manifest lists, in the same folder: never a URL, a data: URI or a path elsewhere.
    if (typeof uri !== 'string' || !SAFE_FILE.test(uri) || !bin) throw new Error(`${files.gltf.file} names a buffer the manifest lacks.`);
    const binBytes = await readBytes(`${folder}${bin.file}`);
    await checked(binBytes, bin.sha256, bin.file);
    const glb = packGlb(json, binBytes);
    const gltf = await new Promise((resolve, reject) => {
      new three.GLTFLoader().parse(glb, '', resolve, reject);
    });
    const geometry = sceneGeometry(three, gltf.scene);
    // What the loader built is copied: its own geometries are freed.
    gltf.scene.traverse(node => {
      if (node.isMesh) {
        node.geometry?.dispose();
        node.material?.dispose?.();
      }
    });
    return Object.freeze({ code, level, ...geometry, entry: entry(code) });
  }

  function start(code, level) {
    const key = `${code}:${level}`;
    const held = { state: 'loading', model: null, failedAt: null };
    models.set(key, held);
    readModel(code, level).then(model => {
      if (disposed) {
        disposeModel(model);
        return;
      }
      held.state = 'ready';
      held.model = model;
      onLoad?.({ code, level });
    }, error => {
      held.state = 'failed';
      held.failedAt = now();
      if (!disposed) console.warn(`The 3D model ${code} ${level} could not be loaded; the map keeps its own model.`, error);
    });
  }

  function status(code, level) {
    if (!isLevel(level)) return 'none';
    if (manifest === null) return 'unknown';
    if (filesOf(code, level) === null) return 'none';
    return models.get(`${code}:${level}`)?.state ?? 'idle';
  }

  function get(code, level) {
    if (disposed || typeof code !== 'string' || !isLevel(level)) return null;
    if (manifest === null) {
      ready().then(read => {
        if (read !== null && !disposed && filesOf(code, level) !== null) get(code, level);
      });
      return null;
    }
    if (filesOf(code, level) === null) return null;
    const held = models.get(`${code}:${level}`);
    if (held === undefined) {
      start(code, level);
      return null;
    }
    if (held.state === 'failed' && now() - held.failedAt >= MODEL_RETRY_MS) {
      start(code, level);
      return null;
    }
    return held.model;
  }

  function disposeModel(model) {
    for (const part of model.parts) part.geometry.dispose();
    model.geometry.dispose();
  }

  return {
    ready,
    manifest: () => manifest,
    entry,
    get,
    status,
    dispose() {
      disposed = true;
      for (const held of models.values()) if (held.model !== null) disposeModel(held.model);
      models.clear();
    },
  };
}
