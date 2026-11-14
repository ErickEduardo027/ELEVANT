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
import {
  STAND_FEATURE_COLLECTIONS, buildStandFeatures, diffStandFeatures, featuresIn, standsDrawnIn,
} from '../stands/standFeatures';
import { STAND_SOURCE, STAND_SOURCES, standDisplayAt, standOverlay } from '../stands/standLayers';
import { attachStandGeometry, standStateOf } from '../stands/standModel';
import {
  AIRFIELD_LAYER_IDS, AIRFIELD_SOURCE, airfieldKindsOnScreen, airfieldOverlay, airfieldTooltip,
} from '../style/airfieldLayers';
import { createImageResolver } from '../style/mapImages';
import { buildOccStyle } from '../style/occStyle';
import { REFERENCE_SOURCE, referenceFeatures, referenceOverlay } from '../style/referenceLayers';
import { SELECTION_SOURCE, selectionFeatures, selectionOverlay } from '../style/selectionLayers';
import { FLIGHT_SOURCE, flightOverlay, flightsInView, toFlightFeatures } from '../traffic/flightLayers';
import MapTooltip from '../ui/MapTooltip';
import { buildAttribution } from './attribution';
import {
  VIEW_NAMES, boundsCenter, cameraAngles, fitZooms, isInBounds, isRetired, lngLatOf, presetForZoom, presetTargets,
  sameFits, standCodeOf, standsInView, targetFor, thresholdsFromFits, transitionFor, unionBounds,
} from './cameraPresets';
import { createMapEngine } from './mapEngine';
import { matchFlight } from './mapSelection';
import MapUnavailable from './MapUnavailable';
import { OccMapContext } from './OccMapContext';
import { useMapSelection } from './useMapSelection';
import { useMinuteClock } from './useMinuteClock';

// The one map component of the OCC (design A4). Client only: the pages load it through next/dynamic with ssr false.
// It owns one engine (core/mapEngine.js) for its whole life, the four views of contracts 2.3 with thresholds derived
// from the fitted zooms, the selection, the map keys of contracts 2.2 and the fallback list. DOM overlays come as
// children and reach the map through OccMapContext. It always draws the references (the ARP of PUJ) and, from the
// derived airfield threshold, the airfield of its airport layout (PR M3: the MDPC dataset unless `layout` says
// otherwise), whose box and stand polygons also frame the airport views; a runway or a taxiway under the pointer shows
// the map tooltip, and a click holds it. Given `stands` it draws them as polygons with their state (PR M4): where each
// one is comes from the layout or from the location OCC saved (stands/standModel.js: attachStandGeometry), how it
// reads from the display the screen derived (useStandDisplay) or its board status, and its countdowns follow the
// map's minute clock. Given `flights` it draws those with a position. Their overlays are part of the style from the
// start, so the first data is one setData per source and every later change one updateData with what changed: the
// map is never re-created. A screen's own overlays get their data through `overlayData`.

const EMPTY = Object.freeze([]);
const NO_GROUPS = Object.freeze({});
const INSET_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);
const SELECTABLE_KINDS = new Set(['stand', 'flight', 'aircraft']);
// What takes the pointer cursor: what can be selected, a terminal chip to open, and a runway or a taxiway with its
// tooltip.
const POINTER_KINDS = new Set([...SELECTABLE_KINDS, 'terminal', 'runway', 'taxiway']);
// A map without stands has no countdown to keep: its clock stays still at this instant and starts no timer.
const NO_CLOCK = 0;
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
// What the legend reads of a stand on screen: its state, its signals and where its location comes from.
const standsKey = stands => stands
  .map(stand => [
    standCodeOf(stand), standStateOf(stand), (stand.signals ?? []).map(signal => signal?.kind).join(','),
    stand.locationSource ?? '',
  ].join(':')).join('|');
const sameList = (first, second) => first.join('|') === second.join('|');
// The legend shows one entry for every drawn flight, so which flights are on screen is all that counts.
const flightsKey = flights => flights.map(flight => String(flight.id)).join('|');
// Thresholds for a map without the airfield overlay: the tile aeroway then keeps every zoom.
const withoutAirfield = ({ airfield, ...rest }) => rest;

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

// Whether the map has drawn everything it was given, on its root: `false` from a camera move or a data write until the
// next frame MapLibre draws with nothing left to load, place or fade (its `idle`), then `true`. Written straight to the
// DOM, without a render: the visual suite waits on it before a screenshot of a screen that exposes no handle.
const markSettled = (root, settled) => root?.setAttribute('data-occ-settled', settled ? 'true' : 'false');

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
  chipsOnScreen: EMPTY,
  standMarksOnScreen: EMPTY,
  flightsOnScreen: EMPTY,
  airfieldOnScreen: EMPTY,
  // The map tooltip of a runway or a taxiway: what it shows, where, and whether a click holds it.
  tooltip: null,
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

// Where a stand is: the centre of the box the map draws for it, else its own location.
const standPointOf = stand => stand?.geometry?.center ?? lngLatOf(stand);

/**
 * Props:
 * - `defaultView` ('ramp'), `layout` (the airport layout the map draws its airfield from and frames the airport views
 *   with: the MDPC dataset by default; `null` draws no airfield of its own, keeps the tile aeroway at every zoom and
 *   frames the views with the stand points; the airfield it draws is the one given at start, the views follow the
 *   prop), `presetStands` (the stands that frame the views without a layout; `stands` when absent), `stands` (the
 *   stands of the screen, with `status` and, when the screen derived it, `displayStatus`, `signals` and `display`
 *   (useStandDisplay); given at start, the map draws them as polygons, with `standLabels` 'default' or 'dashboard'),
 *   `frozenAt` (milliseconds: the instant the stand countdowns are counted at, the map lab's frozen clock; without it
 *   the minute clock runs), `flights` (given at start, the map draws those with a position);
 * - `overlays` for buildOccStyle and `basemap`, `interactive` and `mapOptions` (extra MapLibre options, such as the
 *   map lab's `fadeDuration: 0`; the map keeps its own locale): read once, when the map starts, as are whether
 *   `stands` and `flights` are given and `standLabels`;
 * - `overlayData` (`{ [sourceId]: FeatureCollection }`): the data of the sources of `overlays`, one setData for each
 *   source whose features change, as for the stands and the flights;
 * - `selection` (`{ kind, id }` or null) and `onSelect({ kind, id } | null)`; a click on a terminal chip opens that
 *   terminal's view; `onPick(hit)` for a click on anything else a layer lets pick (`{ kind, id, feature }` as the
 *   engine answers it: not a stand, a flight, an aircraft, a terminal, a runway or a taxiway);
 *   `onMapClick({ latitude, longitude })` while `placing`; `initialCamera` and `onCameraChange(camera)`;
 * - `pitchMode` ('2d' | '3d'), `groups` ({ 'buildings-3d': true }), `insets` ({ top, right, bottom, left } in px);
 * - `testId` of the host that holds the canvas, `labels` ({ unavailableTitle, unavailableDescription,
 *   unavailableList, map }), `fallbackItems` ([{ id, label, kind }]) and `onFallbackSelect(id, item)`;
 * - `isShortcutBlocked()` (an open drawer that is not a modal dialog), `className`, `children` (DOM overlays).
 */
const OccMap = forwardRef(function OccMap({
  defaultView = 'ramp',
  layout = MDPC_LAYOUT,
  presetStands,
  stands: standsProp,
  standLabels = 'default',
  frozenAt = null,
  flights: flightsProp,
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
  // Where each stand is drawn, and what the stand layers draw at the map's minute: the countdowns change on the
  // minute, and a re-read of the same positions builds the same features.
  const attached = useMemo(() => attachStandGeometry(stands, layout), [stands, layout]);
  const clock = useMinuteClock({ frozenAt: standsProp === undefined ? NO_CLOCK : frozenAt });
  const standFeatures = useMemo(() => buildStandFeatures(attached, { nowMs: clock, language, labels: standLabels }),
    [attached, clock, language, standLabels]);

  const paddingKey = insetsKey(normalizeInsets(insets));
  const padding = useMemo(() => insetsFromKey(paddingKey), [paddingKey]);
  const referenceStands = presetStands ?? stands;
  const targets = useMemo(() => presetTargets({ stands: referenceStands, layout }), [referenceStands, layout]);
  const groupsKey = JSON.stringify(groups ?? NO_GROUPS);

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
      stands, attached, standFeatures, presetStands: presetStands ?? EMPTY, flights, selection, onSelect, onPick,
      onMapClick, placing, onCameraChange, isShortcutBlocked, pitchMode, padding, targets, urlView, urlTerminal,
      defaultView, initialCamera, basemap, overlays, interactive, mapOptions, layout,
      locale: engineLocale(t, labels?.map),
      aircraftDataLabel: t('attribution.aircraftData'),
      drawsStands: standsProp !== undefined, drawsFlights: flightsProp !== undefined, standLabels,
    };
  });

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
    const { attached: drawn, presetStands: reference, padding: inset } = latest.current ?? {};
    const point = standPointOf(findStand([...(drawn ?? EMPTY), ...(reference ?? EMPTY)], code));
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
    const point = lngLatOf(flight?.position ?? flight);
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
  // Puts the camera at once at `{ center, zoom, bearing, pitch }` (any of them), without a move a person sees: the map
  // lab and the visual suite set a zoom between two thresholds with it. False without a map.
  const jumpTo = useCallback(camera => {
    if (!engineRef.current?.map) return false;
    engineRef.current.jumpTo(camera);
    return true;
  }, []);
  // The pixel of `[lng, lat]` inside the map, as `{ x, y }` from its top-left corner, or null without a map (the
  // visual suite clicks a stand where the map draws it).
  const project = useCallback(lngLat => {
    const point = engineRef.current?.project(lngLat);
    return point ? { x: point.x, y: point.y } : null;
  }, []);
  // Resolves true once the map has drawn a frame with nothing left to load or move, false without a map.
  const whenIdle = useCallback(() => engineRef.current?.whenIdle() ?? Promise.resolve(false), []);

  // What is drawn in the area the insets leave in sight (the page's panels hide what lies under them), for the legend,
  // which explains only what is on screen (contracts 2.4): the stands whose polygon reaches into that area from the
  // polygon threshold on, the terminal chips drawn there below it, the combined links and narrow-body boxes drawn
  // there, the flights drawn there and the airfield items drawn there. The stands are known from their own geometry;
  // the airfield is read back from the map from its threshold on, and right after a move the tiles of the new zoom may
  // still be loading, so it is read again when the map settles (onIdle). They change only when the camera, the insets,
  // the thresholds, the stands, the flights or what the map draws do, and a list keeps its identity while what the
  // legend reads of it stays the same.
  const updateOnScreen = useCallback(() => {
    const engine = engineRef.current;
    const { padding, attached: drawnStands, standFeatures: features } = latest.current;
    const bounds = engine?.getVisibleBounds(padding) ?? null;
    const { drawsStands, drawsFlights, drawsAirfield } = appliedRef.current;
    const zoom = engine?.getCamera()?.zoom;
    const { thresholds } = store.get();
    const display = bounds === null || !drawsStands ? 'hidden' : standDisplayAt(zoom, thresholds);
    const polygons = display === 'polygons';
    const next = polygons ? standsDrawnIn(drawnStands, bounds) : EMPTY;
    const chips = display === 'chips' ? featuresIn(features.groups, bounds).map(chip => chip.id) : EMPTY;
    // The narrow-body boxes are drawn from the codes threshold on, the combined links with the polygons.
    const codesShown = !Number.isFinite(thresholds?.codes) || zoom >= thresholds.codes;
    const drawsAux = (kind, from) => from && featuresIn(features.aux, bounds, { kind }).length > 0;
    const marks = [
      ...(drawsAux('combinedLink', polygons) ? ['combined'] : []),
      ...(drawsAux('narrowInner', polygons && codesShown) ? ['narrowbody'] : []),
    ];
    // Only a map that started with flights draws them.
    const flights = bounds === null || !drawsFlights ? EMPTY : flightsInView(latest.current.flights, bounds);
    // Below its threshold the airfield is not drawn: nothing to ask the map.
    const airfieldDrawn = drawsAirfield && bounds !== null && !(zoom < thresholds?.airfield);
    const airfield = airfieldDrawn ? airfieldKindsOnScreen(engine.renderedFeatures(AIRFIELD_LAYER_IDS, padding)) : EMPTY;
    const previous = store.get();
    store.set({
      ...(standsKey(next) === standsKey(previous.standsOnScreen) ? {} : { standsOnScreen: next.length === 0 ? EMPTY : next }),
      ...(sameList(chips, previous.chipsOnScreen) ? {} : { chipsOnScreen: chips.length === 0 ? EMPTY : chips }),
      ...(sameList(marks, previous.standMarksOnScreen) ? {} : { standMarksOnScreen: marks.length === 0 ? EMPTY : marks }),
      ...(flightsKey(flights) === flightsKey(previous.flightsOnScreen)
        ? {}
        : { flightsOnScreen: flights.length === 0 ? EMPTY : flights }),
      ...(sameList(airfield, previous.airfieldOnScreen) ? {} : { airfieldOnScreen: airfield.length === 0 ? EMPTY : airfield }),
    });
  }, [store]);

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
    // Without its own airfield the map leaves the tile aeroway at every zoom.
    if (thresholds) engine.applyThresholds(appliedRef.current.drawsAirfield ? thresholds : withoutAirfield(thresholds));
    store.set({ fits, thresholds, activeView: presetForZoom(engine.getCamera()?.zoom, fits) });
    // New thresholds may draw the stands on screen in another way (hidden, as chips or as polygons).
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
    markSettled(rootRef.current, false);
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

  const handleClick = useCallback(({ point, lngLat, hit }) => {
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
    // A terminal chip opens that terminal's view, as the view selector would.
    if (hit.kind === 'terminal') requestView('ramp', { terminal: String(hit.id) });
    else if (SELECTABLE_KINDS.has(hit.kind)) props.onSelect?.({ kind: hit.kind, id: String(hit.id) });
    // Anything else a screen's own layer lets pick (the graph nodes of the map lab's layout review) is the screen's.
    else props.onPick?.(hit);
  }, [store, showTooltip, requestView]);

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
    });
  }, [hoverTooltip]);

  // One engine for the life of the component. A StrictMode remount destroys the first one before the second starts.
  useEffect(() => {
    const props = latest.current;
    const pointer = pointerRef.current;
    store.set(initialSnapshot(props.basemap));
    appliedRef.current = {
      padding: props.padding, pitchMode: props.pitchMode, groups: null, selection: null, selectedStand: null,
      standFeatures: null, flights: null, overlayData: {}, drawsStands: props.drawsStands, drawsFlights: props.drawsFlights,
      standLabels: props.standLabels, drawsAirfield: Boolean(props.layout),
    };
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
      ...props.overlays,
    ];
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
      onIdle: () => {
        updateOnScreen();
        markSettled(rootRef.current, true);
      },
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
  }, [attached, standFeatures, flights, updateOnScreen]);

  // The drawn stands: one setData per source when the map starts, then one updateData per source with only the
  // features that changed (a board refresh, a minute's countdowns), never a new map. A re-read of the same positions
  // writes nothing.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsStands || applied.standFeatures === standFeatures) return;
    const previous = applied.standFeatures;
    applied.standFeatures = standFeatures;
    if (previous === null) {
      for (const name of STAND_FEATURE_COLLECTIONS) engine.setData(STAND_SOURCES[name], standFeatures[name]);
      markSettled(rootRef.current, false);
      return;
    }
    const diff = diffStandFeatures(previous, standFeatures);
    if (diff !== null) markSettled(rootRef.current, false);
    for (const name of STAND_FEATURE_COLLECTIONS) {
      if (!diff?.[name]) continue;
      engine.updateData(STAND_SOURCES[name], diff[name]).catch(error => {
        console.error('An OCC map could not update its stands.', error);
      });
    }
  }, [standFeatures]);

  // The flights: one setData when what they draw changes, never a new map. A re-read of the same flights in new
  // objects writes nothing.

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !appliedRef.current.drawsFlights) return;
    const data = toFlightFeatures(flights);
    const key = JSON.stringify(data.features);
    if (appliedRef.current.flights === key) return;
    appliedRef.current.flights = key;
    engine.setData(FLIGHT_SOURCE, data);
    markSettled(rootRef.current, false);
  }, [flights]);

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

  // The selection: one feature in the selection source (a stand's label point with its texts, a flight's ring),
  // written only when it changes, and the casing of a selected stand through its polygon's feature state, moved only
  // when another stand is selected.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const applied = appliedRef.current;
    const data = selectionFeatures(selection, {
      stands: [...attached, ...(presetStands ?? EMPTY)], flights, standLabels: standFeatures.labels,
    });
    const key = JSON.stringify(data.features);
    if (applied.selection !== key) {
      applied.selection = key;
      engine.setData(SELECTION_SOURCE, data);
      markSettled(rootRef.current, false);
    }
    const code = selection?.kind === 'stand' && applied.drawsStands ? mapStandCode(selection.id) || null : null;
    if (code === applied.selectedStand) return;
    if (applied.selectedStand !== null) engine.removeFeatureState(STAND_SOURCE, applied.selectedStand, 'selected');
    if (code !== null) engine.setFeatureState(STAND_SOURCE, code, { selected: true });
    applied.selectedStand = code;
    markSettled(rootRef.current, false);
  }, [selection, attached, presetStands, flights, standFeatures]);

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
    Object.defineProperty(handlers, 'clearSelection', {
      enumerable: true,
      get: () => {
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
    flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera, jumpTo, project, whenIdle,
  }), [flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera, jumpTo, project, whenIdle]);

  // The overlays read only these: the tooltip, which changes with the pointer, renders here and re-renders none of them.
  const {
    engineStatus, basemapStatus, activeView, fits, thresholds, standsOnScreen, chipsOnScreen, standMarksOnScreen,
    flightsOnScreen, airfieldOnScreen,
  } = snapshot;
  const context = useMemo(() => ({
    engineStatus,
    basemapStatus,
    activeView,
    fits,
    thresholds,
    standsOnScreen,
    chipsOnScreen,
    standMarksOnScreen,
    flightsOnScreen,
    airfieldOnScreen,
    requestView,
    flyToPreset,
    flyToStand,
    flyToFlight,
  }), [
    engineStatus, basemapStatus, activeView, fits, thresholds, standsOnScreen, chipsOnScreen, standMarksOnScreen,
    flightsOnScreen, airfieldOnScreen, requestView, flyToPreset, flyToStand, flyToFlight,
  ]);

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
    <OccMapContext.Provider value={context}>
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
