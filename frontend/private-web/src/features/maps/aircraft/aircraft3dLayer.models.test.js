// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { Group } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint } from '../airport/geo';
import { THREE_PARTS } from './aircraft3dChunk';
import { LIVERY_ZONE_ATTRIBUTES, createAircraft3dLayer } from './aircraft3dLayer';
import { buildAircraftGeometry, triangleCount } from './aircraftGeometry';
import { MODELS_BASE_URL, createGltfModels } from './gltfModels';
import { planInstances } from './instancePlan';
import { LIVERIES } from './liveries';
import { LIVERY_ATLAS, LIVERY_ROWS, liveryRow } from './liveryMaterial';
import { L1_HYSTERESIS, L1_MIN_PX, metresPerPixel } from './modelLevels';
import { AIRCRAFT_TYPES } from './types';

// The 3D layer's levels of detail (PR M5): the L1 model of a type up close, its shadows, the detailed aircraft's L2
// model and the livery logos, with the vendored A320 model of public/models/aircraft, injected models, canvases and
// images, and the real three in Node.
const ARP = MDPC_LAYOUT.meta.arp;
const PUBLIC = path.resolve(process.cwd(), 'public');
const A320 = AIRCRAFT_TYPES.A320;
const IDENTITY = { defaultProjectionData: { mainMatrix: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) } };
const ATLAS_HEIGHT = LIVERY_ROWS.length * LIVERY_ATLAS.rowHeight;
const LOGO_URLS = [...new Set(LIVERY_ROWS.map(livery => livery.logoTexture).filter(Boolean))];

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

const MODELS = {};
beforeAll(async () => {
  MODELS['A320:l1'] = await loadModel('A320', 'l1');
  MODELS['A320:l2'] = await loadModel('A320', 'l2');
});

// The models of the layer: `loaded` are those get() answers; load(key) makes one ready and calls the layer's onLoad.
function fakeModels(loaded = []) {
  const state = { onLoad: null, loaded: new Set(loaded), asked: [] };
  const createModels = onLoad => {
    state.onLoad = onLoad;
    return {
      get(code, level) {
        const key = `${code}:${level}`;
        state.asked.push(key);
        return state.loaded.has(key) ? MODELS[key] ?? null : null;
      },
    };
  };
  state.load = key => {
    state.loaded.add(key);
    state.onLoad();
  };
  return { createModels, state };
}

// Canvases with a 2D context that records what is drawn on it.
function fakeCanvases() {
  const made = [];
  const createCanvas = (width, height) => {
    const draws = [];
    const target = {
      draws,
      measureText: text => ({ width: 10 * String(text).length }),
      drawImage: (...args) => draws.push(args),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * w * h), width: w, height: h }),
    };
    const context = new Proxy(target, {
      get: (object, key) => (key in object ? object[key] : () => {}),
      set: (object, key, value) => {
        object[key] = value;
        return true;
      },
    });
    const canvas = { width, height, draws, getContext: () => context };
    made.push(canvas);
    return canvas;
  };
  return { createCanvas, atlases: () => made.filter(canvas => canvas.width === LIVERY_ATLAS.width && canvas.height === ATLAS_HEIGHT) };
}

function fakeMap(zoom) {
  const canvas = { clientWidth: 1000, clientHeight: 800 };
  return { canvas, zoom, getZoom() { return this.zoom; }, on: vi.fn(), off: vi.fn(), getCanvas: () => canvas,
    triggerRepaint: vi.fn() };
}

const fakeRenderer = () => ({ autoClear: true, resetState() {}, setViewport() {}, render() {}, dispose() {} });
const context = { drawingBufferWidth: 2000, drawingBufferHeight: 1600 };

// The zoom at which an A320 is drawn `pixels` CSS pixels long over the ARP.
const zoomFor = pixels => Math.log2((pixels * metresPerPixel(0, ARP[1])) / A320.lengthM);

function aircraft(id, { bearing = 0, metres = 0, ...fields } = {}) {
  const [lon, lat] = destinationPoint(ARP, bearing, metres);
  return { id, kind: 'aviam', lon, lat, altM: 0, onGround: true, trackDeg: 0, typeIcao: 'A320', airlineIcao: 'UAL', ...fields };
}

const planOf = list => planInstances(list, [], { zoom: 18, minZoom: 14, originLngLat: ARP });
const flush = async () => {
  for (let round = 0; round < 5; round += 1) await new Promise(done => setTimeout(done, 0));
};
const meshesOf = layer => layer._scene().children.filter(child => child.isInstancedMesh);

function setup({ list = [aircraft('f:a')], zoom = zoomFor(80), loaded = [], detail = null, ...options } = {}) {
  const models = fakeModels(loaded);
  const canvases = fakeCanvases();
  const answer = { revision: 1, plan: planOf(list), detail };
  let scene = null;
  const layer = createAircraft3dLayer({
    three: THREE_PARTS, originLngLat: ARP, getInstances: () => answer, createModels: models.createModels,
    createRenderer: () => ({ ...fakeRenderer(), render: drawn => { scene ??= drawn; } }),
    createCanvas: canvases.createCanvas, ...options,
  });
  layer._scene = () => scene;
  const map = fakeMap(zoom);
  layer.onAdd(map, context);
  const frame = () => layer.render(context, IDENTITY);
  const replan = next => {
    answer.revision += 1;
    answer.plan = planOf(next);
  };
  return { layer, map, models, canvases, answer, frame, replan };
}

const disposals = (...things) => {
  const seen = new Set();
  for (const thing of things) thing.addEventListener('dispose', () => seen.add(thing));
  return seen;
};

describe('the 3D layer\'s levels of detail (PR M5)', () => {
  it('draws a type\'s L1 model only once it is loaded and drawn large enough, with a hysteresis, rebuilding only on a change', () => {
    const { layer, map, models, frame } = setup({ zoom: zoomFor(40) });
    frame();
    // Drawn small: the procedural model, and its L1 model is not even asked for.
    expect(models.state.asked).toEqual([]);
    expect(layer.stats().models).toBeUndefined();
    const [procedural] = meshesOf(layer);
    expect(procedural.material.isMeshLambertMaterial).toBe(true);

    // Large enough but not loaded yet: asked for, and the procedural model stays, the same mesh.
    map.zoom = zoomFor(80);
    frame();
    expect(models.state.asked).toContain('A320:l1');
    expect(meshesOf(layer)[0]).toBe(procedural);
    expect(layer.stats().models).toBeUndefined();

    // Once it loads the map repaints, and the next frame draws the type from its L1 model in a mesh of its own.
    const oldOnes = disposals(procedural.geometry);
    models.state.load('A320:l1');
    expect(map.triggerRepaint).toHaveBeenCalled();
    frame();
    const [l1] = meshesOf(layer).filter(mesh => mesh.name === 'A320');
    expect(l1).not.toBe(procedural);
    expect(oldOnes.has(procedural.geometry)).toBe(true);
    expect(l1.material).not.toBe(procedural.material);
    expect(l1.geometry.getAttribute('liveryIndex').array[0]).toBe(liveryRow('UAL'));
    expect(layer.stats().models).toBe(1);
    frame();
    expect(meshesOf(layer).find(mesh => mesh.name === 'A320')).toBe(l1);

    // Inside the hysteresis band it keeps L1; below it, back to the procedural model, the L1 mesh and material freed.
    map.zoom = zoomFor(((1 + L1_HYSTERESIS) / 2) * L1_MIN_PX);
    frame();
    expect(meshesOf(layer).find(mesh => mesh.name === 'A320')).toBe(l1);
    const shadow = meshesOf(layer).find(mesh => mesh.name === 'A320:shadow');
    const freed = disposals(l1.geometry, l1.material, shadow.geometry);
    map.zoom = zoomFor(0.8 * L1_MIN_PX);
    frame();
    expect(freed.size).toBe(3);
    const [back] = meshesOf(layer);
    expect(meshesOf(layer)).toHaveLength(1);
    expect(back.material.isMeshLambertMaterial).toBe(true);
    expect(layer.stats().models).toBeUndefined();
    // Inside the band from the procedural model, it stays procedural.
    map.zoom = zoomFor(((1 + L1_HYSTERESIS) / 2) * L1_MIN_PX);
    frame();
    expect(meshesOf(layer)).toEqual([back]);
  });

  it('draws the shadows of a type at L1 from its procedural model, in a mesh of their own', () => {
    const list = [aircraft('f:a'), aircraft('f:b', { bearing: 90, metres: 200 }), aircraft('f:c', { bearing: 180, metres: 200 })];
    const { layer, frame, replan } = setup({ list, loaded: ['A320:l1'] });
    frame();
    const l1 = meshesOf(layer).find(mesh => mesh.name === 'A320');
    const shadow = meshesOf(layer).find(mesh => mesh.name === 'A320:shadow');
    const l1Triangles = triangleCount(l1.geometry);
    const proceduralTriangles = triangleCount(buildAircraftGeometry(THREE_PARTS, A320));
    expect(l1Triangles).toBeGreaterThan(3 * proceduralTriangles);
    expect(shadow.material.isMeshLambertMaterial).toBe(true);
    expect(triangleCount(shadow.geometry)).toBe(proceduralTriangles);
    expect([l1.count, shadow.count]).toEqual([3, 3]);
    const plan = planOf(list).get('A320');
    expect([...shadow.instanceMatrix.array.slice(0, 48)]).toEqual([...plan.matrices.slice(48, 96)]);
    expect([...l1.instanceMatrix.array.slice(0, 48)]).toEqual([...plan.matrices.slice(0, 48)]);
    // Integration of M5 with M4: the three contact shadows are one more draw call, of their own mesh.
    expect(layer.stats()).toMatchObject({ instances: 6, contacts: 3, drawCalls: 3, models: 1,
      triangles: 3 * l1Triangles + 3 * proceduralTriangles });
    // Integration of M5 with M9: the shadows' procedural model carries the livery's zones, every zone in the shadow's
    // colour; the L1 model paints its livery in its own material and carries no zone attributes.
    expect(shadow.geometry.getAttribute('liveryZone')).toBeDefined();
    for (const name of LIVERY_ZONE_ATTRIBUTES) {
      expect([...shadow.geometry.getAttribute(name).array.slice(0, 9)], name).toEqual([...plan.colors.slice(9, 18)]);
      expect(l1.geometry.getAttribute(name), name).toBeUndefined();
    }
    // A shadow names nothing: only the L1 mesh is picked.
    expect(shadow.userData.shadow).toBe(true);

    // Without shadows only the models draw.
    layer.setQuality({ shadows: false });
    expect(layer.stats()).toMatchObject({ instances: 3, drawCalls: 1, triangles: 3 * l1Triangles });
    layer.setQuality({ shadows: true });

    // More aircraft than the meshes hold: both grow, and so do the livery's instance attributes.
    replan([...list, aircraft('f:d', { bearing: 270, metres: 200, airlineIcao: 'DAL' }),
      aircraft('f:e', { bearing: 0, metres: 300, airlineIcao: 'DAL' })]);
    frame();
    const grown = meshesOf(layer).find(mesh => mesh.name === 'A320');
    expect(grown.count).toBe(5);
    expect(meshesOf(layer).find(mesh => mesh.name === 'A320:shadow').count).toBe(5);
    const index = grown.geometry.getAttribute('liveryIndex');
    expect(index.count).toBeGreaterThanOrEqual(8);
    expect([...index.array.slice(0, 5)]).toEqual(['f:a', 'f:b', 'f:c', 'f:d', 'f:e']
      .map(id => liveryRow(id === 'f:d' || id === 'f:e' ? 'DAL' : 'UAL')));
    expect(layer.stats().triangles).toBe(5 * l1Triangles + 5 * proceduralTriangles);
  });

  it('repaints the detailed aircraft\'s fin only with its own livery\'s logo, and a layer added again keeps its logos', async () => {
    const [lon, lat] = destinationPoint(ARP, 45, 300);
    const detail = { key: 'd', id: 'f:d', code: 'B763', spec: AIRCRAFT_TYPES.B763, livery: LIVERIES.DAL,
      registration: 'N1', lon, lat, headingDeg: 0, heightM: 0, pitchDeg: 0, bankDeg: 0, gsMs: 0, lights: {},
      gearDown: true, onStand: false };
    const refreshLogo = vi.fn(() => true);
    const buildDetail = () => ({ object: new Group(), pivot: { y: 0, z: 0 }, setState() {}, dispose() {}, refreshLogo,
      textured: false });
    const loadImage = vi.fn(url => Promise.resolve({ width: 120, height: 40, url }));
    const { layer, map, canvases, frame } = setup({ loaded: ['A320:l1'], detail, buildDetail, loadImage });
    frame();
    await flush();
    // Every livery's logo loads, once; the detailed aircraft's fin is painted with its own only.
    expect(loadImage.mock.calls.map(([url]) => url).sort()).toEqual([...LOGO_URLS].sort());
    expect(refreshLogo).toHaveBeenCalledTimes(1);
    const [tinted] = refreshLogo.mock.calls[0];
    expect(tinted.draws[0][0].url).toBe(LIVERIES.DAL.logoTexture);
    const [first] = canvases.atlases();
    const logosOn = atlas => new Set(atlas.draws.map(([image]) => image.draws?.[0]?.[0]?.url).filter(Boolean));
    expect(logosOn(first)).toEqual(new Set(LOGO_URLS));

    // Removed and added again (3D off and on, a pause of the governor): the new atlas wears the logos at once.
    layer.onRemove();
    layer.onAdd(map, context);
    frame();
    const atlases = canvases.atlases();
    expect(atlases).toHaveLength(2);
    expect(logosOn(atlases[1])).toEqual(new Set(LOGO_URLS));
    expect(loadImage).toHaveBeenCalledTimes(LOGO_URLS.length);
  });

  it('draws the detailed aircraft from its type\'s L2 model once it loads, and says so in stats()', () => {
    const [lon, lat] = destinationPoint(ARP, 45, 300);
    const detail = { key: 'd', id: 'f:d', code: 'A320', spec: A320, livery: LIVERIES.UAL, registration: 'N2', lon,
      lat, headingDeg: 0, heightM: 0, pitchDeg: 0, bankDeg: 0, gsMs: 0, lights: {}, gearDown: true, onStand: false };
    const built = [];
    const buildDetail = (three, spec, options) => {
      const object = new Group();
      for (const mesh of options.airframe?.meshes ?? []) object.add(mesh);
      const model = { object, pivot: { y: 0, z: 0 }, setState() {}, dispose: vi.fn(), refreshLogo: () => false,
        textured: false };
      built.push({ options, model });
      return model;
    };
    const { layer, models, frame } = setup({ list: [], detail, buildDetail, loadImage: () => new Promise(() => {}) });
    frame();
    expect(models.state.asked).toContain('A320:l2');
    expect(built).toHaveLength(1);
    expect(built[0].options.airframe).toBeNull();
    expect(layer.stats().detail.level).toBeUndefined();

    models.state.load('A320:l2');
    frame();
    expect(built).toHaveLength(2);
    expect(built[0].model.dispose).toHaveBeenCalled();
    expect(built[1].options.airframe).not.toBeNull();
    expect(layer.stats().detail).toMatchObject({ key: 'd', level: 'l2' });
    expect(layer.stats().detail.triangles).toBeGreaterThan(0);
    // The same detail on the next frame keeps its model.
    frame();
    expect(built).toHaveLength(2);
  });
});
