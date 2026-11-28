import { createContext, useContext } from 'react';
import { VIEW_NAMES } from './cameraPresets';

// What OccMap shares with its DOM overlays and with the panels around it, so a list or a switcher needs no ref:
// - state: `engineStatus` ('starting' | 'ready' | 'unavailable'), `basemapStatus` ('off' | 'loading' | 'ok' |
//   'degraded'), `activeView` (the view the camera really shows, from presetForZoom), `fits` and `thresholds`, and
//   `views`, the views the map offers (the four, the world first on a map with the globe, M8, or fewer on a map fixed on
//   the airport, M9), which the switcher shows;
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
//   `taxiwayPavement`, `holdBar`, `apron`, `terminal`, `building`, `jetBridge`, in that order);
// - actions: `requestView(view, { terminal })` flies and writes `view=` in the URL, `flyToPreset(view, { terminal })`
//   only flies, `flyToStand(code, { minZoom })` centres a stand and `flyToFlight(id, { minZoom })` a flight.
// - traffic (PR M5): `trafficOnScreen`, the aircraft kinds, tags, trails and parts of the chosen flight's route drawn in
//   that area (traffic/trafficFeatures.js: trafficOnScreen), and `trafficSource`, the air picture's source while traffic
//   is on screen (`{ name, homeUrl, licenseName, licenseUrl }` or null), whose credit the map shows.
// - references (PR M8): `referencesOnScreen`, the references drawn in that area, read back from the map
//   (traffic/referenceFeatures.js: referencesOnScreen): `{ kinds, runway }`, the legend kinds on screen (`rings`,
//   `centrelines`, `runwayInUse`, `airports`, `counterparts`, `vor`, `ndb`, `night`, in that order) and the runway in
//   use its emphasised centreline says (`{ arrival, source }` or null). On a map with the weather, the kinds go on with
//   the weather drawn there (traffic/weatherLayers.js: weatherOnScreen; `wind` or `windStale`, `goes`, `imerg`) and
//   `imagery` holds the time of each satellite image on screen (`{ goes: { time, precision } }`).
// - layers menu (PR M5, core/layersMenu.js): `layers` (`{ keys, values, notes }`: the keys the map can show, whether each
//   is on now and, from PR M8, what a weather key that is on says when the map shows nothing of it), `setLayer(key,
//   on)`, `layersMenuOpen`, `setLayersMenuOpen(open)` and `registerLayersMenu()`, which a menu on screen calls (it
//   returns the call that unregisters it): the L key opens a menu only while one is registered.
// - layers menu (PR M5, core/layersMenu.js): `layers` (`{ keys, values }`: the keys the map can show and whether each is
//   on now), `setLayer(key, on)`, `layersMenuOpen`, `setLayersMenuOpen(open)` and `registerLayersMenu()`, which a menu
//   on screen calls (it returns the call that unregisters it): the L key opens a menu only while one is registered.
// - motion (PR M6, core/frameLoop.js): `motion` is `{ available, paused, pausedAt, dataAt, pause(), resume() }`: whether
//   the map moves its traffic, whether «Pausar movimiento» holds it and at which instant, the server instant of the
//   newest data the map draws, and the two actions (ui/MapMotionControl.jsx).
// - follow mode (PR M6, design A6): `follow` is `{ available, following, canFollow, toggle() }`: whether the map can
//   follow (it moves its traffic), whether it follows now (`follow=1`), whether the selection names an aircraft it
//   draws, and the action of the S key (ui/MapFollowButton.jsx, the data block's «Seguir»). CN-30: `follow.three` is
//   «Seguir en 3D»: `{ on, view, auto, subject, start(), stop(), setView(view), rotate(sign), tilt(sign), zoom(sign),
//   hold(kind, sign), reset(), setAuto(on), startOn(target), parkedAt(code) }`, `subject` a store of the followed
//   aircraft as the frames draw it (the panel's, ui/Follow3dPanel.jsx); outside an OccMap there is none. M4:
//   `startOn({ kind, id })` starts it on the aircraft a click on it would select, choosing it first when it is not the
//   selection (a double click on the map, a stand's inspector), and answers whether the map can follow it;
//   `parkedAt(code)` is the selection of the traffic aircraft parked on that stand, or null.
// - board filter (M8, OccMap's `flightEmphasis`): `boardFilter`, whether the filter of Monitoreo's board dims AVIAM
//   aircraft on the map, for the legend.
// - runway in use (2026-11-28): `runwayInUse`, the runway the map draws in use (`{ arrival, departure, source }`, from
//   traffic/referenceFeatures.js: mapRunwayInUse with the recent live arrivals it saw and the weather it was given),
//   whether or not its centreline is on screen, so a panel over the map names the same runway; null outside an OccMap.
// Outside an OccMap the value is a map that does nothing and shows nothing.

const doNothing = () => {};

export const OCC_MAP_IDLE = Object.freeze({
  engineStatus: 'starting',
  basemapStatus: 'off',
  activeView: null,
  views: VIEW_NAMES,
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
  referencesOnScreen: Object.freeze({ kinds: Object.freeze([]), runway: null }),
  runwayInUse: null,
  layers: Object.freeze({ keys: Object.freeze([]), values: Object.freeze({}), notes: Object.freeze({}) }),
  setLayer: doNothing,
  layersMenuOpen: false,
  setLayersMenuOpen: doNothing,
  registerLayersMenu: () => doNothing,
  motion: Object.freeze({ available: false, paused: false, pausedAt: null, dataAt: null, pause: doNothing, resume: doNothing }),
  follow: Object.freeze({ available: false, following: false, canFollow: false, toggle: doNothing }),
  boardFilter: false,
});

export const OccMapContext = createContext(OCC_MAP_IDLE);

export function useOccMap() {
  return useContext(OccMapContext);
}
