import { VIEW_NAMES } from './cameraPresets';

// The layers menu of the OCC maps (design E7, PR M5): the keys a person can show or hide, grouped as the menu lists
// them, their defaults by view, and the choices kept in the browser. Only what the person changed from the defaults of
// the view on screen is stored (`localStorage`, LAYERS_STORAGE_KEY), so a new default reaches everyone who never
// touched that key. Pure: OccMap holds the choices and ui/MapLayersMenu.jsx draws them.
//
// M5 ships the «Tráfico» group alone. The reference overlays (rings, centrelines, airports, FIR, navaids, day and
// night) and the weather come with PR M8 and the ramp keys with PR M6: each adds its group here, its defaults in
// ON_IN and, when its keys depend on another, a line in engineGroupsFor.

/** The groups of the menu and their keys, in the order the menu lists them. */
export const LAYER_GROUPS = Object.freeze([
  Object.freeze({
    id: 'traffic',
    keys: Object.freeze(['traffic.aviam', 'traffic.other', 'traffic.labels', 'traffic.trails', 'route']),
  }),
]);

/** Every key of the menu, in its order. */
export const LAYER_KEYS = Object.freeze(LAYER_GROUPS.flatMap(group => group.keys));

/** Keys that are always on: the menu shows them checked and disabled («Siempre visible»). */
export const LOCKED_LAYERS = Object.freeze(['traffic.aviam']);

/** Where the choices of a browser are kept. */
export const LAYERS_STORAGE_KEY = 'elevant-occ-map-layers:v1';

// The views in which each key is on until a person changes it («Default on in» of design E7).
const ON_IN = Object.freeze({
  'traffic.aviam': VIEW_NAMES,
  'traffic.other': VIEW_NAMES,
  'traffic.labels': Object.freeze([]),
  'traffic.trails': Object.freeze([]),
  route: VIEW_NAMES,
});

/**
 * Whether `key` is on by default while the map shows `preset` (a view of core/cameraPresets.js). Before the map knows
 * its view (no preset), a key is on only when every view has it on.
 */
export function layerDefault(preset, key) {
  if (LOCKED_LAYERS.includes(key)) return true;
  const views = ON_IN[key] ?? [];
  return VIEW_NAMES.includes(preset) ? views.includes(preset) : VIEW_NAMES.every(view => views.includes(view));
}

/** The defaults of each view: `{ [view]: { [key]: boolean } }`. */
export const LAYER_DEFAULTS = Object.freeze(Object.fromEntries(VIEW_NAMES.map(view => [view,
  Object.freeze(Object.fromEntries(LAYER_KEYS.map(key => [key, layerDefault(view, key)])))])));

const isOverride = ([key, value]) => LAYER_KEYS.includes(key) && !LOCKED_LAYERS.includes(key) && typeof value === 'boolean';

/** Only what the menu can store: known keys that are not locked, with a boolean. Anything else is dropped. */
export function cleanOverrides(overrides) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(overrides).filter(isOverride)));
}

/**
 * What the map shows while it frames `preset`: `{ [key]: boolean }` for every key of the menu. A locked key is
 * always on; any other is the person's choice when there is one, else the view's default.
 */
export function resolveLayers(preset, overrides = {}) {
  const chosen = cleanOverrides(overrides);
  return Object.freeze(Object.fromEntries(LAYER_KEYS.map(key => [key,
    Object.hasOwn(chosen, key) ? chosen[key] : layerDefault(preset, key)])));
}

/**
 * The choices after the person turns `key` on or off while the map frames `preset`: a value that differs from that
 * view's default is stored; going back to the default removes the entry. A locked key or an unknown one changes
 * nothing (the same object comes back).
 */
export function setLayerOverride(overrides, preset, key, on) {
  if (!LAYER_KEYS.includes(key) || LOCKED_LAYERS.includes(key)) return overrides;
  const next = { ...cleanOverrides(overrides) };
  if (Boolean(on) === layerDefault(preset, key)) delete next[key];
  else next[key] = Boolean(on);
  return Object.freeze(next);
}

/** The choices kept in `storage` (a Storage): bad JSON, a storage that refuses to answer and unknown keys are ignored. */
export function readLayerOverrides(storage) {
  try {
    const text = storage?.getItem(LAYERS_STORAGE_KEY);
    return typeof text === 'string' ? cleanOverrides(JSON.parse(text)) : cleanOverrides(null);
  } catch {
    return cleanOverrides(null);
  }
}

/** Keeps the choices in `storage`; nothing to keep removes the entry. A storage that refuses to write is ignored. */
export function writeLayerOverrides(storage, overrides) {
  const clean = cleanOverrides(overrides);
  try {
    if (Object.keys(clean).length === 0) storage?.removeItem(LAYERS_STORAGE_KEY);
    else storage?.setItem(LAYERS_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(clean).sort())));
  } catch {
    // Private windows and full storage: the choice still applies until the page closes.
  }
}

/**
 * The visibility of the map's layer groups (core/mapEngine.js: setGroupVisibility, traffic/trafficLayers.js:
 * TRAFFIC_GROUPS) for the resolved keys: each key is a group of its own, and the labels and the trails of all the
 * traffic follow «Otro tráfico» too, so hiding the other traffic hides its tags and trails with it.
 */
export function engineGroupsFor(resolved) {
  const on = key => resolved?.[key] === true;
  return Object.freeze({
    'traffic.aviam': true,
    'traffic.other': on('traffic.other'),
    'traffic.labels': on('traffic.labels') && on('traffic.other'),
    'traffic.trails': on('traffic.trails') && on('traffic.other'),
    route: on('route'),
  });
}

/** The keys of the menu a map can show: those whose group has layers in its style (buildOccStyle). */
export function availableLayerKeys(style) {
  const groups = new Set((style?.layers ?? []).map(layer => layer?.metadata?.['occ:group']).filter(Boolean));
  return Object.freeze(LAYER_KEYS.filter(key => groups.has(key)));
}
