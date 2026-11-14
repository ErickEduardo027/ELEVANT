'use client';

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from 'react';
import * as maplibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../../styles/occ-map.css';
import { useTranslation } from '../../../i18n/LanguageScope';
import { createOccShortcutHandler } from '../../occ-ui/occShortcuts';
import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { airfieldFeatures } from '../airport/airfieldFeatures';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { mapMessages } from '../mapMessages';
import { toStandFeatures } from '../stands/standFeatures';
import {
  STAND_DRAWN_LAYERS, STAND_SOURCE, drawnStands, standClusterOptions, standDisplayAt, standOverlay,
} from '../stands/standLayers';
import {
  AIRFIELD_LAYER_IDS, AIRFIELD_SOURCE, airfieldKindsOnScreen, airfieldOverlay, airfieldTooltip,
} from '../style/airfieldLayers';
import { createImageResolver } from '../style/mapImages';
import { buildOccStyle } from '../style/occStyle';
import { REFERENCE_SOURCE, referenceFeatures, referenceOverlay } from '../style/referenceLayers';
import { SELECTION_SOURCE, selectionFeatures, selectionOverlay } from '../style/selectionLayers';
import { FLIGHT_SOURCE, flightOverlay, flightsInView, toFlightFeatures } from '../traffic/flightLayers';
import { trailsBesideRoute } from '../traffic/routeFeatures';
import {
  ROUTE_SOURCE, TRAFFIC_SOURCE, TRAILS_SOURCE, featuresById, isEmptyDiff, onScreenKey, selectedAircraftId, trafficDiff,
  trafficFeatures, trafficOnScreen as trafficOnScreenOf,
} from '../traffic/trafficFeatures';
import { trafficOverlay } from '../traffic/trafficLayers';
import MapTooltip from '../ui/MapTooltip';
import { buildAttribution } from './attribution';
import {
  VIEW_NAMES, boundsCenter, cameraAngles, fitZooms, isInBounds, isRetired, lngLatOf, presetForZoom, presetTargets,
  sameFits, standCodeOf, standsInView, targetFor, thresholdsFromFits, transitionFor, unionBounds,
} from './cameraPresets';
import {
  availableLayerKeys, engineGroupsFor, readLayerOverrides, resolveLayers, setLayerOverride, writeLayerOverrides,
} from './layersMenu';
import { createMapEngine } from './mapEngine';
import { matchFlight } from './mapSelection';
import MapUnavailable from './MapUnavailable';
import { OccMapContext } from './OccMapContext';
import { useMapSelection } from './useMapSelection';

// The one map component of the OCC (design A4). Client only: the pages load it through next/dynamic with ssr false.
// It owns one engine (core/mapEngine.js) for its whole life, the four views of contracts 2.3 with thresholds derived
// from the fitted zooms, the selection casing, the map keys of contracts 2.2 and the fallback list. DOM overlays come
// as children and reach the map through OccMapContext. It always draws the references (the ARP of PUJ) and, from the
// derived airfield threshold, the airfield of its airport layout (PR M3: the MDPC dataset unless `layout` says
// otherwise), whose box and stand polygons also frame the airport views; a runway or a taxiway under the pointer shows
// the map tooltip, and a click holds it. Given `stands` it draws them as points in the stands slot, and given `flights`
// it draws those with a position. Their overlays are part of the style from the start, so new data is one setData and
// the map is never re-created; a screen's own overlays get their data the same way, through `overlayData`.

const EMPTY = Object.freeze([]);
const NO_GROUPS = Object.freeze({});
const INSET_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);
const SELECTABLE_KINDS = new Set(['stand', 'flight', 'aircraft']);
// What takes the pointer cursor: what can be selected, a cluster to open, and a runway or a taxiway with its tooltip.
const POINTER_KINDS = new Set([...SELECTABLE_KINDS, 'cluster', 'runway', 'taxiway']);
const PITCH_EASE_MS = 600;
const NORTH_EASE_MS = 400;
const BOUNDS_PADDING_PX = 70;
// flyToStand comes this close unless the caller asks for more: a step past the ramp fit, derived like the thresholds.
const STAND_FOCUS_OVER_RAMP = 1.5;

function normalizeInsets(insets) {
  return Object.fromEntries(INSET_SIDES.map(side => [side, Math.max(0, Number(insets?.[side]) || 0)]));
}

const insetsKey = insets => INSET_SIDES.map(side => insets[side]).join('|');
const insetsFromKey = key => Object.fromEntries(key.split('|').map((value, index) => [INSET_SIDES[index], Number(value)]));
const insetVariables = insets => Object.fromEntries(INSET_SIDES.map(side => [`--occ-map-inset-${side}`, `${insets[side]}px`]));
const addPadding = (insets, extra) => Object.fromEntries(INSET_SIDES.map(side => [side, insets[side] + extra]));
const viewKey = (view, terminal) => `${view}:${terminal ?? ''}`;
const standsKey = stands => stands
  .map(stand => `${standCodeOf(stand)}:${stand.status ?? ''}:${stand.locationSource ?? ''}`).join('|');
// The legend shows one entry for every drawn flight, so which flights are on screen is all that counts.
const flightsKey = flights => flights.map(flight => String(flight.id)).join('|');
// Thresholds for a map without the airfield overlay: the tile aeroway then keeps every zoom.
const withoutAirfield = ({ airfield, ...rest }) => rest;
// The traffic (PR M5): nothing on screen, an empty source, and the key of a traffic source's credit.
const NO_TRAFFIC_ON_SCREEN = Object.freeze({ kinds: EMPTY, tags: EMPTY, trails: EMPTY, route: EMPTY });
const EMPTY_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: EMPTY });
const creditKeyOf = source => (source && typeof source.name === 'string' && source.name.trim() !== ''
  ? JSON.stringify([source.name, source.homeUrl ?? null, source.licenseName ?? null, source.licenseUrl ?? null])
  : '');
// Where the layers menu keeps a browser's choices (core/layersMenu.js); a browser that refuses storage keeps none.
function layerStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Where the traffic draws the ELEVANT aircraft a flight id names (any id matchFlight reads), as `[lng, lat]`, or null.
function trafficPoint(traffic, id) {
  const aircraft = traffic?.aircraft ?? EMPTY;
  const chosen = selectedAircraftId(aircraft, { kind: 'flight', id });
  const item = chosen === null ? null : aircraft.find(entry => entry.id === chosen);
  return item ? [item.lon, item.lat] : null;
}

// Where the tooltip of the airfield sits: at the pixel it points at, on the side of the visible area's middle that has
// room for it, so the card stays inside the map.
function tooltipPlacement(engine, padding, point) {
  const bounds = engine.getVisibleBounds(padding);
  const middle = bounds === null ? null : engine.project(boundsCenter(bounds));
  return {
    x: point.x,
    y: point.y,
    alignX: middle !== null && point.x > middle.x ? 'end' : 'start',
    alignY: middle !== null && point.y > middle.y ? 'end' : 'start',
  };
}

const requestFrame = callback => (typeof globalThis.requestAnimationFrame === 'function'
  ? globalThis.requestAnimationFrame(callback)
  : globalThis.setTimeout(callback, 16));
const cancelFrame = handle => (typeof globalThis.cancelAnimationFrame === 'function'
  ? globalThis.cancelAnimationFrame(handle)
  : globalThis.clearTimeout(handle));

const initialSnapshot = basemap => ({
  engineStatus: 'starting',
  basemapStatus: basemap ? 'loading' : 'off',
  activeView: null,
  fits: null,
  thresholds: null,
  standsOnScreen: EMPTY,
  standsGrouped: false,
  flightsOnScreen: EMPTY,
  airfieldOnScreen: EMPTY,
  // The map tooltip of a runway or a taxiway: what it shows, where, and whether a click holds it.
  tooltip: null,
  // The traffic drawn in the area the insets leave in sight (PR M5): its kinds, tags and trails.
  trafficOnScreen: NO_TRAFFIC_ON_SCREEN,
  // The keys of the layers menu this map's style has layers for (PR M5, core/layersMenu.js).
  layerKeys: EMPTY,
});

// What the engine reports, kept outside React state: an engine event is not a render, and the component subscribes
// with useSyncExternalStore, so it renders only when a value it shows changes (never per frame).
function createViewStore(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    get: () => snapshot,
    set(patch) {
      const changed = Object.entries(patch).filter(([key, value]) => !Object.is(snapshot[key], value));
      if (changed.length === 0) return;
      snapshot = { ...snapshot, ...Object.fromEntries(changed) };
      listeners.forEach(listener => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The words MapLibre puts on its canvas and controls, in the screen's language.
function engineLocale(t, mapLabel) {
  return {
    'Map.Title': mapLabel ?? t('map.label'),
    'NavigationControl.ZoomIn': t('controls.zoomIn'),
    'NavigationControl.ZoomOut': t('controls.zoomOut'),
    'NavigationControl.ResetBearing': t('controls.resetBearing'),
    'AttributionControl.ToggleAttribution': t('controls.attribution'),
    'ScaleControl.NauticalMiles': t('controls.nauticalMiles'),
  };
}

function findStand(stands, code) {
  const wanted = mapStandCode(code);
  return stands.find(stand => stand != null && !isRetired(stand) && mapStandCode(standCodeOf(stand)) === wanted) ?? null;
}

/**
 * Props:
 * - `defaultView` ('ramp'), `layout` (the airport layout the map draws its airfield from and frames the airport views
 *   with: the MDPC dataset by default; `null` draws no airfield of its own, keeps the tile aeroway at every zoom and
 *   frames the views with the stand points; the airfield it draws is the one given at start, the views follow the
 *   prop), `presetStands` (the stands that frame the views without a layout; `stands` when absent), `stands` (the
 *   stands of the screen, with `status`; given at start, the map draws them, with `standLabels` 'default' or
 *   'dashboard'), `flights` (given at start, the map draws those with a position);
 * - `overlays` for buildOccStyle and `basemap`, `interactive` and `mapOptions` (extra MapLibre options, such as the
 *   map lab's `fadeDuration: 0`; the map keeps its own locale): read once, when the map starts, as are whether
 *   `stands` and `flights` are given and `standLabels`;
 * - `overlayData` (`{ [sourceId]: FeatureCollection }`): the data of the sources of `overlays`, one setData for each
 *   source whose features change, as for the stands and the flights;
 * - `selection` (`{ kind, id }` or null) and `onSelect({ kind, id } | null)`; `onPick(hit)` for a click on anything
 *   else a layer lets pick (`{ kind, id, feature }` as the engine answers it: not a stand, a flight, an aircraft, a
 *   cluster, a runway or a taxiway); `onMapClick({ latitude, longitude })` while `placing`; `initialCamera` and
 *   `onCameraChange(camera)`;
 * - `pitchMode` ('2d' | '3d'), `groups` ({ 'buildings-3d': true }), `insets` ({ top, right, bottom, left } in px);
 * - `testId` of the host that holds the canvas, `labels` ({ unavailableTitle, unavailableDescription,
 *   unavailableList, map }), `fallbackItems` ([{ id, label, kind }]) and `onFallbackSelect(id, item)`;
 * - `isShortcutBlocked()` (an open drawer that is not a modal dialog), `className`, `children` (DOM overlays).
 * - `traffic` (PR M5): `{ aircraft, trails, route, source }` from the map situation (useMapSituation: the aircraft of
 *   traffic/situationModel.js, the trails FeatureCollection, the chosen flight's route and the air picture's source).
 *   Whether it is given is read at start, as for the stands and the flights: the map then draws the traffic overlay,
 *   one updateData per change of the aircraft (a selection, the aircraft under the pointer and the shown groups
 *   included), lists the traffic on screen for the legend, and credits the source in the attribution while traffic
 *   is on screen. The chosen aircraft is drawn larger in cyan with the selection ring, both layers of the traffic
 *   overlay in the selection slot (traffic/trafficLayers.js), so they move in the aircraft's own updateData and the
 *   selection source keeps the stands and the flights; while its route shows, its trail gives way to the route's flown
 *   part.
 * - The layers menu (PR M5, core/layersMenu.js, ui/MapLayersMenu.jsx): the map keeps the person's choices (only what
 *   differs from the defaults of the view on screen, in `localStorage`) and shows or hides the groups they name, except
 *   a group the page sets in `groups`, which wins. The menu reads them from OccMapContext; L opens and closes a menu on
 *   screen and Esc closes an open one before it clears the selection.
 */
const OccMap = forwardRef(function OccMap({
  defaultView = 'ramp',
  layout = MDPC_LAYOUT,
  presetStands,
  stands: standsProp,
  standLabels = 'default',
  flights: flightsProp,
  traffic,
  overlays = EMPTY,
  overlayData,
  selection = null,
  onSelect,
  onPick,
  onMapClick,
  placing = false,
  initialCamera,
  onCameraChange,
  pitchMode = '2d',
  groups = NO_GROUPS,
  insets,
  interactive = true,
  basemap = true,
  mapOptions,
  testId = 'occ-map-host',
  labels,
  fallbackItems,
  onFallbackSelect,
  isShortcutBlocked,
  className = '',
  children,
}, ref) {
  const { t, language } = useTranslation(mapMessages);
  const { view: urlView, terminal: urlTerminal, setView } = useMapSelection();
  const [store] = useState(() => createViewStore(initialSnapshot(basemap)));
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  const stands = standsProp ?? EMPTY;
  const flights = flightsProp ?? EMPTY;

  const paddingKey = insetsKey(normalizeInsets(insets));
  const padding = useMemo(() => insetsFromKey(paddingKey), [paddingKey]);
  const referenceStands = presetStands ?? stands;
  const targets = useMemo(() => presetTargets({ stands: referenceStands, layout }), [referenceStands, layout]);
  const groupsKey = JSON.stringify(groups ?? NO_GROUPS);

  // The layers menu (PR M5, core/layersMenu.js): the person's choices, read from the browser once, resolved for the
  // view on screen. The groups they show join the page's own `groups`, which win for a group the page sets itself.
  const [layerOverrides, setLayerOverrides] = useState(() => readLayerOverrides(layerStorage()));
  const [layersMenuOpen, setLayersMenuOpenState] = useState(false);
  const layersMenusRef = useRef(0);
  const setLayersMenuOpen = useCallback(open => setLayersMenuOpenState(open === true), []);
  // A menu on screen registers itself: L opens one only while one is there, and the last one to go closes it.
  const registerLayersMenu = useCallback(() => {
    layersMenusRef.current += 1;
    return () => {
      layersMenusRef.current -= 1;
      if (layersMenusRef.current === 0) setLayersMenuOpenState(false);
    };
  }, []);
  const layerView = snapshot.activeView ?? defaultView;
  const resolvedLayers = useMemo(() => resolveLayers(layerView, layerOverrides), [layerView, layerOverrides]);
  const menuGroups = useMemo(() => engineGroupsFor(resolvedLayers), [resolvedLayers]);
  const menuGroupsKey = JSON.stringify(menuGroups);
  const shownGroups = useMemo(() => ({ ...JSON.parse(menuGroupsKey), ...JSON.parse(groupsKey) }),
    [menuGroupsKey, groupsKey]);
  const shownGroupsKey = JSON.stringify(shownGroups);
  // The trails and the chosen flight's route (PR M5): while the route shows, the chosen aircraft's trail gives way to
  // its flown part, so it is drawn once, in the selection's cyan.
  const trafficTrails = traffic?.trails ?? null;
  const trafficRoute = traffic?.route ?? null;
  const routeShown = shownGroups.route !== false;
  const shownTrails = useMemo(() => (routeShown ? trailsBesideRoute(trafficTrails, trafficRoute) : trafficTrails),
    [routeShown, trafficTrails, trafficRoute]);

  const rootRef = useRef(null);
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const latest = useRef(null);
  const lastViewRef = useRef(null);
  // A view that could not be framed yet because the map has no size (a hidden or collapsed container): it is framed,
  // without animation, as soon as the map has room.
  const pendingViewRef = useRef(null);
  // What the current engine was given or drew last; reset whenever an engine starts.
  const appliedRef = useRef({ padding: null, pitchMode: null, groups: null, selection: null });
  const pointerRef = useRef({ event: null, frame: 0 });

  // The newest props for engine callbacks and imperative calls; assigned after each render, never during it.
  useLayoutEffect(() => {
    latest.current = {
      stands, presetStands: presetStands ?? EMPTY, flights, selection, onSelect, onPick, onMapClick, placing,
      onCameraChange, isShortcutBlocked, pitchMode, padding, targets, urlView, urlTerminal, defaultView, initialCamera,
      basemap, overlays, interactive, mapOptions, layout, locale: engineLocale(t, labels?.map),
      aircraftDataLabel: t('attribution.aircraftData'),
      drawsStands: standsProp !== undefined, drawsFlights: flightsProp !== undefined, standLabels,
    };
    // The traffic (PR M5): what it draws, the groups the map shows (the page's and the layers menu's), the words of its
    // tags, the trails it draws beside the chosen flight's route, and the layers menu the map keys open and close.
    Object.assign(latest.current, { traffic: traffic ?? null, drawsTraffic: traffic !== undefined, groups: shownGroups,
      language, shownTrails, layersMenuOpen, setLayersMenuOpen });
  });

  // A choice of the layers menu: a difference from the defaults of the view on screen, kept in the browser.
  const setLayer = useCallback((key, on) => {
    const view = store.get().activeView ?? latest.current?.defaultView ?? null;
    setLayerOverrides(current => setLayerOverride(current, view, key, on));
  }, [store]);
  const writtenLayersRef = useRef(layerOverrides);
  useEffect(() => {
    if (writtenLayersRef.current === layerOverrides) return;
    writtenLayersRef.current = layerOverrides;
    writeLayerOverrides(layerStorage(), layerOverrides);
  }, [layerOverrides]);

  // The camera that frames `bounds` in the area the insets leave free, plus `extra` pixels on every side.
  const cameraFor = useCallback((bounds, extra = 0) => {
    const engine = engineRef.current;
    if (!engine?.map || !bounds) return null;
    const current = latest.current.padding;
    const camera = engine.cameraForBounds(bounds, {
      padding: extra > 0 ? addPadding(current, extra) : current, absolutePadding: true, bearing: 0,
    });
    return Number.isFinite(camera?.zoom) ? { center: camera.center, zoom: camera.zoom, padding: current } : null;
  }, []);

  const moveCamera = useCallback((camera, { animate = true } = {}) => {
    const engine = engineRef.current;
    if (!engine?.map) return;
    if (!animate) {
      engine.jumpTo(camera);
      return;
    }
    const { method, ...transition } = transitionFor(engine.getCamera()?.zoom, camera.zoom);
    engine[method]({ ...camera, ...transition });
  }, []);

  const applyView = useCallback((view, { terminal = null, animate = true } = {}) => {
    // Another view closes the map tooltip, held or not.
    store.set({ tooltip: null });
    const target = targetFor(latest.current.targets, view, terminal);
    const camera = cameraFor(target?.bounds);
    if (!camera) {
      if (target && engineRef.current?.map) pendingViewRef.current = { view, terminal };
      return false;
    }
    pendingViewRef.current = null;
    moveCamera({ ...camera, ...cameraAngles(view, latest.current.pitchMode) }, { animate });
    return true;
  }, [cameraFor, moveCamera, store]);

  const flyToPreset = useCallback((view, { terminal = null } = {}) => applyView(view, { terminal }), [applyView]);

  // A view asked for by a person: fly now (also to the view already in the URL after a free zoom) and write `view=`.
  const requestView = useCallback((view, { terminal = null } = {}) => {
    if (!VIEW_NAMES.includes(view)) return;
    const viewTerminal = view === 'ramp' ? terminal : null;
    lastViewRef.current = viewKey(view, viewTerminal);
    applyView(view, { terminal: viewTerminal });
    setView(view, { terminal: viewTerminal });
  }, [applyView, setView]);

  const flyToStand = useCallback((code, { minZoom } = {}) => {
    const engine = engineRef.current;
    const { stands: current, presetStands: reference, padding: inset } = latest.current ?? {};
    const point = lngLatOf(findStand([...(current ?? EMPTY), ...(reference ?? EMPTY)], code));
    const camera = engine?.getCamera();
    if (!point || !camera) return false;
    const fits = store.get().fits;
    const focus = Number.isFinite(minZoom) ? minZoom : fits ? fits.ramp + STAND_FOCUS_OVER_RAMP : camera.zoom;
    moveCamera({ center: point, zoom: Math.max(camera.zoom, focus), padding: inset });
    return true;
  }, [moveCamera, store]);

  // Centres a flight that has a position (by any id matchFlight reads), keeping the zoom unless `minZoom` asks for more.
  const flyToFlight = useCallback((id, { minZoom } = {}) => {
    const engine = engineRef.current;
    const { flights: current, padding: inset } = latest.current ?? {};
    const flight = matchFlight(current ?? EMPTY, id);
    // A flight the traffic draws (PR M5) is where its aircraft is.
    const point = lngLatOf(flight?.position ?? flight) ?? trafficPoint(latest.current?.traffic, id);
    const camera = engine?.getCamera();
    if (!point || !camera) return false;
    const zoom = Number.isFinite(minZoom) ? Math.max(camera.zoom, minZoom) : camera.zoom;
    moveCamera({ center: point, zoom, padding: inset });
    return true;
  }, [moveCamera]);

  // Frames `[[lng, lat], …]` with `padding` pixels to spare inside the insets.
  const flyToBounds = useCallback((coords, { padding: extra = BOUNDS_PADDING_PX } = {}) => {
    const boxes = (Array.isArray(coords) ? coords : [])
      .map(point => lngLatOf({ longitude: point?.[0], latitude: point?.[1] }))
      .filter(Boolean)
      .map(point => [point, point]);
    const camera = cameraFor(unionBounds(...boxes), extra);
    if (!camera) return false;
    const view = presetForZoom(camera.zoom, store.get().fits) ?? 'ramp';
    moveCamera({ ...camera, ...cameraAngles(view, latest.current.pitchMode) });
    return true;
  }, [cameraFor, moveCamera, store]);

  const flyToAll = useCallback(() => applyView('ramp'), [applyView]);
  const flyToPuj = useCallback(() => applyView('airfield'), [applyView]);
  const resetNorth = useCallback(() => {
    engineRef.current?.easeTo({ bearing: 0, duration: NORTH_EASE_MS, essential: false });
  }, []);
  const getCamera = useCallback(() => engineRef.current?.getCamera() ?? null, []);
  // The pixel of `[lng, lat]` inside the map, as `{ x, y }` from its top-left corner, or null without a map (the
  // visual suite clicks a stand where the map draws it).
  const project = useCallback(lngLat => {
    const point = engineRef.current?.project(lngLat);
    return point ? { x: point.x, y: point.y } : null;
  }, []);
  // Resolves true once the map has drawn a frame with nothing left to load or move, false without a map.
  const whenIdle = useCallback(() => engineRef.current?.whenIdle() ?? Promise.resolve(false), []);

  // The traffic (PR M5). The aircraft of other traffic under the pointer, whose tag shows while it is there.
  const trafficFocusRef = useRef(null);

  // The traffic's features from the newest props: one updateData with what changed since the last write.
  const writeTraffic = useCallback(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsTraffic) return;
    const { traffic: current, selection: chosen, groups: shown, language: words } = latest.current;
    const data = trafficFeatures(current?.aircraft ?? EMPTY, {
      selection: chosen, focusId: trafficFocusRef.current, labelsOn: shown?.['traffic.labels'] === true, language: words,
    });
    const diff = trafficDiff(applied.trafficById, data.features);
    if (isEmptyDiff(diff)) return;
    applied.trafficById = featuresById(data);
    engine.updateData(TRAFFIC_SOURCE, diff).catch(error => console.error('The OCC map could not update its traffic.', error));
  }, []);

  // The traffic drawn in `bounds` (the area the insets leave in sight), for the legend and the credit.
  const updateTrafficOnScreen = useCallback((bounds, zoom, thresholds) => {
    const current = latest.current?.traffic;
    const next = appliedRef.current.drawsTraffic && bounds !== null
      ? trafficOnScreenOf(current?.aircraft ?? EMPTY, bounds, {
        groups: latest.current.groups, zoom, thresholds, trails: latest.current.shownTrails ?? null,
        route: current?.route ?? null,
      })
      : NO_TRAFFIC_ON_SCREEN;
    if (onScreenKey(next) !== onScreenKey(store.get().trafficOnScreen)) store.set({ trafficOnScreen: next });
  }, [store]);

  // What is drawn in the area the insets leave in sight (the page's panels hide what lies under them), for the legend,
  // which explains only what is on screen (contracts 2.4): the stands drawn one by one, whether a cluster of stands is
  // drawn there, the flights drawn there and the airfield items drawn there. From the ramp view on every stand there is
  // drawn on its own. While MapLibre gathers them into clusters, a stand with no neighbour within the cluster radius is
  // still drawn on its own, with its state, so what the map draws there is read back, as is the airfield from its
  // threshold on; right after a move the tiles of the new zoom may still be loading, so both are read again when the
  // map settles (onIdle). They change only when the camera, the insets, the thresholds, the stands, the flights or what
  // the map draws do, and a list keeps its identity while what the legend reads of it stays the same.
  const updateOnScreen = useCallback(() => {
    const engine = engineRef.current;
    const { padding, stands: current } = latest.current;
    const bounds = engine?.getVisibleBounds(padding) ?? null;
    const inView = bounds === null ? EMPTY : standsInView(current, bounds);
    const { standLabels, drawsStands, drawsFlights, drawsAirfield } = appliedRef.current;
    const zoom = engine?.getCamera()?.zoom;
    const { thresholds } = store.get();
    const display = standDisplayAt(zoom, thresholds, { labels: standLabels ?? 'default' });
    const drawn = display === 'grouped' && drawsStands ? drawnStands(engine?.renderedFeatures(STAND_DRAWN_LAYERS, padding)) : null;
    let next = display === 'points' ? inView : EMPTY;
    if (drawn !== null) next = inView.filter(stand => drawn.codes.has(mapStandCode(standCodeOf(stand))));
    // Only a map that started with flights draws them.
    const flights = bounds === null || !drawsFlights ? EMPTY : flightsInView(latest.current.flights, bounds);
    // Below its threshold the airfield is not drawn: nothing to ask the map.
    const airfieldDrawn = drawsAirfield && bounds !== null && !(zoom < thresholds?.airfield);
    const airfield = airfieldDrawn ? airfieldKindsOnScreen(engine.renderedFeatures(AIRFIELD_LAYER_IDS, padding)) : EMPTY;
    const previous = store.get();
    store.set({
      ...(standsKey(next) === standsKey(previous.standsOnScreen) ? {} : { standsOnScreen: next.length === 0 ? EMPTY : next }),
      standsGrouped: drawn?.grouped === true,
      ...(flightsKey(flights) === flightsKey(previous.flightsOnScreen)
        ? {}
        : { flightsOnScreen: flights.length === 0 ? EMPTY : flights }),
      ...(airfield.join('|') === previous.airfieldOnScreen.join('|')
        ? {}
        : { airfieldOnScreen: airfield.length === 0 ? EMPTY : airfield }),
    });
    updateTrafficOnScreen(bounds, zoom, thresholds);
  }, [store, updateTrafficOnScreen]);

  // The fitted zoom of each view in the room the insets leave; the thresholds follow them (contracts 2.3).
  const refit = useCallback(() => {
    const engine = engineRef.current;
    if (!engine?.map) return;
    const { padding: inset, targets: current } = latest.current;
    const fits = fitZooms((bounds, options) => engine.cameraForBounds(bounds, {
      ...options, padding: inset, absolutePadding: true,
    }), current);
    if (sameFits(fits, store.get().fits)) return;
    const thresholds = thresholdsFromFits(fits);
    const applied = appliedRef.current;
    // Without its own airfield the map leaves the tile aeroway at every zoom.
    if (thresholds) engine.applyThresholds(applied.drawsAirfield ? thresholds : withoutAirfield(thresholds));
    // The stand clusters end where the stands are drawn on their own: one call per new limit.
    const clusters = applied.drawsStands ? standClusterOptions(thresholds, { labels: applied.standLabels }) : null;
    if (clusters && clusters.clusterMaxZoom !== applied.clusterMaxZoom) {
      applied.clusterMaxZoom = clusters.clusterMaxZoom;
      engine.setClusterOptions(STAND_SOURCE, clusters);
    }
    store.set({ fits, thresholds, activeView: presetForZoom(engine.getCamera()?.zoom, fits) });
    // New thresholds may draw the stands on screen in another way (hidden, grouped or one by one).
    updateOnScreen();
    const pending = pendingViewRef.current;
    if (fits && pending) applyView(pending.view, { terminal: pending.terminal, animate: false });
  }, [store, applyView, updateOnScreen]);

  // The map tooltip after a move: a card that follows the pointer goes with the move (the pointer shows the next one);
  // a held card moves with the point it was held at while that stays in sight, and closes when it leaves.
  const followTooltip = useCallback(() => {
    const tooltip = store.get().tooltip;
    if (tooltip === null) return;
    const engine = engineRef.current;
    const { padding } = latest.current;
    const bounds = tooltip.pinned ? engine?.getVisibleBounds(padding) ?? null : null;
    const point = bounds !== null && isInBounds(tooltip.lngLat, bounds) ? engine.project(tooltip.lngLat) : null;
    if (point === null) {
      store.set({ tooltip: null });
      return;
    }
    const placement = tooltipPlacement(engine, padding, point);
    if (Object.entries(placement).every(([key, value]) => tooltip[key] === value)) return;
    store.set({ tooltip: { ...tooltip, ...placement } });
  }, [store]);

  const handleCamera = useCallback((camera, details) => {
    if (!camera) return;
    // A person moved the map: a view still waiting for room is no longer wanted.
    if (details?.byUser) pendingViewRef.current = null;
    // The zoom is written straight to the DOM, without a render: the visual suite reads it to see the camera move.
    rootRef.current?.setAttribute('data-occ-zoom', camera.zoom.toFixed(2));
    store.set({ activeView: presetForZoom(camera.zoom, store.get().fits) });
    followTooltip();
    updateOnScreen();
    latest.current?.onCameraChange?.(camera, details);
  }, [store, followTooltip, updateOnScreen]);

  const handleStatus = useCallback(status => {
    store.set({ engineStatus: status.engine, basemapStatus: status.basemap });
  }, [store]);

  // Shows the tooltip of a runway or a taxiway picked at `point` (a pixel of the map) and `lngLat`.
  const showTooltip = useCallback((info, point, lngLat, pinned) => {
    const engine = engineRef.current;
    if (!engine || !point || !lngLat) return;
    store.set({ tooltip: { ...info, pinned, lngLat, ...tooltipPlacement(engine, latest.current.padding, point) } });
  }, [store]);

  const handleClick = useCallback(async ({ point, lngLat, hit }) => {
    const props = latest.current;
    if (props.placing) {
      if (lngLat) props.onMapClick?.({ latitude: lngLat[1], longitude: lngLat[0] });
      return;
    }
    // A click on a runway or a taxiway holds its tooltip, so nothing depends on hovering alone; a click anywhere else
    // closes it.
    const info = airfieldTooltip(hit);
    if (info !== null) {
      showTooltip(info, point, lngLat, true);
      return;
    }
    if (store.get().tooltip !== null) store.set({ tooltip: null });
    if (!hit || hit.id == null) return;
    if (hit.kind === 'cluster') {
      const source = hit.feature?.source ?? hit.feature?.layer?.source;
      const center = hit.feature?.geometry?.type === 'Point' ? hit.feature.geometry.coordinates : lngLat;
      await engineRef.current?.expandCluster(source, hit.id, center);
      return;
    }
    if (SELECTABLE_KINDS.has(hit.kind)) props.onSelect?.({ kind: hit.kind, id: String(hit.id) });
    // Anything else a screen's own layer lets pick (the graph nodes of the map lab's layout review) is the screen's.
    else props.onPick?.(hit);
  }, [store, showTooltip]);

  // The tooltip of what is under the pointer, unless a click holds one: written to the store only when the runway or
  // the taxiway under the pointer changes, never on every frame. A drag (a button held down) shows none.
  const hoverTooltip = useCallback((event, hit) => {
    const current = store.get().tooltip;
    if (current?.pinned) return;
    const info = event && !event.originalEvent?.buttons ? airfieldTooltip(hit) : null;
    if (info === null) {
      if (current !== null) store.set({ tooltip: null });
      return;
    }
    if (current?.kind === info.kind && current.id === info.id) return;
    showTooltip(info, event.point, event.lngLat, false);
  }, [store, showTooltip]);

  // Other traffic shows its tag while the pointer is on it (contracts 2.4: tag on demand), written with updateData.
  const focusTraffic = useCallback(hit => {
    const next = hit?.kind === 'aircraft' ? hit.feature?.properties?.id ?? null : null;
    if (trafficFocusRef.current === next) return;
    trafficFocusRef.current = next;
    writeTraffic();
  }, [writeTraffic]);

  // The cursor and the hover tooltip follow what is under the pointer, picked once per frame.
  const handlePointer = useCallback(event => {
    const pointer = pointerRef.current;
    pointer.event = event;
    if (pointer.frame) return;
    pointer.frame = requestFrame(() => {
      pointer.frame = 0;
      const engine = engineRef.current;
      if (!engine) return;
      if (latest.current.placing) {
        engine.setCursor('crosshair');
        return;
      }
      const hit = pointer.event?.hit;
      // A pick the screen hears (onPick) is something to click as well.
      const clickable = hit && (POINTER_KINDS.has(hit.kind) || (hit.id != null && latest.current.onPick));
      engine.setCursor(clickable ? 'pointer' : '');
      hoverTooltip(pointer.event, hit);
      focusTraffic(pointer.event ? hit : null);
    });
  }, [hoverTooltip, focusTraffic]);

  // One engine for the life of the component. A StrictMode remount destroys the first one before the second starts.
  useEffect(() => {
    const props = latest.current;
    const pointer = pointerRef.current;
    store.set(initialSnapshot(props.basemap));
    appliedRef.current = {
      padding: props.padding, pitchMode: props.pitchMode, groups: null, selection: null, stands: null, flights: null,
      overlayData: {}, clusterMaxZoom: null, drawsStands: props.drawsStands, drawsFlights: props.drawsFlights,
      standLabels: props.standLabels, drawsAirfield: Boolean(props.layout),
    };
    // The traffic of this engine: what its source holds, the trails and route written, and the credit shown.
    Object.assign(appliedRef.current, { drawsTraffic: props.drawsTraffic, trafficById: new Map(), trails: null, route: null,
      credit: '' });
    pendingViewRef.current = null;
    // The URL view, else the camera the page kept, else the default view.
    const initialView = props.urlView ?? (props.initialCamera ? null : props.defaultView);
    const initialTerminal = props.urlView ? props.urlTerminal : null;
    const angles = cameraAngles(initialView ?? props.defaultView, props.pitchMode);
    // A view starts over its target, so a map that has no size yet waits there and not at MapLibre's [0, 0].
    const start = initialView === null
      ? { ...angles, ...props.initialCamera }
      : { ...angles, center: boundsCenter(targetFor(props.targets, initialView, initialTerminal)?.bounds) ?? undefined };

    // The airfield goes before the references: they share the airfield slot, and the mark of PUJ stays above the
    // pavement.
    const overlays = [
      selectionOverlay(),
      ...(props.layout ? [airfieldOverlay()] : []),
      referenceOverlay(),
      ...(props.drawsStands ? [standOverlay({ labels: props.standLabels })] : []),
      ...(props.drawsFlights ? [flightOverlay()] : []),
      ...(props.drawsTraffic ? [trafficOverlay()] : []),
      ...props.overlays,
    ];
    // The keys of the layers menu this style has layers for (PR M5).
    store.set({ layerKeys: availableLayerKeys({ layers: overlays.flatMap(overlay => overlay.layers ?? []) }) });
    const engine = createMapEngine({
      maplibre,
      host: hostRef.current,
      style: buildOccStyle({ basemap: props.basemap, overlays }),
      camera: start,
      interactive: props.interactive,
      attribution: buildAttribution([], { aircraftDataLabel: props.aircraftDataLabel }),
      imageResolver: createImageResolver(),
      mapOptions: { ...props.mapOptions, locale: props.locale },
      onStatus: handleStatus,
      onCamera: handleCamera,
      // What the map draws is final once it settles: the legend reads it again then.
      onIdle: updateOnScreen,
      onResize: refit,
      onClick: handleClick,
      onPointerMove: handlePointer,
    });
    engineRef.current = engine;
    engine.setData(REFERENCE_SOURCE, referenceFeatures());
    if (props.layout) engine.setData(AIRFIELD_SOURCE, airfieldFeatures(props.layout));
    engine.setInsets(props.padding);
    refit();
    lastViewRef.current = props.urlView === null ? null : viewKey(props.urlView, props.urlTerminal);
    if (initialView === null) handleCamera(engine.getCamera(), { byUser: false });
    else applyView(initialView, { terminal: initialTerminal, animate: false });
    if (props.placing) engine.setCursor('crosshair');

    return () => {
      if (pointer.frame) cancelFrame(pointer.frame);
      pointer.frame = 0;
      pointer.event = null;
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [store, applyView, handleCamera, handleClick, handlePointer, handleStatus, refit, updateOnScreen]);

  // The URL view: fly only when it differs from the last view applied, so a view this map asked for flies once.
  useEffect(() => {
    if (urlView === null) {
      lastViewRef.current = null;
      return;
    }
    const key = viewKey(urlView, urlTerminal);
    if (key === lastViewRef.current) return;
    lastViewRef.current = key;
    applyView(urlView, { terminal: urlTerminal });
  }, [urlView, urlTerminal, applyView]);

  // The insets: camera padding and control positions, new fits and thresholds, and what is left on screen.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || appliedRef.current.padding === padding) return;
    appliedRef.current.padding = padding;
    engine.setInsets(padding);
    refit();
    updateOnScreen();
  }, [padding, refit, updateOnScreen]);

  // New stands may change what frames the views and what is on screen.
  useEffect(() => {
    refit();
  }, [targets, refit]);

  // New stands or flights may change what is on screen: a flight that moves in or out of sight changes the legend.
  useEffect(() => {
    updateOnScreen();
  }, [stands, flights, updateOnScreen]);

  // The drawn stands and flights: one setData when what they draw changes, never a new map. A re-read of the same
  // positions in new objects writes nothing.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !appliedRef.current.drawsStands) return;
    const data = toStandFeatures(stands);
    const key = JSON.stringify(data.features);
    if (appliedRef.current.stands === key) return;
    appliedRef.current.stands = key;
    engine.setData(STAND_SOURCE, data);
  }, [stands]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !appliedRef.current.drawsFlights) return;
    const data = toFlightFeatures(flights);
    const key = JSON.stringify(data.features);
    if (appliedRef.current.flights === key) return;
    appliedRef.current.flights = key;
    engine.setData(FLIGHT_SOURCE, data);
  }, [flights]);

  // The traffic (PR M5): the aircraft, again whenever the selection, the shown groups or the language change what
  // they draw, then what is on screen. A read that moved nothing writes nothing.
  const trafficAircraft = traffic?.aircraft ?? EMPTY;
  useEffect(() => {
    writeTraffic();
    updateOnScreen();
  }, [trafficAircraft, selection, shownGroupsKey, language, writeTraffic, updateOnScreen]);

  // The trails and the chosen flight's route: one setData when what they draw changes.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsTraffic) return;
    for (const [sourceId, slot, data] of [[TRAILS_SOURCE, 'trails', shownTrails], [ROUTE_SOURCE, 'route', trafficRoute]]) {
      const collection = data ?? EMPTY_COLLECTION;
      const key = JSON.stringify(collection.features ?? EMPTY);
      if (applied[slot] === key) continue;
      applied[slot] = key;
      engine.setData(sourceId, collection);
    }
    updateOnScreen();
  }, [shownTrails, trafficRoute, updateOnScreen]);

  // The credit of the aircraft data (owner decision 6, contracts 2.5): «Datos de aeronaves: {source}» with its links
  // in the attribution while traffic is on screen, and out of it when none is.
  const trafficShown = snapshot.trafficOnScreen;
  const creditKey = trafficShown.kinds.length > 0 ? creditKeyOf(traffic?.source) : '';
  const trafficSource = useMemo(() => {
    if (creditKey === '') return null;
    const [name, homeUrl, licenseName, licenseUrl] = JSON.parse(creditKey);
    return Object.freeze({ name, homeUrl, licenseName, licenseUrl });
  }, [creditKey]);
  const aircraftDataLabel = t('attribution.aircraftData');
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    // What the attribution shows: nothing of the traffic, or this source in this language.
    const key = creditKey === '' ? '' : `${creditKey}|${aircraftDataLabel}`;
    if (!engine || !applied.drawsTraffic || applied.credit === key) return;
    applied.credit = key;
    engine.setAttribution(buildAttribution(trafficSource === null ? [] : [trafficSource], { aircraftDataLabel }));
  }, [creditKey, trafficSource, aircraftDataLabel]);

  // A screen's own overlays: one setData for each source whose features changed, keyed like the stands and flights.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !overlayData) return;
    const applied = appliedRef.current.overlayData;
    for (const [sourceId, data] of Object.entries(overlayData)) {
      if (!data) continue;
      const key = JSON.stringify(data.features ?? []);
      if (applied[sourceId] === key) continue;
      applied[sourceId] = key;
      engine.setData(sourceId, data);
    }
  }, [overlayData]);

  // The selection casing: one feature in the selection source, written only when it changes.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const data = selectionFeatures(selection, { stands: [...stands, ...(presetStands ?? EMPTY)], flights });
    const key = JSON.stringify(data.features);
    if (appliedRef.current.selection === key) return;
    appliedRef.current.selection = key;
    engine.setData(SELECTION_SOURCE, data);
  }, [selection, stands, presetStands, flights]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || appliedRef.current.pitchMode === pitchMode) return;
    appliedRef.current.pitchMode = pitchMode;
    const view = store.get().activeView ?? 'ramp';
    engine.easeTo({ ...cameraAngles(view, pitchMode), duration: PITCH_EASE_MS, essential: false });
  }, [pitchMode, store]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = JSON.parse(groupsKey);
    const applied = appliedRef.current.groups ?? {};
    for (const [group, visible] of Object.entries(next)) {
      if (applied[group] !== Boolean(visible)) engine.setGroupVisibility(group, Boolean(visible));
    }
    appliedRef.current.groups = Object.fromEntries(Object.entries(next).map(([group, visible]) => [group, Boolean(visible)]));
  }, [groupsKey]);

  // The groups the layers menu shows or hides (PR M5), except those the page sets itself: one call per change. A group
  // the page lets go is the menu's again.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const page = JSON.parse(groupsKey);
    const applied = appliedRef.current.menuGroups ?? {};
    const next = {};
    for (const [group, visible] of Object.entries(JSON.parse(menuGroupsKey))) {
      if (Object.hasOwn(page, group)) continue;
      if (applied[group] !== visible) engine.setGroupVisibility(group, visible);
      next[group] = visible;
    }
    appliedRef.current.menuGroups = next;
  }, [groupsKey, menuGroupsKey]);

  // While a stand is being placed a click gives its point: no tooltip stays open over the map.
  useEffect(() => {
    engineRef.current?.setCursor(placing ? 'crosshair' : '');
    if (placing) store.set({ tooltip: null });
  }, [placing, store]);

  // The map keys (contracts 2.2) on keydown at the map's root, in the bubble phase, never on document. 1 to 4 are
  // the views while the map can draw; Esc clears a selection, after a drawer or dialog has closed on its own Esc.
  useEffect(() => {
    const root = rootRef.current;
    const handlers = {};
    for (const view of VIEW_NAMES) {
      Object.defineProperty(handlers, `view.${view}`, {
        enumerable: true,
        get: () => (store.get().engineStatus === 'unavailable' ? undefined : () => requestView(view)),
      });
    }
    // The layers menu (PR M5): L opens and closes it while the map shows one and can draw.
    Object.defineProperty(handlers, 'toggleLayers', {
      enumerable: true,
      get: () => (layersMenusRef.current > 0 && store.get().engineStatus !== 'unavailable'
        ? () => latest.current?.setLayersMenuOpen(!latest.current.layersMenuOpen)
        : undefined),
    });
    Object.defineProperty(handlers, 'clearSelection', {
      enumerable: true,
      get: () => {
        // An open layers menu closes first; the selection waits for the next Esc (PR M5).
        if (latest.current?.layersMenuOpen) return () => latest.current.setLayersMenuOpen(false);
        const { selection: current, onSelect: select } = latest.current ?? {};
        return current && select ? () => select(null) : undefined;
      },
    });
    const handle = createOccShortcutHandler(handlers, { isBlocked: () => Boolean(latest.current?.isShortcutBlocked?.()) });
    const listener = event => {
      handle(event);
    };
    root.addEventListener('keydown', listener);
    return () => root.removeEventListener('keydown', listener);
  }, [requestView, store]);

  useImperativeHandle(ref, () => ({
    flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera, project, whenIdle,
  }), [flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera, project, whenIdle]);

  // The overlays read only these: the tooltip, which changes with the pointer, renders here and re-renders none of them.
  const {
    engineStatus, basemapStatus, activeView, fits, thresholds, standsOnScreen, standsGrouped, flightsOnScreen,
    airfieldOnScreen,
  } = snapshot;
  const context = useMemo(() => ({
    engineStatus,
    basemapStatus,
    activeView,
    fits,
    thresholds,
    standsOnScreen,
    standsGrouped,
    flightsOnScreen,
    airfieldOnScreen,
    requestView,
    flyToPreset,
    flyToStand,
    flyToFlight,
  }), [
    engineStatus, basemapStatus, activeView, fits, thresholds, standsOnScreen, standsGrouped, flightsOnScreen,
    airfieldOnScreen, requestView, flyToPreset, flyToStand, flyToFlight,
  ]);
  // With the traffic on screen and its source (PR M5), for the legend and the status over the map, and the layers menu.
  const { layerKeys } = snapshot;
  const layers = useMemo(() => Object.freeze({ keys: layerKeys, values: resolvedLayers }), [layerKeys, resolvedLayers]);
  const mapContext = useMemo(() => ({
    ...context, trafficOnScreen: trafficShown, trafficSource, layers, setLayer, layersMenuOpen, setLayersMenuOpen,
    registerLayersMenu,
  }), [context, trafficShown, trafficSource, layers, setLayer, layersMenuOpen, setLayersMenuOpen, registerLayersMenu]);

  // The list of the fallback: the adapter's own items, else the stands of the screen, else those that frame the views.
  const listedStands = stands.length > 0 ? stands : referenceStands;
  const items = useMemo(() => fallbackItems ?? standsInView(listedStands)
    .map(stand => ({ id: standCodeOf(stand), label: standCodeOf(stand), kind: 'stand' }))
    .filter(item => item.id !== ''), [fallbackItems, listedStands]);
  const selectFallback = (id, item) => {
    if (onFallbackSelect) onFallbackSelect(id, item);
    else onSelect?.({ kind: item?.kind ?? 'stand', id });
  };
  const unavailable = engineStatus === 'unavailable';

  return (
    <OccMapContext.Provider value={mapContext}>
      <div
        ref={rootRef}
        data-testid="occ-map"
        data-occ-engine={engineStatus}
        data-occ-basemap={basemapStatus}
        data-occ-view={activeView ?? undefined}
        className={`occ-map absolute inset-0 overflow-hidden bg-occ-canvas ${className}`.trim()}
        style={insetVariables(padding)}
      >
        <div ref={hostRef} data-testid={testId} className="h-full w-full" />
        {unavailable && (
          <MapUnavailable
            title={labels?.unavailableTitle ?? t('unavailable.title')}
            description={labels?.unavailableDescription ?? t('unavailable.description')}
            listLabel={labels?.unavailableList ?? t('unavailable.list')}
            items={items}
            selectedId={selection?.id ?? null}
            onSelect={selectFallback}
          />
        )}
        {!unavailable && basemapStatus === 'degraded' && (
          <p role="status" className="occ-map-chip rounded-md border border-occ-line bg-occ-panel-float px-3 py-2 text-sm text-occ-text">
            {t('basemap.degraded')}
          </p>
        )}
        {children}
        {!unavailable && <MapTooltip tooltip={snapshot.tooltip} />}
      </div>
    </OccMapContext.Provider>
  );
});

export default OccMap;
