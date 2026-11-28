import { MAP_VIEWS, VIEW_NAMES } from './cameraPresets';

// The layers menu of the OCC maps (design E7, PR M5): the keys a person can show or hide, grouped as the menu lists
// them, their defaults by view, and the choices kept in the browser. Only what the person changed from the defaults of
// the view on screen is stored (`localStorage`, LAYERS_STORAGE_KEY), so a new default reaches everyone who never
// touched that key. Pure: OccMap holds the choices and ui/MapLayersMenu.jsx draws them.
//
// M5 ships the «Tráfico» group. «Referencias» holds the region's airports and the routes from Punta Cana, and PR M8
// adds to it the rings, the centrelines, the navaids and day and night (the FIR
// waits for an extract of its boundary) and «Meteorología» (the satellite clouds and rain, off by default, and the wind
// at the airfield), and PR M6 the ramp keys: each adds its group here, its defaults in ON_IN and, when its keys depend
// on another, a line in engineGroupsFor.

/** The groups of the menu and their keys, in the order the menu lists them. */
export const LAYER_GROUPS = Object.freeze([
  Object.freeze({
    id: 'traffic',
    keys: Object.freeze(['traffic.aviam', 'traffic.other', 'traffic.labels', 'traffic.trails', 'route', 'traffic.routes']),
  }),
  // The references (design E6, style/referenceLayers.js): the region's airports (owner request of 2026-11-15), the
  // routes from Punta Cana (AeroDataBox's daily routes, ADR-0043 note of 15 November 2026, style/routeLayers.js) and,
  // from PR M8, the range rings, the extended centrelines, the navaids and day and night.
  Object.freeze({
    id: 'reference',
    keys: Object.freeze(['reference.airports', 'reference.routes', 'rings', 'centrelines', 'navaids', 'daynight']),
  }),
  // The weather of PR M8 (design E6, traffic/weatherLayers.js): the satellite images and the wind at the airfield.
  Object.freeze({
    id: 'weather',
    keys: Object.freeze(['weather.goes', 'weather.imerg', 'weather.wind']),
  }),
]);

/** Every key of the menu, in its order. */
export const LAYER_KEYS = Object.freeze(LAYER_GROUPS.flatMap(group => group.keys));

/** Keys that are always on: the menu shows them checked and disabled («Siempre visible»). */
export const LOCKED_LAYERS = Object.freeze(['traffic.aviam']);

/** Where the choices of a browser are kept. */
export const LAYERS_STORAGE_KEY = 'elevant-occ-map-layers:v1';

// The views in which each key is on until a person changes it («Default on in» of design E7).
// The world view of M8 (Monitoreo's globe) shows the traffic, the chosen route, the airports, the routes from Punta Cana
// and day and night; the rings, the centrelines and the navaids are too small to read from there.
const ON_IN = Object.freeze({
  'traffic.aviam': MAP_VIEWS,
  'traffic.other': MAP_VIEWS,
  'traffic.labels': Object.freeze([]),
  'traffic.trails': Object.freeze([]),
  route: MAP_VIEWS,
  // The great circles of every AVIAM flight (M8, style/flightRouteLayers.js: only Monitoreo's globe has them), from afar.
  'traffic.routes': Object.freeze(['world', 'region']),
  'reference.airports': Object.freeze(['world', 'region', 'approach']),
  'reference.routes': Object.freeze(['world', 'region']),
  rings: Object.freeze(['region', 'approach']),
  centrelines: Object.freeze(['approach']),
  navaids: Object.freeze(['approach', 'airfield']),
  daynight: Object.freeze(['world', 'region', 'approach']),
  // The satellite images are off until a person turns them on; the wind shows in Aproximación and Aeródromo.
  'weather.goes': Object.freeze([]),
  'weather.imerg': Object.freeze([]),
  'weather.wind': Object.freeze(['approach', 'airfield']),
});

/**
 * Whether `key` is on by default while the map shows `preset` (a view of core/cameraPresets.js, the world of M8
 * included). Before the map knows its view (no preset), a key is on only when each of the four views has it on.
 */
export function layerDefault(preset, key) {
  if (LOCKED_LAYERS.includes(key)) return true;
  const views = ON_IN[key] ?? [];
  return MAP_VIEWS.includes(preset) ? views.includes(preset) : VIEW_NAMES.every(view => views.includes(view));
}

/** The defaults of each view: `{ [view]: { [key]: boolean } }`. */
export const LAYER_DEFAULTS = Object.freeze(Object.fromEntries(MAP_VIEWS.map(view => [view,
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
    'traffic.routes': on('traffic.routes'),
    // The references: each key is its own group.
    'reference.airports': on('reference.airports'),
    'reference.routes': on('reference.routes'),
    rings: on('rings'),
    centrelines: on('centrelines'),
    navaids: on('navaids'),
    daynight: on('daynight'),
    // The weather (PR M8): each key is its own group. OccMap also keeps a satellite image hidden until it knows the time
    // of the image, so the map never asks for an image that is not pinned to it.
    'weather.goes': on('weather.goes'),
    'weather.imerg': on('weather.imerg'),
    'weather.wind': on('weather.wind'),
  });
}

/** The keys of the menu a map can show: those whose group has layers in its style (buildOccStyle). */
export function availableLayerKeys(style) {
  const groups = new Set((style?.layers ?? []).map(layer => layer?.metadata?.['occ:group']).filter(Boolean));
  return Object.freeze(LAYER_KEYS.filter(key => groups.has(key)));
}
