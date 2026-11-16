import { afterEach, describe, expect, it, vi } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { triangleCount } from './aircraftGeometry';
import { planInstances } from './instancePlan';
import { loadAircraft3d, resetAircraft3dLoaderForTests } from './loadAircraft3d';
import { AIRCRAFT_TYPES } from './types';

// A chunk as the bundler hands it over: its exports, nothing more.
const FAKE_THREE = Object.freeze({ name: 'three parts' });
const fakeChunk = (extra = {}) => ({
  THREE_PARTS: FAKE_THREE,
  buildAircraftGeometry: () => 'model',
  createAircraft3dLayer: () => ({ id: 'occ-aircraft-3d' }),
  sceneLighting: () => ({ phase: 'day' }),
  AIRCRAFT_3D_LAYER_ID: 'occ-aircraft-3d',
  ...extra,
});
const modulesOf = chunk => ({
  three: chunk.THREE_PARTS,
  buildAircraftGeometry: chunk.buildAircraftGeometry,
  createAircraft3dLayer: chunk.createAircraft3dLayer,
  sceneLighting: chunk.sceneLighting,
  AIRCRAFT_3D_LAYER_ID: chunk.AIRCRAFT_3D_LAYER_ID,
});

afterEach(() => resetAircraft3dLoaderForTests());

describe('the 3D chunk loader (design G1)', () => {
  it('loads three and the aircraft modules once, through one import()', async () => {
    const chunk = fakeChunk();
    const importChunk = vi.fn(() => Promise.resolve(chunk));
    const first = loadAircraft3d({ importChunk });
    // A second map asking while the chunk travels shares the same load.
    expect(loadAircraft3d({ importChunk })).toBe(first);
    const loaded = await first;
    expect(loaded).toEqual(modulesOf(chunk));
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(await loadAircraft3d({ importChunk })).toBe(loaded);
    expect(importChunk).toHaveBeenCalledTimes(1);

    // A chunk without the layer is a failed load: the map keeps its 2D aircraft.
    resetAircraft3dLoaderForTests();
    const warn = vi.fn();
    const broken = loadAircraft3d({ importChunk: () => Promise.resolve(fakeChunk({ createAircraft3dLayer: undefined })), warn });
    await expect(broken).rejects.toThrow(TypeError);
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(loadAircraft3d({ importChunk })).resolves.toEqual(modulesOf(chunk));
  });

  it('a failed chunk load rejects, warns once and is retried on the next call', async () => {
    const failure = new Error('Loading chunk 3d failed.');
    const chunk = fakeChunk();
    const importChunk = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(chunk);
    const warn = vi.fn();

    // Two maps waiting on the same failed load share one rejection and one warning, in English, on the console only.
    const waiting = [loadAircraft3d({ importChunk, warn }), loadAircraft3d({ importChunk, warn })];
    for (const outcome of await Promise.allSettled(waiting)) expect(outcome).toEqual({ status: 'rejected', reason: failure });
    expect(importChunk).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('The 3D aircraft could not be loaded; the map keeps its 2D aircraft.', failure);

    // The next call tries again; a second failure is not logged twice on the same page.
    await expect(loadAircraft3d({ importChunk, warn })).rejects.toBe(failure);
    expect(importChunk).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);

    // Once the chunk arrives it is kept.
    const loaded = await loadAircraft3d({ importChunk, warn });
    expect(loaded.three).toBe(chunk.THREE_PARTS);
    expect(await loadAircraft3d({ importChunk, warn })).toBe(loaded);
    expect(importChunk).toHaveBeenCalledTimes(3);

    // A new page warns again; console.warn is the default.
    resetAircraft3dLoaderForTests();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(loadAircraft3d({ importChunk: () => Promise.reject(failure) })).rejects.toBe(failure);
      expect(consoleWarn).toHaveBeenCalledTimes(1);
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it('the loaded chunk carries the layer, the lighting and the geometry builder', async () => {
    // The real chunk, through the real import().
    const loaded = await loadAircraft3d();
    expect(Object.keys(loaded).sort()).toEqual([
      'AIRCRAFT_3D_LAYER_ID', 'buildAircraftGeometry', 'createAircraft3dLayer', 'sceneLighting', 'three',
    ]);
    // The parts of three that the models and the layer use, by name.
    expect(Object.keys(loaded.three).sort()).toEqual([
      'BoxGeometry', 'BufferGeometry', 'Camera', 'Color', 'CylinderGeometry', 'DirectionalLight', 'DynamicDrawUsage',
      'ExtrudeGeometry', 'Float32BufferAttribute', 'HemisphereLight', 'InstancedBufferAttribute', 'InstancedMesh',
      'LatheGeometry', 'LineBasicMaterial', 'LineSegments', 'Matrix4', 'MeshLambertMaterial', 'Raycaster', 'Scene',
      'Shape', 'Vector2', 'Vector3', 'WebGLRenderer', 'mergeGeometries',
    ]);
    expect(Object.isFrozen(loaded.three)).toBe(true);
    expect(triangleCount(loaded.buildAircraftGeometry(loaded.three, AIRCRAFT_TYPES.A320))).toBeGreaterThanOrEqual(1500);
    expect(loaded.sceneLighting({ azimuthDeg: 120, elevationDeg: 40 }).phase).toBe('day');
    expect(loaded.sceneLighting({ azimuthDeg: 300, elevationDeg: -40 }).phase).toBe('night');

    // The layer the map adds, drawn once with a stand-in renderer: one mesh for the one type planned.
    const arp = MDPC_LAYOUT.meta.arp;
    const plan = planInstances([{ id: 'f:p:demo', kind: 'aviam', lon: arp[0], lat: arp[1], onGround: true, altM: 0,
      trackDeg: 80, typeIcao: 'A320' }], [], { zoom: 16, minZoom: 14, originLngLat: arp });
    const drawn = [];
    const layer = loaded.createAircraft3dLayer({
      three: loaded.three,
      originLngLat: arp,
      getInstances: () => ({ revision: 1, plan }),
      createRenderer: () => ({ resetState() {}, setViewport() {}, render: scene => drawn.push(scene), dispose() {} }),
      now: () => 0,
    });
    expect(layer).toMatchObject({ id: loaded.AIRCRAFT_3D_LAYER_ID, type: 'custom', renderingMode: '3d' });
    expect(loaded.AIRCRAFT_3D_LAYER_ID).toBe('occ-aircraft-3d');
    const map = { on() {}, off() {}, getCanvas: () => ({ clientWidth: 800, clientHeight: 600 }), triggerRepaint() {} };
    layer.onAdd(map, { drawingBufferWidth: 800, drawingBufferHeight: 600 });
    layer.render({ drawingBufferWidth: 800, drawingBufferHeight: 600 },
      { defaultProjectionData: { mainMatrix: Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) } });
    expect(drawn).toHaveLength(1);
    expect(layer.stats()).toMatchObject({ meshes: 1, instances: 2, drawCalls: 1, lost: false });
    layer.onRemove(map);
  });
});
