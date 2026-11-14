import { createContext, useContext } from 'react';

// What OccMap shares with its DOM overlays and with the panels around it, so a list or a switcher needs no ref:
// - state: `engineStatus` ('starting' | 'ready' | 'unavailable'), `basemapStatus` ('off' | 'loading' | 'ok' |
//   'degraded'), `activeView` (the view the camera really shows, from presetForZoom), `fits` and `thresholds`;
// - meta: `standsOnScreen`, the stands drawn one by one in the area the insets leave in sight (the legend lists only
//   those; while the map gathers stands into clusters, the ones it still draws on their own), `standsGrouped`,
//   whether a cluster of stands is drawn there, `flightsOnScreen`, the flights drawn in that area (the list
//   changes when other flights come into sight, not when they move inside it), and `airfieldOnScreen`, the airfield
//   items the map draws there (`runway`, `taxiway`, `holdBar`, `apron`, `terminal`, in that order);
// - actions: `requestView(view, { terminal })` flies and writes `view=` in the URL, `flyToPreset(view, { terminal })`
//   only flies, `flyToStand(code, { minZoom })` centres a stand and `flyToFlight(id, { minZoom })` a flight.
// - traffic (PR M5): `trafficOnScreen`, the aircraft kinds, tags, trails and parts of the chosen flight's route drawn in
//   that area (traffic/trafficFeatures.js: trafficOnScreen), and `trafficSource`, the air picture's source while traffic
//   is on screen (`{ name, homeUrl, licenseName, licenseUrl }` or null), whose credit the map shows.
// - layers menu (PR M5, core/layersMenu.js): `layers` (`{ keys, values }`: the keys the map can show and whether each is
//   on now), `setLayer(key, on)`, `layersMenuOpen`, `setLayersMenuOpen(open)` and `registerLayersMenu()`, which a menu
//   on screen calls (it returns the call that unregisters it): the L key opens a menu only while one is registered.
// Outside an OccMap the value is a map that does nothing and shows nothing.

const doNothing = () => {};

export const OCC_MAP_IDLE = Object.freeze({
  engineStatus: 'starting',
  basemapStatus: 'off',
  activeView: null,
  fits: null,
  thresholds: null,
  standsOnScreen: Object.freeze([]),
  standsGrouped: false,
  flightsOnScreen: Object.freeze([]),
  airfieldOnScreen: Object.freeze([]),
  requestView: doNothing,
  flyToPreset: doNothing,
  flyToStand: doNothing,
  flyToFlight: doNothing,
  trafficOnScreen: Object.freeze({ kinds: Object.freeze([]), tags: Object.freeze([]), trails: Object.freeze([]),
    route: Object.freeze([]) }),
  trafficSource: null,
  layers: Object.freeze({ keys: Object.freeze([]), values: Object.freeze({}) }),
  setLayer: doNothing,
  layersMenuOpen: false,
  setLayersMenuOpen: doNothing,
  registerLayersMenu: () => doNothing,
});

export const OccMapContext = createContext(OCC_MAP_IDLE);

export function useOccMap() {
  return useContext(OccMapContext);
}
