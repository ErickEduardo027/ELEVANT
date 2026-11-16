import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OCC_PALETTE } from '../../occ-ui/occPalette';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint } from '../airport/geo';
import { THREE_PARTS } from './aircraft3dChunk';
import {
  AIRCRAFT_3D_LAYER_ID, MAX_MODEL_SCALE, SUN_STEP_DEG, UNUSED_MESH_MS, createAircraft3dLayer, sceneLighting,
} from './aircraft3dLayer';
import { triangleCount } from './aircraftGeometry';
import { linearRgb, mercatorFrame, planInstances } from './instancePlan';
import { AIRCRAFT_TYPES } from './types';

// The layer's life with the real three, in Node, and an injected renderer: three's scene, meshes, lights and raycaster
// need no WebGL, the renderer does. The map is the least MapLibre gives a custom layer: events, the canvas and
// triggerRepaint. Aircraft are synthetic, placed around the ARP of Punta Cana.
const ARP = MDPC_LAYOUT.meta.arp;
const WIDTH = 1000;
const HEIGHT = 800;
const FRAME = mercatorFrame(ARP);

function fakeMap() {
  const listeners = new Map();
  const canvas = { clientWidth: WIDTH, clientHeight: HEIGHT };
  return {
    canvas,
    on: vi.fn((type, handler) => listeners.set(type, [...(listeners.get(type) ?? []), handler])),
    off: vi.fn((type, handler) => listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== handler))),
    _fire(type) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler({ type });
    },
    listenerCount: type => (listeners.get(type) ?? []).length,
    getCanvas: () => canvas,
    triggerRepaint: vi.fn(),
  };
}

// A WebGL2 context as the layer reads it: its drawing buffer, twice the canvas (a pixel ratio of 2).
const fakeContext = name => ({ name, drawingBufferWidth: 2 * WIDTH, drawingBufferHeight: 2 * HEIGHT });

function fakeRenderers() {
  const made = [];
  const createRenderer = vi.fn(({ canvas, context }) => {
    const renderer = {
      canvas, context, autoClear: true, calls: [], disposed: false, scene: null, camera: null,
      resetState() {
        renderer.calls.push('resetState');
      },
      setViewport(...area) {
        renderer.calls.push(['setViewport', ...area]);
      },
      render(scene, camera) {
        renderer.calls.push('render');
        renderer.scene = scene;
        renderer.camera = camera;
      },
      dispose() {
        renderer.disposed = true;
      },
    };
    made.push(renderer);
    return renderer;
  });
  return { createRenderer, made };
}

// A camera of the map, south of the field and above it: `mainMatrix` is what MapLibre would hand the layer (mercator
// to clip), so that mainMatrix × the frame's matrix is the camera's own projection of the local frame.
function viewOf({ from = [0, -1_200, 900], target = [0, 300, 0] } = {}) {
  const camera = new PerspectiveCamera(40, WIDTH / HEIGHT, 10, 30_000);
  camera.up.set(0, 0, 1);
  camera.position.set(...from);
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  const localToClip = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const mainMatrix = new Matrix4().multiplyMatrices(localToClip, new Matrix4().fromArray(FRAME.matrix).invert());
  return {
    localToClip,
    input: { defaultProjectionData: { mainMatrix: Float64Array.from(mainMatrix.elements) } },
    // The CSS pixel of a local point, from the canvas's top-left corner.
    toPixel(point) {
      const clip = new Vector3(...point).applyMatrix4(localToClip);
      return { x: ((clip.x + 1) / 2) * WIDTH, y: ((1 - clip.y) / 2) * HEIGHT };
    },
  };
}

function aircraft(id, { bearing = 0, metres = 0, ...fields } = {}) {
  const [lon, lat] = destinationPoint(ARP, bearing, metres);
  return { id, kind: 'aviam', lon, lat, altM: 0, onGround: true, trackDeg: 0, typeIcao: 'A320', ...fields };
}

const planOf = list => planInstances(list, [], { zoom: 16, minZoom: 14, originLngLat: ARP });
const localOf = item => [...FRAME.toLocal([item.lon, item.lat])];
const meshesOf = scene => scene.children.filter(child => child.isInstancedMesh);
const meshOf = (scene, key) => meshesOf(scene).find(mesh => mesh.name === key);
const disposals = (...things) => {
  const seen = new Set();
  for (const thing of things) thing.addEventListener('dispose', () => seen.add(thing));
  return seen;
};

const GROUND = [
  aircraft('f:p:a', { bearing: 100, metres: 600, trackDeg: 90 }),
  aircraft('f:p:b', { bearing: 160, metres: 700, trackDeg: 175 }),
  aircraft('f:p:c', { bearing: 220, metres: 800, trackDeg: 175, typeIcao: 'B738' }),
];

afterEach(() => vi.restoreAllMocks());

describe('the 3D aircraft layer (design G1, G3 and G4)', () => {
  it('onAdd creates one renderer on the map canvas and context with autoClear off', () => {
    expect(AIRCRAFT_3D_LAYER_ID).toBe('occ-aircraft-3d');
    const { createRenderer, made } = fakeRenderers();
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, getInstances: () => null, createRenderer });
    expect(layer).toMatchObject({ id: 'occ-aircraft-3d', type: 'custom', renderingMode: '3d' });
    const map = fakeMap();
    const gl = fakeContext('gl');
    layer.onAdd(map, gl);
    expect(createRenderer).toHaveBeenCalledTimes(1);
    expect(createRenderer).toHaveBeenCalledWith({ canvas: map.canvas, context: gl });
    expect(made[0].autoClear).toBe(false);
    expect(map.on.mock.calls.map(([type]) => type)).toEqual(['webglcontextlost', 'webglcontextrestored']);
    // Added again on the same context, as after a style reload, it keeps its renderer and its listeners.
    layer.onAdd(map, gl);
    expect(createRenderer).toHaveBeenCalledTimes(1);
    expect(map.on).toHaveBeenCalledTimes(2);

    // Without an injected renderer it builds three's WebGLRenderer, antialiased, on the map's canvas and context.
    const built = [];
    const three = { ...THREE_PARTS, WebGLRenderer: class { constructor(options) { built.push(options); } } };
    createAircraft3dLayer({ three, originLngLat: ARP, getInstances: () => null }).onAdd(map, gl);
    expect(built).toEqual([{ canvas: map.canvas, context: gl, antialias: true }]);

    // A renderer that cannot be built warns once, in English, and reports the layer failed, so that the map shows its
    // 2D aircraft again; each onAdd tries again.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refusing = vi.fn(() => {
      throw new Error('no WebGL2');
    });
    const onFailedChange = vi.fn();
    const failing = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, getInstances: () => null,
      createRenderer: refusing, onFailedChange });
    // Not on a map yet, it has not failed.
    expect(failing.stats().failed).toBe(false);
    failing.onAdd(map, gl);
    expect(failing.stats()).toMatchObject({ failed: true, lost: false });
    expect(onFailedChange.mock.calls).toEqual([[true]]);
    failing.onAdd(map, gl);
    failing.render(gl, viewOf().input);
    expect(refusing).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('The 3D aircraft could not be drawn; the map keeps its 2D aircraft.');
    expect(onFailedChange).toHaveBeenCalledTimes(1);
    expect(failing.stats().failed).toBe(true);
    expect(failing.pick({ x: 1, y: 1 })).toBeNull();
    // Off the map it has not failed: whether the map draws in 2D is again the map's choice.
    failing.onRemove(map, gl);
    expect(failing.stats().failed).toBe(false);
    expect(onFailedChange.mock.calls).toEqual([[true], [false]]);

    // What the layer cannot work without.
    expect(() => createAircraft3dLayer({ originLngLat: ARP, getInstances: () => null })).toThrow(TypeError);
    expect(() => createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP })).toThrow(TypeError);
    expect(() => createAircraft3dLayer({ three: THREE_PARTS, originLngLat: null, getInstances: () => null })).toThrow(RangeError);
    const { '--occ-muted': _withoutNightLight, ...partial } = OCC_PALETTE;
    expect(() => createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, getInstances: () => null, palette: partial }))
      .toThrow(RangeError);
  });

  it('render projects with mainMatrix times the ARP frame, resets the state and draws once', () => {
    const { createRenderer, made } = fakeRenderers();
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer,
      getInstances: () => ({ revision: 1, plan: planOf(GROUND) }) });
    const map = fakeMap();
    const gl = fakeContext('gl');
    const view = viewOf();
    layer.onAdd(map, gl);
    layer.render(gl, view.input);
    const [renderer] = made;
    // The state three expects first, then the drawing buffer's viewport, then one draw on the map's own frame.
    expect(renderer.calls).toEqual(['resetState', ['setViewport', 0, 0, 2 * WIDTH, 2 * HEIGHT], 'render']);
    // mainMatrix × the frame's matrix: the local frame of the ARP straight to clip space.
    const expected = new Matrix4().fromArray(view.input.defaultProjectionData.mainMatrix)
      .multiply(new Matrix4().fromArray(FRAME.matrix));
    expect(renderer.camera.projectionMatrix.elements).toEqual(expected.elements);
    // The camera's own projection, up to the rounding of a mercator coordinate taken out and put back (~1e-8).
    renderer.camera.projectionMatrix.elements.forEach((value, cell) => {
      expect(value).toBeCloseTo(view.localToClip.elements[cell], 6);
    });
    const identity = new Matrix4().multiplyMatrices(renderer.camera.projectionMatrix, renderer.camera.projectionMatrixInverse);
    identity.elements.forEach((value, cell) => expect(value).toBeCloseTo(new Matrix4().elements[cell], 9));
    // An aircraft lands on the pixel where the 2D layers draw its position.
    const [x, y] = localOf(GROUND[0]);
    const pixel = view.toPixel([x, y, 0]);
    const clip = new Vector3(x, y, 0).applyMatrix4(renderer.camera.projectionMatrix);
    expect(((clip.x + 1) / 2) * WIDTH).toBeCloseTo(pixel.x, 6);
    expect(((1 - clip.y) / 2) * HEIGHT).toBeCloseTo(pixel.y, 6);

    // Each frame draws once; a frame without MapLibre's projection data draws nothing.
    layer.render(gl, view.input);
    expect(renderer.calls.filter(call => call === 'render')).toHaveLength(2);
    layer.render(gl, {});
    expect(renderer.calls.filter(call => call === 'render')).toHaveLength(2);
  });

  it('builds one InstancedMesh per type present and copies matrices only when the plan revision changes', () => {
    const { createRenderer, made } = fakeRenderers();
    let state = { revision: 1, plan: planOf(GROUND) };
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer, getInstances: () => state });
    const map = fakeMap();
    const gl = fakeContext('gl');
    const { input } = viewOf();
    layer.onAdd(map, gl);
    layer.render(gl, input);
    const { scene } = made[0];
    expect(meshesOf(scene).map(mesh => mesh.name).sort()).toEqual(['A320', 'B738']);
    const a320 = meshOf(scene, 'A320');
    const b738 = meshOf(scene, 'B738');
    // Two A320s and their shadows; capacity rounded up to a power of two.
    expect(a320.count).toBe(4);
    expect(a320.instanceMatrix.count).toBe(4);
    expect(b738.count).toBe(2);
    expect(b738.instanceMatrix.count).toBe(2);
    expect(Array.from(a320.instanceMatrix.array)).toEqual(Array.from(state.plan.get('A320').matrices));
    expect(Array.from(a320.instanceColor.array)).toEqual(Array.from(state.plan.get('A320').colors));
    expect(a320.frustumCulled).toBe(false);
    // Each type its own model; one white Lambert material for all.
    expect(a320.geometry).not.toBe(b738.geometry);
    expect(triangleCount(a320.geometry)).toBeGreaterThanOrEqual(1500);
    expect(a320.material).toBe(b738.material);
    expect(a320.material.type).toBe('MeshLambertMaterial');
    expect(a320.material.color.getHex()).toBe(0xffffff);

    // Nothing moved: the same revision copies nothing.
    const version = a320.instanceMatrix.version;
    const colourVersion = a320.instanceColor.version;
    layer.render(gl, input);
    expect(a320.instanceMatrix.version).toBe(version);
    expect(a320.instanceColor.version).toBe(colourVersion);
    // Something moved: a new revision copies the new matrices.
    const moved = [{ ...GROUND[0], trackDeg: 120 }, GROUND[1], GROUND[2]];
    state = { revision: 2, plan: planOf(moved) };
    layer.render(gl, input);
    expect(a320.instanceMatrix.version).toBe(version + 1);
    expect(Array.from(a320.instanceMatrix.array)).toEqual(Array.from(state.plan.get('A320').matrices));

    // A third A320 outgrows the mesh: a new one of capacity 8 on the same model; the old one is disposed.
    const seen = disposals(a320, a320.geometry);
    state = { revision: 3, plan: planOf([...moved, aircraft('f:p:d', { bearing: 130, metres: 650, trackDeg: 175 })]) };
    layer.render(gl, input);
    const grown = meshOf(scene, 'A320');
    expect(grown).not.toBe(a320);
    expect(grown.count).toBe(6);
    expect(grown.instanceMatrix.count).toBe(8);
    expect(grown.geometry).toBe(a320.geometry);
    expect(seen.has(a320)).toBe(true);
    expect(seen.has(a320.geometry)).toBe(false);
    expect(scene.children).not.toContain(a320);
    expect(meshesOf(scene)).toHaveLength(2);

    const triangles = triangleCount(grown.geometry) * 6 + triangleCount(b738.geometry) * 2;
    expect(layer.stats()).toEqual({ meshes: 2, instances: 8, triangles, drawCalls: 2, lost: false, failed: false });
  });

  it('disposes a mesh unused for 5 minutes together with its geometry', () => {
    expect(UNUSED_MESH_MS).toBe(300_000);
    const { createRenderer, made } = fakeRenderers();
    let clock = 1_000;
    let state = { revision: 1, plan: planOf(GROUND) };
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer, now: () => clock,
      getInstances: () => state });
    const gl = fakeContext('gl');
    const { input } = viewOf();
    layer.onAdd(fakeMap(), gl);
    layer.render(gl, input);
    const { scene } = made[0];
    const b738 = meshOf(scene, 'B738');
    const seen = disposals(b738, b738.geometry, meshOf(scene, 'A320').geometry);

    // The B738 leaves: its mesh draws nothing but stays, in case it comes back.
    clock = 2_000;
    state = { revision: 2, plan: planOf(GROUND.slice(0, 2)) };
    layer.render(gl, input);
    expect(b738.count).toBe(0);
    expect(meshOf(scene, 'B738')).toBe(b738);
    expect(layer.stats()).toMatchObject({ meshes: 2, instances: 4, drawCalls: 1 });
    clock = 2_000 + UNUSED_MESH_MS - 1;
    layer.render(gl, input);
    expect(meshOf(scene, 'B738')).toBe(b738);
    expect(seen.size).toBe(0);
    // Five minutes after its last aircraft, the mesh and its model are given up; the A320's stay.
    clock = 2_000 + UNUSED_MESH_MS;
    layer.render(gl, input);
    expect(meshOf(scene, 'B738')).toBeUndefined();
    expect(seen.has(b738)).toBe(true);
    expect(seen.has(b738.geometry)).toBe(true);
    expect(seen.has(meshOf(scene, 'A320').geometry)).toBe(false);
    expect(layer.stats().meshes).toBe(1);

    // A type that comes back within the five minutes keeps its mesh and its model, and its clock starts again.
    state = { revision: 3, plan: planOf(GROUND) };
    layer.render(gl, input);
    const back = meshOf(scene, 'B738');
    clock += 1_000;
    state = { revision: 4, plan: planOf(GROUND.slice(0, 2)) };
    layer.render(gl, input);
    clock += UNUSED_MESH_MS - 1_000;
    state = { revision: 5, plan: planOf(GROUND) };
    layer.render(gl, input);
    expect(meshOf(scene, 'B738')).toBe(back);
    clock += UNUSED_MESH_MS;
    layer.render(gl, input);
    expect(meshOf(scene, 'B738')).toBe(back);
    expect(back.count).toBe(2);
  });

  it('the sun lights the scene by day; at night a dim cool ambient and an overhead light', () => {
    const toRadians = degrees => (degrees * Math.PI) / 180;
    const day = sceneLighting({ azimuthDeg: 135, elevationDeg: 50 });
    expect(day.phase).toBe('day');
    // Toward the sun: (sin A cos e, cos A cos e, sin e) in east, north and up.
    expect(day.directional.direction[0]).toBeCloseTo(Math.sin(toRadians(135)) * Math.cos(toRadians(50)), 12);
    expect(day.directional.direction[1]).toBeCloseTo(Math.cos(toRadians(135)) * Math.cos(toRadians(50)), 12);
    expect(day.directional.direction[2]).toBeCloseTo(Math.sin(toRadians(50)), 12);
    // White light from the palette: the models keep their own greys.
    expect(day.directional.color).toEqual(linearRgb(OCC_PALETTE['--occ-primary-hover']));
    expect(day.hemisphere.skyColor).toEqual([1, 1, 1]);
    expect(day.hemisphere.groundColor).toEqual(linearRgb(OCC_PALETTE['--occ-line-strong']));
    expect(Object.isFrozen(day) && Object.isFrozen(day.directional.direction)).toBe(true);
    // A sun just over the horizon lights from 3° up, never from under the ground.
    expect(sceneLighting({ azimuthDeg: 90, elevationDeg: 0.5 }).directional.direction[2]).toBeCloseTo(Math.sin(toRadians(3)), 12);

    const night = sceneLighting({ azimuthDeg: 300, elevationDeg: -30 });
    expect(night.phase).toBe('night');
    const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Dim and cool: far less sky light than by day, bluer than it is red.
    expect(night.hemisphere.intensity * luminance(night.hemisphere.skyColor))
      .toBeLessThan((day.hemisphere.intensity * luminance(day.hemisphere.skyColor)) / 10);
    expect(night.hemisphere.skyColor[2]).toBeGreaterThan(night.hemisphere.skyColor[0]);
    expect(night.directional.intensity * luminance(night.directional.color))
      .toBeLessThan(day.directional.intensity * luminance(day.directional.color));
    // From high up, whatever the sun does below the horizon.
    expect(night.directional.direction[2]).toBeGreaterThan(Math.sin(toRadians(60)));
    expect(sceneLighting({ azimuthDeg: 20, elevationDeg: -70 }).directional).toEqual(night.directional);
    // Without a sun yet, the night's light, which keeps the models readable.
    expect(sceneLighting(null)).toEqual(night);
    // The civil twilight blends the two.
    const dusk = sceneLighting({ azimuthDeg: 250, elevationDeg: -3 });
    expect(dusk.phase).toBe('twilight');
    expect(dusk.directional.intensity).toBeGreaterThan(night.directional.intensity);
    expect(dusk.directional.intensity).toBeLessThan(day.directional.intensity);
    expect(Math.hypot(...dusk.directional.direction)).toBeCloseTo(1, 12);
    expect(() => sceneLighting({ azimuthDeg: 0, elevationDeg: 10 }, {})).toThrow(RangeError);

    // In the layer: the lights follow the sun at the ARP, step by step.
    const { createRenderer, made } = fakeRenderers();
    let sun = { azimuthDeg: 135, elevationDeg: 50 };
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer, getSun: () => sun,
      getInstances: () => ({ revision: 1, plan: planOf(GROUND) }) });
    const gl = fakeContext('gl');
    const { input } = viewOf();
    layer.onAdd(fakeMap(), gl);
    layer.render(gl, input);
    const { scene } = made[0];
    const sunLight = scene.children.find(child => child.isDirectionalLight);
    const hemisphere = scene.children.find(child => child.isHemisphereLight);
    const position = () => sunLight.position.toArray();
    position().forEach((value, axis) => expect(value).toBeCloseTo(day.directional.direction[axis], 12));
    expect(sunLight.intensity).toBe(day.directional.intensity);
    expect(hemisphere.position.toArray()).toEqual([0, 0, 1]);
    expect(hemisphere.intensity).toBe(day.hemisphere.intensity);
    expect(hemisphere.groundColor.toArray()).toEqual(day.hemisphere.groundColor);
    // A move smaller than SUN_STEP_DEG leaves the lights as they are; a larger one sets them again.
    expect(SUN_STEP_DEG).toBe(0.25);
    sun = { azimuthDeg: 135.1, elevationDeg: 50 };
    layer.render(gl, input);
    position().forEach((value, axis) => expect(value).toBeCloseTo(day.directional.direction[axis], 12));
    sun = { azimuthDeg: 137, elevationDeg: 49 };
    layer.render(gl, input);
    const later = sceneLighting(sun).directional.direction;
    position().forEach((value, axis) => expect(value).toBeCloseTo(later[axis], 12));
    // Night falls.
    sun = { azimuthDeg: 300, elevationDeg: -30 };
    layer.render(gl, input);
    position().forEach((value, axis) => expect(value).toBeCloseTo(night.directional.direction[axis], 12));
    expect(sunLight.intensity).toBe(night.directional.intensity);
    expect(hemisphere.color.toArray()).toEqual(night.hemisphere.skyColor);
  });

  it('pick returns the aircraft under the pointer and null where there is none, before the first frame or while the context is lost', () => {
    const gate = aircraft('f:p:gate', { bearing: 300, metres: 300, trackDeg: 90 });
    const final = aircraft('f:p:final', { bearing: 30, metres: 700, trackDeg: 80, onGround: false, altM: 120,
      typeIcao: 'B738' });
    const { createRenderer } = fakeRenderers();
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer,
      getInstances: () => ({ revision: 1, plan: planOf([gate, final]) }) });
    const map = fakeMap();
    const gl = fakeContext('gl');
    const view = viewOf();
    layer.onAdd(map, gl);
    // Before the first frame there is no projection to cast from.
    expect(layer.pick(view.toPixel([...localOf(gate), 3.5]))).toBeNull();
    layer.render(gl, view.input);

    // The fuselage's axis of each model (aircraft/aircraftGeometry.js: its belly 0.4 D above the wheels).
    const axis = spec => 0.4 * spec.fuselageDiaM + spec.fuselageDiaM / 2;
    const [gateX, gateY] = localOf(gate);
    expect(layer.pick(view.toPixel([gateX, gateY, axis(AIRCRAFT_TYPES.A320)]))).toEqual({ kind: 'aircraft', id: 'f:p:gate' });
    const [finalX, finalY] = localOf(final);
    const height = 120;
    const onFinal = view.toPixel([finalX, finalY, height + axis(AIRCRAFT_TYPES.B738)]);
    expect(layer.pick(onFinal)).toEqual({ kind: 'aircraft', id: 'f:p:final' });
    expect(layer.pick([onFinal.x, onFinal.y])).toEqual({ kind: 'aircraft', id: 'f:p:final' });
    // Under the airborne aircraft there is only its shadow, which is no aircraft; nor is the bare ground.
    expect(layer.pick(view.toPixel([finalX, finalY, 0.1]))).toBeNull();
    expect(layer.pick(view.toPixel([-600, 900, 0]))).toBeNull();
    expect(layer.pick({ x: Number.NaN, y: 3 })).toBeNull();
    expect(layer.pick(null)).toBeNull();

    // While the context is lost nothing is picked; once it is back and drawn, picking works again.
    map._fire('webglcontextlost');
    expect(layer.pick(onFinal)).toBeNull();
    map._fire('webglcontextrestored');
    layer.render(gl, view.input);
    expect(layer.pick(onFinal)).toEqual({ kind: 'aircraft', id: 'f:p:final' });
    // A canvas with no size picks nothing.
    map.canvas.clientWidth = 0;
    expect(layer.pick(onFinal)).toBeNull();
  });

  it('a lost context stops drawing; on restore a new renderer is built on the map context and a repaint is requested', () => {
    const { createRenderer, made } = fakeRenderers();
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer,
      getInstances: () => ({ revision: 1, plan: planOf(GROUND) }) });
    const map = fakeMap();
    const gl = fakeContext('gl');
    const { input } = viewOf();
    layer.onAdd(map, gl);
    layer.render(gl, input);
    const { scene } = made[0];
    const models = meshesOf(scene).map(mesh => mesh.geometry);
    const seen = disposals(...models);

    map._fire('webglcontextlost');
    expect(layer.stats().lost).toBe(true);
    layer.render(gl, input);
    expect(made[0].calls.filter(call => call === 'render')).toHaveLength(1);
    expect(map.triggerRepaint).not.toHaveBeenCalled();

    // Restored: the old renderer goes, a new one is built on the map's canvas and the same WebGL2 context.
    map._fire('webglcontextrestored');
    expect(made[0].disposed).toBe(true);
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(createRenderer).toHaveBeenLastCalledWith({ canvas: map.canvas, context: gl });
    expect(made[1].autoClear).toBe(false);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    expect(layer.stats().lost).toBe(false);
    // The scene and the models are plain objects the new renderer uploads again.
    layer.render(gl, input);
    expect(made[1].scene).toBe(scene);
    expect(meshesOf(scene).map(mesh => mesh.geometry)).toEqual(models);
    expect(seen.size).toBe(0);

    // A renderer that cannot free its resources on the lost context does not stop the next one.
    made[1].dispose = () => {
      throw new Error('context lost');
    };
    map._fire('webglcontextlost');
    map._fire('webglcontextrestored');
    expect(createRenderer).toHaveBeenCalledTimes(3);
    layer.render(gl, input);
    expect(made[2].calls).toContain('render');

    // The engine may add the layer again before the layer hears of the restore (it listens first): one renderer.
    map._fire('webglcontextlost');
    layer.onAdd(map, gl);
    expect(createRenderer).toHaveBeenCalledTimes(4);
    map._fire('webglcontextrestored');
    expect(createRenderer).toHaveBeenCalledTimes(4);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(3);
    layer.render(gl, input);
    expect(made[3].calls).toContain('render');
  });

  it('a context that comes back refusing a renderer reports the layer failed until a renderer is built again', () => {
    const { createRenderer: build, made } = fakeRenderers();
    let refuse = false;
    const createRenderer = vi.fn(options => {
      if (refuse) throw new Error('context rejected');
      return build(options);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onFailedChange = vi.fn();
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer, onFailedChange,
      getInstances: () => ({ revision: 1, plan: planOf(GROUND) }) });
    const map = fakeMap();
    const gl = fakeContext('gl');
    const view = viewOf();
    const [x, y] = localOf(GROUND[0]);
    const onAircraft = view.toPixel([x, y, 3.5]);
    layer.onAdd(map, gl);
    layer.render(gl, view.input);
    expect(layer.pick(onAircraft)).toEqual({ kind: 'aircraft', id: 'f:p:a' });

    // Lost: nothing draws then, 2D included, so the layer has not failed.
    map._fire('webglcontextlost');
    expect(layer.stats()).toMatchObject({ lost: true, failed: false });
    expect(onFailedChange).not.toHaveBeenCalled();

    // Back, but three cannot build its renderer on it: the layer draws and picks nothing (the map picks in 2D) and says
    // so once, so that the map shows its 2D aircraft again.
    refuse = true;
    map._fire('webglcontextrestored');
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(made[0].disposed).toBe(true);
    expect(layer.stats()).toMatchObject({ lost: false, failed: true });
    expect(onFailedChange.mock.calls).toEqual([[true]]);
    expect(warn).toHaveBeenCalledTimes(1);
    layer.render(gl, view.input);
    expect(made[0].calls.filter(call => call === 'render')).toHaveLength(1);
    expect(layer.pick(onAircraft)).toBeNull();

    // Added again on a context three accepts, it draws and picks again, and says so.
    refuse = false;
    layer.onAdd(map, gl);
    expect(createRenderer).toHaveBeenCalledTimes(3);
    expect(layer.stats().failed).toBe(false);
    expect(onFailedChange.mock.calls).toEqual([[true], [false]]);
    layer.render(gl, view.input);
    expect(made[1].calls).toContain('render');
    expect(layer.pick(onAircraft)).toEqual({ kind: 'aircraft', id: 'f:p:a' });

    // Failed on the next restore, then lost again: while nothing draws it has not failed, and the restore after that
    // tries again.
    refuse = true;
    map._fire('webglcontextlost');
    map._fire('webglcontextrestored');
    expect(layer.stats().failed).toBe(true);
    expect(onFailedChange.mock.calls).toEqual([[true], [false], [true]]);
    map._fire('webglcontextlost');
    expect(layer.stats()).toMatchObject({ lost: true, failed: false });
    expect(onFailedChange.mock.calls).toEqual([[true], [false], [true], [false]]);
    refuse = false;
    map._fire('webglcontextrestored');
    expect(createRenderer).toHaveBeenCalledTimes(5);
    expect(layer.stats().failed).toBe(false);
    expect(onFailedChange).toHaveBeenCalledTimes(4);
    layer.render(gl, view.input);
    expect(made[2].calls).toContain('render');
    // One warning on the page's console, however often it fails.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('added again after a restore, it binds to the new context without a second set of listeners', () => {
    const { createRenderer, made } = fakeRenderers();
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer,
      getInstances: () => ({ revision: 1, plan: planOf(GROUND) }) });
    const map = fakeMap();
    const first = fakeContext('first');
    const second = { ...fakeContext('second'), drawingBufferWidth: 1_500, drawingBufferHeight: 1_200 };
    const { input } = viewOf();
    layer.onAdd(map, first);
    layer.render(first, input);
    map._fire('webglcontextlost');
    map._fire('webglcontextrestored');
    expect(made[1].context).toBe(first);

    // The engine adds the layer again on the context MapLibre now draws with.
    layer.onAdd(map, second);
    expect(made[1].disposed).toBe(true);
    expect(createRenderer).toHaveBeenCalledTimes(3);
    expect(made[2].context).toBe(second);
    expect(map.on).toHaveBeenCalledTimes(2);
    expect(map.listenerCount('webglcontextlost')).toBe(1);
    expect(map.listenerCount('webglcontextrestored')).toBe(1);
    layer.render(second, input);
    expect(made[2].calls).toEqual(['resetState', ['setViewport', 0, 0, 1_500, 1_200], 'render']);
    // Added again on the context it already draws on, nothing changes.
    layer.onAdd(map, second);
    expect(createRenderer).toHaveBeenCalledTimes(3);

    // Moved to another map, it listens there and no longer to the first, and draws on that map's canvas.
    const other = fakeMap();
    layer.onAdd(other, second);
    expect(map.listenerCount('webglcontextlost') + map.listenerCount('webglcontextrestored')).toBe(0);
    expect(other.on).toHaveBeenCalledTimes(2);
    expect(createRenderer).toHaveBeenCalledTimes(4);
    expect(made[3].canvas).toBe(other.canvas);

    // MapLibre 6.16 itself removes its custom layers when the context is lost (its style's destroy() calls onRemove
    // before `webglcontextlost`): nothing is rebuilt while the layer is out, and the engine's new add draws anew.
    layer.render(second, input);
    layer.onRemove(other, second);
    other._fire('webglcontextlost');
    other._fire('webglcontextrestored');
    expect(createRenderer).toHaveBeenCalledTimes(4);
    expect(other.triggerRepaint).not.toHaveBeenCalled();
    layer.onAdd(other, second);
    expect(createRenderer).toHaveBeenCalledTimes(5);
    layer.render(second, input);
    expect(made[4].calls.at(-1)).toBe('render');
    expect(meshesOf(made[4].scene).map(mesh => mesh.name).sort()).toEqual(['A320', 'B738']);
    expect(other.listenerCount('webglcontextlost')).toBe(1);
    expect(other.listenerCount('webglcontextrestored')).toBe(1);
  });

  it('onRemove disposes meshes, materials and the renderer and stops listening', () => {
    const { createRenderer, made } = fakeRenderers();
    const traffic = [...GROUND, aircraft('f:p:air', { bearing: 40, metres: 2_000, onGround: false, altM: 300 })];
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer,
      getInstances: () => ({ revision: 1, plan: planOf(traffic) }) });
    const map = fakeMap();
    const gl = fakeContext('gl');
    const view = viewOf();
    layer.onAdd(map, gl);
    layer.render(gl, view.input);
    const { scene } = made[0];
    const meshes = meshesOf(scene);
    const lines = scene.children.find(child => child.isLineSegments);
    expect(lines.geometry.drawRange.count).toBe(2);
    const seen = disposals(...meshes, ...meshes.map(mesh => mesh.geometry), meshes[0].material, lines.geometry,
      lines.material);

    layer.onRemove(map, gl);
    expect(seen.size).toBe(2 * meshes.length + 3);
    expect(made[0].disposed).toBe(true);
    expect(map.off.mock.calls.map(([type]) => type)).toEqual(['webglcontextlost', 'webglcontextrestored']);
    expect(map.listenerCount('webglcontextlost') + map.listenerCount('webglcontextrestored')).toBe(0);
    expect(scene.children).toHaveLength(0);
    expect(layer.stats()).toEqual({ meshes: 0, instances: 0, triangles: 0, drawCalls: 0, lost: false, failed: false });
    // Removed, it draws, picks and rebuilds nothing.
    layer.render(gl, view.input);
    expect(made[0].calls.filter(call => call === 'render')).toHaveLength(1);
    expect(layer.pick(view.toPixel([...localOf(GROUND[0]), 3]))).toBeNull();
    map._fire('webglcontextrestored');
    expect(createRenderer).toHaveBeenCalledTimes(1);

    // Added again, it builds its scene anew and draws.
    layer.onAdd(map, gl);
    layer.render(gl, view.input);
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(made[1].scene).not.toBe(scene);
    expect(meshesOf(made[1].scene)).toHaveLength(2);
  });

  it('setQuality hides shadows and drop lines without switching the layer off', () => {
    const { createRenderer, made } = fakeRenderers();
    let state = { revision: 1, plan: planOf([GROUND[0], aircraft('f:p:air', { bearing: 40, metres: 2_000, onGround: false,
      altM: 300, typeIcao: 'B738' })]) };
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, createRenderer, getInstances: () => state });
    const map = fakeMap();
    const gl = fakeContext('gl');
    const view = viewOf();
    layer.onAdd(map, gl);
    layer.render(gl, view.input);
    const { scene } = made[0];
    const lines = scene.children.find(child => child.isLineSegments);
    const a320 = meshOf(scene, 'A320');
    const b738 = meshOf(scene, 'B738');
    const triangles = triangleCount(a320.geometry) + triangleCount(b738.geometry);
    // Two aircraft, two shadows, one drop line: three draw calls.
    expect(layer.stats()).toEqual({ meshes: 2, instances: 4, triangles: 2 * triangles, drawCalls: 3, lost: false,
      failed: false });

    expect(layer.setQuality({ shadows: false, dropLines: false })).toEqual({ shadows: false, dropLines: false });
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    layer.render(gl, view.input);
    expect(made[0].calls.filter(call => call === 'render')).toHaveLength(2);
    expect([a320.count, b738.count]).toEqual([1, 1]);
    expect(lines.visible).toBe(false);
    expect(layer.stats()).toEqual({ meshes: 2, instances: 2, triangles, drawCalls: 2, lost: false, failed: false });
    // The aircraft are still there to pick.
    const [x, y] = localOf(GROUND[0]);
    expect(layer.pick(view.toPixel([x, y, 3.5]))).toEqual({ kind: 'aircraft', id: 'f:p:a' });
    // A new plan keeps the lighter scene.
    state = { revision: 2, plan: state.plan };
    layer.render(gl, view.input);
    expect([a320.count, b738.count]).toEqual([1, 1]);

    // Back up, one lever at a time.
    expect(layer.setQuality({ shadows: true })).toEqual({ shadows: true, dropLines: false });
    expect([a320.count, b738.count]).toEqual([2, 2]);
    expect(lines.visible).toBe(false);
    expect(layer.setQuality({ dropLines: true })).toEqual({ shadows: true, dropLines: true });
    expect(lines.visible).toBe(true);
    expect(layer.setQuality()).toEqual({ shadows: true, dropLines: true });
    expect(layer.stats().drawCalls).toBe(3);
  });

  it("draws the traffic's models no shorter than minModelPx at the zoom of the frame, and parked ones to scale", () => {
    const { createRenderer } = fakeRenderers();
    const moving = aircraft('f:p:moving', { bearing: 100, metres: 600, trackDeg: 90 });
    const parked = { id: 's:A5', lon: moving.lon + 0.002, lat: moving.lat, headingDeg: 0, typeIcao: 'A320', kind: 'aviam' };
    const plan = planInstances([moving], [parked], { zoom: 16, minZoom: 14, originLngLat: ARP });
    expect([...plan.get('A320').floorLengths]).toEqual([AIRCRAFT_TYPES.A320.lengthM, 0, AIRCRAFT_TYPES.A320.lengthM, 0]
      .map(value => Math.fround(value)));
    const layer = createAircraft3dLayer({ three: THREE_PARTS, originLngLat: ARP, getInstances: () => ({ revision: 1, plan }),
      createRenderer, minModelPx: 30 });
    const map = { ...fakeMap(), zoom: 14 };
    map.getZoom = () => map.zoom;
    layer.onAdd(map, fakeContext('gl'));
    const { input } = viewOf();
    layer.render(fakeContext('gl'), input);
    const mesh = createRenderer.mock.results[0].value.scene.children.find(child => child.isInstancedMesh);
    // The columns of an instance's rotation: their length is its scale. Instances: moving, parked, then their shadows.
    const scaleOf = index => Math.hypot(...mesh.instanceMatrix.array.slice(16 * index, 16 * index + 3));
    const metresPerPixel = zoom => (40_075_016.686 / 512) * Math.cos((ARP[1] * Math.PI) / 180) / 2 ** zoom;
    expect(scaleOf(0)).toBeCloseTo(Math.min(MAX_MODEL_SCALE, (30 * metresPerPixel(14)) / AIRCRAFT_TYPES.A320.lengthM), 4);
    expect(scaleOf(1)).toBeCloseTo(1, 6);
    expect(scaleOf(2)).toBeCloseTo(scaleOf(0), 6);
    // Closer in, the floor gives way to the true size.
    map.zoom = 18;
    layer.render(fakeContext('gl'), input);
    expect(scaleOf(0)).toBeCloseTo(1, 6);
    // Far out, never more than MAX_MODEL_SCALE times its size.
    map.zoom = 11;
    layer.render(fakeContext('gl'), input);
    expect(scaleOf(0)).toBeCloseTo(MAX_MODEL_SCALE, 6);
  });
});
