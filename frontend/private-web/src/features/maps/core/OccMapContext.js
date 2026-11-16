import { createContext, useContext } from 'react';

// What OccMap shares with its DOM overlays and with the panels around it, so a list or a switcher needs no ref:
// - state: `engineStatus` ('starting' | 'ready' | 'unavailable'), `basemapStatus` ('off' | 'loading' | 'ok' |
//   'degraded'), `activeView` (the view the camera really shows, from presetForZoom), `fits` and `thresholds`;
// - meta: `standsOnScreen`, the stands whose polygon the map draws in the area the insets leave in sight (from the
//   polygon threshold on; the legend lists their states, signals and tags), `chipsOnScreen`, the terminals whose chip
//   it draws there (below that threshold), `standMarksOnScreen`, the stand marks it draws there (`chipArriving`, the
//   arrow over the chip of a terminal with a stand in «Llegando»; `footprint` and `footprintPlanned`, the aircraft of a
//   stand to scale, on it or still to come, and `progress`, the progress bar of a turnaround (PR M6); `combined`, the
//   link of a cancelled stand; `narrowbody`, the code-C box of a stand limited to narrow-body aircraft; `sameAgent` or
//   `sameAgentHover`, the ring of the stands covered by the agent of the selected stand or of the one under the
//   pointer, whichever it follows; `ghost` and `pending`, the boxes of a stand being placed),
//   `flightsOnScreen`, the flights drawn in that area (the list changes when other flights come into sight, not when
//   they move inside it), and `airfieldOnScreen`, the airfield items the map draws there (`runway`, `taxiway`,
//   `holdBar`, `apron`, `terminal`, in that order);
// - actions: `requestView(view, { terminal })` flies and writes `view=` in the URL, `flyToPreset(view, { terminal })`
//   only flies, `flyToStand(code, { minZoom })` centres a stand and `flyToFlight(id, { minZoom })` a flight.
// - traffic (PR M5): `trafficOnScreen`, the aircraft kinds, tags, trails and parts of the chosen flight's route drawn in
//   that area (traffic/trafficFeatures.js: trafficOnScreen), and `trafficSource`, the air picture's source while traffic
//   is on screen (`{ name, homeUrl, licenseName, licenseUrl }` or null), whose credit the map shows.
// - layers menu (PR M5, core/layersMenu.js): `layers` (`{ keys, values }`: the keys the map can show and whether each is
//   on now), `setLayer(key, on)`, `layersMenuOpen`, `setLayersMenuOpen(open)` and `registerLayersMenu()`, which a menu
//   on screen calls (it returns the call that unregisters it): the L key opens a menu only while one is registered.
// - motion (PR M6, core/frameLoop.js): `motion` is `{ available, paused, pausedAt, dataAt, pause(), resume() }`: whether
//   the map moves its traffic, whether «Pausar movimiento» holds it and at which instant, the server instant of the
//   newest data the map draws, and the two actions (ui/MapMotionControl.jsx).
// - follow mode (PR M6, design A6): `follow` is `{ available, following, canFollow, toggle() }`: whether the map can
//   follow (it moves its traffic), whether it follows now (`follow=1`), whether the selection names an aircraft it
//   draws, and the action of the S key (ui/MapFollowButton.jsx, the data block's «Seguir»).
// Outside an OccMap the value is a map that does nothing and shows nothing.

const doNothing = () => {};

export const OCC_MAP_IDLE = Object.freeze({
  engineStatus: 'starting',
  basemapStatus: 'off',
  activeView: null,
  fits: null,
  thresholds: null,
  standsOnScreen: Object.freeze([]),
  chipsOnScreen: Object.freeze([]),
  standMarksOnScreen: Object.freeze([]),
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
  motion: Object.freeze({ available: false, paused: false, pausedAt: null, dataAt: null, pause: doNothing, resume: doNothing }),
  follow: Object.freeze({ available: false, following: false, canFollow: false, toggle: doNothing }),
});

export const OccMapContext = createContext(OCC_MAP_IDLE);

export function useOccMap() {
  return useContext(OccMapContext);
}
