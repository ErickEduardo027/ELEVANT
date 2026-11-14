import { describe, expect, it } from 'vitest';
import { trafficOverlay } from '../traffic/trafficLayers';
import { buildOccStyle } from '../style/occStyle';
import { VIEW_NAMES } from './cameraPresets';
import {
  LAYERS_STORAGE_KEY, LAYER_DEFAULTS, LAYER_GROUPS, LAYER_KEYS, LOCKED_LAYERS, availableLayerKeys, cleanOverrides,
  engineGroupsFor, readLayerOverrides, resolveLayers, setLayerOverride, writeLayerOverrides,
} from './layersMenu';

// A Storage in memory that can be told to refuse every call, as a private window may.
function memoryStorage(initial = {}, { refuse = false } = {}) {
  const items = new Map(Object.entries(initial));
  const guard = () => {
    if (refuse) throw new DOMException('The storage refused.', 'SecurityError');
  };
  return {
    items,
    getItem: key => { guard(); return items.has(key) ? items.get(key) : null; },
    setItem: (key, value) => { guard(); items.set(key, String(value)); },
    removeItem: key => { guard(); items.delete(key); },
  };
}

describe('layers menu', () => {
  it('lists the Tráfico group of design E7, with its defaults in every view', () => {
    expect(LAYER_GROUPS.map(group => group.id)).toEqual(['traffic']);
    expect(LAYER_KEYS).toEqual(['traffic.aviam', 'traffic.other', 'traffic.labels', 'traffic.trails', 'route']);
    expect(LOCKED_LAYERS).toEqual(['traffic.aviam']);
    expect(LAYERS_STORAGE_KEY).toBe('elevant-occ-map-layers:v1');
    for (const view of VIEW_NAMES) {
      expect(LAYER_DEFAULTS[view], view).toEqual({
        'traffic.aviam': true, 'traffic.other': true, 'traffic.labels': false, 'traffic.trails': false, route: true,
      });
    }
    // Before the map knows its view, a key is on only when every view has it on.
    expect(resolveLayers(null, {})).toEqual(LAYER_DEFAULTS.region);
  });

  it('stores only the differences from the preset defaults', () => {
    let overrides = {};
    overrides = setLayerOverride(overrides, 'region', 'traffic.labels', true);
    expect(overrides).toEqual({ 'traffic.labels': true });
    overrides = setLayerOverride(overrides, 'approach', 'traffic.other', false);
    expect(overrides).toEqual({ 'traffic.labels': true, 'traffic.other': false });
    // A choice equal to the default is not stored: going back to it removes the entry.
    expect(setLayerOverride(overrides, 'ramp', 'route', true)).toEqual(overrides);
    overrides = setLayerOverride(overrides, 'region', 'traffic.labels', false);
    expect(overrides).toEqual({ 'traffic.other': false });
    expect(resolveLayers('airfield', overrides)).toEqual({
      'traffic.aviam': true, 'traffic.other': false, 'traffic.labels': false, 'traffic.trails': false, route: true,
    });

    // What the map shows: the tags and the trails of all the traffic follow «Otro tráfico».
    expect(engineGroupsFor(resolveLayers('region', { 'traffic.labels': true, 'traffic.trails': true }))).toEqual({
      'traffic.aviam': true, 'traffic.other': true, 'traffic.labels': true, 'traffic.trails': true, route: true,
    });
    expect(engineGroupsFor(resolveLayers('region', { 'traffic.other': false, 'traffic.labels': true, 'traffic.trails': true,
      route: false }))).toEqual({
      'traffic.aviam': true, 'traffic.other': false, 'traffic.labels': false, 'traffic.trails': false, route: false,
    });

    // Kept in the browser as the differences alone, sorted; none left removes the entry.
    const storage = memoryStorage();
    writeLayerOverrides(storage, { route: false, 'traffic.labels': true });
    expect(storage.items.get(LAYERS_STORAGE_KEY)).toBe('{"route":false,"traffic.labels":true}');
    expect(readLayerOverrides(storage)).toEqual({ route: false, 'traffic.labels': true });
    writeLayerOverrides(storage, {});
    expect(storage.items.has(LAYERS_STORAGE_KEY)).toBe(false);
  });

  it('Vuelos de AVIAM cannot be turned off', () => {
    const overrides = { 'traffic.other': false };
    expect(setLayerOverride(overrides, 'region', 'traffic.aviam', false)).toBe(overrides);
    // Not even through a stored choice or a hand-made one.
    expect(resolveLayers('ramp', { 'traffic.aviam': false })['traffic.aviam']).toBe(true);
    expect(cleanOverrides({ 'traffic.aviam': false })).toEqual({});
    expect(readLayerOverrides(memoryStorage({ [LAYERS_STORAGE_KEY]: '{"traffic.aviam":false}' }))).toEqual({});
    expect(engineGroupsFor({ 'traffic.aviam': false })['traffic.aviam']).toBe(true);
  });

  it('ignores bad JSON and unknown keys', () => {
    for (const text of ['{not json', '[]', '"route"', 'null', '42']) {
      expect(readLayerOverrides(memoryStorage({ [LAYERS_STORAGE_KEY]: text })), text).toEqual({});
    }
    expect(readLayerOverrides(memoryStorage({ [LAYERS_STORAGE_KEY]: '{"rings":true,"route":"no","traffic.trails":true}' })))
      .toEqual({ 'traffic.trails': true });
    expect(setLayerOverride({}, 'region', 'weather.goes', true)).toEqual({});
    // A storage that refuses every call, or none at all, reads nothing and writes nothing, without throwing.
    const refusing = memoryStorage({}, { refuse: true });
    expect(readLayerOverrides(refusing)).toEqual({});
    expect(() => writeLayerOverrides(refusing, { route: false })).not.toThrow();
    expect(readLayerOverrides(undefined)).toEqual({});
    expect(() => writeLayerOverrides(undefined, { route: false })).not.toThrow();
  });

  it('offers only the keys whose layers the map has', () => {
    expect(availableLayerKeys(buildOccStyle({ overlays: [trafficOverlay()] }))).toEqual(LAYER_KEYS);
    expect(availableLayerKeys(buildOccStyle({ overlays: [] }))).toEqual([]);
    expect(availableLayerKeys(null)).toEqual([]);
  });
});
