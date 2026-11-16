import { describe, expect, it } from 'vitest';
import { trafficOverlay } from '../traffic/trafficLayers';
import { buildOccStyle } from '../style/occStyle';
import { referenceOverlay } from '../style/referenceLayers';
import { routesOverlay } from '../style/routeLayers';
import { weatherOverlay } from '../traffic/weatherLayers';
import { VIEW_NAMES } from './cameraPresets';
import {
  LAYERS_STORAGE_KEY, LAYER_DEFAULTS, LAYER_GROUPS, LAYER_KEYS, LOCKED_LAYERS, availableLayerKeys, cleanOverrides,
  engineGroupsFor, readLayerOverrides, resolveLayers, setLayerOverride, writeLayerOverrides,
} from './layersMenu';

const TRAFFIC_KEYS = ['traffic.aviam', 'traffic.other', 'traffic.labels', 'traffic.trails', 'route'];
const REFERENCE_KEYS = ['reference.airports', 'reference.routes', 'rings', 'centrelines', 'navaids', 'daynight'];
// The references of each view (design E7): rings and airports in Región and Aproximación, the routes from Punta Cana in
// Región, the centrelines in Aproximación, the navaids in Aproximación and Aeródromo, day and night in Región and
// Aproximación.
const REFERENCE_DEFAULTS = Object.freeze({
  region: { 'reference.airports': true, 'reference.routes': true, rings: true, centrelines: false, navaids: false, daynight: true },
  approach: { 'reference.airports': true, 'reference.routes': false, rings: true, centrelines: true, navaids: true, daynight: true },
  airfield: { 'reference.airports': false, 'reference.routes': false, rings: false, centrelines: false, navaids: true, daynight: false },
  ramp: { 'reference.airports': false, 'reference.routes': false, rings: false, centrelines: false, navaids: false, daynight: false },
});
const NO_REFERENCES = Object.freeze(Object.fromEntries(REFERENCE_KEYS.map(key => [key, false])));
const WEATHER_KEYS = ['weather.goes', 'weather.imerg', 'weather.wind'];
// The weather of each view (design E7): the satellite images off everywhere until a person turns them on, the wind at
// the airfield in Aproximación and Aeródromo.
const WEATHER_DEFAULTS = Object.freeze({
  region: { 'weather.goes': false, 'weather.imerg': false, 'weather.wind': false },
  approach: { 'weather.goes': false, 'weather.imerg': false, 'weather.wind': true },
  airfield: { 'weather.goes': false, 'weather.imerg': false, 'weather.wind': true },
  ramp: { 'weather.goes': false, 'weather.imerg': false, 'weather.wind': false },
});
const NO_WEATHER = Object.freeze(Object.fromEntries(WEATHER_KEYS.map(key => [key, false])));

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
    expect(LAYER_GROUPS[0]).toEqual({ id: 'traffic', keys: TRAFFIC_KEYS });
    expect(LAYER_KEYS.slice(0, TRAFFIC_KEYS.length)).toEqual(TRAFFIC_KEYS);
    expect(LOCKED_LAYERS).toEqual(['traffic.aviam']);
    expect(LAYERS_STORAGE_KEY).toBe('elevant-occ-map-layers:v1');
    for (const view of VIEW_NAMES) {
      expect(LAYER_DEFAULTS[view], view).toMatchObject({
        'traffic.aviam': true, 'traffic.other': true, 'traffic.labels': false, 'traffic.trails': false, route: true,
        // The airports from the Región and Aproximación views; closer in, the airfield is on screen.
        'reference.airports': view === 'region' || view === 'approach',
        // The routes from Punta Cana (AeroDataBox) in the Región view only.
        'reference.routes': view === 'region',
      });
    }
    // Before the map knows its view, a key is on only when every view has it on: the traffic keys of every view, and
    // none of the references, which no view shows all of.
    expect(resolveLayers(null, {})).toEqual({
      'traffic.aviam': true, 'traffic.other': true, 'traffic.labels': false, 'traffic.trails': false, route: true,
      ...NO_REFERENCES, ...NO_WEATHER,
    });
  });

  it('the Referencias group follows Tráfico with the defaults of design E7', () => {
    expect(LAYER_GROUPS.map(group => group.id)).toEqual(['traffic', 'reference', 'weather']);
    expect(LAYER_GROUPS[1].keys).toEqual(REFERENCE_KEYS);
    expect(LAYER_KEYS).toEqual([...TRAFFIC_KEYS, ...REFERENCE_KEYS, ...WEATHER_KEYS]);
    // The FIR waits for an extract of its boundary: no key without one.
    expect(LAYER_KEYS).not.toContain('fir');
    for (const view of VIEW_NAMES) {
      const defaults = Object.fromEntries(REFERENCE_KEYS.map(key => [key, LAYER_DEFAULTS[view][key]]));
      expect(defaults, view).toEqual(REFERENCE_DEFAULTS[view]);
    }
    // None of them is locked: each can be turned off, and a choice is kept as a difference from the view on screen.
    expect(REFERENCE_KEYS.filter(key => LOCKED_LAYERS.includes(key))).toEqual([]);
    expect(setLayerOverride({}, 'region', 'rings', false)).toEqual({ rings: false });
    expect(setLayerOverride({}, 'ramp', 'rings', true)).toEqual({ rings: true });
    expect(setLayerOverride({ rings: false }, 'region', 'rings', true)).toEqual({});
    expect(resolveLayers('approach', { navaids: false })).toMatchObject({ ...REFERENCE_DEFAULTS.approach, navaids: false });
    // Each key is a group of the map of its own: what the menu shows, the map shows.
    expect(engineGroupsFor(resolveLayers('approach', { 'reference.airports': false }))).toMatchObject({
      'reference.airports': false, rings: true, centrelines: true, navaids: true, daynight: true,
    });
    expect(engineGroupsFor(resolveLayers('ramp', {}))).toMatchObject(NO_REFERENCES);
    expect(engineGroupsFor({})).toMatchObject(NO_REFERENCES);
  });

  it('the Meteorología group follows Referencias with the defaults of design E7', () => {
    expect(LAYER_GROUPS[2]).toEqual({ id: 'weather', keys: WEATHER_KEYS });
    for (const view of VIEW_NAMES) {
      const defaults = Object.fromEntries(WEATHER_KEYS.map(key => [key, LAYER_DEFAULTS[view][key]]));
      expect(defaults, view).toEqual(WEATHER_DEFAULTS[view]);
    }
    // None is locked: the satellite images are a person's choice, kept as a difference from the view on screen.
    expect(WEATHER_KEYS.filter(key => LOCKED_LAYERS.includes(key))).toEqual([]);
    expect(setLayerOverride({}, 'region', 'weather.goes', true)).toEqual({ 'weather.goes': true });
    expect(setLayerOverride({}, 'approach', 'weather.wind', false)).toEqual({ 'weather.wind': false });
    expect(setLayerOverride({ 'weather.wind': false }, 'airfield', 'weather.wind', true)).toEqual({});
    expect(readLayerOverrides(memoryStorage({ [LAYERS_STORAGE_KEY]: '{"weather.imerg":true}' }))).toEqual({ 'weather.imerg': true });
    // Each key is a group of the map of its own (OccMap also keeps a satellite image hidden until it is pinned).
    expect(engineGroupsFor(resolveLayers('region', { 'weather.goes': true }))).toMatchObject({
      'weather.goes': true, 'weather.imerg': false, 'weather.wind': false,
    });
    expect(engineGroupsFor(resolveLayers('airfield', {}))).toMatchObject(WEATHER_DEFAULTS.airfield);
    expect(engineGroupsFor({})).toMatchObject(NO_WEATHER);
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
      ...REFERENCE_DEFAULTS.airfield, ...WEATHER_DEFAULTS.airfield,
    });

    // What the map shows: the tags and the trails of all the traffic follow «Otro tráfico».
    expect(engineGroupsFor(resolveLayers('region', { 'traffic.labels': true, 'traffic.trails': true }))).toEqual({
      'traffic.aviam': true, 'traffic.other': true, 'traffic.labels': true, 'traffic.trails': true, route: true,
      ...REFERENCE_DEFAULTS.region, ...WEATHER_DEFAULTS.region,
    });
    expect(engineGroupsFor(resolveLayers('region', { 'traffic.other': false, 'traffic.labels': true, 'traffic.trails': true,
      route: false, 'reference.airports': false }))).toEqual({
      'traffic.aviam': true, 'traffic.other': false, 'traffic.labels': false, 'traffic.trails': false, route: false,
      ...REFERENCE_DEFAULTS.region, 'reference.airports': false, ...WEATHER_DEFAULTS.region,
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
    expect(readLayerOverrides(memoryStorage({ [LAYERS_STORAGE_KEY]: '{"fir":true,"route":"no","traffic.trails":true}' })))
      .toEqual({ 'traffic.trails': true });
    expect(setLayerOverride({}, 'region', 'weather.radar', true)).toEqual({});
    // A storage that refuses every call, or none at all, reads nothing and writes nothing, without throwing.
    const refusing = memoryStorage({}, { refuse: true });
    expect(readLayerOverrides(refusing)).toEqual({});
    expect(() => writeLayerOverrides(refusing, { route: false })).not.toThrow();
    expect(readLayerOverrides(undefined)).toEqual({});
    expect(() => writeLayerOverrides(undefined, { route: false })).not.toThrow();
  });

  it('offers only the keys whose layers the map has', () => {
    const DRAWN_REFERENCES = REFERENCE_KEYS.filter(key => key !== 'reference.routes');
    expect(availableLayerKeys(buildOccStyle({ overlays: [trafficOverlay()] }))).toEqual(TRAFFIC_KEYS);
    expect(availableLayerKeys(buildOccStyle({ overlays: [referenceOverlay()] }))).toEqual(DRAWN_REFERENCES);
    // A map without traffic draws no region's airports.
    expect(availableLayerKeys(buildOccStyle({ overlays: [referenceOverlay({ airports: false })] })))
      .toEqual(DRAWN_REFERENCES.filter(key => key !== 'reference.airports'));
    expect(availableLayerKeys(buildOccStyle({ overlays: [trafficOverlay(), referenceOverlay(), routesOverlay()] })))
      .toEqual([...TRAFFIC_KEYS, ...REFERENCE_KEYS]);
    expect(availableLayerKeys(buildOccStyle({ overlays: [weatherOverlay()] }))).toEqual(WEATHER_KEYS);
    expect(availableLayerKeys(buildOccStyle({
      overlays: [trafficOverlay(), referenceOverlay(), routesOverlay(), weatherOverlay()],
    }))).toEqual(LAYER_KEYS);
    expect(availableLayerKeys(buildOccStyle({ overlays: [] }))).toEqual([]);
    expect(availableLayerKeys(null)).toEqual([]);
  });
});
