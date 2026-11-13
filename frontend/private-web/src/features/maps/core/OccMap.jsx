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
import { mapMessages } from '../mapMessages';
import { toStandFeatures } from '../stands/standFeatures';
import { STAND_SOURCE, standClusterOptions, standOverlay } from '../stands/standLayers';
import { createImageResolver } from '../style/mapImages';
import { buildOccStyle } from '../style/occStyle';
import { REFERENCE_SOURCE, referenceFeatures, referenceOverlay } from '../style/referenceLayers';
import { SELECTION_SOURCE, selectionFeatures, selectionOverlay } from '../style/selectionLayers';
import { FLIGHT_SOURCE, flightOverlay, toFlightFeatures } from '../traffic/flightLayers';
import { buildAttribution } from './attribution';
import {
  VIEW_NAMES, boundsCenter, cameraAngles, fitZooms, isRetired, lngLatOf, presetForZoom, presetTargets, sameFits,
  standCodeOf, standsInView, targetFor, thresholdsFromFits, transitionFor, unionBounds,
} from './cameraPresets';
import { createMapEngine } from './mapEngine';
import { matchFlight } from './mapSelection';
import MapUnavailable from './MapUnavailable';
import { OccMapContext } from './OccMapContext';
import { useMapSelection } from './useMapSelection';

// The one map component of the OCC (design A4). Client only: the pages load it through next/dynamic with ssr false.
// It owns one engine (core/mapEngine.js) for its whole life, the four views of contracts 2.3 with thresholds derived
// from the fitted zooms, the selection casing, the map keys of contracts 2.2 and the fallback list. DOM overlays come
// as children and reach the map through OccMapContext. It always draws the references (the ARP of PUJ); given
// `stands` it draws them as points in the stands slot, and given `flights` it draws those with a position. Their
// overlays are part of the style from the start, so new data is one setData and the map is never re-created.

const EMPTY = Object.freeze([]);
const NO_GROUPS = Object.freeze({});
const INSET_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);
const SELECTABLE_KINDS = new Set(['stand', 'flight', 'aircraft']);
const POINTER_KINDS = new Set([...SELECTABLE_KINDS, 'cluster']);
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
 * - `defaultView` ('ramp'), `presetStands` (the stands that frame the views; `stands` when absent), `stands` (the
 *   stands of the screen, with `status`; given at start, the map draws them, with `standLabels` 'default' or
 *   'dashboard'), `flights` (given at start, the map draws those with a position);
 * - `overlays` for buildOccStyle and `basemap`, `interactive`: read once, when the map starts, as are whether
 *   `stands` and `flights` are given and `standLabels`;
 * - `selection` (`{ kind, id }` or null) and `onSelect({ kind, id } | null)`; `onMapClick({ latitude, longitude })`
 *   while `placing`; `initialCamera` and `onCameraChange(camera)`;
 * - `pitchMode` ('2d' | '3d'), `groups` ({ 'buildings-3d': true }), `insets` ({ top, right, bottom, left } in px);
 * - `testId` of the host that holds the canvas, `labels` ({ unavailableTitle, unavailableDescription,
 *   unavailableList, map }), `fallbackItems` ([{ id, label, kind }]) and `onFallbackSelect(id, item)`;
 * - `isShortcutBlocked()` (an open drawer that is not a modal dialog), `className`, `children` (DOM overlays).
 */
const OccMap = forwardRef(function OccMap({
  defaultView = 'ramp',
  presetStands,
  stands: standsProp,
  standLabels = 'default',
  flights: flightsProp,
  overlays = EMPTY,
  selection = null,
  onSelect,
  onMapClick,
  placing = false,
  initialCamera,
  onCameraChange,
  pitchMode = '2d',
  groups = NO_GROUPS,
  insets,
  interactive = true,
  basemap = true,
  testId = 'occ-map-host',
  labels,
  fallbackItems,
  onFallbackSelect,
  isShortcutBlocked,
  className = '',
  children,
}, ref) {
  const { t } = useTranslation(mapMessages);
  const { view: urlView, terminal: urlTerminal, setView } = useMapSelection();
  const [store] = useState(() => createViewStore(initialSnapshot(basemap)));
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  const stands = standsProp ?? EMPTY;
  const flights = flightsProp ?? EMPTY;

  const paddingKey = insetsKey(normalizeInsets(insets));
  const padding = useMemo(() => insetsFromKey(paddingKey), [paddingKey]);
  const referenceStands = presetStands ?? stands;
  const targets = useMemo(() => presetTargets({ stands: referenceStands }), [referenceStands]);
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
      stands, presetStands: presetStands ?? EMPTY, flights, selection, onSelect, onMapClick, placing, onCameraChange,
      isShortcutBlocked, pitchMode, padding, targets, urlView, urlTerminal, defaultView, initialCamera, basemap,
      overlays, interactive, locale: engineLocale(t, labels?.map), aircraftDataLabel: t('attribution.aircraftData'),
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
    const target = targetFor(latest.current.targets, view, terminal);
    const camera = cameraFor(target?.bounds);
    if (!camera) {
      if (target && engineRef.current?.map) pendingViewRef.current = { view, terminal };
      return false;
    }
    pendingViewRef.current = null;
    moveCamera({ ...camera, ...cameraAngles(view, latest.current.pitchMode) }, { animate });
    return true;
  }, [cameraFor, moveCamera]);

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

  // The stands on screen change only when the camera or the stands do; the same list keeps its identity.
  const updateStandsOnScreen = useCallback(() => {
    const bounds = engineRef.current?.getBounds() ?? null;
    const next = bounds === null ? EMPTY : standsInView(latest.current.stands, bounds);
    const previous = store.get().standsOnScreen;
    if (standsKey(next) !== standsKey(previous)) store.set({ standsOnScreen: next.length === 0 ? EMPTY : next });
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
    if (thresholds) engine.applyThresholds(thresholds);
    // The stand clusters end where the stands are drawn on their own: one call per new limit.
    const applied = appliedRef.current;
    const clusters = applied.drawsStands ? standClusterOptions(thresholds, { labels: applied.standLabels }) : null;
    if (clusters && clusters.clusterMaxZoom !== applied.clusterMaxZoom) {
      applied.clusterMaxZoom = clusters.clusterMaxZoom;
      engine.setClusterOptions(STAND_SOURCE, clusters);
    }
    store.set({ fits, thresholds, activeView: presetForZoom(engine.getCamera()?.zoom, fits) });
    const pending = pendingViewRef.current;
    if (fits && pending) applyView(pending.view, { terminal: pending.terminal, animate: false });
  }, [store, applyView]);

  const handleCamera = useCallback((camera, details) => {
    if (!camera) return;
    // A person moved the map: a view still waiting for room is no longer wanted.
    if (details?.byUser) pendingViewRef.current = null;
    // The zoom is written straight to the DOM, without a render: the visual suite reads it to see the camera move.
    rootRef.current?.setAttribute('data-occ-zoom', camera.zoom.toFixed(2));
    store.set({ activeView: presetForZoom(camera.zoom, store.get().fits) });
    updateStandsOnScreen();
    latest.current?.onCameraChange?.(camera, details);
  }, [store, updateStandsOnScreen]);

  const handleStatus = useCallback(status => {
    store.set({ engineStatus: status.engine, basemapStatus: status.basemap });
  }, [store]);

  const handleClick = useCallback(async ({ lngLat, hit }) => {
    const props = latest.current;
    if (props.placing) {
      if (lngLat) props.onMapClick?.({ latitude: lngLat[1], longitude: lngLat[0] });
      return;
    }
    if (!hit || hit.id == null) return;
    if (hit.kind === 'cluster') {
      const source = hit.feature?.source ?? hit.feature?.layer?.source;
      const center = hit.feature?.geometry?.type === 'Point' ? hit.feature.geometry.coordinates : lngLat;
      await engineRef.current?.expandCluster(source, hit.id, center);
      return;
    }
    if (SELECTABLE_KINDS.has(hit.kind)) props.onSelect?.({ kind: hit.kind, id: String(hit.id) });
  }, []);

  // The cursor follows what is under the pointer, picked once per frame.
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
      engine.setCursor(hit && POINTER_KINDS.has(hit.kind) ? 'pointer' : '');
    });
  }, []);

  // One engine for the life of the component. A StrictMode remount destroys the first one before the second starts.
  useEffect(() => {
    const props = latest.current;
    const pointer = pointerRef.current;
    store.set(initialSnapshot(props.basemap));
    appliedRef.current = {
      padding: props.padding, pitchMode: props.pitchMode, groups: null, selection: null, stands: null, flights: null,
      clusterMaxZoom: null, drawsStands: props.drawsStands, drawsFlights: props.drawsFlights, standLabels: props.standLabels,
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

    const overlays = [
      selectionOverlay(),
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
      mapOptions: { locale: props.locale },
      onStatus: handleStatus,
      onCamera: handleCamera,
      onResize: refit,
      onClick: handleClick,
      onPointerMove: handlePointer,
    });
    engineRef.current = engine;
    engine.setData(REFERENCE_SOURCE, referenceFeatures());
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
  }, [store, applyView, handleCamera, handleClick, handlePointer, handleStatus, refit]);

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

  // The insets: camera padding and control positions, and new fits and thresholds.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || appliedRef.current.padding === padding) return;
    appliedRef.current.padding = padding;
    engine.setInsets(padding);
    refit();
  }, [padding, refit]);

  // New stands may change what frames the views and what is on screen.
  useEffect(() => {
    refit();
  }, [targets, refit]);

  useEffect(() => {
    updateStandsOnScreen();
  }, [stands, updateStandsOnScreen]);

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

  useEffect(() => {
    engineRef.current?.setCursor(placing ? 'crosshair' : '');
  }, [placing]);

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
    flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera,
  }), [flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera]);

  const context = useMemo(() => ({
    engineStatus: snapshot.engineStatus,
    basemapStatus: snapshot.basemapStatus,
    activeView: snapshot.activeView,
    fits: snapshot.fits,
    thresholds: snapshot.thresholds,
    standsOnScreen: snapshot.standsOnScreen,
    requestView,
    flyToPreset,
    flyToStand,
    flyToFlight,
  }), [snapshot, requestView, flyToPreset, flyToStand, flyToFlight]);

  // The list of the fallback: the adapter's own items, else the stands of the screen, else those that frame the views.
  const listedStands = stands.length > 0 ? stands : referenceStands;
  const items = useMemo(() => fallbackItems ?? standsInView(listedStands)
    .map(stand => ({ id: standCodeOf(stand), label: standCodeOf(stand), kind: 'stand' }))
    .filter(item => item.id !== ''), [fallbackItems, listedStands]);
  const selectFallback = (id, item) => {
    if (onFallbackSelect) onFallbackSelect(id, item);
    else onSelect?.({ kind: item?.kind ?? 'stand', id });
  };
  const unavailable = snapshot.engineStatus === 'unavailable';

  return (
    <OccMapContext.Provider value={context}>
      <div
        ref={rootRef}
        data-testid="occ-map"
        data-occ-view={snapshot.activeView ?? undefined}
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
        {!unavailable && snapshot.basemapStatus === 'degraded' && (
          <p role="status" className="occ-map-chip rounded-md border border-occ-line bg-occ-panel-float px-3 py-2 text-sm text-occ-text">
            {t('basemap.degraded')}
          </p>
        )}
        {children}
      </div>
    </OccMapContext.Provider>
  );
});

export default OccMap;
