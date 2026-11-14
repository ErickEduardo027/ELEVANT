import { afterEach, describe, expect, it, vi } from 'vitest';
import { triangleCount } from './aircraftGeometry';
import { loadAircraft3d, resetAircraft3dLoaderForTests } from './loadAircraft3d';
import { AIRCRAFT_TYPES } from './types';

// A chunk as the bundler hands it over: its exports, nothing more.
const FAKE_THREE = Object.freeze({ name: 'three parts' });
const fakeBuild = () => 'model';
const fakeChunk = (extra = {}) => ({ THREE_PARTS: FAKE_THREE, buildAircraftGeometry: fakeBuild, ...extra });

afterEach(() => resetAircraft3dLoaderForTests());

describe('the 3D chunk loader (design G1)', () => {
  it('loads three and the aircraft modules once, through one import()', async () => {
    const chunk = fakeChunk();
    const importChunk = vi.fn(() => Promise.resolve(chunk));
    const first = loadAircraft3d({ importChunk });
    // A second map asking while the chunk travels shares the same load.
    expect(loadAircraft3d({ importChunk })).toBe(first);
    const loaded = await first;
    expect(loaded).toEqual({ three: chunk.THREE_PARTS, buildAircraftGeometry: chunk.buildAircraftGeometry });
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(await loadAircraft3d({ importChunk })).toBe(loaded);
    expect(importChunk).toHaveBeenCalledTimes(1);

    // The layer factory travels along once the chunk exports it.
    resetAircraft3dLoaderForTests();
    const createAircraft3dLayer = () => ({ id: 'occ-aircraft-3d' });
    await expect(loadAircraft3d({ importChunk: () => Promise.resolve(fakeChunk({ createAircraft3dLayer })) })).resolves
      .toEqual({ three: chunk.THREE_PARTS, buildAircraftGeometry: chunk.buildAircraftGeometry, createAircraft3dLayer });

    // The real chunk: the parts of three that the geometry module needs, and the module itself.
    resetAircraft3dLoaderForTests();
    const real = await loadAircraft3d();
    expect(Object.keys(real).sort()).toEqual(['buildAircraftGeometry', 'three']);
    expect(Object.keys(real.three).sort()).toEqual([
      'BoxGeometry', 'BufferGeometry', 'Color', 'CylinderGeometry', 'ExtrudeGeometry', 'Float32BufferAttribute',
      'LatheGeometry', 'Matrix4', 'Shape', 'Vector2', 'Vector3', 'mergeGeometries',
    ]);
    expect(Object.isFrozen(real.three)).toBe(true);
    expect(triangleCount(real.buildAircraftGeometry(real.three, AIRCRAFT_TYPES.A320))).toBeGreaterThanOrEqual(1500);
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
});
