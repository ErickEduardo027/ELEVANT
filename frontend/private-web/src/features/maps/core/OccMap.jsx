'use client';

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from 'react';
import * as maplibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../../styles/occ-map.css';
import { useTranslation } from '../../../i18n/LanguageScope';
import { useOccBoot } from '../../admin-occ/boot/occBootContext';
import { createOccShortcutHandler } from '../../occ-ui/occShortcuts';
import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { airfieldFeatures } from '../airport/airfieldFeatures';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM } from '../airport/geo';
import { followCamera, needsReframe, stepCamera } from '../kinematics/followCamera';
import { mapMessages } from '../mapMessages';
import { ghostFeatures, placedLocation, placingGhost } from '../stands/placing';
import {
  STAND_FEATURE_COLLECTIONS, boxOfPoints, boxesMeet, buildStandFeatures, diffStandFeatures, featuresIn,
  parkedAircraftIds, standSignalOf, standsDrawnIn,
} from '../stands/standFeatures';
import {
  featureStatePlan, findStandByCode, isOutsideSafeArea, sameAgentMark, standFlags, standTooltip,
} from '../stands/standInteractions';
import { STAND_GHOST_SOURCE, STAND_SOURCE, STAND_SOURCES, standDisplayAt, standOverlay } from '../stands/standLayers';
import { attachStandGeometry, standStateOf } from '../stands/standModel';
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
  ROUTE_SOURCE, TRAFFIC_SOURCE, TRAILS_SOURCE, featuresById, isDrawn, isEmptyDiff, onScreenKey, selectedAircraftId,
  trafficDiff, trafficFeatures, trafficOnScreen as trafficOnScreenOf,
} from '../traffic/trafficFeatures';
import { trafficOverlay } from '../traffic/trafficLayers';
import { aircraftCard, flightRowOf } from '../ui/aircraftCard';
import AltitudeLegend from '../ui/AltitudeLegend';
import MapTooltip from '../ui/MapTooltip';
import { buildAttribution } from './attribution';
import {
  PUJ_ARP, VIEW_NAMES, boundsCenter, cameraAngles, fitZooms, isInBounds, isRetired, lngLatOf, presetForZoom,
  presetTargets, sameFits, standCodeOf, standsInView, targetFor, thresholdsFromFits, transitionFor, unionBounds,
} from './cameraPresets';
import { createFrameLoop, createRenderClock, metresPerPixel, updateIntervalMs } from './frameLoop';
import {
  availableLayerKeys, engineGroupsFor, readLayerOverrides, resolveLayers, setLayerOverride, writeLayerOverrides,
} from './layersMenu';
import { createMapEngine } from './mapEngine';
import { matchFlight, relatedEntities } from './mapSelection';
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
// map's minute clock. A stand under the pointer shows its tooltip and, as the selected one does, marks the stands
// covered by the same agent; selecting a stand outside the area in sight eases the camera to it; and while a stand is
// placed («Ubicar en el mapa», design D5) its box follows the pointer and a click gives a pending location (all
// feature-state or one source of their own: stands/standInteractions.js, stands/placing.js). Given `flights` it draws
// those with a position. Their overlays are part of the style from the start, so the first data is one setData per
// source and every later change one updateData with what changed: the map is never re-created. A screen's own overlays
// get their data through `overlayData`.

const EMPTY = Object.freeze([]);
const NO_FLAGS = Object.freeze({ hover: null, selected: null, related: null, sameAgent: Object.freeze(new Set()) });
const NO_CODES = Object.freeze(new Set());
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
// What the legend reads of a stand on screen: its state, the signal the map draws on it and where its location comes
// from.
const standsKey = stands => stands
  .map(stand => [standCodeOf(stand), standStateOf(stand), standSignalOf(stand) ?? '', stand.locationSource ?? ''].join(':'))
  .join('|');
const sameList = (first, second) => first.join('|') === second.join('|');
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

// The stand of the ELEVANT aircraft the traffic draws for a chosen flight (its assigned stand, normalized), or null.
function trafficStandOf(aircraft, selection) {
  const list = aircraft ?? EMPTY;
  const chosen = selectedAircraftId(list, selection);
  const code = chosen === null ? null : list.find(entry => entry.id === chosen)?.standCode;
  return typeof code === 'string' && code !== '' ? mapStandCode(code) || null : null;
}

// Where the traffic draws the ELEVANT aircraft a flight id names (any id matchFlight reads), as `[lng, lat]`, or null.
function trafficPoint(aircraft, id) {
  const list = aircraft ?? EMPTY;
  const chosen = selectedAircraftId(list, { kind: 'flight', id });
  const item = chosen === null ? null : list.find(entry => entry.id === chosen);
  return item ? [item.lon, item.lat] : null;
}

// The legend reads the moving traffic at most this often while it moves (PR M6): once a second.
const MOVING_ON_SCREEN_MS = 1_000;

// The aircraft a stand draws instead of the traffic (PR M6, design F4): none, and whether the map draws the stands, and
// so the aircraft on them, at a zoom: from the polygons threshold on, as a glyph and from the codes on to scale
// (anywhere before the thresholds are known: the layers have no zoom range yet).
const NO_IDS = Object.freeze(new Set());
const standsDrawnAt = (zoom, thresholds) => !Number.isFinite(thresholds?.polygons) || !Number.isFinite(zoom)
  || zoom >= thresholds.polygons;
const MOTION_OFF = Object.freeze({ available: false, paused: false, pausedAt: null, dataAt: null });

// The chosen flight's route follows its aircraft (PR M6, design E5): rewritten at most once a second below the
// airfield threshold, and from it every frame in which the aircraft moved at least half a pixel on screen.
const ROUTE_FRAME_MS = 1_000;
const ROUTE_MOVE_PX = 0.5;

// Follow mode (PR M6, design A6, contracts 2.1 `follow=1`). A framing of two points keeps this much room inside the
// insets; the notice «Dejaste de seguir…» shows this long; while the camera moves every frame what is on screen is read
// at most once a second; and closer than half a pixel, a hundredth of a zoom level and a tenth of a degree of tilt the
// camera is where follow mode wants it.
const FOLLOW_MARGIN_PX = 24;
const FOLLOW_NOTICE_MS = 8_000;
const FOLLOW_ON_SCREEN_MS = 1_000;
const FOLLOW_SETTLED = Object.freeze({ px: 0.5, zoom: 0.01, pitch: 0.1 });
const FOLLOW_OFF = Object.freeze({
  on: false, key: null, engage: false, transition: false, zoomFrozen: false, pitchFrozen: false, converged: true,
});

const lngLatArray = center => {
  if (Array.isArray(center)) return [center[0], center[1]];
  return center && Number.isFinite(center.lng) && Number.isFinite(center.lat) ? [center.lng, center.lat] : null;
};

// What a notice calls the followed aircraft, as its data block does: its flight number, callsign, registration or
// ADS-B address.
function followedName(item) {
  const name = [item?.flightNumber, item?.callsign, item?.registration, item?.hex?.toUpperCase()]
    .find(value => typeof value === 'string' && value.trim() !== '');
  return name ? name.trim() : '—';
}

// The camera follow mode aims at (kinematics/followCamera.js): a 'center' framing as it is; a 'bounds' one fitted by the
// map in the area the insets leave (plus a margin) at the bearing on screen, its zoom capped. `null` when it cannot be
// fitted. The bearing is the person's: follow mode never turns the map.
function followTarget(engine, framing, current, padding) {
  if (framing.kind !== 'bounds') return { center: [framing.center[0], framing.center[1]], zoom: framing.zoom, pitch: framing.pitch };
  const fitted = engine.cameraForBounds(framing.bounds, {
    padding: addPadding(padding, FOLLOW_MARGIN_PX), absolutePadding: true, bearing: current.bearing ?? 0,
    maxZoom: framing.maxZoom,
  });
  const center = lngLatArray(fitted?.center);
  if (center === null || !Number.isFinite(fitted?.zoom)) return null;
  return { center, zoom: Math.min(fitted.zoom, framing.maxZoom), pitch: framing.pitch };
}

// Whether a camera is where follow mode wants it (FOLLOW_SETTLED).
function settledAt(camera, target) {
  const px = haversineM(camera.center, target.center) / metresPerPixel(camera.zoom, camera.center[1]);
  return px < FOLLOW_SETTLED.px && Math.abs(camera.zoom - target.zoom) < FOLLOW_SETTLED.zoom
    && Math.abs((camera.pitch ?? 0) - (target.pitch ?? 0)) < FOLLOW_SETTLED.pitch;
}

// Whether the browser asks for reduced motion; false where it cannot say (jsdom has no matchMedia).
function reducedMotionQuery() {
  return typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null;
}

/**
 * How long until the next write of the moving traffic (core/frameLoop.js, design H): every frame with fewer than 30
 * aircraft drawn in the area in sight, otherwise at half the fastest one's pixels per second on screen, 2 to 30 Hz.
 */
function writeIntervalFor(engine, aircraft, padding) {
  const bounds = engine.getVisibleBounds(padding);
  const zoom = engine.getCamera()?.zoom;
  if (bounds === null || !Number.isFinite(zoom)) return 0;
  let inView = 0;
  let fastest = 0;
  for (const item of aircraft) {
    if (!isDrawn(item) || !isInBounds([item.lon, item.lat], bounds)) continue;
    inView += 1;
    if (Number.isFinite(item.gsMs) && item.gsMs > 0) fastest = Math.max(fastest, item.gsMs / metresPerPixel(zoom, item.lat));
  }
  return updateIntervalMs({ inView, fastestPxPerSecond: fastest });
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

// Where the tooltip of a stand sits: under the stand's box on screen (its polygon's pixels), or over it when the stand
// is in the lower half of the visible area, starting at the box's outer side and running towards the middle. A stand's
// label is centred on its box and may be wider than it, so the card never covers the stand or its label. `null`
// without a polygon, or when the box takes more than half the height in sight (the card then follows the pointer).
function standTooltipPlacement(engine, padding, polygon) {
  const points = (Array.isArray(polygon) ? polygon : []).map(point => engine.project(point)).filter(Boolean);
  const bounds = engine.getVisibleBounds(padding);
  if (points.length === 0 || bounds === null) return null;
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const corners = [bounds[0], bounds[1]].map(corner => engine.project(corner)).filter(Boolean);
  const middle = engine.project(boundsCenter(bounds));
  if (corners.length < 2 || !middle || bottom - top > Math.abs(corners[0].y - corners[1].y) / 2) return null;
  const toRight = (left + right) / 2 > middle.x;
  const above = (top + bottom) / 2 > middle.y;
  return { x: toRight ? right : left, y: above ? top : bottom, alignX: toRight ? 'end' : 'start', alignY: above ? 'end' : 'start' };
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
  // The traffic drawn in the area the insets leave in sight (PR M5): its kinds, tags and trails.
  trafficOnScreen: NO_TRAFFIC_ON_SCREEN,
  // The keys of the layers menu this map's style has layers for (PR M5, core/layersMenu.js).
  layerKeys: EMPTY,
  // The motion of the traffic (PR M6): whether this map moves it, whether «Pausar movimiento» holds it and since when,
  // and the server instant of the newest data it draws.
  motion: MOTION_OFF,
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
 * - `selection` (`{ kind, id }` or null) and `onSelect({ kind, id } | null)`; a selected stand outside the area in
 *   sight brings the camera to it at the same zoom (never the stand flyToStand was just asked for); a click on a
 *   terminal chip opens that terminal's view; `onPick(hit)` for a click on anything else a layer lets pick
 *   (`{ kind, id, feature }` as the engine answers it: not a stand, a flight, an aircraft, a terminal, a runway or a
 *   taxiway); `initialCamera` and `onCameraChange(camera)`;
 * - placing a stand (ADR-0027): `placing` (a crosshair, and a click gives `onMapClick({ latitude, longitude })`), or
 *   `placingStand` (`{ code, sizeHint }`: also the stand's box at the pointer, and the click gives
 *   `onMapClick({ latitude, longitude, snapped })`, the layout's centre when the box snapped to it), `pendingLocation`
 *   (`{ latitude, longitude }`, the pending box) and `onCancelPlacing()`, which Esc calls before it would clear the
 *   selection;
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
 * - The motion of the traffic (PR M6, design H): when `traffic.motion` is given at start (traffic/motionStore.js, with
 *   its render clock as `motion.clock`), the map runs one frame loop for the life of its engine (core/frameLoop.js).
 *   Each frame samples the aircraft at the render clock's time and writes them with one updateData of what changed:
 *   every frame with fewer than 30 aircraft in sight, else at half the fastest one's pixels per second (2 to 30 Hz).
 *   The loop asks for frames only while something moves, wakes for a new situation, a selection, the groups, the
 *   language or a camera move, stops in a hidden tab and ticks once a second under reduced motion; React renders
 *   nothing per frame. OccMapContext's `motion` offers «Pausar movimiento» (ui/MapMotionControl.jsx). Without
 *   `traffic.motion` the traffic is drawn where the situation puts it, as in PR M5.
 * - The chosen flight's route (PR M6, design E5): `traffic.route` is drawn as it comes (its parts are listed for the
 *   legend); with motion, `traffic.routeAt(tMs, [lng, lat])` rebuilds it where the frame draws the chosen aircraft, so
 *   the split between flown and still to fly follows it: at most once a second below the airfield threshold, and from
 *   it every frame the aircraft moves on screen.
 * - Follow mode (PR M6, design A6, contracts 2.1 and 2.2): `follow=1` in the URL (useMapSelection), the S key, and
 *   OccMapContext's `follow` (`{ available, following, canFollow, toggle }`, ui/MapFollowButton.jsx and the data
 *   block's «Seguir»). It needs the motion's frame loop and a chosen flight or aircraft the map draws; it follows the
 *   selection as long as it names one, so a flight keeps being followed through its import (its flightKey stays) and a
 *   3-N07 link (its old key resolves through its proposalId), and a selection that names nothing or a stand ends it. It
 *   engages with one move of the map to the aircraft and its next objective, then each frame eases the camera there
 *   (kinematics/followCamera.js: followCamera, stepCamera; a 'bounds' framing fitted with cameraForBounds inside the
 *   insets and its zoom capped). Under reduced motion it jumps there only when the framing's centre leaves the middle of
 *   the area in sight or the aircraft nears its edge (needsReframe). A person's drag ends it with «Dejaste de seguir a
 *   … Pulsa Seguir para volver.», as does a view asked for; a person's zoom or tilt keeps following with that zoom or
 *   tilt; a change of `pitchMode` engages it again with the new tilt; nothing moves the camera while a person moves the
 *   map.
 * - The stands fed by the flights (PR M6, design D1 to D3): a stand whose display names an aircraft type draws it to
 *   scale from the codes threshold on (solid on the stand, dashed while it comes) and, with an aircraft on it, the
 *   progress of its turnaround from the three-line labels on; the legend explains both while they are in sight. One
 *   owner per aircraft (design F4): where the stands are drawn (from the polygons threshold on), an ELEVANT aircraft
 *   parked in the stand that shows it (its glyph, and from the codes on its footprint) is the stand's
 *   (stands/standFeatures.js: parkedAircraftIds), so every write of the traffic flags it (`parkedOnStand`) and its
 *   symbol gives way, unless it is the chosen one; a zoom across the polygons threshold, a new fit or new stands write
 *   the traffic again for it.
 */
const OccMap = forwardRef(function OccMap({
  defaultView = 'ramp',
  layout = MDPC_LAYOUT,
  presetStands,
  stands: standsProp,
  standLabels = 'default',
  frozenAt = null,
  flights: flightsProp,
  traffic,
  overlays = EMPTY,
  overlayData,
  selection = null,
  onSelect,
  onPick,
  onMapClick,
  placing = false,
  placingStand = null,
  pendingLocation = null,
  onCancelPlacing,
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
  const { markReady } = useOccBoot();
  const { view: urlView, terminal: urlTerminal, setView, follow: urlFollow, setFollow } = useMapSelection();
  const [store] = useState(() => createViewStore(initialSnapshot(basemap)));
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  const stands = standsProp ?? EMPTY;
  const flights = flightsProp ?? EMPTY;
  // Follow mode (PR M6): the aircraft the selection names, when the map draws it, and whether the map can follow it
  // (it moves its traffic frame by frame); following while the URL says so.
  const trafficAircraft = traffic?.aircraft ?? EMPTY;
  const selectionKey = selection ? `${selection.kind}:${selection.id}` : '';
  const followedId = useMemo(() => (selection?.kind === 'flight' || selection?.kind === 'aircraft'
    ? selectedAircraftId(trafficAircraft, selection) : null), [trafficAircraft, selection]);
  const followAvailable = snapshot.motion.available && snapshot.engineStatus !== 'unavailable';
  const canFollow = followAvailable && followedId !== null;
  const followingNow = followAvailable && urlFollow === true;
  const [followNotice, setFollowNotice] = useState(null);
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
  // What the traffic draws depends on its own groups only: the references (the region's airports, which follow the view)
  // never rewrite it.
  const trafficGroupsKey = JSON.stringify(Object.entries(shownGroups).filter(([group]) => !group.startsWith('reference.')));
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
  // The stand flyToStand was last asked for: when the selection then comes to it, the camera is already on its way.
  const focusRef = useRef(null);
  const placingNow = placing || placingStand !== null;

  // The newest props for engine callbacks and imperative calls; assigned after each render, never during it.
  useLayoutEffect(() => {
    latest.current = {
      stands, attached, standFeatures, presetStands: presetStands ?? EMPTY, flights, selection, onSelect, onPick,
      onMapClick, placing: placingNow, placingStand, onCancelPlacing, onCameraChange, isShortcutBlocked, pitchMode,
      padding, targets, urlView, urlTerminal, defaultView, initialCamera, basemap, overlays, interactive, mapOptions,
      layout, t, language,
      locale: engineLocale(t, labels?.map),
      aircraftDataLabel: t('attribution.aircraftData'),
      drawsStands: standsProp !== undefined, drawsFlights: flightsProp !== undefined, standLabels,
    };
    // The traffic (PR M5): what it draws, the groups the map shows (the page's and the layers menu's), the words of its
    // tags, the trails it draws beside the chosen flight's route, and the layers menu the map keys open and close.
    Object.assign(latest.current, { traffic: traffic ?? null, drawsTraffic: traffic !== undefined, groups: shownGroups,
      language, shownTrails, layersMenuOpen, setLayersMenuOpen });
    // Follow mode (PR M6): what the URL says and how to change it.
    Object.assign(latest.current, { urlFollow: urlFollow === true, setFollow });
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

  // Follow mode ends (PR M6): at once for the frames, then in the URL; `notice` says so to the person who moved the
  // camera away («Dejaste de seguir a … Pulsa Seguir para volver.»).
  const stopFollowing = useCallback(({ notice = false } = {}) => {
    const applied = appliedRef.current;
    const state = applied.follow;
    const wasOn = state?.on === true;
    if (state) Object.assign(state, { on: false, engage: false, transition: false });
    if (notice && wasOn) setFollowNotice({ name: followedName(applied.chosen) });
    if (latest.current?.urlFollow) latest.current.setFollow(false);
  }, []);

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

  // A move to somewhere else, asked for by a person or a page, ends follow mode first (PR M6) and says so.
  const flyToPreset = useCallback((view, { terminal = null } = {}) => {
    stopFollowing({ notice: true });
    return applyView(view, { terminal });
  }, [applyView, stopFollowing]);

  // A view asked for by a person: fly now (also to the view already in the URL after a free zoom) and write `view=`.
  const requestView = useCallback((view, { terminal = null } = {}) => {
    if (!VIEW_NAMES.includes(view)) return;
    stopFollowing({ notice: true });
    const viewTerminal = view === 'ramp' ? terminal : null;
    lastViewRef.current = viewKey(view, viewTerminal);
    applyView(view, { terminal: viewTerminal });
    setView(view, { terminal: viewTerminal });
  }, [applyView, setView, stopFollowing]);

  const flyToStand = useCallback((code, { minZoom } = {}) => {
    const engine = engineRef.current;
    const { attached: drawn, presetStands: reference, padding: inset } = latest.current ?? {};
    const point = standPointOf(findStand([...(drawn ?? EMPTY), ...(reference ?? EMPTY)], code));
    const camera = engine?.getCamera();
    if (!point || !camera) return false;
    stopFollowing({ notice: true });
    const fits = store.get().fits;
    const focus = Number.isFinite(minZoom) ? minZoom : fits ? fits.ramp + STAND_FOCUS_OVER_RAMP : camera.zoom;
    focusRef.current = mapStandCode(code) || null;
    moveCamera({ center: point, zoom: Math.max(camera.zoom, focus), padding: inset });
    return true;
  }, [moveCamera, store, stopFollowing]);

  // Centres a flight that has a position (by any id matchFlight reads), keeping the zoom unless `minZoom` asks for more.
  // While follow mode frames the selection the camera is already on its way (PR M6): nothing more to do.
  const flyToFlight = useCallback((id, { minZoom } = {}) => {
    const engine = engineRef.current;
    if (appliedRef.current.follow?.on && engine?.map) return true;
    const { flights: current, padding: inset } = latest.current ?? {};
    const flight = matchFlight(current ?? EMPTY, id);
    // A flight the traffic draws (PR M5) is where its aircraft is drawn now (PR M6: where its last frame put it).
    const drawnAircraft = appliedRef.current.sampledAircraft ?? latest.current?.traffic?.aircraft;
    const point = lngLatOf(flight?.position ?? flight) ?? trafficPoint(drawnAircraft, id);
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
    stopFollowing({ notice: true });
    const view = presetForZoom(camera.zoom, store.get().fits) ?? 'ramp';
    moveCamera({ ...camera, ...cameraAngles(view, latest.current.pitchMode) });
    return true;
  }, [cameraFor, moveCamera, store, stopFollowing]);

  const flyToAll = useCallback(() => flyToPreset('ramp'), [flyToPreset]);
  const flyToPuj = useCallback(() => flyToPreset('airfield'), [flyToPreset]);
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

  // The traffic (PR M5). The aircraft of other traffic under the pointer, whose tag shows while it is there.
  const trafficFocusRef = useRef(null);

  // The traffic's features from the newest props: one updateData with what changed since the last write. With motion
  // (PR M6) the aircraft are those of the situation where they are drawn at `tMs` (the frame's instant, else the render
  // clock's now), and the write says how long until the next one is due.
  const writeTraffic = useCallback((tMs = null) => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsTraffic) return;
    const { traffic: current, selection: chosen, groups: shown, language: words, padding: inset } = latest.current;
    const motion = applied.loop ? current?.motion ?? null : null;
    const aircraft = current?.aircraft ?? EMPTY;
    let drawn = aircraft;
    if (motion) {
      const t = Number.isFinite(tMs) ? tMs : applied.loop.now();
      drawn = motion.sample(aircraft, t).filter(Boolean);
      applied.trafficWrittenAt = t;
      applied.trafficIntervalMs = writeIntervalFor(engine, drawn, inset);
    }
    applied.sampledAircraft = motion ? drawn : null;
    // The chosen aircraft where this write draws it (PR M6): its route and follow mode go with it.
    const chosenId = selectedAircraftId(drawn, chosen);
    applied.chosen = chosenId === null ? null : drawn.find(item => item.id === chosenId) ?? null;
    // One owner per aircraft (PR M6, design F4): where the stands are drawn, an ELEVANT aircraft parked in the stand that
    // shows it is the stand's, and its symbol gives way to the stand's footprint or glyph.
    const standsShown = applied.drawsStands === true && standsDrawnAt(engine.getCamera()?.zoom, store.get().thresholds);
    applied.standsShown = standsShown;
    applied.parkedIds = standsShown ? parkedAircraftIds(drawn, latest.current.attached) : NO_IDS;
    const data = trafficFeatures(drawn, {
      selection: chosen, focusId: trafficFocusRef.current, labelsOn: shown?.['traffic.labels'] === true, language: words,
      parkedIds: applied.parkedIds,
    });
    const diff = trafficDiff(applied.trafficById, data.features);
    if (isEmptyDiff(diff)) return;
    applied.trafficById = featuresById(data);
    engine.updateData(TRAFFIC_SOURCE, diff).catch(error => console.error('The OCC map could not update its traffic.', error));
  }, [store]);

  // A camera or a fit that takes the zoom across the polygons threshold shows or hides the stands and the aircraft on
  // them (PR M6): the parked aircraft's symbols go or come back with them, in one write.
  const syncParkedTraffic = useCallback(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsTraffic || !applied.drawsStands) return;
    if (standsDrawnAt(engine.getCamera()?.zoom, store.get().thresholds) !== applied.standsShown) writeTraffic();
  }, [store, writeTraffic]);

  // The chosen flight's route where the last write drew its aircraft (PR M6, design E5): `traffic.routeAt` rebuilds it
  // so the split follows the aircraft, at most once a second below the airfield threshold and from it every frame the
  // aircraft moved half a pixel on screen. One setData; the route the props bring is written by its own effect.
  const writeFrameRoute = useCallback(tMs => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    const { traffic: current, groups: shown } = latest.current ?? {};
    const item = applied.chosen;
    if (!engine?.map || !applied.drawsTraffic || typeof current?.routeAt !== 'function' || !item || shown?.route === false) return;
    const zoom = engine.getCamera()?.zoom;
    if (!Number.isFinite(zoom)) return;
    const point = [item.lon, item.lat];
    const last = applied.routeFrame;
    if (last !== null && last.id === item.id) {
      const movedPx = haversineM(last.point, point) / metresPerPixel(zoom, item.lat);
      if (movedPx < ROUTE_MOVE_PX) return;
      const airfield = store.get().thresholds?.airfield;
      const everyFrame = Number.isFinite(airfield) && zoom >= airfield;
      if (!everyFrame && tMs - last.at < ROUTE_FRAME_MS) return;
    }
    applied.routeFrame = { id: item.id, at: tMs, point };
    // What the source holds is no longer what the props brought: their next route is written again.
    applied.route = null;
    engine.setData(ROUTE_SOURCE, current.routeAt(tMs, point) ?? EMPTY_COLLECTION);
  }, [store]);

  // The traffic drawn in `bounds` (the area the insets leave in sight), for the legend and the credit: where the last
  // write drew it when it moves.
  const updateTrafficOnScreen = useCallback((bounds, zoom, thresholds) => {
    const current = latest.current?.traffic;
    const drawn = appliedRef.current.sampledAircraft ?? current?.aircraft ?? EMPTY;
    const next = appliedRef.current.drawsTraffic && bounds !== null
      ? trafficOnScreenOf(drawn, bounds, {
        groups: latest.current.groups, zoom, thresholds, trails: latest.current.shownTrails ?? null,
        route: current?.route ?? null, parkedIds: appliedRef.current.parkedIds ?? null,
      })
      : NO_TRAFFIC_ON_SCREEN;
    if (onScreenKey(next) !== onScreenKey(store.get().trafficOnScreen)) store.set({ trafficOnScreen: next });
  }, [store]);

  // What is drawn in the area the insets leave in sight (the page's panels hide what lies under them), for the legend,
  // which explains only what is on screen (contracts 2.4): the stands whose polygon reaches into that area from the
  // polygon threshold on, the terminal chips drawn there below it with the arrow over a chip whose terminal has a stand
  // in «Llegando», the combined links, narrow-body boxes and same-agent rings drawn there, the flights drawn there and
  // the airfield items drawn there. The stands and the chips are known from their own geometry; the airfield is read
  // back from the map from its threshold on, and right after a move the tiles of the new zoom may still be loading, so
  // it is read again when the map settles (onIdle). They change only when the camera, the insets, the thresholds, the
  // stands, the flights or what the map draws do, and a list keeps its identity while what the legend reads of it stays
  // the same.
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
    const chipsInSight = display === 'chips' ? featuresIn(features.groups, bounds) : EMPTY;
    const chips = chipsInSight.map(chip => chip.id);
    // The narrow-body boxes are drawn from the codes threshold on, the combined links with the polygons.
    const codesShown = !Number.isFinite(thresholds?.codes) || zoom >= thresholds.codes;
    const drawsAux = (kind, from) => from && featuresIn(features.aux, bounds, { kind }).length > 0;
    // The ring of the same agent is explained from what the feature-state draws (applyStandFlags): while it rings a
    // polygon in sight, with whose agent it follows, the stand under the pointer or the selected one (sameAgentMark). A
    // stand under the pointer without an agent rings nothing, so nothing is explained. The placing boxes at every
    // zoom, while they are in sight.
    const { standFlags: flags = NO_FLAGS, ghost, pendingGhost } = appliedRef.current;
    const ringMark = sameAgentMark(flags);
    const ringed = ringMark === null ? NO_CODES : new Set(flags.sameAgent);
    const ringInSight = polygons && ringMark !== null
      && standsDrawnIn(drawnStands.filter(stand => ringed.has(mapStandCode(standCodeOf(stand)))), bounds).length > 0;
    const boxInSight = box => bounds !== null && Array.isArray(box?.polygon) && boxesMeet(boxOfPoints(box.polygon), bounds);
    // The aircraft to scale are drawn from the codes threshold on, the progress bars with the three-line labels (PR M6).
    const footprintKinds = new Set(polygons && codesShown && features.footprints
      ? featuresIn(features.footprints, bounds).map(item => item.properties?.kind) : EMPTY);
    const threeLineShown = !Number.isFinite(thresholds?.threeLine) || zoom >= thresholds.threeLine;
    const marks = [
      // The arrow over a chip is drawn with the chips (stands/standLayers.js: occ-stand-groups-arriving).
      ...(chipsInSight.some(chip => chip.properties?.arriving === true) ? ['chipArriving'] : []),
      ...(footprintKinds.has('solid') ? ['footprint'] : []),
      ...(footprintKinds.has('planned') ? ['footprintPlanned'] : []),
      ...(drawsAux('progressTrack', polygons && threeLineShown) ? ['progress'] : []),
      ...(drawsAux('combinedLink', polygons) ? ['combined'] : []),
      ...(drawsAux('narrowInner', polygons && codesShown) ? ['narrowbody'] : []),
      ...(ringInSight ? [ringMark] : []),
      ...(boxInSight(ghost) ? ['ghost'] : []),
      ...(boxInSight(pendingGhost) ? ['pending'] : []),
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
    // Without its own airfield the map leaves the tile aeroway at every zoom.
    if (thresholds) engine.applyThresholds(appliedRef.current.drawsAirfield ? thresholds : withoutAirfield(thresholds));
    store.set({ fits, thresholds, activeView: presetForZoom(engine.getCamera()?.zoom, fits) });
    // New thresholds may draw the stands on screen in another way (hidden, as chips or as polygons), and their aircraft
    // to scale from another zoom.
    updateOnScreen();
    syncParkedTraffic();
    const pending = pendingViewRef.current;
    if (fits && pending) applyView(pending.view, { terminal: pending.terminal, animate: false });
  }, [store, applyView, updateOnScreen, syncParkedTraffic]);

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
    const applied = appliedRef.current;
    // A person moved the map: a view still waiting for room is no longer wanted.
    if (details?.byUser) pendingViewRef.current = null;
    // The zoom is written straight to the DOM, without a render: the visual suite reads it to see the camera move.
    rootRef.current?.setAttribute('data-occ-zoom', camera.zoom.toFixed(2));
    markSettled(rootRef.current, false);
    store.set({ activeView: presetForZoom(camera.zoom, store.get().fits) });
    followTooltip();
    syncParkedTraffic();
    // Follow mode moves the camera every frame (PR M6): what is on screen, and the page, hear of it at most once a
    // second then, and again when the map settles.
    if (applied.followMoving) {
      const at = applied.followFrameAt;
      const recent = Number.isFinite(applied.followOnScreenAt) && at >= applied.followOnScreenAt
        && at - applied.followOnScreenAt < FOLLOW_ON_SCREEN_MS;
      if (recent) return;
      applied.followOnScreenAt = at;
      updateOnScreen();
      latest.current?.onCameraChange?.(camera, details);
      return;
    }
    // The move that engaged follow mode is over: the frames take the camera from here.
    if (applied.follow?.transition) applied.follow.transition = false;
    updateOnScreen();
    // What is in sight sets how often the moving traffic is written (PR M6): one frame reads it again.
    applied.loop?.wake();
    latest.current?.onCameraChange?.(camera, details);
  }, [store, followTooltip, updateOnScreen, syncParkedTraffic]);

  const handleStatus = useCallback(status => {
    store.set({ engineStatus: status.engine, basemapStatus: status.basemap });
  }, [store]);

  // Shows the tooltip of a runway, a taxiway or a stand picked at `point` (a pixel of the map) and `lngLat`: next to the
  // pointer, or beside the stand's box for a stand.
  const showTooltip = useCallback((info, point, lngLat, pinned) => {
    const engine = engineRef.current;
    if (!engine || !point || !lngLat) return;
    const { padding, attached: drawn } = latest.current;
    const polygon = info.kind === 'stand' ? findStandByCode(drawn, info.id)?.geometry?.polygon : null;
    const placement = standTooltipPlacement(engine, padding, polygon) ?? tooltipPlacement(engine, padding, point);
    store.set({ tooltip: { ...info, pinned, lngLat, ...placement } });
  }, [store]);

  // The tooltip of the stand `code` among the stands drawn now, in the screen's language (null when none is drawn).
  const standTooltipOf = useCallback(code => {
    const { attached: drawn, t: translate, language: words } = latest.current;
    return standTooltip(code, drawn, translate, words);
  }, []);

  // A stand's tooltip says what the stand says now: a board refresh, the minute or the language change its words, and a
  // stand that is no longer drawn closes it.
  const refreshStandTooltip = useCallback(() => {
    const tooltip = store.get().tooltip;
    if (tooltip?.kind !== 'stand') return;
    const info = standTooltipOf(tooltip.id);
    if (info === null) {
      store.set({ tooltip: null });
      return;
    }
    if (info.title === tooltip.title && info.detail === tooltip.detail
      && JSON.stringify(info.reasons) === JSON.stringify(tooltip.reasons)) return;
    store.set({ tooltip: { ...tooltip, ...info } });
  }, [store, standTooltipOf]);

  // The flags of the stand polygons (hover, selected, related, same agent), written as their feature-state: only what
  // changed (stands/standInteractions.js: featureStatePlan), so a pointer or a selection never rewrites the data. The
  // legend explains the same-agent ring the flags draw, and whose agent it follows: when the pointer or the selection
  // moves the ring, or makes it follow another stand, what is on screen is read again.
  const applyStandFlags = useCallback(next => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsStands) return;
    const previous = applied.standFlags ?? NO_FLAGS;
    const plan = featureStatePlan(previous, next);
    applied.standFlags = next;
    if (plan.length === 0) return;
    for (const step of plan) {
      if (step.op === 'remove') engine.removeFeatureState(STAND_SOURCE, step.id, step.key);
      else engine.setFeatureState(STAND_SOURCE, step.id, step.state);
    }
    markSettled(rootRef.current, false);
    const ringMoved = plan.some(step => step.key === 'sameAgent' || step.state?.sameAgent === true);
    if (ringMoved || sameAgentMark(previous) !== sameAgentMark(next)) updateOnScreen();
  }, [updateOnScreen]);

  // The stand under the pointer (`null` when there is none, or a drag), with the stands its agent covers.
  const hoverStand = useCallback(code => {
    const current = appliedRef.current.standFlags ?? NO_FLAGS;
    const hover = code == null ? null : mapStandCode(code) || null;
    if (hover === current.hover) return;
    applyStandFlags(standFlags({ hover, selected: current.selected, related: current.related, stands: latest.current.attached }));
  }, [applyStandFlags]);

  // The boxes of «Ubicar en el mapa» (the one at the pointer and the pending location): one setData of their own source
  // when they change, never one of the stand sources.
  const writeGhost = useCallback(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsStands) return;
    const data = ghostFeatures({ ghost: applied.ghost, pending: applied.pendingGhost });
    const key = JSON.stringify(data.features);
    if (applied.ghostKey === key) return;
    applied.ghostKey = key;
    engine.setData(STAND_GHOST_SOURCE, data);
    markSettled(rootRef.current, false);
  }, []);

  // The box of the stand being placed at the pointer of `event` (none when the pointer left the map); the legend hears
  // when it comes or goes.
  const moveGhost = useCallback(event => {
    const { placingStand: stand, layout: plan } = latest.current;
    const applied = appliedRef.current;
    const ghost = stand && event?.lngLat
      ? placingGhost({ code: stand.code, pointer: event.lngLat, layout: plan, sizeHint: stand.sizeHint })
      : null;
    const shown = (ghost !== null) !== (applied.ghost !== null);
    applied.ghost = ghost;
    writeGhost();
    if (shown) updateOnScreen();
  }, [writeGhost, updateOnScreen]);

  const handleClick = useCallback(({ point, lngLat, hit }) => {
    const props = latest.current;
    if (props.placing) {
      if (!lngLat) return;
      // The click gives the centre of the box at the pointer: the layout's centre when it snapped to the stand's outline.
      // Without a stand to place (`placing` alone) it gives the clicked point, as it always did.
      if (props.placingStand) {
        const ghost = placingGhost({
          code: props.placingStand.code, pointer: lngLat, layout: props.layout, sizeHint: props.placingStand.sizeHint,
        });
        props.onMapClick?.(placedLocation(ghost) ?? { latitude: lngLat[1], longitude: lngLat[0], snapped: false });
      } else props.onMapClick?.({ latitude: lngLat[1], longitude: lngLat[0] });
      return;
    }
    // A click on a runway or a taxiway holds its tooltip, so nothing depends on hovering alone; a click anywhere else
    // closes it (a stand's says what its drawer says).
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

  // The card of the aircraft whose traffic feature is `id`, as the last write drew it (owner request of 2026-11-15:
  // ui/aircraftCard.js), with its flight among the screen's map flights; null when the map draws no such aircraft.
  const aircraftTooltipOf = useCallback(id => {
    const { traffic: current, flights: rows, t: translate, language: words } = latest.current ?? {};
    const drawn = appliedRef.current.sampledAircraft ?? current?.aircraft ?? EMPTY;
    const item = id == null ? null : drawn.find(candidate => candidate?.id === id) ?? null;
    if (item === null) return null;
    const flight = flightRowOf(rows, item.flightKey) ?? flightRowOf(current?.flights, item.flightKey);
    return aircraftCard(item, flight, { t: translate, language: words, locale: words === 'en' ? 'en-US' : 'es-DO' });
  }, []);

  // The tooltip of what is under the pointer, unless a click holds one: written to the store only when the runway, the
  // taxiway, the stand or the aircraft under the pointer changes, never on every frame. A drag (a button held down)
  // shows none.
  const hoverTooltip = useCallback((event, hit) => {
    const current = store.get().tooltip;
    if (current?.pinned) return;
    let info = null;
    const fromTraffic = hit?.feature?.source === TRAFFIC_SOURCE
      || String(hit?.feature?.layer?.id ?? '').startsWith('occ-traffic-');
    const trafficId = fromTraffic ? hit.feature?.properties?.id ?? null : null;
    if (event && !event.originalEvent?.buttons) {
      if (trafficId !== null) info = aircraftTooltipOf(trafficId);
      else info = hit?.kind === 'stand' ? standTooltipOf(hit.id) : airfieldTooltip(hit);
    }
    if (info === null) {
      if (current !== null) store.set({ tooltip: null });
      return;
    }
    if (current?.kind === info.kind && current.id === info.id) return;
    showTooltip(info, event.point, event.lngLat, false);
  }, [store, showTooltip, standTooltipOf, aircraftTooltipOf]);

  // Other traffic shows its tag while the pointer is on it (contracts 2.4: tag on demand), written with updateData.
  const focusTraffic = useCallback(hit => {
    const next = hit?.kind === 'aircraft' ? hit.feature?.properties?.id ?? null : null;
    if (trafficFocusRef.current === next) return;
    trafficFocusRef.current = next;
    writeTraffic();
  }, [writeTraffic]);

  // The cursor, the hover tooltip, the hovered stand and the focused traffic follow what is under the pointer, picked
  // once per frame; while a stand is placed, its box follows the pointer instead.
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
        moveGhost(pointer.event);
        return;
      }
      const hit = pointer.event?.hit;
      // A pick the screen hears (onPick) is something to click as well.
      const clickable = hit && (POINTER_KINDS.has(hit.kind) || (hit.id != null && latest.current.onPick));
      engine.setCursor(clickable ? 'pointer' : '');
      hoverTooltip(pointer.event, hit);
      focusTraffic(pointer.event ? hit : null);
      const dragging = Boolean(pointer.event?.originalEvent?.buttons);
      hoverStand(hit?.kind === 'stand' && hit.id != null && !dragging ? String(hit.id) : null);
    });
  }, [hoverTooltip, focusTraffic, hoverStand, moveGhost]);

  // A stand selected outside the area in sight brings the camera to it at the same zoom, inside the insets
  // (stands/standInteractions.js: isOutsideSafeArea); one in sight leaves the camera where it is.
  const easeToStand = useCallback(code => {
    const engine = engineRef.current;
    const { attached: drawn, padding: inset } = latest.current;
    const geometry = findStandByCode(drawn, code)?.geometry;
    const camera = engine?.getCamera();
    if (!camera || !Array.isArray(geometry?.polygon)) return false;
    if (!isOutsideSafeArea(boxOfPoints(geometry.polygon), engine.getVisibleBounds(inset))) return false;
    moveCamera({ center: geometry.center, zoom: camera.zoom, padding: inset });
    return true;
  }, [moveCamera]);

  // Follow mode, one frame (PR M6, design A6): the camera framing the chosen aircraft where this frame's write drew it
  // and its next objective (kinematics/followCamera.js, the targets of the motion store), the zoom or tilt a person set
  // kept. Engaging is one move of the map's own (instant under reduced motion), whose end gives the camera to the frames;
  // then each frame eases it there by the time since the last one (a frame without time jumps: the clock is paused or
  // frozen); under reduced motion it jumps there only when the framing's centre leaves the middle of the area in sight
  // or the aircraft nears its edge. Nothing moves while a person moves the map, and nothing without a drawn aircraft.
  const followFrame = useCallback((tMs, { dtMs = 0, reduced = false } = {}) => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    const state = applied.follow;
    const item = applied.chosen;
    if (!engine?.map || !state?.on || !item || engine.isInteracting()) return;
    const current = engine.getCamera();
    if (!current) return;
    const { traffic: now, padding: inset, pitchMode: mode } = latest.current;
    const targets = now?.motion?.followTargets?.(item.flightKey ?? null) ?? { airport: PUJ_ARP };
    const framing = followCamera({ aircraft: item, phase: item.phase ?? null, targets, mode3d: mode === '3d' });
    const target = framing === null ? null : followTarget(engine, framing, current, inset);
    if (target === null) return;
    if (state.zoomFrozen) target.zoom = current.zoom;
    if (state.pitchFrozen) target.pitch = current.pitch;
    const jump = camera => {
      applied.followMoving = true;
      applied.followFrameAt = tMs;
      try {
        engine.jumpTo({ center: camera.center, zoom: camera.zoom, pitch: camera.pitch });
      } finally {
        applied.followMoving = false;
      }
    };
    if (state.engage) {
      state.engage = false;
      if (reduced) {
        jump(target);
        state.converged = true;
        return;
      }
      state.transition = true;
      const { method, ...transition } = transitionFor(current.zoom, target.zoom);
      engine[method]({ center: target.center, zoom: target.zoom, pitch: target.pitch, padding: inset, ...transition });
      return;
    }
    if (state.transition) return;
    // Under reduced motion the camera stays put until the point the framing centres on (the aircraft, or the middle
    // between it and its objective) leaves the central 60 % of the area in sight, or until the aircraft itself nears the
    // edge of that area (needsReframe): then one jump frames it again. The middle of two points moves at half the speed
    // of an aircraft flying away from its objective, a departure climbing out, which would otherwise leave the screen.
    if (reduced) {
      if (needsReframe({ centerPx: engine.project(target.center), aircraftPx: engine.project([item.lon, item.lat]),
        viewport: engine.getViewport(), insets: inset })) {
        jump(target);
      }
      state.converged = true;
      return;
    }
    const next = dtMs > 0 ? stepCamera(current, target, dtMs / 1_000) : target;
    jump(next);
    state.converged = settledAt(next, target);
  }, []);

  // Whether follow mode still has the camera to move: while it engages or has not reached the aircraft's framing.
  const followAnimating = useCallback(() => {
    const applied = appliedRef.current;
    const state = applied.follow;
    return state?.on === true && applied.chosen !== null && (state.engage || state.transition || !state.converged);
  }, []);

  // A person moves the map (core/mapEngine.js: onUserGesture). While following, a drag ends follow mode and says so; a
  // zoom or a tilt keeps following with what the person chose; a rotation is the person's anyway.
  const handleGesture = useCallback(({ kind }) => {
    const applied = appliedRef.current;
    const state = applied.follow;
    if (!state?.on) return;
    state.transition = false;
    state.converged = false;
    if (kind === 'pan') {
      stopFollowing({ notice: true });
      return;
    }
    if (kind === 'zoom') state.zoomFrozen = true;
    if (kind === 'pitch') state.pitchFrozen = true;
    applied.loop?.wake();
  }, [stopFollowing]);

  // One engine for the life of the component. A StrictMode remount destroys the first one before the second starts.
  useEffect(() => {
    const props = latest.current;
    const pointer = pointerRef.current;
    store.set(initialSnapshot(props.basemap));
    appliedRef.current = {
      padding: props.padding, pitchMode: props.pitchMode, groups: null, selection: null, standFeatures: null, flights: null,
      overlayData: {}, drawsStands: props.drawsStands, drawsFlights: props.drawsFlights, standLabels: props.standLabels,
      drawsAirfield: Boolean(props.layout),
      // The feature-state flags of the stands (the legend reads the same-agent ring from them) and the placing boxes;
      // the stand selected when the map starts is framed by the view, not eased to.
      standFlags: NO_FLAGS, ghost: null, pendingGhost: null, ghostKey: '[]', placingCode: null,
      easedFor: props.selection?.kind === 'stand' ? mapStandCode(props.selection.id) || null : null,
    };
    // The traffic of this engine: what its source holds, the trails and route written, and the credit shown.
    Object.assign(appliedRef.current, { drawsTraffic: props.drawsTraffic, trafficById: new Map(), trails: null, route: null,
      credit: '' });
    // The ELEVANT aircraft the stands draw instead (PR M6), and whether the stands were drawn at the last write.
    Object.assign(appliedRef.current, { parkedIds: NO_IDS, standsShown: null });
    // Its motion (PR M6): one frame loop for the life of the engine, on the render clock of the motion it was given.
    const motionClock = props.drawsTraffic && props.traffic?.motion ? props.traffic.motion.clock ?? createRenderClock() : null;
    const reduced = motionClock ? reducedMotionQuery() : null;
    const loop = motionClock ? createFrameLoop({ clock: motionClock, reducedMotion: reduced?.matches === true }) : null;
    Object.assign(appliedRef.current, { loop, sampledAircraft: null, trafficWrittenAt: null, trafficIntervalMs: 0,
      trafficOnScreenAt: null });
    // The chosen aircraft as the last write drew it, its route as the frames last wrote it, and follow mode (PR M6).
    Object.assign(appliedRef.current, { chosen: null, routeFrame: null, follow: { ...FOLLOW_OFF }, followMoving: false,
      followFrameAt: null, followOnScreenAt: null });
    const motionState = () => ({ available: true, paused: motionClock.isPaused?.() === true,
      pausedAt: motionClock.pausedAt?.() ?? null, dataAt: latest.current?.traffic?.motion?.dataAt?.() ?? null });
    store.set({ motion: loop ? motionState() : MOTION_OFF });
    // Each frame writes the traffic when its write is due, with the chosen flight's route where it drew its aircraft,
    // and the legend reads it at most once a second.
    const onFrame = tMs => {
      const applied = appliedRef.current;
      if (Number.isFinite(applied.trafficWrittenAt) && tMs - applied.trafficWrittenAt < applied.trafficIntervalMs) return;
      writeTraffic(tMs);
      writeFrameRoute(tMs);
      if (Number.isFinite(applied.trafficOnScreenAt) && tMs - applied.trafficOnScreenAt < MOVING_ON_SCREEN_MS) return;
      applied.trafficOnScreenAt = tMs;
      const current = engineRef.current;
      updateTrafficOnScreen(current?.getVisibleBounds(latest.current.padding) ?? null, current?.getCamera()?.zoom,
        store.get().thresholds);
    };
    const stopFrames = loop?.subscribe(onFrame, {
      isAnimating: tMs => latest.current?.traffic?.motion?.isAnimating?.(tMs) === true,
    });
    // Follow mode after the traffic in every frame, so the camera frames the aircraft where that frame drew it.
    const stopFollowFrames = loop?.subscribe(followFrame, { isAnimating: followAnimating });
    const onReducedMotion = () => loop.setReducedMotion(reduced.matches === true);
    reduced?.addEventListener?.('change', onReducedMotion);
    const stopClock = motionClock?.subscribe?.(() => store.set({ motion: motionState() }));
    focusRef.current = null;
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
      // The region's airports with the traffic they are context for (owner request of 2026-11-15).
      referenceOverlay({ airports: props.drawsTraffic }),
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
      onIdle: () => {
        updateOnScreen();
        markSettled(rootRef.current, true);
      },
      onResize: refit,
      onClick: handleClick,
      onPointerMove: handlePointer,
      onUserGesture: handleGesture,
    });
    engineRef.current = engine;
    engine.setData(REFERENCE_SOURCE, referenceFeatures({ airports: props.drawsTraffic }));
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
      stopFrames?.();
      stopFollowFrames?.();
      stopClock?.();
      reduced?.removeEventListener?.('change', onReducedMotion);
      loop?.dispose();
      if (appliedRef.current.loop === loop) appliedRef.current.loop = null;
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [store, applyView, handleCamera, handleClick, handlePointer, handleStatus, refit, updateOnScreen, writeTraffic,
    updateTrafficOnScreen, writeFrameRoute, followFrame, followAnimating, handleGesture]);

  // The URL view: fly only when it differs from the last view applied, so a view this map asked for flies once.
  useEffect(() => {
    if (urlView === null) {
      lastViewRef.current = null;
      return;
    }
    const key = viewKey(urlView, urlTerminal);
    if (key === lastViewRef.current) return;
    lastViewRef.current = key;
    // A view another part of the screen asked for takes the camera from follow mode (PR M6).
    stopFollowing({ notice: true });
    applyView(urlView, { terminal: urlTerminal });
  }, [urlView, urlTerminal, applyView, stopFollowing]);

  // The insets: camera padding and control positions, new fits and thresholds, and what is left on screen; follow mode
  // frames its aircraft in the new room.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || applied.padding === padding) return;
    applied.padding = padding;
    engine.setInsets(padding);
    refit();
    updateOnScreen();
    if (applied.follow?.on) {
      applied.follow.converged = false;
      applied.loop?.wake();
    }
  }, [padding, refit, updateOnScreen]);

  // New stands may change what frames the views and what is on screen.
  useEffect(() => {
    refit();
  }, [targets, refit]);

  // New stands or flights may change what is on screen: a flight that moves in or out of sight changes the legend, and
  // a stand's tooltip says what the stand says now.
  useEffect(() => {
    updateOnScreen();
    refreshStandTooltip();
  }, [attached, standFeatures, flights, updateOnScreen, refreshStandTooltip]);

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

  // The traffic (PR M5): the aircraft, again whenever the selection, the shown groups or the language change what
  // they draw, then what is on screen. A read that moved nothing writes nothing. With motion (PR M6) the write is at
  // the render clock's now, the loop wakes (it runs on while something moves), and the motion says how new its data is.
  useEffect(() => {
    writeTraffic();
    updateOnScreen();
    const applied = appliedRef.current;
    if (!applied.loop) return;
    applied.loop.wake();
    const dataAt = latest.current?.traffic?.motion?.dataAt?.() ?? null;
    const motion = store.get().motion;
    if (motion.dataAt !== dataAt) store.set({ motion: { ...motion, dataAt } });
  }, [trafficAircraft, selection, trafficGroupsKey, language, writeTraffic, updateOnScreen, store]);

  // A stand that turns occupied or lets its aircraft go changes whose symbol gives way to a footprint (PR M6): the traffic
  // is written again with the stands, which a re-read of the same stands leaves as it is.
  useEffect(() => {
    const applied = appliedRef.current;
    if (applied.drawsTraffic && applied.drawsStands) writeTraffic();
  }, [attached, writeTraffic]);

  // The trails and the chosen flight's route: one setData when what they draw changes. A new route from the props is
  // the frames' to follow from their next frame on (PR M6).
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
      if (slot === 'route') applied.routeFrame = null;
    }
    updateOnScreen();
  }, [shownTrails, trafficRoute, updateOnScreen]);

  // Follow mode (PR M6) engages when the URL asks for it on a map that can follow, again for each new selection, and
  // ends when the URL lets it go. The selection's key is what is followed: a flight imported or linked under 3-N07 keeps
  // its selection, and so its camera.
  useEffect(() => {
    const applied = appliedRef.current;
    const state = applied.follow;
    if (!state) return;
    if (!followingNow) {
      Object.assign(state, { on: false, engage: false, transition: false });
      return;
    }
    if (state.on && state.key === selectionKey) return;
    Object.assign(state, { ...FOLLOW_OFF, on: true, key: selectionKey, engage: true, converged: false });
    setFollowNotice(null);
    applied.loop?.wake();
  }, [followingNow, selectionKey]);

  // A selection that no longer names an aircraft (cleared, or a stand chosen) leaves nothing to follow.
  const lastSelectionRef = useRef(undefined);
  useEffect(() => {
    const previous = lastSelectionRef.current;
    lastSelectionRef.current = selectionKey;
    if (previous === undefined || previous === selectionKey) return;
    const kind = latest.current?.selection?.kind ?? null;
    if (latest.current?.urlFollow && kind !== 'flight' && kind !== 'aircraft') latest.current.setFollow(false);
  }, [selectionKey]);

  // «Dejaste de seguir a …» stays a few seconds.
  useEffect(() => {
    if (followNotice === null) return undefined;
    const timer = setTimeout(() => setFollowNotice(null), FOLLOW_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [followNotice]);

  // S and the follow buttons: on while a drawn aircraft is chosen, off whenever it is on.
  const toggleFollow = useCallback(() => {
    const info = latest.current?.followInfo;
    if (!info?.available) return;
    if (info.following) stopFollowing({ notice: false });
    else if (info.canFollow) latest.current.setFollow(true);
  }, [stopFollowing]);
  const followInfo = useMemo(() => Object.freeze({
    available: followAvailable, following: followingNow, canFollow, toggle: toggleFollow,
  }), [followAvailable, followingNow, canFollow, toggleFollow]);
  useLayoutEffect(() => {
    latest.current.followInfo = followInfo;
  });

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

  // The selection: one feature in the selection source (a stand's label point with its texts, a flight's ring),
  // written only when it changes; the flags of the stands as feature state (the casing of the selected stand, the stand
  // of a selected flight, and the stands covered by the same agent as the hovered or selected one), written only where
  // they change; and, once per newly selected stand, the camera when that stand lies outside the area in sight.
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
    if (!applied.drawsStands) return;
    const code = selection?.kind === 'stand' ? mapStandCode(selection.id) || null : null;
    // The stand of a chosen flight: from the flights the map draws, else (PR M6) from the aircraft its traffic draws for it.
    const related = selection?.kind === 'flight'
      ? relatedEntities(selection, { flights }).standCode ?? trafficStandOf(trafficAircraft, selection) : null;
    const { hover } = applied.standFlags ?? NO_FLAGS;
    applyStandFlags(standFlags({ hover, selected: code, related, stands: attached }));
    if (code === applied.easedFor) return;
    applied.easedFor = code;
    const focused = focusRef.current;
    focusRef.current = null;
    if (code !== null && focused !== code) easeToStand(code);
  }, [selection, attached, presetStands, flights, trafficAircraft, standFeatures, applyStandFlags, easeToStand]);

  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || applied.pitchMode === pitchMode) return;
    applied.pitchMode = pitchMode;
    // While following, the tilt of 2D or 3D is follow mode's to set (PR M6): the change a person asked for engages it
    // again, one move of the map's own to the aircraft's framing with the new tilt (one jump under reduced motion, whose
    // frames would otherwise wait for the aircraft to near the edge). A tilt the person set gives way; their zoom stays.
    if (applied.follow?.on) {
      Object.assign(applied.follow, { engage: true, converged: false, pitchFrozen: false });
      applied.loop?.wake();
      return;
    }
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

  // While a stand is being placed a click gives its point: no tooltip stays open over the map and no stand stays marked
  // as under the pointer.
  useEffect(() => {
    engineRef.current?.setCursor(placingNow ? 'crosshair' : '');
    if (!placingNow) return;
    store.set({ tooltip: null });
    hoverStand(null);
  }, [placingNow, store, hoverStand]);

  // The pending location of the stand being placed, drawn as its box, and the box at the pointer, which goes when the
  // placing ends or moves to another stand (the next pointer move draws that one).
  const pendingKey = placingStand && pendingLocation
    ? `${pendingLocation.longitude}|${pendingLocation.latitude}`
    : null;
  const placingCode = placingStand ? mapStandCode(placingStand.code) || null : null;
  const placingSize = placingStand?.sizeHint ?? null;
  useEffect(() => {
    const applied = appliedRef.current;
    if (!engineRef.current || !applied.drawsStands) return;
    const point = pendingKey === null ? null : pendingKey.split('|').map(Number);
    const pending = point === null || placingCode === null
      ? null
      : placingGhost({ code: placingCode, pointer: point, layout, sizeHint: placingSize });
    const shown = (pending !== null) !== (applied.pendingGhost !== null) || (placingCode !== applied.placingCode && applied.ghost !== null);
    applied.pendingGhost = pending;
    if (placingCode !== applied.placingCode) {
      applied.placingCode = placingCode;
      applied.ghost = null;
    }
    writeGhost();
    if (shown) updateOnScreen();
  }, [pendingKey, placingCode, placingSize, layout, writeGhost, updateOnScreen]);

  // The map keys (contracts 2.2) on keydown at the map's root, in the bubble phase, never on document. 1 to 4 are
  // the views while the map can draw; Esc cancels the placing of a stand first, then clears a selection, after a drawer
  // or dialog has closed on its own Esc. No key of its own is added for the placing.
  useEffect(() => {
    const root = rootRef.current;
    const handlers = {};
    for (const view of VIEW_NAMES) {
      Object.defineProperty(handlers, `view.${view}`, {
        enumerable: true,
        get: () => (store.get().engineStatus === 'unavailable' ? undefined : () => requestView(view)),
      });
    }
    // Follow mode (PR M6): S follows the chosen aircraft the map draws, and stops following; with nothing to follow the
    // key is left alone.
    Object.defineProperty(handlers, 'toggleFollow', {
      enumerable: true,
      get: () => {
        const info = latest.current?.followInfo;
        if (store.get().engineStatus === 'unavailable' || !info?.available) return undefined;
        return info.following || info.canFollow ? () => latest.current.followInfo.toggle() : undefined;
      },
    });
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
        // An open layers menu closes first (PR M5); then Esc stops the placing of a stand (PR M4); the selection waits
        // for the next Esc.
        if (latest.current?.layersMenuOpen) return () => latest.current.setLayersMenuOpen(false);
        const { selection: current, onSelect: select, placing: placingStandNow, onCancelPlacing: cancel } = latest.current ?? {};
        if (placingStandNow && cancel) return () => cancel();
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
  // With the traffic on screen and its source (PR M5), for the legend and the status over the map, and the layers menu.
  const { layerKeys } = snapshot;
  const layers = useMemo(() => Object.freeze({ keys: layerKeys, values: resolvedLayers }), [layerKeys, resolvedLayers]);
  // The motion of the traffic (PR M6): «Pausar movimiento» freezes the render clock, «Reanudar movimiento» goes back to
  // the server's time; the reads go on meanwhile.
  const pauseMotion = useCallback(() => appliedRef.current.loop?.pause(), []);
  const resumeMotion = useCallback(() => appliedRef.current.loop?.resume(), []);
  const motionSnapshot = snapshot.motion;
  const motion = useMemo(() => Object.freeze({ ...motionSnapshot, pause: pauseMotion, resume: resumeMotion }),
    [motionSnapshot, pauseMotion, resumeMotion]);
  const mapContext = useMemo(() => ({
    ...context, trafficOnScreen: trafficShown, trafficSource, layers, setLayer, layersMenuOpen, setLayersMenuOpen,
    registerLayersMenu, motion, follow: followInfo,
  }), [context, trafficShown, trafficSource, layers, setLayer, layersMenuOpen, setLayersMenuOpen, registerLayersMenu,
    motion, followInfo]);

  // The list of the fallback: the adapter's own items, else the stands of the screen, else those that frame the views.
  const listedStands = stands.length > 0 ? stands : referenceStands;
  const items = useMemo(() => fallbackItems ?? standsInView(listedStands)
    .map(stand => ({ id: standCodeOf(stand), label: standCodeOf(stand), kind: 'stand' }))
    .filter(item => item.id !== ''), [fallbackItems, listedStands]);
  const selectFallback = (id, item) => {
    if (onFallbackSelect) onFallbackSelect(id, item);
    else onSelect?.({ kind: item?.kind ?? 'stand', id });
  };
  // Contract 2.6: the OCC boot screen (PR U4) waits for the first screen with its data on screen. The map reports
  // once its engine settles: `ready` (the style loaded, so the airfield and the stands draw even without the base map)
  // or `unavailable` (the fallback list is what the screen shows). Outside the OCC frame markReady is a no-op, and
  // the provider counts only the first report.
  useEffect(() => {
    if (engineStatus === 'ready' || engineStatus === 'unavailable') markReady('map');
  }, [engineStatus, markReady]);
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
        {/* Before the page's own overlays, so the dock's panels a person opens stay over it. */}
        {!unavailable && followNotice !== null && (
          <p role="status"
            className="occ-map-notice rounded-md border border-occ-line bg-occ-panel-float px-3 py-2 text-sm text-occ-text">
            {t('follow.stopped', { id: followNotice.name })}
          </p>
        )}
        {/* The altitude scale of the traffic (owner request of 2026-11-15), under the page's overlays and its dock. */}
        {!unavailable && traffic !== undefined && <AltitudeLegend />}
        {children}
        {!unavailable && <MapTooltip tooltip={snapshot.tooltip} />}
      </div>
    </OccMapContext.Provider>
  );
});

export default OccMap;
