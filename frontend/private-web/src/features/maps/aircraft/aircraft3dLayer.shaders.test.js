// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint } from '../airport/geo';
import { THREE_PARTS } from './aircraft3dChunk';
import { NOTHING_DRAWN, WAITING_LAYER, WARM_TYPE, createAircraft3dLayer, shaderErrorChecks } from './aircraft3dLayer';
import { MODELS_BASE_URL, createGltfModels } from './gltfModels';
import { planInstances } from './instancePlan';
import { LIVERIES } from './liveries';
import { metresPerPixel } from './modelLevels';
import { AIRCRAFT_TYPES } from './types';

// HOTFIX-3D (2026-11-28): «Seguir en 3D» froze the page while three compiled its shaders on their first draw. The layer
// now compiles them ahead with compileAsync, draws nothing whose programs are not ready, shares its materials and,
// outside development and the tests, no longer has three read every program's log. The real three in Node, an
// injected renderer that compiles when the test says so, and the vendored A320 model of public/models/aircraft.
const ARP = MDPC_LAYOUT.meta.arp;
const PUBLIC = path.resolve(process.cwd(), 'public');
const A320 = AIRCRAFT_TYPES.A320;
const IDENTITY = { defaultProjectionData: { mainMatrix: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) } };
const context = { drawingBufferWidth: 2000, drawingBufferHeight: 1600 };

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

afterEach(() => vi.restoreAllMocks());

// The models of the layer: `load(key)` makes one ready and calls the layer's onLoad.
function fakeModels() {
  const state = { onLoad: null, loaded: new Set() };
  const createModels = onLoad => {
    state.onLoad = onLoad;
    return { get: (code, level) => (state.loaded.has(`${code}:${level}`) ? MODELS[`${code}:${level}`] : null) };
  };
  state.load = key => {
    state.loaded.add(key);
    state.onLoad();
  };
  return { createModels, state };
}

// three's parts whose materials count themselves as they are made.
function countingThree() {
  const made = [];
  const counted = Base => class extends Base {
    constructor(...args) {
      super(...args);
      made.push(this);
    }
  };
  const three = { ...THREE_PARTS };
  for (const name of ['MeshBasicMaterial', 'MeshLambertMaterial', 'MeshStandardMaterial', 'LineBasicMaterial',
    'ShaderMaterial']) three[name] = counted(THREE_PARTS[name]);
  return { three, made };
}

// The program a material would compile to, as far as these tests tell programs apart.
const programKey = material => [material.type, material.customProgramCacheKey?.() ?? '', material.side,
  Boolean(material.map), material.transparent, material.vertexColors, material.blending].join('|');

function materialsIn(object) {
  const found = new Set();
  object.traverse(node => {
    if (node.material) found.add(node.material);
  });
  return [...found];
}

// A renderer whose compileAsync answers only when the test resolves it, with three's debug flag and its programs.
function compilingRenderers() {
  const made = [];
  const createRenderer = vi.fn(() => {
    const keys = new Set();
    const renderer = {
      autoClear: true, debug: { checkShaderErrors: true }, info: { programs: [] }, pending: [], renders: [],
      compiledObjects: [],
      resetState() {},
      setViewport() {},
      render(scene) {
        renderer.renders.push(scene);
      },
      compileAsync(object, camera, target) {
        renderer.compiledObjects.push({ object, camera, target });
        for (const material of materialsIn(object)) {
          const key = programKey(material);
          if (!keys.has(key)) {
            keys.add(key);
            renderer.info.programs.push({ key });
          }
        }
        return new Promise(resolve => {
          renderer.pending.push(() => resolve(object));
        });
      },
      dispose() {},
    };
    made.push(renderer);
    return renderer;
  });
  return { createRenderer, made };
}

const flush = async () => {
  for (let round = 0; round < 3; round += 1) await new Promise(done => setTimeout(done, 0));
};

async function compileAll(renderer) {
  while (renderer.pending.length > 0) {
    for (const resolve of renderer.pending.splice(0)) resolve();
    await flush();
  }
}

function fakeMap(zoom) {
  const canvas = { clientWidth: 1000, clientHeight: 800 };
  return { canvas, zoom, getZoom() { return this.zoom; }, on: vi.fn(), off: vi.fn(), getCanvas: () => canvas,
    triggerRepaint: vi.fn() };
}

// The zoom at which an A320 is drawn `pixels` CSS pixels long over the ARP.
const zoomFor = pixels => Math.log2((pixels * metresPerPixel(0, ARP[1])) / A320.lengthM);

function aircraft(id, { bearing = 0, metres = 0, ...fields } = {}) {
  const [lon, lat] = destinationPoint(ARP, bearing, metres);
  return { id, kind: 'aviam', lon, lat, altM: 0, onGround: true, trackDeg: 0, typeIcao: 'A320', airlineIcao: 'UAL', ...fields };
}

function detailOf(key, { code = 'A320', livery = LIVERIES.CMP, registration = 'HP-1' } = {}) {
  const [lon, lat] = destinationPoint(ARP, 45, 300);
  return { key, id: `f:${key}`, code, spec: AIRCRAFT_TYPES[code], livery, registration, lon, lat, headingDeg: 0,
    heightM: 0, pitchDeg: 0, bankDeg: 0, gsMs: 0, lights: {}, gearDown: true, onStand: false };
}

const planOf = list => planInstances(list, [], { zoom: 18, minZoom: 14, originLngLat: ARP });

function setup({ list = [aircraft('f:a')], zoom = zoomFor(80), detail = null, three = THREE_PARTS, ...options } = {}) {
  const models = fakeModels();
  const { createRenderer, made } = compilingRenderers();
  const idleTasks = [];
  const idle = vi.fn(task => {
    idleTasks.push(task);
    return () => idleTasks.splice(idleTasks.indexOf(task) >>> 0, 1);
  });
  const answer = { revision: 1, plan: planOf(list), detail };
  const layer = createAircraft3dLayer({
    three, originLngLat: ARP, getInstances: () => answer, createModels: models.createModels, createRenderer, idle,
    createCanvas: () => null, loadImage: () => new Promise(() => {}), ...options,
  });
  const map = fakeMap(zoom);
  layer.onAdd(map, context);
  const renderer = () => made.at(-1);
  const frame = () => layer.render(context, IDENTITY);
  const runIdle = () => {
    for (const task of idleTasks.splice(0)) task();
  };
  const mainScene = () => renderer().renders.find(scene => scene.children.some(child => child.isInstancedMesh))
    ?? renderer().renders[0];
  return { layer, map, models, answer, frame, renderer, runIdle, idle, idleTasks, mainScene, made };
}

const typeMeshes = scene => scene.children.filter(child => child.isInstancedMesh && child.name === 'A320');
const drawn = object => object.layers.isEnabled(0);

describe('the 3D layer compiles its shaders ahead, without blocking the page (HOTFIX-3D)', () => {
  it('has three check its shaders only in development and the tests', () => {
    expect(shaderErrorChecks('production')).toBe(false);
    expect(shaderErrorChecks(null)).toBe(false);
    expect(shaderErrorChecks('development')).toBe(true);
    expect(shaderErrorChecks('test')).toBe(true);
    // Under the tests NODE_ENV is 'test': the default keeps three's checks on.
    expect(shaderErrorChecks()).toBe(true);
    expect(setup().renderer().debug.checkShaderErrors).toBe(true);
    // A production build turns them off on every renderer it makes.
    const { renderer, layer, map } = setup({ checkShaderErrors: shaderErrorChecks('production') });
    expect(renderer().debug.checkShaderErrors).toBe(false);
    layer.onRemove();
    layer.onAdd(map, { ...context });
    expect(renderer().debug.checkShaderErrors).toBe(false);
  });

  it('warms the programs up in idle time after onAdd, and cancels the warm-up on onRemove', async () => {
    const { layer, renderer, runIdle, idle, idleTasks, map } = setup({ list: [] });
    expect(idle).toHaveBeenCalledTimes(1);
    expect(renderer().compiledObjects).toEqual([]);
    runIdle();
    const compiled = renderer().compiledObjects;
    // The instanced models' material, the contact shadows, the drop lines and a detailed aircraft of WARM_TYPE, with the
    // lights of its own scene.
    const materials = compiled.flatMap(({ object }) => materialsIn(object));
    expect(materials.some(item => item.isMeshLambertMaterial && item.customProgramCacheKey?.() === 'occ-aircraft-livery-zones'))
      .toBe(true);
    expect(materials.some(item => item.isLineBasicMaterial)).toBe(true);
    expect(materials.filter(item => item.blending === THREE_PARTS.SubtractiveBlending).length).toBeGreaterThanOrEqual(2);
    const warmDetail = compiled.find(({ object }) => object.name === 'detailed-aircraft');
    expect(WARM_TYPE).toBe('B738');
    expect(warmDetail.target.isScene).toBe(true);
    expect(warmDetail.target.children.some(child => child.isHemisphereLight)).toBe(true);
    expect(warmDetail.target.children).not.toContain(warmDetail.object);
    await compileAll(renderer());
    // Removed before its idle task ran: nothing is compiled.
    layer.onRemove();
    layer.onAdd(map, { ...context });
    expect(idleTasks).toHaveLength(1);
    layer.onRemove();
    expect(idleTasks).toHaveLength(0);
  });

  it('draws nothing whose programs are not ready, and draws it once compileAsync resolves', async () => {
    const { layer, map, frame, renderer, mainScene } = setup();
    frame();
    const [procedural] = typeMeshes(mainScene());
    expect(procedural.count).toBeGreaterThan(0);
    // Its program is compiling: it waits on a layer the camera does not see, and the map is not asked to repaint yet.
    expect(procedural.layers.isEnabled(WAITING_LAYER)).toBe(true);
    expect(drawn(procedural)).toBe(false);
    map.triggerRepaint.mockClear();
    await compileAll(renderer());
    expect(map.triggerRepaint).toHaveBeenCalled();
    frame();
    expect(drawn(procedural)).toBe(true);
    expect(layer.stats().instances).toBeGreaterThan(0);
  });

  it('keeps drawing the procedural model until a loaded L1 model has compiled, then swaps it in', async () => {
    const { layer, map, models, frame, renderer, mainScene } = setup();
    frame();
    await compileAll(renderer());
    frame();
    const [procedural] = typeMeshes(mainScene());
    models.state.load('A320:l1');
    frame();
    // Loaded, not compiled: the procedural model still draws; its livery material compiles on a probe.
    expect(typeMeshes(mainScene())).toEqual([procedural]);
    expect(drawn(procedural)).toBe(true);
    expect(layer.stats().models).toBeUndefined();
    const probe = renderer().compiledObjects.at(-1);
    expect(probe.object.material.name).toBe('livery');
    expect(probe.object.isInstancedMesh && probe.object.instanceColor !== null).toBe(true);
    expect(probe.target).toBe(mainScene());
    frame();
    expect(typeMeshes(mainScene())).toEqual([procedural]);
    map.triggerRepaint.mockClear();
    await compileAll(renderer());
    expect(map.triggerRepaint).toHaveBeenCalled();
    frame();
    const [l1] = typeMeshes(mainScene());
    expect(l1).not.toBe(procedural);
    expect(l1.material).toBe(probe.object.material);
    expect(drawn(l1)).toBe(true);
    expect(layer.stats().models).toBe(1);
  });

  it('keeps the procedural detailed aircraft until its L2 model has compiled, and draws neither before its programs', async () => {
    const detail = detailOf('d', { livery: LIVERIES.UAL, registration: 'N2' });
    const { layer, models, frame, renderer } = setup({ list: [], detail });
    frame();
    // The detailed aircraft's programs are compiling: only the main scene is drawn.
    expect(renderer().renders).toHaveLength(1);
    expect(layer.stats().detail).toBeUndefined();
    await compileAll(renderer());
    frame();
    expect(renderer().renders).toHaveLength(3);
    expect(layer.stats().detail).toMatchObject({ key: 'd' });
    expect(layer.stats().detail.level).toBeUndefined();

    models.state.load('A320:l2');
    frame();
    // Loaded, not compiled: the procedural detailed aircraft still draws.
    expect(layer.stats().detail).toMatchObject({ key: 'd' });
    expect(layer.stats().detail.level).toBeUndefined();
    const probe = renderer().compiledObjects.at(-1);
    expect(materialsIn(probe.object).map(item => item.name)).toContain('livery');
    expect(probe.target.children.some(child => child.isHemisphereLight)).toBe(true);
    await compileAll(renderer());
    frame();
    expect(layer.stats().detail).toMatchObject({ key: 'd', level: 'l2' });
    frame();
    expect(layer.stats().detail.level).toBe('l2');
  });

  it('makes no new material when the followed aircraft or the level changes, and stats() counts the programs', async () => {
    const { three, made } = countingThree();
    const first = detailOf('a', { code: 'B738', registration: 'HP-1' });
    const { layer, map, answer, models, frame, renderer, runIdle } = setup({ three, detail: first });
    runIdle();
    frame();
    await compileAll(renderer());
    frame();
    expect(layer.stats().detail).toMatchObject({ key: 'a' });
    const programs = renderer().info.programs.length;
    expect(programs).toBeGreaterThan(0);
    expect(layer.stats().programs).toBe(programs);
    const materials = made.length;

    // Another aircraft of the same type and livery followed: its materials are the first one's.
    answer.detail = detailOf('b', { code: 'B738', registration: 'HP-2' });
    frame();
    await compileAll(renderer());
    frame();
    expect(layer.stats().detail).toMatchObject({ key: 'b' });
    expect(made.length).toBe(materials);
    // Another livery: new colours, never a new program.
    answer.detail = detailOf('c', { code: 'B738', livery: LIVERIES.DAL, registration: 'N3' });
    frame();
    await compileAll(renderer());
    frame();
    expect(layer.stats().detail).toMatchObject({ key: 'c' });
    expect(renderer().info.programs.length).toBe(programs);
    // Back to the first: nothing new at all.
    const afterLiveries = made.length;
    answer.detail = first;
    frame();
    await compileAll(renderer());
    frame();
    expect(made.length).toBe(afterLiveries);

    // The level of the instanced A320: L1, procedural, L1 again: one livery material, made once.
    models.state.load('A320:l1');
    frame();
    await compileAll(renderer());
    frame();
    expect(layer.stats().models).toBe(1);
    const withL1 = made.length;
    const programsWithL1 = renderer().info.programs.length;
    map.zoom = zoomFor(10);
    frame();
    expect(layer.stats().models).toBeUndefined();
    map.zoom = zoomFor(80);
    frame();
    await compileAll(renderer());
    frame();
    expect(layer.stats().models).toBe(1);
    expect(made.length).toBe(withL1);
    expect(renderer().info.programs.length).toBe(programsWithL1);
  });

  it('says what it really drew: a detail and types still compiling are not drawn, so their 2D symbols stay', async () => {
    const detail = detailOf('d', { code: 'B738', livery: LIVERIES.CMP, registration: 'HP-1' });
    const onDrawnChange = vi.fn();
    // Added and handed its detail in the same frame, before any warm-up ran («Seguir en 3D» from the 2D map).
    const { layer, map, frame, renderer, answer } = setup({ detail, onDrawnChange });
    expect(layer.drawnNow()).toBe(NOTHING_DRAWN);
    frame();
    expect(layer.drawnNow()).toMatchObject({ detail: null, animated: false });
    expect(layer.drawnNow().keys.size).toBe(0);
    expect(onDrawnChange).not.toHaveBeenCalled();
    await compileAll(renderer());
    frame();
    const [key] = answer.plan.keys();
    expect(layer.drawnNow().detail).toBe('d');
    expect([...layer.drawnNow().keys]).toEqual([key]);
    expect(onDrawnChange).toHaveBeenCalledOnce();
    // Another frame that draws the same: no word.
    frame();
    expect(onDrawnChange).toHaveBeenCalledOnce();
    // The context lost: nothing draws, and the map hears it.
    const [[, lostHandler]] = map.on.mock.calls.filter(([name]) => name === 'webglcontextlost');
    lostHandler();
    expect(layer.drawnNow()).toBe(NOTHING_DRAWN);
    expect(onDrawnChange).toHaveBeenCalledTimes(2);
    // Removed: nothing drawn either.
    layer.onRemove();
    expect(layer.drawnNow()).toBe(NOTHING_DRAWN);
  });

  it('drops a compilation answered after the layer was removed or its renderer replaced', async () => {
    const { layer, map, frame, made } = setup();
    frame();
    const old = made.at(-1);
    expect(old.pending.length).toBeGreaterThan(0);
    layer.onRemove();
    map.triggerRepaint.mockClear();
    await compileAll(old);
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    // Added again on a new context: a new renderer compiles everything again, and only its answers count.
    layer.onAdd(map, { ...context });
    const fresh = made.at(-1);
    expect(fresh).not.toBe(old);
    layer.render(context, IDENTITY);
    expect(fresh.compiledObjects.length).toBeGreaterThan(0);
    await compileAll(fresh);
    expect(map.triggerRepaint).toHaveBeenCalled();
  });
});
