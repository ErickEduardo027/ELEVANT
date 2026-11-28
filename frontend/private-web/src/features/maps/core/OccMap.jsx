'use client';

import {
  forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from 'react';
import * as maplibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../../styles/occ-map.css';
import { useTranslation } from '../../../i18n/LanguageScope';
import { serverClock } from '../../../services/serverClock';
import { useOccBoot } from '../../admin-occ/boot/occBootContext';
import { useOptionalTheme } from '../../shell/useTheme';
import { createOccShortcutHandler } from '../../occ-ui/occShortcuts';
import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { airfieldFeatures } from '../airport/airfieldFeatures';
import { airportStructures } from '../airport/structures';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM } from '../airport/geo';
import { WORLD_AIRPORTS } from '../airport/worldAirports';
import { resolveAircraftType } from '../aircraft/types';
import { followCamera, needsReframe, stepCamera } from '../kinematics/followCamera';
import {
  CLOSE_UP_ZOOM, ORBIT, ORBIT_VIEWS, angleDiffDeg, closeChaseZoom, closestOrbitZoom, createOrbit, orbitAdvance,
  orbitAuto, orbitDrag, orbitRotate, orbitTarget, orbitTilt, orbitWheel, orbitZoom, stepOrbitCamera,
} from '../kinematics/orbitCamera';
import { mapMessages } from '../mapMessages';
import { ghostFeatures, placedLocation, placingGhost } from '../stands/placing';
import {
  STAND_FEATURE_COLLECTIONS, boxOfPoints, boxesMeet, buildStandFeatures, diffStandFeatures, featuresIn,
  parkedAircraftIds, standSignalOf, standsDrawnIn,
} from '../stands/standFeatures';
import {
  featureStatePlan, findStandByCode, isOutsideSafeArea, sameAgentMark, standFlags, standTooltip,
} from '../stands/standInteractions';
import {
  STAND_GHOST_SOURCE, STAND_LABEL_LAYER_IDS, STAND_SOURCE, STAND_SOURCES, standDisplayAt, standLabelFilter, standOverlay,
} from '../stands/standLayers';
import { attachStandGeometry, standStateOf } from '../stands/standModel';
import {
  AIRFIELD_LAYER_IDS, AIRFIELD_SOURCE, AIRFIELD_STRUCTURE_LAYER_IDS, AIRFIELD_STRUCTURES_SOURCE, airfieldKindsOnScreen,
  airfieldOverlay, airfieldTooltip,
} from '../style/airfieldLayers';
import { createImageResolver } from '../style/mapImages';
import { GLOBE_MERCATOR_ZOOM, PROJECTIONS, buildOccStyle } from '../style/occStyle';
import {
  NIGHT_SOURCE, OURAIRPORTS_SOURCE, REFERENCE_GROUPS, REFERENCE_SOURCE, ourAirportsFeatures, referenceFeatures,
  referenceLayersShown, referenceOverlay,
} from '../style/referenceLayers';
import { SELECTION_SOURCE, selectionFeatures, selectionOverlay } from '../style/selectionLayers';
import { FLIGHT_ROUTES_GROUP } from '../style/flightRouteLayers';
import { worldBaseOverlay } from '../style/worldBaseLayers';
import { FLIGHT_SOURCE, flightOverlay, flightsInView, toFlightFeatures } from '../traffic/flightLayers';
import { nightShadeFeatures } from '../traffic/nightShade';
import { counterpartCodes, mapRunwayInUse, referencesOnScreen as referencesOnScreenOf } from '../traffic/referenceFeatures';
import { trailsBesideRoute } from '../traffic/routeFeatures';
import {
  ROUTE_SOURCE, TRAFFIC_SOURCE, TRAILS_SOURCE, featuresById, isDrawn, isEmptyDiff, onScreenKey, selectedAircraftId,
  trafficDiff, trafficFeatures, trafficOnScreen as trafficOnScreenOf,
} from '../traffic/trafficFeatures';
import { trafficOverlay } from '../traffic/trafficLayers';
import {
  SATELLITE_KEYS, SATELLITE_SOURCES, WIND_FEATURE_ID, WIND_LAYER_IDS, WIND_SOURCE, satelliteTiles, wantedImagery,
  weatherLayerNotes, weatherOnScreen, weatherOverlay, windFeatures, windTooltip, withPinnedImagery,
} from '../traffic/weatherLayers';
import { aircraftCard, flightRowOf } from '../ui/aircraftCard';
import AltitudeLegend from '../ui/AltitudeLegend';
import MapTooltip from '../ui/MapTooltip';
import { remoteSatelliteImagery, useSatelliteImagery } from '../useSatelliteImagery';
import {
  createAircraft3dController, parkedFromStands, parkedTrafficByStand, projected3d, readMode3d, translatePick, writeMode3d,
} from './aircraft3d';
import { buildAttribution } from './attribution';
import {
  MAP_VIEWS, PUJ_ARP, VIEW_NAMES, WORLD_VIEW, boundsCenter, cameraAngles, fitZooms, isInBounds, isRetired, lngLatOf,
  presetForZoom, presetTargets, sameFits, standCodeOf, standsInView, targetCenter, targetFor, thresholdsFromFits,
  transitionFor, unionBounds,
} from './cameraPresets';
import { createFrameLoop, createRenderClock, metresPerPixel, updateIntervalMs } from './frameLoop';
import {
  availableLayerKeys, cleanOverrides, engineGroupsFor, readLayerOverrides, resolveLayers, setLayerOverride,
  writeLayerOverrides,
} from './layersMenu';
import { createMapEngine } from './mapEngine';
import { skyFor } from './mapSky';
import { matchFlight, relatedEntities } from './mapSelection';
import MapUnavailable from './MapUnavailable';
import { OccMapContext } from './OccMapContext';
import { useMapSelection } from './useMapSelection';
import { useMinuteClock } from './useMinuteClock';
import { useRecentArrivals } from './useRecentArrivals';

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
// get their data through `overlayData`. The references of PR M8 (range rings, extended centrelines with the runway in
// use, the region's airports, the navaids and the night) are part of every map: one setData when what they draw changes,
// and the night on the minute of the server's clock. A map given the weather (PR M8) also draws the wind at the airfield
// and, when a person asks, the satellite clouds and rain of NASA GIBS pinned to the time of their image.

const EMPTY = Object.freeze([]);
const NO_FLAGS = Object.freeze({ hover: null, selected: null, related: null, sameAgent: Object.freeze(new Set()) });
const NO_CODES = Object.freeze(new Set());
const NO_GROUPS = Object.freeze({});
const INSET_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);
const SELECTABLE_KINDS = new Set(['stand', 'flight', 'aircraft']);
// What takes the pointer cursor: what can be selected, a terminal chip to open, and a runway, a taxiway or the wind (PR
// M8) with its tooltip.
const POINTER_KINDS = new Set([...SELECTABLE_KINDS, 'terminal', 'runway', 'taxiway', 'wind']);
// The airfield layers the legend reads back, the structures of M9 among them (a map without them has none to answer).
const AIRFIELD_LEGEND_LAYER_IDS = Object.freeze([...AIRFIELD_LAYER_IDS, ...AIRFIELD_STRUCTURE_LAYER_IDS]);
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
// The references (PR M8): nothing on screen, and what the legend reads of what is (with the weather: the time of each
// satellite image on screen).
const NO_REFERENCES_ON_SCREEN = Object.freeze({ kinds: EMPTY, runway: null });
const imageryKey = imagery => Object.entries(imagery ?? {}).map(([key, image]) => `${key}@${image.time}`).join(',');
const referencesKey = ({ kinds, runway, imagery }) => `${kinds.join('|')}#${runway ? `${runway.arrival}:${runway.source}` : ''}`
  + `#${imageryKey(imagery)}`;
// The weather (PR M8): no note under a key of the layers menu.
const NO_NOTES = Object.freeze({});
const EMPTY_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: EMPTY });
// The groups of the references (PR M8) and the great circles of every AVIAM flight (M8 lane, Monitoreo's globe, whose
// default follows the view): not what the traffic source draws, so a change of view never rewrites it.
const NON_TRAFFIC_GROUPS = new Set([...Object.values(REFERENCE_GROUPS), FLIGHT_ROUTES_GROUP]);
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
// The 3D aircraft (PR M7, core/aircraft3d.js): what the controller says while there is none, and the feet of a metre.
const VIEW_3D_OFF = Object.freeze({ enabled: false, status: 'off', notice: null, level: 0 });
const METRES_PER_FOOT = 0.3048;

// The chosen flight's route follows its aircraft (PR M6, design E5): rewritten at most once a second below the
// airfield threshold, and from it every frame in which the aircraft moved at least half a pixel on screen.
const ROUTE_FRAME_MS = 1_000;
const ROUTE_MOVE_PX = 0.5;
// The moving traffic (CN-18): what lies within this share of the area in sight around it is sampled and written on
// every write (it may enter the view); the rest only when the camera moved, a read came, or once in FULL_SAMPLE_MS.
const TRAFFIC_MARGIN = 0.5;
const FULL_SAMPLE_MS = 1_000;

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
// «Seguir en 3D» (CN-30, kinematics/orbitCamera.js): the camera flies in to the orbit over FOLLOW_3D_ENTRY_MS and back
// to where it was over FOLLOW_3D_RESTORE_MS; the follow panel reads the followed aircraft at most every
// FOLLOW_3D_SUBJECT_MS; in 3D the route of the followed aircraft is rewritten at most every FOLLOW_3D_ROUTE_MS.
const FOLLOW_3D_ENTRY_MS = 1_400;
const FOLLOW_3D_RESTORE_MS = 1_000;
const FOLLOW_3D_SUBJECT_MS = 500;
const FOLLOW_3D_ROUTE_MS = 100;
const NO_HOLD = Object.freeze({ rotate: 0, tilt: 0, zoom: 0 });
// M4: how far under CLOSE_UP_ZOOM the camera goes back before the hidden labels return.
const CLOSE_UP_RELEASE = 0.2;
const FOLLOW_3D_OFF = Object.freeze({ on: false, orbit: null, hold: NO_HOLD, camera: null, saved: null, entry: null });

// M4 (2026-11-28): the sky of the map (core/mapSky.js) is on in the 3D views and while «Seguir en 3D» follows, in the
// map's theme, and off in 2D.
function syncSky(engine, applied, theme) {
  engine?.setSky?.(skyFor({ theme, pitchMode: applied?.pitchMode, following3d: applied?.follow3d?.on === true }));
}

// The orbit of `view` for the followed `item` (M4): «Muy cerca» takes the zoom its type's length and the map's height
// give (kinematics/orbitCamera.js: closeChaseZoom); every other view its own.
function orbitFor(view, { item = null, engine = null, trackDeg = 0, auto = false } = {}) {
  if (view !== 'close') return createOrbit(view, { trackDeg, auto });
  return createOrbit('close', { trackDeg, auto, zoom: closeChaseZoom(orbitSizing(item, engine)) });
}

// What the orbit's zoom of a followed `item` depends on (M4): its type's length, its latitude and the map's height.
function orbitSizing(item, engine) {
  const type = item ? resolveAircraftType({ typeIcao: item.typeIcao ?? null, model: item.model ?? null,
    sizeCategory: item.sizeCategory ?? null, emitterCategory: item.emitterCategory ?? null }) : null;
  return { lengthM: type?.spec?.lengthM ?? null, latDeg: item?.lat ?? 0,
    viewportHeightPx: engine?.getViewport?.()?.height ?? null };
}

// The nearest zoom of the orbit round `item` (M4: kinematics/orbitCamera.js: closestOrbitZoom), kept in `f3` while
// the aircraft's type, its whole degree of latitude and the map's height stay.
function closestZoomOf(f3, item, engine) {
  const sizing = orbitSizing(item, engine);
  const key = `${item?.id}|${item?.typeIcao ?? item?.model ?? ''}|${Math.round(sizing.latDeg)}|${sizing.viewportHeightPx}`;
  if (f3.closest?.key !== key) f3.closest = { key, zoom: closestOrbitZoom(sizing) };
  return f3.closest.zoom;
}

// The orbit's gestures on the map's element (CN-30): a drag (any button) turns and tilts, two pointers turn, pinch and
// tilt, the wheel zooms. `changeOrbit(change)` applies them. Returns the function that removes them.
function attachOrbitGestures(element, changeOrbit) {
  const pointers = new Map();
  let pair = null;
  const pairOf = () => {
    const [a, b] = [...pointers.values()];
    return { angle: Math.atan2(b.y - a.y, b.x - a.x), distance: Math.hypot(b.x - a.x, b.y - a.y), y: (a.y + b.y) / 2 };
  };
  const down = event => {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pair = pointers.size === 2 ? pairOf() : null;
  };
  const move = event => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      if (dx !== 0 || dy !== 0) changeOrbit(orbit => orbitDrag(orbit, dx, dy));
      return;
    }
    if (pointers.size !== 2 || pair === null) return;
    const next = pairOf();
    const turn = ((next.angle - pair.angle) * 180) / Math.PI;
    const zoomBy = pair.distance > 0 && next.distance > 0 ? Math.log2(next.distance / pair.distance) : 0;
    const tiltBy = next.y - pair.y;
    pair = next;
    changeOrbit(orbit => orbitZoom(orbitTilt(orbitRotate(orbit, -turn), -tiltBy * ORBIT.tiltDegPerPx), zoomBy));
  };
  const up = event => {
    pointers.delete(event.pointerId);
    pair = pointers.size === 2 ? pairOf() : null;
  };
  const wheel = event => {
    event.preventDefault();
    let scale = 1;
    if (event.deltaMode === 1) scale = 16;
    else if (event.deltaMode === 2) scale = 400;
    changeOrbit(orbit => orbitWheel(orbit, event.deltaY * scale));
  };
  const menu = event => event.preventDefault();
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up],
    ['pointerleave', up], ['contextmenu', menu]];
  for (const [type, listener] of listeners) element.addEventListener(type, listener);
  element.addEventListener('wheel', wheel, { passive: false });
  return () => {
    for (const [type, listener] of listeners) element.removeEventListener(type, listener);
    element.removeEventListener('wheel', wheel);
  };
}

// A tiny external store (CN-30): the follow panel reads the followed aircraft from it without rendering the map.
function createSubjectStore() {
  let value = null;
  const listeners = new Set();
  return Object.freeze({
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      listeners.forEach(listener => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

const smoothstep = u => (u <= 0 ? 0 : (u >= 1 ? 1 : u * u * (3 - 2 * u)));

// The camera of the fly-in to the orbit (CN-30) at `u` (0 to 1, eased): from where the camera was to the orbit's camera,
// the bearing the short way and the centre from the ground to the aircraft's height.
function entryCamera(from, to, u) {
  const w = smoothstep(u);
  const lerp = (a, b) => a + (b - a) * w;
  return {
    center: [lerp(from.center[0], to.center[0]), lerp(from.center[1], to.center[1])],
    zoom: lerp(from.zoom, to.zoom),
    pitch: lerp(from.pitch ?? 0, to.pitch),
    bearing: (from.bearing ?? 0) + angleDiffDeg(from.bearing ?? 0, to.bearing) * w,
    elevation: lerp(0, to.elevation),
  };
}

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
 * How long until the next write of the moving traffic (core/frameLoop.js, CN-18): the time the fastest aircraft drawn
 * in the area in sight takes to move a pixel on screen, 2 to 15 writes a second.
 */
function writeIntervalFor(engine, aircraft, padding) {
  const bounds = engine.getVisibleBounds(padding);
  const zoom = engine.getCamera()?.zoom;
  if (bounds === null || !Number.isFinite(zoom)) return updateIntervalMs();
  let fastest = 0;
  for (const item of aircraft) {
    if (!isDrawn(item) || !isInBounds([item.lon, item.lat], bounds)) continue;
    if (Number.isFinite(item.gsMs) && item.gsMs > 0) fastest = Math.max(fastest, item.gsMs / metresPerPixel(zoom, item.lat));
  }
  return updateIntervalMs({ fastestPxPerSecond: fastest });
}

// The area in sight widened by `share` of its size on every side (TRAFFIC_MARGIN), or null.
function widenBounds(bounds, share) {
  if (!Array.isArray(bounds)) return null;
  const [[west, south], [east, north]] = bounds;
  const dx = (east - west) * share;
  const dy = (north - south) * share;
  return [[west - dx, south - dy], [east + dx, north + dy]];
}

// What says where the camera is, to know when it moved since the last write.
function cameraKey(camera) {
  if (!camera) return '';
  const [lng, lat] = Array.isArray(camera.center) ? camera.center : [camera.center?.lng, camera.center?.lat];
  return `${lng}|${lat}|${camera.zoom}|${camera.bearing}|${camera.pitch}`;
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
  // The references drawn in that area (PR M8): their legend kinds and the runway in use.
  referencesOnScreen: NO_REFERENCES_ON_SCREEN,
  // The motion of the traffic (PR M6): whether this map moves it, whether «Pausar movimiento» holds it and since when,
  // and the server instant of the newest data it draws.
  motion: MOTION_OFF,
  // The 3D aircraft (PR M7): the controller's state (core/aircraft3d.js).
  view3d: VIEW_3D_OFF,
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
 * - `isShortcutBlocked()` (an open drawer that is not a modal dialog), `className`, `children` (DOM overlays);
 * - `focusStandOnStart`: a stand selected when the map starts is brought to the centre once the map is ready.
 * - `views` (M9, M8): the views the map offers, from those it can show (the four, and the world first on a map with the
 *   globe): a view left out is not flown to, its key does nothing and a `view=` of it in the URL is ignored;
 *   ui/MapPresetSwitcher.jsx shows only these. Without it the map offers every view it can show (Panorama the four,
 *   Monitoreo the world and the four); Mapa de posiciones keeps Aeródromo and Rampa.
 * - A map fixed on the airport (M9, Mapa de posiciones): `views` (above) and `airfieldCentre` (`[lng, lat]`: Aeródromo
 *   is centred on that point, core/cameraPresets.js);
 *   `mapOptions` then carries its bounds and minimum zoom (cameraPresets.js: airportLockOptions); and `structures`
 *   (read at start): the airfield also draws the airport in 3D, its taxiway pavement, raised terminals and jet bridges
 *   at their estimated sizes (airport/structures.js, style/airfieldLayers.js), listed in the legend.
 *   `followLimits` (`{ maxBounds, minZoom, maxZoom }`, cameraPresets.js: airportFollowLimits) are the camera's limits
 *   while it follows an aircraft («Seguir» and «Seguir en 3D»): the held camera lets go so a departure or an arrival
 *   further out stays on screen, and the limits of `mapOptions` come back when following ends (after the camera's
 *   flight back, if there is one). Without it follow mode keeps the limits the map has.
 * - `aircraft3d` (read at start): `{ governor }` false switches the 3D governor off (the map lab), and `{ liveries }`
 *   (M9, Mapa de posiciones) dresses the 3D aircraft in their airlines' liveries and draws the other traffic on the
 *   ground near the airfield in 3D too (core/aircraft3d.js: createAircraft3dController).
 * - `projection` (M8, read once, at start): 'mercator' (the default, Panorama and Mapa de posiciones) or 'globe'
 *   (Monitoreo): the style then carries the globe and its atmosphere (style/occStyle.js, never a setStyle), and the map
 *   can show the world view, «0 Mundo», before the four (`views`, the key 0, `view=world`); a map in Mercator reads
 *   `view=world` as no view. Under the globe the three.js aircraft wait until the zoom where the globe is
 *   Mercator again (GLOBE_MERCATOR_ZOOM): their frames are Mercator's until M2 makes them follow the projection.
 *   `defaultView` may also be 'rd', the framing of the Dominican Republic and Puerto Rico (core/cameraPresets.js).
 * - `flightEmphasis` (M8, Monitoreo's board filter): `null` (no filter) or the flight keys of the map flights the board
 *   keeps. Every other AVIAM aircraft of `traffic` is dimmed through the feature state `outside` of the traffic source
 *   (traffic/trafficLayers.js: OUTSIDE_FILTER_OPACITY), so a new filter writes no data; OccMapContext's `boardFilter`
 *   says whether a filter dims anything, for the legend.
 * - `traffic` (PR M5): `{ aircraft, trails, route, source, flights }` from the map situation (useMapSituation: the
 *   aircraft of traffic/situationModel.js, the trails FeatureCollection, the chosen flight's route, the air picture's
 *   source and, from PR M8, the rows of the map flights, whose counterparts the references emphasise).
 *   Whether it is given is read at start, as for the stands and the flights: the map then draws the traffic overlay,
 *   one updateData per change of the aircraft (a selection, the aircraft under the pointer and the shown groups
 *   included), lists the traffic on screen for the legend, and names its source for the credit line
 *   (ui/MapSourceStatus.jsx) while traffic is on screen. The chosen aircraft is drawn larger in cyan with the
 *   selection ring, both layers of the traffic overlay in the selection slot (traffic/trafficLayers.js), so they move
 *   in the aircraft's own updateData and the selection source keeps the stands and the flights; while its route
 *   shows, its trail gives way to the route's flown part.
 * - The layers menu (PR M5, core/layersMenu.js, ui/MapLayersMenu.jsx): the map keeps the person's choices (only what
 *   differs from the defaults of the view on screen, in `localStorage`) and shows or hides the groups they name, except
 *   a group the page sets in `groups`, which wins. The menu reads them from OccMapContext; L opens and closes a menu on
 *   screen and Esc closes an open one before it clears the selection.
 * - The references (PR M8, style/referenceLayers.js): `weather` (what useMdpcWeather answers, or null) gives the wind of
 *   a live METAR for the runway in use, after the recent live arrivals of `traffic` (the aircraft seen on final in the
 *   last ten minutes of the server's clock) and before the usual 08 (contracts 2.3); `traffic.flights` the counterparts
 *   of today's flights. The reference point and the rings are written once; the source of what is drawn from
 *   OurAirports (the centrelines with the runway in use, the airports and the navaids), which carries its credit, again
 *   only when the runway in use, the counterparts or the language change; and the night shade on the minute of the
 *   server's clock (`frozenAt` holds it in the map lab). The legend lists the references on screen, read back from the
 *   map.
 * - The weather (PR M8, traffic/weatherLayers.js). Whether `weather` is given (null while there is no reading) is read at
 *   start, as for the traffic: the map then draws the wind of its METAR at the airfield, written again only when what it
 *   draws changes, with its tooltip and, while it is on screen, the credit «Clima: NOAA Aviation Weather Center»; and
 *   the satellite clouds and rain of NASA GIBS, read (useSatelliteImagery, through `satelliteService`, by default the
 *   browser's) only while the layers menu shows one and the map is in Región or Aproximación, and shown only once its
 *   tiles are pinned to the time GIBS reports. `layerOverrides` (read once, at start) replaces the choices kept in the
 *   browser, which then stay as they are: the scenes of the map lab open with their own layers.
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
const OccMapView = forwardRef(function OccMapView({
  theme = 'dark',
  resumeCameraRef,
  defaultView = 'ramp',
  layout = MDPC_LAYOUT,
  presetStands,
  stands: standsProp,
  standLabels = 'default',
  frozenAt = null,
  flights: flightsProp,
  traffic,
  weather,
  satelliteService = remoteSatelliteImagery,
  layerOverrides: layerOverridesProp,
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
  pitchMode: pitchModeProp,
  onPitchModeChange,
  aircraft3d: aircraft3dOptions,
  groups = NO_GROUPS,
  insets,
  interactive = true,
  basemap = true,
  mapOptions,
  followLimits = null,
  testId = 'occ-map-host',
  labels,
  fallbackItems,
  onFallbackSelect,
  isShortcutBlocked,
  focusStandOnStart = false,
  views: viewsProp,
  airfieldCentre = null,
  structures = false,
  projection = 'mercator',
  flightEmphasis = null,
  className = '',
  children,
}, ref) {
  const { t, language } = useTranslation(mapMessages);
  const { markReady } = useOccBoot();
  // The projection of this map (M8), read once: the globe brings the world view with it.
  const [mapProjection] = useState(() => (PROJECTIONS.includes(projection) ? projection : 'mercator'));
  const hasWorld = mapProjection === 'globe';
  // The views this map offers (M8, M9): those it can show (the world only on the globe), or the ones of `views` among
  // them; a `view=` of another one in the URL is not this map's to fly to.
  const shownViews = hasWorld ? MAP_VIEWS : VIEW_NAMES;
  const viewsKey = (Array.isArray(viewsProp) ? shownViews.filter(view => viewsProp.includes(view)) : shownViews).join(',');
  const views = useMemo(() => Object.freeze(viewsKey === '' ? [...shownViews] : viewsKey.split(',')),
    [viewsKey, shownViews]);
  const { view: urlViewAny, terminal: urlTerminalAny, setView, follow: urlFollow, setFollow } = useMapSelection();
  const urlView = urlViewAny !== null && views.includes(urlViewAny) ? urlViewAny : null;
  const urlTerminal = urlView === null ? null : urlTerminalAny;
  const [store] = useState(() => createViewStore(initialSnapshot(basemap)));
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  const stands = standsProp ?? EMPTY;
  const flights = flightsProp ?? EMPTY;
  // 2D or 3D (PR M7, contracts 2.3): the page's `pitchMode` when it sets one, else the browser's remembered choice, 3D
  // by default where the browser can draw it. D and the dock's control change it, the page's through onPitchModeChange.
  const [stored3d, setStored3d] = useState(() => readMode3d(layerStorage()));
  const pitchMode = pitchModeProp ?? (stored3d ? '3d' : '2d');
  const toggles3d = pitchModeProp === undefined || typeof onPitchModeChange === 'function';
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
  // «Seguir en 3D» (CN-30): what its panel shows of the orbit (`{ view, auto }`, null while off), and the aircraft it
  // follows, read by the panel from its own store.
  const [follow3dUi, setFollow3dUi] = useState(null);
  const [followSubject] = useState(createSubjectStore);
  // Where each stand is drawn, and what the stand layers draw at the map's minute: the countdowns change on the
  // minute, and a re-read of the same positions builds the same features.
  const attached = useMemo(() => attachStandGeometry(stands, layout), [stands, layout]);
  // M4: the traffic aircraft parked on each stand, which a double click on the stand or its inspector's «Seguir en 3D»
  // follows; kept while what it says does not change, so the map context does not change with every read.
  const parkedTargetsNow = useMemo(() => parkedTrafficByStand(attached, trafficAircraft,
    parkedAircraftIds(trafficAircraft, attached)), [attached, trafficAircraft]);
  const parkedTargetsKey = JSON.stringify([...parkedTargetsNow]);
  const parkedTargets = useMemo(() => new Map(JSON.parse(parkedTargetsKey)
    .map(([code, target]) => [code, Object.freeze(target)])), [parkedTargetsKey]);
  const clock = useMinuteClock({ frozenAt: standsProp === undefined ? NO_CLOCK : frozenAt });
  const standFeatures = useMemo(() => buildStandFeatures(attached, { nowMs: clock, language, labels: standLabels }),
    [attached, clock, language, standLabels]);
  // The references (PR M8): the runway in use from the recent live arrivals of the traffic (the aircraft seen on final
  // in the last ten minutes of the server's clock, useRecentArrivals), then the wind of a live METAR (no older than the
  // API's live limit at the server's minute), then the usual 08; the counterparts of today's flights; and the night
  // shade at the server's minute (the map lab's frozen instant when it has one). The reference point and the rings are
  // built once; what is drawn from OurAirports again only when the runway in use, the counterparts or the language
  // change.
  const referenceMinute = useMinuteClock({ frozenAt, clock: serverClock });
  const referenceAircraft = traffic?.aircraft ?? EMPTY;
  const arrivals = useRecentArrivals(referenceAircraft, { layout, nowMs: referenceMinute });
  // The weather (PR M8): whether the map draws it is read at start; a map without it still takes no wind for the runway.
  const [drawsWeather] = useState(() => weather !== undefined);
  // The airport in 3D (M9): whether the airfield draws its structures is read at start.
  const [drawsStructures] = useState(() => structures === true);
  const weatherNow = weather ?? null;
  const runway = useMemo(() => mapRunwayInUse({ layout, arrivals, weather: weatherNow, nowMs: referenceMinute }),
    [layout, arrivals, weatherNow, referenceMinute]);
  const { arrival: runwayArrival, departure: runwayDeparture, source: runwaySource } = runway;
  const counterpartsKey = counterpartCodes(traffic?.flights).join('|');
  const referenceData = useMemo(() => referenceFeatures(), []);
  const ourAirportsData = useMemo(() => ourAirportsFeatures({
    layout,
    runway: { arrival: runwayArrival, departure: runwayDeparture, source: runwaySource },
    counterparts: counterpartsKey === '' ? EMPTY : counterpartsKey.split('|'),
    language,
    // The globe (M8): the world's airports too, the Dominican ones emphasised.
    world: hasWorld ? WORLD_AIRPORTS : null,
  }), [layout, runwayArrival, runwayDeparture, runwaySource, counterpartsKey, language, hasWorld]);
  const nightWord = t('reference.night');
  const nightData = useMemo(() => nightShadeFeatures(referenceMinute, { label: nightWord }), [referenceMinute, nightWord]);
  // The wind at the airfield (PR M8), from the METAR of the weather with the runway in use, at the server's minute (a
  // live METAR kept after failed refreshes ages into a stale one).
  const windData = useMemo(() => windFeatures({ reading: weatherNow, runway: runwayArrival, layout, language,
    nowMs: referenceMinute }), [weatherNow, runwayArrival, layout, language, referenceMinute]);

  const paddingKey = insetsKey(normalizeInsets(insets));
  const padding = useMemo(() => insetsFromKey(paddingKey), [paddingKey]);
  const referenceStands = presetStands ?? stands;
  const centreLng = airfieldCentre?.[0];
  const centreLat = airfieldCentre?.[1];
  const targets = useMemo(() => presetTargets({ stands: referenceStands, layout,
    airfieldCentre: Number.isFinite(centreLng) && Number.isFinite(centreLat) ? [centreLng, centreLat] : null }),
  [referenceStands, layout, centreLng, centreLat]);
  const groupsKey = JSON.stringify(groups ?? NO_GROUPS);

  // The layers menu (PR M5, core/layersMenu.js): the person's choices, read from the browser once, resolved for the
  // view on screen. The groups they show join the page's own `groups`, which win for a group the page sets itself.
  const [layerOverrides, setLayerOverrides] = useState(() => (layerOverridesProp === undefined
    ? readLayerOverrides(layerStorage())
    : cleanOverrides(layerOverridesProp)));
  // Choices a page gives (the map lab's scenes, PR M8) are not the browser's: they are never written back.
  const [keepsLayers] = useState(() => layerOverridesProp === undefined);
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
  // The satellite images (PR M8): read only while the menu shows one and the map is in Región or Aproximación, and
  // shown only once their tiles are pinned to the time GIBS reports.
  const wanted = wantedImagery({ groups: menuGroups, view: layerView, drawsWeather });
  const imagery = useSatelliteImagery({ goes: wanted.goes, imerg: wanted.imerg, service: satelliteService });
  const menuGroupsKey = JSON.stringify(withPinnedImagery(menuGroups, imagery));
  const shownGroups = useMemo(() => ({ ...JSON.parse(menuGroupsKey), ...JSON.parse(groupsKey) }),
    [menuGroupsKey, groupsKey]);
  // What the traffic draws depends on its own groups only: the references and the weather (PR M8), whose defaults follow
  // the view, never rewrite it (nor wake the frame loop, whose reduced-motion ticks would then wait for a frame).
  const trafficGroupsKey = JSON.stringify(Object.entries(shownGroups).filter(([group]) => !group.startsWith('reference.')
    && !group.startsWith('weather.') && !NON_TRAFFIC_GROUPS.has(group)));
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
      padding, targets, urlView, urlTerminal, defaultView, initialCamera, basemap, overlays, interactive, mapOptions, views,
      followLimits,
      layout, t, language, theme, resumeCameraRef, projection: mapProjection, hasWorld,
      locale: engineLocale(t, labels?.map),
      aircraftDataLabel: t('attribution.aircraftData'),
      drawsStands: standsProp !== undefined, drawsFlights: flightsProp !== undefined, standLabels,
    };
    // The traffic (PR M5): what it draws, the groups the map shows (the page's and the layers menu's), the words of its
    // tags, the trails it draws beside the chosen flight's route, and the layers menu the map keys open and close.
    Object.assign(latest.current, { traffic: traffic ?? null, drawsTraffic: traffic !== undefined, groups: shownGroups,
      language, shownTrails, layersMenuOpen, setLayersMenuOpen });
    // The weather (PR M8): whether the map draws it, the satellite images and the wind it draws.
    Object.assign(latest.current, { drawsWeather, imagery, windData, drawsStructures });
    // Follow mode (PR M6): what the URL says and how to change it.
    Object.assign(latest.current, { urlFollow: urlFollow === true, setFollow });
    // The 3D aircraft (PR M7): whether they are on, and how the page or the browser changes it.
    Object.assign(latest.current, { pitchModeProp, onPitchModeChange, aircraft3dOptions: aircraft3dOptions ?? null });
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
    if (keepsLayers) writeLayerOverrides(layerStorage(), layerOverrides);
  }, [layerOverrides, keepsLayers]);

  // Follow mode ends (PR M6): at once for the frames, then in the URL; `notice` says so to the person who moved the
  // camera away («Dejaste de seguir a … Pulsa Seguir para volver.»).
  // «Seguir en 3D» ends (CN-30): the gestures go back to MapLibre and, when `restore`, the camera flies back to where it
  // was before it started; a view or a stand asked for takes the camera instead.
  const endFollow3d = useCallback(({ restore = false } = {}) => {
    const applied = appliedRef.current;
    const f3 = applied.follow3d;
    if (!f3?.on) return;
    const saved = f3.saved;
    applied.follow3d = { ...FOLLOW_3D_OFF };
    const engine = engineRef.current;
    engine?.setOrbitMode(false);
    // M4: the labels hidden close up come back, and the sky goes with the 3D follow unless the 3D views keep it.
    engine?.setCloseUp?.(false);
    syncSky(engine, applied, latest.current?.theme);
    // The next write plans no followed aircraft: its detailed model goes.
    applied.loop?.wake();
    // Fix M4: the camera it flies back to is kept for the 3D that may take over while it flies (another aircraft's
    // double click): that one goes back to the view from before the first 3D, not to a camera partway through this ease.
    applied.lastFollow3dSaved = restore && saved ? { saved, at: performance.now() } : null;
    if (restore && saved && engine?.map) {
      engine.easeTo({ center: saved.center, zoom: saved.zoom, bearing: saved.bearing ?? 0, pitch: saved.pitch ?? 0,
        duration: FOLLOW_3D_RESTORE_MS, essential: false });
    }
    followSubject.set(null);
    setFollow3dUi(null);
  }, [followSubject]);

  // A map fixed on the airport (M9, `followLimits`): following lets the held camera go, and the end of it holds the
  // camera again with the limits of `mapOptions`, once the move on the way (the flight back, a drag) is over.
  const releaseCamera = useCallback(() => {
    const applied = appliedRef.current;
    const limits = latest.current?.followLimits;
    if (!limits || applied.limitsReleased) return;
    applied.limitsReleased = true;
    engineRef.current?.setCameraLimits(limits);
  }, []);
  const holdCamera = useCallback(() => {
    const applied = appliedRef.current;
    if (!applied.limitsReleased) return;
    applied.limitsReleased = false;
    const { maxBounds = null, minZoom = null, maxZoom = null } = latest.current?.mapOptions ?? {};
    engineRef.current?.setCameraLimits({ maxBounds, minZoom, maxZoom }, { afterMove: true });
  }, []);

  const stopFollowing = useCallback(({ notice = false, restore = false } = {}) => {
    const applied = appliedRef.current;
    const state = applied.follow;
    const wasOn = state?.on === true;
    endFollow3d({ restore });
    if (state) Object.assign(state, { on: false, engage: false, transition: false });
    if (notice && wasOn) setFollowNotice({ name: followedName(applied.chosen) });
    holdCamera();
    if (latest.current?.urlFollow) latest.current.setFollow(false);
  }, [endFollow3d, holdCamera]);

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
    const target = view === WORLD_VIEW && !latest.current.hasWorld ? null : targetFor(latest.current.targets, view, terminal);
    // The world (M8) is a camera of its own; every other view frames its box.
    const camera = Number.isFinite(target?.zoom) && engineRef.current?.map
      ? { center: targetCenter(target), zoom: target.zoom, padding: latest.current.padding }
      : cameraFor(target?.bounds);
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
    if (!(latest.current?.views ?? VIEW_NAMES).includes(view)) return;
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
  // Where the last traffic write drew an aircraft (its id), as `[lng, lat]`, or null: the map lab's motion measurements
  // read what the map holds, not a new sample.
  const drawnPosition = useCallback(id => {
    const drawn = appliedRef.current?.sampledAircraft ?? latest.current?.traffic?.aircraft ?? EMPTY;
    const item = drawn.find(entry => entry?.id === id);
    return item && Number.isFinite(item.lon) && Number.isFinite(item.lat) ? [item.lon, item.lat] : null;
  }, []);

  // The traffic (PR M5). The aircraft of other traffic under the pointer, whose tag shows while it is there.
  const trafficFocusRef = useRef(null);

  // The 3D aircraft of a write (PR M7, core/aircraft3d.js): the aircraft it drew and those the stands draw, planned at the
  // camera's zoom from the polygons threshold on; answers the ids the 3D draws, whose 2D silhouettes give way.
  const plan3d = useCallback((drawn, selectedId = null) => {
    const applied = appliedRef.current;
    const controller = applied.aircraft3d;
    if (!controller) return NO_IDS;
    const zoom = engineRef.current?.getCamera()?.zoom;
    // «Seguir en 3D» (CN-30): the followed aircraft gets its detailed model at any zoom, even with the 3D off or paused.
    // Under the globe (M8) the 3D waits for the zoom where the globe is Mercator again: the layer's frames are Mercator's.
    const { minZoom, followedId } = projected3d({
      projection: latest.current?.projection, zoom, minZoom: store.get().thresholds?.polygons,
      followedId: applied.follow3d?.on ? selectedId : null, globeMercatorZoom: GLOBE_MERCATOR_ZOOM,
    });
    applied.reached3d = Number.isFinite(zoom) && Number.isFinite(minZoom) && zoom >= minZoom;
    const parked = applied.drawsStands ? parkedFromStands(latest.current.attached, drawn, applied.parkedIds ?? NO_IDS) : EMPTY;
    return controller.plan({ aircraft: drawn, parked, zoom, minZoom, selectedId, followedId });
  }, [store]);

  // The aircraft of a write where they are drawn at `t` (CN-18): those in or around the area in sight
  // (TRAFFIC_MARGIN, where the last write drew them) are sampled again; the others keep where the last write drew them,
  // until the camera moves, a read brings new aircraft or FULL_SAMPLE_MS passed, when every one is sampled and only
  // those that came near the area in sight move. Only those around the area in sight count as moving.
  const sampleTraffic = useCallback((motion, aircraft, t, engine, inset) => {
    const applied = appliedRef.current;
    const zone = widenBounds(engine.getVisibleBounds(inset), TRAFFIC_MARGIN);
    const relevant = item => zone === null || isInBounds([item.lon, item.lat], zone);
    const viewKey = cameraKey(engine.getCamera());
    const last = applied.sampledById;
    // In «Seguir en 3D» the camera moves every frame (CN-30): that alone samples no more than the area around it.
    const moved = viewKey !== applied.trafficViewKey && applied.follow3d?.on !== true;
    const full = last === null || aircraft !== applied.sampledFrom || moved
      || !Number.isFinite(applied.fullSampleAt) || t < applied.fullSampleAt || t - applied.fullSampleAt >= FULL_SAMPLE_MS;
    let result;
    if (full) {
      result = motion.sample(aircraft, t, { relevant });
      applied.fullSampleAt = t;
      // What stays away from the area in sight keeps where it was written: moving it there changes nothing anyone
      // sees and would only make MapLibre lay out and draw the traffic again.
      if (last !== null) {
        result = result.map((item, index) => {
          const before = last.get(aircraft[index]?.id);
          return item && before && !relevant(item) && !relevant(before) ? before : item;
        });
      }
    } else {
      const due = aircraft.filter(item => {
        const before = last.get(item?.id);
        return before === undefined || relevant(before);
      });
      const fresh = new Map(motion.sample(due, t, { relevant }).map((item, index) => [due[index]?.id, item]));
      result = aircraft.map(item => (fresh.has(item?.id) ? fresh.get(item.id) : last.get(item?.id) ?? null));
    }
    applied.sampledById = new Map(aircraft.map((item, index) => [item?.id, result[index] ?? undefined])
      .filter(([, item]) => item !== undefined && item !== null));
    applied.sampledFrom = aircraft;
    applied.trafficViewKey = viewKey;
    return result;
  }, []);

  // The traffic's features from the newest props: one updateData with what changed since the last write. With motion
  // (PR M6) the aircraft are those of the situation where they are drawn at `tMs` (the frame's instant, else the render
  // clock's now), and the write says how long until the next one is due.
  const writeTraffic = useCallback((tMs = null) => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    // A map without traffic plans the aircraft its stands draw only (PR M7).
    if (engine && !applied.drawsTraffic) plan3d(EMPTY);
    if (!engine || !applied.drawsTraffic) return;
    const { traffic: current, selection: chosen, groups: shown, language: words, padding: inset } = latest.current;
    const motion = applied.loop ? current?.motion ?? null : null;
    const aircraft = current?.aircraft ?? EMPTY;
    let drawn = aircraft;
    if (motion) {
      const t = Number.isFinite(tMs) ? tMs : applied.loop.now();
      drawn = sampleTraffic(motion, aircraft, t, engine, inset).filter(Boolean);
      applied.trafficWrittenAt = t;
      // «Seguir en 3D» (CN-30): the followed aircraft and its camera move every frame, so the traffic is written every
      // frame (at that zoom only a few aircraft are in or around the area in sight).
      applied.trafficIntervalMs = applied.follow3d?.on ? 0 : writeIntervalFor(engine, drawn, inset);
      // Only what moves in or around the area in sight keeps the frames going (CN-18).
      applied.trafficMoving = motion.isAnimating?.(t) === true;
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
      parkedIds: applied.parkedIds, modelIds: plan3d(drawn, chosenId),
    });
    const diff = trafficDiff(applied.trafficById, data.features);
    if (isEmptyDiff(diff)) return;
    applied.trafficById = featuresById(data);
    engine.updateData(TRAFFIC_SOURCE, diff).catch(error => console.error('The OCC map could not update its traffic.', error));
  }, [store, plan3d, sampleTraffic]);

  // A camera or a fit that takes the zoom across the polygons threshold shows or hides the stands and the aircraft on
  // them (PR M6): the parked aircraft's symbols go or come back with them, in one write.
  const syncParkedTraffic = useCallback(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine) return;
    // The 3D aircraft come and go at the same threshold (PR M7), on a map with or without stands.
    const minZoom = store.get().thresholds?.polygons;
    const zoom = engine.getCamera()?.zoom;
    const reached3d = Number.isFinite(zoom) && Number.isFinite(minZoom) && zoom >= minZoom;
    if (applied.aircraft3d && reached3d !== applied.reached3d) {
      writeTraffic();
      return;
    }
    if (!applied.drawsTraffic || !applied.drawsStands) return;
    if (standsDrawnAt(zoom, store.get().thresholds) !== applied.standsShown) writeTraffic();
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
      if (applied.follow3d?.on && tMs - last.at < FOLLOW_3D_ROUTE_MS) return;
    }
    applied.routeFrame = { id: item.id, at: tMs, point };
    // What the source holds is no longer what the props brought: their next route is written again.
    applied.route = null;
    // CN-29: with its track, speed and ground flag, so an arrival off its plan flies its own approach.
    const state = { trackDeg: item.trackDeg ?? null, gsMs: item.gsMs ?? null, onGround: item.onGround === true };
    engine.setData(ROUTE_SOURCE, current.routeAt(tMs, point, state) ?? EMPTY_COLLECTION);
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
    const airfield = airfieldDrawn ? airfieldKindsOnScreen(engine.renderedFeatures(AIRFIELD_LEGEND_LAYER_IDS, padding)) : EMPTY;
    // The references drawn there (PR M8), read back from the map as the airfield is, for the groups that are shown.
    const referenceIds = bounds === null ? EMPTY : referenceLayersShown(latest.current.groups);
    const references = referenceIds.length === 0
      ? NO_REFERENCES_ON_SCREEN
      : referencesOnScreenOf(engine.renderedFeatures(referenceIds, padding));
    // The weather drawn there (PR M8): the wind, read back from the map; a satellite image while its group is shown
    // (once pinned) below the airfield threshold, as a raster is not read back. Listed after the references.
    const { groups: shown, imagery: images } = latest.current;
    const weatherShown = appliedRef.current.drawsWeather && bounds !== null ? weatherOnScreen({
      wind: shown?.['weather.wind'] === false ? EMPTY : engine.renderedFeatures(WIND_LAYER_IDS, padding),
      rasters: Object.fromEntries(SATELLITE_KEYS.map(key => [key,
        shown?.[`weather.${key}`] === true && !(zoom >= thresholds?.airfield)])),
      imagery: images,
    }) : null;
    const onScreen = weatherShown === null || weatherShown.kinds.length === 0
      ? references
      : { kinds: [...references.kinds, ...weatherShown.kinds], runway: references.runway, imagery: weatherShown.imagery };
    const previous = store.get();
    store.set({
      ...(standsKey(next) === standsKey(previous.standsOnScreen) ? {} : { standsOnScreen: next.length === 0 ? EMPTY : next }),
      ...(sameList(chips, previous.chipsOnScreen) ? {} : { chipsOnScreen: chips.length === 0 ? EMPTY : chips }),
      ...(sameList(marks, previous.standMarksOnScreen) ? {} : { standMarksOnScreen: marks.length === 0 ? EMPTY : marks }),
      ...(flightsKey(flights) === flightsKey(previous.flightsOnScreen)
        ? {}
        : { flightsOnScreen: flights.length === 0 ? EMPTY : flights }),
      ...(sameList(airfield, previous.airfieldOnScreen) ? {} : { airfieldOnScreen: airfield.length === 0 ? EMPTY : airfield }),
      ...(referencesKey(onScreen) === referencesKey(previous.referencesOnScreen)
        ? {}
        : { referencesOnScreen: onScreen.kinds.length === 0 ? NO_REFERENCES_ON_SCREEN : onScreen }),
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
    }), current, { world: latest.current.hasWorld === true });
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

  // The tooltip of the wind (PR M8) a hit names: what the wind the map draws says now, in the screen's language, or null
  // for anything else.
  const windTooltipOf = useCallback(hit => {
    if (hit?.kind !== 'wind') return null;
    const { windData: data, language: words } = latest.current;
    const info = windTooltip(data?.features?.[0]?.properties, words);
    return info === null ? null : { kind: 'wind', id: WIND_FEATURE_ID, title: info.title, detail: info.detail,
      reasons: info.lines.map(text => ({ signal: null, text })) };
  }, []);

  // The wind's tooltip says what the wind says now: a new METAR, the runway in use or the language change its words, and
  // a wind that is no longer drawn closes it.
  const refreshWindTooltip = useCallback(() => {
    const tooltip = store.get().tooltip;
    if (tooltip?.kind !== 'wind') return;
    const info = windTooltipOf(tooltip);
    if (info === null) store.set({ tooltip: null });
    else if (JSON.stringify(info) !== JSON.stringify({ kind: tooltip.kind, id: tooltip.id, title: tooltip.title,
      detail: tooltip.detail, reasons: tooltip.reasons })) store.set({ tooltip: { ...tooltip, ...info } });
  }, [store, windTooltipOf]);

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
    // closes it (a stand's says what its drawer says). The wind's is held the same way (PR M8).
    const info = airfieldTooltip(hit) ?? windTooltipOf(hit);
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
  }, [store, showTooltip, requestView, windTooltipOf]);

  // A double click (M4): on an aircraft (its 2D symbol, its 3D model, or a stand it is parked on) it chooses it and
  // starts «Seguir en 3D», and MapLibre does not zoom; anywhere else MapLibre zooms in as always.
  const handleDoubleClick = useCallback(event => {
    const props = latest.current;
    if (!event || props?.placing) return;
    const { hit } = event;
    const three = props.followInfo?.three;
    if (!hit || hit.id == null || !three) return;
    let target = null;
    if (hit.kind === 'flight' || hit.kind === 'aircraft') target = { kind: hit.kind, id: String(hit.id) };
    else if (hit.kind === 'stand') target = three.parkedAt(String(hit.id));
    // M4: the double click flies in to «Muy cerca».
    if (target !== null && three.startOn(target, { view: 'close' })) event.preventDefault?.();
  }, []);

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
    // The wind's tooltip (PR M8) shows on the same terms as a runway's.
    if (event && !event.originalEvent?.buttons) {
      if (trafficId !== null) info = aircraftTooltipOf(trafficId);
      else info = hit?.kind === 'stand' ? standTooltipOf(hit.id) : (windTooltipOf(hit) ?? airfieldTooltip(hit));
    }
    if (info === null) {
      if (current !== null) store.set({ tooltip: null });
      return;
    }
    if (current?.kind === info.kind && current.id === info.id) return;
    showTooltip(info, event.point, event.lngLat, false);
  }, [store, showTooltip, standTooltipOf, windTooltipOf, aircraftTooltipOf]);

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

  // «Seguir en 3D», one frame (CN-30, kinematics/orbitCamera.js): what the person holds and the automatic turn move the
  // orbit by the frame's time; the camera flies in from where it was, then eases every frame onto the orbit round the
  // aircraft where this frame's write drew it (the pivot, at its height above the field), so it never jitters or jumps;
  // under reduced motion it is put there at once and nothing turns by itself. The panel reads the aircraft twice a
  // second.
  const follow3dFrame = useCallback((tMs, { dtMs = 0, reduced = false, item }) => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    const f3 = applied.follow3d;
    const dtS = Math.max(0, dtMs) / 1_000;
    if (!reduced) f3.orbit = orbitAdvance(f3.orbit, dtS, f3.hold);
    // M4: past zoom 19.5 the camera would end inside a long fuselage; the orbit stops where the type's length allows.
    const closest = closestZoomOf(f3, item, engine);
    if (f3.orbit.zoom > closest) f3.orbit = orbitZoom(f3.orbit, closest - f3.orbit.zoom);
    const fieldElevationM = (latest.current?.layout?.meta?.elevationFt ?? 0) * METRES_PER_FOOT;
    // The 3D model moves with the camera every frame, and the camera pivots at the height the model is drawn at
    // (aircraft/attitude.js: never under the runway).
    const controller = applied.aircraft3d;
    controller?.poseFollowed?.(item);
    const pose = controller?.followedPose?.() ?? null;
    const heightM = pose?.id === item.id && Number.isFinite(pose.heightM) ? pose.heightM : null;
    const target = orbitTarget(f3.orbit, item, { fieldElevationM, heightM });
    if (target === null) return;
    let next;
    if (f3.entry !== null && !reduced) {
      if (!Number.isFinite(f3.entry.startMs)) f3.entry.startMs = tMs;
      const u = (tMs - f3.entry.startMs) / FOLLOW_3D_ENTRY_MS;
      next = entryCamera(f3.entry.from, target, u);
      if (u >= 1) f3.entry = null;
    } else {
      f3.entry = null;
      next = reduced || f3.camera === null ? target : stepOrbitCamera(f3.camera, target, dtS);
    }
    f3.camera = next;
    // M4: close up (past zoom 19.5, a fifth of a level back before it lets go, so a zoom resting on it does not flicker)
    // the map hides the labels that would crowd the aircraft; the engine changes nothing while the answer stays.
    engine.setCloseUp?.(next.zoom > CLOSE_UP_ZOOM - (engine.isCloseUp?.() ? CLOSE_UP_RELEASE : 0));
    applied.followMoving = true;
    applied.followFrameAt = tMs;
    try {
      engine.jumpTo({ center: next.center, zoom: next.zoom, pitch: next.pitch, bearing: next.bearing,
        elevation: next.elevation });
    } finally {
      applied.followMoving = false;
    }
    if (!Number.isFinite(f3.subjectAt) || tMs - f3.subjectAt >= FOLLOW_3D_SUBJECT_MS || tMs < f3.subjectAt) {
      f3.subjectAt = tMs;
      followSubject.set(Object.freeze({ item, atMs: tMs, orbit: f3.orbit }));
    }
  }, [followSubject]);

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
    releaseCamera();
    const current = engine.getCamera();
    if (!current) return;
    // «Seguir en 3D» (CN-30): the orbit round the aircraft instead of the framing.
    if (applied.follow3d?.on) {
      follow3dFrame(tMs, { dtMs, reduced, item });
      return;
    }
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
  }, [follow3dFrame, releaseCamera]);

  // Whether follow mode still has the camera to move: while it engages or has not reached the aircraft's framing.
  const followAnimating = useCallback(() => {
    const applied = appliedRef.current;
    const state = applied.follow;
    // In «Seguir en 3D» (CN-30) the camera moves with the aircraft every frame.
    if (state?.on === true && applied.chosen !== null && applied.follow3d?.on) return true;
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

  // A click or a pointer move picks the 3D aircraft first (PR M7, design G3), translated to what the 2D picking names
  // (core/aircraft3d.js: translatePick); where the 3D draws nothing under the pointer, the 2D pick stands.
  const with3dHit = useCallback(event => {
    const controller = appliedRef.current.aircraft3d;
    if (!event || !controller?.state().enabled) return event;
    let hit;
    const base = { point: event.point, lngLat: event.lngLat, originalEvent: event.originalEvent };
    // A double click's (M4) keeps the call that cancels MapLibre's zoom.
    if (typeof event.preventDefault === 'function') base.preventDefault = event.preventDefault;
    return Object.defineProperty(base, 'hit', {
      enumerable: true,
      get() {
        if (hit === undefined) {
          const picked = event.point ? controller.pick(event.point) : null;
          const drawn = appliedRef.current.sampledAircraft ?? latest.current?.traffic?.aircraft ?? EMPTY;
          hit = (picked && translatePick(picked, drawn)) ?? event.hit;
        }
        return hit;
      },
    });
  }, []);

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
      // the stand selected when the map starts is framed by the view, not eased to. The stand labels start without a
      // filter: no stand's label is left out yet (N29).
      standFlags: NO_FLAGS, ghost: null, pendingGhost: null, ghostKey: '[]', placingCode: null,
      easedFor: props.selection?.kind === 'stand' ? mapStandCode(props.selection.id) || null : null,
      labelsWithout: null,
    };
    // The traffic of this engine: what its source holds, and the trails and route written.
    Object.assign(appliedRef.current, { drawsTraffic: props.drawsTraffic, trafficById: new Map(), trails: null,
      route: null });
    // The ELEVANT aircraft the stands draw instead (PR M6), and whether the stands were drawn at the last write.
    Object.assign(appliedRef.current, { parkedIds: NO_IDS, standsShown: null });
    // Its motion (PR M6): one frame loop for the life of the engine, on the render clock of the motion it was given.
    const motionClock = props.drawsTraffic && props.traffic?.motion ? props.traffic.motion.clock ?? createRenderClock() : null;
    const reduced = motionClock ? reducedMotionQuery() : null;
    const loop = motionClock ? createFrameLoop({ clock: motionClock, reducedMotion: reduced?.matches === true }) : null;
    Object.assign(appliedRef.current, { loop, sampledAircraft: null, trafficWrittenAt: null, trafficIntervalMs: 0,
      trafficOnScreenAt: null, trafficMoving: false, sampledById: null, sampledFrom: null, trafficViewKey: '',
      fullSampleAt: null });
    // The chosen aircraft as the last write drew it, its route as the frames last wrote it, and follow mode (PR M6).
    Object.assign(appliedRef.current, { chosen: null, routeFrame: null, follow: { ...FOLLOW_OFF }, followMoving: false,
      followFrameAt: null, followOnScreenAt: null, follow3d: { ...FOLLOW_3D_OFF }, limitsReleased: false });
    const motionState = () => ({ available: true, paused: motionClock.isPaused?.() === true,
      pausedAt: motionClock.pausedAt?.() ?? null, dataAt: latest.current?.traffic?.motion?.dataAt?.() ?? null });
    store.set({ motion: loop ? motionState() : MOTION_OFF });
    // Each frame writes the traffic when its write is due, with the chosen flight's route where it drew its aircraft,
    // and the legend reads it at most once a second.
    const onFrame = tMs => {
      const applied = appliedRef.current;
      if (Number.isFinite(applied.trafficWrittenAt) && tMs - applied.trafficWrittenAt < applied.trafficIntervalMs) {
        // A newly chosen aircraft gets its route at once, where the last write drew it.
        if (applied.chosen && applied.routeFrame?.id !== applied.chosen.id) writeFrameRoute(tMs);
        return;
      }
      writeTraffic(tMs);
      writeFrameRoute(tMs);
      if (Number.isFinite(applied.trafficOnScreenAt) && tMs - applied.trafficOnScreenAt < MOVING_ON_SCREEN_MS) return;
      applied.trafficOnScreenAt = tMs;
      const current = engineRef.current;
      updateTrafficOnScreen(current?.getVisibleBounds(latest.current.padding) ?? null, current?.getCamera()?.zoom,
        store.get().thresholds);
    };
    // The traffic keeps the frames going while something moves around the area in sight at its last write (CN-18): a
    // frame between two writes asks nothing of the motion store.
    const stopFrames = loop?.subscribe(onFrame, {
      isAnimating: () => Boolean(latest.current?.traffic?.motion) && appliedRef.current.trafficMoving === true,
    });
    // Follow mode after the traffic in every frame, so the camera frames the aircraft where that frame drew it.
    const stopFollowFrames = loop?.subscribe(followFrame, { isAnimating: followAnimating });
    const onReducedMotion = () => loop.setReducedMotion(reduced.matches === true);
    reduced?.addEventListener?.('change', onReducedMotion);
    const stopClock = motionClock?.subscribe?.(() => store.set({ motion: motionState() }));
    // The weather of this engine (PR M8): the wind written, the tiles each satellite image is pinned to, and the credit
    // shown.
    Object.assign(appliedRef.current, { drawsWeather: props.drawsWeather, wind: null, rasterTiles: {}, credit: '' });
    focusRef.current = null;
    pendingViewRef.current = null;
    // The camera of the map this one replaces after a theme change (OccMap), else the URL view, else the camera the
    // page kept, else the default view.
    const kept = props.resumeCameraRef?.current;
    const resume = kept && kept.theme !== props.theme && kept.camera ? kept.camera : null;
    if (props.resumeCameraRef) props.resumeCameraRef.current = null;
    const initialView = resume ? null : props.urlView ?? (props.initialCamera ? null : props.defaultView);
    const initialTerminal = props.urlView ? props.urlTerminal : null;
    const angles = cameraAngles(initialView ?? props.defaultView, props.pitchMode);
    // A view starts over its target, so a map that has no size yet waits there and not at MapLibre's [0, 0].
    const start = initialView === null
      ? { ...angles, ...(resume ?? props.initialCamera) }
      : { ...angles, center: targetCenter(targetFor(props.targets, initialView, initialTerminal)) ?? undefined };

    // The airfield goes before the references: they share the airfield slot, and the mark of PUJ stays above the
    // pavement.
    const overlays = [
      selectionOverlay(),
      ...(props.layout ? [airfieldOverlay({ structures: props.drawsStructures === true })] : []),
      // The globe (M8): the world from afar (Blue or Black Marble of NASA GIBS), under the night of the references.
      ...(props.hasWorld ? [worldBaseOverlay({ theme: props.theme })] : []),
      // The region's airports with the traffic they are context for (owner request of 2026-11-15), and on the globe the
      // world's, the Dominican ones emphasised (M8).
      referenceOverlay({ airports: props.drawsTraffic, theme: props.theme, world: props.hasWorld }),
      ...(props.drawsStands ? [standOverlay({ labels: props.standLabels, theme: props.theme })] : []),
      ...(props.drawsFlights ? [flightOverlay()] : []),
      ...(props.drawsTraffic ? [trafficOverlay({ theme: props.theme })] : []),
      // The weather (PR M8): the satellite images under the references, the wind over the stands.
      ...(props.drawsWeather ? [weatherOverlay()] : []),
      ...props.overlays,
    ];
    // The keys of the layers menu this style has layers for (PR M5).
    store.set({ layerKeys: availableLayerKeys({ layers: overlays.flatMap(overlay => overlay.layers ?? []) }) });
    const engine = createMapEngine({
      maplibre,
      host: hostRef.current,
      style: buildOccStyle({ basemap: props.basemap, overlays, theme: props.theme, projection: props.projection }),
      camera: start,
      interactive: props.interactive,
      attribution: buildAttribution([], { aircraftDataLabel: props.aircraftDataLabel }),
      imageResolver: createImageResolver({ theme: props.theme }),
      mapOptions: { ...props.mapOptions, locale: props.locale },
      onStatus: handleStatus,
      onCamera: handleCamera,
      // What the map draws is final once it settles: the legend reads it again then.
      onIdle: () => {
        updateOnScreen();
        markSettled(rootRef.current, true);
      },
      onResize: refit,
      onClick: event => handleClick(with3dHit(event)),
      onDoubleClick: event => handleDoubleClick(with3dHit(event)),
      onPointerMove: event => handlePointer(with3dHit(event)),
      onUserGesture: handleGesture,
    });
    engineRef.current = engine;
    // The 3D aircraft of this engine (PR M7): fed by the writes of its traffic on its one frame loop, lit by the sun at
    // the render clock's instant, re-created with the engine for another theme.
    const sunClock = motionClock ?? createRenderClock({ frozenAt: Number.isFinite(props.frozenAt) ? props.frozenAt : null });
    const aircraft3d = props.drawsTraffic || props.drawsStands ? createAircraft3dController({
      engine,
      originLngLat: props.layout?.meta?.arp ?? PUJ_ARP,
      fieldElevationM: (props.layout?.meta?.elevationFt ?? 0) * METRES_PER_FOOT,
      theme: props.theme,
      getNow: () => sunClock.now(),
      governor: props.aircraft3dOptions?.governor !== false,
      liveries: props.aircraft3dOptions?.liveries === true,
      onChange: () => {
        if (appliedRef.current.aircraft3d !== aircraft3d) return;
        store.set({ view3d: aircraft3d.state() });
        writeTraffic();
      },
    }) : null;
    Object.assign(appliedRef.current, { aircraft3d, reached3d: null });
    aircraft3d?.setEnabled(props.pitchMode === '3d');
    syncSky(engine, appliedRef.current, props.theme);
    if (props.layout) engine.setData(AIRFIELD_SOURCE, airfieldFeatures(props.layout));
    if (props.layout && props.drawsStructures) engine.setData(AIRFIELD_STRUCTURES_SOURCE, airportStructures(props.layout));
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
      // «Seguir en 3D» (CN-30) does not outlive its engine (a theme change re-creates the map).
      appliedRef.current.lastFollow3dSaved = null;
      if (appliedRef.current.follow3d?.on) {
        appliedRef.current.follow3d = { ...FOLLOW_3D_OFF };
        setFollow3dUi(null);
      }
      stopClock?.();
      reduced?.removeEventListener?.('change', onReducedMotion);
      loop?.dispose();
      if (appliedRef.current.loop === loop) appliedRef.current.loop = null;
      // Read before teardown: a map re-created for another theme opens where this one was.
      const resumeRef = latest.current?.resumeCameraRef;
      if (resumeRef) resumeRef.current = { theme: latest.current.theme, camera: engine.getCamera() };
      // The 3D layer goes with its renderer before the map (PR M7).
      aircraft3d?.dispose();
      if (appliedRef.current.aircraft3d === aircraft3d) appliedRef.current.aircraft3d = null;
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [store, applyView, handleCamera, handleClick, handleDoubleClick, handlePointer, handleStatus, refit, updateOnScreen,
    writeTraffic, updateTrafficOnScreen, writeFrameRoute, followFrame, followAnimating, handleGesture, with3dHit]);

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

  // The references (PR M8): one setData of their source when the map starts; one of the OurAirports source then, and
  // again only when the runway in use, the counterparts or the language change what it draws; the night shade once a
  // minute. Never a new map.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || applied.references === referenceData) return;
    applied.references = referenceData;
    engine.setData(REFERENCE_SOURCE, referenceData);
    markSettled(rootRef.current, false);
  }, [referenceData]);
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || applied.ourAirports === ourAirportsData) return;
    applied.ourAirports = ourAirportsData;
    engine.setData(OURAIRPORTS_SOURCE, ourAirportsData);
    markSettled(rootRef.current, false);
  }, [ourAirportsData]);
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || applied.night === nightData) return;
    applied.night = nightData;
    engine.setData(NIGHT_SOURCE, nightData);
    markSettled(rootRef.current, false);
  }, [nightData]);

  // The weather (PR M8): the wind, one setData when what it draws changes (a new METAR, the runway in use, the language,
  // a METAR that ages), never on a read that brings the same; its tooltip follows.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsWeather) return;
    const key = JSON.stringify(windData.features);
    if (applied.wind === key) return;
    applied.wind = key;
    engine.setData(WIND_SOURCE, windData);
    markSettled(rootRef.current, false);
    refreshWindTooltip();
  }, [windData, refreshWindTooltip]);
  // Each satellite image pinned to the time GIBS reports, once per image and before the layers menu shows it (this
  // effect runs before the menu's); the legend follows.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsWeather) return;
    for (const key of SATELLITE_KEYS) {
      const tiles = imagery[key].status === 'ready' ? satelliteTiles(key, imagery[key]) : null;
      if (tiles === null || applied.rasterTiles[key] === tiles[0]) continue;
      applied.rasterTiles[key] = tiles[0];
      engine.setRasterTiles(SATELLITE_SOURCES[key], tiles);
      markSettled(rootRef.current, false);
    }
    updateOnScreen();
  }, [imagery, updateOnScreen]);

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
    // The stands' aircraft are 3D models too (PR M7), on a map with or without traffic.
    if (applied.drawsStands && (applied.drawsTraffic || applied.aircraft3d)) writeTraffic();
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
      endFollow3d({ restore: false });
      holdCamera();
      return;
    }
    if (state.on && state.key === selectionKey) return;
    Object.assign(state, { ...FOLLOW_OFF, on: true, key: selectionKey, engage: true, converged: false });
    setFollowNotice(null);
    applied.loop?.wake();
  }, [followingNow, selectionKey, endFollow3d, holdCamera]);

  // A selection that no longer names an aircraft (cleared, or a stand chosen) leaves nothing to follow.
  const lastSelectionRef = useRef(undefined);
  useEffect(() => {
    const previous = lastSelectionRef.current;
    lastSelectionRef.current = selectionKey;
    if (previous === undefined || previous === selectionKey) return;
    // Another aircraft chosen ends «Seguir en 3D» (CN-30): the camera flies back and nothing is followed.
    if (appliedRef.current.follow3d?.on) {
      stopFollowing({ notice: false, restore: true });
      return;
    }
    const kind = latest.current?.selection?.kind ?? null;
    if (latest.current?.urlFollow && kind !== 'flight' && kind !== 'aircraft') latest.current.setFollow(false);
  }, [selectionKey, stopFollowing]);

  // «Dejaste de seguir a …» stays a few seconds.
  useEffect(() => {
    if (followNotice === null) return undefined;
    const timer = setTimeout(() => setFollowNotice(null), FOLLOW_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [followNotice]);

  // D and the dock's 2D/3D control (PR M7, contracts 2.2 and 2.3): the page's onPitchModeChange when the page sets the
  // mode, else the browser's choice, remembered. «Volver a 3D» after the governor paused the 3D.
  const toggle3d = useCallback(() => {
    const { pitchModeProp: controlled, onPitchModeChange: change, pitchMode: mode } = latest.current ?? {};
    const next = mode === '3d' ? '2d' : '3d';
    if (controlled !== undefined) {
      change?.(next);
      return;
    }
    writeMode3d(layerStorage(), next === '3d');
    setStored3d(next === '3d');
  }, []);
  const resume3d = useCallback(() => appliedRef.current.aircraft3d?.resume(), []);
  const view3dState = snapshot.view3d;
  const view3d = useMemo(() => Object.freeze({
    available: toggles3d && snapshot.engineStatus !== 'unavailable', on: pitchMode === '3d', toggle: toggle3d,
    status: view3dState.status, notice: view3dState.notice, resume: resume3d,
    // CN-30: the followed aircraft's own 3D («Seguir en 3D»): off, loading, ready or failed.
    follow: view3dState.follow ?? 'off',
  }), [toggles3d, snapshot.engineStatus, pitchMode, toggle3d, view3dState, resume3d]);
  useLayoutEffect(() => {
    latest.current.view3d = view3d;
  });

  // S and the follow buttons: on while a drawn aircraft is chosen, off whenever it is on.
  const toggleFollow = useCallback(() => {
    const info = latest.current?.followInfo;
    if (!info?.available) return;
    if (info.following) stopFollowing({ notice: false });
    else if (info.canFollow) latest.current.setFollow(true);
  }, [stopFollowing]);
  // «Seguir en 3D» (CN-30): starts on the chosen aircraft the map draws (following it, in the URL too), with the camera
  // of «Persecución» flown in from where it was, the 3D aircraft on for it whatever the 2D/3D choice, and MapLibre's own
  // gestures handed to the orbit; «Dejar de seguir», Esc or another aircraft chosen end it and fly the camera back.
  // `view` (M4) is the view it starts in: «Persecución» unless it names another (the double click: «Muy cerca»).
  // `handoff` says it takes over from a 3D that ended for it (a double click waiting for its selection).
  const startFollow3d = useCallback((view, { handoff = false } = {}) => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    const info = latest.current?.followInfo;
    if (!engine?.map || !applied.follow3d || applied.follow3d.on || !(info?.canFollow || info?.following)) return;
    const camera = engine.getCamera();
    if (!camera) return;
    // A click handler passes its event: only a view's name is one.
    const start = typeof view === 'string' && Object.hasOwn(ORBIT_VIEWS, view) ? view : 'chase';
    // Taking over from a 3D still flying back (or one that ended for it), it keeps that one's camera to return to; the
    // entry flies from where the camera is now.
    const last = applied.lastFollow3dSaved;
    applied.lastFollow3dSaved = null;
    const resumed = last && (handoff || performance.now() - last.at < FOLLOW_3D_RESTORE_MS) ? last.saved : null;
    applied.follow3d = {
      ...FOLLOW_3D_OFF, on: true, saved: resumed ?? camera, entry: { from: camera, startMs: null },
      orbit: orbitFor(start, { item: applied.chosen, engine,
        trackDeg: applied.chosen?.trackDeg ?? camera.bearing ?? 0 }),
      subjectAt: null,
    };
    engine.setOrbitMode(true);
    syncSky(engine, applied, latest.current.theme);
    if (!latest.current.urlFollow) latest.current.setFollow(true);
    setFollowNotice(null);
    setFollow3dUi({ view: start, auto: false });
    applied.loop?.wake();
  }, []);
  const stopFollow3d = useCallback(() => {
    stopFollowing({ notice: false, restore: true });
  }, [stopFollowing]);
  // M4: «Seguir en 3D» on an aircraft that may not be chosen yet (a double click, a stand's inspector): `target` is the
  // selection a click on it makes. Chosen and drawn, it starts now; else the map chooses it (onSelect) and starts once
  // the selection names it (pendingFollow3dRef). Answers whether the map takes it: false for something it cannot follow.
  const pendingFollow3dRef = useRef(null);
  // `view` is the view it starts in (the double click: «Muy cerca»).
  const startFollow3dOn = useCallback((target, { view = 'chase' } = {}) => {
    const props = latest.current;
    if (!props?.followInfo?.available || !target || target.id == null) return false;
    const id = selectedAircraftId(props.traffic?.aircraft ?? EMPTY, target);
    if (id === null) return false;
    const current = props.selection;
    const currentId = current?.kind === 'flight' || current?.kind === 'aircraft'
      ? selectedAircraftId(props.traffic?.aircraft ?? EMPTY, current) : null;
    if (currentId === id) {
      pendingFollow3dRef.current = null;
      if (!appliedRef.current.follow3d?.on) startFollow3d(view);
      return true;
    }
    pendingFollow3dRef.current = { id, view, from: current ? `${current.kind}:${current.id}` : '',
      handoff: appliedRef.current.follow3d?.on === true };
    props.onSelect?.({ kind: target.kind, id: String(target.id) });
    return true;
  }, [startFollow3d]);
  const parkedAt = useCallback(code => parkedTargets.get(mapStandCode(code)) ?? null, [parkedTargets]);
  // A change of the orbit from the panel or a gesture: `change(orbit)` gives the next one.
  const changeOrbit = useCallback(change => {
    const applied = appliedRef.current;
    const f3 = applied.follow3d;
    if (!f3?.on || !f3.orbit) return;
    const next = change(f3.orbit);
    if (next === f3.orbit) return;
    f3.orbit = next;
    setFollow3dUi(ui => (ui && (ui.view !== next.view || ui.auto !== next.auto) ? { view: next.view, auto: next.auto } : ui));
    applied.loop?.wake();
  }, []);
  const follow3d = useMemo(() => Object.freeze({
    on: follow3dUi !== null,
    view: follow3dUi?.view ?? null,
    auto: follow3dUi?.auto === true,
    subject: followSubject,
    start: startFollow3d,
    stop: stopFollow3d,
    setView: view => changeOrbit(orbit => orbitFor(view, { item: appliedRef.current.chosen, engine: engineRef.current,
      trackDeg: appliedRef.current.chosen?.trackDeg ?? 0, auto: orbit.auto })),
    rotate: sign => changeOrbit(orbit => orbitRotate(orbit, Math.sign(sign) * ORBIT.rotateStepDeg)),
    tilt: sign => changeOrbit(orbit => orbitTilt(orbit, Math.sign(sign) * ORBIT.tiltStepDeg)),
    zoom: sign => changeOrbit(orbit => orbitZoom(orbit, Math.sign(sign) * ORBIT.zoomStep)),
    // Press and hold: `kind` 'rotate', 'tilt' or 'zoom' turns at its rate while `sign` is -1 or 1, and stops with 0.
    hold: (kind, sign) => {
      const f3 = appliedRef.current.follow3d;
      if (!f3?.on || !(kind in NO_HOLD)) return;
      f3.hold = { ...f3.hold, [kind]: Math.sign(sign) || 0 };
      appliedRef.current.loop?.wake();
    },
    reset: () => changeOrbit(orbit => orbitFor(orbit.view === 'orbit' ? 'chase' : orbit.view, {
      item: appliedRef.current.chosen, engine: engineRef.current, trackDeg: appliedRef.current.chosen?.trackDeg ?? 0 })),
    setAuto: on => changeOrbit(orbit => orbitAuto(orbit, on)),
    // M4: start on an aircraft by the selection a click on it makes, and the aircraft parked on a stand.
    startOn: startFollow3dOn,
    parkedAt,
  }), [follow3dUi, followSubject, startFollow3d, stopFollow3d, changeOrbit, startFollow3dOn, parkedAt]);
  const followInfo = useMemo(() => Object.freeze({
    available: followAvailable, following: followingNow, canFollow, toggle: toggleFollow, three: follow3d,
  }), [followAvailable, followingNow, canFollow, toggleFollow, follow3d]);
  useLayoutEffect(() => {
    latest.current.followInfo = followInfo;
  });
  // A «Seguir en 3D» waiting for its selection (M4) starts once the selection names its aircraft and the map can follow
  // it; another choice in between forgets it. After the effect above that ends the 3D of an aircraft no longer chosen,
  // so following B from A's 3D lands on B: the URL keeps following (that effect let it go).
  useEffect(() => {
    const pending = pendingFollow3dRef.current;
    if (pending === null) return;
    if (followedId === pending.id) {
      if (!canFollow) return;
      pendingFollow3dRef.current = null;
      if (appliedRef.current.follow3d?.on) return;
      latest.current.setFollow(true);
      startFollow3d(pending.view, { handoff: pending.handoff });
      return;
    }
    if (selectionKey !== pending.from) pendingFollow3dRef.current = null;
  }, [followedId, canFollow, selectionKey, startFollow3d]);

  // The source of the aircraft data on screen (owner decision 6, contracts 2.5), while traffic is on screen. Its credit,
  // «Datos de aeronaves: {source}» with its links, is the one line ui/MapSourceStatus.jsx draws at the bottom left of
  // the map: the attribution keeps the base map's credits only, so the credit shows once and the dock never covers it.
  const trafficShown = snapshot.trafficOnScreen;
  const creditKey = trafficShown.kinds.length > 0 ? creditKeyOf(traffic?.source) : '';
  const trafficSource = useMemo(() => {
    if (creditKey === '') return null;
    const [name, homeUrl, licenseName, licenseUrl] = JSON.parse(creditKey);
    return Object.freeze({ name, homeUrl, licenseName, licenseUrl });
  }, [creditKey]);
  const aircraftDataLabel = t('attribution.aircraftData');
  // The credit of the aerodrome weather (PR M8): «Clima: NOAA Aviation Weather Center» in the map's attribution while
  // the wind is on screen (the aircraft data keep their one line in ui/MapSourceStatus.jsx).
  const windOnScreen = snapshot.referencesOnScreen.kinds.some(kind => kind === 'wind' || kind === 'windStale');
  const weatherCreditKey = windOnScreen ? creditKeyOf(weatherNow?.source) : '';
  const weatherLabel = t('attribution.weather');
  const weatherSource = useMemo(() => {
    if (weatherCreditKey === '') return null;
    const [name, homeUrl] = JSON.parse(weatherCreditKey);
    return Object.freeze({ name, homeUrl, label: weatherLabel });
  }, [weatherCreditKey, weatherLabel]);
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    const key = weatherCreditKey === '' ? '' : `${weatherCreditKey}|${weatherLabel}`;
    if (!engine || !applied.drawsWeather || applied.credit === key) return;
    applied.credit = key;
    engine.setAttribution(buildAttribution(weatherSource === null ? [] : [weatherSource], { aircraftDataLabel }));
  }, [aircraftDataLabel, weatherCreditKey, weatherLabel, weatherSource]);

  // The board's filter (M8): the AVIAM aircraft it leaves out are dimmed by feature state, written only for the keys
  // whose state changes (a filter taken away clears every key it dimmed).
  const emphasisKey = Array.isArray(flightEmphasis) ? [...new Set(flightEmphasis.map(String))].sort().join('|') : null;
  const mapFlightKeys = (Array.isArray(traffic?.flights) ? traffic.flights : EMPTY)
    .map(row => row?.flightKey).filter(key => typeof key === 'string' && key !== '').sort().join('|');
  // What this engine was given: a map started again (after a lost engine) starts with nothing dimmed.
  const dimmedRef = useRef({ engine: null, ids: new Set() });
  const dimmedKey = useMemo(() => {
    if (emphasisKey === null || mapFlightKeys === '') return '';
    const kept = new Set(emphasisKey === '' ? [] : emphasisKey.split('|'));
    return mapFlightKeys.split('|').filter(key => !kept.has(key)).join('|');
  }, [emphasisKey, mapFlightKeys]);
  const boardFilter = dimmedKey !== '';
  const engineState = snapshot.engineStatus;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = new Set(dimmedKey === '' ? [] : dimmedKey.split('|').map(key => `f:${key}`));
    const previous = dimmedRef.current.engine === engine ? dimmedRef.current.ids : new Set();
    for (const id of previous) if (!next.has(id)) engine.setFeatureState(TRAFFIC_SOURCE, id, { outside: false });
    for (const id of next) if (!previous.has(id)) engine.setFeatureState(TRAFFIC_SOURCE, id, { outside: true });
    dimmedRef.current = { engine, ids: next };
  }, [dimmedKey, engineState]);

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
  // written only when it changes; the filter that leaves the selected stand's own label out of the stand labels (N29),
  // written only when the stand changes; the flags of the stands as feature state (the casing of the selected stand, the
  // stand of a selected flight, and the stands covered by the same agent as the hovered or selected one), written only
  // where they change; and, once per newly selected stand, the camera when that stand lies outside the area in sight.
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
    // The selected stand's cyan label is the selection source's: its own label leaves the stand labels by their
    // filter, so it never shows beside the cyan one, and the cyan one needs no wide margin that would push the labels
    // of the stands beside it away. MapLibre keeps the filter through a context loss.
    if (applied.labelsWithout !== code) {
      applied.labelsWithout = code;
      const filter = standLabelFilter(code);
      for (const id of STAND_LABEL_LAYER_IDS) engine.setFilter(id, filter);
      markSettled(rootRef.current, false);
    }
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
    syncSky(engine, applied, latest.current?.theme);
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

  // The 3D aircraft follow the mode (PR M7); while a flight is followed the governor never pauses them (contracts 2.3).
  useEffect(() => {
    appliedRef.current.aircraft3d?.setEnabled(pitchMode === '3d');
  }, [pitchMode]);
  useEffect(() => {
    appliedRef.current.aircraft3d?.setFollowing(followingNow);
  }, [followingNow]);
  // The orbit's gestures (CN-30) while «Seguir en 3D» has them: a drag (any button) turns the camera round the aircraft
  // and tilts it, two fingers turn, pinch and tilt it, the wheel brings it closer. A click without a drag still chooses.
  const follow3dOn = follow3dUi !== null;
  useEffect(() => {
    const element = engineRef.current?.container;
    if (!follow3dOn || !element) return undefined;
    return attachOrbitGestures(element, changeOrbit);
  }, [follow3dOn, changeOrbit]);

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

  // The map keys (contracts 2.2) on keydown at the map's root, in the bubble phase, never on document. 0 to 4 are
  // the views the map offers while it can draw; Esc cancels the placing of a stand first, then clears a selection,
  // after a drawer or dialog has closed on its own Esc. No key of its own is added for the placing.
  useEffect(() => {
    const root = rootRef.current;
    const handlers = {};
    // The world (M8, key 0) only on a map with the globe; a view the map does not offer (M8, M9) leaves its key alone.
    for (const view of MAP_VIEWS) {
      Object.defineProperty(handlers, `view.${view}`, {
        enumerable: true,
        get: () => (store.get().engineStatus === 'unavailable' || !(latest.current?.views ?? VIEW_NAMES).includes(view)
          ? undefined : () => requestView(view)),
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
    // 2D/3D (PR M7): D, while the map can draw and its mode is the map's or the page lets it change.
    Object.defineProperty(handlers, 'toggle3d', {
      enumerable: true,
      get: () => (latest.current?.view3d?.available ? () => latest.current.view3d.toggle() : undefined),
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
        // «Seguir en 3D» (CN-30): Esc stops following and flies the camera back.
        if (appliedRef.current.follow3d?.on) return () => latest.current.followInfo?.three?.stop();
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

  // The 3D aircraft for the map lab and the visual suite (PR M7): their state, the layer's stats, and the governor's pause.
  const aircraft3d = useCallback(() => {
    const controller = appliedRef.current.aircraft3d;
    return controller ? { ...controller.state(), stats: controller.stats(), pause: () => controller.pause(),
      resume: () => controller.resume() } : null;
  }, []);

  useImperativeHandle(ref, () => ({
    flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera, jumpTo, project, whenIdle,
    aircraft3d, drawnPosition,
  }), [flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera, jumpTo, project, whenIdle,
    aircraft3d, drawnPosition]);

  // The overlays read only these: the tooltip, which changes with the pointer, renders here and re-renders none of them.
  const {
    engineStatus, basemapStatus, activeView, fits, thresholds, standsOnScreen, chipsOnScreen, standMarksOnScreen,
    flightsOnScreen, airfieldOnScreen,
  } = snapshot;

  // `focusStandOnStart` (U5, Mapa de posiciones): the stand a link selects (`stand=`) is brought to the centre once the
  // map can draw and knows its fits, as a row of the page's list does (flyToStand), instead of being left to the view.
  // Once, on the map's first start: a map re-created for the theme resumes its camera instead.
  const startStandRef = useRef(focusStandOnStart && selection?.kind === 'stand' && !resumeCameraRef?.current
    ? String(selection.id) : null);
  useEffect(() => {
    const code = startStandRef.current;
    if (code === null || engineStatus !== 'ready' || !fits) return;
    startStandRef.current = null;
    flyToStand(code);
  }, [engineStatus, fits, flyToStand]);
  const context = useMemo(() => ({
    engineStatus,
    basemapStatus,
    activeView,
    views,
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
    engineStatus, basemapStatus, activeView, views, fits, thresholds, standsOnScreen, chipsOnScreen, standMarksOnScreen,
    flightsOnScreen, airfieldOnScreen, requestView, flyToPreset, flyToStand, flyToFlight,
  ]);
  // With the traffic on screen and its source (PR M5), for the legend and the status over the map, and the layers menu;
  // and the references on screen (PR M8), for the legend.
  const { layerKeys, referencesOnScreen } = snapshot;
  // What the layers menu says under a weather key that is on and shows nothing (PR M8): why, or the time of its image;
  // the same words keep the same object, so the minute does not re-render the menu.
  const layerNotesKey = drawsWeather ? JSON.stringify(weatherLayerNotes({ layers: resolvedLayers, view: layerView, imagery,
    weather: weatherNow, nowMs: referenceMinute, language })) : '';
  const layerNotes = useMemo(() => (layerNotesKey === '' ? NO_NOTES : Object.freeze(JSON.parse(layerNotesKey))),
    [layerNotesKey]);
  const layers = useMemo(() => Object.freeze({ keys: layerKeys, values: resolvedLayers, notes: layerNotes }),
    [layerKeys, resolvedLayers, layerNotes]);
  // The motion of the traffic (PR M6): «Pausar movimiento» freezes the render clock, «Reanudar movimiento» goes back to
  // the server's time; the reads go on meanwhile.
  const pauseMotion = useCallback(() => appliedRef.current.loop?.pause(), []);
  const resumeMotion = useCallback(() => appliedRef.current.loop?.resume(), []);
  const motionSnapshot = snapshot.motion;
  const motion = useMemo(() => Object.freeze({ ...motionSnapshot, pause: pauseMotion, resume: resumeMotion }),
    [motionSnapshot, pauseMotion, resumeMotion]);
  const mapContext = useMemo(() => ({
    ...context, trafficOnScreen: trafficShown, trafficSource, layers, setLayer, layersMenuOpen, setLayersMenuOpen,
    registerLayersMenu, motion, follow: followInfo, referencesOnScreen, view3d, boardFilter,
  }), [context, trafficShown, trafficSource, layers, setLayer, layersMenuOpen, setLayersMenuOpen, registerLayersMenu,
    motion, followInfo, referencesOnScreen, view3d, boardFilter]);

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
        data-occ-3d={view3d.on ? view3dState.status : 'off'}
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
        {/* The 3D aircraft (PR M7): paused by the governor, with «Volver a 3D», or drawn in 2D after a failure. */}
        {/* A state of the map, at the top centre (the altitude scale holds the bottom left), unless the base map's. */}
        {!unavailable && basemapStatus !== 'degraded' && view3d.on && view3d.notice !== null && (
          <p role="status" data-occ-3d-notice={view3d.notice}
            className="occ-map-chip flex items-center gap-3 rounded-md border border-occ-line bg-occ-panel-float px-3 py-2 text-sm text-occ-text">
            {t(`view3d.${view3d.notice}`)}
            {view3d.notice === 'paused' && (
              <button type="button" onClick={resume3d}
                className="min-h-9 shrink-0 rounded border border-occ-line bg-occ-panel px-3 text-sm font-semibold text-occ-text hover:bg-occ-panel-raised">
                {t('view3d.resume')}
              </button>
            )}
          </p>
        )}
        {/* The altitude scale of the traffic (owner request of 2026-11-15), under the page's overlays and its dock. */}
        {!unavailable && traffic !== undefined && <AltitudeLegend theme={theme} />}
        {children}
        {!unavailable && <MapTooltip tooltip={snapshot.tooltip} />}
      </div>
    </OccMapContext.Provider>
  );
});

/**
 * The OCC map in the theme of the shell (light or dark, dark by default and outside a ThemeProvider). The style is
 * never swapped (contracts 2.4: no setStyle): a theme change re-creates the map, keyed by the theme, and the new one
 * opens on the camera the old one had when it was torn down; the selection lives in the URL and stays.
 */
// Memoised (CN-18): a page that renders again with the same props does not render the map again.
const OccMap = memo(forwardRef(function OccMap(props, ref) {
  const theme = useOptionalTheme()?.theme === 'light' ? 'light' : 'dark';
  const resumeCameraRef = useRef(null);
  return <OccMapView key={theme} ref={ref} {...props} theme={theme} resumeCameraRef={resumeCameraRef} />;
}));

export default OccMap;
